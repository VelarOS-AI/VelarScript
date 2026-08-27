// The tour's service process — the product's own code, in the product's own
// language, under the product's own policy. The language started it, gave it an
// endpoint and a token, and will converge it when the application quits; what
// runs inside it is none of the language's business, which is why this file is
// plain JavaScript with no dependencies rather than anything VelarScript owns.
//
// It answers the two frames `packages/desktop/README.md` pins:
//
//   host    -> {"velar":"service-hello","token":"<32 hex characters>"}
//   service -> {"velar":"service-ready"}
//
// and then whatever the product decided its own channel carries. Here that is
// one line of text in and one line of text out.
//
// A connection that opens with any other token is closed with 1008 and without
// an answer. The endpoint is loopback, and every process on the machine can
// reach loopback, so the token is the whole of this channel's authentication.
//
// The host opens a connection this way for its readiness probe too, and that
// probe is indistinguishable from an application `connect()`. A service will see
// connections come and go that no window asked for, so nothing here treats a
// closed authenticated connection as an application-level event.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const endpoint = process.env.VELAR_SERVICE_ENDPOINT;
const token = process.env.VELAR_SERVICE_TOKEN;
// The third standard variable: the application's own data directory, which the
// host has already created and which is the same path
// `velar/desktop.appDataDirectory()` answers in the renderer. It is given rather
// than derived because it is this application's identity resolved against this
// machine — a payload cannot carry it, and a service that recomputed it would be
// keeping a second copy of a rule only the host can be right about.
const appData = process.env.VELAR_SERVICE_APP_DATA;
if (!endpoint || !token || !appData) {
  process.stderr.write("This service is started by the VelarScript Desktop host, which supplies VELAR_SERVICE_ENDPOINT, VELAR_SERVICE_TOKEN and VELAR_SERVICE_APP_DATA\n");
  process.exit(1);
}
const [host, port] = endpoint.split(":");

// The product's own state, and the product's own file format in the product's
// own data directory. A service exists to hold something a renderer should not:
// here, an index that would be expensive to rebuild on every window, and that
// therefore has to outlive the process holding it.
const store = join(appData, "notes-index.json");
const notes = new Map(load());

function load() {
  try { return Object.entries(JSON.parse(readFileSync(store, "utf8"))); }
  catch { return []; }
}

function save() {
  writeFileSync(store, JSON.stringify(Object.fromEntries(notes)), "utf8");
}

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
        if (!hello || hello.velar !== "service-hello" || hello.token !== token) return socket.end(encodeCloseFrame(1008));
        authenticated = true;
        socket.write(encodeFrame(JSON.stringify({ velar: "service-ready" })));
        continue;
      }
      socket.write(encodeFrame(answer(text)));
    }
  });
});

/** The product's protocol: `put <id> <title>`, `get <id>`, or `count`. */
function answer(request) {
  const [command, id, ...rest] = request.split(" ");
  if (command === "put" && id) {
    notes.set(id, rest.join(" "));
    save();
    return `stored ${id}`;
  }
  if (command === "get" && id) return notes.get(id) ?? "";
  if (command === "count") return String(notes.size);
  return "unknown request";
}

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

/** The refusal the host reads: a close frame whose status code is 1008. */
function encodeCloseFrame(code) {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
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

// The host sends SIGTERM and waits thirty seconds before SIGKILL, so a service
// with state to flush has a window to flush it in. This one has none, so it
// closes its listener and lets the process end.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
server.listen(Number(port), host);
