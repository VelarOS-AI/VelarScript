/**
 * D115 P4 R4c — the JSON-RPC framing the server speaks over stdio.
 *
 * Reading a message, bounding it, and writing one back live here; what a
 * message means lives in the capability modules. `listenToTransport` is the
 * stdin loop `runLanguageServer` used to hold inline.
 */
import { hostErrorMessage } from "../host-error.ts";
import { oversizedDiagnosticsFallback } from "./diagnostics.ts";

const MAX_LSP_MESSAGE_BYTES = 16 * 1024 * 1024;

export type RespondFn = (id: RpcMessage["id"], result: unknown) => void;
export type RespondErrorFn = (id: RpcMessage["id"], message: string, code?: number) => void;

/** What the framing loop reads and writes on the session. */
export interface TransportSession {
  buffer: Buffer;
  queue: Promise<void>;
  readonly pendingRequests: Set<string>;
  readonly cancelledRequests: Set<string>;
  readonly send: (message: unknown) => void;
  readonly respondError: RespondErrorFn;
  readonly finish: () => void;
}

export function send(message: unknown): void {
  const json = JSON.stringify(message);
  if (Buffer.byteLength(json, "utf8") <= MAX_LSP_MESSAGE_BYTES) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
    return;
  }
  const value = message as Record<string, unknown>;
  const fallback = value.id !== undefined
    ? { jsonrpc: "2.0", id: value.id ?? null, error: { code: -32603, message: "VelarScript LSP response exceeds the 16 MiB transport limit" } }
    : value.method === "textDocument/publishDiagnostics"
      ? oversizedDiagnosticsFallback(value.params)
      : null;
  if (!fallback) return;
  const fallbackJson = JSON.stringify(fallback);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(fallbackJson, "utf8")}\r\n\r\n${fallbackJson}`);
}

export function listenToTransport(session: TransportSession, handle: (message: RpcMessage) => Promise<void>): void {
  process.stdin.on("data", (chunk: Buffer) => {
    session.buffer = Buffer.concat([session.buffer, chunk]);
    while (true) {
      const boundary = session.buffer.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const header = session.buffer.subarray(0, boundary).toString("ascii");
      const length = /(?:^|\r\n)Content-Length:\s*(\d+)/iu.exec(header);
      if (!length) {
        session.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "LSP message is missing a valid Content-Length header" } });
        process.exitCode = 1;
        process.stdin.pause();
        session.finish();
        break;
      }
      const size = Number(length[1]);
      if (!Number.isSafeInteger(size) || size > MAX_LSP_MESSAGE_BYTES) {
        session.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "LSP message exceeds the 16 MiB transport limit" } });
        process.exitCode = 1;
        process.stdin.pause();
        session.finish();
        break;
      }
      const end = boundary + 4 + size;
      if (session.buffer.length < end) break;
      const body = session.buffer.subarray(boundary + 4, end).toString("utf8");
      session.buffer = session.buffer.subarray(end);
      let parsed: unknown;
      try { parsed = JSON.parse(body); }
      catch {
        session.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON in LSP message" } });
        continue;
      }
      if (!isRpcMessage(parsed)) {
        session.send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid LSP request" } });
        continue;
      }
      const message = parsed;
      if (message.method === "$/cancelRequest") {
        const cancelId = (message.params as { readonly id?: unknown } | undefined)?.id;
        if (cancelId === null || typeof cancelId === "string" || (typeof cancelId === "number" && Number.isFinite(cancelId))) {
          const key = requestKey(cancelId);
          if (session.pendingRequests.has(key)) session.cancelledRequests.add(key);
        }
      } else if (message.id !== undefined) {
        session.pendingRequests.add(requestKey(message.id));
      }
      session.queue = session.queue.then(() => handle(message)).catch((error) => {
        if (message.id !== undefined) session.respondError(message.id, hostErrorMessage(error), -32603);
      });
    }
  });
}

export interface RpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
}

export function requestKey(id: number | string | null): string {
  return `${typeof id}:${String(id)}`;
}

export function isRpcMessage(value: unknown): value is RpcMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return false;
  return message.id === undefined || message.id === null || typeof message.id === "string"
    || (typeof message.id === "number" && Number.isFinite(message.id));
}

export async function mapBounded<T, R>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
