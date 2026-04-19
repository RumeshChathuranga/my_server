import * as fs from "fs/promises";
import * as path from "path";
import { HTTPReq, HTTPRes } from "../shared/http_types";
import { fieldGet } from "../http/parser";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const READ_CHUNK = 64 * 1024;

export async function serveFileWithCache(
  req: HTTPReq,
  uriPath: string,
): Promise<HTTPRes> {
  const safePath = path.join(PUBLIC_DIR, path.normalize("/" + uriPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    return notFound();
  }

  let fp: fs.FileHandle | null = null;

  try {
    fp = await fs.open(safePath, "r");
    const stat = await fp.stat();

    if (!stat.isFile()) return notFound();

    const lastModified = stat.mtime.toUTCString();
    const mtime = Math.floor(stat.mtime.getTime() / 1000);
    const fileSize = stat.size;

    const commonHeaders = [
      Buffer.from(`Last-Modified: ${lastModified}`),
      Buffer.from("Accept-Ranges: bytes"),
    ];

    // Check If-Modified-Since — if the client already has the latest, send 304
    const ifModifiedSince = fieldGet(req.headers, "If-Modified-Since");
    if (ifModifiedSince) {
      const clientMtime = Math.floor(
        new Date(ifModifiedSince.toString()).getTime() / 1000,
      );
      if (clientMtime >= mtime) {
        await fp.close();
        fp = null;
        return {
          code: 304,
          headers: commonHeaders,
          body: { length: 0, read: async () => Buffer.from("") },
        };
      }
    }

    // Range support
    const rangeHeader = fieldGet(req.headers, "Range");
    let start = 0;
    let end = fileSize;
    let code = 200;
    const extraHeaders: Buffer[] = [];

    if (rangeHeader) {
      const parsed = parseRange(rangeHeader.toString(), fileSize);
      if (parsed) {
        [start, end] = parsed;
        code = 206;
        extraHeaders.push(
          Buffer.from(`Content-Range: bytes ${start}-${end - 1}/${fileSize}`),
        );
      }
    }

    const length = end - start;
    let pos = start;

    if (!fp) throw new Error("File handle missing");
    const fileHandle = fp;
    fp = null; // ownership transferred

    const reader = {
      length,
      read: async (): Promise<Buffer> => {
        if (pos >= end) return Buffer.from("");
        const buf = Buffer.alloc(Math.min(READ_CHUNK, end - pos));
        const r = await fileHandle.read({
          buffer: buf,
          position: pos,
          length: buf.length,
        });
        if (r.bytesRead === 0) return Buffer.from("");
        pos += r.bytesRead;
        return buf.subarray(0, r.bytesRead);
      },
      close: async () => {
        await fileHandle.close();
      },
    };

    return {
      code,
      headers: [...commonHeaders, ...extraHeaders],
      body: reader,
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return notFound();
    throw err;
  } finally {
    await fp?.close();
  }
}

function notFound(): HTTPRes {
  return {
    code: 404,
    headers: [],
    body: { length: 0, read: async () => Buffer.from("") },
  };
}

function parseRange(header: string, size: number): [number, number] | null {
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;

  let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
  let end = m[2] && m[1] ? parseInt(m[2], 10) + 1 : size;

  start = Math.max(0, start);
  end = Math.min(size, end);

  return start < end ? [start, end] : null;
}
