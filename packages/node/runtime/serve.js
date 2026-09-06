import { __velarNodeHostInvoke, __velarNodeHostOn } from "velar/node-host-v1";
import { normalizeError as __velarServeNormalizeError } from "velar/compiler-runtime-errors-v1";
import { __velarValidateDenseList as __velarServeValidateDenseList } from "velar/compiler-runtime-collection-lowering-v1";
import { Bytes as __velarServeBytesType } from "velar/binary";
import { canonical as __velarServeFsCanonical, info as __velarServeFsInfo, readText as __velarServeFsReadText, writeBytes as __velarServeWriteBytes } from "velar/fs";
import { onShutdown as __velarServeOnShutdown } from "velar/host";
import { Cancellation as __velarServeCancellation } from "velar/task";

const __velarServeArray = globalThis.Array;
const __velarServeError = globalThis.Error;
const __velarServeMap = globalThis.Map;
const __velarServeNumber = globalThis.Number;
const __velarServeObject = globalThis.Object;
const __velarServeRangeError = globalThis.RangeError;
const __velarServeRegExp = globalThis.RegExp;
const __velarServeReflect = globalThis.Reflect;
const __velarServeString = globalThis.String;
const __velarServePromise = globalThis.Promise;
const __velarServeTypeError = globalThis.TypeError;
const __velarServeUint8Array = globalThis.Uint8Array;
const __velarServeWeakMap = globalThis.WeakMap;
const __velarServeDate = globalThis.Date;
const __velarServeMath = globalThis.Math;
const __velarServeTextDecoder = globalThis.TextDecoder;
const __velarServeTextEncoder = globalThis.TextEncoder;
const __velarServeOwnDescriptor = __velarServeObject.getOwnPropertyDescriptor;
const __velarServeApply = __velarServeReflect.apply;
const __velarServeConsole = globalThis.console;
const __velarServeConsoleErrorDescriptor = __velarServeConsole && (typeof __velarServeConsole === "object" || typeof __velarServeConsole === "function")
  ? __velarServeOwnDescriptor(__velarServeConsole, "error")
  : null;
const __velarServeConsoleError = __velarServeConsoleErrorDescriptor && "value" in __velarServeConsoleErrorDescriptor
  ? __velarServeConsoleErrorDescriptor.value
  : null;
function __velarServeDataOperation(target, name) {
  const descriptor = __velarServeOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarServeError("VelarScript serve operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarServeArrayIsArray = __velarServeDataOperation(__velarServeArray, "isArray");
const __velarServeArrayIncludes = __velarServeDataOperation(__velarServeArray.prototype, "includes");
const __velarServeArrayJoin = __velarServeDataOperation(__velarServeArray.prototype, "join");
const __velarServeTextDecode = __velarServeDataOperation(__velarServeTextDecoder.prototype, "decode");
const __velarServeUtf8Decoder = new __velarServeTextDecoder("utf-8", {fatal: true, ignoreBOM: true});
const __velarServeTextEncode = __velarServeDataOperation(__velarServeTextEncoder.prototype, "encode");
const __velarServeUtf8Encoder = new __velarServeTextEncoder();
const __velarServeNumberIsFinite = __velarServeDataOperation(__velarServeNumber, "isFinite");
const __velarServeNumberIsSafeInteger = __velarServeDataOperation(__velarServeNumber, "isSafeInteger");
const __velarServeNumberToString = __velarServeDataOperation(__velarServeNumber.prototype, "toString");
const __velarServeObjectCreate = __velarServeDataOperation(__velarServeObject, "create");
const __velarServeObjectDefineProperty = __velarServeDataOperation(__velarServeObject, "defineProperty");
const __velarServeObjectFreeze = __velarServeDataOperation(__velarServeObject, "freeze");
const __velarServeObjectGetPrototypeOf = __velarServeDataOperation(__velarServeObject, "getPrototypeOf");
const __velarServeTypedArrayPrototype = __velarServeApply(__velarServeObjectGetPrototypeOf, __velarServeObject, [__velarServeUint8Array.prototype]);
const __velarServeUint8Slice = __velarServeDataOperation(__velarServeTypedArrayPrototype, "slice");
const __velarServeUint8Subarray = __velarServeDataOperation(__velarServeTypedArrayPrototype, "subarray");
const __velarServeUint8Set = __velarServeDataOperation(__velarServeTypedArrayPrototype, "set");
const __velarServeOwnKeys = __velarServeDataOperation(__velarServeReflect, "ownKeys");
const __velarServeMapEntries = __velarServeDataOperation(__velarServeMap.prototype, "entries");
const __velarServeMapGet = __velarServeDataOperation(__velarServeMap.prototype, "get");
const __velarServeMapHas = __velarServeDataOperation(__velarServeMap.prototype, "has");
const __velarServeMapSet = __velarServeDataOperation(__velarServeMap.prototype, "set");
const __velarServeMapDelete = __velarServeDataOperation(__velarServeMap.prototype, "delete");
const __velarServeMapClear = __velarServeDataOperation(__velarServeMap.prototype, "clear");
const __velarServeMapSize = __velarServeOwnDescriptor(__velarServeMap.prototype, "size")?.get;
const __velarServeMapIterator = __velarServeApply(__velarServeMapEntries, new __velarServeMap(), []);
const __velarServeMapIteratorNext = __velarServeDataOperation(__velarServeApply(__velarServeObjectGetPrototypeOf, __velarServeObject, [__velarServeMapIterator]), "next");
const __velarServeWeakMapGet = __velarServeDataOperation(__velarServeWeakMap.prototype, "get");
const __velarServeWeakMapHas = __velarServeDataOperation(__velarServeWeakMap.prototype, "has");
const __velarServeWeakMapSet = __velarServeDataOperation(__velarServeWeakMap.prototype, "set");
const __velarServeWeakMapDelete = __velarServeDataOperation(__velarServeWeakMap.prototype, "delete");
const __velarServeStringIncludes = __velarServeDataOperation(__velarServeString.prototype, "includes");
const __velarServeStringEndsWith = __velarServeDataOperation(__velarServeString.prototype, "endsWith");
const __velarServeStringIndexOf = __velarServeDataOperation(__velarServeString.prototype, "indexOf");
const __velarServeStringLastIndexOf = __velarServeDataOperation(__velarServeString.prototype, "lastIndexOf");
const __velarServeStringSlice = __velarServeDataOperation(__velarServeString.prototype, "slice");
const __velarServeStringSplit = __velarServeDataOperation(__velarServeString.prototype, "split");
const __velarServeStringStartsWith = __velarServeDataOperation(__velarServeString.prototype, "startsWith");
const __velarServeStringToLowerCase = __velarServeDataOperation(__velarServeString.prototype, "toLowerCase");
const __velarServeStringTrim = __velarServeDataOperation(__velarServeString.prototype, "trim");
const __velarServeDateNow = __velarServeDataOperation(__velarServeDate, "now");
const __velarServeDateParse = __velarServeDataOperation(__velarServeDate, "parse");
const __velarServeMathFloor = __velarServeDataOperation(__velarServeMath, "floor");
const __velarServeMathMax = __velarServeDataOperation(__velarServeMath, "max");
const __velarServePromiseRace = __velarServeDataOperation(__velarServePromise, "race");
const __velarServePromiseThen = __velarServeDataOperation(__velarServePromise.prototype, "then");
const __velarServeSetTimeout = globalThis.setTimeout;
const __velarServeClearTimeout = globalThis.clearTimeout;
const __velarServeAtob = globalThis.atob;
const __velarServeDecodeURIComponent = globalThis.decodeURIComponent;
const __velarServeEncodeURIComponent = globalThis.encodeURIComponent;
const __velarServeRegExpTest = __velarServeDataOperation(__velarServeRegExp.prototype, "test");
const __velarServeHeaderNamePattern = /^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u;
const __velarServeHeaderValuePattern = /[\0\r\n]/u;
const __velarServeMethodPattern = /^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u;
const __velarServeRouteCapturePattern = /^\{[A-Za-z_][A-Za-z0-9_]*:[A-Za-z_][A-Za-z0-9_]*\}$/u;
const __velarServeRouteNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const __velarServeOperationIdCharacterPattern = /^[A-Za-z0-9]$/u;
const __velarServeDecimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
const __velarServeProblemReasonPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const __velarServeAbsolutePathPattern = /^(?:[/\\]|[A-Za-z]:[/\\])/u;
const __velarServeMaxBodyBytes = 16 * 1024 * 1024;
const __velarServeMaxPathCodeUnits = 4096;
const __velarServeMaxRoutes = 4096;
const __velarServeMaxLifecycles = 4096;
const __velarServeMaxRequestProviders = 256;
const __velarServeMaxAppProviders = 512;
const __velarServeMaxOutboundBytes = 128 * 1024 * 1024;
const __velarServeMaxBackgroundTasks = 1024;
const __velarServeMaxActiveTimeouts = 256;
const __velarServeDefaultShutdownGrace = 30_000;
const __velarServeFileMarker = Symbol("velar.serve.file-response");
const __velarServeAppMarker = Symbol("velar.serve.app");
const __velarServeRouteMarker = Symbol("velar.serve.route");
const __velarServeWebSocketMarker = Symbol("velar.serve.websocket-route");
const __velarServePatternMarker = Symbol("velar.serve.route-pattern");
const __velarServeNotFoundMarker = Symbol("velar.serve.not-found");
const __velarServeResponseHandlerMarker = Symbol("velar.serve.response-handler");
const __velarServeOutcomeMarker = Symbol("velar.serve.http-outcome");
const __velarServeInputMarker = Symbol("velar.serve.input");
const __velarServeProviderMarker = Symbol("velar.serve.provider");
const __velarServeUploadMarker = Symbol("velar.serve.upload");
const __velarServeManagedResponseMarker = Symbol("velar.serve.managed-response");
const __velarServeMissing = Symbol("velar.serve.missing");
const __velarServeHandlers = new __velarServeMap();
const __velarServeHostCancellations = new __velarServeMap();
const __velarServeSerializedJson = new __velarServeWeakMap();
// SV-D4: the failure a route ended with, kept against that request so the
// response can carry the middleware's headers while middleware.errors keeps the
// error-recovery role its documentation gives it.
const __velarServeRouteFailures = new __velarServeWeakMap();
const __velarServeResponseCookies = new __velarServeWeakMap();
const __velarServeReservedBackground = new __velarServeWeakMap();
const __velarServeTimeoutSettlements = new __velarServeWeakMap();
// 没有捕获值的内部匹配结果不暴露给应用，可以安全共享一个空对象。
const __velarServeEmptyRouteValues = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [__velarServeCall(__velarServeObjectCreate, __velarServeObject, [null])]);
const __velarServeResponseFields = __velarServeFieldMap(["status", "json", "text", "contentType", "stream", "headers", "background", "compression"]);
const __velarServeBodyFields = __velarServeFieldMap(["text", "bytes", "tooLarge"]);
const __velarServeBodyBytesFields = __velarServeFieldMap(["data", "bytes", "tooLarge"]);
const __velarServeRequestFields = __velarServeFieldMap(["token", "request", "method", "path", "query", "headers"]);
const __velarServeStartFields = __velarServeFieldMap(["handle", "port"]);
const __velarServeTestFileFields = __velarServeFieldMap(["data", "contentType"]);
const __velarServeTestUploadFields = __velarServeFieldMap(["filename", "contentType", "data"]);
const __velarServeRouteParameterFields = __velarServeFieldMap(["name", "source", "kind", "required", "check", "schema", "input"]);
const __velarServePatternFields = __velarServeFieldMap(["definition", "pathname", "path", "query"]);
const __velarServePatternCaptureFields = __velarServeFieldMap(["name", "wireName", "explicitWireName", "typeName", "optional", "kind", "check", "schema"]);
const __velarServeProblemFields = __velarServeFieldMap(["status", "reason", "title", "detail", "type", "instance", "source", "parameter", "headers"]);
const __velarServeResponseHandlerFields = __velarServeFieldMap(["responseSchema", "responseContentTypes"]);
const __velarServeRouteMetadataFields = __velarServeFieldMap(["operationId", "responseSchema", "responseContentTypes", "maxBodyBytes", "middleware", "documented", "summary", "description", "tags", "status", "errors"]);
const __velarServeWebSocketMetadataFields = __velarServeFieldMap(["operationId", "documented", "summary", "description", "tags"]);
const __velarServeRouteDocumentationFields = __velarServeFieldMap(["summary", "description", "tags", "status", "errors", "documented"]);
const __velarServeErrorDocumentationFields = __velarServeFieldMap(["status", "description"]);
let __velarServeNextToken = 1;
let __velarServeNextRequestId = 1;
let __velarServeNextTestBoundary = 1;
let __velarServeActiveTimeouts = 0;
let __velarServeActiveBackgroundTasks = 0;
let __velarServeOutboundBytes = 0;

function __velarServeCall(operation, receiver, args) {
  return __velarServeApply(operation, receiver, args);
}

function __velarServeFailureTrace(error) {
  try {
    const stack = __velarServeOwnDescriptor(error, "stack");
    if (stack && "value" in stack && typeof stack.value === "string" && stack.value !== "") return stack.value;
  } catch {}
  try {
    const message = __velarServeOwnDescriptor(error, "message");
    if (message && "value" in message && typeof message.value === "string" && message.value !== "") return message.value;
  } catch {}
  return "The request failed without an Error value";
}

// SV-I3: a client that goes away is not a handler that failed. These are the
// sentences the privileged transport (node-host-worker.js, node-host-worker-serve.js
// and node-host-static-file.js, the three files VELAR_NODE_HOST_WORKER_SOURCE
// composes) uses when the socket is gone before the response finished; they cross
// the MessagePort as text, so this is the one place that reads them, and the tests
// pin the pair.
const __velarServeDisconnectReports = [
  "Node serve client connection is closed",
  "Node serve request is unknown or already completed",
  "ServeResponse client connection is closed",
  "ServeResponse.stream client connection is closed",
];

function __velarServeClientHungUp(failure) {
  try {
    const error = __velarServeNormalizeError(failure);
    const message = __velarServeOwnDescriptor(error, "message");
    if (!message || !("value" in message) || typeof message.value !== "string") return false;
    return __velarServeCall(__velarServeArrayIncludes, __velarServeDisconnectReports, [message.value]) === true;
  } catch { return false; }
}

function __velarServeReportDisconnect(request) {
  try {
    if (typeof __velarServeConsoleError !== "function") return null;
    const method = typeof request?.method === "string" ? request.method : "?";
    const path = typeof request?.path === "string" ? request.path : "?";
    __velarServeCall(__velarServeConsoleError, __velarServeConsole, ["Client closed the connection before the response completed " + method + " " + path]);
  } catch {}
  return null;
}

function __velarServeReportFailure(failure) {
  try {
    if (typeof __velarServeConsoleError !== "function") return null;
    let error = null;
    try { error = __velarServeNormalizeError(failure); } catch {}
    const trace = error === null ? "The request failed without an Error value" : __velarServeFailureTrace(error);
    __velarServeCall(__velarServeConsoleError, __velarServeConsole, ["Unhandled server request failed: " + trace]);
  } catch {}
  return null;
}

function __velarServeFieldMap(names) {
  const output = new __velarServeMap();
  for (let index = 0; index < names.length; index += 1) __velarServeCall(__velarServeMapSet, output, [names[index], true]);
  return output;
}

function __velarServeIsArray(value) {
  return __velarServeCall(__velarServeArrayIsArray, __velarServeArray, [value]);
}

function __velarServeIsSafeInteger(value) {
  return __velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [value]);
}

