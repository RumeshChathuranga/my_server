import * as crypto from "crypto";
import { TCPConn, soRead, soWrite } from "../shared/tcp_conn";
import { DynBuf, bufPush, bufPop } from "../shared/buffer_utils";

// WebSocket opcodes (RFC 6455 §11.8)
export const WS_OPCODE_CONTINUATION = 0x0;
export const WS_OPCODE_TEXT         = 0x1;
export const WS_OPCODE_BINARY       = 0x2;
export const WS_OPCODE_CLOSE        = 0x8;
export const WS_OPCODE_PING         = 0x9;
export const WS_OPCODE_PONG         = 0xA;

export type WSFrame = {
  fin:     boolean;
  opcode:  number;
  payload: Buffer;
};

// Derive the Sec-WebSocket-Accept response header value (RFC 6455 §4.2.2)
export function wsHandshakeAccept(key: string): string {
  return crypto
    .createHash("sha1")
    .update(key.trim())
    .update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11") // RFC magic constant
    .digest("base64");
}

// Try to decode one WebSocket frame from the buffer.
// Returns null if more data is needed.
export function wsDecodeFrame(buf: DynBuf): WSFrame | null {
  if (buf.length < 2) return null;

  const b0 = buf.data[0];
  const b1 = buf.data[1];

  const fin    = (b0 & 0x80) !== 0;
  const opcode =  b0 & 0x0F;
  const masked = (b1 & 0x80) !== 0;
  let payloadLen = b1 & 0x7F;

  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    // Read as two 32-bit integers (JS can't handle 64-bit integers safely)
    payloadLen = buf.data.readUInt32BE(6); // low 32 bits only (practical limit)
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  const totalLen = offset + maskLen + payloadLen;

  if (buf.length < totalLen) return null;

  let payload = Buffer.from(buf.data.subarray(offset + maskLen, offset + maskLen + payloadLen));

  if (masked) {
    const mask = buf.data.subarray(offset, offset + 4);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  bufPop(buf, totalLen);

  return { fin, opcode, payload };
}

// Encode a WebSocket frame (server-to-client, never masked per RFC 6455)
export function wsEncodeFrame(frame: WSFrame): Buffer {
  const payloadLen = frame.payload.length;

  let headerLen: number;
  if (payloadLen <= 125) {
    headerLen = 2;
  } else if (payloadLen <= 65535) {
    headerLen = 4;
  } else {
    headerLen = 10;
  }

  const header = Buffer.alloc(headerLen);
  header[0] = (frame.fin ? 0x80 : 0) | (frame.opcode & 0x0F);

  if (payloadLen <= 125) {
    header[1] = payloadLen; // MASK bit = 0
  } else if (payloadLen <= 65535) {
    header[1] = 126;
    header.writeUInt16BE(payloadLen, 2);
  } else {
    header[1] = 127;
    header.writeUInt32BE(0, 2);           // high 32 bits
    header.writeUInt32BE(payloadLen, 6);  // low 32 bits
  }

  return Buffer.concat([header, frame.payload]);
}