import { BodyReader } from "../shared/http_types";

// Wrap an async generator as a BodyReader with chunked transfer encoding.
// Use this when you don't know the total body size upfront.
export function readerFromGenerator(gen: AsyncGenerator<Buffer>): BodyReader {
  return {
    length: -1, // -1 signals chunked encoding to writeHTTPResp()
    read: async (): Promise<Buffer> => {
      const result = await gen.next();
      return result.done ? Buffer.from("") : result.value;
    },
  };
}

// Example generator: counts sheep every second
export async function* sheepGenerator(): AsyncGenerator<Buffer> {
  for (let i = 1; i <= 10; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    yield Buffer.from(`Sheep #${i} 🐑\n`);
  }
}