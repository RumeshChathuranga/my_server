import * as net from "net";

function newConn(socket: net.Socket) {
  console.log(
    "New connection from " + socket.remoteAddress + ":" + socket.remotePort,
  );

  socket.on("end", () => {
    //FIN recieved. The connectoin will be closed automatically
    console.log(
      "EOF received. Closing connection with " +
        socket.remoteAddress +
        ":" +
        socket.remotePort,
    );
  });

  socket.on("data", (data: Buffer) => {
    console.log("data:", data);
    socket.write(data); // echo back the data to the client

    //actively closed the connectoin if the data contains 'q'
    if (data.includes("q")) {
      console.log("closing...");
      socket.end(); // this will send FIN and close the connectoin
    }
  });
}

let server = net.createServer();
server.on("error", (err: Error) => {
  throw err;
});
server.on("connection", newConn);
server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Server listening on http://127.0.0.1:1234");
});
