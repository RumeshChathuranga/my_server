import { DynBuf, bufPop } from "../shared/buffer_utils";
import { HTTPError, HTTPReq } from "../shared/http_types";

const kMaxHeaderLen = 1024 * 8;

export function cutMessage(buf: DynBuf): null | HTTPReq {
  const idx = buf.data.subarray(0, buf.length).indexOf("\r\n\r\n");
  if (idx < 0) {
    if (buf.length >= kMaxHeaderLen) {
      throw new HTTPError(413, "header is too large");
    }
    return null;
  }

  const msg = parseHTTPReq(buf.data.subarray(0, idx + 4));
  bufPop(buf, idx + 4);
  return msg;
}

//parse an HTTP request header
export function parseHTTPReq(data: Buffer): HTTPReq {
  const lines = splitLines(data);
  if (lines.length < 2) {
    throw new HTTPError(400, "bad request line");
  }

  const { method, uri, version } = parseRequestLine(lines[0]);

  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const h = Buffer.from(lines[i]); //copy
    if (!validateHeader(h)) {
      throw new HTTPError(400, "bad field");
    }
    headers.push(h);
  }

  if (lines[lines.length - 1].length !== 0) {
    throw new HTTPError(400, "header not terminated");
  }

  return {
    method,
    uri,
    version,
    headers,
  };
}

export function fieldGet(headers: Buffer[], key: string): null | Buffer {
  const keyLower = key.toLowerCase();
  for (const header of headers) {
    const line = header.toString("latin1");
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const name = line.slice(0, idx).trim().toLowerCase();
    if (name === keyLower) {
      const value = line.slice(idx + 1).trim();
      return Buffer.from(value, "latin1");
    }
  }
  return null;
}

function splitLines(data: Buffer): Buffer[] {
  const raw = data.toString("latin1").split("\r\n");
  if (raw.length > 0 && raw[raw.length - 1] === "") {
    raw.pop();
  }
  return raw.map((line) => Buffer.from(line, "latin1"));
}

function parseRequestLine(line: Buffer): {
  method: string;
  uri: Buffer;
  version: string;
} {
  const text = line.toString("latin1");
  const parts = text.split(" ").filter((p) => p.length > 0);
  if (parts.length !== 3) {
    throw new HTTPError(400, "bad request line");
  }
  const [method, uriText, versionText] = parts;
  if (!method || !uriText || !versionText) {
    throw new HTTPError(400, "bad request line");
  }
  if (!versionText.startsWith("HTTP/")) {
    throw new HTTPError(400, "bad version");
  }
  const version = versionText.slice("HTTP/".length);
  if (version !== "1.0" && version !== "1.1") {
    throw new HTTPError(400, "bad version");
  }
  return {
    method,
    uri: Buffer.from(uriText, "latin1"),
    version,
  };
}

function validateHeader(header: Buffer): boolean {
  const line = header.toString("latin1");
  if (line.includes("\r") || line.includes("\n")) {
    return false;
  }
  const idx = line.indexOf(":");
  if (idx <= 0) {
    return false;
  }
  const name = line.slice(0, idx).trim();
  const token = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  return token.test(name);
}
