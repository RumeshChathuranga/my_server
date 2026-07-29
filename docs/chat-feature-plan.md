# Streaming LLM chat over the hand-built WebSocket — implementation plan

## Context

`my_server` is a from-scratch HTTP/1.1 + WebSocket server on raw TCP sockets, with zero production dependencies. This plan adds a `/chat` WebSocket route that proxies to the Anthropic Messages API and streams tokens back as they arrive, **reusing the existing `ws_queue` send queue and frame encoder** — no new transport code.

The value is precise: most "AI integrations" call `fetch()` and `await response.json()`. This pipes a live token stream through infrastructure this project already owns, and adds a **third framing problem** — SSE `\n\n`-delimited events — alongside the two already solved here: HTTP (`\r\n\r\n` + `Content-Length`) and WebSocket (length-prefix header). Same `DynBuf`, same "return `null` when incomplete" parser contract.

### Decisions

| Decision | Choice | Why |
|---|---|---|
| API client | **Raw `fetch` + hand-parsed SSE** | Keeps zero production deps (the project's defining constraint). Third framing problem is the payoff. `@anthropic-ai/sdk` is ESM-only vs this CommonJS build anyway. |
| No API key | **Mock streaming mode** | Demo works offline, CI tests the full `/chat` path with no key, no credits burned. Exercises the identical frame-producing path. |
| Routing | `/` and `/ws` stay **echo**; `/chat` is the LLM route | Non-destructive — the echo handler is referenced throughout the project's notes. |
| Browser UI | New `public/chat.html`, **not** `index.html` | [`test.sh`](../test.sh) lines 83-100 have fixture create/assert logic around `public/index.html`; leave it alone. |
| Model | `claude-opus-5`, streaming, `effort: "low"` | Latency matters for a token-streaming demo. Thinking stays **on** (the default on Opus 5) — disabling it on this model risks `<thinking>` tags leaking into visible output. |

### Constraints discovered during exploration

1. **The WS upgrade path ignores `req.uri` entirely.** [`main.ts`](../src/main.ts) lines 174-179 check only the `Upgrade` / `Connection` / `Sec-WebSocket-Key` headers. Every upgrade — to any path — gets the echo handler. Both HTML clients connect to `/ws` and "work" only because the path is never consulted. **`/chat` requires new URI discrimination.**
2. **`ws_queue` is an unbuffered rendezvous channel (capacity 0).** [`ws_queue.ts`](../src/websocket/ws_queue.ts) `pushBack` does not resolve until a consumer takes the item. If the reader loop `await`s `sendFrame` for every LLM token, **the reader stalls for the whole response** and cannot process PING or CLOSE mid-stream. The producer must be a **detached task**.
3. **`close()` rejects pending producers** ([`ws_queue.ts`](../src/websocket/ws_queue.ts) line 48). An in-flight producer awaiting `pushBack` when the client disconnects gets a rejected promise that becomes an **unhandled rejection** unless caught.
4. Node **v25.2.1** — global `fetch` present, `response.body` is async-iterable (`for await` works directly), `Readable.fromWeb` available but unnecessary.
5. [`tsconfig.json`](../tsconfig.json) is **CommonJS** with `"lib": ["ES2022"]` and no DOM — `@types/node` v25 supplies the `fetch` / `Response` / `ReadableStream` types. `strict: true`, so `res.body` (typed `ReadableStream<Uint8Array> | null`) needs a null check. **No top-level await.**
6. `.env` is gitignored; **`.env.example` is not matched by any pattern** — committable as-is, no negation needed.
7. `npm test` runs `tsx --test 'src/**/*.test.ts'`; `tsconfig` excludes `**/*.test.ts` from the build. [`test.sh`](../test.sh) runs against compiled `dist/`, so a build must precede it.
8. **`ws_queue.ts` has zero tests** despite being the concurrency primitive this feature depends on.

---

## How to use this list

One task at a time. Each is self-contained, leaves the repo building and green, and ends in its own commit — preserving the layer-by-layer git history.

Run after every task:

```bash
npm test && npm run build && ./test.sh
```

---

## Task 1 — Config + secrets scaffolding

**Goal:** somewhere to put the API key, documented, never committed.

- Create `.env.example` with `ANTHROPIC_API_KEY=` and a comment noting that leaving it blank enables mock mode.
- Add `src/chat/config.ts` exporting `ANTHROPIC_API_KEY` (`process.env.ANTHROPIC_API_KEY ?? null`), `CHAT_MODEL = "claude-opus-5"`, `CHAT_MAX_TOKENS = 4096`, and `MOCK_MODE` (`ANTHROPIC_API_KEY === null`).
- Follow the existing config idiom in [`main.ts`](../src/main.ts) lines 15-16 — module-level `const` reading `process.env`, no dotenv dependency.
- `.gitignore` already covers `.env` (line 12). **Do not** add a `!.env.example` negation; it isn't needed.

**Acceptance:** `npm run build` passes. `git status` shows `.env.example` as untracked-and-addable, and a hand-created `.env` as ignored.

**Commit:** `feat: add chat config and .env.example scaffolding`

---

## Task 2 — SSE event parser (pure function + unit tests) ⭐

**Goal:** frame a raw byte stream into SSE events, reusing `DynBuf` and the parser contract already used twice in this codebase.

Create `src/chat/sse.ts`:

```ts
export type SSEEvent = { event: string | null; data: string };

// Returns null when the buffer does not yet hold a complete event.
export function cutSSEEvent(buf: DynBuf): SSEEvent | null;
```

- Import `DynBuf`, `bufPush`, `bufPop` from [`../shared/buffer_utils`](../src/shared/buffer_utils.ts). **Do not write a new buffer type** — the point is that one `DynBuf` serves HTTP, WebSocket and SSE.
- An event terminates at `\n\n`. Parse the block into `event:` and `data:` lines; strip one leading space after each colon (per the SSE spec). Multiple `data:` lines join with `\n`. Ignore comment lines starting with `:` (the API sends these as keepalives).
- `bufPop` the consumed bytes, exactly as `parseHTTPReq` and `wsDecodeFrame` do.
- Return `null` on an incomplete buffer — never throw, never block.

Write `src/chat/sse.test.ts` (`node:test` + `node:assert/strict`, matching the four existing test files):

- single complete event → parsed correctly
- **event split across two `bufPush` calls** → `null` first, then parsed (the framing test that matters)
- **two events in one chunk** → two successive calls both return, buffer empty after
- multi-line `data:` joins with `\n`
- comment/keepalive line skipped
- `data:` with no `event:` → `event` is `null`
- empty buffer → `null`

**Acceptance:** `npm test` shows the new tests passing alongside the existing 26.

**Commit:** `feat: add SSE event framing on the shared dynamic buffer`

---

## Task 3 — Anthropic streaming client (async generator + mock mode)

**Goal:** an async generator of text deltas. No WebSocket knowledge in this file.

Create `src/chat/anthropic.ts`:

```ts
export async function* streamChat(userMessage: string): AsyncGenerator<string>;
```

**Mock path** (when `MOCK_MODE`): yield a canned sentence word-by-word with `await sleep(40)` between words. Make it self-describing, e.g. `"[mock mode] No ANTHROPIC_API_KEY set, so this reply is generated locally — but it streams through the exact same WebSocket frame path as a real response."` Return early; never touch the network.

**Real path:**

- `POST https://api.anthropic.com/v1/messages`
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- Body: `{ model: CHAT_MODEL, max_tokens: CHAT_MAX_TOKENS, stream: true, output_config: { effort: "low" }, messages: [{ role: "user", content: userMessage }] }`
- **`max_tokens` is deliberately capped at 4096** for cost control — note this in a comment so it doesn't read as an accident.
- Check `res.ok` first; on non-2xx read the body text and `throw new Error(...)` with the status and message.
- **`res.body` is `ReadableStream<Uint8Array> | null` under `strict`** — null-check before iterating.
- `for await (const chunk of res.body)` → `bufPush` into a `DynBuf` → drain with `cutSSEEvent` in an inner `while` loop, matching the reader-loop shape in [`ws_server.ts`](../src/websocket/ws_server.ts) line 83.
- Per event, `JSON.parse(data)` and switch on the parsed `type`:
  - `content_block_delta` with `delta.type === "text_delta"` → `yield delta.text`
  - `content_block_delta` with `delta.type === "thinking_delta"` → **ignore** (thinking is on by default on Opus 5; `display` defaults to `"omitted"` so the text is empty, but the events still arrive)
  - `error` → throw with the error message
  - everything else (`message_start`, `content_block_start`, `ping`, `message_delta`, `message_stop`) → ignore
- Guard `JSON.parse` in a try/catch so one malformed frame doesn't kill the stream.

**Acceptance:** `npm run build` passes. Sanity-check the mock path standalone:

```bash
npx tsx -e "import('./src/chat/anthropic').then(async m => { for await (const t of m.streamChat('hi')) process.stdout.write(t) })"
```

**Commit:** `feat: add streaming Anthropic client with offline mock mode`

---

## Task 4 — WebSocket route discrimination

**Goal:** make the upgrade path aware of `req.uri` without breaking the existing echo demo.

In [`src/main.ts`](../src/main.ts), replace the block at lines 174-179:

```ts
if (isWebSocketUpgrade(req)) {
  await wsHandshake(conn, req);
  const wsUri = req.uri.toString().split("?")[0];
  if (wsUri === "/chat") {
    await wsServeChat(conn);
  } else {
    await wsServeConnection(conn);   // "/" and "/ws" keep the echo behaviour
  }
  return;
}
```

- Split on `?` so `/chat?foo=1` still routes correctly (the HTTP router has the same gap — noted, out of scope here).
- **Unknown paths keep falling through to echo**, matching today's behaviour. Do not start rejecting them; that would break `public/index.html` and `src/websocket/wc_test.html`.
- Update the startup banner (`main.ts` line 271) to list `WS /chat` alongside the existing `WS /` line.
- Mirror the change in [`src/http/server.ts`](../src/http/server.ts) **only if** it already imports the ws handlers — otherwise leave that file alone (known-duplicate standalone entry point, tracked as a separate cleanup item).

**Acceptance:** `npm run build && ./test.sh` green. Open `public/index.html` against the running server and confirm the console still logs `Server says: Echo: Hello WebSocket!`.

**Commit:** `feat: route WebSocket upgrades by URI path`

---

## Task 5 — The `/chat` WebSocket handler ⭐

**Goal:** wire the token generator to the frame writer without stalling the reader.

Create `src/chat/ws_chat.ts` exporting `wsServeChat(conn: TCPConn): Promise<void>`.

Start from `wsServeConnection` in [`ws_server.ts`](../src/websocket/ws_server.ts) lines 52-127 — keep the writer task, the `DynBuf` reader loop, the frame-decode drain loop, and the PING/PONG and CLOSE branches **verbatim**. Replace only the TEXT/BINARY branch.

**Three things that will bite if you get them wrong:**

1. **Do not `await` the token producer inside the reader loop.** `ws_queue` is an unbuffered rendezvous channel — awaiting it means the reader blocks for the entire LLM response and cannot answer a PING or a CLOSE. Kick the producer off as a detached task and keep reading:

   ```ts
   let active: Promise<void> | null = null;

   case WS_OPCODE_TEXT: {
     const prompt = frame.payload.toString();
     active = (async () => {
       try {
         for await (const token of streamChat(prompt)) {
           await sendFrame({ fin: true, opcode: WS_OPCODE_TEXT, payload: Buffer.from(token) });
         }
         await sendFrame({ fin: true, opcode: WS_OPCODE_TEXT, payload: Buffer.from("[done]") });
       } catch (err) {
         // Queue closed = client disconnected mid-stream. Expected, not an error.
         if (!/closed/i.test(String(err))) {
           await sendFrame({ fin: true, opcode: WS_OPCODE_TEXT,
                             payload: Buffer.from(`[error] ${err}`) }).catch(() => {});
         }
       }
     })();
     break;
   }
   ```

2. **Catch the producer's rejection.** `sendQueue.close()` *rejects* every pending producer ([`ws_queue.ts`](../src/websocket/ws_queue.ts) line 48). A client that closes the tab mid-response leaves the producer awaiting `pushBack`, and without the `try/catch` that becomes an unhandled rejection that can take the process down.

3. **`await active` in the `finally` before returning**, wrapped in `.catch(() => {})`, so the connection doesn't return while a producer is still touching a closed queue.

Send a `[done]` sentinel frame after the stream ends so the browser knows to re-enable its input.

**Acceptance:** `npm run build` passes. With no `.env`, run the server and drive it from a browser console:

```js
const ws = new WebSocket("ws://127.0.0.1:1234/chat");
ws.onmessage = e => console.log(e.data);
ws.onopen = () => ws.send("hello");
```

Mock tokens must arrive **one message at a time with visible delay**, not as one blob. Then send a second prompt and close the tab mid-stream: the server must not log an unhandled rejection.

**Commit:** `feat: stream LLM tokens over the WebSocket send queue`

---

## Task 6 — Browser chat UI

**Goal:** a demo that runs in 30 seconds on a shared screen.

Create `public/chat.html`:

- `new WebSocket(\`ws://${location.host}/chat\`)` — **derive the host**, do not hardcode `127.0.0.1:1234`. `test.sh` scans ports 1234-1300, and the existing `index.html` has exactly this hardcoding bug.
- Message list + text input + send button. Append each incoming frame's text to the current assistant bubble so tokens visibly accumulate.
- On `[done]`, close the bubble and re-enable the input.
- On `[error] ...`, render it visibly rather than swallowing it.
- Minimal inline CSS — no external fonts or CDNs (the server has no internet dependency and shouldn't gain one).
- Reachable at `/files/chat.html` via the existing static route.

**Acceptance:** `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:1234/files/chat.html` → 200. In a browser, typing a message streams a reply token-by-token.

**Commit:** `feat: add browser chat UI for the /chat WebSocket route`

---

## Task 7 — Unit tests for `ws_queue`

**Goal:** close the biggest untested gap — the concurrency primitive this feature rests on.

Create `src/websocket/ws_queue.test.ts`:

- `pushBack` then `popFront` → item round-trips
- `popFront` **before** `pushBack` (consumer parks first) → resolves when the item arrives
- `pushBack` **before** `popFront` (producer parks first) → resolves when the consumer arrives
- FIFO order across three items
- `close()` → a waiting `popFront` resolves `null`
- `close()` → a waiting `pushBack` **rejects** (the exact behaviour Task 5 defends against)
- `pushBack` after `close()` → rejects immediately
- `popFront` after `close()` → resolves `null` immediately

**Acceptance:** `npm test` green.

**Commit:** `test: add unit tests for the WebSocket send queue`

---

## Task 8 — Integration test for `/chat` in `test.sh`

**Goal:** prove the route end-to-end in CI, with no API key and no network.

- CI has no `ANTHROPIC_API_KEY`, so the server runs in mock mode automatically — the full handshake → stream → `[done]` path is exercised for free.
- `curl` cannot speak WebSocket frames. Write the client as a small Node script driven by `npx tsx`, or add `src/chat/ws_smoke.ts` invoked with `node dist/...` after the build. It should connect to `/chat`, send one prompt, collect frames until `[done]`, assert **more than one frame arrived** (the proof it streamed rather than buffered), and exit non-zero on failure.
- Follow the existing [`test.sh`](../test.sh) conventions: `pass` / `fail` / `assert_eq` helpers, and register any temp file with the `cleanup` EXIT trap.
- Add it as "Test 8" after the 404 test.

**Acceptance:** `./test.sh` shows 8 test groups passing with no `.env` present.

**Commit:** `test: add /chat streaming integration test`

---

## Task 9 — Documentation

- [`README.md`](../README.md): document the `/chat` route, `ANTHROPIC_API_KEY`, the mock-mode fallback, and `/files/chat.html`.
- [`Dockerfile`](../Dockerfile): no change needed — `ANTHROPIC_API_KEY` is passed at `docker run -e`, never baked into the image. **Add a comment saying so**, because a reviewer will look for it.
- Project notes: add a `chat/` module section. The line that lands — *"My WebSocket send queue doesn't care what's producing frames — I proved that by pointing it at an LLM token stream instead of an echo handler. Same queue, same frame encoder, different producer."*
- Extend the framing notes: **three** protocols now share `DynBuf` and the return-`null`-when-incomplete contract — HTTP (`\r\n\r\n` + `Content-Length`), WebSocket (length-prefix), SSE (`\n\n`).

**Commit:** `docs: document the /chat streaming route`

---

## Known gaps — deliberate scope cuts, not oversights

- **No conversation history.** Each message is a fresh single-turn request. Multi-turn needs a per-connection `messages[]` array and a context-window budget.
- **No rate limiting or auth on `/chat`.** Anyone who can open a WebSocket can spend API credits. Real fix: a token bucket keyed by IP plus a per-connection cap.
- **`/chat` ignores backpressure toward the API.** If the client stops reading, the rendezvous queue blocks the producer — correct behaviour here, but it means an abandoned connection holds an in-flight API request until the socket times out (30s, from the timeout work already landed).
- **Mock mode is detected by a missing key, not an explicit flag.** A typo'd env var silently yields mock replies. An explicit `CHAT_MODE=mock|live` would be less surprising.
