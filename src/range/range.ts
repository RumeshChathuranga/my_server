import * as fs from "fs/promises";
import * as path from "path";
import { fieldGet } from "../http/parser";
import { HTTPReq, HTTPRes } from "../shared/http_types";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const READ_CHUNK = 64 * 1024;

// Parse "bytes=start-end" header value.
// Returns [start, end] as byte offsets where end is exclusive.
// Returns null if the header is absent or malformed.
function parseRangeHeader(header: string, fileSize: number): [number, number] | null {
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  let start: number;
  let end: number;

  if (match[1] === "" && match[2] !== "") {
    // Suffix range: "bytes=-500" means last 500 bytes
    const suffix = parseInt(match[2], 10);
    start = Math.max(0, fileSize - suffix);
    end = fileSize;
  } else if (match[1] !== "" && match[2] === "") {
    // Open-ended: "bytes=500-" means from 500 to end
    start = parseInt(match[1], 10);
    end = fileSize;
  } else if (match[1] !== "" && match[2] !== "") {
    start = parseInt(match[1], 10);
    end = parseInt(match[2], 10) + 1; // HTTP Range is inclusive, convert to exclusive
  } else {
    return null; // "bytes=-" is invalid
  }

  start = Math.max(0, start);
  end   = Math.min(fileSize, end);

  if (start >= end) return null; // empty or inverted range

  return [start, end];
}

// Handle a file request that may include a Range header.
export async function serveFileWithRange(req: HTTPReq, uriPath: string): Promise<HTTPRes> {
  const safePath = path.join(PUBLIC_DIR, path.normalize("/" + uriPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    return { code: 404, headers: [], body: { length: 0, read: async () => Buffer.from("") } };
  }

  let fp: fs.FileHandle | null = null;

  try {
    fp = await fs.open(safePath, "r");
    const stat = await fp.stat();

    if (!stat.isFile()) {
      return { code: 404, headers: [], body: { length: 0, read: async () => Buffer.from("") } };
    }

    const fileSize = stat.size;
    const rangeHeader = fieldGet(req.headers, "Range");

    // No Range header — fall back to a normal full-file response
    if (!rangeHeader) {
      const readerFull = makeFileReader(fp, fileSize, 0, fileSize);
      fp = null;
      return {
        code: 200,
        headers: [
          Buffer.from("Accept-Ranges: bytes"),
          Buffer.from(`Content-Length: ${fileSize}`),
        ],
        body: readerFull,
      };
    }

    const range = parseRangeHeader(rangeHeader.toString(), fileSize);

    if (!range) {
      // Invalid range
      return {
        code: 416,
        headers: [Buffer.from(`Content-Range: bytes */${fileSize}`)],
        body: { length: 0, read: async () => Buffer.from("") },
      };
    }

    const [start, end] = range;
    const length = end - start;

    const reader = makeFileReader(fp, fileSize, start, end);
    fp = null;

    return {
      code: 206,
      headers: [
        Buffer.from(`Content-Range: bytes ${start}-${end - 1}/${fileSize}`),
        Buffer.from(`Content-Length: ${length}`),
        Buffer.from("Accept-Ranges: bytes"),
      ],
      body: reader,
    };

  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { code: 404, headers: [], body: { length: 0, read: async () => Buffer.from("") } };
    }
    throw err;
  } finally {
    await fp?.close();
  }
}

function makeFileReader(fp: fs.FileHandle, _fileSize: number, start: number, end: number) {
  let pos = start;
  return {
    length: end - start,
    read: async (): Promise<Buffer> => {
      if (pos >= end) return Buffer.from("");
      const buf = Buffer.alloc(Math.min(READ_CHUNK, end - pos));
      const r = await fp.read({ buffer: buf, position: pos, length: buf.length });
      if (r.bytesRead === 0) return Buffer.from("");
      pos += r.bytesRead;
      return buf.subarray(0, r.bytesRead);
    },
    close: async () => { await fp.close(); },
  };
}