function __velarServeReserveOutbound(bytes) {
  if (!__velarServeIsSafeInteger(bytes) || bytes < 0) throw new __velarServeRangeError("ServeResponse outbound byte reservation must be a non-negative integer");
  if (__velarServeOutboundBytes + bytes > __velarServeMaxOutboundBytes) throw new __velarServeOutboundBudgetError();
  __velarServeOutboundBytes += bytes;
}

function __velarServeReleaseOutbound(bytes) {
  __velarServeOutboundBytes -= bytes;
  if (__velarServeOutboundBytes < 0) __velarServeOutboundBytes = 0;
}

function __velarServeHeaderPairBytes(pairs) {
  let bytes = 0;
  for (let index = 0; index < pairs.length; index += 1) bytes += __velarUtf8ByteLength(pairs[index][0]) + __velarUtf8ByteLength(pairs[index][1]);
  return bytes;
}

async function __velarServeWithOutbound(bytes, action) {
  __velarServeReserveOutbound(bytes);
  try { return await action(); }
  finally { __velarServeReleaseOutbound(bytes); }
}

function __velarServePlainRecord(value, name) {
  if (!value || typeof value !== "object" || __velarServeIsArray(value)) throw new __velarServeTypeError(name + " must be a plain record");
  const prototype = __velarServeCall(__velarServeObjectGetPrototypeOf, __velarServeObject, [value]);
  if (prototype !== __velarServeObject.prototype && prototype !== null) throw new __velarServeTypeError(name + " must be a plain record");
  return value;
}

function __velarServeRecord(value, allowed, name) {
  value = __velarServePlainRecord(value, name);
  const output = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || !__velarServeCall(__velarServeMapHas, allowed, [key])) {
      throw new __velarServeTypeError(name + " has an unknown field");
    }
    const descriptor = __velarServeOwnDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarServeTypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}

function __velarServeDataField(value, key, name) {
  const descriptor = __velarServeOwnDescriptor(value, key);
  if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarServeTypeError(name + "." + key + " must be an enumerable data value");
  return descriptor.value;
}

