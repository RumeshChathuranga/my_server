// A buffer that can grow dynamically (like ArrayList in Java)
export type DynBuf = {
  data: Buffer;
  length: number; // how many bytes are actually used
};

// Append new data to the buffer, growing it if needed
export function bufPush(buf: DynBuf, data: Buffer): void {
  const newLen = buf.length + data.length;

  if (buf.data.length < newLen) {
    // Grow by doubling (amortized O(1) — same trick as Java's ArrayList)
    let cap = Math.max(buf.data.length, 32);
    while (cap < newLen) cap *= 2;

    const grown = Buffer.alloc(cap);
    buf.data.copy(grown, 0, 0, buf.length);
    buf.data = grown;
  }

  data.copy(buf.data, buf.length);
  buf.length = newLen;
}

// Remove `len` bytes from the FRONT of the buffer
// (shifts remaining data to position 0)
export function bufPop(buf: DynBuf, len: number): void {
  buf.data.copyWithin(0, len, buf.length); 
  buf.length -= len;
}