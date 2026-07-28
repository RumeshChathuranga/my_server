import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldGet } from "./parser";

function headers(...lines: string[]): Buffer[] {
  return lines.map((l) => Buffer.from(l));
}

test("fieldGet finds an exact-case match", () => {
  const h = headers("Content-Type: text/plain");
  assert.equal(fieldGet(h, "Content-Type")?.toString(), "text/plain");
});

test("fieldGet matches case-insensitively", () => {
  const h = headers("content-TYPE: text/html");
  assert.equal(fieldGet(h, "Content-Type")?.toString(), "text/html");
});

test("fieldGet trims surrounding whitespace on the value", () => {
  const h = headers("Content-Length:   42   ");
  assert.equal(fieldGet(h, "Content-Length")?.toString(), "42");
});

test("fieldGet returns null when the header is missing", () => {
  const h = headers("Content-Type: text/plain");
  assert.equal(fieldGet(h, "X-Missing"), null);
});

test("fieldGet does not false-match a header name that is a substring of another", () => {
  const h = headers("If-Modified-Since: Mon, 01 Jan 2024 00:00:00 GMT");
  assert.equal(fieldGet(h, "Modified-Since"), null);
});

test("fieldGet finds the target header when it is not first in the list", () => {
  const h = headers(
    "Host: example.com",
    "Accept: */*",
    "Range: bytes=0-499",
  );
  assert.equal(fieldGet(h, "Range")?.toString(), "bytes=0-499");
});
