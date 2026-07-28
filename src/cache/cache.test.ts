import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRange } from "./cache";

const FILE_SIZE = 1000;

test("parseRange handles a closed range", () => {
  assert.deepEqual(parseRange("bytes=0-3", FILE_SIZE), [0, 4]);
});

test("parseRange handles an open-ended range", () => {
  assert.deepEqual(parseRange("bytes=500-", FILE_SIZE), [500, FILE_SIZE]);
});

test("parseRange handles a suffix range (last N bytes)", () => {
  assert.deepEqual(parseRange("bytes=-500", FILE_SIZE), [500, FILE_SIZE]);
});

test("parseRange returns null for a malformed header", () => {
  assert.equal(parseRange("not-a-range", FILE_SIZE), null);
  assert.equal(parseRange("bytes=-", FILE_SIZE), null);
});

test("parseRange returns null for an inverted or empty range", () => {
  assert.equal(parseRange("bytes=500-100", FILE_SIZE), null);
});

test("parseRange clamps an end beyond the file size", () => {
  assert.deepEqual(parseRange(`bytes=990-${FILE_SIZE + 500}`, FILE_SIZE), [990, FILE_SIZE]);
});
