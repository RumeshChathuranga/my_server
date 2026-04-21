import * as zlib from "zlib";
import { pipeline } from "stream/promises";
import * as stream from "stream";
import { BodyReader } from "../shared/http_types";
import { fieldGet } from "../http/parser";
import { HTTPReq } from "../shared/http_types";

// Check if the client accepts gzip encoding
export function clientAcceptsGzip(req: HTTPReq): boolean {
  const accept = fieldGet(req.headers, "Accept-Encoding");
  if (!accept) return false;
  return accept.toString().split(",").some((enc) => enc.trim().startsWith("gzip"));
}

// Wrap a BodyReader with a gzip Transform stream.
// The resulting BodyReader has length = -1 (chunked).
export function gzipBody(reader: BodyReader): BodyReader {
  const gz = zlib.createGzip({
    flush: zlib.constants.Z_SYNC_FLUSH, // flush after each chunk
  });

  // Convert BodyReader to a Node.js Readable stream
  const input = new stream.Readable({
    read() {}, // we push manually
  });

  // Pump data from BodyReader into the Readable
  (async () => {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.length === 0) {
          input.push(null); // EOF
          break;
        }
        input.push(chunk);
      }
    } catch (err) {
      input.destroy(err as Error);
    }
  })();

  // Pipe: Readable → gzip Transform
  pipeline(input, gz).catch((err) => gz.destroy(err));

  // Read compressed output via async iterator
  const iter = gz[Symbol.asyncIterator]();

  return {
    length: -1, // chunked
    read: async (): Promise<Buffer> => {
      const result = await iter.next();
      if (result.done) return Buffer.from("");
      return result.value as Buffer;
    },
    close: reader.close,
  };
}