function __velarServeMapSnapshot(value, name, maximum = 1000) {
  let size;
  let iterator;
  try {
    size = __velarServeCall(__velarServeMapSize, value, []);
    iterator = __velarServeCall(__velarServeMapEntries, value, []);
  } catch { throw new __velarServeTypeError(name + " must be a Map<string, string>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > maximum) throw new __velarServeRangeError(name + " cannot contain more than " + maximum + " fields");
  const output = [];
  let units = 0;
  while (true) {
    let step;
    try { step = __velarServeCall(__velarServeMapIteratorNext, iterator, []); }
    catch { throw new __velarServeTypeError(name + " must be a Map<string, string>"); }
    const done = __velarServeOwnDescriptor(step, "done");
    if (!done || !("value" in done) || typeof done.value !== "boolean") throw new __velarServeTypeError(name + " must be a Map<string, string>");
    if (done.value) break;
    const item = __velarServeOwnDescriptor(step, "value");
    if (!item || !("value" in item) || !__velarServeIsArray(item.value) || item.value.length !== 2) throw new __velarServeTypeError(name + " must be a Map<string, string>");
    const key = __velarServeOwnDescriptor(item.value, "0");
    const valueDescriptor = __velarServeOwnDescriptor(item.value, "1");
    if (!key || !("value" in key) || !valueDescriptor || !("value" in valueDescriptor)
      || typeof key.value !== "string" || typeof valueDescriptor.value !== "string") {
      throw new __velarServeTypeError(name + " must be a Map<string, string>");
    }
    units += key.value.length + valueDescriptor.value.length;
    if (units > 1024 * 1024) throw new __velarServeRangeError(name + " cannot exceed 1 MiB of text");
    output[output.length] = [key.value, valueDescriptor.value];
  }
  if (output.length !== size) throw new __velarServeTypeError(name + " changed while it was being read");
  return output;
}

function __velarServePairsMap(value, name) {
  if (!__velarServeIsArray(value) || value.length > 1000) throw new __velarServeTypeError(name + " host result is invalid");
  const output = new __velarServeMap();
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarServeOwnDescriptor(value, __velarServeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || !__velarServeIsArray(descriptor.value) || descriptor.value.length !== 2) {
      throw new __velarServeTypeError(name + " host result is invalid");
    }
    const key = __velarServeOwnDescriptor(descriptor.value, "0");
    const item = __velarServeOwnDescriptor(descriptor.value, "1");
    if (!key || !("value" in key) || !item || !("value" in item) || typeof key.value !== "string" || typeof item.value !== "string") {
      throw new __velarServeTypeError(name + " host result is invalid");
    }
    units += key.value.length + item.value.length;
    if (units > 1024 * 1024) throw new __velarServeRangeError(name + " host result exceeds 1 MiB");
    if (!__velarServeCall(__velarServeMapHas, output, [key.value])) __velarServeCall(__velarServeMapSet, output, [key.value, item.value]);
  }
  return output;
}

function __velarServePairsMaps(value, name) {
  if (!__velarServeIsArray(value) || value.length > 1000) throw new __velarServeTypeError(name + " host result is invalid");
  const values = new __velarServeMap();
  const all = new __velarServeMap();
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarServeOwnDescriptor(value, __velarServeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || !__velarServeIsArray(descriptor.value) || descriptor.value.length !== 2) {
      throw new __velarServeTypeError(name + " host result is invalid");
    }
    const key = __velarServeOwnDescriptor(descriptor.value, "0");
    const item = __velarServeOwnDescriptor(descriptor.value, "1");
    if (!key || !("value" in key) || !item || !("value" in item) || typeof key.value !== "string" || typeof item.value !== "string") {
      throw new __velarServeTypeError(name + " host result is invalid");
    }
    units += key.value.length + item.value.length;
    if (units > 1024 * 1024) throw new __velarServeRangeError(name + " host result exceeds 1 MiB");
    if (!__velarServeCall(__velarServeMapHas, values, [key.value])) {
      __velarServeCall(__velarServeMapSet, values, [key.value, item.value]);
      __velarServeCall(__velarServeMapSet, all, [key.value, [item.value]]);
    } else {
      const previous = __velarServeCall(__velarServeMapGet, all, [key.value]);
      if (previous.length >= 1000) throw new __velarServeRangeError(name + " contains too many repeated values");
      previous[previous.length] = item.value;
    }
  }
  const iterator = __velarServeCall(__velarServeMapEntries, all, []);
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [step.value[1]]);
  }
  return {values, all};
}

function __velarServeStringListMapSnapshot(value, name) {
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
  catch { throw new __velarServeTypeError(name + " must be a Map<string, List<string>>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > 1000) throw new __velarServeRangeError(name + " cannot contain more than 1000 fields");
  let fields = 0;
  let units = 0;
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2 || typeof step.value[0] !== "string" || !__velarServeIsArray(step.value[1]) || step.value[1].length < 1 || step.value[1].length > 1000) {
      throw new __velarServeTypeError(name + " must be a Map<string, List<string>>");
    }
    units += step.value[0].length;
    for (let index = 0; index < step.value[1].length; index += 1) {
      if (typeof step.value[1][index] !== "string") throw new __velarServeTypeError(name + " must be a Map<string, List<string>>");
      units += step.value[1][index].length;
    }
    if (units > 1024 * 1024) throw new __velarServeRangeError(name + " cannot exceed 1 MiB of text");
    fields += 1;
  }
  if (fields !== size) throw new __velarServeTypeError(name + " changed while it was being read");
  return true;
}

function __velarServeCanonicalPath(rawPath, name = "ServeRequest path") {
  if (typeof rawPath !== "string" || rawPath.length === 0 || !__velarServeCall(__velarServeStringStartsWith, rawPath, ["/"])) {
    throw new __velarServeTypeError(name + " must be an absolute URL path");
  }
  const source = __velarServeCall(__velarServeStringSplit, rawPath, ["/"]);
  const decoded = [];
  let units = 0;
  for (let index = 0; index < source.length; index += 1) {
    let segment;
    try { segment = __velarServeCall(__velarServeDecodeURIComponent, undefined, [source[index]]); }
    catch { throw new __velarServeTypeError(name + " must use valid percent-encoded UTF-8"); }
    if (__velarServeCall(__velarServeStringIncludes, segment, ["/"]) || __velarServeCall(__velarServeStringIncludes, segment, ["\\"])
      || __velarServeCall(__velarServeStringIncludes, segment, ["\0"]) || segment === "." || segment === "..") {
      throw new __velarServeTypeError(name + " contains an unsafe encoded segment");
    }
    units += segment.length + (index === 0 ? 0 : 1);
    if (units > __velarServeMaxPathCodeUnits) throw new __velarServeRangeError(name + " is too long");
    decoded[decoded.length] = segment;
  }
  return __velarServeCall(__velarServeArrayJoin, decoded, ["/"]);
}

function __velarServeTargetParts(target, name) {
  if (__velarServeCall(__velarServeStringIncludes, target, ["#"])) throw new __velarServeTypeError(name + " must not contain a URL fragment");
  const separator = __velarServeCall(__velarServeStringIndexOf, target, ["?"]);
  const path = __velarServeCanonicalPath(separator < 0 ? target : __velarServeCall(__velarServeStringSlice, target, [0, separator]), name + " path");
  const query = [];
  const source = separator < 0 ? "" : __velarServeCall(__velarServeStringSlice, target, [separator + 1]);
  if (source !== "") {
    const fields = __velarServeCall(__velarServeStringSplit, source, ["&"]);
    if (fields.length > 1000) throw new __velarServeRangeError(name + " query cannot contain more than 1000 fields");
    for (let index = 0; index < fields.length; index += 1) {
      const equals = __velarServeCall(__velarServeStringIndexOf, fields[index], ["="]);
      const rawName = equals < 0 ? fields[index] : __velarServeCall(__velarServeStringSlice, fields[index], [0, equals]);
      const rawValue = equals < 0 ? "" : __velarServeCall(__velarServeStringSlice, fields[index], [equals + 1]);
      try {
        query[query.length] = [
          __velarServeCall(__velarServeDecodeURIComponent, undefined, [__velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, rawName, ["+"]), [" "])]),
          __velarServeCall(__velarServeDecodeURIComponent, undefined, [__velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, rawValue, ["+"]), [" "])]),
        ];
      } catch { throw new __velarServeTypeError(name + " query must use valid percent-encoded UTF-8"); }
    }
  }
  return {path, query};
}

function __velarServeTypeObject(check, message, internal = null, compilerBridge = null) {
  const value = {
    is(candidate) { try { return check(candidate); } catch { return false; } },
    parse(candidate) { if (!check(candidate)) throw new __velarServeTypeError(message); return candidate; },
  };
  if (internal !== null) __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "__velarHandleNative", {value: internal, enumerable: false, configurable: false, writable: false}]);
  if (compilerBridge !== null) __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "__velarCompilerBridge", {value: compilerBridge, enumerable: false, configurable: false, writable: false}]);
  return __velarRegisterRuntimeType(__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [value]));
}

export class RequestBodyTooLargeError extends __velarServeRangeError {
  constructor(maxBytes) {
    super("Request body exceeds maxBytes (" + maxBytes + ")");
    __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [this, "name", {value: "RequestBodyTooLargeError", enumerable: false, configurable: true, writable: true}]);
    __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [this, "maxBytes", {value: maxBytes, enumerable: true, configurable: false, writable: false}]);
  }
}

export class HttpProblem extends __velarServeError {
  constructor(options) {
    const fields = __velarServeRecord(options, __velarServeProblemFields, "HttpProblem options");
    if (!__velarServeIsSafeInteger(fields.status) || fields.status < 400 || fields.status > 599) throw new __velarServeRangeError("HttpProblem status must be an HTTP error integer from 400 through 599");
    // D114 P6 item 12 (SV-D2/SV-C1): the semantic problem code is `reason`.
    // Charter section 11 gives every checked Error a `code` whose value is its
    // class name and forbids a subclass from redeclaring it, so the field that
    // used to be spelled `code` here was a shadow the emitter downgraded — the
    // declaration read `route.not_found` and every read answered "HttpProblem".
    // The wire problem document still publishes this value under its JSON name
    // `code`, which is the contract clients and OpenAPI already have.
    if (typeof fields.reason !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeProblemReasonPattern, [fields.reason])) throw new __velarServeTypeError("HttpProblem reason must be a stable lowercase identifier");
    // title 在公开类型中是可选字段；缺省时使用稳定的 HTTP 状态标题。这里必须
    // 与编译器契约一致，不能让一个静态合法的 HttpProblem 到请求阶段才变成 500。
    const title = __velarServeProblemText(fields.title, "HttpProblem title", false) ?? "HTTP " + fields.status;
    const detail = __velarServeProblemText(fields.detail, "HttpProblem detail", false);
    const type = __velarServeProblemText(fields.type, "HttpProblem type", false) ?? "about:blank";
    const instance = __velarServeProblemText(fields.instance, "HttpProblem instance", false);
    const source = __velarServeProblemText(fields.source, "HttpProblem source", false);
    const parameter = __velarServeProblemText(fields.parameter, "HttpProblem parameter", false);
    super(detail ?? title);
    __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [this, "name", {value: "HttpProblem", enumerable: false, configurable: true, writable: true}]);
    const properties = [["status", fields.status], ["reason", fields.reason], ["title", title], ["detail", detail], ["type", type], ["instance", instance], ["source", source], ["parameter", parameter], ["headers", __velarServeHeaders(fields.headers)]];
    for (let index = 0; index < properties.length; index += 1) {
      __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [this, properties[index][0], {value: properties[index][1], enumerable: true, configurable: false, writable: false}]);
    }
  }
}

