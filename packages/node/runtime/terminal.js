import { EventEmitter as __VelarTerminalEventEmitter } from "node:events";
import { MessageChannel as __VelarTerminalMessageChannel, MessagePort as __VelarTerminalMessagePort, Worker as __VelarTerminalWorker } from "node:worker_threads";

const __velarTerminalNativeArray = globalThis.Array;
const __velarTerminalNativeError = globalThis.Error;
const __velarTerminalNativeNumber = globalThis.Number;
const __velarTerminalNativeObject = globalThis.Object;
const __velarTerminalNativePromise = globalThis.Promise;
const __velarTerminalNativeRangeError = globalThis.RangeError;
const __velarTerminalNativeReflect = globalThis.Reflect;
const __velarTerminalNativeString = globalThis.String;
const __velarTerminalNativeTypeError = globalThis.TypeError;
const __velarTerminalOwnDescriptor = __velarTerminalNativeObject.getOwnPropertyDescriptor;
const __velarTerminalApply = __velarTerminalNativeReflect.apply;
function __velarTerminalDataOperation(target, name) {
  const descriptor = __velarTerminalOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarTerminalNativeError("VelarScript terminal host operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarTerminalArrayPush = __velarTerminalDataOperation(__velarTerminalNativeArray.prototype, "push");
const __velarTerminalArraySlice = __velarTerminalDataOperation(__velarTerminalNativeArray.prototype, "slice");
const __velarTerminalArrayIsArray = __velarTerminalDataOperation(__velarTerminalNativeArray, "isArray");
const __velarTerminalNumberIsSafeInteger = __velarTerminalDataOperation(__velarTerminalNativeNumber, "isSafeInteger");
const __velarTerminalObjectCreate = __velarTerminalDataOperation(__velarTerminalNativeObject, "create");
const __velarTerminalObjectFreeze = __velarTerminalDataOperation(__velarTerminalNativeObject, "freeze");
const __velarTerminalOwnKeys = __velarTerminalDataOperation(__velarTerminalNativeReflect, "ownKeys");
const __velarTerminalPromiseThen = __velarTerminalDataOperation(__velarTerminalNativePromise.prototype, "then");
const __velarTerminalStringIncludes = __velarTerminalDataOperation(__velarTerminalNativeString.prototype, "includes");
const __velarTerminalMessagePortPost = __velarTerminalDataOperation(__VelarTerminalMessagePort.prototype, "postMessage");
const __velarTerminalMessagePortStart = __velarTerminalDataOperation(__VelarTerminalMessagePort.prototype, "start");
const __velarTerminalMessagePortRef = __velarTerminalDataOperation(__VelarTerminalMessagePort.prototype, "ref");
const __velarTerminalMessagePortUnref = __velarTerminalDataOperation(__VelarTerminalMessagePort.prototype, "unref");
const __velarTerminalMessagePortClose = __velarTerminalDataOperation(__VelarTerminalMessagePort.prototype, "close");
const __velarTerminalWorkerRef = __velarTerminalDataOperation(__VelarTerminalWorker.prototype, "ref");
const __velarTerminalWorkerUnref = __velarTerminalDataOperation(__VelarTerminalWorker.prototype, "unref");
const __velarTerminalWorkerTerminate = __velarTerminalDataOperation(__VelarTerminalWorker.prototype, "terminate");
const __velarTerminalEventOn = __velarTerminalDataOperation(__VelarTerminalEventEmitter.prototype, "on");
const __velarTerminalMessageData = __velarTerminalOwnDescriptor(globalThis.MessageEvent.prototype, "data")?.get;
if (typeof __velarTerminalMessageData !== "function") throw new __velarTerminalNativeError("Node terminal MessageEvent data operation is unavailable");
const __velarTerminalSetTimeout = globalThis.setTimeout;
const __velarTerminalClearTimeout = globalThis.clearTimeout;
const __velarTerminalProcess = globalThis.process;
const __velarTerminalMaxArgumentCount = 256;
const __velarTerminalMaxTextBytes = 1024 * 1024;
const __velarTerminalMaxPending = 256;
const __velarTerminalPending = __velarTerminalCall(__velarTerminalObjectCreate, __velarTerminalNativeObject, [null]);
let __velarTerminalPendingCount = 0;
let __velarTerminalNextRequest = 1;
let __velarTerminalClosed = false;
let __velarTerminalClosing = false;
let __velarTerminalInteractive = false;
// The one readiness deadline every Node Worker in this target shares;
// `velar/process` and `velar/node-host-v1` declare the same number under their
// own prefixes, and tests/node-process-readiness.test.ts pins the three to one value.
const __velarTerminalReadyDeadlineMs = 30_000;
let __velarTerminalReady = false;
let __velarTerminalFailure = null;
let __velarTerminalExpectedWorkerExit = false;
let __velarTerminalReadyResolve;
let __velarTerminalReadyReject;

function __velarTerminalCall(operation, receiver, arguments_) {
  return __velarTerminalApply(operation, receiver, arguments_);
}

function __velarTerminalPush(values, value) {
  __velarTerminalCall(__velarTerminalArrayPush, values, [value]);
}

function __velarTerminalIsSafeInteger(value) {
  return __velarTerminalCall(__velarTerminalNumberIsSafeInteger, __velarTerminalNativeNumber, [value]);
}

function __velarTerminalBoundedText(value, operation) {
  if (typeof value !== "string") throw new __velarTerminalNativeTypeError(operation + " requires text");
  if (__velarUtf8ByteLength(value) > __velarTerminalMaxTextBytes) {
    throw new __velarTerminalNativeRangeError(operation + " text exceeds its 1 MiB boundary");
  }
  return value;
}

function __velarTerminalProgramArguments() {
  const source = __velarTerminalProcess.argv;
  const values = [];
  if (source.length - 2 > __velarTerminalMaxArgumentCount) {
    throw new __velarTerminalNativeRangeError("Terminal args cannot exceed 256 items");
  }
  let bytes = 0;
  for (let index = 2; index < source.length; index += 1) {
    const value = source[index];
    if (typeof value !== "string") throw new __velarTerminalNativeTypeError("Terminal args must be text");
    bytes += __velarUtf8ByteLength(value);
    if (__velarTerminalCall(__velarTerminalStringIncludes, value, ["\0"]) || bytes > __velarTerminalMaxTextBytes) {
      throw new __velarTerminalNativeRangeError("Terminal args are outside the supported boundary");
    }
    __velarTerminalPush(values, value);
  }
  return __velarTerminalCall(__velarTerminalObjectFreeze, __velarTerminalNativeObject, [values]);
}

function __velarTerminalRecord(value, name) {
  if (!value || typeof value !== "object" || __velarTerminalCall(__velarTerminalArrayIsArray, __velarTerminalNativeArray, [value])) {
    throw new __velarTerminalNativeTypeError(name + " must be a record");
  }
  const output = __velarTerminalCall(__velarTerminalObjectCreate, __velarTerminalNativeObject, [null]);
  const keys = __velarTerminalCall(__velarTerminalOwnKeys, __velarTerminalNativeReflect, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw new __velarTerminalNativeTypeError(name + " fields must use string names");
    const descriptor = __velarTerminalOwnDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarTerminalNativeTypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}

function __velarTerminalError(value) {
  value = __velarTerminalRecord(value, "Node terminal host error");
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536) {
    throw new __velarTerminalNativeTypeError("Node terminal host returned an invalid error");
  }
  if (value.name === "RangeError") return new __velarTerminalNativeRangeError(value.message);
  if (value.name === "TypeError") return new __velarTerminalNativeTypeError(value.message);
  if (value.name === "Error") return new __velarTerminalNativeError(value.message);
  throw new __velarTerminalNativeTypeError("Node terminal host returned an invalid error");
}

// D114 P6 items A and B: one rule for both handles.
//
// A Worker call the program can still be awaiting keeps the event loop alive.
// "Outstanding" is the readiness handshake, every in-flight request, and a
// close this proxy has asked for and not yet seen acknowledged; while any of
// them stands the Worker *and* the MessagePort are ref'd, and when none does
// both are unref'd so an idle program exits. A settled failure is not
// outstanding: its pending calls are already rejected and its port is closed.
//
// Reffing only the port left the Worker unref'd from the moment it reported
// ready, which is the accounting that let a program exit 0 with an awaited call
// unsettled; velar/process carries the same rule in the same words.
function __velarTerminalOutstanding() {
  if (__velarTerminalFailure) return false;
  return !__velarTerminalReady || __velarTerminalPendingCount > 0 || __velarTerminalClosing;
}
// The Worker binding is declared below this function and read only from a
// callback or an exported entry point, both of which run after the module body
// has finished, so the forward reference is never evaluated uninitialized.
function __velarTerminalUpdateReference() {
  const outstanding = __velarTerminalOutstanding();
  __velarTerminalCall(outstanding ? __velarTerminalMessagePortRef : __velarTerminalMessagePortUnref, __velarTerminalPort, []);
  if (outstanding) __velarTerminalCall(__velarTerminalWorkerRef, __velarTerminalWorker, []);
  else __velarTerminalCall(__velarTerminalWorkerUnref, __velarTerminalWorker, []);
}

function __velarTerminalFail(error) {
  if (__velarTerminalFailure) return;
  const failure = error instanceof __velarTerminalNativeError
    ? error
    : new __velarTerminalNativeError("Node terminal worker failed");
  __velarTerminalFailure = failure;
  if (!__velarTerminalReady) __velarTerminalReadyReject(failure);
  __velarTerminalClosed = true;
  __velarTerminalClosing = false;
  const keys = __velarTerminalCall(__velarTerminalOwnKeys, __velarTerminalNativeReflect, [__velarTerminalPending]);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = __velarTerminalOwnDescriptor(__velarTerminalPending, keys[index]);
    if (descriptor && "value" in descriptor) descriptor.value.reject(failure);
    delete __velarTerminalPending[keys[index]];
  }
  __velarTerminalPendingCount = 0;
  __velarTerminalUpdateReference();
  __velarTerminalCall(__velarTerminalMessagePortClose, __velarTerminalPort, []);
  __velarTerminalExpectedWorkerExit = true;
  const terminated = __velarTerminalCall(__velarTerminalWorkerTerminate, __velarTerminalWorker, []);
  __velarTerminalCall(__velarTerminalPromiseThen, terminated, [() => null, () => null]);
}

function __velarTerminalMessage(value) {
  const message = __velarTerminalRecord(value, "Node terminal host message");
  if (message.kind === "ready") {
    if (__velarTerminalReady || typeof message.interactive !== "boolean") {
      throw new __velarTerminalNativeTypeError("Node terminal worker returned invalid readiness");
    }
    __velarTerminalInteractive = message.interactive;
    __velarTerminalReady = true;
    __velarTerminalReadyResolve(null);
    return;
  }
  if (message.kind === "closed") {
    if (!__velarTerminalClosing || message.error !== null) {
      throw message.error === null
        ? new __velarTerminalNativeError("Node terminal worker returned unexpected closure")
        : __velarTerminalError(message.error);
    }
    __velarTerminalClosing = false;
    __velarTerminalUpdateReference();
    __velarTerminalCall(__velarTerminalMessagePortClose, __velarTerminalPort, []);
    __velarTerminalExpectedWorkerExit = true;
    const terminated = __velarTerminalCall(__velarTerminalWorkerTerminate, __velarTerminalWorker, []);
    __velarTerminalCall(__velarTerminalPromiseThen, terminated, [() => null, () => null]);
    return;
  }
  if (message.kind !== "response" || !__velarTerminalIsSafeInteger(message.id) || message.id < 1 || typeof message.ok !== "boolean") {
    throw new __velarTerminalNativeTypeError("Node terminal worker returned an invalid response");
  }
  const descriptor = __velarTerminalOwnDescriptor(__velarTerminalPending, __velarTerminalNativeString(message.id));
  if (!descriptor || !("value" in descriptor)) throw new __velarTerminalNativeError("Node terminal worker returned an unknown response");
  const pending = descriptor.value;
  const responseError = message.ok ? null : __velarTerminalError(message.error);
  if (pending.operation === "readLine") {
    if (message.ok && message.value !== null && typeof message.value !== "string") throw new __velarTerminalNativeTypeError("Node terminal worker returned invalid input");
    if (message.ok && typeof message.value === "string") __velarTerminalBoundedText(message.value, "Terminal input");
  } else if (message.ok && message.value !== null) {
    throw new __velarTerminalNativeTypeError("Node terminal worker returned invalid write completion");
  }
  delete __velarTerminalPending[message.id];
  __velarTerminalPendingCount -= 1;
  __velarTerminalUpdateReference();
  if (responseError) pending.reject(responseError);
  else pending.resolve(message.value);
}

const __velarTerminalArguments = __velarTerminalProgramArguments();
const __velarTerminalReadyPromise = new __velarTerminalNativePromise((resolve, reject) => {
  __velarTerminalReadyResolve = resolve;
  __velarTerminalReadyReject = reject;
});
const __velarTerminalChannel = new __VelarTerminalMessageChannel();
const __velarTerminalPort = __velarTerminalChannel.port1;
__velarTerminalPort.onmessage = event => {
  try { __velarTerminalMessage(__velarTerminalCall(__velarTerminalMessageData, event, [])); }
  catch (error) { __velarTerminalFail(error); }
};
__velarTerminalPort.onmessageerror = () => __velarTerminalFail(new __velarTerminalNativeError("Node terminal worker returned an unreadable message"));
__velarTerminalCall(__velarTerminalMessagePortStart, __velarTerminalPort, []);
const __velarTerminalWorker = new __VelarTerminalWorker(