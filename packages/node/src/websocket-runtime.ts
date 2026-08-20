export const VELAR_NODE_WEBSOCKET_RUNTIME = String.raw`
import __VelarWebSocket, { WebSocketServer as __VelarWebSocketServer } from "ws";
import { createServer as __velarCreateHttpServer } from "node:http";
import { createReadStream as __velarServeCreateReadStream } from "node:fs";
import { readFile as __velarServeReadFile, realpath as __velarServeRealpath, stat as __velarServeStat } from "node:fs/promises";
import { extname as __velarServeExtname, isAbsolute as __velarServeIsAbsolute, relative as __velarServeRelative, resolve as __velarServeResolve } from "node:path";
import { brotliCompress as __velarServeBrotliNode, gzip as __velarServeGzipNode } from "node:zlib";
import { promisify as __velarServePromisify } from "node:util";
import { ServeRequest as __velarServeRuntime, ServeApp as __velarServeApp } from "velar/serve";

const __velarWebSocketConnections = new WeakMap();
const __velarWebSocketServers = new WeakMap();
const __velarWsPromise = globalThis.Promise;
const __velarWsPromiseAll = __velarWsPromise.all.bind(__velarWsPromise);
const __velarWsReflectApply = globalThis.Reflect.apply;
const __velarWsFinalizationRegistry = globalThis.FinalizationRegistry;
const __velarWsFinalizerRegister = __velarWsFinalizationRegistry.prototype.register;
const __velarWsSetTimeout = globalThis.setTimeout;
const __velarWsClearTimeout = globalThis.clearTimeout;
const __velarServeGzip = __velarServePromisify(__velarServeGzipNode);
const __velarServeBrotli = __velarServePromisify(__velarServeBrotliNode);
const __velarWsAggregateByteLimit = 128 * 1024 * 1024;
const __velarWsAggregateQueuedMessageLimit = 65536;
const __velarWsAggregatePendingSendLimit = 8192;
const __velarWsActiveConnectionLimit = 4096;
const __velarWsPendingConnectionLimit = 4096;
let __velarWsAggregateBytes = 0;
let __velarWsAggregateQueuedMessages = 0;
let __velarWsAggregatePendingSends = 0;
let __velarWsActiveConnections = 0;
let __velarWsPendingConnections = 0;
let __velarWsActiveHttpSockets = 0;
const __velarServeNativeOperations = Object.freeze({readFile: __velarServeReadFile, createReadStream: __velarServeCreateReadStream, realpath: __velarServeRealpath, stat: __velarServeStat, extname: __velarServeExtname, isAbsolute: __velarServeIsAbsolute, relative: __velarServeRelative, resolve: __velarServeResolve, compress: (encoding, value) => encoding === "br" ? __velarServeBrotli(value) : __velarServeGzip(value)});
function __velarWsInteger(value, fallback, minimum, maximum, name) { if (value === undefined || value === null) return fallback; if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(name + " must be an integer from " + minimum + " through " + maximum); return value; }
function __velarWsDuration(value, fallback) { if (value === undefined || value === null) return fallback; if (typeof value !== "string") throw new TypeError("WebSocket timeout must be Duration"); const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(value); if (!match) throw new TypeError("WebSocket timeout must be Duration such as 5s"); const result = Number(match[1]) * (match[2] === "s" ? 1000 : 1); if (!Number.isFinite(result) || result < 0 || result > 2147483647) throw new RangeError("WebSocket timeout is outside the supported range"); return result; }
function __velarWsOptions(options = {}) { if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("WebSocket options must be a record"); return { maxMessageBytes: __velarWsInteger(options.maxMessageBytes, 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "maxMessageBytes"), maxQueuedMessages: __velarWsInteger(options.maxQueuedMessages, 256, 1, 10000, "maxQueuedMessages"), maxQueuedBytes: __velarWsInteger(options.maxQueuedBytes, 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "maxQueuedBytes"), maxPendingSendBytes: __velarWsInteger(options.maxPendingSendBytes, 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "maxPendingSendBytes") }; }
function __velarWsBytes(value) { if (value instanceof Uint8Array) { const output = new Uint8Array(value.byteLength); output.set(value); return output; } return null; }
function __velarWsMessageBytes(value) { if (typeof value === "string") return Buffer.byteLength(value, "utf8"); if (value instanceof Uint8Array) return value.byteLength; throw new TypeError("WebSocket.send requires text or Bytes"); }
function __velarWsReserve(size) { if (!Number.isSafeInteger(size) || size < 0 || __velarWsAggregateBytes + size > __velarWsAggregateByteLimit) return false; __velarWsAggregateBytes += size; return true; }
function __velarWsRelease(size) { __velarWsAggregateBytes -= size; if (__velarWsAggregateBytes < 0) __velarWsAggregateBytes = 0; }
function __velarWsReserveQueue(size) { if (__velarWsAggregateQueuedMessages >= __velarWsAggregateQueuedMessageLimit || !__velarWsReserve(size)) return false; __velarWsAggregateQueuedMessages += 1; return true; }
function __velarWsReleaseQueue(size, count = 1) { __velarWsRelease(size); __velarWsAggregateQueuedMessages -= count; if (__velarWsAggregateQueuedMessages < 0) __velarWsAggregateQueuedMessages = 0; }
function __velarWsReserveSend(size) { if (__velarWsAggregatePendingSends >= __velarWsAggregatePendingSendLimit || !__velarWsReserve(size)) return false; __velarWsAggregatePendingSends += 1; return true; }
function __velarWsReleaseSend(size) { __velarWsRelease(size); __velarWsAggregatePendingSends -= 1; if (__velarWsAggregatePendingSends < 0) __velarWsAggregatePendingSends = 0; }
function __velarWsReleaseActive(state) { if (!state.active) return; state.active = false; __velarWsActiveConnections -= 1; if (__velarWsActiveConnections < 0) __velarWsActiveConnections = 0; }
function __velarWsDiscardQueue(state) { if (state.queueReleased) return; state.queueReleased = true; __velarWsReleaseQueue(state.queuedBytes, state.queue.length); state.queue.length = 0; state.queuedBytes = 0; }
export class WebSocketBackpressureError extends Error { constructor(message = "WebSocket backpressure limit exceeded") { super(message); this.name = "WebSocketBackpressureError"; } }
export class WebSocketClosedError extends Error { constructor(message = "WebSocket is closed") { super(message); this.name = "WebSocketClosedError"; } }
export class WebSocketProtocolError extends Error { constructor(message = "WebSocket protocol error") { super(message); this.name = "WebSocketProtocolError"; } }
export class WebSocketTimeoutError extends Error { constructor(message = "WebSocket timed out") { super(message); this.name = "WebSocketTimeoutError"; } }
function __velarWsReleasePendingSends(state) { for (const complete of state.pendingSends) complete(new Error("WebSocket is closed")); state.pendingSends.clear(); }
const __velarWsFinalizer = new __velarWsFinalizationRegistry(state => { __velarWsAbort(state); try { state.socket.terminate(); } catch {} });
function __velarWsFinish(state) { if (state.finished) return; state.finished = true; __velarWsReleaseActive(state); if (state.queue.length === 0) __velarWsDiscardQueue(state); __velarWsReleasePendingSends(state); if (state.waiter) { const waiter = state.waiter; state.waiter = null; waiter.resolve(null); } }
function __velarWsAbort(state) { state.finished = true; __velarWsReleaseActive(state); __velarWsDiscardQueue(state); __velarWsReleasePendingSends(state); if (state.waiter) { const waiter = state.waiter; state.waiter = null; waiter.resolve(null); } }
function __velarWsRejectReceive(state, socket, code, reason) { __velarWsAbort(state); socket.close(code, reason); }
function __velarWsReceive(state, socket, data, binary) {
  if (state.finished) return;
  let source = null; let message = null; let size;
  if (binary) { source = data instanceof Uint8Array ? data : new Uint8Array(data); size = source.byteLength; }
  else { message = typeof data === "string" ? data : data.toString("utf8"); size = Buffer.byteLength(message, "utf8"); }
  if (size > state.options.maxMessageBytes) { __velarWsRejectReceive(state, socket, 1009, "Message too large"); return; }
  if (state.waiter) { if (source) { message = new Uint8Array(size); message.set(source); } const waiter = state.waiter; state.waiter = null; waiter.resolve(message); return; }
  if (state.queue.length >= state.options.maxQueuedMessages || state.queuedBytes + size > state.options.maxQueuedBytes || !__velarWsReserveQueue(size)) { __velarWsRejectReceive(state, socket, 1009, "Unread message queue full"); return; }
  try { if (source) { message = new Uint8Array(size); message.set(source); } state.queue.push(message); state.queuedBytes += size; }
  catch (error) { __velarWsReleaseQueue(size); throw error; }
}
function __velarWsWrap(socket, options) {
  __velarWsActiveConnections += 1;
  const value = Object.create(__velarWsConnectionPrototype); const state = { socket, options, queue: [], queuedBytes: 0, queueReleased: false, waiter: null, pendingSendBytes: 0, pendingSends: new Set(), finished: false, active: true, closePromise: null }; __velarWebSocketConnections.set(value, state);
  __velarWsReflectApply(__velarWsFinalizerRegister, __velarWsFinalizer, [value, state]);
  socket.binaryType = "arraybuffer";
  socket.on("message", (data, binary) => { try { __velarWsReceive(state, socket, data, binary); } catch { __velarWsRejectReceive(state, socket, 1011, "Message handling failed"); } });
  socket.on("close", () => __velarWsFinish(state)); socket.on("error", error => { if (state.waiter) { const waiter = state.waiter; state.waiter = null; waiter.reject(new WebSocketProtocolError(error instanceof Error ? error.message : "WebSocket error")); } __velarWsAbort(state); });
  return Object.freeze(value);
}
function __velarWsCloseForStop(connection) {
  const state = __velarWebSocketConnections.get(connection);
  if (!state || state.finished) return new __velarWsPromise(resolve => resolve(null));
  __velarWsAbort(state);
  return new __velarWsPromise(resolve => {
    let settled = false; let timer = null;
    const finish = () => { if (settled) return; settled = true; if (timer !== null) __velarWsClearTimeout(timer); state.socket.off("close", finish); resolve(null); };
    state.socket.once("close", finish);
    try { state.socket.close(1001, "Server stopping"); }
    catch { try { state.socket.terminate(); } catch {} finish(); return; }
    if (!settled) timer = __velarWsSetTimeout(() => { try { state.socket.terminate(); } catch {} finish(); }, 5000);
  });
}
function __velarWsCompactPendingConnections(state) { if (state.queue.length <= state.pendingConnections.size * 2 + 64) return; const compact = []; for (const connection of state.queue) if (state.pendingConnections.has(connection)) compact.push(connection); state.queue = compact; }
function __velarWsCloseHttpServer(state, grace = 30000) {
  return new __velarWsPromise((resolve, reject) => {
    let settled = false; let forceTimer = null; let finalTimer = null;
    const finish = action => { if (settled) return; settled = true; if (forceTimer !== null) __velarWsClearTimeout(forceTimer); if (finalTimer !== null) __velarWsClearTimeout(finalTimer); action(); };
    try { state.httpServer.close(error => error ? finish(() => reject(error)) : finish(() => resolve(null))); }
    catch (error) { finish(() => reject(error)); return; }
    try { state.httpServer.closeIdleConnections?.(); } catch {}
    forceTimer = __velarWsSetTimeout(() => {
      try { state.httpServer.closeAllConnections?.(); } catch {}
      for (const socket of state.sockets) try { socket.destroy(); } catch {}
      finalTimer = __velarWsSetTimeout(() => finish(() => reject(new Error("WebSocket HTTP transport did not stop within its graceful shutdown deadline"))), 1000);
      finalTimer.unref?.();
    }, grace);
    forceTimer.unref?.();
  });
}
function __velarWsStopState(state) {
  if (state.stopPromise !== null) return state.stopPromise;
  state.stopped = true;
  if (state.waiter) { state.waiter.resolve(null); state.waiter = null; }
  __velarWsPendingConnections -= state.pendingConnections.size;
  if (__velarWsPendingConnections < 0) __velarWsPendingConnections = 0;
  state.pendingConnections.clear(); state.queue.length = 0;
  const applicationClose = state.application ? state.application.close(30000) : new __velarWsPromise(resolve => resolve(null));
  const httpClose = __velarWsCloseHttpServer(state);
  const pending = (async () => {
    try {
      const closing = [];
      for (const connection of state.connections) closing.push(__velarWsCloseForStop(connection));
      await __velarWsPromiseAll(closing);
      await new __velarWsPromise((resolve, reject) => state.server.close(error => error ? reject(error) : resolve(null)));
      await __velarWsPromiseAll([httpClose, applicationClose]);
    } finally { state.connections.clear(); }
    return null;
  })();
  state.stopPromise = pending;
  return pending;
}
const __velarWsConnectionPrototype = Object.freeze({
  state() { const state = __velarWebSocketConnections.get(this); if (!state) throw new TypeError("WebSocket state requires a connection"); return state.socket.readyState === __VelarWebSocket.CONNECTING ? "connecting" : state.socket.readyState === __VelarWebSocket.OPEN ? "open" : state.socket.readyState === __VelarWebSocket.CLOSING ? "closing" : "closed"; },
  send(message) { const state = __velarWebSocketConnections.get(this); if (!state) throw new TypeError("WebSocket.send requires a connection"); if (state.socket.readyState !== __VelarWebSocket.OPEN) return Promise.reject(new WebSocketClosedError()); const size = __velarWsMessageBytes(message); if (size > state.options.maxMessageBytes) return Promise.reject(new RangeError("WebSocket message exceeds maxMessageBytes")); if (state.pendingSendBytes + size > state.options.maxPendingSendBytes || !__velarWsReserveSend(size)) return Promise.reject(new WebSocketBackpressureError()); let bytes; try { bytes = typeof message === "string" ? null : __velarWsBytes(message); } catch (error) { __velarWsReleaseSend(size); throw error; } state.pendingSendBytes += size; return new Promise((resolve, reject) => { let completed = false; const complete = error => { if (completed) return; completed = true; state.pendingSends.delete(complete); state.pendingSendBytes -= size; __velarWsReleaseSend(size); if (error) reject(new WebSocketClosedError(error.message)); else resolve(null); }; state.pendingSends.add(complete); try { state.socket.send(bytes ?? message, { binary: bytes !== null }, complete); } catch (error) { complete(error instanceof Error ? error : new Error("WebSocket send failed")); } }); },
  next() { const state = __velarWebSocketConnections.get(this); if (!state) throw new TypeError("WebSocket.next requires a connection"); if (state.queue.length) { const message = state.queue.shift(); const size = __velarWsMessageBytes(message); state.queuedBytes -= size; __velarWsReleaseQueue(size); if (state.finished && state.queue.length === 0) __velarWsDiscardQueue(state); return Promise.resolve(message); } if (state.finished) return Promise.resolve(null); if (state.waiter) return Promise.reject(new WebSocketBackpressureError("Only one WebSocket.next call may wait at a time")); return new Promise((resolve, reject) => { state.waiter = { resolve, reject }; }); },
  close(code = 1000, reason = "") { const state = __velarWebSocketConnections.get(this); if (!state) throw new TypeError("WebSocket.close requires a connection"); if (!Number.isSafeInteger(code) || code < 1000 || code > 4999) return Promise.reject(new RangeError("WebSocket close code must be from 1000 through 4999")); if (typeof reason !== "string" || Buffer.byteLength(reason, "utf8") > 123) return Promise.reject(new RangeError("WebSocket close reason cannot exceed 123 UTF-8 bytes")); if (state.finished) return Promise.resolve(null); if (!state.closePromise) { state.closePromise = new Promise(resolve => { let settled = false; let timer = null; const finish = () => { if (settled) return; settled = true; if (timer !== null) __velarWsClearTimeout(timer); state.socket.off("close", finish); resolve(null); }; state.socket.once("close", finish); try { state.socket.close(code, reason); } catch { try { state.socket.terminate(); } catch {} finish(); return; } timer = __velarWsSetTimeout(() => { try { state.socket.terminate(); } catch {} finish(); }, 5000); }); } return state.closePromise; },
});
const __velarWsServerPrototype = Object.freeze({
  next() { const state = __velarWebSocketServers.get(this); if (!state) throw new TypeError("WebSocketServer.next requires a server"); while (state.queue.length) { const connection = state.queue.shift(); if (!state.pendingConnections.delete(connection)) continue; __velarWsPendingConnections -= 1; if (__velarWsPendingConnections < 0) __velarWsPendingConnections = 0; return Promise.resolve(connection); } if (state.stopped) return Promise.resolve(null); if (state.waiter) return Promise.reject(new WebSocketBackpressureError("Only one WebSocketServer.next call may wait at a time")); return new Promise((resolve, reject) => { state.waiter = { resolve, reject }; }); },
  stop() { const state = __velarWebSocketServers.get(this); if (!state) throw new TypeError("WebSocketServer.stop requires a server"); return __velarWsStopState(state); },
});
const __velarWsConnectionType = Object.freeze({ is(value) { return __velarWebSocketConnections.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match WebSocketConnection"); return value; } });
const __velarWsServerType = Object.freeze({ is(value) { return __velarWebSocketServers.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match WebSocketServer"); return value; } });
export const WebSocketConnection = __velarWsConnectionType; export const WebSocketServer = __velarWsServerType;
export function connect(url, options = {}) { if (typeof url !== "string" || !/^wss?:\/\//u.test(url)) return __velarWsPromise.reject(new TypeError("WebSocket URL must start with ws:// or wss://")); const limits = __velarWsOptions(options); const timeout = __velarWsDuration(options.timeout, 10000); return new __velarWsPromise((resolve, reject) => { const socket = new __VelarWebSocket(url, { maxPayload: limits.maxMessageBytes }); let settled = false; const finish = (action) => { if (settled) return false; settled = true; __velarWsClearTimeout(timer); socket.off("open", opened); socket.off("error", failed); action(); return true; }; const absorbTerminalError = () => socket.once("error", () => {}); const opened = () => { if (__velarWsActiveConnections >= __velarWsActiveConnectionLimit) { if (finish(() => reject(new WebSocketBackpressureError("WebSocket connection limit exceeded")))) { absorbTerminalError(); socket.close(1013, "Client connection limit reached"); } return; } finish(() => resolve(__velarWsWrap(socket, limits))); }; const failed = error => finish(() => reject(new WebSocketProtocolError(error instanceof Error ? error.message : "WebSocket connection failed"))); const timer = __velarWsSetTimeout(() => { if (finish(() => reject(new WebSocketTimeoutError("WebSocket connection timed out")))) { absorbTerminalError(); socket.terminate(); } }, timeout); socket.once("open", opened); socket.once("error", failed); }); }
export async function listen(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw new TypeError("listen requires an options record");
  const limits = __velarWsOptions(options);
  const port = __velarWsInteger(options.port, 0, 0, 65535, "port");
  const maxConnections = __velarWsInteger(options.maxConnections, 1024, 1, 4096, "maxConnections");
  const maxPendingConnections = __velarWsInteger(options.maxPendingConnections, 128, 1, 4096, "maxPendingConnections");
  if (options.host !== undefined && typeof options.host !== "string") throw new TypeError("WebSocket host must be text");
  if (options.path !== undefined && (typeof options.path !== "string" || !options.path.startsWith("/"))) throw new TypeError("WebSocket path must start with '/'");
  const application = __velarServeApp.is(options.http) ? await __velarServeApp.__velarCompilerBridge.nativeApp(options.http) : null;
  const handler = application ? application.handle : options.http;
  if (handler !== undefined && typeof handler !== "function") { if (application) await application.close(); throw new TypeError("WebSocket http must be a ServeApp or velar/serve handler"); }
  try {
    return await new __velarWsPromise((resolve, reject) => {
      const httpServer = __velarCreateHttpServer({maxHeaderSize: 64 * 1024, headersTimeout: 10000, requestTimeout: 60000, keepAliveTimeout: 5000, connectionsCheckingInterval: 1000}, (request, response) => {
        if (handler) void __velarServeRuntime.__velarHandleNative(handler, request, response, __velarServeNativeOperations);
        else { response.statusCode = 404; response.setHeader("content-type", "text/plain; charset=utf-8"); response.end(request.method === "HEAD" ? undefined : "Not found"); }
      });
      httpServer.maxConnections = 2048;
      httpServer.maxRequestsPerSocket = 1000;
      const server = new __VelarWebSocketServer({server: httpServer, path: options.path, maxPayload: limits.maxMessageBytes, perMessageDeflate: false, clientTracking: true});
      const value = Object.create(__velarWsServerPrototype);
      const state = {server, httpServer, application, queue: [], pendingConnections: new Set(), waiter: null, stopped: false, stopPromise: null, connections: new Set(), sockets: new Set()};
      __velarWebSocketServers.set(value, state);
      httpServer.on("connection", socket => {
        if (state.stopped || state.sockets.size >= 2048 || __velarWsActiveHttpSockets >= 4096) { socket.destroy(); return; }
        state.sockets.add(socket); __velarWsActiveHttpSockets += 1; socket.setNoDelay(true); socket.setKeepAlive(true, 5000);
        socket.once("close", () => { if (!state.sockets.delete(socket)) return; __velarWsActiveHttpSockets -= 1; if (__velarWsActiveHttpSockets < 0) __velarWsActiveHttpSockets = 0; });
      });
      server.on("connection", socket => {
        const willQueue = !state.waiter;
        if (state.stopped || state.connections.size >= maxConnections || __velarWsActiveConnections >= __velarWsActiveConnectionLimit || (willQueue && (state.pendingConnections.size >= maxPendingConnections || __velarWsPendingConnections >= __velarWsPendingConnectionLimit))) { socket.close(1013, "Server busy"); return; }
        const connection = __velarWsWrap(socket, limits); state.connections.add(connection);
        socket.once("close", () => { state.connections.delete(connection); if (state.pendingConnections.delete(connection)) { __velarWsPendingConnections -= 1; if (__velarWsPendingConnections < 0) __velarWsPendingConnections = 0; __velarWsCompactPendingConnections(state); } });
        if (state.waiter) { const waiter = state.waiter; state.waiter = null; waiter.resolve(connection); }
        else { state.queue.push(connection); state.pendingConnections.add(connection); __velarWsPendingConnections += 1; }
      });
      let settled = false;
      const fail = error => {
        if (settled) { void __velarWsStopState(state).catch(() => {}); return; }
        settled = true;
        try { server.close(); } catch {}
        try { httpServer.close(); } catch {}
        reject(error);
      };
      server.on("error", fail);
      httpServer.on("error", fail);
      httpServer.listen({port, host: options.host ?? "127.0.0.1"}, () => {
        if (settled) return;
        const address = httpServer.address();
        if (!address || typeof address === "string") { fail(new Error("WebSocket server could not determine its bound port")); return; }
        settled = true;
        Object.defineProperty(value, "port", {value: address.port, enumerable: true});
        resolve(Object.freeze(value));
      });
    });
  } catch (error) { if (application) await application.close(); throw error; }
}
`.trimStart();
