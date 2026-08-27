// A product service process, as a fixture: a real dependency-free WebSocket
// server that answers the two frames the host sends, plus four behaviours a
// packaging test needs to be able to ask for.
//
// It writes one line per start into `${FIXTURE_SERVICE_LOG_DIR}/<service>.log`,
// named after the directory it was started in. The log is how a test counts
// restarts and sees whether a handshake was accepted or refused, without the
// host having to report either.
//
//   answer   — serve, accept the host's token, echo; exit on SIGTERM
//   exit     — record the start and exit, so the restart policy has something
//              to do
//   silent   — listen and never answer the hello, so readiness times out
//   stubborn — serve and accept, but ignore SIGTERM, so the SIGKILL deadline
//              has something to kill

import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { basename } from "node:path";

const mode = process.env.FIXTURE_SERVICE_MODE ?? "answer";
const logDirectory = process.env.FIXTURE_SERVICE_LOG_DIR;
// A packaged payload lands at `Contents/Resources/services/<name>/`, and a
// development payload is the project directory the manifest named, which this
// fixture spells `service-<name>`. Both reduce to the service's own name.
const name = basename(process.cwd()).replace(/^service-/u, "");
const record = (line) => {
  if (logDirectory) appendFileSync(`${logDirectory}/${name}.log`, `${line}\n`);
};

record(`start ${mode} ${process.pid}`);
if (mode === "exit") process.exit(1);

const endpoint = process.env.VELAR_SERVICE_ENDPOINT;
const token = process.env.VELAR_SERVICE_TOKEN;
if (!endpoint || !token || token.length !== 32) {
  record("environment missing");
  process.exit(1);
}
const [host, port] = endpoint.split(":");

const server = createServer((_request, response) => response.writeHead(426).end());
server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") return socket.destroy();
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64")}`,
    "\r\n",
  ].join("\r\n"));
  let buffer = Buffer.alloc(0);
  let authenticated = false;
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const frame = readFrame(buffer);
      if (!frame) return;
      buffer = buffer.subarray(frame.consumed);
      if (frame.opcode === 0x8) return socket.end();
      if (frame.opcode !== 0x1) continue;
      const text = frame.payload.toString("utf8");
      if (!authenticated) {
        let hello = null;
        try { hello = JSON.parse(text); } catch { hello = null; }
        if (!hello || hello.velar !== "service-hello" || hello.token !== token) {
          record("hello refused");
          return socket.end();
        }
        record("hello accepted");
        // `silent` accepts the token and answers nothing, which is a service
        // that is running and never becomes ready.
        if (mode === "silent") return;
        authenticated = true;
        socket.write(encodeFrame(JSON.stringify({ velar: "service-ready" })));
        continue;
      }
      socket.write(encodeFrame(`echo ${text}`));
    }
  });
});

if (mode !== "stubborn") process.on("SIGTERM", () => { record("terminated"); server.close(() => process.exit(0)); });
else process.on("SIGTERM", () => record("ignored SIGTERM"));

server.listen(Number(port), host, () => record(`listening ${port}`));

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    length = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode, payload, consumed: offset + length };
}

function encodeFrame(message) {
  const payload = Buffer.from(message, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}
