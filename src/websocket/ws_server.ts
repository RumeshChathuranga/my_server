import * as net from "net";
import { TCPConn, soRead, soWrite } from "../shared/tcp_conn";
import { DynBuf, bufPush } from "../shared/buffer_utils";
import { HTTPReq } from "../shared/http_types";
import { fieldGet } from "../http/parser";
import { createQueue, Queue } from "./ws_queue";
import {
  wsHandshakeAccept,
  wsDecodeFrame,
  wsEncodeFrame,
  WSFrame,
  WS_OPCODE_TEXT,
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
} from "./ws_protocol";

// Check whether the request is a valid WebSocket upgrade request
export function isWebSocketUpgrade(req: HTTPReq): boolean {
  const upgrade = fieldGet(req.headers, "Upgrade");
  const connection = fieldGet(req.headers, "Connection");
  const wsKey = fieldGet(req.headers, "Sec-WebSocket-Key");
  const hasUpgradeToken = connection?.toString().toLowerCase().includes("upgrade") ?? false;

  return (
    upgrade?.toString().toLowerCase() === "websocket" &&
    hasUpgradeToken &&
    wsKey !== null
  );
}

// Perform the WebSocket handshake and return control to the caller
export async function wsHandshake(conn: TCPConn, req: HTTPReq): Promise<void> {
  const key = fieldGet(req.headers, "Sec-WebSocket-Key")!.toString();
  const accept = wsHandshakeAccept(key);

  const response = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n");

  await soWrite(conn, Buffer.from(response));
}

// Full WebSocket session: handles a single connection after the handshake.
// Echoes text/binary frames back and responds to ping with pong.
export async function wsServeConnection(conn: TCPConn): Promise<void> {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };
  const sendQueue: Queue<WSFrame> = createQueue<WSFrame>();

  // --- Writer task: drains the send queue and writes frames to socket ---
  const writerTask = (async () => {
    while (true) {
      const frame = await sendQueue.popFront();
      if (!frame) break; // queue closed

      await soWrite(conn, wsEncodeFrame(frame));

      if (frame.opcode === WS_OPCODE_CLOSE) break;
    }
  })();

  // Helper: enqueue a frame for sending
  async function sendFrame(frame: WSFrame): Promise<void> {
    await sendQueue.pushBack(frame);
  }

  // --- Reader loop ---
  try {
    while (true) {
      // Read more data
      const data = await soRead(conn);
      if (data.length === 0) break; // TCP EOF

      bufPush(buf, data);

      // Decode as many frames as possible from the buffer
      while (true) {
        const frame = wsDecodeFrame(buf);
        if (!frame) break; // need more data

        switch (frame.opcode) {
          case WS_OPCODE_TEXT:
          case WS_OPCODE_BINARY: {
            console.log("WS message:", frame.payload.toString());
            // Echo back with a text response
            await sendFrame({
              fin: true,
              opcode: WS_OPCODE_TEXT,
              payload: Buffer.from(`Echo: ${frame.payload.toString()}`),
            });
            break;
          }

          case WS_OPCODE_PING: {
            await sendFrame({
              fin: true,
              opcode: WS_OPCODE_PONG,
              payload: frame.payload,
            });
            break;
          }

          case WS_OPCODE_CLOSE: {
            // Echo the close frame back and terminate
            await sendFrame({
              fin: true,
              opcode: WS_OPCODE_CLOSE,
              payload: frame.payload,
            });
            sendQueue.close();
            await writerTask;
            return;
          }
        }
      }
    }
  } finally {
    sendQueue.close();
    await writerTask;
  }
}
