# 🚀 Build Your Own Web Server in Node.js — Beginner's Guide

> **Hey there! 👋** This guide is written specifically for you as a second-year UoM student. We'll go step by step, and I'll explain *why* we do things, not just *what* to do. Take it slow, and don't be afraid if something doesn't click immediately — that's totally normal!

---

## 📋 Table of Contents

1. [What You'll Build](#what-youll-build)
2. [Prerequisites](#prerequisites)
3. [Project Folder Structure](#project-folder-structure)
4. [Setup — Getting Started](#setup--getting-started)
5. [Phase 1 — TCP Echo Server](#phase-1--tcp-echo-server)
6. [Phase 2 — Promise-Based API](#phase-2--promise-based-api)
7. [Phase 3 — Simple Message Protocol](#phase-3--simple-message-protocol)
8. [Phase 4 — Basic HTTP Server](#phase-4--basic-http-server)
9. [Phase 5 — Dynamic Content & Streaming](#phase-5--dynamic-content--streaming)
10. [Phase 6 — File Server](#phase-6--file-server)
11. [Phase 7 — Range Requests](#phase-7--range-requests)
12. [Phase 8 — HTTP Caching](#phase-8--http-caching)
13. [Phase 9 — Compression](#phase-9--compression)
14. [Phase 10 — WebSocket](#phase-10--websocket)
15. [Testing Your Server](#testing-your-server)
16. [Common Mistakes to Avoid](#common-mistakes-to-avoid)
17. [Glossary](#glossary)

---

## What You'll Build

By the end of this guide, you will have built a working HTTP web server **completely from scratch** in Node.js — no frameworks like Express, no libraries. Just you, Node.js, and your brain!

Here's what your finished server will be able to do:

- ✅ Accept connections from clients (like a browser or curl)
- ✅ Parse HTTP requests (GET, POST, HEAD)
- ✅ Send HTTP responses with headers and a body
- ✅ Stream large files without crashing
- ✅ Handle HTTP chunked encoding
- ✅ Serve static files from disk
- ✅ Support range requests (resumable downloads)
- ✅ Cache responses for speed
- ✅ Compress responses with gzip
- ✅ Handle WebSocket connections (real-time bidirectional messaging)

> 💡 **Why bother?** Most developers just use Express or Fastify and never think about what's underneath. Building this yourself means you'll actually *understand* how the internet works. That puts you in the top 5% of developers. Employers love that.

---

## Prerequisites

Before you start, make sure you have these installed:

### Required Tools

| Tool | Why You Need It | Install |
|------|----------------|---------|
| **Node.js** (v18+) | Runs your JavaScript server | [nodejs.org](https://nodejs.org) |
| **npm** | Manages packages | Comes with Node.js |
| **TypeScript** | Adds types to JS (makes debugging easier) | `npm install -g typescript` |
| **ts-node** | Run TypeScript files directly | `npm install -g ts-node` |

### Useful CLI Tools for Testing

| Tool | Why You Need It | Install |
|------|----------------|---------|
| **curl** | Send HTTP requests from terminal | Usually pre-installed on Mac/Linux |
| **socat** | Raw TCP connections for testing | `brew install socat` / `apt install socat` |
| **netcat (nc)** | Another raw TCP tool | Usually pre-installed |

### Check Your Setup

Open a terminal and run these commands:

```bash
node --version       # Should show v18.x.x or higher
npm --version        # Should show 9.x.x or higher
tsc --version        # Should show Version 5.x.x
```

If any of these fail, install the missing tool first before continuing.

---

## Project Folder Structure

Here's the complete folder structure you'll build up over time. Don't create everything at once — we'll add files as we go through each phase.

```
my-web-server/
│
├── src/                          ← All your TypeScript source files
│   ├── 01_tcp/
│   │   └── echo_server.ts        ← Phase 1: Basic TCP echo server
│   │
│   ├── 02_promises/
│   │   └── tcp_conn.ts           ← Phase 2: Promise-based socket wrapper
│   │
│   ├── 03_protocol/
│   │   └── message_server.ts     ← Phase 3: Simple message protocol
│   │
│   ├── 04_http/
│   │   ├── types.ts              ← HTTP types (request, response, body)
│   │   ├── parser.ts             ← HTTP header parser
│   │   ├── writer.ts             ← HTTP response writer
│   │   └── server.ts            ← Basic HTTP server
│   │
│   ├── 05_streaming/
│   │   └── chunked.ts            ← Phase 5: Chunked encoding & generators
│   │
│   ├── 06_files/
│   │   └── file_server.ts        ← Phase 6: Serving static files
│   │
│   ├── 07_range/
│   │   └── range.ts              ← Phase 7: Range requests
│   │
│   ├── 08_cache/
│   │   └── cache.ts              ← Phase 8: HTTP caching headers
│   │
│   ├── 09_compression/
│   │   └── compress.ts           ← Phase 9: Gzip compression
│   │
│   ├── 10_websocket/
│   │   ├── ws_protocol.ts        ← Phase 10: WebSocket framing
│   │   ├── ws_queue.ts           ← Blocking queue implementation
│   │   └── ws_server.ts          ← Full WebSocket server
│   │
│   ├── shared/
│   │   ├── tcp_conn.ts           ← Shared TCP connection helpers
│   │   ├── buffer_utils.ts       ← Dynamic buffer helpers
│   │   └── http_types.ts         ← Shared HTTP types
│   │
│   └── main.ts                   ← The final combined HTTP server entry point
│
├── public/                        ← Static files to serve (for testing)
│   ├── index.html
│   └── big_file.bin              ← Generate this for large file testing
│
├── dist/                          ← Compiled JavaScript (auto-generated, don't edit)
│
├── package.json                   ← Project config & dependencies
├── tsconfig.json                  ← TypeScript compiler config
└── README.md                      ← Your own notes
```

> 💡 **Tip:** The `src/shared/` folder contains code that's reused across phases. As you build each phase, you'll copy the useful bits there.

---

## Setup — Getting Started

Let's create the project from scratch.

### Step 1: Create the Project Folder

```bash
mkdir my-web-server
cd my-web-server
```

### Step 2: Initialize npm

```bash
npm init -y
```

This creates a `package.json`. The `-y` flag just says "yes" to all default questions.

### Step 3: Install TypeScript

```bash
npm install --save-dev typescript @types/node
```

- `typescript` — the TypeScript compiler
- `@types/node` — TypeScript type definitions for Node.js built-ins (like `net`, `fs`, `zlib`)

### Step 4: Create `tsconfig.json`

This file tells TypeScript *how* to compile your code.

```bash
touch tsconfig.json
```

Paste this inside it:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

> 💡 **What does this mean?**
> - `target: ES2022` — compile to modern JavaScript
> - `sourceMap: true` — helps you debug (error messages show the `.ts` file, not the compiled `.js`)
> - `strict: true` — TypeScript will warn you about common mistakes. It feels annoying at first but saves you hours of debugging!

### Step 5: Add Scripts to `package.json`

Open `package.json` and replace the `"scripts"` section with:

```json
"scripts": {
  "build": "tsc",
  "build:watch": "tsc --watch",
  "start": "node --enable-source-maps dist/main.js",
  "dev": "tsc && node --enable-source-maps dist/main.js"
}
```

### Step 6: Create Your Folder Structure

```bash
mkdir -p src/01_tcp
mkdir -p src/02_promises
mkdir -p src/03_protocol
mkdir -p src/04_http
mkdir -p src/05_streaming
mkdir -p src/06_files
mkdir -p src/07_range
mkdir -p src/08_cache
mkdir -p src/09_compression
mkdir -p src/10_websocket
mkdir -p src/shared
mkdir -p public
```

You're all set! Now let's start building.

---

## Phase 1 — TCP Echo Server

> 🎯 **Goal:** Understand sockets. Build a server that just echoes back whatever you send it.

### What's a TCP Server?

Think of TCP like a phone call. Before you can talk, you need to:
1. One person **listens** (the server waits for calls)
2. The other person **dials** (the client connects)
3. Both can now talk back and forth

In Node.js, the `net` module gives you all the tools for this.

### Create `src/01_tcp/echo_server.ts`

```typescript
import * as net from "net";

// This function handles each new connection
function newConn(socket: net.Socket): void {
  console.log("New connection from:", socket.remoteAddress, socket.remotePort);

  // When the client disconnects (sends EOF / FIN packet)
  socket.on("end", () => {
    console.log("Client disconnected.");
  });

  // When data arrives from the client
  socket.on("data", (data: Buffer) => {
    console.log("Received:", data.toString());
    socket.write(data); // echo it back!

    // If the client sends 'q', close the connection
    if (data.includes("q")) {
      console.log("Closing connection.");
      socket.end();
    }
  });

  // Handle errors (e.g., client crashes)
  socket.on("error", (err: Error) => {
    console.error("Socket error:", err.message);
  });
}

// Create a listening socket (like a telephone waiting for calls)
const server = net.createServer();

// Handle server-level errors (e.g., port already in use)
server.on("error", (err: Error) => {
  throw err;
});

// Register the handler for new connections
server.on("connection", newConn);

// Start listening on localhost port 1234
server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Server listening on http://127.0.0.1:1234");
});
```

### Compile and Run

```bash
npm run build
node --enable-source-maps dist/01_tcp/echo_server.js
```

### Test It!

Open a **new terminal** and type:

```bash
socat tcp:127.0.0.1:1234 -
```

Now type anything and press Enter. You should see your text echoed back. Type `q` to close the connection.

> 💡 **What just happened?** Your server is now accepting real TCP connections. This is the foundation of every web server, chat app, and game server you've ever used!

---

## Phase 2 — Promise-Based API

> 🎯 **Goal:** Wrap the callback-based socket API in promises so our code reads top-to-bottom like normal code.

### Why Do We Need This?

The callback style from Phase 1 works, but it breaks up your logic into scattered pieces. Imagine needing to:
1. Read data
2. Process it
3. Read more data
4. Send a response

With callbacks, that's 4 nested functions. With `async/await`, it's just 4 lines that read like a story.

### Create `src/shared/tcp_conn.ts`

This file is the heart of our promise-based TCP wrapper. You'll reuse it in every phase.

```typescript
import * as net from "net";

// Our wrapper around a raw socket
// It lets us use `await` instead of callbacks
export type TCPConn = {
  socket: net.Socket;
  err: null | Error;       // store any error that happened
  ended: boolean;          // has the client disconnected?
  reader: null | {         // the current "waiting read" promise
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

// Initialize a TCPConn from a raw socket
export function soInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket,
    err: null,
    ended: false,
    reader: null,
  };

  // 'data' event fires when bytes arrive from the client
  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader, "Got data but nobody is reading!");
    conn.socket.pause(); // stop receiving until the next read()
    conn.reader!.resolve(data);
    conn.reader = null;
  });

  // 'end' event fires when the client closes their side (sends FIN)
  socket.on("end", () => {
    conn.ended = true;
    if (conn.reader) {
      conn.reader.resolve(Buffer.from("")); // signal EOF with empty buffer
      conn.reader = null;
    }
  });

  // 'error' event fires on any IO error
  socket.on("error", (err: Error) => {
    conn.err = err;
    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });

  return conn;
}

// Read data from the socket — returns a Promise!
// Returns an empty Buffer at EOF (client disconnected)
export function soRead(conn: TCPConn): Promise<Buffer> {
  console.assert(!conn.reader, "Cannot have two concurrent reads!");

  return new Promise((resolve, reject) => {
    // Check for errors/EOF that happened before this read
    if (conn.err) {
      reject(conn.err);
      return;
    }
    if (conn.ended) {
      resolve(Buffer.from("")); // EOF
      return;
    }

    // Save the callbacks — they'll be called by the 'data'/'end'/'error' events
    conn.reader = { resolve, reject };
    conn.socket.resume(); // tell Node.js we're ready for more data
  });
}

// Write data to the socket — also returns a Promise!
export function soWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0, "Cannot write empty data");

  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }

    // socket.write() calls the callback when the data is sent to the OS
    conn.socket.write(data, (err?: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
```

### Create `src/02_promises/echo_server_v2.ts`

Now let's rewrite the echo server using our new wrapper:

```typescript
import * as net from "net";
import { soInit, soRead, soWrite, TCPConn } from "../shared/tcp_conn";

// Handle one connection — using async/await!
async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = soInit(socket);

  while (true) {
    const data = await soRead(conn);

    if (data.length === 0) {
      console.log("Client disconnected.");
      break; // EOF — stop the loop
    }

    console.log("Received:", data.toString());
    await soWrite(conn, data); // echo back
  }
}

// Called for each new connection
async function newConn(socket: net.Socket): Promise<void> {
  console.log("New connection:", socket.remoteAddress);

  try {
    await serveClient(socket);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    socket.destroy(); // always clean up the socket!
  }
}

const server = net.createServer({
  pauseOnConnect: true, // required — so we control when data flows
});

server.on("error", (err: Error) => { throw err; });
server.on("connection", newConn);
server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Server on http://127.0.0.1:1234");
});
```

> 💡 **Notice:** The `serveClient` function reads like a simple while loop! No nested callbacks. That's the beauty of `async/await`.

---

## Phase 3 — Simple Message Protocol

> 🎯 **Goal:** Learn to split a raw TCP byte stream into "messages" separated by `\n`.

### Why Is This Important?

TCP gives you a **stream of bytes** — it has NO concept of messages. If you send `"hello"` and `"world"`, the receiver might get `"helloworld"` as one chunk, or `"hel"` + `"loworld"` in two chunks. You must write code to find where one message ends and the next begins.

### Create `src/shared/buffer_utils.ts`

```typescript
// A buffer that can grow dynamically (like ArrayList in Java)
export type DynBuf = {
  data: Buffer;
  length: number; // how many bytes are actually used
};

// Append new data to the buffer, growing it if needed
export function bufPush(buf: DynBuf, data: Buffer): void {
  const newLen = buf.length + data.length;

  if (buf.data.length < newLen) {
    // Grow by doubling (amortized O(1) — same trick as Java's ArrayList)
    let cap = Math.max(buf.data.length, 32);
    while (cap < newLen) cap *= 2;

    const grown = Buffer.alloc(cap);
    buf.data.copy(grown, 0, 0, buf.length);
    buf.data = grown;
  }

  data.copy(buf.data, buf.length);
  buf.length = newLen;
}

// Remove `len` bytes from the FRONT of the buffer
// (shifts remaining data to position 0)
export function bufPop(buf: DynBuf, len: number): void {
  buf.data.copyWithin(0, len, buf.length); // like memmove in C
  buf.length -= len;
}
```

### Create `src/03_protocol/message_server.ts`

```typescript
import * as net from "net";
import { soInit, soRead, soWrite, TCPConn } from "../shared/tcp_conn";
import { DynBuf, bufPush, bufPop } from "../shared/buffer_utils";

// Try to cut one complete message (\n-terminated) from the buffer.
// Returns null if we don't have a complete message yet.
function cutMessage(buf: DynBuf): null | Buffer {
  // Look for the newline delimiter
  const idx = buf.data.subarray(0, buf.length).indexOf("\n");
  if (idx < 0) return null; // not complete yet

  // Copy out the message (including the \n)
  const msg = Buffer.from(buf.data.subarray(0, idx + 1));
  bufPop(buf, idx + 1); // remove it from the buffer
  return msg;
}

async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = soInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // Try to get a complete message from what's already buffered
    const msg = cutMessage(buf);

    if (!msg) {
      // Don't have a full message yet — read more data from the socket
      const data = await soRead(conn);

      if (data.length === 0) {
        // EOF
        if (buf.length > 0) {
          console.error("Unexpected EOF — incomplete message!");
        }
        return;
      }

      bufPush(buf, data);
      continue; // go back and try cutMessage() again
    }

    // We have a complete message! Process it.
    const text = msg.toString().trim();
    console.log("Message:", text);

    if (text === "quit") {
      await soWrite(conn, Buffer.from("Bye.\n"));
      socket.destroy();
      return;
    } else {
      await soWrite(conn, Buffer.from(`Echo: ${text}\n`));
    }
  }
}

async function newConn(socket: net.Socket): Promise<void> {
  try {
    await serveClient(socket);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    socket.destroy();
  }
}

const server = net.createServer({ pauseOnConnect: true });
server.on("error", (err) => { throw err; });
server.on("connection", newConn);
server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Message server on http://127.0.0.1:1234");
});
```

### Test It

```bash
# Send two messages at once (pipelining test!)
echo -e 'hello\nworld\nquit\n' | socat tcp:127.0.0.1:1234 -
```

---

## Phase 4 — Basic HTTP Server

> 🎯 **Goal:** Parse real HTTP requests and send real HTTP responses!

### Create `src/shared/http_types.ts`

```typescript
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
```

### Key Files to Create for Phase 4

For this phase you'll need these source files (each listed with its job):

**`src/04_http/parser.ts`** — reads the raw bytes and extracts the method, URI, version, and headers.

Key logic:
- Find `\r\n\r\n` in the buffer (that's where the header ends)
- Split into lines by `\r\n`
- First line: `METHOD URI VERSION`
- Remaining lines: `HeaderName: HeaderValue`
- Enforce a max header size (e.g. 8KB) to prevent memory attacks

**`src/04_http/writer.ts`** — encodes an `HTTPRes` back into bytes and sends it.

Key logic:
- Write status line: `HTTP/1.1 200 OK\r\n`
- Write each header: `Name: Value\r\n`
- Write empty line: `\r\n`
- Then write the body

**`src/04_http/server.ts`** — the main server loop.

Key logic (in order):
1. Read data → try to parse HTTP header
2. Construct `BodyReader` from the request (using `Content-Length`)
3. Call your request handler
4. Write the response
5. If HTTP/1.1, loop for the next request (connection reuse!)

> 💡 **The most important concept here:** HTTP/1.1 lets you send multiple requests on one connection! Your server loop must keep looping instead of closing after each request.

### Test Phase 4

```bash
curl -v http://127.0.0.1:1234/
curl -v -X POST --data "hello world" http://127.0.0.1:1234/echo
```

---

## Phase 5 — Dynamic Content & Streaming

> 🎯 **Goal:** Send responses where the total length isn't known upfront (chunked encoding). Use JS generators as producers.

### How Chunked Encoding Works

Instead of `Content-Length: 1234`, the server uses `Transfer-Encoding: chunked`.

Each "chunk" looks like this on the wire:

```
4\r\n        ← chunk size in hex (4 bytes)
HTTP\r\n     ← the actual data
6\r\n
server\r\n
0\r\n        ← zero-length chunk = end of stream
\r\n
```

### Using Generators as Response Producers

JS generators are perfect for this. They can `yield` data piece by piece:

```typescript
// A sample streaming response — counts sheep every second
async function* countSheep() {
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // wait 1s
    yield Buffer.from(`Sheep ${i}\n`);
  }
}

// Convert generator to BodyReader
function readerFromGenerator(gen: AsyncGenerator<Buffer>): BodyReader {
  return {
    length: -1, // unknown length → must use chunked encoding
    read: async () => {
      const r = await gen.next();
      return r.done ? Buffer.from("") : r.value;
    },
  };
}
```

### Update `writeHTTPResp` to Handle Chunked

When `body.length === -1`, send `Transfer-Encoding: chunked` instead of `Content-Length`:

```typescript
// Format one chunk: hex size + CRLF + data + CRLF
function encodeChunk(data: Buffer): Buffer {
  const size = Buffer.from(data.length.toString(16) + "\r\n");
  const crlf = Buffer.from("\r\n");
  return Buffer.concat([size, data, crlf]);
}
```

### Test Phase 5

```bash
# Visit /sheep — you should see numbers appear one per second
curl -N http://127.0.0.1:1234/sheep
```

---

## Phase 6 — File Server

> 🎯 **Goal:** Serve files from your disk. Learn proper resource management (always close files!).

### The Key Rule: Always Close Files

Disk files are like sockets — they're **OS resources** and must be closed when you're done. Use `try-finally` to guarantee this:

```typescript
import * as fs from "fs/promises";

async function serveStaticFile(path: string): Promise<HTTPRes> {
  let fp: fs.FileHandle | null = null;

  try {
    fp = await fs.open(path, "r"); // open in read-only mode
    const stat = await fp.stat();

    if (!stat.isFile()) {
      return resp404(); // it's a directory or something weird
    }

    const reader = readerFromStaticFile(fp, stat.size);
    fp = null; // ← transfer ownership to reader (so finally block skips close)
    return { code: 200, headers: [], body: reader };

  } catch (err) {
    console.info("Cannot serve file:", err);
    return resp404();
  } finally {
    await fp?.close(); // runs even on error — fp is null if ownership was transferred
  }
}
```

> 💡 **The `fp = null` trick:** After creating the reader (which will close the file later), we set `fp` to null. This way, the `finally` block won't double-close the file. This is called **ownership transfer**.

### Add Close to BodyReader

Update `BodyReader` type to include an optional `close` function:

```typescript
export type BodyReader = {
  length: number;
  read: () => Promise<Buffer>;
  close?: () => Promise<void>; // ← new!
};
```

And always call it after the response is sent:

```typescript
try {
  await writeHTTPResp(conn, res);
} finally {
  await res.body.close?.(); // close file if applicable
}
```

### Test Phase 6

```bash
# Create a test file
echo "Hello from a file!" > public/hello.txt

# Fetch it via your server
curl http://127.0.0.1:1234/files/hello.txt

# Test with a large file
dd if=/dev/urandom of=public/bigfile.bin bs=1M count=100
curl http://127.0.0.1:1234/files/bigfile.bin | sha256sum
```

---

## Phase 7 — Range Requests

> 🎯 **Goal:** Allow clients to request only part of a file (used for resumable downloads and video seeking).

### How Range Requests Work

The client sends: `Range: bytes=100-199`

The server responds with status `206 Partial Content` and:
- `Content-Range: bytes 100-199/5000` (the effective range + total size)
- `Content-Length: 100`
- Just those 100 bytes

### Implementing It

```typescript
function parseRange(header: string, fileSize: number): [number, number] | null {
  // Parse "bytes=start-end" format
  const match = header.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;

  let start = match[1] ? parseInt(match[1]) : fileSize - parseInt(match[2]);
  let end = match[2] ? parseInt(match[2]) + 1 : fileSize;

  // Clamp to file size
  start = Math.max(0, start);
  end = Math.min(fileSize, end);

  if (start >= end) return null; // invalid range

  return [start, end];
}
```

Use the `position` argument in `fp.read()` to read from a specific byte offset:

```typescript
const r = await fp.read({ buffer: buf, position: offset, length: maxread });
```

### Test Phase 7

```bash
# Fetch bytes 0 to 9 (first 10 bytes)
curl -v -H "Range: bytes=0-9" http://127.0.0.1:1234/files/hello.txt

# Fetch the last 5 bytes
curl -v -H "Range: bytes=-5" http://127.0.0.1:1234/files/hello.txt
```

---

## Phase 8 — HTTP Caching

> 🎯 **Goal:** Let clients reuse cached responses when files haven't changed.

### How It Works

**First request:**
- Server sends: `Last-Modified: Tue, 17 Feb 2026 10:00:00 GMT`
- Client caches this

**Second request (client revalidates):**
- Client sends: `If-Modified-Since: Tue, 17 Feb 2026 10:00:00 GMT`
- Server checks: Has the file changed?
  - **No** → respond with `304 Not Modified` (no body! saves bandwidth)
  - **Yes** → respond normally with the new file

### Implementing It

```typescript
const stat = await fp.stat();
const lastModified = stat.mtime.toUTCString();
const ts = Math.floor(stat.mtime.getTime() / 1000);

// Always include this header so clients know the file modification time
res.headers.push(Buffer.from(`Last-Modified: ${lastModified}`));

// Check if client already has the latest version
const ifModifiedSince = fieldGet(req.headers, "If-Modified-Since");
if (ifModifiedSince) {
  const clientTs = new Date(ifModifiedSince.toString()).getTime() / 1000;
  if (clientTs >= ts) {
    // Client already has the latest version!
    return { code: 304, headers: res.headers, body: emptyBody() };
  }
}
```

### Test Phase 8

```bash
# First request (gets file + Last-Modified header)
curl -v http://127.0.0.1:1234/files/hello.txt

# Second request with If-Modified-Since (should get 304)
curl -v -H "If-Modified-Since: $(date -u +%a,\ %d\ %b\ %Y\ %T\ GMT)" \
  http://127.0.0.1:1234/files/hello.txt
```

---

## Phase 9 — Compression

> 🎯 **Goal:** Compress responses with gzip to save bandwidth.

### How Negotiation Works

```
Client sends:  Accept-Encoding: gzip, deflate
Server checks: Does it support gzip? Yes!
Server sends:  Content-Encoding: gzip
               (+ compressed body)
```

### Using Node.js Streams + Pipes

Node.js has a `zlib` module with `createGzip()`, which is a `Transform` stream (reads uncompressed, outputs compressed). Use `pipeline()` to connect everything:

```typescript
import * as zlib from "zlib";
import { pipeline } from "stream/promises";
import * as stream from "stream";

function gzipFilter(reader: BodyReader): BodyReader {
  const gz = zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH });
  const input = body2stream(reader); // convert BodyReader to Readable

  // Pipe in background — don't await here!
  pipeline(input, gz).catch((err) => gz.destroy(err));

  // Read compressed output using the iterator API
  const iter = gz.iterator();
  return {
    length: -1, // compressed size is unknown upfront
    read: async () => {
      const r = await iter.next();
      return r.done ? Buffer.from("") : (r.value as Buffer);
    },
    close: reader.close,
  };
}
```

### Test Phase 9

```bash
# --compressed tells curl to request and auto-decompress gzip
curl -v --compressed http://127.0.0.1:1234/

# Verify the response is actually compressed
curl -v -H "Accept-Encoding: gzip" http://127.0.0.1:1234/ | hexdump | head
```

---

## Phase 10 — WebSocket

> 🎯 **Goal:** Add real-time, bidirectional, message-based communication.

### The WebSocket Handshake

WebSocket starts as a normal HTTP request:

**Client sends:**
```
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
```

**Server responds with:**
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After this, the HTTP protocol is over — the raw TCP connection is now a WebSocket.

### The WebSocket Frame Format

```
Byte 0:  [FIN bit][3 reserved bits][4-bit opcode]
Byte 1:  [MASK bit][7-bit payload length]
Bytes 2-9: Extended payload length (if needed)
Bytes 4+:  Masking key (4 bytes, if MASK=1)
Then:    Payload data
```

### Compute the Accept Key

```typescript
import * as crypto from "crypto";

function wsKeyAccept(key: Buffer): string {
  return crypto
    .createHash("sha1")
    .update(key)
    .update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11") // magic constant from RFC 6455
    .digest("base64");
}
```

### The Blocking Queue (Concurrency Tool)

WebSocket needs to support concurrent sending from multiple tasks. We use a **blocking queue** — like a conveyor belt where producers put messages and a single consumer sends them in order:

```typescript
// Create a multi-producer, multi-consumer queue
export function createQueue<T>(): Queue<T> {
  type Taker = (item: T | null) => void;
  type Giver = (take: Taker) => void;

  const producers: { give: Giver; reject: (e: Error) => void }[] = [];
  const consumers: Taker[] = [];
  let closed = false;

  return {
    pushBack: (item: T): Promise<void> => {
      if (closed) return Promise.reject(new Error("Queue closed"));

      return new Promise<void>((done, reject) => {
        const give: Giver = (take) => { take(item); done(); };
        if (consumers.length) {
          give(consumers.shift()!);
        } else {
          producers.push({ give, reject });
        }
      });
    },

    popFront: (): Promise<T | null> => {
      if (closed) return Promise.resolve(null);

      return new Promise<T | null>((take) => {
        if (producers.length) {
          producers.shift()!.give(take as Taker);
        } else {
          consumers.push(take as Taker);
        }
      });
    },

    close: (): void => {
      closed = true;
      producers.forEach((p) => p.reject(new Error("Queue closed")));
      consumers.forEach((c) => c(null));
      producers.length = 0;
      consumers.length = 0;
    },
  };
}
```

### Test Phase 10

Open your browser console (F12) and run:

```javascript
const ws = new WebSocket("ws://127.0.0.1:1234/ws");
ws.onmessage = (e) => console.log("Got:", e.data);
ws.onopen = () => ws.send("Hello from browser!");
```

---

## Testing Your Server

### Tools Summary

| Tool | Purpose | Example |
|------|---------|---------|
| `curl` | HTTP requests | `curl -v http://localhost:1234/` |
| `curl --compressed` | Test gzip | `curl --compressed http://localhost:1234/` |
| `socat` | Raw TCP (testing protocols manually) | `socat tcp:localhost:1234 -` |
| `tcpdump` | See raw packets | `tcpdump -X -i lo port 1234` |
| Browser DevTools | WebSocket, inspect headers | F12 → Network tab |
| Wireshark | GUI packet analysis | Open pcap files from tcpdump |

### Quick Test Script

Save this as `test.sh`:

```bash
#!/bin/bash
BASE="http://127.0.0.1:1234"

echo "=== Test 1: Basic GET ==="
curl -s $BASE/

echo ""
echo "=== Test 2: POST echo ==="
curl -s -X POST --data-binary "hello world" $BASE/echo

echo ""
echo "=== Test 3: File serving ==="
echo "Test file content" > public/test.txt
curl -s $BASE/files/test.txt

echo ""
echo "=== Test 4: Gzip compression ==="
curl -s --compressed -v $BASE/ 2>&1 | grep "Content-Encoding"

echo ""
echo "=== Test 5: Range request ==="
curl -s -H "Range: bytes=0-4" $BASE/files/test.txt

echo ""
echo "All tests done!"
```

---

## Common Mistakes to Avoid

Here are the mistakes that almost every beginner makes. Learn from them now!

### 1. 🚫 Treating TCP Like It Has Message Boundaries

```typescript
// ❌ WRONG — one socket read does NOT equal one message
socket.on("data", (data) => {
  processMessage(data); // This is WRONG! data might be half a message
});

// ✅ CORRECT — buffer until you have a complete message
socket.on("data", (data) => {
  bufPush(buf, data);
  let msg;
  while ((msg = cutMessage(buf)) !== null) {
    processMessage(msg);
  }
});
```

### 2. 🚫 Not Closing Files

```typescript
// ❌ WRONG — file never closes if an error happens!
const fp = await fs.open(path, "r");
const data = await fp.read(); // what if this throws?
await fp.close();

// ✅ CORRECT — try-finally guarantees cleanup
const fp = await fs.open(path, "r");
try {
  const data = await fp.read();
  // ... use data
} finally {
  await fp.close(); // ALWAYS runs, even on error
}
```

### 3. 🚫 Forgetting to Consume the Request Body

```typescript
// ❌ WRONG — if you ignore the body, the next request parse will fail!
async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  return { code: 200, headers: [], body: someResponse() };
  // body is never consumed!
}

// ✅ CORRECT — always drain the body after handling
const res = await handleReq(msg, reqBody);
await writeHTTPResp(conn, res);
while ((await reqBody.read()).length > 0) { /* drain */ }
```

### 4. 🚫 Not Handling Concurrent Writes in WebSocket

```typescript
// ❌ WRONG — two tasks writing at same time = corrupted frames!
async function taskA() { await ws.writeFrame(msg1); }
async function taskB() { await ws.writeFrame(msg2); }

// ✅ CORRECT — use a queue so only one writer at a time
async function taskA() { await sendQueue.pushBack(msg1); }
async function taskB() { await sendQueue.pushBack(msg2); }
// A single consumer task drains the queue and writes to socket
```

### 5. 🚫 Synchronous File IO in a Server

```typescript
// ❌ WRONG — this BLOCKS the entire server for all connections!
const data = fs.readFileSync("bigfile.bin");

// ✅ CORRECT — always use the async version
const data = await fs.promises.readFile("bigfile.bin");
```

---

## Glossary

| Term | What it means (simply!) |
|------|------------------------|
| **TCP** | The "phone call" layer — gives you a reliable byte stream |
| **HTTP** | The "language" your browser speaks to servers |
| **Socket** | A handle to a network connection (like a file handle but for the network) |
| **Buffer** | A fixed-size chunk of raw bytes |
| **DynBuf** | Our custom growing buffer (like ArrayList for bytes) |
| **Promise** | A placeholder for a value that will arrive in the future |
| **async/await** | Syntax sugar for promises — makes async code look synchronous |
| **EOF** | End Of File — signals the other side stopped sending data |
| **Chunked encoding** | A way to send HTTP bodies when you don't know the total size |
| **Generator** | A function that can `yield` multiple values over time |
| **Backpressure** | Slowing down the producer when the consumer is too slow |
| **WebSocket** | A bidirectional, message-based protocol built on top of HTTP |
| **Blocking Queue** | A thread-safe queue where consumers wait (block) when it's empty |
| **Race condition** | When two tasks interfere with each other in unexpected ways |
| **FIN** | TCP's way of saying "I'm done sending" (like hanging up half the call) |
| **CRLF** | `\r\n` — the line ending used in HTTP (Carriage Return + Line Feed) |
| **ETag** | A version tag for a resource, used for cache validation |
| **Range request** | Asking for only a portion of a file |
| **Content-Length** | Header that tells the receiver exactly how many bytes are coming |
| **Status code** | A 3-digit number in HTTP responses: 200=OK, 404=Not Found, etc. |

---

## 🎉 You Did It!

If you've made it through all 10 phases, you've built something that most developers have never done. You now understand:

- How TCP byte streams work (and why they're NOT packets)
- How HTTP actually parses and responds
- How chunked encoding enables streaming
- How to manage OS resources without leaks
- How caching and compression actually work
- How WebSocket upgrades from HTTP and uses frames
- How to deal with concurrency without race conditions

These are **industry-level concepts** that will make you stand out whether you're going into backend development, systems programming, or even just want to deeply understand the web.

**Good luck! You've got this. 💪**

---

*Guide written for University of Manchester Year 2 students.*
*Based on "Build Your Own Web Server From Scratch in Node.JS" by James Smith.*