function __velarServeProblemText(value, name, required) {
  if (value == null && !required) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\0\r\n]/u.test(value)) throw new __velarServeTypeError(name + " must be bounded single-line text");
  return value;
}

function __velarServeProblem(status, reason, title, detail = null, source = null, parameter = null, headers = null) {
  return new HttpProblem({status, reason, title, detail, source, parameter, headers});
}

/** 将各输入解析器的紧凑失败信息收口为公开的 HttpProblem 契约。 */
function __velarServeRequestProblem(status, body, headers = null) {
  const raw = typeof body?.error === "string" ? body.error : "invalid_request";
  const reason = (status >= 500 ? "server." : status === 401 ? "security." : "request.")
    + __velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, raw, ["_"]), ["."]);
  const title = status === 401 ? "Authentication required"
    : status === 413 ? "Request input is too large"
      : status === 415 ? "Unsupported request content type"
        : status === 422 ? "Request validation failed"
          : status >= 500 ? "Server could not complete the request"
            : "Malformed request input";
  const detail = typeof body?.expected === "string" ? "Expected " + body.expected : null;
  const parameter = typeof body?.parameter === "string" ? body.parameter : null;
  return __velarServeProblem(status, reason, title, detail, parameter === null ? null : "parameter", parameter, headers);
}

// Exhausting the aggregate outbound budget is a temporary load condition, not a
// server fault: 503 with retry-after is what a load balancer and a client both
// know how to act on, and 500 is what neither can. Most reserves happen while a
// response is already on its way out, past the HttpProblem catch in
// __velarServeHandleRequest, so both send paths recognize this one error by
// identity and answer it themselves. The shed answer reserves nothing: it is a
// fixed, tiny payload, and reserving for it would fail by construction.
class __velarServeOutboundBudgetError extends HttpProblem {
  constructor() {
    super({status: 503, reason: "server.outbound_budget", title: "Server is busy", headers: new __velarServeMap([["retry-after", "1"]])});
  }
}

function __velarServeIsOutcome(value) {
  if (!value || typeof value !== "object") return false;
  return __velarServeOwnDescriptor(value, __velarServeOutcomeMarker)?.value === true;
}

function __velarServeOutcome(value, status = 200, headers = null, problem = null, backgroundTasks = null) {
  if (!__velarServeIsSafeInteger(status) || status < 200 || status > 599) throw new __velarServeRangeError("HttpOutcome status must be an HTTP status integer from 200 through 599");
  if (problem !== null && !(problem instanceof HttpProblem)) throw new __velarServeTypeError("HttpOutcome problem must be HttpProblem or null");
  const outcome = {
    [__velarServeOutcomeMarker]: true,
    ok: problem === null && status < 400,
    status,
    value,
    problem,
    headers: __velarServeHeaders(headers),
  };
  if (backgroundTasks !== null) __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [outcome, "background", {value: backgroundTasks, enumerable: false, configurable: false, writable: false}]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [outcome]);
}

function __velarServeIsHttpOutcome(value) {
  return __velarServeIsOutcome(value) && typeof value.ok === "boolean" && __velarServeIsSafeInteger(value.status)
    && value.headers instanceof __velarServeMap && (value.problem === null || value.problem instanceof HttpProblem);
}

function __velarServeIsFileResponse(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeFileMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeResponse(value) {
  if (__velarServeIsFileResponse(value)) return value;
  const inheritedCookies = value && typeof value === "object" ? __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [value]) : undefined;
  // ServeResponse 在创建时已把 JSON 快照编码并校验过一次。后续的
  // finalize、中间件和传输边界会为了各自的信任边界再次复制响应
  // 外壳，但不应重复遍历同一份 JSON 数据。缓存跟随框架内部副本
  // 传递，因此一个响应始终表示创建它时的稳定快照。
  const inheritedSerialized = value && typeof value === "object"
    ? __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [value])
    : undefined;
  const fields = __velarServeRecord(value, __velarServeResponseFields, "ServeResponse");
  if (!__velarServeIsSafeInteger(fields.status) || fields.status < 200 || fields.status > 599) {
    throw new __velarServeRangeError("ServeResponse.status must be a final HTTP status integer from 200 through 599");
  }
  let bodies = 0;
  const bodyNames = ["json", "text", "stream"];
  for (let index = 0; index < bodyNames.length; index += 1) if (__velarServeOwnDescriptor(fields, bodyNames[index])) bodies += 1;
  if (bodies !== 1) throw new __velarServeTypeError("ServeResponse requires exactly one of json, text, or stream");
  if (__velarServeOwnDescriptor(fields, "json")) {
    const serialized = inheritedSerialized === undefined ? __velarJsonStringify(fields.json) : inheritedSerialized;
    if (inheritedSerialized === undefined && __velarUtf8ByteLength(serialized) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.json cannot exceed 16 MiB");
    __velarServeCall(__velarServeWeakMapSet, __velarServeSerializedJson, [fields, serialized]);
  }
  if (__velarServeOwnDescriptor(fields, "text") && typeof fields.text !== "string") throw new __velarServeTypeError("ServeResponse.text must be a string");
  if (__velarServeOwnDescriptor(fields, "text") && __velarUtf8ByteLength(fields.text) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.text cannot exceed 16 MiB");
  if (__velarServeOwnDescriptor(fields, "stream") && typeof fields.stream !== "function") throw new __velarServeTypeError("ServeResponse.stream must be an async producer");
  if (fields.background != null) {
    if (!__velarServeIsArray(fields.background) || fields.background.length > 64) throw new __velarServeTypeError("ServeResponse.background must be a bounded task list");
    for (let index = 0; index < fields.background.length; index += 1) if (typeof fields.background[index] !== "function") throw new __velarServeTypeError("ServeResponse.background tasks must be functions");
  }
  if (fields.compression != null && fields.compression !== "gzip" && fields.compression !== "br") throw new __velarServeTypeError("ServeResponse compression must be gzip, br, or null");
  if (fields.contentType != null && (typeof fields.contentType !== "string" || fields.contentType.length === 0 || fields.contentType.length > 1024
    || __velarServeCall(__velarServeStringIncludes, fields.contentType, ["\0"]) || __velarServeCall(__velarServeStringIncludes, fields.contentType, ["\r"])
    || __velarServeCall(__velarServeStringIncludes, fields.contentType, ["\n"]))) {
    throw new __velarServeTypeError("ServeResponse.contentType must be bounded single-line text");
  }
  __velarServeResponseHeaders(fields.headers);
  if (inheritedCookies !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [fields, inheritedCookies]);
  return fields;
}

function __velarServeResponseHeaders(value) {
  const pairs = value == null ? [] : __velarServeMapSnapshot(value, "ServeResponse.headers");
  let bytes = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    const name = pairs[index][0];
    const item = pairs[index][1];
    if (!__velarServeCall(__velarServeRegExpTest, __velarServeHeaderNamePattern, [name])
      || __velarServeCall(__velarServeRegExpTest, __velarServeHeaderValuePattern, [item])) {
      throw new __velarServeTypeError("ServeResponse headers must use valid HTTP names and single-line values");
    }
    const lower = __velarServeCall(__velarServeStringToLowerCase, name, []);
    if (lower === "content-length" || lower === "transfer-encoding" || lower === "connection") {
      throw new __velarServeTypeError("ServeResponse cannot set transport-owned header '" + name + "'");
    }
    bytes += __velarUtf8ByteLength(name) + __velarUtf8ByteLength(item);
    if (bytes > 64 * 1024) throw new __velarServeRangeError("ServeResponse headers cannot exceed 64 KiB");
  }
  return pairs;
}

function __velarServeCookies(value) {
  const cookies = __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [value]);
  if (cookies === undefined) return [];
  let bytes = 0;
  for (let index = 0; index < cookies.length; index += 1) {
    if (typeof cookies[index] !== "string" || cookies[index].length === 0 || cookies[index].length > 8192 || /[\0\r\n]/u.test(cookies[index])) {
      throw new __velarServeTypeError("ServeResponse cookies are invalid");
    }
    bytes += __velarUtf8ByteLength(cookies[index]);
  }
  if (bytes > 64 * 1024) throw new __velarServeRangeError("ServeResponse cookies cannot exceed 64 KiB");
  return cookies;
}

async function __velarServeRunBackground(tasks) {
  if (tasks === null) return null;
  for (let index = 0; index < tasks.length; index += 1) {
    const reserved = __velarServeCall(__velarServeWeakMapHas, __velarServeReservedBackground, [tasks[index]]);
    if (!reserved) {
      if (__velarServeActiveBackgroundTasks >= __velarServeMaxBackgroundTasks - __velarServeMaxActiveTimeouts) {
        __velarServeReportFailure(new __velarServeRangeError("ServeResponse background task capacity is exhausted"));
        continue;
      }
      __velarServeActiveBackgroundTasks += 1;
    }
    try { await __velarServeCall(tasks[index], undefined, []); }
    catch (error) { __velarServeReportFailure(error); }
    finally { if (!reserved) __velarServeActiveBackgroundTasks -= 1; }
  }
  return null;
}

