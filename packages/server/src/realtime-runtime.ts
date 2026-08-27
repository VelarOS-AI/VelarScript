/**
 * Application-level WebSocket session ownership for the server target of
 * `velar/realtime`.
 *
 * The Node target still owns frames and the physical connection. This layer
 * owns the repeatable application pattern: one bounded outbound mailbox, one
 * writer, sequential inbound dispatch, deterministic cleanup, and one public
 * failure policy. Codecs and business delivery guarantees remain application
 * values.
 */
export const VELAR_SERVER_REALTIME_RUNTIME = String.raw`
import { WebSocketClosedError as __velarRealtimeTransportClosed, WebSocketConnection as __velarRealtimeConnection, __velarWebSocketSendOwned as __velarRealtimeSendOwned } from "velar/websocket";

const __velarRealtimePeers = new WeakMap();
const __velarRealtimeApply = Reflect.apply;
const __velarRealtimeArray = Array;
const __velarRealtimeArrayIsArray = Array.isArray;
const __velarRealtimeFreeze = Object.freeze;
const __velarRealtimeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarRealtimeGetOwnPropertyNames = Object.getOwnPropertyNames;
const __velarRealtimeArrayIncludes = Array.prototype.includes;
const __velarRealtimeNumberIsSafeInteger = Number.isSafeInteger;
const __velarRealtimePromise = Promise;
const __velarRealtimePromiseReject = Promise.reject;
const __velarRealtimePromiseThen = Promise.prototype.then;
const __velarRealtimeStringCharCodeAt = String.prototype.charCodeAt;
const __velarRealtimeWeakMapGet = WeakMap.prototype.get;
const __velarRealtimeWeakMapHas = WeakMap.prototype.has;
const __velarRealtimeWeakMapSet = WeakMap.prototype.set;
const __velarRealtimeSetTimeout = globalThis.setTimeout;
const __velarRealtimeClearTimeout = globalThis.clearTimeout;
const __velarRealtimeOptionNames = __velarRealtimeFreeze(["maxQueuedMessages", "maxQueuedBytes", "drainTimeout"]);
const __velarRealtimeDefaultQueuedMessages = 64;
const __velarRealtimeDefaultQueuedBytes = 1024 * 1024;
const __velarRealtimeDefaultDrainTimeout = 5000;

export class RealtimeBackpressureError extends Error {
  constructor(message = "Realtime session outbound queue is full") { super(message); this.name = "RealtimeBackpressureError"; }
}

function __velarRealtimeCall(operation, receiver, arguments_) {
  return __velarRealtimeApply(operation, receiver, arguments_);
}

function __velarRealtimeRejected(failure) {
  return __velarRealtimeCall(__velarRealtimePromiseReject, __velarRealtimePromise, [failure]);
}

function __velarRealtimeRecord(value, label, allowed = null) {
  if (value === null || typeof value !== "object" || __velarRealtimeCall(__velarRealtimeArrayIsArray, Array, [value])) {
    throw new TypeError(label + " must be a record");
  }
  const names = __velarRealtimeCall(__velarRealtimeGetOwnPropertyNames, Object, [value]);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (allowed !== null && !__velarRealtimeCall(__velarRealtimeArrayIncludes, allowed, [name])) throw new TypeError(label + " has unknown field '" + name + "'");
    const descriptor = __velarRealtimeCall(__velarRealtimeGetOwnPropertyDescriptor, Object, [value, name]);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(label + " fields must be enumerable data values");
  }
  return value;
}

function __velarRealtimeOption(options, name) {
  const descriptor = __velarRealtimeCall(__velarRealtimeGetOwnPropertyDescriptor, Object, [options, name]);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function __velarRealtimeInteger(value, fallback, minimum, maximum, label) {
  if (value === undefined || value === null) return fallback;
  if (!__velarRealtimeCall(__velarRealtimeNumberIsSafeInteger, Number, [value]) || value < minimum || value > maximum) {
    throw new RangeError(label + " must be an integer from " + minimum + " through " + maximum);
  }
  return value;
}

function __velarRealtimeDuration(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new TypeError(label + " must be Duration");
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(value);
  if (!match) throw new TypeError(label + " must be Duration such as 5s");
  const milliseconds = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2147483647) {
    throw new RangeError(label + " is outside the supported range");
  }
  return milliseconds;
}

function __velarRealtimeOptions(value = {}) {
  const options = __velarRealtimeRecord(value, "Realtime session options", __velarRealtimeOptionNames);
  return __velarRealtimeFreeze({
    maxQueuedMessages: __velarRealtimeInteger(__velarRealtimeOption(options, "maxQueuedMessages"), __velarRealtimeDefaultQueuedMessages, 1, 10000, "Realtime maxQueuedMessages"),
    maxQueuedBytes: __velarRealtimeInteger(__velarRealtimeOption(options, "maxQueuedBytes"), __velarRealtimeDefaultQueuedBytes, 1, 64 * 1024 * 1024, "Realtime maxQueuedBytes"),
    drainTimeout: __velarRealtimeDuration(__velarRealtimeOption(options, "drainTimeout"), __velarRealtimeDefaultDrainTimeout, "Realtime drainTimeout"),
  });
}

function __velarRealtimeCodec(value) {
  const codec = __velarRealtimeRecord(value, "Realtime codec", ["decode", "encode"]);
  const decode = __velarRealtimeOption(codec, "decode");
  const encode = __velarRealtimeOption(codec, "encode");
  if (typeof decode !== "function" || typeof encode !== "function") {
    throw new TypeError("Realtime codec requires decode and encode functions");
  }
  return __velarRealtimeFreeze({decode, encode});
}

function __velarRealtimeCallback(value, label) {
  if (value !== null && typeof value !== "function") throw new TypeError(label + " must be a function or null");
  return value;
}

function __velarRealtimeUtf8Size(value, maximum) {
  let size = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = __velarRealtimeCall(__velarRealtimeStringCharCodeAt, value, [index]);
    if (code < 0x80) size += 1;
    else if (code < 0x800) size += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const following = __velarRealtimeCall(__velarRealtimeStringCharCodeAt, value, [index + 1]);
      if (following >= 0xdc00 && following <= 0xdfff) { size += 4; index += 1; }
      else size += 3;
    } else size += 3;
    if (size > maximum) return size;
  }
  return size;
}

function __velarRealtimeMessage(value, label, maximum) {
  if (typeof value === "string") {
    const size = __velarRealtimeUtf8Size(value, maximum);
    return size > maximum ? null : {wire: value, size};
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength > maximum) return null;
    const wire = new Uint8Array(value.byteLength);
    wire.set(value);
    return {wire, size: wire.byteLength};
  }
  throw new TypeError(label + " must be text or Bytes");
}

function __velarRealtimeFailure(phase, failure, recoverable) {
  const error = failure instanceof Error ? failure : new Error("Realtime " + phase + " failed");
  return __velarRealtimeFreeze({phase, error, recoverable});
}

function __velarRealtimePeerState(peer) {
  const state = __velarRealtimeCall(__velarRealtimeWeakMapGet, __velarRealtimePeers, [peer]);
  if (!state) throw new TypeError("RealtimePeer method requires a RealtimePeer receiver");
  return state;
}

function __velarRealtimeRejectQueued(state, failure) {
  while (state.queueSize > 0) {
    const entry = state.queue[state.queueHead];
    state.queue[state.queueHead] = null;
    state.queueHead = (state.queueHead + 1) % state.queue.length;
    state.queueSize -= 1;
    state.queuedBytes -= entry.size;
    entry.reject(failure);
  }
  state.queueHead = 0;
  state.queuedBytes = 0;
}

function __velarRealtimeWake(state) {
  if (state.wake !== null) { const wake = state.wake; state.wake = null; wake(null); }
}

function __velarRealtimeEnqueue(state, value, observed) {
  if (!state.accepting) {
    if (observed) return __velarRealtimeRejected(new __velarRealtimeTransportClosed("Realtime session is closing"));
    return false;
  }
  if (state.queueSize >= state.options.maxQueuedMessages) {
    if (observed) return __velarRealtimeRejected(new RealtimeBackpressureError());
    return false;
  }
  let message;
  try {
    const remaining = state.options.maxQueuedBytes - state.queuedBytes;
    message = __velarRealtimeMessage(__velarRealtimeCall(state.codec.encode, undefined, [value]), "Realtime codec encode result", remaining);
  }
  catch (failure) {
    state.writeFailure ??= __velarRealtimeFailure("encode", failure, false);
    state.accepting = false;
    __velarRealtimeWake(state);
    if (observed) return __velarRealtimeRejected(state.writeFailure.error);
    throw state.writeFailure.error;
  }
  if (message === null) {
    if (observed) return __velarRealtimeRejected(new RealtimeBackpressureError());
    return false;
  }
  const position = (state.queueHead + state.queueSize) % state.queue.length;
  if (!observed) {
    state.queue[position] = {wire: message.wire, size: message.size, resolve: () => {}, reject: () => {}};
    state.queueSize += 1;
    state.queuedBytes += message.size;
    __velarRealtimeWake(state);
    return true;
  }
  return new __velarRealtimePromise((resolve, reject) => {
    state.queue[position] = {wire: message.wire, size: message.size, resolve, reject};
    state.queueSize += 1;
    state.queuedBytes += message.size;
    __velarRealtimeWake(state);
  });
}

const __velarRealtimePeerPrototype = __velarRealtimeFreeze({
  state() {
    const state = __velarRealtimePeerState(this);
    if (state.done) return "closed";
    if (!state.accepting) return "closing";
    return "open";
  },
  send(value) { return __velarRealtimeEnqueue(__velarRealtimePeerState(this), value, true); },
  trySend(value) { return __velarRealtimeEnqueue(__velarRealtimePeerState(this), value, false); },
  close(code = 1000, reason = "") {
    const state = __velarRealtimePeerState(this);
    if (!__velarRealtimeCall(__velarRealtimeNumberIsSafeInteger, Number, [code]) || code < 1000 || code > 4999) {
      return __velarRealtimeRejected(new RangeError("Realtime close code must be from 1000 through 4999"));
    }
    if (typeof reason !== "string" || __velarRealtimeUtf8Size(reason, 123) > 123) {
      return __velarRealtimeRejected(new RangeError("Realtime close reason cannot exceed 123 UTF-8 bytes"));
    }
    if (!state.done && state.requestedClose === null) state.requestedClose = {code, reason};
    state.accepting = false;
    __velarRealtimeWake(state);
    return state.closePromise;
  },
});

function __velarRealtimeCreatePeer(connection, codec, options) {
  let resolveClose;
  const closePromise = new __velarRealtimePromise(resolve => { resolveClose = resolve; });
  const peer = Object.create(__velarRealtimePeerPrototype);
  const state = {connection, codec, options, queue: new __velarRealtimeArray(options.maxQueuedMessages), queueHead: 0, queueSize: 0, queuedBytes: 0, wake: null, accepting: true, done: false, requestedClose: null, writeFailure: null, closePromise, resolveClose};
  __velarRealtimeCall(__velarRealtimeWeakMapSet, __velarRealtimePeers, [peer, state]);
  return __velarRealtimeFreeze(peer);
}

function __velarRealtimeTimed(source, milliseconds) {
  if (milliseconds === 0) return source;
  return new __velarRealtimePromise((resolve, reject) => {
    let settled = false;
    const timer = __velarRealtimeSetTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new RealtimeBackpressureError("Realtime session did not drain before its deadline"));
    }, milliseconds);
    __velarRealtimeCall(__velarRealtimePromiseThen, source, [
      value => { if (!settled) { settled = true; __velarRealtimeClearTimeout(timer); resolve(value); } },
      failure => { if (!settled) { settled = true; __velarRealtimeClearTimeout(timer); reject(failure); } },
    ]);
  });
}

async function __velarRealtimeWrite(peer) {
  const state = __velarRealtimePeerState(peer);
  try {
    while (state.accepting || state.queueSize > 0) {
      if (state.queueSize === 0) {
        await new __velarRealtimePromise(resolve => { state.wake = resolve; });
        continue;
      }
      const entry = state.queue[state.queueHead];
      state.queue[state.queueHead] = null;
      state.queueHead = (state.queueHead + 1) % state.queue.length;
      state.queueSize -= 1;
      state.queuedBytes -= entry.size;
      try {
        // entry.wire 是入队时已复制的框架自有快照。走底层内部 ABI
        // 可避免 WebSocket 公开 send 为防应用篡改而再复制一次 Bytes。
        await __velarRealtimeTimed(__velarRealtimeSendOwned(state.connection, entry.wire), state.options.drainTimeout);
        entry.resolve(null);
      } catch (failure) {
        entry.reject(failure);
        state.writeFailure = __velarRealtimeFailure("send", failure, false);
        state.accepting = false;
        __velarRealtimeRejectQueued(state, state.writeFailure.error);
        break;
      }
    }
  } finally {
    const close = state.requestedClose ?? (state.writeFailure === null ? {code: 1000, reason: "Realtime session finished"} : {code: 1011, reason: "Realtime send failed"});
    try { await state.connection.close(close.code, close.reason); } catch {}
    state.resolveClose(null);
  }
}

async function __velarRealtimeFailureAction(callback, failure, peer) {
  if (callback === null) return "close";
  const action = await callback(failure, peer);
  if (action !== "continue" && action !== "close") throw new TypeError("Realtime failure callback must return RealtimeFailureAction.continue or RealtimeFailureAction.close");
  if (!failure.recoverable && action === "continue") return "close";
  return action;
}

export async function realtimeSession(connection, codec, receive, opened = null, failed = null, closed = null, options = {}) {
  connection = __velarRealtimeConnection.parse(connection);
  codec = __velarRealtimeCodec(codec);
  if (typeof receive !== "function") throw new TypeError("realtimeSession receive must be a function");
  opened = __velarRealtimeCallback(opened, "realtimeSession opened");
  failed = __velarRealtimeCallback(failed, "realtimeSession failed");
  closed = __velarRealtimeCallback(closed, "realtimeSession closed");
  const peer = __velarRealtimeCreatePeer(connection, codec, __velarRealtimeOptions(options));
  const state = __velarRealtimePeerState(peer);
  const writer = __velarRealtimeWrite(peer);
  let cleanup = null;
  let terminalFailure = null;
  let terminalFailureReported = false;
  try {
    if (opened !== null) {
      try {
        cleanup = await opened(peer);
        if (cleanup !== null && typeof cleanup !== "function") throw new TypeError("realtimeSession opened must resolve to a cleanup function or null");
      } catch (failure) {
        terminalFailure = __velarRealtimeFailure("opened", failure, false);
        terminalFailureReported = true;
        try { await __velarRealtimeFailureAction(failed, terminalFailure, peer); }
        finally { state.requestedClose = {code: 1011, reason: "Realtime session setup failed"}; }
        return null;
      }
    }
    while (state.accepting) {
      let wire;
      try { wire = await connection.next(); }
      catch (failure) { terminalFailure = __velarRealtimeFailure("transport", failure, false); break; }
      if (wire === null) break;
      let message;
      try { message = __velarRealtimeCall(codec.decode, undefined, [wire]); }
      catch (failure) {
        const decoded = __velarRealtimeFailure("decode", failure, true);
        if (await __velarRealtimeFailureAction(failed, decoded, peer) === "continue") continue;
        state.requestedClose = {code: 1007, reason: "Realtime message is invalid"};
        break;
      }
      try { await receive(message, peer); }
      catch (failure) {
        const handled = __velarRealtimeFailure("receive", failure, true);
        if (await __velarRealtimeFailureAction(failed, handled, peer) === "continue") continue;
        state.requestedClose = {code: 1011, reason: "Realtime command failed"};
        break;
      }
      if (state.writeFailure !== null) { terminalFailure = state.writeFailure; break; }
    }
  } finally {
    state.accepting = false;
    __velarRealtimeWake(state);
    let cleanupFailure = null;
    if (cleanup !== null) {
      try { await cleanup(); }
      catch (failure) { cleanupFailure = failure; }
    }
    try { await writer; }
    catch (failure) { terminalFailure ??= __velarRealtimeFailure("send", failure, false); }
    const close = await connection.closeInfo();
    state.done = true;
    if (terminalFailure !== null && failed !== null && terminalFailure !== state.writeFailure && !terminalFailureReported) {
      try { await __velarRealtimeFailureAction(failed, terminalFailure, peer); } catch {}
    }
    if (closed !== null) await closed(peer, close);
    if (cleanupFailure !== null) throw cleanupFailure;
  }
  return null;
}

const __velarRealtimePeerType = __velarRealtimeFreeze({
  is(value) { return __velarRealtimeCall(__velarRealtimeWeakMapHas, __velarRealtimePeers, [value]); },
  parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimePeer"); return value; },
});
const __velarRealtimeCodecType = __velarRealtimeFreeze({
  is(value) { try { __velarRealtimeCodec(value); return true; } catch { return false; } },
  parse(value) { return __velarRealtimeCodec(value); },
});
const __velarRealtimeFailureType = __velarRealtimeFreeze({
  is(value) { return value !== null && typeof value === "object" && typeof value.phase === "string" && value.error instanceof Error && typeof value.recoverable === "boolean"; },
  parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeFailure"); return value; },
});

export const RealtimePeer = __velarRealtimeFreeze({...__velarRealtimePeerType, of() { return __velarRealtimePeerType; }});
export const RealtimeCodec = __velarRealtimeFreeze({...__velarRealtimeCodecType, of() { return __velarRealtimeCodecType; }});
export const RealtimeFailure = __velarRealtimeFailureType;
export const RealtimeFailureAction = __velarRealtimeFreeze({
  continue: "continue",
  close: "close",
  is(value) { return value === "continue" || value === "close"; },
  parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeFailureAction"); return value; },
  values() { return ["continue", "close"]; },
});
export const RealtimePeerState = __velarRealtimeFreeze({
  open: "open",
  closing: "closing",
  closed: "closed",
  is(value) { return value === "open" || value === "closing" || value === "closed"; },
  parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimePeerState"); return value; },
  values() { return ["open", "closing", "closed"]; },
});
`.trimStart();
