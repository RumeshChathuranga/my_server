import * as net from "net";
import { soInit, soRead, soWrite, TCPConn } from "../shared/tcp_conn";
import { DynBuf, bufPush, bufPop } from "../shared/buffer_utils";
import { HTTPReq, HTTPRes, HTTPError, BodyReader } from "../shared/http_types";
import { parseHTTPReq, fieldGet } from "./parser";
import { writeHTTPResp } from "./writer";

// Create a BodyReader for a fixed-size in-memory buffer
export function readerFromMemory(data: Buffer): BodyReader {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (done) return Buffer.from("");
      done = true;
      return data;
    },
  };
}

// Create an empty BodyReader (for 304 / HEAD responses)
export function emptyBody(): BodyReader {
  return readerFromMemory(Buffer.from(""));
}

// Build a simple text/HTML error response
function errorResponse(code: number, message: string): HTTPRes {
  const body = Buffer.from(`<h1>${code} — ${message}</h1>`);
  return {
    code,
    headers: [Buffer.from("Content-Type: text/html")],
    body: readerFromMemory(body),
  };
}

// ---------------------------------------------------------------
// Request handler — replace this with your own logic!
// ---------------------------------------------------------------
async function handleRequest(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  const uri = req.uri.toString();

  if (req.method === "GET" && uri === "/") {
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: text/plain")],
      body: readerFromMemory(
        Buffer.from("Hello from my custom HTTP server!\r\n"),
      ),
    };
  }

  if (req.method === "POST" && uri === "/echo") {
    // Read and echo back whatever the client sent
    const chunks: Buffer[] = [];
    while (true) {
      const chunk = await body.read();
      if (chunk.length === 0) break;
      chunks.push(chunk);
    }
    const payload = Buffer.concat(chunks);
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: application/octet-stream")],
      body: readerFromMemory(payload),
    };
  }

  if (req.method === "GET" && uri === "/sheep") {
    const { readerFromGenerator, sheepGenerator } =
      await import("../streaming/chunked");
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: text/plain")],
      body: readerFromGenerator(sheepGenerator()),
    };
  }

  // if (req.method === "GET" && uri.startsWith("/files/")) {
  //   const { serveFile } = await import("../files/file_server");
  //   const filePath = uri.slice("/files/".length);
  //   return serveFile(req, filePath);
  // }

  if (req.method === "GET" && uri.startsWith("/files/")) {
    const { serveFileWithRange } = await import("../range/range");
    const filePath = uri.slice("/files/".length);
    return serveFileWithRange(req, filePath);
  }

  return errorResponse(404, "Not Found");
}

// ---------------------------------------------------------------
// Read the request body from the socket using Content-Length
// ---------------------------------------------------------------
function makeBodyReader(
  conn: TCPConn,
  buf: DynBuf,
  contentLength: number,
): BodyReader {
  let remaining = contentLength;

  return {
    length: contentLength,
    read: async (): Promise<Buffer> => {
      if (remaining === 0) return Buffer.from("");

      // If there's already buffered data, return it first
      if (buf.length > 0) {
        const take = Math.min(buf.length, remaining);
        const chunk = Buffer.from(buf.data.subarray(0, take));
        bufPop(buf, take);
        remaining -= take;
        return chunk;
      }

      // Otherwise read from socket
      const data = await soRead(conn);
      if (data.length === 0) throw new Error("Unexpected EOF reading body");

      const take = Math.min(data.length, remaining);
      remaining -= take;

      if (take < data.length) {
        // Push surplus back into buf for the next request
        bufPush(buf, data.subarray(take));
      }

      return data.subarray(0, take);
    },
  };
}

// ---------------------------------------------------------------
// Drain any unread body bytes (required before reading next request)
// ---------------------------------------------------------------
async function drainBody(body: BodyReader): Promise<void> {
  while (true) {
    const chunk = await body.read();
    if (chunk.length === 0) break;
  }
}

// ---------------------------------------------------------------
// HTTP connection loop — supports keep-alive (HTTP/1.1 pipelining)
// ---------------------------------------------------------------
async function serveHTTP(socket: net.Socket): Promise<void> {
  const conn = soInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // --- Parse HTTP header ---
    let req: HTTPReq | null = null;

    while (!req) {
      const data = await soRead(conn);

      if (data.length === 0) {
        // Client closed connection — clean exit
        if (buf.length > 0) {
          console.error("Unexpected EOF — partial request discarded.");
        }
        return;
      }

      bufPush(buf, data);

      try {
        req = parseHTTPReq(buf);
      } catch (err) {
        if (err instanceof HTTPError) {
          await writeHTTPResp(conn, errorResponse(err.code, err.message));
          socket.destroy();
          return;
        }
        throw err;
      }
    }

    // --- Build body reader ---
    const contentLengthBuf = fieldGet(req.headers, "Content-Length");
    const contentLength = contentLengthBuf
      ? parseInt(contentLengthBuf.toString(), 10)
      : 0;

    const reqBody = makeBodyReader(conn, buf, contentLength);

    // --- Handle the request ---
    let res: HTTPRes;
    try {
      res = await handleRequest(req, reqBody);
    } catch (err) {
      if (err instanceof HTTPError) {
        res = errorResponse(err.code, err.message);
      } else {
        res = errorResponse(500, "Internal Server Error");
        console.error("Unhandled error:", err);
      }
    }

    // --- Send the response ---
    try {
      await writeHTTPResp(conn, res);
    } finally {
      await res.body.close?.(); // close file handles etc.
    }

    // --- Drain any unread request body (required before next request) ---
    await drainBody(reqBody);

    // --- HTTP/1.0: close after each request ---
    if (req.version === "1.0") {
      socket.destroy();
      return;
    }

    // HTTP/1.1: loop for the next request (keep-alive)
  }
}

// ---------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------
const server = net.createServer({ pauseOnConnect: true });
server.on("error", (err: Error) => {
  throw err;
});

server.on("connection", async (socket: net.Socket) => {
  try {
    await serveHTTP(socket);
  } catch (err) {
    console.error("Fatal connection error:", err);
  } finally {
    socket.destroy();
  }
});

server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("HTTP Server on http://127.0.0.1:1234");
});