function __velarServeRegisterTimeoutSettlement(request, settlement) {
  let pending = __velarServeCall(__velarServeWeakMapGet, __velarServeTimeoutSettlements, [request]);
  if (pending === undefined) {
    pending = [];
    __velarServeCall(__velarServeWeakMapSet, __velarServeTimeoutSettlements, [request, pending]);
  }
  pending[pending.length] = settlement;
}

async function __velarServeWaitTimeoutSettlements(request) {
  const pending = __velarServeCall(__velarServeWeakMapGet, __velarServeTimeoutSettlements, [request]);
  if (pending === undefined) return null;
  __velarServeCall(__velarServeWeakMapDelete, __velarServeTimeoutSettlements, [request]);
  for (let index = 0; index < pending.length; index += 1) await pending[index];
  return null;
}

function __velarServeHeaders(value, fixedName = null, fixedValue = null) {
  const pairs = __velarServeResponseHeaders(value);
  const output = new __velarServeMap();
  for (let index = 0; index < pairs.length; index += 1) {
    const name = pairs[index][0];
    if (fixedName !== null && __velarServeCall(__velarServeStringToLowerCase, name, []) === fixedName) continue;
    __velarServeCall(__velarServeMapSet, output, [name, pairs[index][1]]);
  }
  if (fixedName !== null) __velarServeCall(__velarServeMapSet, output, [fixedName, fixedValue]);
  return output;
}

function __velarServeIsRequest(value) {
  try {
    value = __velarServePlainRecord(value, "ServeRequest");
    const method = __velarServeDataField(value, "method", "ServeRequest");
    const path = __velarServeDataField(value, "path", "ServeRequest");
    const valid = typeof method === "string" && method.length > 0 && method.length <= 32
      && __velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [method])
      && typeof path === "string" && __velarServeCall(__velarServeStringStartsWith, path, ["/"]) && path.length <= __velarServeMaxPathCodeUnits
      && !__velarServeCall(__velarServeStringIncludes, path, ["\0"])
      && typeof __velarServeDataField(value, "text", "ServeRequest") === "function"
      && typeof __velarServeDataField(value, "bytes", "ServeRequest") === "function"
      && typeof __velarServeDataField(value, "json", "ServeRequest") === "function"
      && typeof __velarServeDataField(value, "parse", "ServeRequest") === "function";
    if (!valid) return false;
    __velarServeMapSnapshot(__velarServeDataField(value, "query", "ServeRequest"), "ServeRequest.query");
    const queryAll = __velarServeOwnDescriptor(value, "queryAll");
    if (queryAll !== undefined && (!queryAll.enumerable || !("value" in queryAll) || !__velarServeStringListMapSnapshot(queryAll.value, "ServeRequest.queryAll"))) return false;
    const cancellation = __velarServeOwnDescriptor(value, "cancellation");
    if (cancellation !== undefined && (!cancellation.enumerable || !("value" in cancellation) || !__velarServeCancellation.is(cancellation.value))) return false;
    __velarServeMapSnapshot(__velarServeDataField(value, "headers", "ServeRequest"), "ServeRequest.headers");
    return true;
  } catch { return false; }
}

export const ServeRequest = __velarServeTypeObject(__velarServeIsRequest, "ServeRequest requires the request fields provided by velar/serve", __velarServeHandleNative);
export const Request = ServeRequest;
export const ServeResponse = __velarServeTypeObject(value => { __velarServeResponse(value); return true; }, "ServeResponse requires exactly one checked body");
export const HttpOutcome = __velarServeTypeObject(__velarServeIsHttpOutcome, "HttpOutcome values are created by the framework or respond/created/noContent");
export const RoutePattern = __velarServeTypeObject(value => __velarServeIsPattern(value), "RoutePattern values are declared with p\"/...\"");
export const ServeApp = __velarServeTypeObject(
  value => __velarServeIsApp(value),
  "ServeApp values are declared with 'server name:' or built by velar/serve composition functions",
  null,
  __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{createApp: __velarCreateServeApp, createPattern: __velarCreateServePattern, createRoute: __velarCreateServeRoute, createWebSocket: __velarCreateServeWebSocket, createNotFound: __velarCreateServeNotFound, createResponse: __velarCreateServeResponse, testClient: __velarServeTestClient, nativeApp: __velarServeNativeApp}]),
);
export const Server = __velarServeTypeObject(value => {
  try {
    value = __velarServePlainRecord(value, "Server");
    const port = __velarServeDataField(value, "port", "Server");
    return __velarServeIsSafeInteger(port) && port >= 0 && port <= 65535 && typeof __velarServeDataField(value, "stop", "Server") === "function";
  } catch { return false; }
}, "Server requires port and stop fields");

function __velarServeIsUpload(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeUploadMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

export const Upload = __velarServeTypeObject(__velarServeIsUpload, "Upload values are created from multipart route inputs");

// Upload.save takes its containment root as a required argument and refuses any
// target that resolves outside it. The host operations bag __velarServeNativeFile
// uses for static files is not reachable from this Realm, so containment is
// composed from velar/fs instead of a new host operation: fail-closed textual
// rules on the caller's path, then a canonical check of the directory that will
// hold the file so a symbolic link cannot lead out of the root. That is the
// smaller of the two shapes and adds no trust boundary. This is complementary to
// the basename reduction in __velarServeUploadBasename, which bounds only what a
// client can put into Upload.filename.
function __velarServeUploadSegments(path) {
  if (typeof path !== "string" || path.length === 0) throw new __velarServeTypeError("Upload.save path must be a non-empty path relative to its root");
  if (path.length > __velarServeMaxPathCodeUnits || __velarServeCall(__velarServeStringIncludes, path, ["\0"])) {
    throw new __velarServeRangeError("Upload.save path is outside the supported bounds");
  }
  // The root's separator is a host detail this Realm cannot consult, so both
  // separators are refused, exactly as __velarServeNativeEscapes refuses both.
  // Only '..' and an absolute path genuinely leave the root; a backslash, an
  // empty segment and a '.' are refused because this Realm will not normalize a
  // path on the caller's behalf, so each refusal says which of the two it is
  // rather than naming an escape that did not happen.
  if (__velarServeCall(__velarServeStringIncludes, path, ["\\"])) throw new __velarServeError("Upload.save path cannot contain a backslash: it is a path separator on some hosts");
  if (__velarServeCall(__velarServeStringStartsWith, path, ["/"])) throw new __velarServeError("Upload.save path escapes its root: it is absolute");
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "..") throw new __velarServeError("Upload.save path escapes its root: it has a '..' segment");
    if (segment === "") throw new __velarServeError("Upload.save path must be normalized: it has an empty segment");
    if (segment === ".") throw new __velarServeError("Upload.save path must be normalized: it has a '.' segment");
  }
  return segments;
}

function __velarServeUploadContains(root, target) {
  if (target === root) return true;
  if (target.length <= root.length || __velarServeCall(__velarServeStringSlice, target, [0, root.length]) !== root) return false;
  const boundary = __velarServeCall(__velarServeStringSlice, target, [root.length, root.length + 1]);
  return boundary === "/" || boundary === "\\";
}

async function __velarServeUploadTarget(path, root) {
  const segments = __velarServeUploadSegments(path);
  if (typeof root !== "string" || root.length === 0) throw new __velarServeTypeError("Upload.save root must be a non-empty directory path");
  // A relative root means here what it means to `file()` and `staticFiles()`:
  // the one application root base settled at module evaluation, which is the
  // project root the build knew when the `velar.json` there is still this
  // application's, and the emitted entry's own directory otherwise. One
  // resolver answers both sides. An absolute root is used as given.
  const named = __velarServeApplicationRoot(root, "Upload.save");
  // Resolution failures arrive from the host as an errno naming an absolute path
  // the caller never wrote, so they are answered in the caller's own terms: the
  // root it named, or the relative directory it asked for.
  let base;
  try { base = await __velarServeFsCanonical(named); }
  catch { throw new __velarServeError("Upload.save root does not resolve to an existing directory"); }
  let directory = base;
  let relative = "";
  for (let index = 0; index + 1 < segments.length; index += 1) {
    directory += "/" + segments[index];
    relative += relative === "" ? segments[index] : "/" + segments[index];
  }
  if (directory !== base) {
    try { directory = await __velarServeFsCanonical(directory); }
    catch { throw new __velarServeError("Upload.save path names a directory that does not exist under the root: " + relative); }
    if (!__velarServeUploadContains(base, directory)) throw new __velarServeError("Upload.save path escapes its root through a symbolic link");
  }
  const target = directory + "/" + segments[segments.length - 1];
  // A write follows a symbolic link at the target itself, so the last segment is
  // canonicalized by kind rather than by path: refusing the link is fail-closed
  // and needs no second containment test.
  const existing = await __velarServeFsInfo(target);
  if (existing !== null && existing.kind === "symlink") throw new __velarServeError("Upload.save refuses to write through a symbolic link");
  return target;
}

