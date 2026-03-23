import { TCPConn, soWrite } from "../shared/tcp_conn";
import { HTTPRes, BodyReader } from "../shared/http_types";

// Encode one HTTP chunk: hex-size CRLF data CRLF
function encodeChunk(data: Buffer): Buffer {
  const sizeLine = Buffer.from(data.length.toString(16) + "\r\n");
  const crlf     = Buffer.from("\r\n");
  return Buffer.concat([sizeLine, data, crlf]);
}

// Write a complete HTTP response (status line + headers + body) to the socket.
export async function writeHTTPResp(conn: TCPConn, res: HTTPRes): Promise<void> {
  // Determine transfer mode
  const isChunked = res.body.length < 0;

  // --- Status line ---
  const statusMessages: Record<number, string> = {
    200: "OK",
    206: "Partial Content",
    304: "Not Modified",
    400: "Bad Request",
    404: "Not Found",
    405: "Method Not Allowed",
    413: "Payload Too Large",
    431: "Request Header Fields Too Large",
    500: "Internal Server Error",
    505: "HTTP Version Not Supported",
    101: "Switching Protocols",
  };

  const statusText = statusMessages[res.code] ?? "Unknown";
  const statusLine = Buffer.from(`HTTP/1.1 ${res.code} ${statusText}\r\n`);
  await soWrite(conn, statusLine);

  // --- Headers ---
  // Add Content-Length or Transfer-Encoding
  const extraHeaders: Buffer[] = [];

  if (isChunked) {
    extraHeaders.push(Buffer.from("Transfer-Encoding: chunked"));
  } else {
    extraHeaders.push(Buffer.from(`Content-Length: ${res.body.length}`));
  }

  for (const hdr of [...res.headers, ...extraHeaders]) {
    await soWrite(conn, Buffer.concat([hdr, Buffer.from("\r\n")]));
  }

  // Blank line separating headers from body
  await soWrite(conn, Buffer.from("\r\n"));

  // --- Body ---
  while (true) {
    const data = await res.body.read();

    if (data.length === 0) {
      // EOF
      if (isChunked) {
        // Terminating zero-length chunk
        await soWrite(conn, Buffer.from("0\r\n\r\n"));
      }
      break;
    }

    if (isChunked) {
      await soWrite(conn, encodeChunk(data));
    } else {
      await soWrite(conn, data);
    }
  }
}