import { HTTPRes } from "../shared/http_types";
import { soWrite, TCPConn } from "../shared/tcp_conn";
import { fieldGet } from "./parser";

const kStatusText: Record<number, string> = {
  200: "OK",
  400: "Bad Request",
  404: "Not Found",
  413: "Payload Too Large",
  500: "Internal Server Error",
  501: "Not Implemented",
};

export function encodeHTTPResp(resp: HTTPRes): Buffer {
  const reason = kStatusText[resp.code] ?? "OK";
  const chunks: Buffer[] = [];

  chunks.push(Buffer.from(`HTTP/1.1 ${resp.code} ${reason}\r\n`));
  for (const header of resp.headers) {
    chunks.push(header);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from("\r\n"));

  return Buffer.concat(chunks);
}

export async function writeHTTPResp(conn: TCPConn, resp: HTTPRes): Promise<void> {
  if (resp.body.length < 0) {
    throw new Error("chunked encoding not supported");
  }

  if (!fieldGet(resp.headers, "Content-Length")) {
    resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));
  }

  const header = encodeHTTPResp(resp);
  if (header.length > 0) {
    await soWrite(conn, header);
  }

  while (true) {
    const data = await resp.body.read();
    if (data.length === 0) {
      break;
    }
    await soWrite(conn, data);
  }

  if (resp.body.close) {
    await resp.body.close();
  }
}