function __velarServeUploadValue(name, filename, contentType, data, states) {
  if (!__velarServeBytesType.is(data)) throw new __velarServeTypeError("Upload data must be Bytes");
  const state = {data};
  states[states.length] = state;
  const current = () => {
    if (state.data === null) throw new __velarServeError("Upload lifetime ended with its request; copy bytes or save it inside the handler or a background task");
    return state.data;
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeUploadMarker]: true,
    name,
    filename,
    contentType,
    size: data.byteLength,
    text: async () => {
      const value = current();
      try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [value]); }
      catch { throw new __velarServeTypeError("Upload is not valid UTF-8 text"); }
    },
    bytes: async () => __velarServeBytesType.parse(current()),
    save: async (path, root) => {
      const value = current();
      await __velarServeWriteBytes(await __velarServeUploadTarget(path, root), value);
      return null;
    },
  }]);
}

function __velarServeIsInput(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeInputMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeIsProvider(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeProviderMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

export const Provider = __velarServeTypeObject(__velarServeIsProvider, "Provider values are declared with provide(...)");
export const RouteDocumentation = __velarServeTypeObject(value => {
  value = __velarServeRecord(value, __velarServeRouteDocumentationFields, "RouteDocumentation");
  if (value.documented !== undefined && typeof value.documented !== "boolean") throw new __velarServeTypeError("RouteDocumentation.documented must be bool");
  if (value.status !== undefined && (!__velarServeIsSafeInteger(value.status) || value.status < 200 || value.status > 599)) throw new __velarServeRangeError("RouteDocumentation.status must be 200 through 599");
  if (value.summary !== undefined) __velarServeDocumentationText(value.summary, "RouteDocumentation.summary", 1024);
  if (value.description !== undefined) __velarServeDocumentationText(value.description, "RouteDocumentation.description", 16384);
  if (value.tags !== undefined) __velarServeStringList(value.tags, "RouteDocumentation.tags", 32);
  if (value.errors !== undefined) __velarServeErrorDocuments(value.errors);
  return true;
}, "RouteDocumentation requires checked OpenAPI route metadata");

function __velarServeInputName(value, label) {
  if (typeof value !== "string" || value.length > 256 || __velarServeCall(__velarServeStringIncludes, value, ["\0"])) {
    throw new __velarServeTypeError(label + " name must be bounded text");
  }
  return value;
}

function __velarServeInputValue(source, name, fallback = __velarServeMissing, extra = null) {
  name = __velarServeInputName(name, "input." + source);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeInputMarker]: true,
    source,
    name,
    hasDefault: fallback !== __velarServeMissing,
    fallback: fallback === __velarServeMissing ? null : fallback,
    extra,
  }]);
}

function __velarServeHeaderInput(name = "", fallback = __velarServeMissing) { return __velarServeInputValue("header", name, fallback); }
function __velarServeCookieInput(name = "", fallback = __velarServeMissing) { return __velarServeInputValue("cookie", name, fallback); }
function __velarServeFormInput(Type) {
  Type = __velarRequireRuntimeType(Type, "input.form");
  return __velarServeInputValue("form", "", __velarServeMissing, Type);
}
function __velarServeUploadInput(name = "", maxBytes = __velarServeMaxBodyBytes) {
  if (!__velarServeIsSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > __velarServeMaxBodyBytes) {
    throw new __velarServeRangeError("input.upload maxBytes must be an integer from 1 through 16777216");
  }
  return __velarServeInputValue("upload", name, __velarServeMissing, maxBytes);
}
function __velarServeDependencyInput(provider) {
  if (!__velarServeIsProvider(provider)) throw new __velarServeTypeError("input.dependency requires a Provider");
  return __velarServeInputValue("dependency", "", __velarServeMissing, provider);
}
function __velarServeRequestInput() { return __velarServeInputValue("request", ""); }

export const input = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
  header: __velarServeHeaderInput,
  cookie: __velarServeCookieInput,
  form: __velarServeFormInput,
  upload: __velarServeUploadInput,
  dependency: __velarServeDependencyInput,
  request: __velarServeRequestInput,
}]);

function __velarServeSecurityValue(kind, details) {
  return __velarServeInputValue("security", "", __velarServeMissing, __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{kind, ...details}]));
}
function __velarServeApiKey(name, source = "header") {
  name = __velarServeInputName(name, "security.apiKey");
  if (name.length === 0 || !__velarServeCall(__velarServeArrayIncludes, ["header", "query", "cookie"], [source])) {
    throw new __velarServeTypeError("security.apiKey source must be header, query, or cookie");
  }
  return __velarServeSecurityValue("apiKey", {name, source});
}
function __velarServeBasic(realm = "") { return __velarServeSecurityValue("basic", {realm: __velarServeInputName(realm, "security.basic")}); }
function __velarServeBearer(scheme = "bearer") { return __velarServeSecurityValue("bearer", {scheme: __velarServeInputName(scheme, "security.bearer")}); }
function __velarServeOauth2(authorizationUrl, tokenUrl = "", scopes = []) {
  authorizationUrl = __velarServeInputName(authorizationUrl, "security.oauth2 authorizationUrl");
  tokenUrl = __velarServeInputName(tokenUrl, "security.oauth2 tokenUrl");
  if (authorizationUrl.length === 0 || !__velarServeIsArray(scopes) || scopes.length > 128) throw new __velarServeTypeError("security.oauth2 requires bounded URLs and scopes");
  const checked = [];
  for (let index = 0; index < scopes.length; index += 1) checked[index] = __velarServeInputName(scopes[index], "security.oauth2 scope");
  return __velarServeSecurityValue("oauth2", {authorizationUrl, tokenUrl, scopes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checked])});
}
function __velarServeOpenId(url) {
  url = __velarServeInputName(url, "security.openId");
  if (url.length === 0) throw new __velarServeTypeError("security.openId requires a discovery URL");
  return __velarServeSecurityValue("openId", {url});
}
export const security = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
  apiKey: __velarServeApiKey,
  basic: __velarServeBasic,
  bearer: __velarServeBearer,
  oauth2: __velarServeOauth2,
  openId: __velarServeOpenId,
}]);

export function provide(inputs, resolve, scope = "request", release = null, eager = false) {
  inputs = __velarServePlainRecord(inputs, "provide inputs");
  if (typeof resolve !== "function" || release !== null && typeof release !== "function") throw new __velarServeTypeError("provide requires resolve and optional release functions");
  if (scope !== "request" && scope !== "app") throw new __velarServeTypeError("provide scope must be 'request' or 'app'");
  if (typeof eager !== "boolean") throw new __velarServeTypeError("provide eager must be bool");
  const checked = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [inputs]);
  if (keys.length > 64) throw new __velarServeRangeError("provide cannot declare more than 64 inputs");
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index];
    const descriptor = typeof name === "string" ? __velarServeOwnDescriptor(inputs, name) : null;
    if (!descriptor?.enumerable || !("value" in descriptor) || !__velarServeIsInput(descriptor.value)) throw new __velarServeTypeError("provide inputs must be input or security descriptors");
    if (scope === "app" && (descriptor.value.source !== "dependency" || descriptor.value.extra.scope !== "app")) {
      throw new __velarServeTypeError("An app-scoped provider may depend only on app-scoped providers");
    }
    checked[name] = descriptor.value;
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeProviderMarker]: true,
    inputs: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checked]),
    resolve,
    scope,
    release,
    eager,
  }]);
}

function __velarServeRequestPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > __velarServeMaxPathCodeUnits
    || __velarServeCall(__velarServeStringIncludes, value, ["\0"]) || __velarServeCall(__velarServeStringIncludes, value, ["\\"])) {
    throw new __velarServeTypeError("fileResponse path must be bounded URL path text");
  }
  return value;
}

// D114 P6 item 13 (SV-U2): a relative static root is the application's own
// directory, not whichever directory the operator happened to start the process
// in. The same build answered every /assets request with 404 when it was
// started from one directory and 200 when it was started from another, and
// nothing in the request said which. The emitted module is
// `<application>/node_modules/velar/serve.js` — the layout `velar/server`
// already reads backwards to find an artifact's configuration file — so this
// module's own directory minus two segments is the directory the emitted entry
// module sits in. An absolute root is handed through untouched, and the
// privileged host still resolves, realpaths and contains whatever arrives, so
// the traversal and symlink-escape rules are exactly the ones they were.
function __velarServeParentDirectory(directory) {
  const slash = __velarServeCall(__velarServeStringLastIndexOf, directory, ["/"]);
  const backslash = __velarServeCall(__velarServeStringLastIndexOf, directory, ["\\"]);
  const cut = __velarServeCall(__velarServeMathMax, __velarServeMath, [slash, backslash]);
  if (cut < 0) return directory;
  return __velarServeCall(__velarServeStringSlice, directory, [0, cut === 0 ? 1 : cut]);
}
const __velarServeApplicationDirectory = typeof import.meta.dirname === "string" && import.meta.dirname !== ""
  ? __velarServeParentDirectory(__velarServeParentDirectory(import.meta.dirname))
  : "";

// D114 F7-node-b item 2, the refinement item 13 needed: "the application's own
// directory" is the **project** directory, and the emitted entry does not
// always sit in it. `velar run` compiles into `<project>/.velar/run-XXXX/`, and
// a directory build writes into `--out-dir`, so a rule that stopped at the
// entry's directory looked for the author's `public/` inside the sandbox and
// never found it. The build knows where the entry landed relative to the
// project root, so it bakes that offset in (`__velarServeProjectRootOffset`)
// and a relative root resolves through it.
//
// D114 F9-node-cli, audit NO-D1: an offset names a *place*, and until this
// item any directory standing in that place was believed. The choice between
// "the project root the build knew" and "beside the entry" was made per root,
// by whichever of the two existed, and existence is not identity: a `dist/`
// copied into a `deploy/` that already held a stranger's `public/` published
// the stranger's files as this application's assets — including files the
// application never had — with no diagnostic anywhere. So the build bakes the
// project's identity as well (`__velarServeProjectIdentity`), the base is
// settled **once** below rather than per root, and it is the project root only
// when the `velar.json` actually sitting at that offset says it is this
// application's. Everything else — a relocated output, a stranger's directory,
// an unreadable manifest — resolves beside the entry, which is where an output
// that travelled with its own assets keeps them.
//
// The read side is not the only side: `Upload.save(path, root)` names a
// directory the same way, so it resolves through this same base. `caller` is
// the name a refusal has to say, because an author who wrote `root="uploads"`
// must not be told about `fileResponse`.
let __velarServeApplicationRootBase = __velarServeApplicationDirectory;
// The bound on a manifest this module will read to answer one question. A
// `velar.json` is a handful of fields; anything past this is not the file this
// output was built from, whatever it is.
const __velarServeMaxManifestBytes = 64 * 1024;

