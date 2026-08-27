import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

/**
 * The service side of the channel, small enough to be obviously correct and
 * dependency-free on purpose: a fake that reached for a WebSocket library would
 * be proving that library's handshake rather than the one this host performs.
 *
 * It exists for `velar/desktop-test.serveService`, and it is a *real* server —
 * a real listener on a real loopback port, a real RFC 6455 upgrade, real frames
 * over real TCP — because a fake channel that never opened a socket could not
 * tell a test that the host's token actually gates anything.
 *
 * Text frames only, which is the whole of the Desktop service channel.
 */

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAXIMUM_FRAME_BYTES = 8 * 1024 * 1024;

export interface LoopbackServiceServer {
  readonly port: number;
  readonly token: string;
  /** The next message a connected client sent, in arrival order. */
  readonly accept: () => Promise<LoopbackServiceRequest | null>;
  readonly close: () => Promise<void>;
  /** Handshakes this server refused, so a test can prove the token gates the channel. */
  readonly rejectedHandshakes: () => number;
}

export interface LoopbackServiceRequest {
  readonly message: string;
  readonly reply: (message: string) => void;
}

export interface LoopbackServiceOptions {
  /** The token the host will present. A connection that opens with any other value is closed. */
  readonly token?: string;
}

export async function startLoopbackServiceServer(options: LoopbackServiceOptions = {}): Promise<LoopbackServiceServer> {
  const token = options.token ?? randomBytes(16).toString("hex");
  const queue: LoopbackServiceRequest[] = [];
  const waiting: ((request: LoopbackServiceRequest | null) => void)[] = [];
  const sockets = new Set<Duplex>();
  let rejected = 0;
  let closed = false;

  const publish = (request: LoopbackServiceRequest): void => {
    const next = waiting.shift();
    if (next) next(request);
    else queue.push(request);
  };

  const server: Server = createServer((_request, response) => {
    response.writeHead(426).end();
  });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${createHash("sha1").update(key + WEBSOCKET_GUID).digest("base64")}`,
      "\r\n",
    ].join("\r\n"));
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    // The first frame on every connection is the host's hello, and nothing else
    // is read from a connection that does not carry the right token.
    let authenticated = false;
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const frame = readFrame(buffer);
        if (frame === null) return;
        buffer = buffer.subarray(frame.consumed);
        if (frame.opcode === 0x8) {
          socket.end();
          return;
        }
        if (frame.opcode !== 0x1) continue;
        if (!authenticated) {
          let hello: unknown;
          try { hello = JSON.parse(frame.payload.toString("utf8")); }
          catch { hello = null; }
          const accepted = !!hello && typeof hello === "object"
            && (hello as Record<string, unknown>).velar === "service-hello"
            && (hello as Record<string, unknown>).token === token;
          if (!accepted) {
            rejected += 1;
            socket.end();
            return;
          }
          authenticated = true;
          socket.write(encodeFrame(JSON.stringify({ velar: "service-ready" })));
          continue;
        }
        publish({
          message: frame.payload.toString("utf8"),
          reply: (message: string) => {
            if (!socket.destroyed) socket.write(encodeFrame(message));
          },
        });
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The loopback service server did not report a port");

  return Object.freeze({
    port: address.port,
    token,
    async accept() {
      if (closed) return null;
      const queued = queue.shift();
      if (queued) return queued;
      return new Promise<LoopbackServiceRequest | null>((resolve) => waiting.push(resolve));
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const resolve of waiting.splice(0)) resolve(null);
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    rejectedHandshakes() { return rejected; },
  });
}

interface DecodedFrame {
  readonly opcode: number;
  readonly payload: Buffer;
  readonly consumed: number;
}

/** One client frame, masked as RFC 6455 requires of a client. */
function readFrame(buffer: Buffer): DecodedFrame | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0]! & 0x0f;
  const masked = (buffer[1]! & 0x80) !== 0;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const large = buffer.readBigUInt64BE(offset);
    if (large > BigInt(MAXIMUM_FRAME_BYTES)) throw new Error("Loopback service frame exceeds its bound");
    length = Number(large);
    offset += 8;
  }
  if (length > MAXIMUM_FRAME_BYTES) throw new Error("Loopback service frame exceeds its bound");
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
  return { opcode, payload, consumed: offset + length };
}

/** One unmasked server frame, as RFC 6455 requires of a server. */
function encodeFrame(message: string): Buffer {
  const payload = Buffer.from(message, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}
