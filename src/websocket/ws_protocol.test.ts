import { test } from "node:test";
import assert from "node:assert/strict";
import { DynBuf, bufPush } from "../shared/buffer_utils";
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

function emptyBuf(): DynBuf {
  return { data: Buffer.alloc(0), length: 0 };
}

function push(buf: DynBuf, ...chunks: Buffer[]): void {
  for (const c of chunks) bufPush(buf, c);
}

// Builds a masked client->server frame by hand, since wsEncodeFrame only
// ever produces unmasked (server->client) frames.
function encodeMaskedFrame(opcode: number, payload: Buffer): Buffer {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];

  const header = Buffer.from([0x80 | (opcode & 0x0f), 0x80 | payload.length]);
  return Buffer.concat([header, mask, masked]);
}

test("wsHandshakeAccept matches the fixed RFC 6455 example key/response", () => {
  // RFC 6455 §1.3 worked example.
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  assert.equal(wsHandshakeAccept(key), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("wsDecodeFrame decodes a small unmasked text frame", () => {
  const buf = emptyBuf();
  const frame: WSFrame = { fin: true, opcode: WS_OPCODE_TEXT, payload: Buffer.from("hi") };
  push(buf, wsEncodeFrame(frame));

  const decoded = wsDecodeFrame(buf);
  assert.ok(decoded);
  assert.equal(decoded!.fin, true);
  assert.equal(decoded!.opcode, WS_OPCODE_TEXT);
  assert.equal(decoded!.payload.toString(), "hi");
  assert.equal(buf.length, 0, "the decoded frame's bytes must be consumed from the buffer");
});

test("wsDecodeFrame unmasks a masked client frame correctly", () => {
  const buf = emptyBuf();
  push(buf, encodeMaskedFrame(WS_OPCODE_TEXT, Buffer.from("Hello")));

  const decoded = wsDecodeFrame(buf);
  assert.ok(decoded);
  assert.equal(decoded!.opcode, WS_OPCODE_TEXT);
  assert.equal(decoded!.payload.toString(), "Hello");
});

test("wsDecodeFrame handles the 126 extended-length prefix (16-bit length)", () => {
  const buf = emptyBuf();
  const payload = Buffer.alloc(200, "a"); // > 125, forces the 126 length-prefix form
  push(buf, wsEncodeFrame({ fin: true, opcode: WS_OPCODE_BINARY, payload }));

  const decoded = wsDecodeFrame(buf);
  assert.ok(decoded);
  assert.equal(decoded!.opcode, WS_OPCODE_BINARY);
  assert.equal(decoded!.payload.length, 200);
  assert.equal(decoded!.payload.toString(), payload.toString());
});

test("wsDecodeFrame handles the 127 extended-length prefix (64-bit length)", () => {
  const buf = emptyBuf();
  const payload = Buffer.alloc(70_000, "b"); // > 65535, forces the 127 length-prefix form
  push(buf, wsEncodeFrame({ fin: true, opcode: WS_OPCODE_BINARY, payload }));

  const decoded = wsDecodeFrame(buf);
  assert.ok(decoded);
  assert.equal(decoded!.payload.length, 70_000);
  assert.equal(decoded!.payload.toString(), payload.toString());
});

test("wsDecodeFrame returns null on a buffer with fewer than 2 bytes", () => {
  const buf = emptyBuf();
  push(buf, Buffer.from([0x81]));
  assert.equal(wsDecodeFrame(buf), null);
});

test("wsDecodeFrame returns null when the 16-bit length field isn't fully arrived", () => {
  const buf = emptyBuf();
  // Signals a 126-length frame (2 header bytes) but doesn't include
  // the 2 extra length bytes that reading needs.
  push(buf, Buffer.from([0x81, 126]));
  assert.equal(wsDecodeFrame(buf), null);
});

test("wsDecodeFrame returns null when the payload hasn't fully arrived, then decodes once it has", () => {
  const buf = emptyBuf();
  const full = wsEncodeFrame({ fin: true, opcode: WS_OPCODE_TEXT, payload: Buffer.from("0123456789") });

  push(buf, full.subarray(0, full.length - 5)); // header + partial payload only
  assert.equal(wsDecodeFrame(buf), null);

  push(buf, full.subarray(full.length - 5)); // remaining bytes arrive
  const decoded = wsDecodeFrame(buf);
  assert.ok(decoded);
  assert.equal(decoded!.payload.toString(), "0123456789");
});

test("wsEncodeFrame -> wsDecodeFrame round-trips for every opcode used by the server", () => {
  const opcodes = [WS_OPCODE_TEXT, WS_OPCODE_BINARY, WS_OPCODE_PING, WS_OPCODE_PONG, WS_OPCODE_CLOSE];

  for (const opcode of opcodes) {
    const buf = emptyBuf();
    const original: WSFrame = { fin: true, opcode, payload: Buffer.from(`payload-${opcode}`) };
    push(buf, wsEncodeFrame(original));

    const decoded = wsDecodeFrame(buf);
    assert.ok(decoded, `opcode ${opcode} should round-trip`);
    assert.equal(decoded!.opcode, original.opcode);
    assert.equal(decoded!.payload.toString(), original.payload.toString());
  }
});