/**
 * Settles the one directory every relative root resolves against, before any
 * route can ask for a file. It is awaited at module evaluation, so a build with
 * no offset — an editor, a test host, an `--out-dir` outside the project —
 * costs nothing and keeps the entry's own directory, exactly as before.
 */
async function __velarServeResolveApplicationRootBase() {
  if (__velarServeApplicationDirectory === "" || __velarServeProjectRootOffset === "") return null;
  const project = __velarServeApplicationDirectory + "/" + __velarServeProjectRootOffset;
  if (project.length > __velarServeMaxPathCodeUnits) return null;
  // A project with no manifest to be identified by is a bare `.vel` file run
  // from its own directory: there is nothing to compare, so the offset is
  // judged the only way it can be, by whether the directory is there.
  if (__velarServeProjectIdentity === "") {
    let directory = null;
    try { directory = await __velarServeFsInfo(project); } catch { return null; }
    if (directory === null || directory.kind !== "directory") return null;
    try { __velarServeApplicationRootBase = await __velarServeFsCanonical(project); }
    catch { __velarServeApplicationRootBase = project; }
    return null;
  }
  const manifestPath = project + "/velar.json";
  let manifestText = null;
  try { manifestText = await __velarServeFsReadText(manifestPath, __velarServeMaxManifestBytes); }
  catch { return null; }
  let declared = null;
  try { declared = __velarJsonParse(manifestText, "velar.json"); } catch { declared = null; }
  if (declared === null || typeof declared !== "object" || __velarServeIsArray(declared)) return null;
  const found = __velarServeProjectIdentityOf(declared.name, declared.entry);
  if (found === __velarServeProjectIdentity) {
    // Canonicalized once, here, so every root resolved against it and every
    // sentence naming one reads as a path rather than as this module's walk
    // back out of `node_modules` and up the offset.
    try { __velarServeApplicationRootBase = await __velarServeFsCanonical(project); }
    catch { __velarServeApplicationRootBase = project; }
    return null;
  }
  // A manifest that is there and disagrees is the one case worth a sentence:
  // the output is standing inside somebody else's project, and every relative
  // root it was written against now means a directory beside the entry.
  __velarServeReportStaticRoot("velar/serve: " + manifestPath + " belongs to a different project ("
    + found + ", not " + __velarServeProjectIdentity + "), so relative static and upload roots resolve beside "
    + __velarServeApplicationDirectory + " instead");
  return null;
}

function __velarServeApplicationRoot(root, caller) {
  if (__velarServeCall(__velarServeRegExpTest, __velarServeAbsolutePathPattern, [root])) return root;
  if (__velarServeApplicationDirectory === "") {
    throw new __velarServeTypeError(caller + " root is relative to the project this build was compiled from, and this velar/serve module has no directory of its own to resolve that against; pass an absolute root");
  }
  __velarServeContainedRoot(root, caller);
  const resolved = __velarServeApplicationRootBase + "/" + root;
  if (resolved.length > __velarServeMaxPathCodeUnits) {
    throw new __velarServeRangeError(caller + " root is outside the supported bounds once resolved");
  }
  return resolved;
}

// D114 F9-node-cli, audit NO-U2: a relative root carrying `..` resolved
// silently and left the project — `root="../shared-public"` passed `velar
// check` and served files the project does not contain, while every other part
// of this toolchain refuses source that leaves the project. The root is refused
// where it is turned into a path, so `file()`, `staticFiles()` and
// `Upload.save()` all answer the same way, and the refusal names both the root
// as written and the directory it would have climbed out of. An absolute root
// stays the explicit way to name a directory outside the project.
function __velarServeContainedRoot(root, caller) {
  // Scanned by index rather than split, because this Realm assumes every
  // prototype is hostile and `split` with a pattern reaches through one.
  let start = 0;
  for (let index = 0; index <= root.length; index += 1) {
    const character = index === root.length ? "/" : root[index];
    if (character !== "/" && character !== "\\") continue;
    if (index - start === 2 && root[start] === "." && root[start + 1] === ".") {
      throw new __velarServeTypeError(caller + " root '" + root + "' leaves the project at "
        + __velarServeApplicationRootBase + ": a relative root names a directory inside it, and a directory outside it is named by an absolute path");
    }
    start = index + 1;
  }
}

// D114 F9-node-cli, audit NO-U3: a root that is not there answered 404 at
// request time and never anything else, so `root="pubic"` and "that file is
// missing" were the same event. Every root an application declares before it
// starts serving is recorded here and audited once by `serve`, which reports
// the ones that do not name a directory and then serves anyway — the request
// answer is unchanged, and a typo stops being invisible.
const __velarServeDeclaredStaticRoots = [];
const __velarServeAuditedStaticRoots = new __velarServeMap();

function __velarServeDeclareStaticRoot(root, caller) {
  const resolved = __velarServeApplicationRoot(root, caller);
  if (__velarServeDeclaredStaticRoots.length >= 256) return resolved;
  if (__velarServeCall(__velarServeMapHas, __velarServeAuditedStaticRoots, [resolved])) return resolved;
  __velarServeCall(__velarServeMapSet, __velarServeAuditedStaticRoots, [resolved, true]);
  __velarServeDeclaredStaticRoots[__velarServeDeclaredStaticRoots.length] = {root, resolved};
  return resolved;
}

async function __velarServeAuditStaticRoots() {
  // Only a build that told this module where its project is can say what a
  // relative root was written against. Without an offset the entry's own
  // directory is a fallback rather than an answer, and a directory missing
  // under a fallback is not evidence of anything the author wrote.
  if (__velarServeProjectRootOffset === "") {
    __velarServeDeclaredStaticRoots.length = 0;
    return null;
  }
  while (__velarServeDeclaredStaticRoots.length > 0) {
    const declared = __velarServeDeclaredStaticRoots[__velarServeDeclaredStaticRoots.length - 1];
    __velarServeDeclaredStaticRoots.length -= 1;
    let found = null;
    try { found = await __velarServeFsInfo(declared.resolved); } catch { found = null; }
    if (found !== null && found.kind === "directory") continue;
    __velarServeReportStaticRoot("velar/serve: static root '" + declared.root + "' does not name a directory ("
      + declared.resolved + "); requests for it answer 404 until it exists");
  }
  return null;
}

function __velarServeReportStaticRoot(line) {
  try {
    if (typeof __velarServeConsoleError !== "function") return null;
    __velarServeCall(__velarServeConsoleError, __velarServeConsole, [line]);
  } catch {}
  return null;
}

export function fileResponse(root, path, fallback = null) {
  if (typeof root !== "string" || root.length === 0 || root.length > __velarServeMaxPathCodeUnits || __velarServeCall(__velarServeStringIncludes, root, ["\0"])) {
    throw new __velarServeTypeError("fileResponse root must be a bounded path string");
  }
  const resolved = __velarServeDeclareStaticRoot(root, "fileResponse");
  path = __velarServeRequestPath(path);
  if (fallback !== null) fallback = __velarServeRequestPath(fallback);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeFileMarker]: true,
    root: resolved,
    path,
    fallback,
    headers: new __velarServeMap(),
  }]);
}

export function json(value, status = 200, headers = null) {
  return __velarServeResponse({status, json: value, headers: __velarServeHeaders(headers)});
}
export function respond(value, status = 200, headers = null) { return __velarServeOutcome(value, status, headers); }
export function created(value, headers = null) { return respond(value, 201, headers); }
export function noContent(completion = null, headers = null) {
  if (completion !== null) throw new __velarServeTypeError("noContent completion must resolve to null");
  return respond(null, 204, headers);
}
export function redirect(location, status = 302, headers = null) {
  if (typeof location !== "string" || location.length === 0 || location.length > __velarServeMaxPathCodeUnits
    || __velarServeCall(__velarServeStringIncludes, location, ["\0"]) || __velarServeCall(__velarServeStringIncludes, location, ["\r"])
    || __velarServeCall(__velarServeStringIncludes, location, ["\n"])) throw new __velarServeTypeError("redirect location must be bounded single-line text");
  if (!__velarServeIsSafeInteger(status) || status < 300 || status > 399) throw new __velarServeRangeError("redirect status must be an HTTP redirect integer from 300 through 399");
  return __velarServeResponse({status, text: "", headers: __velarServeHeaders(headers, "location", location)});
}
export function text(value, status = 200, contentType = "text/plain; charset=utf-8", headers = null) {
  return __velarServeResponse({status, text: value, contentType, headers: __velarServeHeaders(headers)});
}
export function stream(producer, status = 200, headers = null) {
  return __velarServeResponse({status, stream: producer, headers: __velarServeHeaders(headers)});
}
export function sse(producer, headers = null) {
  if (typeof producer !== "function") throw new __velarServeTypeError("sse requires an async producer");
  const responseHeaders = __velarServeHeaders(headers, "content-type", "text/event-stream; charset=utf-8");
  __velarServeCall(__velarServeMapSet, responseHeaders, ["cache-control", "no-cache"]);
  return __velarServeResponse({
    status: 200,
    headers: responseHeaders,
    stream: async write => {
      const send = async event => {
        const formatted = __velarServeSseEvent(event);
        await write(formatted);
        return null;
      };
      const result = await __velarServeCall(producer, undefined, [send]);
      if (result !== null) throw new __velarServeTypeError("sse producer must resolve to null");
      return null;
    },
  });
}
export function file(path, root = ".", fallback = null) { return fileResponse(root, path, fallback); }

