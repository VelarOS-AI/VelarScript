import { ROUTE_SHAPE_FROM_SEGMENTS_SOURCE } from "./route-shape.ts";

// Application-facing velar/serve contract. HTTP sockets, request streams,
// backpressure and static-file effects live in the shared isolated Node host;
// this Realm owns only Velar values, handlers and strict JSON/type boundaries.
export const VELAR_NODE_SERVE_RUNTIME = String.raw`
import { __velarNodeHostInvoke, __velarNodeHostOn } from "velar/node-host-v1";
import { normalizeError as __velarServeNormalizeError } from "velar/compiler-runtime-errors-v1";
import { __velarValidateDenseList as __velarServeValidateDenseList } from "velar/compiler-runtime-collection-lowering-v1";
import { Bytes as __velarServeBytesType } from "velar/binary";
import { canonical as __velarServeFsCanonical, info as __velarServeFsInfo, writeBytes as __velarServeWriteBytes } from "velar/fs";
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
const __velarServeUtf8Decoder = new __velarServeTextDecoder("utf-8", {fatal: true});
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
const __velarServeProblemCodePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
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
const __velarServeResponseCookies = new __velarServeWeakMap();
const __velarServeReservedBackground = new __velarServeWeakMap();
const __velarServeTimeoutSettlements = new __velarServeWeakMap();
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
const __velarServeProblemFields = __velarServeFieldMap(["status", "code", "title", "detail", "type", "instance", "source", "parameter", "headers"]);
const __velarServeResponseHandlerFields = __velarServeFieldMap(["responseSchema", "responseContentTypes"]);
const __velarServeRouteMetadataFields = __velarServeFieldMap(["responseSchema", "responseContentTypes", "maxBodyBytes", "middleware", "documented", "summary", "description", "tags", "status", "errors"]);
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
    if (typeof fields.code !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeProblemCodePattern, [fields.code])) throw new __velarServeTypeError("HttpProblem code must be a stable lowercase identifier");
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
    const properties = [["status", fields.status], ["code", fields.code], ["title", title], ["detail", detail], ["type", type], ["instance", instance], ["source", source], ["parameter", parameter], ["headers", __velarServeHeaders(fields.headers)]];
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

function __velarServeProblem(status, code, title, detail = null, source = null, parameter = null, headers = null) {
  return new HttpProblem({status, code, title, detail, source, parameter, headers});
}

/** 将各输入解析器的紧凑失败信息收口为公开的 HttpProblem 契约。 */
function __velarServeRequestProblem(status, body, headers = null) {
  const raw = typeof body?.error === "string" ? body.error : "invalid_request";
  const code = (status >= 500 ? "server." : status === 401 ? "security." : "request.")
    + __velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, raw, ["_"]), ["."]);
  const title = status === 401 ? "Authentication required"
    : status === 413 ? "Request input is too large"
      : status === 415 ? "Unsupported request content type"
        : status === 422 ? "Request validation failed"
          : status >= 500 ? "Server could not complete the request"
            : "Malformed request input";
  const detail = typeof body?.expected === "string" ? "Expected " + body.expected : null;
  const parameter = typeof body?.parameter === "string" ? body.parameter : null;
  return __velarServeProblem(status, code, title, detail, parameter === null ? null : "parameter", parameter, headers);
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
    super({status: 503, code: "server.outbound_budget", title: "Server is busy", headers: new __velarServeMap([["retry-after", "1"]])});
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
  const fields = __velarServeRecord(value, __velarServeResponseFields, "ServeResponse");
  if (!__velarServeIsSafeInteger(fields.status) || fields.status < 200 || fields.status > 599) {
    throw new __velarServeRangeError("ServeResponse.status must be a final HTTP status integer from 200 through 599");
  }
  let bodies = 0;
  const bodyNames = ["json", "text", "stream"];
  for (let index = 0; index < bodyNames.length; index += 1) if (__velarServeOwnDescriptor(fields, bodyNames[index])) bodies += 1;
  if (bodies !== 1) throw new __velarServeTypeError("ServeResponse requires exactly one of json, text, or stream");
  if (__velarServeOwnDescriptor(fields, "json")) {
    const serialized = __velarJsonStringify(fields.json);
    if (__velarUtf8ByteLength(serialized) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.json cannot exceed 16 MiB");
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
  // Resolution failures arrive from the host as an errno naming an absolute path
  // the caller never wrote, so both are answered in the caller's own terms: the
  // root it named, or the relative directory it asked for.
  let base;
  try { base = await __velarServeFsCanonical(root); }
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

export function fileResponse(root, path, fallback = null) {
  if (typeof root !== "string" || root.length === 0 || root.length > __velarServeMaxPathCodeUnits || __velarServeCall(__velarServeStringIncludes, root, ["\0"])) {
    throw new __velarServeTypeError("fileResponse root must be a bounded path string");
  }
  path = __velarServeRequestPath(path);
  if (fallback !== null) fallback = __velarServeRequestPath(fallback);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeFileMarker]: true, root, path, fallback, headers: new __velarServeMap()}]);
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
  if (__velarServeOwnDescriptor(value, "json")) output.json = value.json;
  else if (__velarServeOwnDescriptor(value, "text")) { output.text = value.text; if (value.contentType != null) output.contentType = value.contentType; }
  else output.stream = value.stream;
  const tasks = backgroundTasks === null ? value.background : backgroundTasks;
  if (tasks != null) output.background = tasks;
  if (value.compression != null) output.compression = value.compression;
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
const __velarServeRouteShapeFromSegments = ${ROUTE_SHAPE_FROM_SEGMENTS_SOURCE};
function __velarServeRouteShape(path) {
  return __velarServeRouteShapeFromSegments(__velarServeCall(__velarServeStringSplit, path, ["/"]));
}

/**
 * 编译器把 p"..." 降低成结构化数据，这里只做边界复核并冻结。路由字符串
 * 不会在每次请求中重新解析；捕获的类型检查函数与 OpenAPI schema 也随模板
 * 一次性保存。
 */
function __velarCreateServePattern(source) {
  source = __velarServeRecord(source, __velarServePatternFields, "RoutePattern");
  const pathname = __velarServeRoutePath(source.pathname, "RoutePattern pathname");
  if (typeof source.definition !== "string" || source.definition.length === 0 || source.definition.length > __velarServeMaxPathCodeUnits) {
    throw new __velarServeTypeError("RoutePattern definition must be bounded text");
  }
  const fieldNames = new __velarServeMap();
  const readCaptures = (items, query) => {
    if (!__velarServeIsArray(items) || items.length > 64) throw new __velarServeTypeError("RoutePattern captures must be a bounded list");
    const output = [];
    const localNames = new __velarServeMap();
    const wireNames = new __velarServeMap();
    for (let index = 0; index < items.length; index += 1) {
      const item = __velarServeRecord(items[index], __velarServePatternCaptureFields, "RoutePattern capture");
      if (typeof item.name !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [item.name])
        || typeof item.wireName !== "string" || item.wireName.length === 0 || item.wireName.length > 256
        || typeof item.explicitWireName !== "boolean" || !query && item.explicitWireName
        || query && !item.explicitWireName && item.wireName !== item.name
        || typeof item.typeName !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [item.typeName])
        || typeof item.optional !== "boolean" || !query && item.optional
        || !__velarServeCall(__velarServeArrayIncludes, ["string", "number", "bool", "enum"], [item.kind])
        || typeof item.check !== "function") throw new __velarServeTypeError("RoutePattern capture is invalid");
      if (__velarServeCall(__velarServeMapHas, localNames, [item.name])) throw new __velarServeTypeError("RoutePattern field names must be unique");
      if (__velarServeCall(__velarServeMapHas, fieldNames, [item.name])) throw new __velarServeTypeError("RoutePattern path and query field names must be unique");
      if (__velarServeCall(__velarServeMapHas, wireNames, [item.wireName])) throw new __velarServeTypeError("RoutePattern wire names must be unique");
      __velarServeCall(__velarServeMapSet, localNames, [item.name, true]);
      __velarServeCall(__velarServeMapSet, fieldNames, [item.name, true]);
      __velarServeCall(__velarServeMapSet, wireNames, [item.wireName, true]);
      output[output.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
        name: item.name, wireName: item.wireName, explicitWireName: item.explicitWireName, typeName: item.typeName, optional: item.optional,
        kind: item.kind, check: item.check, schema: __velarServeSchema(item.schema ?? {}, "RoutePattern capture schema"),
      }]);
    }
    return output;
  };
  const path = readCaptures(source.path, false);
  const query = readCaptures(source.query, true);
  const declared = new __velarServeMap();
  const segments = __velarServeCall(__velarServeStringSplit, pathname, ["/"]);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!__velarServeCall(__velarServeStringStartsWith, segment, ["{"])) continue;
    const text = __velarServeCall(__velarServeStringSlice, segment, [1, -1]);
    const colon = __velarServeCall(__velarServeStringIndexOf, text, [":"]);
    __velarServeCall(__velarServeMapSet, declared, [__velarServeCall(__velarServeStringSlice, text, [0, colon]), true]);
  }
  if (__velarServeCall(__velarServeMapSize, declared, []) !== path.length) throw new __velarServeTypeError("RoutePattern path captures do not match its pathname");
  for (let index = 0; index < path.length; index += 1) {
    if (path[index].wireName !== path[index].name || !__velarServeCall(__velarServeMapHas, declared, [path[index].name])) {
      throw new __velarServeTypeError("RoutePattern path captures do not match its pathname");
    }
  }
  let canonical = pathname;
  if (query.length > 0) {
    const clauses = [];
    for (let index = 0; index < query.length; index += 1) {
      const item = query[index];
      clauses[index] = (item.explicitWireName ? item.wireName + "=" : "")
        + "{" + item.name + ":" + item.typeName + (item.optional ? "?" : "") + "}";
    }
    canonical += "?" + __velarServeCall(__velarServeArrayJoin, clauses, ["&"]);
  }
  if (canonical !== source.definition) throw new __velarServeTypeError("RoutePattern definition does not agree with its compiled structure");
  const value = {definition: source.definition};
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, __velarServePatternMarker, {value: true, enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "pathname", {value: pathname, enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "pathCaptures", {value: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [path]), enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "queryCaptures", {value: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [query]), enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [value, "toString", {value: () => source.definition, enumerable: false, configurable: false, writable: false}]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [value]);
}

function __velarCreateServeRoute(method, pattern, parameters, handler, metadata = {}) {
  if (typeof method !== "string" || !__velarServeCall(__velarServeArrayIncludes, ["GET", "POST", "PUT", "PATCH", "DELETE"], [method])) throw new __velarServeTypeError("Route method is invalid");
  if (!__velarServeIsPattern(pattern)) throw new __velarServeTypeError("Route path must be a RoutePattern declared with p\"/...\"");
  const path = pattern.pathname;
  if (!__velarServeIsArray(parameters) || parameters.length > 64) throw new __velarServeTypeError("Route parameters must be a bounded list");
  const checked = [];
  const names = new __velarServeMap();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = __velarServeRecord(parameters[index], __velarServeRouteParameterFields, "Route parameter");
    if (typeof parameter.name !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [parameter.name])
      || __velarServeCall(__velarServeMapHas, names, [parameter.name])) throw new __velarServeTypeError("Route parameter names must be unique identifiers");
    if (!__velarServeCall(__velarServeArrayIncludes, ["body", "request", "header", "cookie", "form", "upload", "dependency", "security"], [parameter.source])
      || !__velarServeCall(__velarServeArrayIncludes, ["string", "number", "bool", "enum", "list", "data", "request", "upload", "dependency", "security"], [parameter.kind])
      || typeof parameter.required !== "boolean" || parameter.source !== "request" && typeof parameter.check !== "function") {
      throw new __velarServeTypeError("Route parameter descriptor is invalid");
    }
    const routeInput = parameter.input == null ? null : parameter.input;
    if (routeInput !== null && (!__velarServeIsInput(routeInput) || routeInput.source !== parameter.source)) {
      throw new __velarServeTypeError("Route input descriptor does not agree with its compiled source");
    }
    const scalar = parameter.kind === "string" || parameter.kind === "number" || parameter.kind === "bool" || parameter.kind === "enum";
    if (parameter.source === "body" && parameter.kind !== "data"
      || parameter.source === "request" && (parameter.kind !== "request" || parameter.required !== true)
      || parameter.source === "header" && !scalar
      || parameter.source === "cookie" && !scalar
      || parameter.source === "form" && parameter.kind !== "data"
      || parameter.source === "upload" && parameter.kind !== "upload"
      || parameter.source === "dependency" && parameter.kind !== "dependency"
      || parameter.source === "security" && parameter.kind !== "security") {
      throw new __velarServeTypeError("Route parameter source and kind do not agree");
    }
    __velarServeCall(__velarServeMapSet, names, [parameter.name, true]);
    const schema = parameter.schema == null ? __velarServeDefaultSchema(parameter.kind) : __velarServeSchema(parameter.schema, "Route parameter schema");
    const required = routeInput !== null && (routeInput.source === "header" || routeInput.source === "cookie")
      ? !routeInput.hasDefault
      : parameter.required;
    checked[checked.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{name: parameter.name, source: parameter.source, kind: parameter.kind, required, check: parameter.check ?? null, schema, input: routeInput}]);
  }
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  if (typeof handler !== "function") throw new __velarServeTypeError("Route handler is invalid");
  metadata = __velarServeRecord(metadata, __velarServeRouteMetadataFields, "Route metadata");
  const responseSchema = metadata.responseSchema == null ? {} : __velarServeSchema(metadata.responseSchema, "Route response schema");
  const responseContentTypes = metadata.responseContentTypes == null ? ["application/json"] : __velarServeStringList(metadata.responseContentTypes, "Route response content types", 8);
  const maxBodyBytes = metadata.maxBodyBytes == null ? null : __velarServeBodyLimit(metadata.maxBodyBytes);
  const middleware = metadata.middleware == null ? [] : metadata.middleware;
  const documented = metadata.documented == null ? true : metadata.documented;
  if (typeof documented !== "boolean") throw new __velarServeTypeError("Route documented metadata must be bool");
  const summary = __velarServeDocumentationText(metadata.summary, "Route summary", 1024);
  const description = __velarServeDocumentationText(metadata.description, "Route description", 16384);
  const tags = metadata.tags == null ? [] : __velarServeStringList(metadata.tags, "Route documentation tags", 32);
  const status = metadata.status == null ? 200 : metadata.status;
  if (!__velarServeIsSafeInteger(status) || status < 200 || status > 599) throw new __velarServeRangeError("Route documentation status must be 200 through 599");
  const errors = __velarServeErrorDocuments(metadata.errors);
  if (!__velarServeIsArray(middleware) || middleware.length > 64) throw new __velarServeRangeError("A route cannot have more than 64 middleware functions");
  const checkedMiddleware = [];
  for (let index = 0; index < middleware.length; index += 1) {
    if (typeof middleware[index] !== "function") throw new __velarServeTypeError("Route middleware entries must be functions");
    checkedMiddleware[checkedMiddleware.length] = middleware[index];
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeRouteMarker]: true,
    method,
    path,
    pattern,
    segments: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [segments]),
    parameters: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checked]),
    handler,
    responseSchema,
    responseContentTypes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [responseContentTypes]),
    maxBodyBytes,
    middleware: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checkedMiddleware]),
    documented,
    summary,
    description,
    tags: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [tags]),
    status,
    errors,
  }]);
}

function __velarCreateServeWebSocket(pattern, parameters, handler) {
  if (!__velarServeIsPattern(pattern)) throw new __velarServeTypeError("WebSocket path must be a RoutePattern declared with p\"/...\"");
  if (!__velarServeIsArray(parameters) || parameters.length > 64) throw new __velarServeTypeError("WebSocket parameters must be a bounded list");
  const checked = [];
  const names = new __velarServeMap();
  let connectionIndex = -1;
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = __velarServeRecord(parameters[index], __velarServeRouteParameterFields, "WebSocket parameter");
    if (typeof parameter.name !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeRouteNamePattern, [parameter.name])
      || __velarServeCall(__velarServeMapHas, names, [parameter.name])) throw new __velarServeTypeError("WebSocket parameter names must be unique identifiers");
    if (!__velarServeCall(__velarServeArrayIncludes, ["connection", "request", "header", "cookie", "dependency", "security"], [parameter.source])
      || !__velarServeCall(__velarServeArrayIncludes, ["connection", "request", "string", "number", "bool", "enum", "dependency", "security"], [parameter.kind])
      || parameter.required !== true) throw new __velarServeTypeError("WebSocket parameter descriptor is invalid");
    const routeInput = parameter.input == null ? null : parameter.input;
    if (parameter.source === "connection") {
      if (parameter.kind !== "connection" || routeInput !== null || connectionIndex !== -1) throw new __velarServeTypeError("A WebSocket route requires exactly one connection parameter");
      connectionIndex = index;
    } else if (parameter.source === "request") {
      if (parameter.kind !== "request" || routeInput !== null) throw new __velarServeTypeError("WebSocket Request descriptor is invalid");
    } else {
      if (routeInput === null || !__velarServeIsInput(routeInput) || routeInput.source !== parameter.source) throw new __velarServeTypeError("WebSocket input descriptor does not agree with its compiled source");
      const scalar = parameter.kind === "string" || parameter.kind === "number" || parameter.kind === "bool" || parameter.kind === "enum";
      if (parameter.source === "header" && !scalar || parameter.source === "cookie" && !scalar
        || parameter.source === "dependency" && parameter.kind !== "dependency"
        || parameter.source === "security" && parameter.kind !== "security") throw new __velarServeTypeError("WebSocket parameter source and kind do not agree");
    }
    __velarServeCall(__velarServeMapSet, names, [parameter.name, true]);
    checked[checked.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      name: parameter.name,
      source: parameter.source,
      kind: parameter.kind,
      required: true,
      check: parameter.check ?? null,
      schema: parameter.schema == null ? __velarServeDefaultSchema(parameter.kind) : __velarServeSchema(parameter.schema, "WebSocket parameter schema"),
      input: routeInput,
    }]);
  }
  if (connectionIndex === -1) throw new __velarServeTypeError("A WebSocket route requires exactly one connection parameter");
  if (typeof handler !== "function") throw new __velarServeTypeError("WebSocket handler is invalid");
  const path = pattern.pathname;
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeWebSocketMarker]: true,
    method: "WEBSOCKET",
    path,
    pattern,
    segments: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [__velarServeCall(__velarServeStringSplit, path, ["/"])]),
    parameters: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checked]),
    connectionIndex,
    handler,
  }]);
}

function __velarCreateServeNotFound(handler, middleware = []) {
  if (typeof handler !== "function") throw new __velarServeTypeError("@notFound handler is invalid");
  if (!__velarServeIsArray(middleware) || middleware.length > 64) throw new __velarServeRangeError("@notFound cannot have more than 64 middleware functions");
  const checkedMiddleware = [];
  for (let index = 0; index < middleware.length; index += 1) {
    if (typeof middleware[index] !== "function") throw new __velarServeTypeError("@notFound middleware entries must be functions");
    checkedMiddleware[checkedMiddleware.length] = middleware[index];
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeNotFoundMarker]: true,
    handler,
    middleware: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [checkedMiddleware]),
  }]);
}

function __velarCreateServeResponse(handler, metadata = {}) {
  if (typeof handler !== "function") throw new __velarServeTypeError("@response handler is invalid");
  metadata = __velarServeRecord(metadata, __velarServeResponseHandlerFields, "@response metadata");
  const responseSchema = metadata.responseSchema == null ? {} : __velarServeSchema(metadata.responseSchema, "@response schema");
  const responseContentTypes = metadata.responseContentTypes == null
    ? ["application/json"]
    : __velarServeStringList(metadata.responseContentTypes, "@response content types", 8);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeResponseHandlerMarker]: true,
    handler,
    responseSchema,
    responseContentTypes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [responseContentTypes]),
  }]);
}

function __velarServeDocumentationText(value, name, maximum) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\0]/u.test(value)) {
    throw new __velarServeTypeError(name + " must be bounded non-empty text");
  }
  return value;
}

function __velarServeErrorDocuments(value) {
  if (value == null) return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [[]]);
  const output = [];
  if (__velarServeIsArray(value)) {
    if (value.length > 32) throw new __velarServeRangeError("Route documentation cannot declare more than 32 error responses");
    for (let index = 0; index < value.length; index += 1) {
      const item = __velarServeRecord(value[index], __velarServeErrorDocumentationFields, "Route error documentation");
      if (!__velarServeIsSafeInteger(item.status) || item.status < 400 || item.status > 599) throw new __velarServeRangeError("Route error status must be 400 through 599");
      output[output.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{status: item.status, description: __velarServeDocumentationText(item.description, "Route error description", 4096)}]);
    }
  } else {
    let size;
    let iterator;
    try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
    catch { throw new __velarServeTypeError("Route documentation errors must be a Map<number, string>"); }
    if (!__velarServeIsSafeInteger(size) || size < 0 || size > 32) throw new __velarServeRangeError("Route documentation cannot declare more than 32 error responses");
    while (true) {
      const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
      if (step.done) break;
      const item = step.value;
      if (!__velarServeIsArray(item) || item.length !== 2 || !__velarServeIsSafeInteger(item[0]) || item[0] < 400 || item[0] > 599) {
        throw new __velarServeTypeError("Route documentation errors must be a Map<number, string> with 400 through 599 status keys");
      }
      output[output.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{status: item[0], description: __velarServeDocumentationText(item[1], "Route error description", 4096)}]);
    }
    if (output.length !== size) throw new __velarServeTypeError("Route documentation errors changed while they were being read");
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [output]);
}

function __velarServeRouteMetadata(route, overrides = null) {
  const metadata = overrides ?? {};
  return {
    responseSchema: route.responseSchema,
    responseContentTypes: route.responseContentTypes,
    maxBodyBytes: route.maxBodyBytes,
    middleware: route.middleware,
    documented: metadata.documented ?? route.documented,
    summary: metadata.summary ?? route.summary,
    description: metadata.description ?? route.description,
    tags: metadata.tags ?? route.tags,
    status: metadata.status ?? route.status,
    errors: metadata.errors ?? route.errors,
  };
}

function __velarServeSchema(value, name) {
  __velarServePlainRecord(value, name);
  const serialized = __velarJsonStringify(value);
  if (__velarUtf8ByteLength(serialized) > 1024 * 1024) throw new __velarServeRangeError(name + " cannot exceed 1 MiB");
  return __velarServeFreezeSchema(__velarJsonParse(serialized, name));
}

function __velarServeFreezeSchema(value) {
  if (!value || typeof value !== "object") return value;
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = __velarServeOwnDescriptor(value, keys[index]);
    if (descriptor && "value" in descriptor) __velarServeFreezeSchema(descriptor.value);
  }
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [value]);
}

function __velarServeDefaultSchema(kind) {
  if (kind === "string" || kind === "enum") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "string"}]);
  if (kind === "number") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "number"}]);
  if (kind === "bool") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "boolean"}]);
  if (kind === "data") return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{type: "object"}]);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{}]);
}

function __velarServeBodyLimit(value) {
  if (!__velarServeIsSafeInteger(value) || value < 1 || value > __velarServeMaxBodyBytes) {
    throw new __velarServeRangeError("bodyLimit maxBytes must be an integer from 1 through 16777216");
  }
  return value;
}

function __velarServeAppValue(name, routes, webSockets = [], lifecycles = [], notFound = null, responseHandler = null) {
  const router = __velarServeRouter(routes);
  const webSocketRouter = __velarServeRouter(webSockets);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    [__velarServeAppMarker]: true,
    name,
    routes: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [routes]),
    router,
    webSockets: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [webSockets]),
    webSocketRouter,
    lifecycles: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [lifecycles]),
    notFound,
    responseHandler,
  }]);
}

function __velarCreateServeApp(name, items) {
  if (typeof name !== "string" || name.length === 0 || name.length > 256) throw new __velarServeTypeError("ServeApp name must be bounded text");
  if (!__velarServeIsArray(items) || items.length > __velarServeMaxRoutes + 2) throw new __velarServeTypeError("ServeApp items cannot exceed 4096 routes, one fallback, and one response policy");
  const routes = [];
  const webSockets = [];
  const lifecycles = [];
  let notFound = null;
  let responseHandler = null;
  // D90 R19(b): assembly is the moment the final table exists, so the final
  // table is judged here — a conflict names both routes and both origins,
  // because the statically invisible half of a collision is exactly the one
  // the author cannot see in his own file.
  const shapes = new __velarServeMap();
  const describeRoute = entry => "'" + entry.route.method + " " + entry.route.path + "'"
    + (entry.source === null ? " declared by this server" : " composed in from '" + entry.source + "'");
  const append = (route, source, target) => {
    if (routes.length + webSockets.length >= __velarServeMaxRoutes) throw new __velarServeRangeError("ServeApp cannot contain more than 4096 routes after composition");
    const key = route.method + " " + __velarServeRouteShape(route.path);
    const previous = __velarServeCall(__velarServeMapGet, shapes, [key]);
    if (previous !== undefined) {
      throw new __velarServeTypeError("ServeApp '" + name + "' contains conflicting routes: " + describeRoute({route, source})
        + " and " + describeRoute(previous) + " both answer '" + key + "' — narrow or remove one");
    }
    __velarServeCall(__velarServeMapSet, shapes, [key, {route, source}]);
    target[target.length] = route;
  };
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (__velarServeIsRoute(item)) append(item, null, routes);
    else if (__velarServeIsWebSocket(item)) append(item, null, webSockets);
    else if (__velarServeIsNotFound(item)) {
      if (notFound !== null) throw new __velarServeTypeError("ServeApp contains more than one @notFound fallback");
      notFound = item;
    }
    else if (__velarServeIsResponseHandler(item)) {
      if (responseHandler !== null) throw new __velarServeTypeError("ServeApp contains more than one @response policy");
      responseHandler = item;
    }
    else if (__velarServeIsApp(item)) {
      for (let route = 0; route < item.routes.length; route += 1) append(item.routes[route], item.name, routes);
      for (let route = 0; route < item.webSockets.length; route += 1) append(item.webSockets[route], item.name, webSockets);
      for (let hook = 0; hook < item.lifecycles.length; hook += 1) {
        if (lifecycles.length >= __velarServeMaxLifecycles) throw new __velarServeRangeError("ServeApp cannot contain more than 4096 lifecycle pairs after composition");
        lifecycles[lifecycles.length] = item.lifecycles[hook];
      }
      if (item.notFound !== null) {
        if (notFound !== null) throw new __velarServeTypeError("ServeApp contains more than one @notFound fallback");
        notFound = item.notFound;
      }
      if (item.responseHandler !== null) {
        if (responseHandler !== null) throw new __velarServeTypeError("ServeApp contains more than one @response policy");
        responseHandler = item.responseHandler;
      }
    } else throw new __velarServeTypeError("A server composition entry must be a ServeApp");
  }
  return __velarServeAppValue(name, routes, webSockets, lifecycles, notFound, responseHandler);
}

export function prefix(path, app) {
  path = __velarServeRoutePath(path, "prefix path");
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("prefix requires a ServeApp");
  if (__velarServeCall(__velarServeStringIncludes, path, ["{"]) || __velarServeCall(__velarServeStringIncludes, path, ["*"])) {
    throw new __velarServeTypeError("prefix path must contain only literal path segments");
  }
  if (path === "/") return app;
  if (app.notFound !== null) throw new __velarServeTypeError("prefix cannot scope @notFound; compose the fallback on the final server instead");
  if (app.responseHandler !== null) throw new __velarServeTypeError("prefix cannot scope @response; compose the policy on the final server instead");
  const routes = [];
  const webSockets = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    const pathname = path + (route.path === "/" ? "" : route.path);
    const querySuffix = __velarServeCall(__velarServeStringSlice, route.pattern.definition, [route.path.length]);
    const pattern = __velarCreateServePattern({
      definition: pathname + querySuffix,
      pathname,
      path: route.pattern.pathCaptures,
      query: route.pattern.queryCaptures,
    });
    routes[routes.length] = __velarCreateServeRoute(
      route.method,
      pattern,
      route.parameters,
      route.handler,
      __velarServeRouteMetadata(route),
    );
  }
  for (let index = 0; index < app.webSockets.length; index += 1) {
    const route = app.webSockets[index];
    const pathname = path + (route.path === "/" ? "" : route.path);
    const querySuffix = __velarServeCall(__velarServeStringSlice, route.pattern.definition, [route.path.length]);
    const pattern = __velarCreateServePattern({definition: pathname + querySuffix, pathname, path: route.pattern.pathCaptures, query: route.pattern.queryCaptures});
    webSockets[webSockets.length] = __velarCreateServeWebSocket(pattern, route.parameters, route.handler);
  }
  const items = [];
  for (let index = 0; index < routes.length; index += 1) items[items.length] = routes[index];
  for (let index = 0; index < webSockets.length; index += 1) items[items.length] = webSockets[index];
  const output = __velarCreateServeApp(app.name, items);
  return __velarServeAppValue(output.name, output.routes, output.webSockets, app.lifecycles, null, app.responseHandler);
}

export function staticFiles(path, root, fallback = null) {
  path = __velarServeRoutePath(path, "staticFiles path");
  if (path !== "/" && __velarServeCall(__velarServeStringEndsWith, path, ["/"])) throw new __velarServeTypeError("staticFiles path must not end with '/'");
  const pattern = path === "/" ? "/*" : path + "/*";
  const routePattern = __velarCreateServePattern({definition: pattern, pathname: pattern, path: [], query: []});
  const route = __velarCreateServeRoute("GET", routePattern, [{name: "request", source: "request", kind: "request", required: true}], async (_path, request) => {
    const relative = path === "/" ? request.path : __velarServeCall(__velarServeStringSlice, request.path, [path.length]);
    return fileResponse(root, relative || "/", fallback);
  }, {documented: false});
  return __velarCreateServeApp("static", [route]);
}

export function use(app, middleware) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("use requires a ServeApp");
  const additions = __velarServeIsArray(middleware) ? middleware : [middleware];
  if (additions.length === 0 || additions.length > 64) throw new __velarServeRangeError("use requires 1 through 64 middleware functions");
  for (let index = 0; index < additions.length; index += 1) if (typeof additions[index] !== "function") throw new __velarServeTypeError("use middleware entries must be functions");
  const routes = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    const entries = [];
    for (let item = 0; item < route.middleware.length; item += 1) entries[entries.length] = route.middleware[item];
    for (let item = 0; item < additions.length; item += 1) entries[entries.length] = additions[item];
    routes[routes.length] = __velarCreateServeRoute(
      route.method,
      route.pattern,
      route.parameters,
      route.handler,
      {...__velarServeRouteMetadata(route), middleware: entries},
    );
  }
  let notFound = app.notFound;
  if (notFound !== null) {
    const entries = [];
    for (let item = 0; item < notFound.middleware.length; item += 1) entries[entries.length] = notFound.middleware[item];
    for (let item = 0; item < additions.length; item += 1) entries[entries.length] = additions[item];
    notFound = __velarCreateServeNotFound(notFound.handler, entries);
  }
  const items = [];
  for (let index = 0; index < routes.length; index += 1) items[items.length] = routes[index];
  for (let index = 0; index < app.webSockets.length; index += 1) items[items.length] = app.webSockets[index];
  if (notFound !== null) items[items.length] = notFound;
  const output = __velarCreateServeApp(app.name, items);
  return __velarServeAppValue(output.name, output.routes, output.webSockets, app.lifecycles, output.notFound, app.responseHandler);
}

export function bodyLimit(app, maxBytes) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("bodyLimit requires a ServeApp");
  maxBytes = __velarServeBodyLimit(maxBytes);
  const routes = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    routes[routes.length] = __velarCreateServeRoute(
      route.method,
      route.pattern,
      route.parameters,
      route.handler,
      {...__velarServeRouteMetadata(route), maxBodyBytes: maxBytes},
    );
  }
  const items = [];
  for (let index = 0; index < routes.length; index += 1) items[items.length] = routes[index];
  for (let index = 0; index < app.webSockets.length; index += 1) items[items.length] = app.webSockets[index];
  const output = __velarCreateServeApp(app.name, items);
  return __velarServeAppValue(output.name, output.routes, output.webSockets, app.lifecycles, app.notFound, app.responseHandler);
}

export function lifecycle(app, startup = null, shutdown = null) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("lifecycle requires a ServeApp");
  if (startup !== null && typeof startup !== "function" || shutdown !== null && typeof shutdown !== "function") throw new __velarServeTypeError("lifecycle hooks must be functions or null");
  if (app.lifecycles.length >= __velarServeMaxLifecycles) throw new __velarServeRangeError("ServeApp cannot contain more than 4096 lifecycle pairs");
  const lifecycles = [];
  for (let index = 0; index < app.lifecycles.length; index += 1) lifecycles[index] = app.lifecycles[index];
  lifecycles[lifecycles.length] = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{startup, shutdown}]);
  return __velarServeAppValue(app.name, app.routes, app.webSockets, lifecycles, app.notFound, app.responseHandler);
}

function __velarServeResponseWithHeaders(value, additions) {
  value = __velarServeAutomaticResponse(value);
  if (__velarServeIsFileResponse(value)) {
    const headers = __velarServeHeaders(value.headers);
    const pairs = __velarServeMapSnapshot(additions, "Middleware headers");
    for (let index = 0; index < pairs.length; index += 1) __velarServeMergeResponseHeader(headers, pairs[index][0], pairs[index][1]);
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeFileMarker]: true, root: value.root, path: value.path, fallback: value.fallback, headers}]);
  }
  const headers = __velarServeHeaders(value.headers);
  const pairs = __velarServeMapSnapshot(additions, "Middleware headers");
  for (let index = 0; index < pairs.length; index += 1) __velarServeMergeResponseHeader(headers, pairs[index][0], pairs[index][1]);
  return __velarServeResponseCopy(value, headers);
}

function __velarServeMergeResponseHeader(headers, name, value) {
  const lower = __velarServeCall(__velarServeStringToLowerCase, name, []);
  const pairs = __velarServeMapSnapshot(headers, "ServeResponse.headers");
  let previous;
  for (let index = 0; index < pairs.length; index += 1) if (__velarServeCall(__velarServeStringToLowerCase, pairs[index][0], []) === lower) {
    previous = pairs[index][1];
    __velarServeCall(__velarServeMapDelete, headers, [pairs[index][0]]);
  }
  if (lower === "vary" && previous !== undefined) {
    const existing = __velarServeCall(__velarServeStringSplit, previous, [","]);
    const additions = __velarServeCall(__velarServeStringSplit, value, [","]);
    const normalized = [];
    for (let index = 0; index < existing.length; index += 1) normalized[normalized.length] = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, existing[index], []), []);
    for (let index = 0; index < additions.length; index += 1) {
      const item = __velarServeCall(__velarServeStringTrim, additions[index], []);
      if (!__velarServeCall(__velarServeArrayIncludes, normalized, [__velarServeCall(__velarServeStringToLowerCase, item, [])])) {
        previous += (previous === "" ? "" : ", ") + item;
      }
    }
    value = previous;
  }
  __velarServeCall(__velarServeMapSet, headers, [name, value]);
}

function __velarServeStringList(value, name, maximum = 128) {
  if (!__velarServeIsArray(value) || value.length > maximum) throw new __velarServeTypeError(name + " must be a bounded List<string>");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string" || value[index].length === 0 || value[index].length > 1024 || /[\0\r\n]/u.test(value[index])) throw new __velarServeTypeError(name + " must contain bounded single-line strings");
    output[index] = value[index];
  }
  return output;
}

function __velarServeCors(origins = ["*"], methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], headers = ["content-type", "authorization"], credentials = false, maxAge = 600) {
  origins = __velarServeStringList(origins, "middleware.cors origins");
  methods = __velarServeStringList(methods, "middleware.cors methods");
  headers = __velarServeStringList(headers, "middleware.cors headers");
  if (typeof credentials !== "boolean" || !__velarServeIsSafeInteger(maxAge) || maxAge < 0 || maxAge > 86400) throw new __velarServeTypeError("middleware.cors options are invalid");
  if (credentials && __velarServeCall(__velarServeArrayIncludes, origins, ["*"])) throw new __velarServeTypeError("middleware.cors cannot combine credentials with the '*' origin wildcard");
  return async (request, next) => {
    const origin = __velarServeCall(__velarServeMapHas, request.headers, ["origin"]) ? __velarServeCall(__velarServeMapGet, request.headers, ["origin"]) : null;
    const wildcard = __velarServeCall(__velarServeArrayIncludes, origins, ["*"]);
    const allowed = origin !== null && (wildcard || __velarServeCall(__velarServeArrayIncludes, origins, [origin]));
    if (origin !== null && !allowed) return __velarServeOutcome(null, 403, null, __velarServeProblem(403, "security.origin_not_allowed", "Origin is not allowed", null, "header", "origin"));
    const response = await next();
    if (!allowed) return response;
    const output = new __velarServeMap([
      ["access-control-allow-origin", wildcard && !credentials ? "*" : origin],
      ["access-control-allow-methods", __velarServeCall(__velarServeArrayJoin, methods, [", "])],
      ["access-control-allow-headers", __velarServeCall(__velarServeArrayJoin, headers, [", "])],
      ["access-control-max-age", __velarServeString(maxAge)],
      ["vary", "Origin"],
    ]);
    if (credentials) __velarServeCall(__velarServeMapSet, output, ["access-control-allow-credentials", "true"]);
    return __velarServeResponseWithHeaders(response, output);
  };
}

function __velarServeTrustedHosts(hosts) {
  hosts = __velarServeStringList(hosts, "middleware.trustedHosts hosts");
  return async (request, next) => {
    const hostHeader = __velarServeCall(__velarServeMapHas, request.headers, ["host"]) ? __velarServeCall(__velarServeMapGet, request.headers, ["host"]) : "";
    let host;
    if (__velarServeCall(__velarServeStringStartsWith, hostHeader, ["["])) {
      const end = __velarServeCall(__velarServeStringIndexOf, hostHeader, ["]"]);
      host = end < 2 ? "" : __velarServeCall(__velarServeStringSlice, hostHeader, [1, end]);
    } else {
      const pieces = __velarServeCall(__velarServeStringSplit, hostHeader, [":"]);
      host = pieces.length === 2 ? pieces[0] : hostHeader;
    }
    host = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, host, []), []);
    let accepted = false;
    for (let index = 0; index < hosts.length; index += 1) {
      let allowed = __velarServeCall(__velarServeStringToLowerCase, hosts[index], []);
      if (__velarServeCall(__velarServeStringStartsWith, allowed, ["["]) && __velarServeCall(__velarServeStringEndsWith, allowed, ["]"])) allowed = __velarServeCall(__velarServeStringSlice, allowed, [1, -1]);
      if (allowed === "*" || allowed === host || __velarServeCall(__velarServeStringStartsWith, allowed, ["*."]) && __velarServeCall(__velarServeStringEndsWith, host, [__velarServeCall(__velarServeStringSlice, allowed, [1])])) { accepted = true; break; }
    }
    return accepted ? await next() : __velarServeOutcome(null, 400, null, __velarServeProblem(400, "security.untrusted_host", "Host is not trusted", null, "header", "host"));
  };
}

function __velarServeRequestId(header = "x-request-id") {
  header = __velarServeCall(__velarServeStringToLowerCase, __velarServeInputName(header, "middleware.requestId"), []);
  if (header.length === 0 || !__velarServeCall(__velarServeRegExpTest, __velarServeHeaderNamePattern, [header])) throw new __velarServeTypeError("middleware.requestId header is invalid");
  return async (request, next) => {
    let value = __velarServeCall(__velarServeMapHas, request.headers, [header]) ? __velarServeCall(__velarServeMapGet, request.headers, [header]) : null;
    if (value === null || value.length === 0 || value.length > 256 || /[\0\r\n]/u.test(value)) {
      if (!__velarServeIsSafeInteger(__velarServeNextRequestId)) __velarServeNextRequestId = 1;
      value = "velar-" + __velarServeCall(__velarServeDateNow, __velarServeDate, []) + "-" + __velarServeNextRequestId++;
    }
    return __velarServeResponseWithHeaders(await next(), new __velarServeMap([[header, value]]));
  };
}

function __velarServeAccessLog(write) {
  if (typeof write !== "function") throw new __velarServeTypeError("middleware.accessLog requires a writer function");
  return async (request, next) => {
    const started = __velarServeCall(__velarServeDateNow, __velarServeDate, []);
    const response = await next();
    const normalized = __velarServeAutomaticResponse(response);
    const status = __velarServeIsFileResponse(normalized) ? 200 : normalized.status;
    await __velarServeCall(write, undefined, [{method: request.method, path: request.path, status, durationMs: __velarServeCall(__velarServeDateNow, __velarServeDate, []) - started}]);
    return response;
  };
}

function __velarServeSecurityHeaders() {
  const headers = new __velarServeMap([
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "no-referrer"],
    ["cross-origin-resource-policy", "same-origin"],
  ]);
  return async (_request, next) => __velarServeResponseWithHeaders(await next(), headers);
}

function __velarServeCompression(minimumBytes = 1024) {
  if (!__velarServeIsSafeInteger(minimumBytes) || minimumBytes < 0 || minimumBytes > __velarServeMaxBodyBytes) throw new __velarServeRangeError("middleware.compression minimumBytes is invalid");
  return async (request, next) => {
    const response = __velarServeAutomaticResponse(await next());
    if (__velarServeIsFileResponse(response) || __velarServeOwnDescriptor(response, "stream")) return response;
    const serialized = __velarServeOwnDescriptor(response, "json") ? __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [response]) : null;
    const size = serialized !== null && serialized !== undefined ? __velarUtf8ByteLength(serialized) : __velarUtf8ByteLength(response.text);
    if (size < minimumBytes || !__velarServeCall(__velarServeMapHas, request.headers, ["accept-encoding"])) return response;
    const accepted = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeMapGet, request.headers, ["accept-encoding"]), []), [","]);
    let br = -1;
    let gzip = -1;
    let wildcard = -1;
    for (let index = 0; index < accepted.length; index += 1) {
      const parts = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringTrim, accepted[index], []), [";"]);
      const name = __velarServeCall(__velarServeStringTrim, parts[0], []);
      let quality = 1;
      for (let part = 1; part < parts.length; part += 1) {
        const option = __velarServeCall(__velarServeStringTrim, parts[part], []);
        if (__velarServeCall(__velarServeStringStartsWith, option, ["q="])) {
          quality = __velarServeNumber(__velarServeCall(__velarServeStringSlice, option, [2]));
          if (!__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [quality]) || quality < 0 || quality > 1) quality = 0;
        }
      }
      if (name === "br") br = quality;
      else if (name === "gzip") gzip = quality;
      else if (name === "*") wildcard = quality;
    }
    if (br < 0) br = wildcard;
    if (gzip < 0) gzip = wildcard;
    const encoding = br > 0 && br >= gzip ? "br" : gzip > 0 ? "gzip" : null;
    if (encoding === null) return response;
    const headers = __velarServeHeaders(response.headers);
    __velarServeMergeResponseHeader(headers, "vary", "Accept-Encoding");
    const output = __velarServeResponseCopy(response, headers);
    const fields = {status: output.status, headers: output.headers, compression: encoding};
    if (__velarServeOwnDescriptor(output, "json")) fields.json = output.json;
    else { fields.text = output.text; if (output.contentType != null) fields.contentType = output.contentType; }
    if (output.background != null) fields.background = output.background;
    return __velarServeResponse(fields);
  };
}

function __velarServeErrorMiddleware(handle) {
  if (typeof handle !== "function") throw new __velarServeTypeError("middleware.errors requires a handler function");
  return async (request, next) => { try { return await next(); } catch (error) { return await __velarServeCall(handle, undefined, [error, request]); } };
}

function __velarServeTimeout(milliseconds) {
  if (!__velarServeIsSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 3_600_000) throw new __velarServeRangeError("middleware.timeout must be 1 through 3600000 milliseconds");
  return async (request, next) => {
    if (__velarServeActiveTimeouts >= __velarServeMaxActiveTimeouts) {
      return __velarServeOutcome(null, 503, null, __velarServeProblem(503, "server.busy", "Server is busy", null, null, null, new __velarServeMap([["retry-after", "1"]])));
    }
    let timer = null;
    const pending = next();
    const expired = new __velarServePromise(resolve => { timer = __velarServeCall(__velarServeSetTimeout, globalThis, [() => resolve(__velarServeMissing), milliseconds]); });
    try {
      const result = await __velarServeCall(__velarServePromiseRace, __velarServePromise, [__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [[pending, expired]])]);
      if (result !== __velarServeMissing) return result;
      __velarServeCancellation.__velarCancel(request.cancellation, "Request timed out");
      // The published bound counts unfinished timed-out continuations, and the
      // background reservation at __velarServeRunBackground subtracts exactly
      // this many slots from the process total. Admission alone cannot hold
      // that count: a burst admitted while nothing was detached can expire
      // together. When the detached budget is full the request has already been
      // cancelled, so wait for it to unwind here instead of detaching work the
      // process no longer accounts for.
      if (__velarServeActiveTimeouts >= __velarServeMaxActiveTimeouts) {
        try { await pending; }
        catch (error) { __velarServeReportFailure(error); }
        return __velarServeOutcome(null, 504, null, __velarServeProblem(504, "request.timeout", "Request timed out"));
      }
      __velarServeActiveTimeouts += 1;
      __velarServeActiveBackgroundTasks += 1;
      const settlement = (async () => {
        try { await pending; }
        catch (error) { __velarServeReportFailure(error); }
        finally {
          __velarServeActiveTimeouts -= 1;
          __velarServeActiveBackgroundTasks -= 1;
        }
        return null;
      })();
      __velarServeRegisterTimeoutSettlement(request, settlement);
      const continuation = async () => {
        return await settlement;
      };
      __velarServeCall(__velarServeWeakMapSet, __velarServeReservedBackground, [continuation, true]);
      return __velarServeOutcome(null, 504, null, __velarServeProblem(504, "request.timeout", "Request timed out"), [continuation]);
    } finally {
      if (timer !== null) __velarServeCall(__velarServeClearTimeout, globalThis, [timer]);
    }
  };
}

function __velarServeConcurrency(maximum) {
  if (!__velarServeIsSafeInteger(maximum) || maximum < 1 || maximum > 4096) throw new __velarServeRangeError("middleware.concurrency maximum must be from 1 through 4096");
  let active = 0;
  return async (_request, next) => {
    if (active >= maximum) return __velarServeOutcome(null, 503, null, __velarServeProblem(503, "server.busy", "Server is busy", null, null, null, new __velarServeMap([["retry-after", "1"]])));
    active += 1;
    try { return await next(); }
    finally { active -= 1; }
  };
}

export const middleware = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
  cors: __velarServeCors,
  trustedHosts: __velarServeTrustedHosts,
  requestId: __velarServeRequestId,
  accessLog: __velarServeAccessLog,
  securityHeaders: __velarServeSecurityHeaders,
  compression: __velarServeCompression,
  errors: __velarServeErrorMiddleware,
  timeout: __velarServeTimeout,
  concurrency: __velarServeConcurrency,
}]);

function __velarServeMatch(route, actual) {
  const pattern = route.segments;
  const values = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  let score = 0;
  for (let index = 1; index < pattern.length; index += 1) {
    const expected = pattern[index];
    if (expected === "*") return {values, score};
    if (index >= actual.length) return null;
    const received = actual[index];
    if (__velarServeCall(__velarServeStringStartsWith, expected, ["{"]) && __velarServeCall(__velarServeStringEndsWith, expected, ["}"])) {
      const declaration = __velarServeCall(__velarServeStringSlice, expected, [1, -1]);
      const separator = __velarServeCall(__velarServeStringIndexOf, declaration, [":"]);
      values[__velarServeCall(__velarServeStringSlice, declaration, [0, separator])] = received;
      score += 1;
    } else {
      if (expected !== received) return null;
      score += 4;
    }
  }
  return actual.length === pattern.length ? {values, score} : null;
}

function __velarServeRouter(routes) {
  const methods = new __velarServeMap();
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    let buckets = __velarServeCall(__velarServeMapGet, methods, [route.method]);
    if (buckets === undefined) { buckets = new __velarServeMap(); __velarServeCall(__velarServeMapSet, methods, [route.method, buckets]); }
    const first = route.segments.length < 2 || route.segments[1] === "" ? "" : route.segments[1];
    const key = first === "*" || __velarServeCall(__velarServeStringStartsWith, first, ["{"]) ? "*" : first;
    let entries = __velarServeCall(__velarServeMapGet, buckets, [key]);
    if (entries === undefined) { entries = []; __velarServeCall(__velarServeMapSet, buckets, [key, entries]); }
    entries[entries.length] = route;
  }
  return methods;
}

function __velarServeRouterRoutes(app, method, actual) {
  const buckets = __velarServeCall(__velarServeMapGet, app.router, [method]);
  if (buckets === undefined) return [];
  const output = [];
  const first = actual.length < 2 ? "" : actual[1];
  const literal = __velarServeCall(__velarServeMapGet, buckets, [first]);
  if (literal !== undefined) for (let index = 0; index < literal.length; index += 1) output[output.length] = literal[index];
  const dynamic = __velarServeCall(__velarServeMapGet, buckets, ["*"]);
  if (dynamic !== undefined) for (let index = 0; index < dynamic.length; index += 1) output[output.length] = dynamic[index];
  return output;
}

function __velarServeDecodeScalarValue(raw, kind, name) {
  let value = raw;
  if (kind === "number") {
    value = __velarServeNumber(raw);
    if (!__velarServeCall(__velarServeRegExpTest, __velarServeDecimalPattern, [raw])
      || !__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [value])) {
      throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
    }
  } else if (kind === "bool") {
    if (raw === "true") value = true;
    else if (raw === "false") value = false;
    else throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
  }
  return value;
}

function __velarServeDecodeScalar(raw, parameter) {
  const value = __velarServeDecodeScalarValue(raw, parameter.kind, parameter.name);
  let valid = false;
  try { valid = parameter.check(value) === true; } catch {}
  if (!valid) throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: parameter.name});
  return value;
}

function __velarServeCookieValue(request, name) {
  if (!__velarServeCall(__velarServeMapHas, request.headers, ["cookie"])) return __velarServeMissing;
  const pieces = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeMapGet, request.headers, ["cookie"]), [";"]);
  let encoded = null;
  let matches = 0;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = __velarServeCall(__velarServeStringTrim, pieces[index], []);
    const separator = __velarServeCall(__velarServeStringIndexOf, piece, ["="]);
    if (separator < 0 || __velarServeCall(__velarServeStringSlice, piece, [0, separator]) !== name) continue;
    matches += 1;
    if (matches > 1) throw __velarServeRequestProblem(400, {error: "duplicate_cookie", parameter: name});
    encoded = __velarServeCall(__velarServeStringSlice, piece, [separator + 1]);
  }
  if (matches === 0) return __velarServeMissing;
  try { return __velarServeCall(__velarServeDecodeURIComponent, undefined, [encoded]); }
  catch { throw __velarServeRequestProblem(400, {error: "invalid_cookie", parameter: name}); }
}

function __velarServeNamedInputRaw(descriptor, parameterName, request) {
  const name = descriptor.name === "" ? parameterName : descriptor.name;
  if (descriptor.source === "query") {
    if (!__velarServeCall(__velarServeMapHas, request.queryAll, [name])) return __velarServeMissing;
    const values = __velarServeCall(__velarServeMapGet, request.queryAll, [name]);
    if (values.length !== 1) throw __velarServeRequestProblem(422, {error: "duplicate_parameter", parameter: name});
    return values[0];
  }
  if (descriptor.source === "header") {
    const normalized = __velarServeCall(__velarServeStringToLowerCase, name, []);
    return __velarServeCall(__velarServeMapHas, request.headers, [normalized])
      ? __velarServeCall(__velarServeMapGet, request.headers, [normalized])
      : __velarServeMissing;
  }
  if (descriptor.source === "cookie") return __velarServeCookieValue(request, name);
  return __velarServeMissing;
}

function __velarServeAuthenticationChallenge(details) {
  if (details.kind === "apiKey") return "ApiKey";
  return details.kind === "basic" ? "Basic" : "Bearer";
}

export function __velarServeAuthenticationError(credential) {
  credential = __velarServeAuthenticationCredential(credential);
  return __velarServeRequestProblem(
    401,
    {error: "not_authenticated"},
    new __velarServeMap([["www-authenticate", __velarServeAuthenticationChallenge(credential.extra)]]),
  );
}

export function __velarServeAuthenticationCredential(credential) {
  if (!__velarServeIsInput(credential) || credential.source !== "security") {
    throw new __velarServeTypeError("Server authentication requires a security credential descriptor");
  }
  return credential;
}

function __velarServeUnauthorized(descriptor) {
  throw __velarServeAuthenticationError(descriptor);
}

function __velarServeSecurityInput(descriptor, request) {
  const details = descriptor.extra;
  if (details.kind === "apiKey") {
    const carrier = __velarServeInputValue(details.source, details.name);
    const value = __velarServeNamedInputRaw(carrier, details.name, request);
    if (value === __velarServeMissing) __velarServeUnauthorized(descriptor);
    return value;
  }
  const authorization = __velarServeCall(__velarServeMapHas, request.headers, ["authorization"])
    ? __velarServeCall(__velarServeMapGet, request.headers, ["authorization"])
    : __velarServeMissing;
  if (authorization === __velarServeMissing) __velarServeUnauthorized(descriptor);
  const separator = __velarServeCall(__velarServeStringIndexOf, authorization, [" "]);
  if (separator < 1) __velarServeUnauthorized(descriptor);
  const protocol = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringSlice, authorization, [0, separator]), []);
  const credential = __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, authorization, [separator + 1]), []);
  if (credential.length === 0) __velarServeUnauthorized(descriptor);
  if (details.kind !== "basic") {
    if (protocol !== "bearer") __velarServeUnauthorized(descriptor);
    return credential;
  }
  if (protocol !== "basic" || typeof __velarServeAtob !== "function") __velarServeUnauthorized(descriptor);
  let decoded;
  try { decoded = __velarServeCall(__velarServeAtob, undefined, [credential]); }
  catch { __velarServeUnauthorized(descriptor); }
  const split = __velarServeCall(__velarServeStringIndexOf, decoded, [":"]);
  if (split < 0) __velarServeUnauthorized(descriptor);
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    username: __velarServeCall(__velarServeStringSlice, decoded, [0, split]),
    password: __velarServeCall(__velarServeStringSlice, decoded, [split + 1]),
  }]);
}

function __velarServeRequestContext(appState) {
  return {appState, cache: new __velarServeMap(), resolving: new __velarServeMap(), releases: [], providerCount: 0, form: null};
}

async function __velarServeCleanupReleases(releases) {
  let failure = null;
  for (let index = releases.length - 1; index >= 0; index -= 1) {
    const entry = releases[index];
    try { await __velarServeCall(entry.release, undefined, [entry.value]); }
    catch (error) { if (failure === null) failure = error; }
  }
  releases.length = 0;
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeCleanupRequestContext(context) {
  let failure = null;
  try { await __velarServeCleanupReleases(context.releases); }
  catch (error) { failure = error; }
  if (context.form !== null) {
    try { const form = await context.form; if (typeof form?.dispose === "function") form.dispose(); }
    catch {}
    context.form = null;
  }
  __velarServeCall(__velarServeMapClear, context.cache, []);
  __velarServeCall(__velarServeMapClear, context.resolving, []);
  context.providerCount = 0;
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeCleanupAppState(appState) {
  if (appState.activeRequests !== 0) throw new __velarServeError("ServeApp providers cannot close while requests are active");
  let failure = null;
  try { await __velarServeCleanupReleases(appState.releases); }
  catch (error) { failure = error; }
  __velarServeCall(__velarServeMapClear, appState.cache, []);
  __velarServeCall(__velarServeMapClear, appState.resolving, []);
  __velarServeCall(__velarServeMapClear, appState.cancellations, []);
  appState.providerCount = 0;
  appState.phase = "closed";
  appState.drain = null;
  appState.resolveDrain = null;
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeResolveProvider(provider, request, maxBodyBytes, context) {
  if (context.appState.overrides !== null && __velarServeCall(__velarServeMapHas, context.appState.overrides, [provider])) {
    return __velarServeCall(__velarServeMapGet, context.appState.overrides, [provider]);
  }
  const appScoped = provider.scope === "app";
  const cache = appScoped ? context.appState.cache : context.cache;
  const resolving = appScoped ? context.appState.resolving : context.resolving;
  const owner = appScoped ? context.appState : context;
  const providerLimit = appScoped ? __velarServeMaxAppProviders : __velarServeMaxRequestProviders;
  if (__velarServeCall(__velarServeMapHas, cache, [provider])) return await __velarServeCall(__velarServeMapGet, cache, [provider]);
  if (__velarServeCall(__velarServeMapHas, resolving, [provider])) throw __velarServeRequestProblem(500, {error: "provider_cycle"});
  if (owner.providerCount >= providerLimit) throw __velarServeRequestProblem(503, {error: "provider_budget_exhausted"});
  owner.providerCount += 1;
  __velarServeCall(__velarServeMapSet, resolving, [provider, true]);
  const pending = (async () => {
    const values = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [provider.inputs]);
    for (let index = 0; index < keys.length; index += 1) {
      const name = keys[index];
      values[name] = await __velarServeResolveInput(provider.inputs[name], name, null, request, maxBodyBytes, context);
    }
    const result = await __velarServeCall(provider.resolve, undefined, [__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [values])]);
    if (provider.release !== null) {
      const releases = appScoped ? context.appState.releases : context.releases;
      releases[releases.length] = {release: provider.release, value: result};
    }
    return result;
  })();
  __velarServeCall(__velarServeMapSet, cache, [provider, pending]);
  try { return await pending; }
  catch (error) { __velarServeCall(__velarServeMapDelete, cache, [provider]); owner.providerCount -= 1; throw error; }
  finally { __velarServeCall(__velarServeMapDelete, resolving, [provider]); }
}

function __velarServeBytePattern(text) {
  const output = new __velarServeUint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) output[index] = text.charCodeAt(index);
  return output;
}

function __velarServeFindBytes(data, pattern, start) {
  if (pattern.length === 0) return start;
  const prefix = new __velarServeUint8Array(pattern.length);
  for (let index = 1, matched = 0; index < pattern.length;) {
    if (pattern[index] === pattern[matched]) prefix[index++] = ++matched;
    else if (matched > 0) matched = prefix[matched - 1];
    else prefix[index++] = 0;
  }
  for (let index = start, matched = 0; index < data.length;) {
    if (data[index] === pattern[matched]) { index += 1; matched += 1; if (matched === pattern.length) return index - matched; }
    else if (matched > 0) matched = prefix[matched - 1];
    else index += 1;
  }
  return -1;
}

function __velarServeDecodeBytes(data, start = 0, end = data.length) {
  try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [__velarServeCall(__velarServeUint8Slice, data, [start, end])]); }
  catch { throw __velarServeRequestProblem(400, {error: "invalid_form_encoding"}); }
}

function __velarServeDispositionValue(value, key) {
  const pieces = __velarServeCall(__velarServeStringSplit, value, [";"]);
  for (let index = 1; index < pieces.length; index += 1) {
    const item = __velarServeCall(__velarServeStringTrim, pieces[index], []);
    const separator = __velarServeCall(__velarServeStringIndexOf, item, ["="]);
    if (separator < 1 || __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringSlice, item, [0, separator]), []) !== key) continue;
    let output = __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, item, [separator + 1]), []);
    if (__velarServeCall(__velarServeStringStartsWith, output, ["\""]) && __velarServeCall(__velarServeStringEndsWith, output, ["\""]) && output.length >= 2) output = __velarServeCall(__velarServeStringSlice, output, [1, -1]);
    return output;
  }
  return null;
}

function __velarServeAddFormField(fields, name, value) {
  const existing = __velarServeOwnDescriptor(fields, name);
  if (existing === undefined) { fields[name] = value; return; }
  if (!existing.enumerable || !("value" in existing)) throw __velarServeRequestProblem(400, {error: "invalid_form"});
  if (__velarServeIsArray(existing.value)) existing.value[existing.value.length] = value;
  else fields[name] = [existing.value, value];
}

function __velarServeMultipartHeaders(text) {
  const output = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const lines = __velarServeCall(__velarServeStringSplit, text, ["\r\n"]);
  if (lines.length > 64) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
  for (let index = 0; index < lines.length; index += 1) {
    const separator = __velarServeCall(__velarServeStringIndexOf, lines[index], [":"]);
    if (separator < 1) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const name = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, lines[index], [0, separator]), []), []);
    output[name] = __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, lines[index], [separator + 1]), []);
  }
  return output;
}

function __velarServeUploadBasename(filename) {
  // A client may send a full path, including a Windows path with backslashes.
  // An Upload name is one file name, never a path an application can compose
  // into a directory it did not intend to write.
  const slashed = __velarServeCall(__velarServeStringSplit, filename, ["/"]);
  const separated = __velarServeCall(__velarServeStringSplit, slashed[slashed.length - 1], ["\\"]);
  const base = separated[separated.length - 1];
  if (base === "" || base === "." || base === ".." || __velarServeCall(__velarServeStringIncludes, base, ["\0"])) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
  return base;
}

function __velarServeMultipart(data, boundary) {
  const opening = __velarServeBytePattern("--" + boundary);
  const separator = __velarServeBytePattern("\r\n\r\n");
  const delimiter = __velarServeBytePattern("\r\n--" + boundary);
  if (__velarServeFindBytes(data, opening, 0) !== 0) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
  const fields = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const files = new __velarServeMap();
  const uploadStates = [];
  let position = opening.length;
  let parts = 0;
  while (position < data.length) {
    if (data[position] === 45 && data[position + 1] === 45) break;
    if (data[position] !== 13 || data[position + 1] !== 10) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    position += 2;
    const headerEnd = __velarServeFindBytes(data, separator, position);
    if (headerEnd < 0 || headerEnd - position > 16 * 1024) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const headers = __velarServeMultipartHeaders(__velarServeDecodeBytes(data, position, headerEnd));
    const contentStart = headerEnd + separator.length;
    const contentEnd = __velarServeFindBytes(data, delimiter, contentStart);
    if (contentEnd < 0) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const disposition = headers["content-disposition"];
    if (typeof disposition !== "string" || !__velarServeCall(__velarServeStringStartsWith, __velarServeCall(__velarServeStringToLowerCase, disposition, []), ["form-data"])) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const name = __velarServeDispositionValue(disposition, "name");
    const filename = __velarServeDispositionValue(disposition, "filename");
    if (name === null || name.length === 0 || name.length > 256) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
    const part = __velarServeCall(__velarServeUint8Subarray, data, [contentStart, contentEnd]);
    if (filename === null) {
      if (part.length > 1024 * 1024) throw __velarServeRequestProblem(413, {error: "form_field_too_large", parameter: name});
      __velarServeAddFormField(fields, name, __velarServeDecodeBytes(part));
    } else {
      if (filename.length > 1024 || __velarServeCall(__velarServeMapHas, files, [name])) throw __velarServeRequestProblem(400, {error: "invalid_multipart"});
      const base = __velarServeUploadBasename(filename);
      const contentType = typeof headers["content-type"] === "string" ? headers["content-type"] : "application/octet-stream";
      __velarServeCall(__velarServeMapSet, files, [name, __velarServeUploadValue(name, base, contentType, part, uploadStates)]);
    }
    parts += 1;
    if (parts > 128) throw __velarServeRequestProblem(413, {error: "too_many_form_parts"});
    position = contentEnd + delimiter.length;
  }
  return {fields, files, dispose() { for (let index = 0; index < uploadStates.length; index += 1) uploadStates[index].data = null; data = null; }};
}

function __velarServeFormComponent(value) {
  const spaced = __velarServeCall(__velarServeArrayJoin, __velarServeCall(__velarServeStringSplit, value, ["+"]), [" "]);
  try { return __velarServeCall(__velarServeDecodeURIComponent, undefined, [spaced]); }
  catch { throw __velarServeRequestProblem(400, {error: "invalid_form_encoding"}); }
}

function __velarServeUrlEncoded(text) {
  const fields = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  if (text === "") return {fields, files: new __velarServeMap(), dispose() {}};
  const pairs = __velarServeCall(__velarServeStringSplit, text, ["&"]);
  if (pairs.length > 128) throw __velarServeRequestProblem(413, {error: "too_many_form_parts"});
  for (let index = 0; index < pairs.length; index += 1) {
    const separator = __velarServeCall(__velarServeStringIndexOf, pairs[index], ["="]);
    const name = __velarServeFormComponent(separator < 0 ? pairs[index] : __velarServeCall(__velarServeStringSlice, pairs[index], [0, separator]));
    const value = __velarServeFormComponent(separator < 0 ? "" : __velarServeCall(__velarServeStringSlice, pairs[index], [separator + 1]));
    if (name.length === 0 || name.length > 256 || value.length > 1024 * 1024) throw __velarServeRequestProblem(400, {error: "invalid_form"});
    __velarServeAddFormField(fields, name, value);
  }
  return {fields, files: new __velarServeMap(), dispose() {}};
}

function __velarServeMediaType(header) {
  const pieces = __velarServeCall(__velarServeStringSplit, header, [";"]);
  return {type: __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, pieces[0], []), []), pieces};
}

async function __velarServeRequestForm(request, maxBodyBytes, context) {
  if (context.form !== null) return await context.form;
  context.form = (async () => {
    const header = __velarServeCall(__velarServeMapHas, request.headers, ["content-type"]) ? __velarServeCall(__velarServeMapGet, request.headers, ["content-type"]) : "";
    const media = __velarServeMediaType(header);
    try {
      if (media.type === "application/x-www-form-urlencoded") return __velarServeUrlEncoded(await request.text(maxBodyBytes));
      if (media.type === "multipart/form-data") {
        let boundary = null;
        for (let index = 1; index < media.pieces.length; index += 1) {
          const item = __velarServeCall(__velarServeStringTrim, media.pieces[index], []);
          if (!__velarServeCall(__velarServeStringStartsWith, __velarServeCall(__velarServeStringToLowerCase, item, []), ["boundary="])) continue;
          boundary = __velarServeCall(__velarServeStringSlice, item, [9]);
          if (__velarServeCall(__velarServeStringStartsWith, boundary, ["\""]) && __velarServeCall(__velarServeStringEndsWith, boundary, ["\""])) boundary = __velarServeCall(__velarServeStringSlice, boundary, [1, -1]);
        }
        if (boundary === null || boundary.length === 0 || boundary.length > 128 || /[\0\r\n]/u.test(boundary)) throw __velarServeRequestProblem(400, {error: "invalid_multipart_boundary"});
        return __velarServeMultipart(await request.bytes(maxBodyBytes), boundary);
      }
    } catch (error) { if (error instanceof RequestBodyTooLargeError) throw __velarServeRequestProblem(413, {error: "request_too_large"}); throw error; }
    throw __velarServeRequestProblem(415, {error: "unsupported_media_type", expected: "multipart/form-data or application/x-www-form-urlencoded"});
  })();
  return await context.form;
}

function __velarServeCoerceForm(fields, schema) {
  const output = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [fields]);
  for (let index = 0; index < keys.length; index += 1) {
    const name = keys[index];
    const value = fields[name];
    const property = schema?.properties?.[name];
    const values = __velarServeIsArray(value) ? value : [value];
    if (__velarServeIsArray(value) && property?.type !== "array") throw __velarServeRequestProblem(422, {error: "duplicate_parameter", parameter: name});
    const item = property?.type === "array" ? property.items : property;
    const converted = [];
    for (let itemIndex = 0; itemIndex < values.length; itemIndex += 1) {
      if (item?.type === "number") {
        const number = __velarServeCall(__velarServeNumber, undefined, [values[itemIndex]]);
        if (!__velarServeCall(__velarServeRegExpTest, __velarServeDecimalPattern, [values[itemIndex]]) || !__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [number])) throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
        converted[converted.length] = number;
      } else if (item?.type === "boolean") {
        if (values[itemIndex] !== "true" && values[itemIndex] !== "false") throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: name});
        converted[converted.length] = values[itemIndex] === "true";
      } else converted[converted.length] = values[itemIndex];
    }
    output[name] = property?.type === "array" ? __velarServeValidateDenseList(converted, "Form List input") : converted[0];
  }
  return output;
}

async function __velarServeResolveInput(descriptor, parameterName, parameter, request, maxBodyBytes, context) {
  if (descriptor.source === "request") return request;
  if (descriptor.source === "dependency") return await __velarServeResolveProvider(descriptor.extra, request, maxBodyBytes, context);
  if (descriptor.source === "security") return __velarServeSecurityInput(descriptor, request);
  if (descriptor.source === "form") {
    const form = await __velarServeRequestForm(request, maxBodyBytes, context);
    const value = __velarServeCoerceForm(form.fields, parameter?.schema ?? null);
    try { return descriptor.extra.parse(value); }
    catch { throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: parameterName}); }
  }
  if (descriptor.source === "upload") {
    const form = await __velarServeRequestForm(request, maxBodyBytes, context);
    const name = descriptor.name === "" ? parameterName : descriptor.name;
    if (!__velarServeCall(__velarServeMapHas, form.files, [name])) throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: name});
    const upload = __velarServeCall(__velarServeMapGet, form.files, [name]);
    if (upload.size > descriptor.extra) throw __velarServeRequestProblem(413, {error: "upload_too_large", parameter: name});
    return upload;
  }
  const raw = __velarServeNamedInputRaw(descriptor, parameterName, request);
  if (raw === __velarServeMissing) {
    if (descriptor.hasDefault) return descriptor.fallback;
    throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: descriptor.name === "" ? parameterName : descriptor.name});
  }
  return parameter === null ? raw : __velarServeDecodeScalar(raw, parameter);
}

async function __velarServeRouteArguments(route, match, request, maxBodyBytes, context, connection = __velarServeMissing) {
  const params = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  for (let index = 0; index < route.pattern.pathCaptures.length; index += 1) {
    const capture = route.pattern.pathCaptures[index];
    const descriptor = __velarServeOwnDescriptor(match.values, capture.name);
    if (descriptor === undefined || !("value" in descriptor)) throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: capture.name});
    params[capture.name] = __velarServeDecodeScalar(descriptor.value, capture);
  }
  const query = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  for (let index = 0; index < route.pattern.queryCaptures.length; index += 1) {
    const capture = route.pattern.queryCaptures[index];
    if (!__velarServeCall(__velarServeMapHas, request.queryAll, [capture.wireName])) {
      if (!capture.optional) throw __velarServeRequestProblem(422, {error: "missing_parameter", parameter: capture.wireName});
      continue;
    }
    const received = __velarServeCall(__velarServeMapGet, request.queryAll, [capture.wireName]);
    if (received.length !== 1) throw __velarServeRequestProblem(422, {error: "duplicate_parameter", parameter: capture.wireName});
    query[capture.name] = __velarServeDecodeScalar(received[0], capture);
  }
  __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [params]);
  __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [query]);
  const bound = {pattern: route.pattern, pathname: request.path, params, query};
  __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [bound, "toString", {value: () => route.pattern.definition, enumerable: false, configurable: false, writable: false}]);
  __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [bound]);
  const values = [bound];
  let body = undefined;
  for (let index = 0; index < route.parameters.length; index += 1) {
    const parameter = route.parameters[index];
    if (parameter.source === "connection") {
      if (connection === __velarServeMissing) throw new __velarServeTypeError("WebSocket connection is unavailable outside a @websocket handler");
      values[values.length] = connection;
      continue;
    }
    if (parameter.source === "request") { values[values.length] = request; continue; }
    if (parameter.input !== null) {
      values[values.length] = await __velarServeResolveInput(parameter.input, parameter.name, parameter, request, maxBodyBytes, context);
      continue;
    }
    if (parameter.source === "body") {
      if (body === undefined) {
        if (!__velarServeJsonContentType(request.headers)) {
          throw __velarServeRequestProblem(415, {error: "unsupported_media_type", expected: "application/json"});
        }
        try { body = await request.json(maxBodyBytes); }
        catch (error) {
          if (error instanceof RequestBodyTooLargeError) throw __velarServeRequestProblem(413, {error: "request_too_large"});
          throw __velarServeRequestProblem(400, {error: "invalid_json"});
        }
      }
      let valid = false;
      try { valid = parameter.check(body) === true; } catch {}
      if (!valid) throw __velarServeRequestProblem(422, {error: "invalid_request", parameter: parameter.name});
      values[values.length] = body;
      continue;
    }
    // 路径和查询值只由 RoutePattern 绑定到第一个 RouteMatch 参数。走到这里说明
    // 编译器桥接数据损坏，不能再猜测来源并形成第二套路由协议。
    throw new __velarServeTypeError("Route parameter has no runtime binding strategy");
  }
  return values;
}

function __velarServeJsonContentType(headers) {
  if (!__velarServeCall(__velarServeMapHas, headers, ["content-type"])) return true;
  const header = __velarServeCall(__velarServeMapGet, headers, ["content-type"]);
  const mediaType = __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeStringTrim, header, []), []);
  const separator = __velarServeCall(__velarServeStringIndexOf, mediaType, [";"]);
  const value = separator < 0 ? mediaType : __velarServeCall(__velarServeStringTrim, __velarServeCall(__velarServeStringSlice, mediaType, [0, separator]), []);
  return value === "application/json"
    || __velarServeCall(__velarServeStringStartsWith, value, ["application/"]) && __velarServeCall(__velarServeStringEndsWith, value, ["+json"]);
}

function __velarServeIsResponseAttempt(value) {
  if (!value || typeof value !== "object" || __velarServeIsArray(value)) return false;
  if (!__velarServeOwnDescriptor(value, "status")) return false;
  return !!(__velarServeOwnDescriptor(value, "json") || __velarServeOwnDescriptor(value, "text") || __velarServeOwnDescriptor(value, "stream"));
}

function __velarServeAutomaticResponse(value) {
  if (__velarServeIsFileResponse(value)) return value;
  if (__velarServeIsResponseAttempt(value)) return __velarServeResponse(value);
  try { return __velarServeResponse(value); }
  catch { return __velarServeResponse({status: 200, json: value}); }
}

function __velarServeProblemDocument(problem, request) {
  const output = {type: problem.type, title: problem.title, status: problem.status, code: problem.code};
  if (problem.detail !== null) output.detail = problem.detail;
  const instance = problem.instance ?? request?.path ?? null;
  if (instance !== null) output.instance = instance;
  if (problem.source !== null) output.source = problem.source;
  if (problem.parameter !== null) output.parameter = problem.parameter;
  return output;
}

function __velarServeAccepts(request, mediaType) {
  if (!request || !__velarServeCall(__velarServeMapHas, request.headers, ["accept"])) return true;
  const source = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringToLowerCase, __velarServeCall(__velarServeMapGet, request.headers, ["accept"]), []), [","]);
  const slash = __velarServeCall(__velarServeStringIndexOf, mediaType, ["/"]);
  const family = __velarServeCall(__velarServeStringSlice, mediaType, [0, slash]);
  for (let index = 0; index < source.length; index += 1) {
    const parts = __velarServeCall(__velarServeStringSplit, __velarServeCall(__velarServeStringTrim, source[index], []), [";"]);
    const accepted = __velarServeCall(__velarServeStringTrim, parts[0], []);
    let quality = 1;
    for (let part = 1; part < parts.length; part += 1) {
      const option = __velarServeCall(__velarServeStringTrim, parts[part], []);
      if (__velarServeCall(__velarServeStringStartsWith, option, ["q="])) quality = __velarServeNumber(__velarServeCall(__velarServeStringSlice, option, [2]));
    }
    if (!(quality > 0)) continue;
    if (accepted === "*/*" || accepted === mediaType || accepted === family + "/*") return true;
    if (__velarServeCall(__velarServeStringEndsWith, mediaType, ["+json"]) && accepted === "application/json") return true;
  }
  return false;
}

function __velarServeOutcomeHeaders(outcome) {
  const headers = __velarServeHeaders(outcome.headers);
  if (outcome.problem !== null) {
    const problemHeaders = __velarServeResponseHeaders(outcome.problem.headers);
    for (let index = 0; index < problemHeaders.length; index += 1) __velarServeCall(__velarServeMapSet, headers, [problemHeaders[index][0], problemHeaders[index][1]]);
  }
  return headers;
}

function __velarServeOutcomeResponse(response, outcome) {
  if (__velarServeIsFileResponse(response)) return response;
  if (outcome.background != null) response = __velarServeResponseCopy(response, null, outcome.background);
  const cookies = __velarServeCall(__velarServeWeakMapGet, __velarServeResponseCookies, [outcome]);
  if (cookies !== undefined) __velarServeCall(__velarServeWeakMapSet, __velarServeResponseCookies, [response, cookies]);
  return response;
}

function __velarServeEncodeOutcome(value, outcome, request, problemDocument = false) {
  const headers = __velarServeOutcomeHeaders(outcome);
  if (outcome.status === 204 || outcome.status === 304) return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, text: "", headers}), outcome);
  if (problemDocument) {
    return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, json: value, contentType: "application/problem+json; charset=utf-8", headers}), outcome);
  }
  if (typeof value === "string") {
    if (__velarServeAccepts(request, "text/plain")) return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, text: value, contentType: "text/plain; charset=utf-8", headers}), outcome);
  } else if (__velarServeAccepts(request, "application/json")) {
    return __velarServeOutcomeResponse(__velarServeResponse({status: outcome.status, json: value, headers}), outcome);
  }
  const unacceptable = __velarServeProblem(406, "response.not_acceptable", "No acceptable response representation");
  const rejected = __velarServeOutcome(null, 406, headers, unacceptable);
  return __velarServeOutcomeResponse(__velarServeResponse({status: 406, json: __velarServeProblemDocument(unacceptable, request), contentType: "application/problem+json; charset=utf-8", headers: __velarServeOutcomeHeaders(rejected)}), rejected);
}

async function __velarServeFinalize(value, app, request, status = 200, problem = null, usePolicy = true) {
  if (__velarServeIsFileResponse(value)) return value;
  if (__velarServeIsResponseAttempt(value)) return __velarServeResponse(value);
  let outcome = __velarServeIsOutcome(value) ? value : __velarServeOutcome(value, problem?.status ?? status, null, problem);
  if (usePolicy && app.responseHandler !== null) {
    try {
      const mapped = await __velarServeCall(app.responseHandler.handler, undefined, [outcome, request]);
      if (__velarServeIsOutcome(mapped)) throw new __velarServeTypeError("@response returns Data or a final response, not another HttpOutcome");
      if (__velarServeIsFileResponse(mapped)) return mapped;
      if (__velarServeIsResponseAttempt(mapped)) return __velarServeOutcomeResponse(__velarServeResponse(mapped), outcome);
      return __velarServeEncodeOutcome(mapped, outcome, request, false);
    } catch (policyError) {
      // 策略是一次性边界。它失败后若回到外层通用 catch，再次 finalize 会重复
      // 调用策略并放大日志、写库等副作用，因此在这里直接降级且明确关闭策略。
      const failure = policyError instanceof HttpProblem
        ? policyError
        : __velarServeProblem(500, "server.response_policy", "Response policy failed");
      if (!(policyError instanceof HttpProblem)) __velarServeReportFailure(policyError);
      const failed = __velarServeOutcome(null, failure.status, null, failure);
      return __velarServeEncodeOutcome(__velarServeProblemDocument(failure, request), failed, request, true);
    }
  }
  const defaultProblem = outcome.problem !== null && outcome.value === null;
  const representation = defaultProblem ? __velarServeProblemDocument(outcome.problem, request) : outcome.value;
  return __velarServeEncodeOutcome(representation, outcome, request, defaultProblem);
}

async function __velarServeHandleAppResponse(app, request, maxBodyBytes, context) {
  try {
    const actual = __velarServeCall(__velarServeStringSplit, request.path, ["/"]);
    const candidates = [];
    const allowed = new __velarServeMap();
    let pathOwner = null;
    const declared = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    for (let methodIndex = 0; methodIndex < declared.length; methodIndex += 1) {
      const routes = __velarServeRouterRoutes(app, declared[methodIndex], actual);
      for (let index = 0; index < routes.length; index += 1) {
        const route = routes[index];
        const match = __velarServeMatch(route, actual);
        if (!match) continue;
        if (pathOwner === null || match.score > pathOwner.match.score) pathOwner = {route, match};
        __velarServeCall(__velarServeMapSet, allowed, [route.method, true]);
        if (route.method === request.method || request.method === "HEAD" && route.method === "GET") candidates[candidates.length] = {route, match};
      }
    }
    if (request.method === "OPTIONS" && __velarServeCall(__velarServeMapSize, allowed, []) > 0) {
      const methods = __velarServeAllowedMethods(allowed);
      return await __velarServeApplyMiddleware(pathOwner.route, request, async () => __velarServeOutcome(null, 204, new __velarServeMap([["allow", __velarServeCall(__velarServeArrayJoin, methods, [", "])]])), value => __velarServeFinalize(value, app, request));
    }
    if (candidates.length === 0) {
      if (__velarServeCall(__velarServeMapSize, allowed, []) > 0) {
        const methods = __velarServeAllowedMethods(allowed);
        const problem = __velarServeProblem(405, "route.method_not_allowed", "Method not allowed", null, "method", request.method, new __velarServeMap([["allow", __velarServeCall(__velarServeArrayJoin, methods, [", "])]]));
        return await __velarServeApplyMiddleware(pathOwner.route, request, async () => __velarServeOutcome(null, 405, null, problem), value => __velarServeFinalize(value, app, request));
      }
      if (app.notFound !== null) {
        const problem = __velarServeProblem(404, "route.not_found", "Route not found", null, "path", request.path);
        return await __velarServeApplyMiddleware(
          app.notFound,
          request,
          async () => {
            const value = await __velarServeCall(app.notFound.handler, undefined, [request]);
            if (__velarServeIsFileResponse(value) || __velarServeIsResponseAttempt(value)) return value;
            return __velarServeOutcome(value, 404, null, problem);
          },
          value => __velarServeFinalize(value, app, request),
        );
      }
      const problem = __velarServeProblem(404, "route.not_found", "Route not found", null, "path", request.path);
      return await __velarServeFinalize(__velarServeOutcome(null, 404, null, problem), app, request);
    }
    let selected = candidates[0];
    for (let index = 1; index < candidates.length; index += 1) if (candidates[index].match.score > selected.match.score) selected = candidates[index];
    const routeBodyBytes = selected.route.maxBodyBytes === null || selected.route.maxBodyBytes > maxBodyBytes
      ? maxBodyBytes
      : selected.route.maxBodyBytes;
    const invokeRoute = async () => await __velarServeCall(selected.route.handler, undefined, await __velarServeRouteArguments(selected.route, selected.match, request, routeBodyBytes, context));
    return await __velarServeApplyMiddleware(selected.route, request, invokeRoute, value => __velarServeFinalize(value, app, request));
  } catch (error) {
    const problem = error instanceof HttpProblem ? error
      : error instanceof RequestBodyTooLargeError ? __velarServeProblem(413, "request.body_too_large", "Request body is too large")
        : __velarServeProblem(500, "server.internal", "Internal server error");
    if (!(error instanceof HttpProblem) && !(error instanceof RequestBodyTooLargeError)) __velarServeReportFailure(error);
    try { return await __velarServeFinalize(__velarServeOutcome(null, problem.status, null, problem), app, request); }
    catch (policyError) {
      __velarServeReportFailure(policyError);
      const internal = __velarServeProblem(500, "server.response_policy", "Response policy failed");
      return await __velarServeFinalize(__velarServeOutcome(null, 500, null, internal), app, request, 500, internal, false);
    }
  }
}

function __velarServeAppState(overrides = null) {
  return {
    cache: new __velarServeMap(), resolving: new __velarServeMap(), releases: [], providerCount: 0, overrides,
    phase: "open", activeRequests: 0, cancellations: new __velarServeMap(), drain: null, resolveDrain: null,
    startedLifecycles: 0,
  };
}

function __velarServeBeginAppRequest(appState, cancellation) {
  if (appState.phase !== "open") return false;
  appState.activeRequests += 1;
  __velarServeCall(__velarServeMapSet, appState.cancellations, [cancellation, true]);
  return true;
}

function __velarServeEndAppRequest(appState, cancellation) {
  if (appState.activeRequests < 1) throw new __velarServeError("ServeApp request ownership is unbalanced");
  appState.activeRequests -= 1;
  __velarServeCall(__velarServeMapDelete, appState.cancellations, [cancellation]);
  if (appState.activeRequests === 0 && appState.resolveDrain !== null) {
    const resolve = appState.resolveDrain;
    appState.resolveDrain = null;
    resolve(null);
  }
}

async function __velarServeDrainAppState(appState, grace = __velarServeDefaultShutdownGrace) {
  if (!__velarServeIsSafeInteger(grace) || grace < 1 || grace > 120_000) throw new __velarServeRangeError("Server shutdown grace must be 1 through 120000 milliseconds");
  if (appState.phase === "closed") return null;
  appState.phase = "closing";
  const cancellations = __velarServeCall(__velarServeMapEntries, appState.cancellations, []);
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, cancellations, []);
    if (step.done) break;
    __velarServeCancellation.__velarCancel(step.value[0], "Server is stopping");
  }
  if (appState.activeRequests === 0) return null;
  if (appState.drain === null) {
    appState.drain = new __velarServePromise(resolve => { appState.resolveDrain = resolve; });
  }
  let timer = null;
  const deadline = new __velarServePromise((_resolve, reject) => { timer = __velarServeCall(__velarServeSetTimeout, globalThis, [() => reject(new __velarServeError("ServeApp requests did not drain before the shutdown deadline")), grace]); });
  try { await __velarServeCall(__velarServePromiseRace, __velarServePromise, [__velarServeCall(__velarServeObjectFreeze, __velarServeObject, [[appState.drain, deadline]])]); }
  finally { if (timer !== null) __velarServeCall(__velarServeClearTimeout, globalThis, [timer]); }
  return null;
}

function __velarServeCollectEagerProvider(provider, providers, seen) {
  if (__velarServeCall(__velarServeMapHas, seen, [provider])) return;
  __velarServeCall(__velarServeMapSet, seen, [provider, true]);
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [provider.inputs]);
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = provider.inputs[keys[index]];
    if (descriptor.source === "dependency") __velarServeCollectEagerProvider(descriptor.extra, providers, seen);
  }
  if (provider.scope === "app" && provider.eager) providers[providers.length] = provider;
}

async function __velarServeInitializeEagerProviders(app, maxBodyBytes, appState) {
  const providers = [];
  const seen = new __velarServeMap();
  const groups = [app.routes, app.webSockets];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    for (let routeIndex = 0; routeIndex < group.length; routeIndex += 1) {
      const parameters = group[routeIndex].parameters;
      for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
        const descriptor = parameters[parameterIndex].input;
        if (descriptor !== null && descriptor.source === "dependency") __velarServeCollectEagerProvider(descriptor.extra, providers, seen);
      }
    }
  }
  const context = __velarServeRequestContext(appState);
  for (let index = 0; index < providers.length; index += 1) await __velarServeResolveProvider(providers[index], null, maxBodyBytes, context);
  return null;
}

async function __velarServeRunStartup(app, appState) {
  for (let index = appState.startedLifecycles; index < app.lifecycles.length; index += 1) {
    const hook = app.lifecycles[index].startup;
    if (hook !== null) {
      const result = await __velarServeCall(hook, undefined, []);
      if (result !== null) throw new __velarServeTypeError("A lifecycle startup hook must resolve to null");
    }
    appState.startedLifecycles = index + 1;
  }
  return null;
}

async function __velarServeRunShutdown(app, appState) {
  let failure = null;
  for (let index = appState.startedLifecycles - 1; index >= 0; index -= 1) {
    appState.startedLifecycles = index;
    const hook = app.lifecycles[index].shutdown;
    if (hook === null) continue;
    try {
      const result = await __velarServeCall(hook, undefined, []);
      if (result !== null) throw new __velarServeTypeError("A lifecycle shutdown hook must resolve to null");
    } catch (error) { if (failure === null) failure = error; }
  }
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeFinishApp(app, appState) {
  let failure = null;
  try { await __velarServeCleanupAppState(appState); } catch (error) { failure = error; }
  if (__velarServeIsApp(app)) {
    try { await __velarServeRunShutdown(app, appState); } catch (error) { if (failure === null) failure = error; }
  }
  if (failure !== null) throw failure;
  return null;
}

async function __velarServeFinishAppAfterDrain(app, appState) {
  if (appState.activeRequests > 0) {
    if (appState.drain === null) appState.drain = new __velarServePromise(resolve => { appState.resolveDrain = resolve; });
    await appState.drain;
  }
  return await __velarServeFinishApp(app, appState);
}

async function __velarServeHandleApp(app, request, maxBodyBytes, appState) {
  if (!__velarServeBeginAppRequest(appState, request.cancellation)) {
    const problem = __velarServeProblem(503, "server.stopping", "Server is stopping", null, null, null, new __velarServeMap([["connection", "close"]]));
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      [__velarServeManagedResponseMarker]: true,
      response: await __velarServeFinalize(__velarServeOutcome(null, 503, null, problem), app, request),
      cleanup: async () => null,
    }]);
  }
  const context = __velarServeRequestContext(appState);
  try {
    const response = await __velarServeHandleAppResponse(app, request, maxBodyBytes, context);
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return null;
      cleaned = true;
      try {
        await __velarServeWaitTimeoutSettlements(request);
        return await __velarServeCleanupRequestContext(context);
      }
      finally { __velarServeEndAppRequest(appState, request.cancellation); }
    };
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeManagedResponseMarker]: true, response, cleanup}]);
  } catch (error) {
    try {
      await __velarServeWaitTimeoutSettlements(request);
      await __velarServeCleanupRequestContext(context);
    }
    catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    finally { __velarServeEndAppRequest(appState, request.cancellation); }
    throw error;
  }
}

async function __velarServeHandleFunction(handler, request, appState) {
  if (!__velarServeBeginAppRequest(appState, request.cancellation)) {
    const problem = __velarServeProblem(503, "server.stopping", "Server is stopping");
    return await __velarServeFinalize(__velarServeOutcome(null, 503, null, problem), {responseHandler: null}, request);
  }
  try {
    const response = await __velarServeFinalize(await __velarServeCall(handler, undefined, [request]), {responseHandler: null}, request);
    let cleaned = false;
    const cleanup = async () => { if (cleaned) return null; cleaned = true; __velarServeEndAppRequest(appState, request.cancellation); return null; };
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeManagedResponseMarker]: true, response, cleanup}]);
  } catch (error) {
    __velarServeEndAppRequest(appState, request.cancellation);
    throw error;
  }
}

async function __velarServePrepareWebSocket(app, nativeRequest, maxBodyBytes, appState) {
  const native = __velarServeNativeRequest(nativeRequest, maxBodyBytes);
  const request = native.request;
  const reject = status => {
    __velarServeCancellation.__velarCancel(request.cancellation, "WebSocket upgrade rejected");
    native.cleanup();
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status}]);
  };
  const actual = __velarServeCall(__velarServeStringSplit, request.path, ["/"]);
  const routes = __velarServeRouterRoutes({router: app.webSocketRouter}, "WEBSOCKET", actual);
  let selected = null;
  for (let index = 0; index < routes.length; index += 1) {
    const match = __velarServeMatch(routes[index], actual);
    if (match !== null && (selected === null || match.score > selected.match.score)) selected = {route: routes[index], match};
  }
  if (selected === null) return reject(404);
  if (!__velarServeBeginAppRequest(appState, request.cancellation)) return reject(503);
  const context = __velarServeRequestContext(appState);
  let active = true;
  const finish = async reason => {
    if (!active) return null;
    active = false;
    __velarServeCancellation.__velarCancel(request.cancellation, reason);
    let failure = null;
    try { await __velarServeCleanupRequestContext(context); }
    catch (error) { failure = error; }
    native.cleanup();
    __velarServeEndAppRequest(appState, request.cancellation);
    if (failure !== null) throw failure;
    return null;
  };
  try {
    const prepared = await __velarServeRouteArguments(selected.route, selected.match, request, maxBodyBytes, context, null);
    let started = false;
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      accepted: true,
      status: 101,
      run: async connection => {
        if (started || !active) throw new __velarServeError("A prepared WebSocket route can run only once");
        started = true;
        const values = [];
        for (let index = 0; index < prepared.length; index += 1) values[index] = prepared[index];
        values[selected.route.connectionIndex + 1] = connection;
        try {
          const result = await __velarServeCall(selected.route.handler, undefined, values);
          if (result !== null) throw new __velarServeTypeError("@websocket handler must resolve to null");
          return null;
        } catch (error) {
          __velarServeReportFailure(error);
          throw error;
        } finally { await finish("WebSocket session ended"); }
      },
      abort: async () => {
        if (started) return null;
        started = true;
        return await finish("WebSocket upgrade was abandoned");
      },
      // 连接关闭和服务器停机只请求取消，不在这里提前释放请求级依赖。
      // 真正的清理仍由 run 的 finally 完成，避免处理器仍在执行时销毁资源。
      cancel: reason => {
        if (active) __velarServeCancellation.__velarCancel(request.cancellation, reason);
        return null;
      },
    }]);
  } catch (error) {
    try { await finish("WebSocket upgrade failed"); }
    catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    if (error instanceof HttpProblem) return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status: error.status}]);
    if (error instanceof RequestBodyTooLargeError) return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status: 413}]);
    __velarServeReportFailure(error);
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{accepted: false, status: 500}]);
  }
}

async function __velarServeNativeApp(app, maxBodyBytes = __velarServeMaxBodyBytes) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("Native HTTP composition requires a ServeApp");
  maxBodyBytes = __velarServeBodyLimit(maxBodyBytes);
  const appState = __velarServeAppState();
  try {
    await __velarServeRunStartup(app, appState);
    await __velarServeInitializeEagerProviders(app, maxBodyBytes, appState);
  } catch (error) {
    try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
    throw error;
  }
  let closing = null;
  let finalized = null;
  const close = async (grace = __velarServeDefaultShutdownGrace) => {
    if (finalized !== null) return finalized;
    if (closing !== null) return closing;
    const attempt = (async () => {
      try { await __velarServeDrainAppState(appState, grace); }
      catch (error) {
        if (finalized === null) finalized = __velarServeFinishAppAfterDrain(app, appState);
        __velarServeCall(__velarServePromiseThen, finalized, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      finalized = __velarServeFinishApp(app, appState);
      return await finalized;
    })();
    closing = attempt;
    try { return await attempt; }
    finally { if (closing === attempt) closing = null; }
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    handle: request => __velarServeHandleApp(app, request, maxBodyBytes, appState),
    webSocketRoutes: app.webSockets.length,
    prepareWebSocket: request => __velarServePrepareWebSocket(app, request, maxBodyBytes, appState),
    close,
  }]);
}

async function __velarServeApplyMiddleware(route, request, handler, finalize) {
  let next = async () => finalize(await handler());
  for (let index = route.middleware.length - 1; index >= 0; index -= 1) {
    const downstream = next;
    const current = route.middleware[index];
    next = async () => {
      let called = false;
      const guarded = async () => {
        if (called) throw new __velarServeError("A middleware next function can be called only once per request");
        called = true;
        return downstream();
      };
      return finalize(await current(request, guarded));
    };
  }
  return await next();
}

function __velarServeAllowedMethods(allowed) {
  const methods = [];
  const declared = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  for (let index = 0; index < declared.length; index += 1) {
    if (__velarServeCall(__velarServeMapHas, allowed, [declared[index]])) methods[methods.length] = declared[index];
  }
  if (__velarServeCall(__velarServeMapHas, allowed, ["GET"])) methods[methods.length] = "HEAD";
  methods[methods.length] = "OPTIONS";
  return methods;
}

export function openapi(app, title = null, version = "1.0.0") {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("openapi requires a ServeApp");
  if (title === null) title = app.name;
  if (typeof title !== "string" || title.length === 0 || title.length > 256
    || typeof version !== "string" || version.length === 0 || version.length > 256) {
    throw new __velarServeTypeError("openapi title and version must be bounded text");
  }
  const paths = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const operationIds = new __velarServeMap();
  const securitySchemes = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
  const securityNames = new __velarServeMap();
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    if (!route.documented) continue;
    const parameters = [];
    for (let captureIndex = 0; captureIndex < route.pattern.pathCaptures.length; captureIndex += 1) {
      const capture = route.pattern.pathCaptures[captureIndex];
      parameters[parameters.length] = {name: capture.wireName, in: "path", required: true, schema: capture.schema};
    }
    for (let captureIndex = 0; captureIndex < route.pattern.queryCaptures.length; captureIndex += 1) {
      const capture = route.pattern.queryCaptures[captureIndex];
      parameters[parameters.length] = {name: capture.wireName, in: "query", required: !capture.optional, schema: capture.schema};
    }
    let requestBody = null;
    const formProperties = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const formRequired = [];
    let hasUpload = false;
    const operationSecurity = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    const securitySeen = new __velarServeMap();
    let documentsValidationFailure = route.pattern.pathCaptures.length > 0 || route.pattern.queryCaptures.length > 0;
    let documentsMalformedInput = false;
    let documentsBoundedBody = false;
    let documentsMediaType = false;
    for (let item = 0; item < route.parameters.length; item += 1) {
      const parameter = route.parameters[item];
      if (parameter.source === "request") continue;
      if (parameter.source !== "dependency" && parameter.source !== "security") documentsValidationFailure = true;
      if (parameter.source === "cookie" || parameter.source === "body" || parameter.source === "form" || parameter.source === "upload") documentsMalformedInput = true;
      if (parameter.source === "body" || parameter.source === "form" || parameter.source === "upload") {
        documentsBoundedBody = true;
        documentsMediaType = true;
      }
      const schema = __velarServeSchema(parameter.schema, "OpenAPI parameter schema");
      if (parameter.source === "body") requestBody = {required: parameter.required, content: {"application/json": {schema}}};
      else if (parameter.source === "form" || parameter.source === "upload") {
        if (parameter.source === "upload") hasUpload = true;
        const name = parameter.input?.name || parameter.name;
        if (parameter.source === "form" && schema.type === "object" && schema.properties && typeof schema.properties === "object") {
          const propertyNames = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [schema.properties]);
          for (let propertyIndex = 0; propertyIndex < propertyNames.length; propertyIndex += 1) {
            const propertyName = propertyNames[propertyIndex];
            if (__velarServeOwnDescriptor(formProperties, propertyName)) throw new __velarServeTypeError("OpenAPI form inputs contain conflicting field '" + propertyName + "'");
            formProperties[propertyName] = schema.properties[propertyName];
          }
          if (__velarServeIsArray(schema.required)) {
            for (let requiredIndex = 0; requiredIndex < schema.required.length; requiredIndex += 1) {
              if (!__velarServeCall(__velarServeArrayIncludes, formRequired, [schema.required[requiredIndex]])) formRequired[formRequired.length] = schema.required[requiredIndex];
            }
          }
        } else {
          if (__velarServeOwnDescriptor(formProperties, name)) throw new __velarServeTypeError("OpenAPI form inputs contain conflicting field '" + name + "'");
          formProperties[name] = parameter.source === "upload" ? {type: "string", format: "binary"} : schema;
          if (parameter.required) formRequired[formRequired.length] = name;
        }
      } else if (parameter.source === "security" || parameter.source === "dependency") {
        if (parameter.input !== null) __velarServeOpenApiInputSecurity(parameter.input, securitySchemes, securityNames, operationSecurity, securitySeen);
      } else {
        const name = parameter.input?.name || parameter.name;
        parameters[parameters.length] = {name, in: parameter.source, required: parameter.required, schema};
      }
    }
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [formProperties]).length > 0) {
      const schema = {type: "object", properties: formProperties};
      if (formRequired.length > 0) schema.required = formRequired;
      requestBody = {required: formRequired.length > 0, content: hasUpload ? {"multipart/form-data": {schema}} : {"multipart/form-data": {schema}, "application/x-www-form-urlencoded": {schema}}};
    }
    const documentPath = __velarServeOpenApiPath(route.path);
    const operationBase = __velarServeOperationId(route.method, documentPath);
    const operationCount = __velarServeCall(__velarServeMapGet, operationIds, [operationBase]) ?? 0;
    __velarServeCall(__velarServeMapSet, operationIds, [operationBase, operationCount + 1]);
    const operation = {
      operationId: operationCount === 0 ? operationBase : operationBase + "_" + (operationCount + 1),
      parameters,
      responses: __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]),
    };
    // 全局策略的 schema 已在 createResponse 时校验，只复用同一份事实；若为每条
    // 路由重新深拷贝，大型 API 会把同一个外壳按路由数成倍复制。
    const responseSchema = app.responseHandler?.responseSchema
      ?? __velarServeSchema(route.responseSchema, "OpenAPI response schema");
    const responseContentTypes = app.responseHandler?.responseContentTypes ?? route.responseContentTypes;
    const responseContent = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    for (let contentIndex = 0; contentIndex < responseContentTypes.length; contentIndex += 1) responseContent[responseContentTypes[contentIndex]] = {schema: responseSchema};
    operation.responses[__velarServeString(route.status)] = route.status === 204 || route.status === 304
      ? {description: "Successful response"}
      : {description: "Successful response", content: responseContent};
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [operationSecurity]).length > 0) {
      operation.responses["401"] = __velarServeOpenApiFailure("Authentication required", app.responseHandler);
    }
    if (documentsMalformedInput) operation.responses["400"] = __velarServeOpenApiFailure("Malformed request input", app.responseHandler);
    if (documentsBoundedBody) operation.responses["413"] = __velarServeOpenApiFailure("Request body or upload is too large", app.responseHandler);
    if (documentsMediaType) operation.responses["415"] = __velarServeOpenApiFailure("Unsupported request content type", app.responseHandler);
    if (documentsValidationFailure) operation.responses["422"] = __velarServeOpenApiFailure("Request validation failed", app.responseHandler);
    for (let errorIndex = 0; errorIndex < route.errors.length; errorIndex += 1) {
      const error = route.errors[errorIndex];
      operation.responses[__velarServeString(error.status)] = app.responseHandler === null
        ? {description: error.description}
        : __velarServeOpenApiFailure(error.description, app.responseHandler);
    }
    if (route.summary !== null) operation.summary = route.summary;
    if (route.description !== null) operation.description = route.description;
    if (route.tags.length > 0) operation.tags = route.tags;
    if (requestBody) operation.requestBody = requestBody;
    if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [operationSecurity]).length > 0) operation.security = [operationSecurity];
    const entry = paths[documentPath] ?? (paths[documentPath] = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]));
    entry[__velarServeCall(__velarServeStringToLowerCase, route.method, [])] = operation;
  }
  const document = {openapi: "3.1.0", info: {title, version}, paths};
  if (__velarServeCall(__velarServeOwnKeys, __velarServeReflect, [securitySchemes]).length > 0) document.components = {securitySchemes};
  if (__velarUtf8ByteLength(__velarJsonStringify(document)) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("OpenAPI document cannot exceed 16 MiB");
  return document;
}

function __velarServeOpenApiFailure(description, responseHandler = null) {
  if (responseHandler !== null) {
    const content = __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null]);
    for (let index = 0; index < responseHandler.responseContentTypes.length; index += 1) {
      content[responseHandler.responseContentTypes[index]] = {schema: responseHandler.responseSchema};
    }
    return {description, content};
  }
  return {
    description,
    content: {"application/problem+json": {schema: {
      type: "object",
      properties: {
        type: {type: "string"},
        title: {type: "string"},
        status: {type: "integer"},
        code: {type: "string"},
        detail: {type: "string"},
        instance: {type: "string"},
        source: {type: "string"},
        parameter: {type: "string"},
      },
      required: ["type", "title", "status", "code"],
      additionalProperties: true,
    }}},
  };
}

function __velarServeOpenApiInputSecurity(descriptor, schemes, names, requirements, seen) {
  if (descriptor.source === "dependency") {
    const provider = descriptor.extra;
    if (__velarServeCall(__velarServeMapHas, seen, [provider])) return;
    __velarServeCall(__velarServeMapSet, seen, [provider, true]);
    const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [provider.inputs]);
    for (let index = 0; index < keys.length; index += 1) __velarServeOpenApiInputSecurity(provider.inputs[keys[index]], schemes, names, requirements, seen);
    return;
  }
  if (descriptor.source !== "security") return;
  const details = descriptor.extra;
  const identity = __velarJsonStringify(details);
  let name = __velarServeCall(__velarServeMapGet, names, [identity]);
  if (name == null) {
    name = "security" + (__velarServeCall(__velarServeMapSize, names, []) + 1);
    __velarServeCall(__velarServeMapSet, names, [identity, name]);
    if (details.kind === "apiKey") schemes[name] = {type: "apiKey", name: details.name, in: details.source};
    else if (details.kind === "basic") schemes[name] = {type: "http", scheme: "basic"};
    else if (details.kind === "bearer") schemes[name] = {type: "http", scheme: "bearer"};
    else if (details.kind === "oauth2") {
      const flow = {authorizationUrl: details.authorizationUrl, scopes: __velarServeCall(__velarServeObjectCreate, __velarServeObject, [null])};
      if (details.tokenUrl !== "") flow.tokenUrl = details.tokenUrl;
      for (let index = 0; index < details.scopes.length; index += 1) flow.scopes[details.scopes[index]] = details.scopes[index];
      schemes[name] = {type: "oauth2", flows: {authorizationCode: flow}};
    } else schemes[name] = {type: "openIdConnect", openIdConnectUrl: details.url};
  }
  requirements[name] = descriptor.extra.kind === "oauth2" ? descriptor.extra.scopes : [];
}

export function docs(app, title = null, version = "1.0.0", path = "/docs", openapiPath = "/openapi.json", routes = null) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("docs requires a ServeApp");
  path = __velarServeRoutePath(path, "docs path");
  openapiPath = __velarServeRoutePath(openapiPath, "docs OpenAPI path");
  if (path === openapiPath || /[{}*<>]/u.test(path) || /[{}*<>]/u.test(openapiPath)) throw new __velarServeTypeError("docs paths must be distinct literal URL paths");
  app = __velarServeDocumentRoutes(app, routes);
  const document = openapi(app, title, version);
  const schemaPattern = __velarCreateServePattern({definition: openapiPath, pathname: openapiPath, path: [], query: []});
  const docsPattern = __velarCreateServePattern({definition: path, pathname: path, path: [], query: []});
  const schemaRoute = __velarCreateServeRoute("GET", schemaPattern, [], async () => json(document), {documented: false});
  const html = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Velar API Docs</title><style>body{font:15px system-ui;margin:0;background:#0b1020;color:#e8ecf4}main{max-width:960px;margin:auto;padding:32px}article{background:#151c31;border:1px solid #2a3555;border-radius:12px;padding:16px;margin:12px 0}code{color:#8ed7ff}.method{font-weight:700;color:#9cf0b3}button{background:#5b7cff;color:white;border:0;border-radius:7px;padding:8px 12px}</style></head><body><main><h1 id=\"title\">API</h1><p>OpenAPI 3.1 · bundled offline documentation</p><section id=\"routes\"></section></main><script>fetch(" + __velarJsonStringify(openapiPath) + ").then(function(r){return r.json()}).then(function(d){document.getElementById('title').textContent=d.info.title+' '+d.info.version;var root=document.getElementById('routes');Object.keys(d.paths).forEach(function(p){Object.keys(d.paths[p]).forEach(function(m){var a=document.createElement('article');var h=document.createElement('div');h.innerHTML='<span class=\"method\">'+m.toUpperCase()+'</span> <code></code>';h.querySelector('code').textContent=p;a.appendChild(h);var b=document.createElement('button');b.textContent='Try request';b.onclick=function(){fetch(p,{method:m.toUpperCase()}).then(function(r){return r.text().then(function(t){alert(r.status+' '+t)})})};a.appendChild(b);root.appendChild(a)})})}).catch(function(e){document.getElementById('routes').textContent=String(e)});</script></body></html>";
  const uiRoute = __velarCreateServeRoute("GET", docsPattern, [], async () => text(html, 200, "text/html; charset=utf-8"), {documented: false});
  return __velarCreateServeApp(app.name, [app, schemaRoute, uiRoute]);
}

function __velarServeDocumentRoutes(app, documentation) {
  if (documentation == null) return app;
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, documentation, []); iterator = __velarServeCall(__velarServeMapEntries, documentation, []); }
  catch { throw new __velarServeTypeError("docs routes must be a Map<string, route documentation>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > app.routes.length || size > __velarServeMaxRoutes) throw new __velarServeRangeError("docs routes cannot exceed the application route count or 4096 entries");
  const configured = new __velarServeMap();
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2 || typeof step.value[0] !== "string" || step.value[0].length > 4352) {
      throw new __velarServeTypeError("docs routes must be a Map with bounded 'METHOD /path' string keys");
    }
    const metadata = __velarServeRecord(step.value[1], __velarServeRouteDocumentationFields, "Route documentation");
    if (metadata.documented !== undefined && typeof metadata.documented !== "boolean") throw new __velarServeTypeError("Route documentation documented must be bool");
    if (metadata.status !== undefined && (!__velarServeIsSafeInteger(metadata.status) || metadata.status < 200 || metadata.status > 599)) throw new __velarServeRangeError("Route documentation status must be 200 through 599");
    const normalized = {
      ...(metadata.summary === undefined ? {} : {summary: __velarServeDocumentationText(metadata.summary, "Route summary", 1024)}),
      ...(metadata.description === undefined ? {} : {description: __velarServeDocumentationText(metadata.description, "Route description", 16384)}),
      ...(metadata.tags === undefined ? {} : {tags: __velarServeStringList(metadata.tags, "Route documentation tags", 32)}),
      ...(metadata.status === undefined ? {} : {status: metadata.status}),
      ...(metadata.errors === undefined ? {} : {errors: __velarServeErrorDocuments(metadata.errors)}),
      ...(metadata.documented === undefined ? {} : {documented: metadata.documented}),
    };
    __velarServeCall(__velarServeMapSet, configured, [step.value[0], normalized]);
  }
  if (__velarServeCall(__velarServeMapSize, configured, []) !== size) throw new __velarServeTypeError("docs routes changed while they were being read");
  const seen = new __velarServeMap();
  const output = [];
  for (let index = 0; index < app.routes.length; index += 1) {
    const route = app.routes[index];
    const internalKey = route.method + " " + route.path;
    const publicKey = route.method + " " + __velarServeOpenApiPath(route.path);
    const key = __velarServeCall(__velarServeMapHas, configured, [internalKey]) ? internalKey
      : __velarServeCall(__velarServeMapHas, configured, [publicKey]) ? publicKey : null;
    if (key === null) { output[output.length] = route; continue; }
    __velarServeCall(__velarServeMapSet, seen, [key, true]);
    output[output.length] = __velarCreateServeRoute(route.method, route.pattern, route.parameters, route.handler, __velarServeRouteMetadata(route, __velarServeCall(__velarServeMapGet, configured, [key])));
  }
  if (__velarServeCall(__velarServeMapSize, seen, []) !== size) throw new __velarServeTypeError("docs routes contains a route that the application does not declare");
  return __velarServeAppValue(app.name, output, app.webSockets, app.lifecycles, app.notFound, app.responseHandler);
}

function __velarServeOpenApiPath(path) {
  const segments = __velarServeCall(__velarServeStringSplit, path, ["/"]);
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!__velarServeCall(__velarServeStringStartsWith, segment, ["{"])) continue;
    const declaration = __velarServeCall(__velarServeStringSlice, segment, [1, -1]);
    const separator = __velarServeCall(__velarServeStringIndexOf, declaration, [":"]);
    segments[index] = "{" + __velarServeCall(__velarServeStringSlice, declaration, [0, separator]) + "}";
  }
  return __velarServeCall(__velarServeArrayJoin, segments, ["/"]);
}

function __velarServeOperationId(method, path) {
  let output = __velarServeCall(__velarServeStringToLowerCase, method, []);
  let separated = false;
  for (let index = 0; index < path.length; index += 1) {
    const character = path[index];
    if (__velarServeCall(__velarServeRegExpTest, __velarServeOperationIdCharacterPattern, [character])) {
      output += character;
      separated = false;
    } else if (!separated) {
      output += "_";
      separated = true;
    }
  }
  return output;
}

function __velarServeBodyResult(value, maximum) {
  value = __velarServeRecord(value, __velarServeBodyFields, "ServeRequest body result");
  if (!__velarServeIsSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > __velarServeMaxBodyBytes || typeof value.tooLarge !== "boolean"
    || value.tooLarge && value.text !== null || !value.tooLarge && typeof value.text !== "string") {
    throw new __velarServeTypeError("Node host returned an invalid request body");
  }
  if (value.tooLarge || value.bytes > maximum) throw new RequestBodyTooLargeError(maximum);
  return value.text;
}

function __velarServeBodyBytesResult(value, maximum) {
  value = __velarServeRecord(value, __velarServeBodyBytesFields, "ServeRequest byte body result");
  if (!__velarServeIsSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > __velarServeMaxBodyBytes || typeof value.tooLarge !== "boolean"
    || value.tooLarge && value.data !== null || !value.tooLarge && !__velarServeBytesType.is(value.data)) {
    throw new __velarServeTypeError("Node host returned an invalid request byte body");
  }
  if (value.tooLarge || value.bytes > maximum) throw new RequestBodyTooLargeError(maximum);
  return value.data;
}

function __velarServeRequest(value) {
  value = __velarServeRecord(value, __velarServeRequestFields, "Node serve request event");
  if (!__velarServeIsSafeInteger(value.token) || value.token < 1 || !__velarServeIsSafeInteger(value.request) || value.request < 1
    || typeof value.method !== "string" || value.method.length === 0 || value.method.length > 32
    || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [value.method])
    || typeof value.path !== "string" || !__velarServeCall(__velarServeStringStartsWith, value.path, ["/"]) || value.path.length > __velarServeMaxPathCodeUnits) {
    throw new __velarServeTypeError("Node host returned an invalid serve request");
  }
  const handle = value.request;
  const cancellation = __velarServeCancellation.__velarCreate();
  __velarServeCall(__velarServeMapSet, __velarServeHostCancellations, [handle, {token: value.token, cancellation}]);
  const query = __velarServePairsMaps(value.query, "ServeRequest.query");
  let bytesPromise = null;
  const bytes = async (maxBytes = __velarServeMaxBodyBytes) => {
    if (!__velarServeIsSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > __velarServeMaxBodyBytes) {
      throw new __velarServeRangeError("Request body maxBytes must be an integer from 1 through 16777216");
    }
    if (bytesPromise === null) bytesPromise = __velarNodeHostInvoke("serve.bodyBytes", [handle, maxBytes]);
    return __velarServeBodyBytesResult(await bytesPromise, maxBytes);
  };
  const body = async (maxBytes = __velarServeMaxBodyBytes) => {
    const data = await bytes(maxBytes);
    try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [data]); }
    catch { throw new __velarServeTypeError("Request body must be valid UTF-8 text"); }
  };
  const json = async (maxBytes = __velarServeMaxBodyBytes) => __velarJsonParse(await body(maxBytes), "ServeRequest JSON text");
  return {token: value.token, handle, request: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    method: value.method,
    path: value.path,
    query: query.values,
    queryAll: query.all,
    headers: __velarServePairsMap(value.headers, "ServeRequest.headers"),
    cancellation,
    text: body,
    bytes,
    json,
    parse: async (Type, maxBytes = __velarServeMaxBodyBytes) => {
      Type = __velarRequireRuntimeType(Type, "ServeRequest.parse");
      return Type.parse(await json(maxBytes));
    },
  }])};
}

// The budget error can also surface after a response has started, where the host
// refuses a second terminal response; that attempt fails and the request falls
// through to the opaque failure exactly as any other late error does.
async function __velarServeShedOutbound(handle) {
  try {
    await __velarNodeHostInvoke("serve.respond", [handle, 503, [["retry-after", "1"]], "json", '{"error":"outbound_budget_exhausted"}', null, null, []]);
    return true;
  } catch { return false; }
}

async function __velarServeWriteResponse(handle, value) {
  let cleanup = null;
  let backgroundTasks = null;
  const managed = value && typeof value === "object" ? __velarServeOwnDescriptor(value, __velarServeManagedResponseMarker) : null;
  if (managed?.enumerable === true && "value" in managed && managed.value === true) {
    cleanup = value.cleanup;
    value = value.response;
  }
  try {
    if (__velarServeIsFileResponse(value)) {
      const headers = __velarServeResponseHeaders(value.headers);
      await __velarServeWithOutbound(__velarServeHeaderPairBytes(headers), () => __velarNodeHostInvoke("serve.respondFile", [handle, value.root, value.path, value.fallback, headers, []]));
      return null;
    }
    const response = __velarServeResponse(value);
    backgroundTasks = response.background ?? null;
    const headers = __velarServeResponseHeaders(response.headers);
    const cookies = __velarServeCookies(response);
    let metadataBytes = __velarServeHeaderPairBytes(headers);
    for (let index = 0; index < cookies.length; index += 1) metadataBytes += __velarUtf8ByteLength(cookies[index]);
    if (__velarServeOwnDescriptor(response, "json")) {
      const body = __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [response]);
      if (__velarUtf8ByteLength(body) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.json cannot exceed 16 MiB");
      await __velarServeWithOutbound(metadataBytes + __velarUtf8ByteLength(body), () => __velarNodeHostInvoke("serve.respond", [handle, response.status, headers, "json", body, response.contentType ?? null, response.compression ?? null, cookies]));
      return null;
    }
    if (__velarServeOwnDescriptor(response, "text")) {
      await __velarServeWithOutbound(metadataBytes + __velarUtf8ByteLength(response.text), () => __velarNodeHostInvoke("serve.respond", [handle, response.status, headers, "text", response.text, response.contentType ?? null, response.compression ?? null, cookies]));
      return null;
    }
    await __velarServeWithOutbound(metadataBytes, () => __velarNodeHostInvoke("serve.streamStart", [handle, response.status, headers, cookies]));
    let writing = false;
    const write = async chunk => {
      if (writing) throw new __velarServeError("ServeResponse allows only one active stream write");
      writing = true;
      try {
      if (typeof chunk !== "string") throw new __velarServeTypeError("ServeResponse.stream chunks must be strings");
      if (__velarUtf8ByteLength(chunk) > 1024 * 1024) throw new __velarServeRangeError("ServeResponse.stream chunks cannot exceed 1 MiB");
      await __velarServeWithOutbound(__velarUtf8ByteLength(chunk), () => __velarNodeHostInvoke("serve.streamWrite", [handle, chunk]));
      return null;
      } finally { writing = false; }
    };
    const result = await response.stream(write);
    if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null");
    if (writing) throw new __velarServeError("ServeResponse stream producer returned before its write completed");
    await __velarNodeHostInvoke("serve.streamEnd", [handle]);
    return null;
  } finally {
    await __velarServeRunBackground(backgroundTasks);
    if (typeof cleanup === "function") {
      try { await cleanup(); }
      catch (error) { __velarServeReportFailure(error); }
    }
  }
}

function __velarServeNativeHeaders(request) {
  const output = new __velarServeMap();
  let units = 0;
  for (const [name, value] of __velarServeObject.entries(request.headers)) {
    if (value === undefined) continue;
    const text = __velarServeIsArray(value) ? value.join(", ") : __velarServeString(value);
    units += name.length + text.length;
    if (units > 64 * 1024) throw new __velarServeRangeError("ServeRequest headers cannot exceed 64 KiB");
    output.set(name, text);
  }
  return output;
}

function __velarServeNativeRequest(request, maximum = __velarServeMaxBodyBytes) {
  maximum = __velarServeBodyLimit(maximum);
  const method = request.method ?? "GET";
  if (typeof method !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [method])) throw new __velarServeTypeError("Native HTTP method is invalid");
  const target = request.url ?? "/";
  if (typeof target !== "string" || target.length === 0 || __velarUtf8ByteLength(target) > 64 * 1024) throw new __velarServeRangeError("Native HTTP request target is too long");
  const targetParts = __velarServeTargetParts(target, "Native HTTP request target");
  const path = targetParts.path;
  const query = __velarServePairsMaps(targetParts.query, "Native ServeRequest.query");
  const cancellation = __velarServeCancellation.__velarCreate();
  let bodyPromise = null;
  let reservedBodyBytes = 0;
  const rawBody = async () => {
    if (bodyPromise === null) bodyPromise = (async () => {
      const chunks = []; let total = 0;
      try {
        for await (const chunk of request) {
          const data = chunk instanceof __velarServeUint8Array ? chunk : __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [__velarServeString(chunk)]);
          if (total + data.byteLength > maximum) { request.resume(); throw new RequestBodyTooLargeError(maximum); }
          __velarServeReserveOutbound(data.byteLength);
          total += data.byteLength;
          reservedBodyBytes += data.byteLength;
          chunks[chunks.length] = data;
        }
        __velarServeReserveOutbound(total);
        try {
          const output = new __velarServeUint8Array(total);
          let offset = 0;
          for (let index = 0; index < chunks.length; index += 1) { __velarServeCall(__velarServeUint8Set, output, [chunks[index], offset]); offset += chunks[index].byteLength; }
          chunks.length = 0;
          return output;
        }
        finally { __velarServeReleaseOutbound(total); }
      } catch (error) {
        __velarServeReleaseOutbound(reservedBodyBytes);
        reservedBodyBytes = 0;
        throw error;
      }
    })();
    return await bodyPromise;
  };
  const bytes = async (maxBytes = maximum) => {
    if (!__velarServeIsSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > __velarServeMaxBodyBytes) throw new __velarServeRangeError("Request body maxBytes must be an integer from 1 through 16777216");
    const data = await rawBody();
    const effective = maxBytes > maximum ? maximum : maxBytes;
    if (data.byteLength > effective) throw new RequestBodyTooLargeError(effective);
    return data;
  };
  const body = async (maxBytes = maximum) => {
    const data = await bytes(maxBytes);
    try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [data]); }
    catch { throw new __velarServeTypeError("Request body must be valid UTF-8 text"); }
  };
  const json = async (maxBytes = maximum) => __velarJsonParse(await body(maxBytes), "ServeRequest JSON text");
  return {
    request: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{method, path, query: query.values, queryAll: query.all, headers: __velarServeNativeHeaders(request), cancellation, text: body, bytes, json, parse: async (Type, maxBytes = maximum) => { Type = __velarRequireRuntimeType(Type, "ServeRequest.parse"); return Type.parse(await json(maxBytes)); }}]),
    cancellation,
    cleanup() { if (reservedBodyBytes > 0) { __velarServeReleaseOutbound(reservedBodyBytes); reservedBodyBytes = 0; } return null; },
  };
}

function __velarServeNativeSetHeaders(response, headers, cookies = []) {
  const allCookies = [];
  for (const [name, value] of headers) {
    if (__velarServeCall(__velarServeStringToLowerCase, name, []) === "set-cookie") allCookies[allCookies.length] = value;
    else response.setHeader(name, value);
  }
  for (let index = 0; index < cookies.length; index += 1) allCookies[allCookies.length] = cookies[index];
  if (allCookies.length > 0) response.setHeader("Set-Cookie", allCookies);
}
// Every error branch of __velarServeHandleNative answers with a body of its own,
// so it has to start from an empty header set: a content-length staged for the
// response that failed makes the client wait for bytes that will never arrive,
// and a Set-Cookie staged by a handler whose request was never served hands out
// a session for nothing. The isolated-host transport gets this for free — it
// sheds before the host ever sets a header — so this is the native transport
// reaching the same state.
function __velarServeNativeResetHeaders(response) {
  const names = response.getHeaderNames();
  for (let index = 0; index < names.length; index += 1) response.removeHeader(names[index]);
}
class __velarServeNativeNotFound extends __velarServeError {}
function __velarServeNativeMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
// A relative path carries .. only as a whole segment, so a bare two-dot prefix
// test also refuses an ordinary top-level file whose own name begins with two
// dots — the same over-strict form the host worker's containment check carried.
// The operations bag has no separator to consult and may come from a bridge
// embedding, so both separators are refused: fail closed on Windows rather than
// trust a default.
function __velarServeNativeEscapes(path, operations) {
  return path === ".." || path.startsWith("../") || path.startsWith("..\\") || operations.isAbsolute(path);
}
async function __velarServeNativeFile(value, operations) {
  let root;
  // A static root that does not exist is the same miss as a file that does not
  // exist: reporting it as a failure would answer 500 and write the absolute
  // deployment path to stderr, which the host transport never does.
  try { root = await operations.realpath(operations.resolve(value.root)); }
  catch (error) { if (__velarServeNativeMissing(error)) throw new __velarServeNativeNotFound("fileResponse root does not name a directory"); throw error; }
  const load = async path => {
    let target;
    try { target = await operations.realpath(operations.resolve(root, path.startsWith("/") ? "." + path : path)); }
    catch (error) { if (__velarServeNativeMissing(error)) throw new __velarServeNativeNotFound("fileResponse path does not name a file"); throw error; }
    const relative = operations.relative(root, target);
    if (__velarServeNativeEscapes(relative, operations)) throw new __velarServeNativeNotFound("fileResponse path escapes its root");
    let info;
    try { info = await operations.stat(target); }
    catch (error) { if (__velarServeNativeMissing(error)) throw new __velarServeNativeNotFound("fileResponse path does not name a file"); throw error; }
    if (!info.isFile()) throw new __velarServeNativeNotFound("fileResponse path does not name a file");
    if (info.size > 64 * 1024 * 1024) throw new __velarServeRangeError("fileResponse file exceeds 64 MiB");
    return {target, info};
  };
  try { return await load(value.path); } catch (error) { if (value.fallback === null) throw error; return load(value.fallback); }
}
function __velarServeNativeContentType(path, operations) {
  if (typeof operations.extname !== "function") return "application/octet-stream";
  const extension = operations.extname(path).toLowerCase();
  return ({".css":"text/css; charset=utf-8",".gif":"image/gif",".html":"text/html; charset=utf-8",".ico":"image/x-icon",".jpeg":"image/jpeg",".jpg":"image/jpeg",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".map":"application/json; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".txt":"text/plain; charset=utf-8",".wasm":"application/wasm",".webp":"image/webp",".woff":"font/woff",".woff2":"font/woff2"})[extension] ?? "application/octet-stream";
}
async function __velarServeNativeSendFile(request, response, value, operations) {
  const file = await __velarServeNativeFile(value, operations);
  const modified = __velarServeCall(__velarServeMathFloor, __velarServeMath, [file.info.mtimeMs]);
  const etag = 'W/"' + __velarServeCall(__velarServeNumberToString, file.info.size, [16]) + "-" + __velarServeCall(__velarServeNumberToString, modified, [16]) + '"';
  response.setHeader("content-type", __velarServeNativeContentType(file.target, operations));
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("etag", etag);
  response.setHeader("last-modified", file.info.mtime.toUTCString());
  const noneMatch = request.headers["if-none-match"];
  const modifiedSince = request.headers["if-modified-since"];
  if (typeof noneMatch === "string" && noneMatch.split(",").some(item => item.trim() === "*" || item.trim() === etag)
    || typeof noneMatch !== "string" && typeof modifiedSince === "string" && __velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [__velarServeCall(__velarServeDateParse, __velarServeDate, [modifiedSince])])
      && __velarServeCall(__velarServeMathFloor, __velarServeMath, [file.info.mtimeMs / 1000]) * 1000 <= __velarServeCall(__velarServeDateParse, __velarServeDate, [modifiedSince])) {
    response.statusCode = 304;
    return __velarServeNativeEnd(response);
  }
  let start = 0;
  let end = file.info.size - 1;
  let range = request.headers.range;
  const ifRange = request.headers["if-range"];
  if (typeof range === "string" && typeof ifRange === "string" && ifRange !== etag) {
    const time = __velarServeCall(__velarServeDateParse, __velarServeDate, [ifRange]);
    if (!__velarServeCall(__velarServeNumberIsFinite, __velarServeNumber, [time]) || __velarServeCall(__velarServeMathFloor, __velarServeMath, [file.info.mtimeMs / 1000]) * 1000 > time) range = undefined;
  }
  if (typeof range === "string") {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(range.trim());
    if (!match || match[1] === "" && match[2] === "" || file.info.size === 0) {
      response.statusCode = 416; response.setHeader("content-range", "bytes */" + file.info.size); return __velarServeNativeEnd(response, request.method === "HEAD" ? undefined : "Range not satisfiable");
    }
    if (match[1] === "") { const suffix = __velarServeCall(__velarServeNumber, undefined, [match[2]]); if (!__velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [suffix]) || suffix < 1) { response.statusCode = 416; response.setHeader("content-range", "bytes */" + file.info.size); return __velarServeNativeEnd(response); } start = __velarServeCall(__velarServeMathMax, __velarServeMath, [0, file.info.size - suffix]); }
    else { start = __velarServeCall(__velarServeNumber, undefined, [match[1]]); end = match[2] === "" ? end : __velarServeCall(__velarServeNumber, undefined, [match[2]]); }
    if (!__velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [start]) || !__velarServeCall(__velarServeNumberIsSafeInteger, __velarServeNumber, [end]) || start < 0 || start >= file.info.size || end < start) { response.statusCode = 416; response.setHeader("content-range", "bytes */" + file.info.size); return __velarServeNativeEnd(response); }
    if (end >= file.info.size) end = file.info.size - 1;
    response.statusCode = 206;
    response.setHeader("content-range", "bytes " + start + "-" + end + "/" + file.info.size);
  } else response.statusCode = 200;
  response.setHeader("content-length", __velarServeCall(__velarServeMathMax, __velarServeMath, [0, end - start + 1]));
  if (request.method === "HEAD") return __velarServeNativeEnd(response);
  if (typeof operations.createReadStream !== "function") {
    const data = await operations.readFile(file.target);
    if (!(data instanceof __velarServeUint8Array) || data.byteLength > 64 * 1024 * 1024) throw new __velarServeRangeError("fileResponse file exceeds 64 MiB");
    return __velarServeWithOutbound(end - start + 1, () => __velarServeNativeEnd(response, data.subarray(start, end + 1)));
  }
  const source = operations.createReadStream(file.target, {start, end, highWaterMark: 64 * 1024});
  try { for await (const chunk of source) await __velarServeWithOutbound(chunk.byteLength, () => __velarServeNativeWrite(response, chunk)); }
  finally { source.destroy(); }
  return __velarServeNativeEnd(response);
}
async function __velarServeNativeEnd(response, value) { await new __velarServePromise((resolve, reject) => { response.once("error", reject); response.end(value, () => { response.off("error", reject); resolve(null); }); }); }
async function __velarServeNativeWrite(response, value) { if (response.write(value)) return; await new __velarServePromise((resolve, reject) => { const failed = error => { response.off("drain", ready); reject(error); }; const ready = () => { response.off("error", failed); resolve(null); }; response.once("error", failed); response.once("drain", ready); }); }
async function __velarServeNativeBody(response, value, checked, suppressBody, operations) {
  if (suppressBody) return __velarServeNativeEnd(response);
  const bytes = typeof value === "string" ? __velarUtf8ByteLength(value) : value.byteLength;
  if (checked.compression == null || typeof operations.compress !== "function") return __velarServeWithOutbound(bytes, () => __velarServeNativeEnd(response, value));
  const compressed = await __velarServeWithOutbound(bytes * 2, () => operations.compress(checked.compression, value));
  if (!(compressed instanceof __velarServeUint8Array) || compressed.byteLength > __velarServeMaxBodyBytes) throw new __velarServeRangeError("Compressed ServeResponse exceeds 16 MiB");
  response.setHeader("content-encoding", checked.compression);
  if (!response.hasHeader("vary")) response.setHeader("vary", "Accept-Encoding");
  return __velarServeWithOutbound(compressed.byteLength, () => __velarServeNativeEnd(response, compressed));
}
async function __velarServeHandleNative(handler, request, response, operations, maxBodyBytes = __velarServeMaxBodyBytes) {
  let cleanup = null;
  let backgroundTasks = null;
  let incoming = null;
  let disconnected = null;
  try {
    incoming = __velarServeNativeRequest(request, maxBodyBytes);
    disconnected = () => { if (!response.writableFinished) __velarServeCancellation.__velarCancel(incoming.cancellation, "client_disconnect"); };
    request.once("aborted", disconnected);
    response.once("close", disconnected);
    let value = await handler(incoming.request);
    const managed = value && typeof value === "object" ? __velarServeOwnDescriptor(value, __velarServeManagedResponseMarker) : null;
    if (managed?.enumerable === true && "value" in managed && managed.value === true) { cleanup = value.cleanup; value = value.response; }
    if (__velarServeIsFileResponse(value)) { __velarServeNativeSetHeaders(response, __velarServeResponseHeaders(value.headers)); await __velarServeNativeSendFile(request, response, value, operations); return null; }
    const checked = __velarServeResponse(value); backgroundTasks = checked.background ?? null; response.statusCode = checked.status; __velarServeNativeSetHeaders(response, __velarServeResponseHeaders(checked.headers), __velarServeCookies(checked));
    const suppressBody = request.method === "HEAD" || checked.status >= 100 && checked.status < 200 || checked.status === 204 || checked.status === 304;
    if (__velarServeOwnDescriptor(checked, "json")) { if (request.method === "HEAD" || !suppressBody) response.setHeader("content-type", checked.contentType ?? "application/json; charset=utf-8"); await __velarServeNativeBody(response, __velarServeCall(__velarServeWeakMapGet, __velarServeSerializedJson, [checked]), checked, suppressBody, operations); return null; }
    if (__velarServeOwnDescriptor(checked, "text")) { if (request.method === "HEAD" || !suppressBody) response.setHeader("content-type", checked.contentType ?? "text/plain; charset=utf-8"); await __velarServeNativeBody(response, checked.text, checked, suppressBody, operations); return null; }
    let writing = false;
    const write = async chunk => { if (writing) throw new __velarServeError("ServeResponse allows only one active stream write"); writing = true; try { if (typeof chunk !== "string" || __velarUtf8ByteLength(chunk) > 1024 * 1024) throw new __velarServeTypeError("ServeResponse.stream chunks must be text of at most 1 MiB"); if (!suppressBody) await __velarServeWithOutbound(__velarUtf8ByteLength(chunk), () => __velarServeNativeWrite(response, chunk)); return null; } finally { writing = false; } };
    const result = await checked.stream(write); if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null"); if (writing) throw new __velarServeError("ServeResponse stream producer returned before its write completed"); await __velarServeNativeEnd(response); return null;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError && !response.headersSent) {
      __velarServeNativeResetHeaders(response);
      response.statusCode = 413;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : '{"error":"request_too_large"}');
      return null;
    }
    if (error instanceof __velarServeNativeNotFound && !response.headersSent) {
      __velarServeNativeResetHeaders(response);
      response.statusCode = 404;
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : "Not found");
      return null;
    }
    if (error instanceof __velarServeOutboundBudgetError && !response.headersSent) {
      __velarServeNativeResetHeaders(response);
      response.statusCode = 503;
      response.setHeader("retry-after", "1");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : '{"error":"outbound_budget_exhausted"}');
      return null;
    }
    __velarServeReportFailure(error);
    if (!response.headersSent) { __velarServeNativeResetHeaders(response); response.statusCode = 500; response.setHeader("content-type", "text/plain; charset=utf-8"); response.end("Internal server error"); }
    else response.destroy();
    return null;
  }
  finally {
    if (disconnected !== null) { request.off("aborted", disconnected); response.off("close", disconnected); }
    await __velarServeRunBackground(backgroundTasks);
    if (typeof cleanup === "function") { try { await cleanup(); } catch (error) { __velarServeReportFailure(error); } }
    if (incoming !== null) incoming.cleanup();
  }
}

function __velarServeTestOverrides(value) {
  if (value == null) return new __velarServeMap();
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
  catch { throw new __velarServeTypeError("server-test overrides must be a Map<Provider, value>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > 128) throw new __velarServeRangeError("server-test overrides cannot contain more than 128 providers");
  const output = new __velarServeMap();
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2 || !__velarServeIsProvider(step.value[0])) throw new __velarServeTypeError("server-test override keys must be Providers");
    __velarServeCall(__velarServeMapSet, output, [step.value[0], step.value[1]]);
  }
  return output;
}

function __velarServeTestHeaders(value) {
  if (value == null) return new __velarServeMap();
  const pairs = __velarServeMapSnapshot(value, "server-test headers");
  const output = new __velarServeMap();
  for (let index = 0; index < pairs.length; index += 1) __velarServeCall(__velarServeMapSet, output, [__velarServeCall(__velarServeStringToLowerCase, pairs[index][0], []), pairs[index][1]]);
  return output;
}

function __velarServeTestUploadEntries(value) {
  if (value == null) return [];
  let size;
  let iterator;
  try { size = __velarServeCall(__velarServeMapSize, value, []); iterator = __velarServeCall(__velarServeMapEntries, value, []); }
  catch { throw new __velarServeTypeError("server-test files must be a Map<string, upload>"); }
  if (!__velarServeIsSafeInteger(size) || size < 0 || size > 128) throw new __velarServeRangeError("server-test files cannot contain more than 128 uploads");
  const output = [];
  while (true) {
    const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []);
    if (step.done) break;
    if (!__velarServeIsArray(step.value) || step.value.length !== 2) throw new __velarServeTypeError("server-test files must be a Map<string, upload>");
    const field = step.value[0];
    const file = __velarServeRecord(step.value[1], __velarServeTestUploadFields, "server-test upload");
    if (typeof field !== "string" || field.length === 0 || field.length > 256 || /[\0\r\n"]/u.test(field)
      || typeof file.filename !== "string" || file.filename.length === 0 || file.filename.length > 1024 || /[\0\r\n"]/u.test(file.filename)
      || file.contentType !== undefined && (typeof file.contentType !== "string" || file.contentType.length === 0 || file.contentType.length > 1024 || /[\0\r\n]/u.test(file.contentType))) {
      throw new __velarServeTypeError("server-test upload names and content types must be bounded HTTP text");
    }
    const data = typeof file.data === "string"
      ? __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [file.data])
      : __velarServeBytesType.parse(file.data);
    output[output.length] = {field, filename: file.filename, contentType: file.contentType ?? "application/octet-stream", data};
  }
  if (output.length !== size) throw new __velarServeTypeError("server-test files changed while they were being read");
  return output;
}

function __velarServeBytesContain(source, pattern) {
  if (pattern.byteLength === 0 || pattern.byteLength > source.byteLength) return false;
  for (let offset = 0; offset <= source.byteLength - pattern.byteLength; offset += 1) {
    let equal = true;
    for (let index = 0; index < pattern.byteLength; index += 1) if (source[offset + index] !== pattern[index]) { equal = false; break; }
    if (equal) return true;
  }
  return false;
}

function __velarServeTestMultipart(form, files) {
  const fields = form == null ? [] : __velarServeMapSnapshot(form, "server-test form", 256);
  for (let index = 0; index < fields.length; index += 1) if (fields[index][0].length === 0 || /[\0\r\n"]/u.test(fields[index][0])) throw new __velarServeTypeError("server-test form field names must be bounded HTTP text");
  const uploads = __velarServeTestUploadEntries(files);
  const values = [];
  for (let index = 0; index < fields.length; index += 1) values[values.length] = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [fields[index][1]]);
  for (let index = 0; index < uploads.length; index += 1) values[values.length] = uploads[index].data;
  let boundary = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    if (!__velarServeIsSafeInteger(__velarServeNextTestBoundary)) __velarServeNextTestBoundary = 1;
    const candidate = "velar-test-" + __velarServeCall(__velarServeDateNow, __velarServeDate, []) + "-" + __velarServeNextTestBoundary++;
    const encoded = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [candidate]);
    let collision = false;
    for (let index = 0; index < values.length; index += 1) if (__velarServeBytesContain(values[index], encoded)) { collision = true; break; }
    if (!collision) { boundary = candidate; break; }
  }
  if (boundary === null) throw new __velarServeRangeError("server-test could not choose a collision-free multipart boundary");
  const parts = [];
  let total = 0;
  const appendText = text => { const data = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [text]); total += data.byteLength; parts[parts.length] = data; };
  const appendData = data => { total += data.byteLength; parts[parts.length] = data; };
  for (let index = 0; index < fields.length; index += 1) {
    appendText("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + fields[index][0] + "\"\r\n\r\n");
    appendData(values[index]);
    appendText("\r\n");
  }
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    appendText("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + upload.field + "\"; filename=\"" + upload.filename + "\"\r\nContent-Type: " + upload.contentType + "\r\n\r\n");
    appendData(upload.data);
    appendText("\r\n");
  }
  appendText("--" + boundary + "--\r\n");
  if (total > __velarServeMaxBodyBytes) throw new __velarServeRangeError("server-test multipart body exceeds 16 MiB");
  const data = new __velarServeUint8Array(total);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) { __velarServeCall(__velarServeUint8Set, data, [parts[index], offset]); offset += parts[index].byteLength; }
  return {data, contentType: "multipart/form-data; boundary=" + boundary};
}

function __velarServeTestRequest(method, target, options, cookies) {
  if (typeof method !== "string" || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [method])) throw new __velarServeTypeError("server-test method is invalid");
  if (typeof target !== "string" || target.length === 0 || __velarUtf8ByteLength(target) > 64 * 1024 || !__velarServeCall(__velarServeStringStartsWith, target, ["/"])) throw new __velarServeTypeError("server-test target must be a bounded absolute URL path");
  options = options == null ? {} : __velarServePlainRecord(options, "server-test request options");
  const keys = __velarServeCall(__velarServeOwnKeys, __velarServeReflect, [options]);
  for (let index = 0; index < keys.length; index += 1) if (!__velarServeCall(__velarServeArrayIncludes, ["headers", "json", "text", "form", "files"], [keys[index]])) throw new __velarServeTypeError("server-test request options have an unknown field");
  const structuredBody = __velarServeOwnDescriptor(options, "form") || __velarServeOwnDescriptor(options, "files");
  if ((__velarServeOwnDescriptor(options, "json") ? 1 : 0) + (__velarServeOwnDescriptor(options, "text") ? 1 : 0) + (structuredBody ? 1 : 0) > 1) throw new __velarServeTypeError("server-test request accepts one body source: json, text, or form/files");
  const targetParts = __velarServeTargetParts(target, "server-test target");
  const path = targetParts.path;
  const query = __velarServePairsMaps(targetParts.query, "server-test query");
  const headers = __velarServeTestHeaders(options.headers);
  if (!__velarServeCall(__velarServeMapHas, headers, ["cookie"]) && __velarServeCall(__velarServeMapSize, cookies, []) > 0) {
    const values = [];
    const iterator = __velarServeCall(__velarServeMapEntries, cookies, []);
    while (true) { const step = __velarServeCall(__velarServeMapIteratorNext, iterator, []); if (step.done) break; values[values.length] = step.value[0] + "=" + step.value[1]; }
    __velarServeCall(__velarServeMapSet, headers, ["cookie", __velarServeCall(__velarServeArrayJoin, values, ["; "])]);
  }
  let bodyText = "";
  let bodyData = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [bodyText]);
  if (__velarServeOwnDescriptor(options, "json")) {
    bodyText = __velarJsonStringify(options.json);
    if (!__velarServeCall(__velarServeMapHas, headers, ["content-type"])) __velarServeCall(__velarServeMapSet, headers, ["content-type", "application/json"]);
  } else if (__velarServeOwnDescriptor(options, "text")) {
    if (typeof options.text !== "string") throw new __velarServeTypeError("server-test text body must be string");
    bodyText = options.text;
  } else if (structuredBody) {
    const multipart = __velarServeTestMultipart(options.form, options.files);
    bodyData = multipart.data;
    __velarServeCall(__velarServeMapSet, headers, ["content-type", multipart.contentType]);
  }
  if (__velarUtf8ByteLength(bodyText) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("server-test request body exceeds 16 MiB");
  if (!structuredBody) bodyData = __velarServeCall(__velarServeTextEncode, __velarServeUtf8Encoder, [bodyText]);
  const bytes = async maxBytes => {
    const maximum = maxBytes ?? __velarServeMaxBodyBytes;
    if (!__velarServeIsSafeInteger(maximum) || maximum < 1 || maximum > __velarServeMaxBodyBytes || bodyData.byteLength > maximum) throw new RequestBodyTooLargeError(maximum);
    return bodyData;
  };
  const textBody = async maxBytes => { const data = await bytes(maxBytes); if (!structuredBody) return bodyText; try { return __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [data]); } catch { throw new __velarServeTypeError("server-test request body is not UTF-8 text"); } };
  const jsonBody = async maxBytes => __velarJsonParse(await textBody(maxBytes), "server-test JSON text");
  const cancellation = __velarServeCancellation.__velarCreate();
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    method, path, query: query.values, queryAll: query.all, headers, cancellation, text: textBody, bytes, json: jsonBody,
    parse: async (Type, maxBytes = __velarServeMaxBodyBytes) => { Type = __velarRequireRuntimeType(Type, "server-test request parse"); return Type.parse(await jsonBody(maxBytes)); },
  }]);
}

async function __velarServeTestResponse(value, cookies) {
  let cleanup = null;
  const managed = value && typeof value === "object" ? __velarServeOwnDescriptor(value, __velarServeManagedResponseMarker) : null;
  if (managed?.enumerable === true && "value" in managed && managed.value === true) { cleanup = value.cleanup; value = value.response; }
  let backgroundTasks = null;
  try {
    if (__velarServeIsFileResponse(value)) {
      const loaded = __velarServeRecord(await __velarNodeHostInvoke("serve.readFile", [value.root, value.path, value.fallback]), __velarServeTestFileFields, "server-test file result");
      if (!__velarServeBytesType.is(loaded.data) || loaded.data.byteLength > __velarServeMaxBodyBytes || typeof loaded.contentType !== "string" || loaded.contentType.length === 0 || loaded.contentType.length > 1024 || /[\0\r\n]/u.test(loaded.contentType)) {
        throw new __velarServeTypeError("Node host returned an invalid server-test file result");
      }
      const headers = __velarServeHeaders(value.headers, "content-type", loaded.contentType);
      let textValue = null;
      const readText = async () => {
        if (textValue === null) {
          try { textValue = __velarServeCall(__velarServeTextDecode, __velarServeUtf8Decoder, [loaded.data]); }
          catch { throw new __velarServeTypeError("server-test file response is not UTF-8 text"); }
        }
        return textValue;
      };
      return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{status: 200, headers, text: readText, json: async () => __velarJsonParse(await readText(), "server-test file response JSON")}]);
    }
    const response = __velarServeResponse(value);
    backgroundTasks = response.background ?? null;
    const headers = __velarServeHeaders(response.headers);
    const checkedCookies = __velarServeCookies(response);
    const responseCookies = [];
    for (let index = 0; index < checkedCookies.length; index += 1) responseCookies[index] = checkedCookies[index];
    if (__velarServeCall(__velarServeMapHas, headers, ["set-cookie"])) responseCookies[responseCookies.length] = __velarServeCall(__velarServeMapGet, headers, ["set-cookie"]);
    for (let cookieIndex = 0; cookieIndex < responseCookies.length; cookieIndex += 1) {
      const cookie = responseCookies[cookieIndex];
      const first = __velarServeCall(__velarServeStringSplit, cookie, [";"])[0];
      const separator = __velarServeCall(__velarServeStringIndexOf, first, ["="]);
      if (separator > 0) {
        const name = __velarServeCall(__velarServeStringSlice, first, [0, separator]);
        const content = __velarServeCall(__velarServeStringSlice, first, [separator + 1]);
        if (__velarServeCall(__velarServeStringIncludes, __velarServeCall(__velarServeStringToLowerCase, cookie, []), ["max-age=0"])) __velarServeCall(__velarServeMapDelete, cookies, [name]);
        else __velarServeCall(__velarServeMapSet, cookies, [name, content]);
      }
    }
    let jsonValue = __velarServeMissing;
    let textValue = "";
    if (__velarServeOwnDescriptor(response, "json")) { jsonValue = response.json; textValue = __velarJsonStringify(response.json); }
    else if (__velarServeOwnDescriptor(response, "text")) textValue = response.text;
    else {
      const chunks = [];
      let size = 0;
      const result = await response.stream(async chunk => { if (typeof chunk !== "string") throw new __velarServeTypeError("server-test stream chunks must be strings"); size += __velarUtf8ByteLength(chunk); if (size > __velarServeMaxBodyBytes) throw new __velarServeRangeError("server-test response exceeds 16 MiB"); chunks[chunks.length] = chunk; return null; });
      if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null");
      textValue = __velarServeCall(__velarServeArrayJoin, chunks, [""]);
    }
    return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
      status: response.status,
      headers,
      text: async () => textValue,
      json: async () => jsonValue === __velarServeMissing ? __velarJsonParse(textValue, "server-test response JSON") : jsonValue,
    }]);
  } finally {
    try {
      await __velarServeRunBackground(backgroundTasks);
    } finally {
      if (typeof cleanup === "function") await cleanup();
    }
  }
}

async function __velarServeTestClient(app, overrides = null) {
  if (!__velarServeIsApp(app)) throw new __velarServeTypeError("server-test client requires a ServeApp");
  const appState = __velarServeAppState(__velarServeTestOverrides(overrides));
  const cookies = new __velarServeMap();
  let closing = null;
  let closed = null;
  try { await __velarServeRunStartup(app, appState); await __velarServeInitializeEagerProviders(app, __velarServeMaxBodyBytes, appState); }
  catch (error) { try { await __velarServeCleanupAppState(appState); } catch {} try { await __velarServeRunShutdown(app, appState); } catch {} throw error; }
  const request = async (method, target, options = null) => {
    if (closed !== null || closing !== null) throw new __velarServeError("server-test client is closed");
    const incoming = __velarServeTestRequest(method, target, options, cookies);
    return await __velarServeTestResponse(await __velarServeHandleApp(app, incoming, __velarServeMaxBodyBytes, appState), cookies);
  };
  const close = async (grace = __velarServeDefaultShutdownGrace) => {
    if (closed !== null) return closed;
    if (closing !== null) return closing;
    const pending = (async () => {
      try { await __velarServeDrainAppState(appState, grace); }
      catch (error) {
        closed = __velarServeFinishAppAfterDrain(app, appState);
        __velarServeCall(__velarServePromiseThen, closed, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      closed = __velarServeFinishApp(app, appState);
      return await closed;
    })();
    closing = pending;
    try { return await pending; }
    finally { if (closing === pending) closing = null; }
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    request,
    get: (target, options = null) => request("GET", target, options),
    post: (target, options = null) => request("POST", target, options),
    put: (target, options = null) => request("PUT", target, options),
    patch: (target, options = null) => request("PATCH", target, options),
    delete: (target, options = null) => request("DELETE", target, options),
    close,
  }]);
}

async function __velarServeDispatch(event) {
  let value;
  try { value = __velarServeRequest(event); }
  catch (error) {
    __velarServeReportFailure(error);
    const request = event && typeof event === "object" ? __velarServeOwnDescriptor(event, "request") : null;
    if (request && "value" in request && __velarServeIsSafeInteger(request.value) && request.value > 0) {
      try { await __velarNodeHostInvoke("serve.fail", [request.value]); }
      catch {}
    }
    return;
  }
  const handler = __velarServeCall(__velarServeMapGet, __velarServeHandlers, [value.token]);
  if (typeof handler !== "function") { __velarServeReportFailure(new __velarServeError("Node host requested an unknown server token")); await __velarNodeHostInvoke("serve.fail", [value.handle]); return; }
  try { await __velarServeWriteResponse(value.handle, await handler(value.request)); }
  catch (error) {
    if (error instanceof __velarServeOutboundBudgetError && await __velarServeShedOutbound(value.handle)) return;
    __velarServeReportFailure(error);
    try { await __velarNodeHostInvoke("serve.fail", [value.handle]); }
    catch {}
  } finally { __velarServeCall(__velarServeMapDelete, __velarServeHostCancellations, [value.handle]); }
}

__velarNodeHostOn("serve.request", event => { __velarServeDispatch(event); });
__velarNodeHostOn("serve.cancel", event => {
  try {
    event = __velarServePlainRecord(event, "Node serve cancellation event");
    const token = __velarServeDataField(event, "token", "Node serve cancellation event");
    const request = __velarServeDataField(event, "request", "Node serve cancellation event");
    const reason = __velarServeDataField(event, "reason", "Node serve cancellation event");
    if (!__velarServeIsSafeInteger(token) || token < 1 || !__velarServeIsSafeInteger(request) || request < 1 || typeof reason !== "string" || reason.length > 1024) throw new __velarServeTypeError("Node serve cancellation event is invalid");
    const owned = __velarServeCall(__velarServeMapGet, __velarServeHostCancellations, [request]);
    if (owned !== undefined && owned.token === token) __velarServeCancellation.__velarCancel(owned.cancellation, reason);
  } catch (error) { __velarServeReportFailure(error); }
});
__velarNodeHostOn("serve.error", event => {
  try {
    event = __velarServePlainRecord(event, "Node serve error event");
    const message = __velarServeDataField(event, "message", "Node serve error event");
    if (typeof message !== "string" || message.length === 0 || message.length > 65536) throw new __velarServeTypeError("Node serve error event is invalid");
    __velarServeReportFailure(new __velarServeError(message));
  } catch (error) { __velarServeReportFailure(error); }
});

export async function serve(app, port, host = "127.0.0.1", maxBodyBytes = __velarServeMaxBodyBytes) {
  if (!__velarServeIsSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > __velarServeMaxBodyBytes) {
    throw new __velarServeRangeError("serve maxBodyBytes must be an integer from 1 through 16777216");
  }
  const appState = __velarServeAppState();
  if (!__velarServeIsApp(app) && typeof app !== "function") throw new __velarServeTypeError("serve requires a ServeApp or async request handler");
  const handler = __velarServeIsApp(app)
    ? request => __velarServeHandleApp(app, request, maxBodyBytes, appState)
    : request => __velarServeHandleFunction(app, request, appState);
  if (!__velarServeIsSafeInteger(port) || port < 0 || port > 65535) throw new __velarServeRangeError("serve port must be an integer from 0 through 65535");
  if (typeof host !== "string" || host.length === 0 || host.length > 255 || __velarServeCall(__velarServeStringIncludes, host, ["\0"])) {
    throw new __velarServeTypeError("serve host must be bounded text");
  }
  if (__velarServeCall(__velarServeMapSize, __velarServeHandlers, []) >= 128) throw new __velarServeRangeError("serve cannot own more than 128 servers");
  if (!__velarServeIsSafeInteger(__velarServeNextToken)) __velarServeNextToken = 1;
  let attempts = 0;
  while (__velarServeCall(__velarServeMapHas, __velarServeHandlers, [__velarServeNextToken])) {
    __velarServeNextToken += 1;
    if (!__velarServeIsSafeInteger(__velarServeNextToken)) __velarServeNextToken = 1;
    attempts += 1;
    if (attempts > 128) throw new __velarServeRangeError("serve cannot own more than 128 servers");
  }
  const token = __velarServeNextToken++;
  __velarServeCall(__velarServeMapSet, __velarServeHandlers, [token, handler]);
  if (__velarServeIsApp(app)) {
    try {
      await __velarServeRunStartup(app, appState);
      await __velarServeInitializeEagerProviders(app, maxBodyBytes, appState);
    } catch (error) {
      __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
      try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
      try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
      throw error;
    }
  }
  let started;
  try { started = __velarServeRecord(await __velarNodeHostInvoke("serve.start", [token, port, host]), __velarServeStartFields, "Node serve start result"); }
  catch (error) {
    __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
    try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    if (__velarServeIsApp(app)) try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
    throw error;
  }
  if (!__velarServeIsSafeInteger(started.handle) || started.handle < 1 || !__velarServeIsSafeInteger(started.port) || started.port < 0 || started.port > 65535) {
    __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
    try {
      if (__velarServeIsSafeInteger(started.handle) && started.handle > 0) await __velarNodeHostInvoke("serve.stop", [started.handle]);
    } catch (stopError) { __velarServeReportFailure(stopError); }
    try { await __velarServeCleanupAppState(appState); } catch (cleanupError) { __velarServeReportFailure(cleanupError); }
    if (__velarServeIsApp(app)) try { await __velarServeRunShutdown(app, appState); } catch (shutdownError) { __velarServeReportFailure(shutdownError); }
    throw new __velarServeTypeError("Node host returned an invalid server");
  }
  let stopped = null;
  const stop = async (grace = __velarServeDefaultShutdownGrace) => {
    if (!__velarServeIsSafeInteger(grace) || grace < 1 || grace > 120_000) throw new __velarServeRangeError("Server.stop grace must be 1 through 120000 milliseconds");
    if (stopped !== null) return stopped;
    let transportStopped = false;
    const pending = (async () => {
      const transport = __velarNodeHostInvoke("serve.stop", [started.handle, grace]);
      const drain = __velarServeDrainAppState(appState, grace);
      let result;
      try { result = await transport; }
      catch (error) {
        __velarServeCall(__velarServePromiseThen, drain, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      transportStopped = true;
      const protocolFailure = result === null ? null : new __velarServeTypeError("Node host returned an invalid server stop completion");
      __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
      try { await drain; }
      catch (error) {
        const finalization = __velarServeFinishAppAfterDrain(app, appState);
        stopped = finalization;
        __velarServeCall(__velarServePromiseThen, finalization, [() => null, failure => __velarServeReportFailure(failure)]);
        throw error;
      }
      const finalization = __velarServeFinishApp(app, appState);
      await finalization;
      if (protocolFailure !== null) throw protocolFailure;
      return null;
    })();
    stopped = pending;
    try { return await pending; }
    catch (error) { if (!transportStopped && stopped === pending) stopped = null; throw error; }
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{port: started.port, stop}]);
}
`.trimStart();
