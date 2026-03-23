import { DynBuf, bufPop } from "../shared/buffer_utils";
import { HTTPReq, HTTPError } from "../shared/http_types";

const MAX_HEADER_SIZE = 8 * 1024; // 8 KB — reject unreasonably large headers

// Try to parse a complete HTTP request header from the buffer.
// Returns null if the header is incomplete (we need more data).
// Throws HTTPError for malformed requests.
export function parseHTTPReq(buf: DynBuf): HTTPReq | null {
  // HTTP headers end with a blank line: \r\n\r\n
  const headerEnd = buf.data
    .subarray(0, buf.length)
    .indexOf("\r\n\r\n");

  if (headerEnd < 0) {
    if (buf.length > MAX_HEADER_SIZE) {
      throw new HTTPError(431, "Request Header Fields Too Large");
    }
    return null; // incomplete — read more data
  }

  const headerData = buf.data.subarray(0, headerEnd).toString();
  bufPop(buf, headerEnd + 4); // remove header + blank line from buffer

  const lines = headerData.split("\r\n");

  if (lines.length === 0) {
    throw new HTTPError(400, "Empty request");
  }

  // Parse request line: METHOD URI HTTP/VERSION
  const requestLine = lines[0];
  const parts = requestLine.split(" ");
  if (parts.length !== 3) {
    throw new HTTPError(400, `Bad request line: ${requestLine}`);
  }

  const [method, uriStr, httpVersion] = parts;

  if (!httpVersion.startsWith("HTTP/")) {
    throw new HTTPError(400, `Unknown HTTP version: ${httpVersion}`);
  }

  const version = httpVersion.slice(5); // "1.0" or "1.1"
  if (version !== "1.0" && version !== "1.1") {
    throw new HTTPError(505, `HTTP Version Not Supported: ${version}`);
  }

  const headers = lines.slice(1).map((line) => Buffer.from(line));

  return {
    method: method.toUpperCase(),
    uri:    Buffer.from(uriStr),
    version,
    headers,
  };
}

// Find the value of a named header field (case-insensitive).
// Returns null if the header is not present.
export function fieldGet(headers: Buffer[], name: string): Buffer | null {
  const lower = name.toLowerCase();
  for (const h of headers) {
    const str = h.toString();
    const colon = str.indexOf(":");
    if (colon < 0) continue;
    if (str.slice(0, colon).toLowerCase().trim() === lower) {
      return Buffer.from(str.slice(colon + 1).trim());
    }
  }
  return null;
}