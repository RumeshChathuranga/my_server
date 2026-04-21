import * as net from "net";
import * as path from "path";
import * as fs from "fs/promises";
import { soInit, soRead, soWrite, TCPConn } from "./shared/tcp_conn";
import { DynBuf, bufPush } from "./shared/buffer_utils";
import { HTTPReq, HTTPRes, HTTPError, BodyReader } from "./shared/http_types";
import { parseHTTPReq, fieldGet } from "./http/parser";
import { writeHTTPResp } from "./http/writer";
import { readerFromMemory, emptyBody } from "./http/server";
import { serveFileWithCache } from "./cache/cache";
import { clientAcceptsGzip, gzipBody } from "./compression/compress";
import { isWebSocketUpgrade, wsHandshake, wsServeConnection } from "./websocket/ws_server";
import { readerFromGenerator, sheepGenerator } from "./streaming/chunked";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? "1234");

// ---------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------
async function handleRequest(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  const uri = req.uri.toString();

  // --- Root: serve index.html ---
  if (uri === "/" || uri === "/index.html") {
    return serveFileWithCache(req, "index.html");
  }

  // --- Echo endpoint (POST) ---
  if (req.method === "POST" && uri === "/echo") {
    const chunks: Buffer[] = [];
    let chunk: Buffer;
    while ((chunk = await body.read()).length > 0) {
      chunks.push(chunk);
    }
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: text/plain")],
      body: readerFromMemory(Buffer.concat(chunks)),
    };
  }

  // --- Streaming demo ---
  if (req.method === "GET" && uri === "/sheep") {
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: text/plain; charset=utf-8")],
      body: readerFromGenerator(sheepGenerator()),
    };
  }

  // --- Static files with range + caching ---
  if (req.method === "GET" && uri.startsWith("/files/")) {
    return serveFileWithCache(req, uri.slice("/files/".length));
  }

  // --- Health check ---
  if (uri === "/health") {
    return {
      code: 200,
      headers: [Buffer.from("Content-Type: application/json")],
      body: readerFromMemory(Buffer.from(JSON.stringify({ status: "ok" }))),
    };
  }

  // --- 404 fallback ---
  return {
    code: 404,
    headers: [Buffer.from("Content-Type: text/plain")],
    body: readerFromMemory(Buffer.from("404 Not Found")),
  };
}

// ---------------------------------------------------------------
// Request body reader (Content-Length based)
// ---------------------------------------------------------------
function makeBodyReader(conn: TCPConn, buf: DynBuf, contentLength: number): BodyReader {
  let remaining = contentLength;

  return {
    length: contentLength,
    read: async (): Promise<Buffer> => {
      if (remaining === 0) return Buffer.from("");

      if (buf.length > 0) {
        const take = Math.min(buf.length, remaining);
        const chunk = Buffer.from(buf.data.subarray(0, take));
        buf.data.copyWithin(0, take, buf.length);
        buf.length -= take;
        remaining -= take;
        return chunk;
      }

      const data = await soRead(conn);
      if (data.length === 0) throw new Error("Unexpected EOF reading request body");

      const take = Math.min(data.length, remaining);
      remaining -= take;

      if (take < data.length) {
        // Excess data belongs to the next request
        const extra = data.subarray(take);
        bufPush(buf, extra);
      }

      return data.subarray(0, take);
    },
  };
}

async function drainBody(body: BodyReader): Promise<void> {
  while ((await body.read()).length > 0) { /* drain */ }
}

// ---------------------------------------------------------------
// HTTP connection loop
// ---------------------------------------------------------------
async function serveHTTP(socket: net.Socket): Promise<void> {
  const conn = soInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // Parse request header
    let req: HTTPReq | null = null;

    while (!req) {
      const data = await soRead(conn);

      if (data.length === 0) {
        if (buf.length > 0) {
          console.error("Unexpected EOF — partial request discarded");
        }
        return;
      }

      bufPush(buf, data);

      try {
        req = parseHTTPReq(buf);
      } catch (err) {
        if (err instanceof HTTPError) {
          const errBody = Buffer.from(err.message);
          await writeHTTPResp(conn, {
            code: err.code,
            headers: [Buffer.from("Content-Type: text/plain")],
            body: readerFromMemory(errBody),
          });
          socket.destroy();
          return;
        }
        throw err;
      }
    }

    // WebSocket upgrade intercept
    if (isWebSocketUpgrade(req)) {
      await wsHandshake(conn, req);
      await wsServeConnection(conn);
      return;
    }

    // Build request body reader
    const clBuf = fieldGet(req.headers, "Content-Length");
    const contentLength = clBuf ? parseInt(clBuf.toString(), 10) : 0;
    const reqBody = makeBodyReader(conn, buf, contentLength);

    // Handle request
    let res: HTTPRes;
    try {
      res = await handleRequest(req, reqBody);
    } catch (err) {
      if (err instanceof HTTPError) {
        res = {
          code: err.code,
          headers: [Buffer.from("Content-Type: text/plain")],
          body: readerFromMemory(Buffer.from(err.message)),
        };
      } else {
        console.error("Unhandled error:", err);
        res = {
          code: 500,
          headers: [],
          body: readerFromMemory(Buffer.from("Internal Server Error")),
        };
      }
    }

    // Apply gzip compression if supported
    if (
      clientAcceptsGzip(req) &&
      res.code !== 304 &&
      res.code !== 101 &&
      res.body.length !== 0
    ) {
      res = {
        ...res,
        headers: [...res.headers, Buffer.from("Content-Encoding: gzip")],
        body: gzipBody(res.body),
      };
    }

    // Write response
    try {
      await writeHTTPResp(conn, res);
    } finally {
      await res.body.close?.();
    }

    // Drain any unread request body
    await drainBody(reqBody);

    // HTTP/1.0: close after response
    if (req.version === "1.0") {
      socket.destroy();
      return;
    }
  }
}

// ---------------------------------------------------------------
// Start server
// ---------------------------------------------------------------
const server = net.createServer({ pauseOnConnect: true });

server.on("error", (err: Error) => {
  console.error("Server error:", err);
  process.exit(1);
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

server.listen({ host: HOST, port: PORT }, () => {
  console.log(`\n🚀 Web server running at http://${HOST}:${PORT}`);
  console.log(`   Routes:`);
  console.log(`     GET  /              → index.html`);
  console.log(`     POST /echo          → echo request body`);
  console.log(`     GET  /sheep         → chunked streaming demo`);
  console.log(`     GET  /files/<path>  → static file with range + cache`);
  console.log(`     GET  /health        → health check JSON`);
  console.log(`     WS   /              → WebSocket echo\n`);
});