function __velarServeSseEvent(value) {
  const event = typeof value === "string" ? {data: value} : __velarServeRecord(value, __velarServeFieldMap(["data", "event", "id", "retry"]), "SSE event");
  if (typeof event.data !== "string") throw new __velarServeTypeError("SSE event data must be text");
  const output = [];
  if (event.event != null) {
    if (typeof event.event !== "string" || event.event.length === 0 || event.event.length > 1024 || /[\0\r\n]/u.test(event.event)) throw new __velarServeTypeError("SSE event name must be bounded single-line text");
    output[output.length] = "event: " + event.event;
  }
  if (event.id != null) {
    if (typeof event.id !== "string" || event.id.length > 4096 || /[\0\r\n]/u.test(event.id)) throw new __velarServeTypeError("SSE event id must be bounded single-line text");
    output[output.length] = "id: " + event.id;
  }
  if (event.retry != null) {
    if (!__velarServeIsSafeInteger(event.retry) || event.retry < 0 || event.retry > 3_600_000) throw new __velarServeRangeError("SSE retry must be 0 through 3600000 milliseconds");
    output[output.length] = "retry: " + event.retry;
  }
  const normalized = __velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, event.data, ["\r\n"]), ["\n"]), ["\r"]), ["\n"]);
  const lines = __velarServeCall(__velarServeStringSplit, normalized, ["\n"]);
  for (let index = 0; index < lines.length; index += 1) output[output.length] = "data: " + lines[index];
  const formatted = __velarServeCall(__velarServeArrayJoin, output, ["\n"]) + "\n\n";
  if (__velarUtf8ByteLength(formatted) > 1024 * 1024) throw new __velarServeRangeError("One SSE event cannot exceed 1 MiB");
  return formatted;
}

function __velarServeResponseCopy(value, headers = null, backgroundTasks = null) {
  value = __velarServeAutomaticResponse(value);
  if (__velarServeIsFileResponse(value)) throw new __velarServeTypeError("This response operation does not support file responses");
  const output = {status: value.status, headers: headers === null ? value.headers : headers};
  // SV-D1: a copy carries the media type of what it copies, on the json branch
  // as well as the text one. The framework's own problem documents are JSON
  // bodies with an application/problem+json contentType, so dropping it here
  // rewrote every problem that passed a header middleware or a background task.
  if (__velarServeOwnDescriptor(value, "json")) output.json = value.json;
  else if (__velarServeOwnDescriptor(value, "text")) output.text = value.text;
  else output.stream = value.stream;
  if (!__velarServeOwnDescriptor(value, "stream") && value.contentType != null) output.contentType = value.contentType;
  const tasks = backgroundTasks === null ? value.background : backgroundTasks;
  if (tasks != null) output.background = tasks;
  if (value.compression != null) output.compression = value.compression;
  // 只改头、cookie 或后台任务时，JSON 本体仍是同一个已编码快照。
  // 先把快照挂到新外壳，__velarServeResponse 就能继承而不重编码。
  const serialized = __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [value]);
  if (serialized !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeSerializedJson, [output, serialized]);
  const copied = __velarServeResponse(output);
  const cookies = __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [value]);
  if (cookies !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [copied, cookies]);
  return copied;
}

export function background(response, task) {
  if (typeof task !== "function") throw new __velarServeTypeError("background task must be a function");
  if (__velarServeIsOutcome(response)) {
    const tasks = [];
    if (response.background != null) for (let index = 0; index < response.background.length; index += 1) tasks[tasks.length] = response.background[index];
    if (tasks.length >= 64) throw new __velarServeRangeError("A response cannot have more than 64 background tasks");
    tasks[tasks.length] = task;
    const output = __velarServeOutcome(response.value, response.status, response.headers, response.problem, tasks);
    const cookies = __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [response]);
    if (cookies !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [output, cookies]);
    return output;
  }
  response = __velarServeAutomaticResponse(response);
  if (__velarServeIsFileResponse(response)) throw new __velarServeTypeError("background does not support file responses");
  const tasks = [];
  if (response.background != null) for (let index = 0; index < response.background.length; index += 1) tasks[tasks.length] = response.background[index];
  if (tasks.length >= 64) throw new __velarServeRangeError("A response cannot have more than 64 background tasks");
  tasks[tasks.length] = task;
  return __velarServeResponseCopy(response, null, tasks);
}

export function setCookie(response, name, value, path = "/", httpOnly = true, secure = true, sameSite = "lax", maxAge = null) {
  if (typeof name !== "string" || name.length === 0 || name.length > 256 || !__velarServeCall(__velarServeRegExpTest, __velarServeHeaderNamePattern, [name])) throw new __velarServeTypeError("Cookie name must be a bounded token");
  if (typeof value !== "string" || value.length > 4096 || /[\0\r\n]/u.test(value)) throw new __velarServeTypeError("Cookie value must be bounded text");
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || !__velarServeCall(__velarServeStringStartsWith, path, ["/"]) || /[\0\r\n;]/u.test(path)) throw new __velarServeTypeError("Cookie path must be a bounded absolute path");
  if (typeof httpOnly !== "boolean" || typeof secure !== "boolean" || !__velarServeCall(__velarServeArrayIncludes, ["lax", "strict", "none"], [sameSite])) throw new __velarServeTypeError("Cookie options are invalid");
  if (sameSite === "none" && !secure) throw new __velarServeTypeError("SameSite=None cookies must be Secure");
  if (maxAge !== null && (!__velarServeIsSafeInteger(maxAge) || maxAge < 0)) throw new __velarServeRangeError("Cookie maxAge must be a non-negative integer or null");
  let cookie = name + "=" + __velarServeCall(__velarServeEncodeURIComponent, undefined, [value]) + "; Path=" + path + "; SameSite=" + (sameSite === "lax" ? "Lax" : sameSite === "strict" ? "Strict" : "None");
  if (httpOnly) cookie += "; HttpOnly";
  if (secure) cookie += "; Secure";
  if (maxAge !== null) cookie += "; Max-Age=" + maxAge;
  if (__velarUtf8ByteLength(cookie) > 8192) throw new __velarServeRangeError("Cookie cannot exceed 8 KiB");
  const semantic = __velarServeIsOutcome(response);
  const inherited = semantic ? __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [response]) : undefined;
  if (semantic) {
    response = __velarServeOutcome(response.value, response.status, response.headers, response.problem, response.background ?? null);
    if (inherited !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [response, inherited]);
  }
  else response = __velarServeAutomaticResponse(response);
  if (__velarServeIsFileResponse(response)) throw new __velarServeTypeError("setCookie does not support file responses");
  const output = semantic ? response : __velarServeResponseCopy(response);
  const previous = __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [response]);
  const cookies = [];
  if (previous !== undefined) for (let index = 0; index < previous.length; index += 1) cookies[index] = previous[index];
  if (cookies.length >= 64) throw new __velarServeRangeError("A response cannot set more than 64 cookies");
  cookies[cookies.length] = cookie;
  __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [output, __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [cookies])]);
  return output;
}

export function clearCookie(response, name, path = "/") { return setCookie(response, name, "deleted", path, true, true, "lax", 0); }

function __velarServeIsRoute(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeRouteMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeIsWebSocket(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeWebSocketMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeIsPattern(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServePatternMarker);
  return descriptor?.value === true;
}

function __velarServeIsNotFound(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeNotFoundMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeIsResponseHandler(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeResponseHandlerMarker);
  return descriptor?.value === true;
}

function __velarServeIsApp(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeAppMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeRoutePath(path, name = "Route path") {
  if (typeof path !== "string" || path.length === 0 || path.length > __velarServeMaxPathCodeUnits
    || !__velarServeCall(__velarServeStringStartsWith, path, ["/"]) || path.length > 1 && __velarServeCall(__velarServeStringEndsWith, path, ["/"])
    || __velarServeCall(__velarServeStringIncludes, path, ["//"]) || __velarServeCall(__velarServeStringIncludes, path, ["?"])
    || __velarServeCall(__velarServeStringIncludes, path, ["#"]) || __velarServeCall(__velarServeStringIncludes, path, ["\\"])) {
    throw new __velarServeTypeError(name + " must be a normalized absolute URL path");
  }
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "*" && index !== segments.length - 1) throw new __velarServeTypeError(name + " wildcard must be final");
    if ((__velarServeCall(__velarServeStringStartsWith, segment, ["{"]) || __velarServeCall(__velarServeStringEndsWith, segment, ["}"]))
      && !__velarServeCall(__velarServeRegExpTest, __velarServeRouteCapturePattern, [segment])) {
      throw new __velarServeTypeError(name + " captures use '{name:type}'");
    }
  }
  return path;
}

// D90 R19(c): the shape rule is written once, in route-shape.ts, and this
// module interpolates that one definition. The shared core touches only
// indexed access and .length, so it stays sound inside this hardened Realm;
// the split it never performs itself happens here with the captured split.
