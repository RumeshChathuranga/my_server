// Parsed HTTP request (headers only — body is read separately)
export type HTTPReq = {
  method:  string;    // e.g. "GET", "POST", "HEAD"
  uri:     Buffer;    // raw request URI, e.g. "/index.html"
  version: string;    // "1.0" or "1.1"
  headers: Buffer[];  // raw header lines, e.g. "Content-Type: text/plain"
};

// HTTP response to be written to the socket
export type HTTPRes = {
  code:    number;    // status code, e.g. 200, 404, 206
  headers: Buffer[];  // header lines to include in the response
  body:    BodyReader;
};

// Abstraction over a response body (memory buffer, file, or generator)
export type BodyReader = {
  length: number;                  // byte count, or -1 for chunked/unknown
  read:   () => Promise<Buffer>;   // returns empty Buffer at EOF
  close?: () => Promise<void>;     // optional cleanup (e.g. close file handle)
};

// Throw this to send an HTTP error response back to the client
export class HTTPError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "HTTPError";
  }
}