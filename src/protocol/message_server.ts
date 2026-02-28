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