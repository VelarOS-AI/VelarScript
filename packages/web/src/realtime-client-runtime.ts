/** Browser-owned resilient realtime client layered over `velar/websocket`. */
export const VELAR_WEB_REALTIME_CLIENT_RUNTIME = String.raw`
import { WebSocketConnection as __velarRealtimeConnection, connect as __velarRealtimeConnect } from "velar/websocket";

const __velarRealtimeClients = new WeakMap();
const __velarRealtimeApply = Reflect.apply;
const __velarRealtimeArrayIsArray = Array.isArray;
const __velarRealtimeArrayPush = Array.prototype.push;
const __velarRealtimeFreeze = Object.freeze;
const __velarRealtimeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarRealtimeGetOwnPropertyNames = Object.getOwnPropertyNames;
const __velarRealtimeArrayIncludes = Array.prototype.includes;
const __velarRealtimeNumberIsFinite = Number.isFinite;
const __velarRealtimeNumberIsSafeInteger = Number.isSafeInteger;
const __velarRealtimeMathMax = Math.max;
const __velarRealtimeMathRound = Math.round;
const __velarRealtimeRandom = Math.random;
const __velarRealtimeSetTimeout = globalThis.setTimeout;
const __velarRealtimeClearTimeout = globalThis.clearTimeout;
const __velarRealtimePromise = Promise;
const __velarRealtimePromiseReject = Promise.reject;
const __velarRealtimePromiseResolve = Promise.resolve;
const __velarRealtimeStringCharCodeAt = String.prototype.charCodeAt;
const __velarRealtimeWeakMapGet = WeakMap.prototype.get;
const __velarRealtimeWeakMapHas = WeakMap.prototype.has;
const __velarRealtimeWeakMapSet = WeakMap.prototype.set;
const __velarRealtimeOptionNames = __velarRealtimeFreeze(["connectTimeout", "maxMessageBytes", "maxQueuedMessages", "maxQueuedBytes", "maxPendingSendBytes", "reconnectDelays", "reconnectJitter", "retryInitial"]);
const __velarRealtimeDefaultDelays = __velarRealtimeFreeze([0, 1000, 2000, 5000, 10000, 30000]);

export class RealtimeUnavailableError extends Error {
  constructor(message = "Realtime client is not connected") { super(message); this.name = "RealtimeUnavailableError"; }
}

function __velarRealtimeCall(operation, receiver, arguments_) { return __velarRealtimeApply(operation, receiver, arguments_); }
function __velarRealtimeRejected(failure) { return __velarRealtimeCall(__velarRealtimePromiseReject, __velarRealtimePromise, [failure]); }
function __velarRealtimeResolved(value) { return __velarRealtimeCall(__velarRealtimePromiseResolve, __velarRealtimePromise, [value]); }

function __velarRealtimeRecord(value, label, allowed = null) {
  if (value === null || typeof value !== "object" || __velarRealtimeCall(__velarRealtimeArrayIsArray, Array, [value])) throw new TypeError(label + " must be a record");
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
  if (!__velarRealtimeCall(__velarRealtimeNumberIsSafeInteger, Number, [value]) || value < minimum || value > maximum) throw new RangeError(label + " must be an integer from " + minimum + " through " + maximum);
  return value;
}

function __velarRealtimeDuration(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") throw new TypeError(label + " must be Duration");
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(value);
  if (!match) throw new TypeError(label + " must be Duration such as 5s");
  const milliseconds = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (!__velarRealtimeCall(__velarRealtimeNumberIsFinite, Number, [milliseconds]) || milliseconds < 0 || milliseconds > 2147483647) throw new RangeError(label + " is outside the supported range");
  return milliseconds;
}

function __velarRealtimeDelays(value) {
  if (value === undefined || value === null) return __velarRealtimeDefaultDelays;
  if (!__velarRealtimeCall(__velarRealtimeArrayIsArray, Array, [value])) throw new TypeError("Realtime reconnectDelays must be List<Duration>");
  if (value.length > 32) throw new RangeError("Realtime reconnectDelays cannot contain more than 32 entries");
  const delays = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarRealtimeCall(__velarRealtimeGetOwnPropertyDescriptor, Object, [value, index]);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Realtime reconnectDelays must be a dense List<Duration>");
    __velarRealtimeCall(__velarRealtimeArrayPush, delays, [__velarRealtimeDuration(descriptor.value, 0, "Realtime reconnect delay")]);
  }
  return __velarRealtimeFreeze(delays);
}

function __velarRealtimeOptions(value = {}) {
  const options = __velarRealtimeRecord(value, "Realtime client options", __velarRealtimeOptionNames);
  const jitter = __velarRealtimeOption(options, "reconnectJitter") ?? 0.2;
  if (typeof jitter !== "number" || !__velarRealtimeCall(__velarRealtimeNumberIsFinite, Number, [jitter]) || jitter < 0 || jitter > 1) throw new RangeError("Realtime reconnectJitter must be from 0 through 1");
  const retryInitial = __velarRealtimeOption(options, "retryInitial") ?? false;
  if (typeof retryInitial !== "boolean") throw new TypeError("Realtime retryInitial must be bool");
  return __velarRealtimeFreeze({
    connectTimeout: __velarRealtimeDuration(__velarRealtimeOption(options, "connectTimeout"), 10000, "Realtime connectTimeout"),
    maxMessageBytes: __velarRealtimeInteger(__velarRealtimeOption(options, "maxMessageBytes"), 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "Realtime maxMessageBytes"),
    maxQueuedMessages: __velarRealtimeInteger(__velarRealtimeOption(options, "maxQueuedMessages"), 256, 1, 10000, "Realtime maxQueuedMessages"),
    maxQueuedBytes: __velarRealtimeInteger(__velarRealtimeOption(options, "maxQueuedBytes"), 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "Realtime maxQueuedBytes"),
    maxPendingSendBytes: __velarRealtimeInteger(__velarRealtimeOption(options, "maxPendingSendBytes"), 16 * 1024 * 1024, 1, 64 * 1024 * 1024, "Realtime maxPendingSendBytes"),
    reconnectDelays: __velarRealtimeDelays(__velarRealtimeOption(options, "reconnectDelays")),
    reconnectJitter: jitter,
    retryInitial,
  });
}

function __velarRealtimeCodec(value) {
  const codec = __velarRealtimeRecord(value, "Realtime codec", ["decode", "encode"]);
  const decode = __velarRealtimeOption(codec, "decode");
  const encode = __velarRealtimeOption(codec, "encode");
  if (typeof decode !== "function" || typeof encode !== "function") throw new TypeError("Realtime codec requires decode and encode functions");
  return __velarRealtimeFreeze({decode, encode});
}

function __velarRealtimeCallback(value, label) {
  if (value !== null && typeof value !== "function") throw new TypeError(label + " must be a function or null");
  return value;
}

function __velarRealtimeFailure(phase, failure, recoverable) {
  const error = failure instanceof Error ? failure : new Error("Realtime " + phase + " failed");
  return __velarRealtimeFreeze({phase, error, recoverable});
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

function __velarRealtimeClientState(client) {
  const state = __velarRealtimeCall(__velarRealtimeWeakMapGet, __velarRealtimeClients, [client]);
  if (!state) throw new TypeError("RealtimeClient method requires a RealtimeClient receiver");
  return state;
}

function __velarRealtimeTransition(client, next) {
  const state = __velarRealtimeClientState(client);
  if (state.status === next) return __velarRealtimeResolved(null);
  state.status = next;
  if (state.stateChanged === null) return __velarRealtimeResolved(null);
  return __velarRealtimeResolved(state.stateChanged(client, next));
}

function __velarRealtimeWait(state, milliseconds) {
  if (milliseconds <= 0) return __velarRealtimeResolved(null);
  return new __velarRealtimePromise(resolve => {
    const timer = __velarRealtimeSetTimeout(() => {
      if (state.delayWake === null) return;
      state.delayWake = null;
      resolve(null);
    }, milliseconds);
    state.delayWake = () => {
      __velarRealtimeClearTimeout(timer);
      state.delayWake = null;
      resolve(null);
    };
  });
}

function __velarRealtimeReconnectDelay(state, attempt) {
  if (attempt >= state.options.reconnectDelays.length) return null;
  const base = state.options.reconnectDelays[attempt];
  if (base === 0 || state.options.reconnectJitter === 0) return base;
  const spread = base * state.options.reconnectJitter;
  const rounded = __velarRealtimeCall(__velarRealtimeMathRound, Math, [base - spread + __velarRealtimeCall(__velarRealtimeRandom, Math, []) * spread * 2]);
  return __velarRealtimeCall(__velarRealtimeMathMax, Math, [0, rounded]);
}

async function __velarRealtimeFailureAction(state, client, failure) {
  if (state.failed === null) return failure.recoverable ? "reconnect" : "stop";
  const action = await state.failed(failure, client);
  if (action !== "continue" && action !== "reconnect" && action !== "stop") throw new TypeError("Realtime client failure callback returned an invalid action");
  if (!failure.recoverable && action === "continue") return "stop";
  return action;
}

function __velarRealtimeResolveOpen(state) {
  const waiters = state.openWaiters;
  state.openWaiters = [];
  for (let index = 0; index < waiters.length; index += 1) waiters[index].resolve(state.generation);
}

function __velarRealtimeRejectOpen(state, failure) {
  const waiters = state.openWaiters;
  state.openWaiters = [];
  for (let index = 0; index < waiters.length; index += 1) waiters[index].reject(failure);
}

async function __velarRealtimeCloseFailedConnection(state, client) {
  const connection = state.connection;
  if (connection === null) return;
  try { await connection.close(1011, "Realtime client callback failed"); } catch {}
  let close = {code: 1006, reason: "Realtime client callback failed"};
  try { close = await connection.closeInfo(); } catch {}
  state.connection = null;
  if (state.closed !== null) {
    try { await state.closed(client, close); } catch {}
  }
}

async function __velarRealtimeRun(client) {
  const state = __velarRealtimeClientState(client);
  let reconnectAttempt = 0;
  let openedOnce = false;
  try {
    while (!state.stopping) {
      await __velarRealtimeTransition(client, openedOnce ? "reconnecting" : "connecting");
      let connection;
      try {
        const url = typeof state.url === "function" ? state.url() : state.url;
        if (typeof url !== "string") throw new TypeError("Realtime URL provider must return text");
        connection = await __velarRealtimeConnect(url, {
          timeout: state.options.connectTimeout + "ms",
          maxMessageBytes: state.options.maxMessageBytes,
          maxQueuedMessages: state.options.maxQueuedMessages,
          maxQueuedBytes: state.options.maxQueuedBytes,
          maxPendingSendBytes: state.options.maxPendingSendBytes,
        });
      } catch (failure) {
        const problem = __velarRealtimeFailure("connect", failure, true);
        const action = await __velarRealtimeFailureAction(state, client, problem);
        const canRetry = action === "reconnect" && (openedOnce || state.options.retryInitial);
        const delay = canRetry ? __velarRealtimeReconnectDelay(state, reconnectAttempt) : null;
        if (delay === null) { __velarRealtimeRejectOpen(state, problem.error); break; }
        reconnectAttempt += 1;
        await __velarRealtimeWait(state, delay);
        continue;
      }
      state.connection = __velarRealtimeConnection.parse(connection);
      if (state.stopping) { await connection.close(1000, "Realtime client stopped"); break; }
      state.generation += 1;
      reconnectAttempt = 0;
      await __velarRealtimeTransition(client, "open");
      try {
        if (state.opened !== null) await state.opened(client, __velarRealtimeFreeze({generation: state.generation, reconnected: openedOnce}));
      } catch (failure) {
        const problem = __velarRealtimeFailure("opened", failure, false);
        await __velarRealtimeFailureAction(state, client, problem);
        __velarRealtimeRejectOpen(state, problem.error);
        await connection.close(1011, "Realtime client setup failed");
        break;
      }
      openedOnce = true;
      __velarRealtimeResolveOpen(state);
      let reconnect = false;
      while (!state.stopping) {
        let wire;
        try { wire = await connection.next(); }
        catch (failure) {
          const action = await __velarRealtimeFailureAction(state, client, __velarRealtimeFailure("transport", failure, true));
          reconnect = action === "reconnect";
          break;
        }
        if (wire === null) break;
        let message;
        try { message = __velarRealtimeCall(state.codec.decode, undefined, [wire]); }
        catch (failure) {
          const action = await __velarRealtimeFailureAction(state, client, __velarRealtimeFailure("decode", failure, true));
          if (action === "continue") continue;
          reconnect = action === "reconnect";
          await connection.close(1007, "Realtime message is invalid");
          break;
        }
        try { await state.receive(message, client); }
        catch (failure) {
          const action = await __velarRealtimeFailureAction(state, client, __velarRealtimeFailure("receive", failure, true));
          if (action === "continue") continue;
          reconnect = action === "reconnect";
          await connection.close(1011, "Realtime message handler failed");
          break;
        }
      }
      const close = await connection.closeInfo();
      state.connection = null;
      if (state.closed !== null) await state.closed(client, close);
      if (state.stopping) break;
      if (!reconnect) reconnect = close.code === 1001 || close.code === 1006 || close.code === 1011 || close.code === 1012 || close.code === 1013;
      const delay = reconnect ? __velarRealtimeReconnectDelay(state, reconnectAttempt) : null;
      if (delay === null) break;
      reconnectAttempt += 1;
      await __velarRealtimeWait(state, delay);
    }
  } catch (failure) {
    const error = failure instanceof Error ? failure : new Error("Realtime client failed");
    await __velarRealtimeCloseFailedConnection(state, client);
    __velarRealtimeRejectOpen(state, error);
    state.runnerFailure = error;
  } finally {
    state.connection = null;
    state.stopping = true;
    try { await __velarRealtimeTransition(client, "closed"); }
    catch (failure) { if (state.runnerFailure === null) state.runnerFailure = failure instanceof Error ? failure : new Error("Realtime state callback failed"); }
    __velarRealtimeRejectOpen(state, new RealtimeUnavailableError("Realtime client closed before opening"));
    state.resolveDone(null);
  }
}

const __velarRealtimeClientPrototype = __velarRealtimeFreeze({
  state() { return __velarRealtimeClientState(this).status; },
  generation() { return __velarRealtimeClientState(this).generation; },
  start() {
    const state = __velarRealtimeClientState(this);
    if (state.status === "closed") return __velarRealtimeRejected(new RealtimeUnavailableError("Realtime client is closed"));
    const opening = this.whenOpen();
    if (state.runner === null) state.runner = __velarRealtimeRun(this);
    return (async () => { await opening; return null; })();
  },
  whenOpen() {
    const state = __velarRealtimeClientState(this);
    if (state.status === "open") return __velarRealtimeResolved(state.generation);
    if (state.status === "closed") return __velarRealtimeRejected(new RealtimeUnavailableError("Realtime client is closed"));
    if (state.openWaiters.length >= 256) return __velarRealtimeRejected(new RealtimeUnavailableError("Realtime open waiter limit exceeded"));
    return new __velarRealtimePromise((resolve, reject) => __velarRealtimeCall(__velarRealtimeArrayPush, state.openWaiters, [{resolve, reject}]));
  },
  async whenClosed() {
    const state = __velarRealtimeClientState(this);
    await state.done;
    if (state.runnerFailure !== null) throw state.runnerFailure;
    return null;
  },
  send(value) {
    const state = __velarRealtimeClientState(this);
    if (state.status !== "open" || state.connection === null) return __velarRealtimeRejected(new RealtimeUnavailableError());
    let wire;
    try { wire = __velarRealtimeCall(state.codec.encode, undefined, [value]); }
    catch (failure) { return __velarRealtimeRejected(failure); }
    return state.connection.send(wire);
  },
  async close(code = 1000, reason = "") {
    const state = __velarRealtimeClientState(this);
    if (state.status === "closed") return null;
    if (!__velarRealtimeCall(__velarRealtimeNumberIsSafeInteger, Number, [code]) || code < 1000 || code > 4999) throw new RangeError("Realtime close code must be from 1000 through 4999");
    if (typeof reason !== "string" || __velarRealtimeUtf8Size(reason, 123) > 123) throw new RangeError("Realtime close reason cannot exceed 123 UTF-8 bytes");
    state.stopping = true;
    if (state.delayWake !== null) state.delayWake();
    if (state.connection !== null) await state.connection.close(code, reason);
    if (state.runner !== null) await this.whenClosed();
    else {
      try { await __velarRealtimeTransition(this, "closed"); }
      catch (failure) { state.runnerFailure = failure instanceof Error ? failure : new Error("Realtime state callback failed"); }
      __velarRealtimeRejectOpen(state, new RealtimeUnavailableError("Realtime client closed before opening"));
      state.resolveDone(null);
      if (state.runnerFailure !== null) throw state.runnerFailure;
    }
    return null;
  },
});

export function realtimeClient(url, codec, receive, opened = null, failed = null, closed = null, stateChanged = null, options = {}) {
  if (typeof url !== "string" && typeof url !== "function") throw new TypeError("realtimeClient URL must be text or a zero-argument function");
  codec = __velarRealtimeCodec(codec);
  if (typeof receive !== "function") throw new TypeError("realtimeClient receive must be a function");
  opened = __velarRealtimeCallback(opened, "realtimeClient opened");
  failed = __velarRealtimeCallback(failed, "realtimeClient failed");
  closed = __velarRealtimeCallback(closed, "realtimeClient closed");
  stateChanged = __velarRealtimeCallback(stateChanged, "realtimeClient stateChanged");
  let resolveDone;
  const done = new __velarRealtimePromise(resolve => { resolveDone = resolve; });
  const client = Object.create(__velarRealtimeClientPrototype);
  __velarRealtimeCall(__velarRealtimeWeakMapSet, __velarRealtimeClients, [client, {url, codec, receive, opened, failed, closed, stateChanged, options: __velarRealtimeOptions(options), status: "idle", generation: 0, connection: null, runner: null, runnerFailure: null, stopping: false, delayWake: null, openWaiters: [], done, resolveDone}]);
  return __velarRealtimeFreeze(client);
}

const __velarRealtimeClientType = __velarRealtimeFreeze({is(value) { return __velarRealtimeCall(__velarRealtimeWeakMapHas, __velarRealtimeClients, [value]); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeClient"); return value; }});
const __velarRealtimeCodecType = __velarRealtimeFreeze({is(value) { try { __velarRealtimeCodec(value); return true; } catch { return false; } }, parse(value) { return __velarRealtimeCodec(value); }});
const __velarRealtimeFailureType = __velarRealtimeFreeze({is(value) { return value !== null && typeof value === "object" && typeof value.phase === "string" && value.error instanceof Error && typeof value.recoverable === "boolean"; }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeFailure"); return value; }});
const __velarRealtimeOpenType = __velarRealtimeFreeze({is(value) { return value !== null && typeof value === "object" && Number.isSafeInteger(value.generation) && typeof value.reconnected === "boolean"; }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeOpen"); return value; }});

export const RealtimeClient = __velarRealtimeFreeze({...__velarRealtimeClientType, of() { return __velarRealtimeClientType; }});
export const RealtimeCodec = __velarRealtimeFreeze({...__velarRealtimeCodecType, of() { return __velarRealtimeCodecType; }});
export const RealtimeFailure = __velarRealtimeFailureType;
export const RealtimeOpen = __velarRealtimeOpenType;
export const RealtimeClientState = __velarRealtimeFreeze({idle: "idle", connecting: "connecting", open: "open", reconnecting: "reconnecting", closed: "closed", is(value) { return value === "idle" || value === "connecting" || value === "open" || value === "reconnecting" || value === "closed"; }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeClientState"); return value; }, values() { return ["idle", "connecting", "open", "reconnecting", "closed"]; }});
export const RealtimeClientFailureAction = __velarRealtimeFreeze({continue: "continue", reconnect: "reconnect", stop: "stop", is(value) { return value === "continue" || value === "reconnect" || value === "stop"; }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match RealtimeClientFailureAction"); return value; }, values() { return ["continue", "reconnect", "stop"]; }});
`.trimStart();
