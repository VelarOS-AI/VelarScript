// Application-facing proxy for the isolated fd terminal host. It captures all
// validation, MessagePort and Worker operations before application code runs;
// stdin decoding and fd writes live in terminal-worker-runtime.ts.
export const VELAR_NODE_TERMINAL_RUNTIME = String.raw`
import { EventEmitter as __VelarTerminalEventEmitter } from "node:events";
import { closeSync as __velarTerminalCloseSync, fstatSync as __velarTerminalFstatSync, openSync as __velarTerminalOpenSync } from "node:fs";
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

function __velarTerminalUpdateReference() {
  const operation = __velarTerminalPendingCount > 0 || __velarTerminalClosing
    ? __velarTerminalMessagePortRef
    : __velarTerminalMessagePortUnref;
  __velarTerminalCall(operation, __velarTerminalPort, []);
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
  if (__velarTerminalOwnsInputDescriptor) {
    try { __velarTerminalCloseSync(__velarTerminalInputDescriptor); } catch {}
    __velarTerminalInputDescriptor = -1;
    __velarTerminalOwnsInputDescriptor = false;
  }
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
    if (__velarTerminalOwnsInputDescriptor) {
      try { __velarTerminalCloseSync(__velarTerminalInputDescriptor); }
      catch (error) {
        const code = error && typeof error === "object" ? __velarTerminalOwnDescriptor(error, "code") : null;
        if (!code || !("value" in code) || code.value !== "EBADF") throw error;
      }
      __velarTerminalInputDescriptor = -1;
      __velarTerminalOwnsInputDescriptor = false;
    }
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
let __velarTerminalInputDescriptor = 0;
let __velarTerminalOwnsInputDescriptor = false;
if (__velarTerminalProcess.platform !== "win32") {
  try {
    __velarTerminalInputDescriptor = __velarTerminalOpenSync("/dev/fd/0", "r");
    __velarTerminalOwnsInputDescriptor = true;
  }
  catch (error) {
    const code = error && typeof error === "object" ? __velarTerminalOwnDescriptor(error, "code") : null;
    if (!code || !("value" in code) || code.value !== "EACCES" && code.value !== "EBADF"
      && code.value !== "ENOENT" && code.value !== "ENXIO") throw error;
    try {
      __velarTerminalFstatSync(0);
      __velarTerminalInputDescriptor = 0;
    } catch {
      __velarTerminalInputDescriptor = -1;
    }
  }
}
__velarTerminalPort.onmessage = event => {
  try { __velarTerminalMessage(__velarTerminalCall(__velarTerminalMessageData, event, [])); }
  catch (error) { __velarTerminalFail(error); }
};
__velarTerminalPort.onmessageerror = () => __velarTerminalFail(new __velarTerminalNativeError("Node terminal worker returned an unreadable message"));
__velarTerminalCall(__velarTerminalMessagePortStart, __velarTerminalPort, []);
const __velarTerminalWorker = new __VelarTerminalWorker(WORKER_SOURCE, {
  eval: true,
  workerData: {port: __velarTerminalChannel.port2, inputDescriptor: __velarTerminalInputDescriptor},
  transferList: [__velarTerminalChannel.port2],
});
__velarTerminalCall(__velarTerminalEventOn, __velarTerminalWorker, ["error", error => __velarTerminalFail(error)]);
__velarTerminalCall(__velarTerminalEventOn, __velarTerminalWorker, ["exit", code => {
  if (!__velarTerminalExpectedWorkerExit) {
    __velarTerminalFail(new __velarTerminalNativeError("Node terminal worker exited unexpectedly with code " + code));
  }
}]);
const __velarTerminalReadyTimer = __velarTerminalSetTimeout(
  () => __velarTerminalReadyReject(new __velarTerminalNativeError("Node terminal worker did not become ready")),
  10000,
);
try { await __velarTerminalReadyPromise; }
finally { __velarTerminalClearTimeout(__velarTerminalReadyTimer); }
__velarTerminalCall(__velarTerminalWorkerUnref, __velarTerminalWorker, []);
__velarTerminalCall(__velarTerminalMessagePortUnref, __velarTerminalPort, []);

function __velarTerminalInvoke(operation, value) {
  if (__velarTerminalClosed) {
    if (__velarTerminalFailure) return new __velarTerminalNativePromise((_resolve, reject) => reject(__velarTerminalFailure));
    if (operation === "readLine") return new __velarTerminalNativePromise(resolve => resolve(null));
    return new __velarTerminalNativePromise((_resolve, reject) => reject(new __velarTerminalNativeError("Terminal is closed")));
  }
  if (__velarTerminalPendingCount >= __velarTerminalMaxPending) {
    return new __velarTerminalNativePromise((_resolve, reject) => reject(new __velarTerminalNativeRangeError("Terminal cannot have more than 256 pending operations")));
  }
  const id = __velarTerminalNextRequest;
  __velarTerminalNextRequest += 1;
  const result = new __velarTerminalNativePromise((resolve, reject) => {
    __velarTerminalPending[id] = {operation, resolve, reject};
  });
  __velarTerminalPendingCount += 1;
  __velarTerminalUpdateReference();
  try {
    __velarTerminalCall(__velarTerminalMessagePortPost, __velarTerminalPort, [{kind: "request", id, operation, value}]);
  } catch (error) {
    delete __velarTerminalPending[id];
    __velarTerminalPendingCount -= 1;
    __velarTerminalUpdateReference();
    return new __velarTerminalNativePromise((_resolve, reject) => reject(error));
  }
  return result;
}

export const terminal = __velarTerminalCall(__velarTerminalObjectFreeze, __velarTerminalNativeObject, [{
  args() { return __velarTerminalCall(__velarTerminalArraySlice, __velarTerminalArguments, []); },
  isInteractive() { return __velarTerminalInteractive; },
  readLine(prompt = "") { return __velarTerminalInvoke("readLine", __velarTerminalBoundedText(prompt, "Terminal prompt")); },
  write(text) { return __velarTerminalInvoke("write", __velarTerminalBoundedText(text, "Terminal write")); },
  writeError(text) { return __velarTerminalInvoke("writeError", __velarTerminalBoundedText(text, "Terminal error write")); },
  close() {
    if (__velarTerminalClosed) return null;
    __velarTerminalClosed = true;
    const keys = __velarTerminalCall(__velarTerminalOwnKeys, __velarTerminalNativeReflect, [__velarTerminalPending]);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = __velarTerminalOwnDescriptor(__velarTerminalPending, keys[index]);
      if (descriptor && "value" in descriptor) {
        if (descriptor.value.operation === "readLine") descriptor.value.resolve(null);
        else descriptor.value.reject(new __velarTerminalNativeError("Terminal closed before the write completed"));
      }
      delete __velarTerminalPending[keys[index]];
    }
    __velarTerminalPendingCount = 0;
    __velarTerminalClosing = true;
    __velarTerminalUpdateReference();
    __velarTerminalCall(__velarTerminalMessagePortPost, __velarTerminalPort, [{kind: "close"}]);
    return null;
  },
}]);
`.trimStart();
