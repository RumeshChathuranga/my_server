import * as net from "net";
import { DynBuf, bufPush } from "../shared/buffer_utils";
import { BodyReader, HTTPError, HTTPReq, HTTPRes } from "../shared/http_types";
import { soInit, soRead, TCPConn } from "../shared/tcp_conn";
import { cutMessage, fieldGet } from "./parser";
import { writeHTTPResp } from "./writer";

function parseDec(text: string): number {
  if (!/^[0-9]+$/.test(text)) {
    return NaN;
  }
  return Number(text);
}

function readerFromMemory(data: Buffer): BodyReader {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (done) {
        return Buffer.from("");
      }
      done = true;
      return data;
    },
  };
}

function readerFromConnLength(
  conn: TCPConn,
  buf: DynBuf,
  remain: number
): BodyReader {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      if (remain === 0) {
        return Buffer.from("");
      }

      if (buf.length === 0) {
        const data = await soRead(conn);
        bufPush(buf, data);
        if (data.length === 0) {
          throw new Error("Unexpected EOF from HTTP body");
        }
      }

      const consume = Math.min(buf.length, remain);
      remain -= consume;
      const data = Buffer.from(buf.data.subarray(0, consume));
      buf.data.copyWithin(0, consume, buf.length);
      buf.length -= consume;
      return data;
    },
  };
}

function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq): BodyReader {
  let bodyLen = -1;
  const contentLen = fieldGet(req.headers, "Content-Length");
  if (contentLen) {
    bodyLen = parseDec(contentLen.toString("latin1"));
    if (isNaN(bodyLen)) {
      throw new HTTPError(400, "bad Content-Length.");
    }
  }

  const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
  const transferEncoding = fieldGet(req.headers, "Transfer-Encoding")
    ?.toString("latin1")
    .trim()
    .toLowerCase();
  const chunked = transferEncoding === "chunked";

  if (!bodyAllowed && (bodyLen > 0 || chunked)) {
    throw new HTTPError(400, "HTTP body not allowed.");
  }
  if (!bodyAllowed) {
    bodyLen = 0;
  }

  if (bodyLen >= 0) {
    return readerFromConnLength(conn, buf, bodyLen);
  }
  if (chunked) {
    throw new HTTPError(501, "TODO");
  }
  throw new HTTPError(501, "TODO");
}

async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  let resp: BodyReader;
  switch (req.uri.toString("latin1")) {
    case "/echo":
      resp = body;
      break;
    default:
      resp = readerFromMemory(Buffer.from("hello world.\n"));
      break;
  }

  return {
    code: 200,
    headers: [Buffer.from("Server: my_first_http_server")],
    body: resp,
  };
}

async function serveClient(conn: TCPConn): Promise<void> {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    const msg = cutMessage(buf);
    if (!msg) {
      const data = await soRead(conn);
      bufPush(buf, data);

      if (data.length === 0 && buf.length === 0) {
        return;
      }
      if (data.length === 0) {
        throw new HTTPError(400, "Unexpected EOF.");
      }

      continue;
    }

    const reqBody = readerFromReq(conn, buf, msg);
    const res = await handleReq(msg, reqBody);
    await writeHTTPResp(conn, res);

    if (msg.version === "1.0") {
      return;
    }

    while ((await reqBody.read()).length > 0) {
      /* drain body */
    }
  }
}

async function newConn(socket: net.Socket): Promise<void> {
  const conn = soInit(socket);
  try {
    await serveClient(conn);
  } catch (exc) {
    console.error("exception:", exc);
    if (exc instanceof HTTPError) {
      const resp: HTTPRes = {
        code: exc.code,
        headers: [],
        body: readerFromMemory(Buffer.from(`${exc.message}\n`)),
      };
      try {
        await writeHTTPResp(conn, resp);
      } catch {
        /* ignore */
      }
    }
  } finally {
    socket.destroy();
  }
}

const server = net.createServer({ pauseOnConnect: true, noDelay: true });
server.on("error", (err) => {
  throw err;
});
server.on("connection", newConn);
server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("HTTP server on http://127.0.0.1:1234");
});
