// Represents a parsed HTTP request header
export type HTTPReq = {
  method: string;      // GET, POST, etc.
  uri: Buffer;         // the URL path, e.g. /hello
  version: string;     // 1.0 or 1.1
  headers: Buffer[];   // list of raw header lines
};

// Represents an HTTP response
export type HTTPRes = {
  code: number;         // status code, e.g. 200, 404
  headers: Buffer[];    // list of raw header lines to send
  body: BodyReader;     // the response body (may be large!)
};

// Interface for reading a response body (could be file, memory, generator)
export type BodyReader = {
  length: number;                        // -1 if unknown (chunked)
  read: () => Promise<Buffer>;           // returns empty Buffer at EOF
  close?: () => Promise<void>;           // optional cleanup (e.g. close file)
};

// Custom error to send HTTP error responses
export class HTTPError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}