import * as net from "net";

export type TCPConn = {
  socket: net.Socket;
  err: null | Error; 
  ended: boolean; 
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

// Initialize a TCPConn
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
