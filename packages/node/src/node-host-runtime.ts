import { VELAR_ERROR_NORMALIZATION_MODULE, VELAR_HOST_ERROR_NAMES, VELAR_HOST_ERROR_PATH_NAMES } from "@velarscript/compiler/extension";

// Application-facing proxy for the shared privileged Node worker. This module
// is a private compiler-extension dependency and has no VelarScript interface.
export const VELAR_NODE_HOST_RUNTIME = String.raw`
import { ${VELAR_HOST_ERROR_NAMES.map((name) => `${name} as __Velar${name}`).join(", ")} } from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)};
import { EventEmitter as __VelarNodeHostEventEmitter } from "node:events";
import { MessageChannel as __VelarNodeHostMessageChannel, MessagePort as __VelarNodeHostMessagePort, Worker as __VelarNodeHostWorker } from "node:worker_threads";

const __velarNodeHostArray = globalThis.Array;
const __velarNodeHostError = globalThis.Error;
const __velarNodeHostNumber = globalThis.Number;
const __velarNodeHostObject = globalThis.Object;
const __velarNodeHostPromise = globalThis.Promise;
const __velarNodeHostRangeError = globalThis.RangeError;
const __velarNodeHostReflect = globalThis.Reflect;
const __velarNodeHostString = globalThis.String;
const __velarNodeHostTypeError = globalThis.TypeError;
const __velarNodeHostOwnDescriptor = __velarNodeHostObject.getOwnPropertyDescriptor;
const __velarNodeHostApply = __velarNodeHostReflect.apply;
function __velarNodeHostDataOperation(target, name) {
  const descriptor = __velarNodeHostOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarNodeHostError("VelarScript Node host operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarNodeHostArrayIsArray = __velarNodeHostDataOperation(__velarNodeHostArray, "isArray");
const __velarNodeHostNumberIsSafeInteger = __velarNodeHostDataOperation(__velarNodeHostNumber, "isSafeInteger");
const __velarNodeHostObjectCreate = __velarNodeHostDataOperation(__velarNodeHostObject, "create");
const __velarNodeHostObjectGetPrototypeOf = __velarNodeHostDataOperation(__velarNodeHostObject, "getPrototypeOf");
const __velarNodeHostOwnKeys = __velarNodeHostDataOperation(__velarNodeHostReflect, "ownKeys");
const __velarNodeHostMessagePortPost = __velarNodeHostDataOperation(__VelarNodeHostMessagePort.prototype, "postMessage");
const __velarNodeHostMessagePortStart = __velarNodeHostDataOperation(__VelarNodeHostMessagePort.prototype, "start");
const __velarNodeHostMessagePortRef = __velarNodeHostDataOperation(__VelarNodeHostMessagePort.prototype, "ref");
const __velarNodeHostMessagePortUnref = __velarNodeHostDataOperation(__VelarNodeHostMessagePort.prototype, "unref");
const __velarNodeHostMessagePortClose = __velarNodeHostDataOperation(__VelarNodeHostMessagePort.prototype, "close");
const __velarNodeHostWorkerUnref = __velarNodeHostDataOperation(__VelarNodeHostWorker.prototype, "unref");
const __velarNodeHostWorkerTerminate = __velarNodeHostDataOperation(__VelarNodeHostWorker.prototype, "terminate");
const __velarNodeHostEventOn = __velarNodeHostDataOperation(__VelarNodeHostEventEmitter.prototype, "on");
const __velarNodeHostPromiseThen = __velarNodeHostDataOperation(__velarNodeHostPromise.prototype, "then");
const __velarNodeHostMessageData = __velarNodeHostOwnDescriptor(globalThis.MessageEvent.prototype, "data")?.get;
if (typeof __velarNodeHostMessageData !== "function") throw new __velarNodeHostError("Node host MessageEvent data operation is unavailable");
const __velarNodeHostSetTimeout = globalThis.setTimeout;
const __velarNodeHostClearTimeout = globalThis.clearTimeout;
const __velarNodeHostPending = __velarNodeHostApply(__velarNodeHostObjectCreate, __velarNodeHostObject, [null]);
const __velarNodeHostEventHandlers = __velarNodeHostApply(__velarNodeHostObjectCreate, __velarNodeHostObject, [null]);
const __velarNodeHostActiveHttpHandles = __velarNodeHostApply(__velarNodeHostObjectCreate, __velarNodeHostObject, [null]);
const __velarNodeHostActiveFileWatchers = __velarNodeHostApply(__velarNodeHostObjectCreate, __velarNodeHostObject, [null]);
// Data-plane work may be saturated by application I/O without starving the
// response/stop control plane. A single shared counter made it possible for
// 1,024 slow filesystem or body reads to prevent even serve.fail/serve.stop
// from crossing the worker boundary.
const __velarNodeHostMaxDataPending = 4096;
const __velarNodeHostMaxServePending = 4608;
let __velarNodeHostNextRequest = 1;
let __velarNodeHostDataPendingCount = 0;
let __velarNodeHostServePendingCount = 0;
let __velarNodeHostActiveServers = 0;
let __velarNodeHostActiveHttpRequests = 0;
let __velarNodeHostActiveWatcherCount = 0;
let __velarNodeHostReady = false;
let __velarNodeHostFailure = null;
let __velarNodeHostReadyResolve;
let __velarNodeHostReadyReject;

function __velarNodeHostCall(operation, receiver, args) {
  return __velarNodeHostApply(operation, receiver, args);
}

function __velarNodeHostRecord(value, name) {
  if (!value || typeof value !== "object" || __velarNodeHostCall(__velarNodeHostArrayIsArray, __velarNodeHostArray, [value])) {
    throw new __velarNodeHostTypeError(name + " must be a record");
  }
  const prototype = __velarNodeHostCall(__velarNodeHostObjectGetPrototypeOf, __velarNodeHostObject, [value]);
  if (prototype !== __velarNodeHostObject.prototype && prototype !== null) throw new __velarNodeHostTypeError(name + " must be a plain record");
  const output = __velarNodeHostCall(__velarNodeHostObjectCreate, __velarNodeHostObject, [null]);
  const keys = __velarNodeHostCall(__velarNodeHostOwnKeys, __velarNodeHostReflect, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw new __velarNodeHostTypeError(name + " fields must use string names");
    const descriptor = __velarNodeHostOwnDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarNodeHostTypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}

export class __velarNodeHostHttpTransportError extends __velarNodeHostError {
  constructor(message, phase) {
    super(message);
    this.name = "HttpTransportError";
    this.phase = phase;
  }
}

const __velarNodeHostPathErrorClasses = __velarNodeHostObjectCreate(null);
${VELAR_HOST_ERROR_PATH_NAMES.map((name) => `__velarNodeHostPathErrorClasses[${JSON.stringify(name)}] = __Velar${name};`).join("\n")}

// This function must never throw. Its caller runs inside the port handler,
// whose catch latches the permanent host failure, closes the port and
// terminates the worker, so one error record the proxy failed to enumerate
// would brick velar/fs, velar/http and velar/serve for the whole process. An
// unrecognised record rejects only its own request instead.
function __velarNodeHostErrorOf(value, operation) {
  try { value = __velarNodeHostRecord(value, "Node host error"); }
  catch { return new __velarNodeHostTypeError("Node host returned an invalid error"); }
  if (typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536) {
    return new __velarNodeHostTypeError("Node host returned an invalid error");
  }
  if (value.name === "HttpTransportError") {
    if ((operation !== "http.request" && operation !== "http.read" && operation !== "http.readBytes")
      || (value.phase !== "request" && value.phase !== "response")
      || (operation === "http.request" ? value.phase !== "request" : value.phase !== "response")) {
      return new __velarNodeHostTypeError("Node host returned an invalid HTTP transport error");
    }
    return new __velarNodeHostHttpTransportError(value.message, value.phase);
  }
  // D50 rule 89: the worker names the failures a caller recovers from
  // differently. Only the class name and its path cross the boundary; the
  // proxy rebuilds the Realm-owned class so no privileged object escapes.
  const pathed = __velarNodeHostPathErrorClasses[value.name];
  if (pathed) {
    if (typeof value.path !== "string" || value.path.length > 65536) {
      return new __velarNodeHostTypeError("Node host returned an invalid error path");
    }
    return new pathed(value.message, value.path.length > 0 ? value.path : null);
  }
  if (value.name === "AddressInUseError") return new __VelarAddressInUseError(value.message);
  if (value.name === "RangeError") return new __velarNodeHostRangeError(value.message);
  if (value.name === "TypeError") return new __velarNodeHostTypeError(value.message);
  if (value.name === "Error") return new __velarNodeHostError(value.message);
  return new __velarNodeHostTypeError("Node host returned an invalid error");
}

function __velarNodeHostUpdateReference() {
  const operation = __velarNodeHostDataPendingCount + __velarNodeHostServePendingCount > 0 || __velarNodeHostActiveServers > 0 || __velarNodeHostActiveHttpRequests > 0 || __velarNodeHostActiveWatcherCount > 0
    ? __velarNodeHostMessagePortRef
    : __velarNodeHostMessagePortUnref;
  __velarNodeHostCall(operation, __velarNodeHostPort, []);
}

function __velarNodeHostRequestId() {
  let attempts = 0;
  while (__velarNodeHostOwnDescriptor(__velarNodeHostPending, __velarNodeHostString(__velarNodeHostNextRequest))) {
    __velarNodeHostNextRequest = __velarNodeHostNextRequest >= __velarNodeHostNumber.MAX_SAFE_INTEGER
      ? 1
      : __velarNodeHostNextRequest + 1;
    attempts += 1;
    if (attempts > __velarNodeHostMaxDataPending + __velarNodeHostMaxServePending) throw new __velarNodeHostRangeError("Node host request identity space is unavailable");
  }
  const id = __velarNodeHostNextRequest;
  __velarNodeHostNextRequest = id >= __velarNodeHostNumber.MAX_SAFE_INTEGER ? 1 : id + 1;
  return id;
}

function __velarNodeHostFail(error) {
  if (__velarNodeHostFailure) return;
  const failure = error instanceof __velarNodeHostError ? error : new __velarNodeHostError("Node host worker failed");
  __velarNodeHostFailure = failure;
  if (!__velarNodeHostReady) __velarNodeHostReadyReject(failure);
  const keys = __velarNodeHostCall(__velarNodeHostOwnKeys, __velarNodeHostReflect, [__velarNodeHostPending]);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = __velarNodeHostOwnDescriptor(__velarNodeHostPending, keys[index]);
    if (descriptor && "value" in descriptor) descriptor.value.reject(failure);
    delete __velarNodeHostPending[keys[index]];
  }
  __velarNodeHostDataPendingCount = 0;
  __velarNodeHostServePendingCount = 0;
  __velarNodeHostActiveServers = 0;
  __velarNodeHostActiveHttpRequests = 0;
  __velarNodeHostActiveWatcherCount = 0;
  const httpKeys = __velarNodeHostCall(__velarNodeHostOwnKeys, __velarNodeHostReflect, [__velarNodeHostActiveHttpHandles]);
  for (let index = 0; index < httpKeys.length; index += 1) delete __velarNodeHostActiveHttpHandles[httpKeys[index]];
  const watcherKeys = __velarNodeHostCall(__velarNodeHostOwnKeys, __velarNodeHostReflect, [__velarNodeHostActiveFileWatchers]);
  for (let index = 0; index < watcherKeys.length; index += 1) delete __velarNodeHostActiveFileWatchers[watcherKeys[index]];
  __velarNodeHostUpdateReference();
  __velarNodeHostCall(__velarNodeHostMessagePortClose, __velarNodeHostPort, []);
  const terminated = __velarNodeHostCall(__velarNodeHostWorkerTerminate, __velarNodeHostWorker, []);
  __velarNodeHostCall(__velarNodeHostPromiseThen, terminated, [() => null, () => null]);
}

function __velarNodeHostMessage(value) {
  const message = __velarNodeHostRecord(value, "Node host message");
  if (message.kind === "ready") {
    if (__velarNodeHostReady) throw new __velarNodeHostError("Node host worker sent duplicate readiness");
    __velarNodeHostReady = true;
    __velarNodeHostReadyResolve(null);
    return;
  }
  if (message.kind === "event") {
    if (message.event !== "serve.request" && message.event !== "serve.cancel" && message.event !== "serve.error") throw new __velarNodeHostTypeError("Node host worker returned an unknown event");
    const handler = __velarNodeHostOwnDescriptor(__velarNodeHostEventHandlers, message.event);
    if (!handler || !("value" in handler)) throw new __velarNodeHostError("Node host event has no registered owner");
    try { handler.value(message.value); }
    catch {
      const request = message.value && typeof message.value === "object" ? __velarNodeHostOwnDescriptor(message.value, "request") : null;
      if (message.event === "serve.request" && request && "value" in request) __velarNodeHostInvoke("serve.fail", [request.value]);
    }
    return;
  }
  if (message.kind !== "response" || !__velarNodeHostCall(__velarNodeHostNumberIsSafeInteger, __velarNodeHostNumber, [message.id])
    || message.id < 1 || typeof message.ok !== "boolean") {
    throw new __velarNodeHostTypeError("Node host worker returned an invalid response");
  }
  const descriptor = __velarNodeHostOwnDescriptor(__velarNodeHostPending, __velarNodeHostString(message.id));
  if (!descriptor || !("value" in descriptor)) throw new __velarNodeHostError("Node host worker returned an unknown response");
  const pending = descriptor.value;
  const responseError = message.ok ? null : __velarNodeHostErrorOf(message.error, pending.operation);
  let activeHttpDelta = 0;
  let activeWatcherDelta = 0;
  if (message.ok && pending.operation === "http.request") {
    const result = __velarNodeHostRecord(message.value, "Node HTTP response");
    const body = __velarNodeHostOwnDescriptor(result, "body");
    if (!body || !("value" in body) || typeof body.value !== "boolean") throw new __velarNodeHostTypeError("Node host returned an invalid HTTP response");
    if (body.value) {
      const key = __velarNodeHostString(pending.handle);
      if (__velarNodeHostOwnDescriptor(__velarNodeHostActiveHttpHandles, key)) throw new __velarNodeHostError("Node host returned a duplicate HTTP handle");
      __velarNodeHostActiveHttpHandles[key] = true;
      activeHttpDelta = 1;
    }
  } else if (message.ok && (pending.operation === "http.close" || pending.operation === "http.cancel")) {
    if (typeof message.value !== "boolean") throw new __velarNodeHostTypeError("Node host returned an invalid HTTP release result");
    const key = __velarNodeHostString(pending.handle);
    if (message.value && __velarNodeHostOwnDescriptor(__velarNodeHostActiveHttpHandles, key)) {
      delete __velarNodeHostActiveHttpHandles[key];
      activeHttpDelta = -1;
    }
  }
  if (message.ok && pending.operation === "fs.watchStart") {
    if (!__velarNodeHostCall(__velarNodeHostNumberIsSafeInteger, __velarNodeHostNumber, [message.value]) || message.value < 1) {
      throw new __velarNodeHostTypeError("Node host returned an invalid file watcher handle");
    }
    const key = __velarNodeHostString(message.value);
    if (__velarNodeHostOwnDescriptor(__velarNodeHostActiveFileWatchers, key)) throw new __velarNodeHostError("Node host returned a duplicate file watcher handle");
    __velarNodeHostActiveFileWatchers[key] = true;
    activeWatcherDelta = 1;
  } else if (pending.operation === "fs.watchNext" && (!message.ok || message.value === null)) {
    const key = __velarNodeHostString(pending.handle);
    if (__velarNodeHostOwnDescriptor(__velarNodeHostActiveFileWatchers, key)) {
      delete __velarNodeHostActiveFileWatchers[key];
      activeWatcherDelta = -1;
    }
  } else if (message.ok && pending.operation === "fs.watchClose") {
    if (typeof message.value !== "boolean") throw new __velarNodeHostTypeError("Node host returned an invalid file watcher release result");
    const key = __velarNodeHostString(pending.handle);
    if (message.value && __velarNodeHostOwnDescriptor(__velarNodeHostActiveFileWatchers, key)) {
      delete __velarNodeHostActiveFileWatchers[key];
      activeWatcherDelta = -1;
    }
  }
  delete __velarNodeHostPending[message.id];
  if (pending.serveLane) __velarNodeHostServePendingCount -= 1;
  else __velarNodeHostDataPendingCount -= 1;
  if (message.ok && pending.operation === "serve.start") __velarNodeHostActiveServers += 1;
  else if (message.ok && pending.operation === "serve.stop" && __velarNodeHostActiveServers > 0) __velarNodeHostActiveServers -= 1;
  __velarNodeHostActiveHttpRequests += activeHttpDelta;
  __velarNodeHostActiveWatcherCount += activeWatcherDelta;
  __velarNodeHostUpdateReference();
  if (message.ok) pending.resolve(message.value);
  else pending.reject(responseError);
}

const __velarNodeHostReadyPromise = new __velarNodeHostPromise((resolve, reject) => {
  __velarNodeHostReadyResolve = resolve;
  __velarNodeHostReadyReject = reject;
});
const __velarNodeHostChannel = new __VelarNodeHostMessageChannel();
const __velarNodeHostPort = __velarNodeHostChannel.port1;
__velarNodeHostPort.onmessage = event => {
  try { __velarNodeHostMessage(__velarNodeHostCall(__velarNodeHostMessageData, event, [])); }
  catch (error) { __velarNodeHostFail(error); }
};
__velarNodeHostPort.onmessageerror = () => __velarNodeHostFail(new __velarNodeHostError("Node host worker returned an unreadable message"));
__velarNodeHostCall(__velarNodeHostMessagePortStart, __velarNodeHostPort, []);
const __velarNodeHostWorker = new __VelarNodeHostWorker(WORKER_SOURCE, {
  eval: true,
  workerData: __velarNodeHostChannel.port2,
  transferList: [__velarNodeHostChannel.port2],
});
__velarNodeHostCall(__velarNodeHostEventOn, __velarNodeHostWorker, ["error", () => __velarNodeHostFail(new __velarNodeHostError("Node host worker failed"))]);
__velarNodeHostCall(__velarNodeHostEventOn, __velarNodeHostWorker, ["exit", code => {
  __velarNodeHostFail(new __velarNodeHostError("Node host worker exited unexpectedly with code " + code));
}]);
const __velarNodeHostReadyTimer = __velarNodeHostCall(__velarNodeHostSetTimeout, globalThis, [
  () => __velarNodeHostReadyReject(new __velarNodeHostError("Node host worker did not become ready")),
  10000,
]);
try { await __velarNodeHostReadyPromise; }
finally { __velarNodeHostCall(__velarNodeHostClearTimeout, globalThis, [__velarNodeHostReadyTimer]); }
__velarNodeHostCall(__velarNodeHostWorkerUnref, __velarNodeHostWorker, []);
__velarNodeHostCall(__velarNodeHostMessagePortUnref, __velarNodeHostPort, []);

export function __velarNodeHostInvoke(operation, args) {
  if (typeof operation !== "string" || operation.length === 0 || !__velarNodeHostCall(__velarNodeHostArrayIsArray, __velarNodeHostArray, [args])) {
    return new __velarNodeHostPromise((_resolve, reject) => reject(new __velarNodeHostTypeError("Node host invocation is invalid")));
  }
  const serveLane = operation === "serve.start" || operation === "serve.stop" || operation === "serve.respond"
    || operation === "serve.respondFile" || operation === "serve.streamStart" || operation === "serve.streamWrite"
    || operation === "serve.streamEnd" || operation === "serve.fail";
  if (serveLane ? __velarNodeHostServePendingCount >= __velarNodeHostMaxServePending : __velarNodeHostDataPendingCount >= __velarNodeHostMaxDataPending) {
    const message = serveLane
      ? "Node serve control plane cannot have more than 4608 pending operations"
      : "Node host data plane cannot have more than 4096 pending operations";
    return new __velarNodeHostPromise((_resolve, reject) => reject(new __velarNodeHostRangeError(message)));
  }
  if (__velarNodeHostFailure) return new __velarNodeHostPromise((_resolve, reject) => reject(__velarNodeHostFailure));
  const id = __velarNodeHostRequestId();
  return new __velarNodeHostPromise((resolve, reject) => {
    const handle = operation === "http.request" || operation === "http.read" || operation === "http.readBytes"
      || operation === "http.cancel" || operation === "http.close"
      || operation === "fs.watchNext" || operation === "fs.watchClose"
      ? args[0]
      : null;
    __velarNodeHostPending[id] = {operation, handle, serveLane, resolve, reject};
    if (serveLane) __velarNodeHostServePendingCount += 1;
    else __velarNodeHostDataPendingCount += 1;
    __velarNodeHostUpdateReference();
    try { __velarNodeHostCall(__velarNodeHostMessagePortPost, __velarNodeHostPort, [{id, operation, args}]); }
    catch (error) {
      delete __velarNodeHostPending[id];
      if (serveLane) __velarNodeHostServePendingCount -= 1;
      else __velarNodeHostDataPendingCount -= 1;
      __velarNodeHostUpdateReference();
      reject(error);
    }
  });
}

export function __velarNodeHostOn(event, handler) {
  if (event !== "serve.request" && event !== "serve.cancel" && event !== "serve.error" || typeof handler !== "function") throw new __velarNodeHostTypeError("Node host event registration is invalid");
  if (__velarNodeHostFailure) throw __velarNodeHostFailure;
  if (__velarNodeHostOwnDescriptor(__velarNodeHostEventHandlers, event)) throw new __velarNodeHostError("Node host event already has an owner");
  __velarNodeHostEventHandlers[event] = handler;
  return null;
}
`.trimStart();
