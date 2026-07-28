import { test } from "node:test";
import assert from "node:assert/strict";
import { DynBuf, bufPush, bufPop } from "./buffer_utils";

function emptyBuf(): DynBuf {
  return { data: Buffer.alloc(0), length: 0 };
}

test("bufPush appends into an empty buffer", () => {
  const buf = emptyBuf();
  bufPush(buf, Buffer.from("hello"));
  assert.equal(buf.length, 5);
  assert.equal(buf.data.subarray(0, buf.length).toString(), "hello");
});

test("bufPush grows capacity when it crosses the doubling boundary", () => {
  const buf = emptyBuf();
  const big = Buffer.alloc(100, "x"); // starting cap doubles from 32 -> 64 -> 128
  bufPush(buf, big);
  assert.equal(buf.length, 100);
  assert.ok(buf.data.length >= 100, "underlying capacity must fit the pushed data");
  assert.equal(buf.data.subarray(0, buf.length).toString(), big.toString());
});

test("multiple sequential pushes preserve order and content", () => {
  const buf = emptyBuf();
  bufPush(buf, Buffer.from("foo"));
  bufPush(buf, Buffer.from("bar"));
  bufPush(buf, Buffer.from("baz"));
  assert.equal(buf.data.subarray(0, buf.length).toString(), "foobarbaz");
});

test("bufPop removes from the front and shifts remaining bytes", () => {
  const buf = emptyBuf();
  bufPush(buf, Buffer.from("foobar"));
  bufPop(buf, 3);
  assert.equal(buf.length, 3);
  assert.equal(buf.data.subarray(0, buf.length).toString(), "bar");
});

test("bufPop of the entire buffer resets length to 0", () => {
  const buf = emptyBuf();
  bufPush(buf, Buffer.from("data"));
  bufPop(buf, 4);
  assert.equal(buf.length, 0);
});
