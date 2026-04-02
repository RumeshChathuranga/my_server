import * as fs from "fs/promises";
import * as path from "path";
import { HTTPReq, HTTPRes, BodyReader, HTTPError } from "../shared/http_types";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const READ_CHUNK = 64 * 1024; // 64 KB chunks

// Create a BodyReader that streams a file chunk-by-chunk
function readerFromFile(fp: fs.FileHandle, fileSize: number, offset = 0, length = fileSize - offset): BodyReader {
  let pos = offset;
  const end = offset + length;

  return {
    length,
    read: async (): Promise<Buffer> => {
      if (pos >= end) return Buffer.from("");

      const buf = Buffer.alloc(Math.min(READ_CHUNK, end - pos));
      const result = await fp.read({ buffer: buf, position: pos, length: buf.length });

      if (result.bytesRead === 0) return Buffer.from("");

      pos += result.bytesRead;
      return buf.subarray(0, result.bytesRead);
    },
    close: async (): Promise<void> => {
      await fp.close();
    },
  };
}

// Return a 404 response
function resp404(): HTTPRes {
  return {
    code: 404,
    headers: [Buffer.from("Content-Type: text/html")],
    body: {
      length: 13,
      read: async () => Buffer.from("404 Not Found"),
    },
  };
}

// Guess Content-Type from file extension
function mimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".txt":  "text/plain",
    ".bin":  "application/octet-stream",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
  };
  return types[ext] ?? "application/octet-stream";
}

// Serve a single file from disk.
// Ownership transfer pattern: fp is set to null once transferred to the reader
// so the finally block does not double-close.
export async function serveFile(
  req: HTTPReq,
  uriPath: string,
): Promise<HTTPRes> {

  // Sanitize path to prevent directory traversal
  const safePath = path.join(PUBLIC_DIR, path.normalize("/" + uriPath));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    return resp404();
  }

  let fp: fs.FileHandle | null = null;

  try {
    fp = await fs.open(safePath, "r");
    const stat = await fp.stat();

    if (!stat.isFile()) {
      return resp404();
    }

    const reader = readerFromFile(fp, stat.size);
    fp = null; // ownership transferred — do NOT close in finally

    return {
      code: 200,
      headers: [
        Buffer.from(`Content-Type: ${mimeType(safePath)}`),
      ],
      body: reader,
    };

  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return resp404();
    }
    throw err;
  } finally {
    await fp?.close(); // only runs if ownership was NOT transferred
  }
}