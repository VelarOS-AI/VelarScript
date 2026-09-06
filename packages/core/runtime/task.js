const __velarTaskNativeObject = globalThis.Object;
const __velarTaskNativeArray = globalThis.Array;
const __velarTaskNativeNumber = globalThis.Number;
const __velarTaskNativePromise = globalThis.Promise;
const __velarTaskNativeWeakMap = globalThis.WeakMap;
const __velarTaskNativeSet = globalThis.Set;
const __velarTaskNativeError = globalThis.Error;
const __velarTaskNativeTypeError = globalThis.TypeError;
const __velarTaskNativeRangeError = globalThis.RangeError;
const __velarTaskGlobal = globalThis;
const __velarTaskSetTimeout = globalThis.setTimeout;
const __velarTaskClearTimeout = globalThis.clearTimeout;
const __velarTaskGetOwnPropertyDescriptor = __velarTaskNativeObject.getOwnPropertyDescriptor;
const __velarTaskFreeze = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject, "freeze")?.value;
const __velarTaskCreate = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject, "create")?.value;
const __velarTaskDefineProperties = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject, "defineProperties")?.value;
const __velarTaskApply = __velarTaskGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarTaskNumberIsFinite = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeNumber, "isFinite")?.value;
const __velarTaskNumberIsSafeInteger = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeNumber, "isSafeInteger")?.value;
const __velarTaskArrayPrototype = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeArray, "prototype")?.value;
const __velarTaskArrayPush = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "push")?.value;
const __velarTaskArrayShift = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "shift")?.value;
const __velarTaskArraySplice = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "splice")?.value;
const __velarTaskArrayIndexOf = __velarTaskGetOwnPropertyDescriptor(__velarTaskArrayPrototype, "indexOf")?.value;
const __velarTaskPromiseThen = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativePromise.prototype, "then")?.value;
const __velarTaskWeakMapPrototype = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeWeakMap, "prototype")?.value;
const __velarTaskWeakMapGet = __velarTaskGetOwnPropertyDescriptor(__velarTaskWeakMapPrototype, "get")?.value;
const __velarTaskWeakMapHas = __velarTaskGetOwnPropertyDescriptor(__velarTaskWeakMapPrototype, "has")?.value;
const __velarTaskWeakMapSet = __velarTaskGetOwnPropertyDescriptor(__velarTaskWeakMapPrototype, "set")?.value;
const __velarTaskSetPrototype = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeSet, "prototype")?.value;
const __velarTaskSetAdd = __velarTaskGetOwnPropertyDescriptor(__velarTaskSetPrototype, "add")?.value;
const __velarTaskSetDelete = __velarTaskGetOwnPropertyDescriptor(__velarTaskSetPrototype, "delete")?.value;
const __velarTaskSetValues = __velarTaskGetOwnPropertyDescriptor(__velarTaskSetPrototype, "values")?.value;
const __velarTaskSetIterator = __velarTaskApply(__velarTaskSetValues, new __velarTaskNativeSet(), []);
const __velarTaskSetIteratorNext = __velarTaskGetOwnPropertyDescriptor(__velarTaskNativeObject.getPrototypeOf(__velarTaskSetIterator), "next")?.value;
const __velarTaskRegExpExec = __velarTaskGetOwnPropertyDescriptor(globalThis.RegExp.prototype, "exec")?.value;
const __velarTaskDurationPattern = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/;
if (typeof __velarTaskFreeze !== "function" || typeof __velarTaskCreate !== "function" || typeof __velarTaskDefineProperties !== "function"
  || typeof __velarTaskApply !== "function" || typeof __velarTaskPromiseThen !== "function" || typeof __velarTaskSetTimeout !== "function"
  || typeof __velarTaskClearTimeout !== "function" || typeof __velarTaskWeakMapGet !== "function" || typeof __velarTaskWeakMapHas !== "function"
  || typeof __velarTaskWeakMapSet !== "function" || typeof __velarTaskSetAdd !== "function" || typeof __velarTaskSetDelete !== "function"
  || typeof __velarTaskSetValues !== "function" || typeof __velarTaskSetIteratorNext !== "function" || typeof __velarTaskRegExpExec !== "function"
  || typeof __velarTaskNumberIsSafeInteger !== "function" || typeof __velarTaskArrayPush !== "function" || typeof __velarTaskArrayShift !== "function"
  || typeof __velarTaskArraySplice !== "function" || typeof __velarTaskArrayIndexOf !== "function") {
  throw new __velarTaskNativeTypeError("The structured task runtime is unavailable");
}
function __velarTaskCall(operation, receiver, arguments_) { return __velarTaskApply(operation, receiver, arguments_); }
export class CancellationError extends __velarTaskNativeError {
  constructor(message = "Task cancelled") { super(message); this.name = "CancellationError"; }
}
export class ChannelClosedError extends __velarTaskNativeError {
  constructor(message = "Channel is closed") { super(message); this.name = "ChannelClosedError"; }
}
export class ChannelBackpressureError extends __velarTaskNativeError {
  constructor(message = "Channel backpressure limit reached") { super(message); this.name = "ChannelBackpressureError"; }
}
const __velarCancellationStates = new __velarTaskNativeWeakMap();
const __velarTaskStates = new __velarTaskNativeWeakMap();
const __velarChannelStates = new __velarTaskNativeWeakMap();
function __velarCancellationState(value) {
  const state = __velarTaskCall(__velarTaskWeakMapGet, __velarCancellationStates, [value]);
  if (state === undefined) throw new __velarTaskNativeTypeError("Cancellation method requires a Cancellation receiver");
  return state;
}
function __velarOwnedTaskState(value) {
  const state = __velarTaskCall(__velarTaskWeakMapGet, __velarTaskStates, [value]);
  if (state === undefined) throw new __velarTaskNativeTypeError("Task method requires a Task receiver");
  return state;
}
function __velarCancelToken(token, reason) {
  const state = __velarCancellationState(token);
  if (state.cancelled) return;
  state.cancelled = true;
  state.reason = reason;
  const iterator = __velarTaskCall(__velarTaskSetValues, state.children, []);
  while (true) {
    const next = __velarTaskCall(__velarTaskSetIteratorNext, iterator, []);
    if (next.done) break;
    __velarCancelToken(next.value, reason);
  }
  const listeners = __velarTaskCall(__velarTaskSetValues, state.listeners, []);
  while (true) { const next = __velarTaskCall(__velarTaskSetIteratorNext, listeners, []); if (next.done) break; next.value(reason); }
}
const __velarCancellationPrototype = {};
__velarTaskDefineProperties(__velarCancellationPrototype, {
  cancelled: { enumerable: true, get() { return __velarCancellationState(this).cancelled; } },
  reason: { enumerable: true, get() { return __velarCancellationState(this).reason; } },
  checkpoint: { enumerable: true, value() {
    const receiver = this;
    __velarCancellationState(receiver);
    return new __velarTaskNativePromise((resolve, reject) => {
      __velarTaskCall(__velarTaskSetTimeout, __velarTaskGlobal, [() => {
        const state = __velarCancellationState(receiver);
        if (state.cancelled) reject(new CancellationError(state.reason ?? "Task cancelled"));
        else resolve(null);
      }, 0]);
    });
  } },
});
__velarTaskFreeze(__velarCancellationPrototype);
function __velarMakeCancellation(parent) {
  if (parent !== null && !Cancellation.is(parent)) throw new __velarTaskNativeTypeError("task parent must be a Cancellation value or null");
  const value = __velarTaskCreate(__velarCancellationPrototype);
  const state = { cancelled: false, reason: null, parent, children: new __velarTaskNativeSet(), listeners: new __velarTaskNativeSet() };
  __velarTaskCall(__velarTaskWeakMapSet, __velarCancellationStates, [value, state]);
  if (parent !== null) {
    const parentState = __velarCancellationState(parent);
    __velarTaskCall(__velarTaskSetAdd, parentState.children, [value]);
    if (parentState.cancelled) __velarCancelToken(value, parentState.reason);
  }
  return __velarTaskFreeze(value);
}
function __velarDetachCancellation(token) {
  const state = __velarCancellationState(token);
  if (state.parent !== null) __velarTaskCall(__velarTaskSetDelete, __velarCancellationState(state.parent).children, [token]);
}
function __velarCreateCancellation(parent = null) { return __velarMakeCancellation(parent); }
function __velarCancelCancellation(token, reason = "Task cancelled") {
  if (typeof reason !== "string") throw new __velarTaskNativeTypeError("Cancellation reason must be a string");
  __velarCancelToken(token, reason);
  return null;
}
function __velarOnCancellation(token, callback) {
  const state = __velarCancellationState(token);
  if (typeof callback !== "function") throw new __velarTaskNativeTypeError("Cancellation listener must be a function");
  if (state.cancelled) { callback(state.reason); return () => null; }
  __velarTaskCall(__velarTaskSetAdd, state.listeners, [callback]);
  return () => { __velarTaskCall(__velarTaskSetDelete, state.listeners, [callback]); return null; };
}
function __velarSettleCancellation(token, callback, value) { __velarDetachCancellation(token); return callback(value); }
function __velarAwaitStop(state) {
  return new __velarTaskNativePromise((resolve, reject) => {
    __velarTaskCall(__velarTaskPromiseThen, state.promise, [() => resolve(null), failure => failure instanceof CancellationError ? resolve(null) : reject(failure)]);
  });
}
const __velarTaskPrototype = {
  result() { return __velarOwnedTaskState(this).promise; },
  cancel(reason = "Task cancelled") {
    if (typeof reason !== "string") throw new __velarTaskNativeTypeError("Task.cancel reason must be a string");
    const state = __velarOwnedTaskState(this); __velarCancelToken(state.cancellation, reason); return __velarAwaitStop(state);
  },
  close() { const state = __velarOwnedTaskState(this); __velarCancelToken(state.cancellation, "Task scope ended"); return __velarAwaitStop(state); },
};
__velarTaskFreeze(__velarTaskPrototype);
function __velarMakeTask(work, parent) {
  if (typeof work !== "function") throw new __velarTaskNativeTypeError("task requires an async function");
  const cancellation = __velarMakeCancellation(parent);
  const value = __velarTaskCreate(__velarTaskPrototype);
  let startResolve;
  const start = new __velarTaskNativePromise(resolve => { startResolve = resolve; });
  const state = { cancellation, promise: null };
  __velarTaskCall(__velarTaskWeakMapSet, __velarTaskStates, [value, state]);
  state.promise = __velarTaskCall(__velarTaskPromiseThen, start, [() => work(cancellation)]);
  state.promise = __velarTaskCall(__velarTaskPromiseThen, state.promise, [
    result => __velarSettleCancellation(cancellation, value => value, result === undefined ? null : result),
    failure => __velarSettleCancellation(cancellation, value => { throw value; }, failure),
  ]);
  startResolve(null);
  return __velarTaskFreeze(value);
}
function __velarChannelState(value) {
  const state = __velarTaskCall(__velarTaskWeakMapGet, __velarChannelStates, [value]);
  if (state === undefined) throw new __velarTaskNativeTypeError("Channel method requires a Channel receiver");
  return state;
}
function __velarChannelResolved(value) { return new __velarTaskNativePromise(resolve => resolve(value)); }
function __velarChannelRejected(error) { return new __velarTaskNativePromise((_, reject) => reject(error)); }
function __velarChannelRemove(values, value) {
  const index = __velarTaskCall(__velarTaskArrayIndexOf, values, [value]);
  if (index >= 0) __velarTaskCall(__velarTaskArraySplice, values, [index, 1]);
}
function __velarChannelCancellation(value, operation) {
  if (value === null) return null;
  if (!Cancellation.is(value)) throw new __velarTaskNativeTypeError(operation + " cancellation must be a Cancellation value or null");
  return value;
}
function __velarChannelFinishWaiter(waiter) {
  if (!waiter.active) return false;
  waiter.active = false;
  if (waiter.unsubscribe !== null) waiter.unsubscribe();
  return true;
}
function __velarChannelDeliver(receiver, value) {
  if (!__velarChannelFinishWaiter(receiver)) return false;
  receiver.resolve(value);
  return true;
}
function __velarChannelPromoteSender(state) {
  while (state.senders.length > 0) {
    const sender = __velarTaskCall(__velarTaskArrayShift, state.senders, []);
    if (!__velarChannelFinishWaiter(sender)) continue;
    __velarTaskCall(__velarTaskArrayPush, state.values, [sender.value]);
    sender.resolve(null);
    return;
  }
}
const __velarChannelPrototype = {};
__velarTaskDefineProperties(__velarChannelPrototype, {
  capacity: { enumerable: true, get() { return __velarChannelState(this).capacity; } },
  size: { enumerable: true, get() { return __velarChannelState(this).values.length; } },
  closed: { enumerable: true, get() { return __velarChannelState(this).closed; } },
  send: { enumerable: true, value(value, cancellation = null) {
    const state = __velarChannelState(this);
    cancellation = __velarChannelCancellation(cancellation, "Channel.send");
    if (state.closed) return __velarChannelRejected(new ChannelClosedError());
    try { value = state.Type.parse(value); }
    catch (error) { return __velarChannelRejected(error); }
    if (state.receiver !== null) {
      const receiver = state.receiver;
      state.receiver = null;
      __velarChannelDeliver(receiver, value);
      return __velarChannelResolved(null);
    }
    if (state.values.length < state.capacity) {
      __velarTaskCall(__velarTaskArrayPush, state.values, [value]);
      return __velarChannelResolved(null);
    }
    if (state.senders.length >= state.capacity) {
      return __velarChannelRejected(new ChannelBackpressureError("Channel has too many waiting senders"));
    }
    return new __velarTaskNativePromise((resolve, reject) => {
      const waiter = {value, resolve, reject, active: true, unsubscribe: null};
      __velarTaskCall(__velarTaskArrayPush, state.senders, [waiter]);
      if (cancellation !== null) waiter.unsubscribe = __velarOnCancellation(cancellation, reason => {
        if (!__velarChannelFinishWaiter(waiter)) return;
        __velarChannelRemove(state.senders, waiter);
        reject(new CancellationError(reason ?? "Channel send cancelled"));
      });
    });
  } },
  trySend: { enumerable: true, value(value) {
    const state = __velarChannelState(this);
    if (state.closed) throw new ChannelClosedError();
    value = state.Type.parse(value);
    if (state.receiver !== null) {
      const receiver = state.receiver;
      state.receiver = null;
      __velarChannelDeliver(receiver, value);
      return true;
    }
    if (state.values.length >= state.capacity) return false;
    __velarTaskCall(__velarTaskArrayPush, state.values, [value]);
    return true;
  } },
  next: { enumerable: true, value(cancellation = null) {
    const state = __velarChannelState(this);
    cancellation = __velarChannelCancellation(cancellation, "Channel.next");
    if (state.values.length > 0) {
      const value = __velarTaskCall(__velarTaskArrayShift, state.values, []);
      __velarChannelPromoteSender(state);
      return __velarChannelResolved(value);
    }
    if (state.closed) return __velarChannelResolved(null);
    if (state.receiver !== null) return __velarChannelRejected(new ChannelBackpressureError("Only one Channel.next call may wait at a time"));
    return new __velarTaskNativePromise((resolve, reject) => {
      const waiter = {resolve, reject, active: true, unsubscribe: null};
      state.receiver = waiter;
      if (cancellation !== null) waiter.unsubscribe = __velarOnCancellation(cancellation, reason => {
        if (!__velarChannelFinishWaiter(waiter)) return;
        if (state.receiver === waiter) state.receiver = null;
        reject(new CancellationError(reason ?? "Channel receive cancelled"));
      });
    });
  } },
  close: { enumerable: true, value() {
    const state = __velarChannelState(this);
    if (state.closed) return null;
    state.closed = true;
    while (state.senders.length > 0) {
      const sender = __velarTaskCall(__velarTaskArrayShift, state.senders, []);
      if (!__velarChannelFinishWaiter(sender)) continue;
      sender.reject(new ChannelClosedError());
    }
    if (state.values.length === 0 && state.receiver !== null) {
      const receiver = state.receiver;
      state.receiver = null;
      __velarChannelDeliver(receiver, null);
    }
    return null;
  } },
});
__velarTaskFreeze(__velarChannelPrototype);
function __velarMakeChannel(Type, capacity) {
  Type = __velarRequireRuntimeType(Type, "channel");
  if (!__velarTaskCall(__velarTaskNumberIsSafeInteger, __velarTaskNativeNumber, [capacity]) || capacity < 1 || capacity > 65536) {
    throw new __velarTaskNativeRangeError("channel capacity must be an integer from 1 through 65536");
  }
  const value = __velarTaskCreate(__velarChannelPrototype);
  __velarTaskCall(__velarTaskWeakMapSet, __velarChannelStates, [value, {Type, capacity, values: [], senders: [], receiver: null, closed: false}]);
  return __velarTaskFreeze(value);
}
function __velarTaskDuration(value) {
  if (typeof value !== "string") throw new __velarTaskNativeTypeError("withTimeout requires Duration; write a value such as 200ms or 2s");
  const match = __velarTaskCall(__velarTaskRegExpExec, __velarTaskDurationPattern, [value]);
  if (!match) throw new __velarTaskNativeTypeError("withTimeout requires Duration; write a value such as 200ms or 2s");
  const milliseconds = __velarTaskNativeNumber(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (!__velarTaskCall(__velarTaskNumberIsFinite, __velarTaskNativeNumber, [milliseconds]) || milliseconds < 0 || milliseconds > 2147483647) throw new __velarTaskNativeRangeError("withTimeout duration must be from 0ms through 2147483647ms");
  return milliseconds;
}
export const Cancellation = __velarRegisterRuntimeType(__velarTaskFreeze({
  is(value) { return value !== null && (typeof value === "object" || typeof value === "function") && __velarTaskCall(__velarTaskWeakMapHas, __velarCancellationStates, [value]); },
  parse(value) { if (!Cancellation.is(value)) throw new __velarTaskNativeTypeError("Value does not match Cancellation"); return value; },
  __velarCreate(parent = null) { return __velarCreateCancellation(parent); },
  __velarCancel(token, reason = "Task cancelled") { return __velarCancelCancellation(token, reason); },
  __velarOn(token, callback) { return __velarOnCancellation(token, callback); },
}));
const __velarTaskType = __velarTaskFreeze({
  is(value) { return value !== null && (typeof value === "object" || typeof value === "function") && __velarTaskCall(__velarTaskWeakMapHas, __velarTaskStates, [value]); },
  parse(value) { if (!__velarTaskType.is(value)) throw new __velarTaskNativeTypeError("Value does not match Task"); return value; },
});
export const Task = __velarRegisterRuntimeType(__velarTaskFreeze({ ...__velarTaskType, of() { return __velarTaskType; } }));
const __velarChannelType = __velarTaskFreeze({
  is(value) { return value !== null && (typeof value === "object" || typeof value === "function") && __velarTaskCall(__velarTaskWeakMapHas, __velarChannelStates, [value]); },
  parse(value) { if (!__velarChannelType.is(value)) throw new __velarTaskNativeTypeError("Value does not match Channel"); return value; },
});
export const Channel = __velarRegisterRuntimeType(__velarTaskFreeze({ ...__velarChannelType, of() { return __velarChannelType; } }));
export function task(work, parent = null) { return __velarMakeTask(work, parent); }
export function channel(Type, capacity = 64) { return __velarMakeChannel(Type, capacity); }
export function withTimeout(source, duration) {
  const state = __velarOwnedTaskState(source);
  const milliseconds = __velarTaskDuration(duration);
  return new __velarTaskNativePromise((resolve, reject) => {
    let settled = false;
    const timer = __velarTaskCall(__velarTaskSetTimeout, __velarTaskGlobal, [() => {
      if (settled) return;
      settled = true;
      __velarCancelToken(state.cancellation, "Task timed out");
      __velarTaskCall(__velarTaskPromiseThen, state.promise, [
        () => reject(new TimeoutError("Task timed out after " + duration)),
        () => reject(new TimeoutError("Task timed out after " + duration)),
      ]);
    }, milliseconds]);
    __velarTaskCall(__velarTaskPromiseThen, state.promise, [
      value => { if (!settled) { settled = true; __velarTaskCall(__velarTaskClearTimeout, __velarTaskGlobal, [timer]); resolve(value); } },
      failure => { if (!settled) { settled = true; __velarTaskCall(__velarTaskClearTimeout, __velarTaskGlobal, [timer]); reject(failure); } },
    ]);
  });
}
