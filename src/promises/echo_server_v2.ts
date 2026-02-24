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
