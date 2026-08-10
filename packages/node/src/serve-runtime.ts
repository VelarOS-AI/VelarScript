// Application-facing velar/serve contract. HTTP sockets, request streams,
// backpressure and static-file effects live in the shared isolated Node host;
// this Realm owns only Velar values, handlers and strict JSON/type boundaries.
export const VELAR_NODE_SERVE_RUNTIME = String.raw`
import { __velarNodeHostInvoke, __velarNodeHostOn } from "velar/node-host-v1";

const __velarServeArray = globalThis.Array;
const __velarServeError = globalThis.Error;
const __velarServeMap = globalThis.Map;
const __velarServeNumber = globalThis.Number;
const __velarServeObject = globalThis.Object;
const __velarServeRangeError = globalThis.RangeError;
const __velarServeRegExp = globalThis.RegExp;
const __velarServeReflect = globalThis.Reflect;
const __velarServeString = globalThis.String;
const __velarServeTypeError = globalThis.TypeError;
const __velarServeOwnDescriptor = __velarServeObject.getOwnPropertyDescriptor;
const __velarServeApply = __velarServeReflect.apply;
function __velarServeDataOperation(target, name) {
  const descriptor = __velarServeOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarServeError("VelarScript serve operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarServeArrayIsArray = __velarServeDataOperation(__velarServeArray, "isArray");
const __velarServeNumberIsFinite = __velarServeDataOperation(__velarServeNumber, "isFinite");
const __velarServeNumberIsSafeInteger = __velarServeDataOperation(__velarServeNumber, "isSafeInteger");
const __velarServeObjectCreate = __velarServeDataOperation(__velarServeObject, "create");
const __velarServeObjectDefineProperty = __velarServeDataOperation(__velarServeObject, "defineProperty");
const __velarServeObjectFreeze = __velarServeDataOperation(__velarServeObject, "freeze");
const __velarServeObjectGetPrototypeOf = __velarServeDataOperation(__velarServeObject, "getPrototypeOf");
const __velarServeOwnKeys = __velarServeDataOperation(__velarServeReflect, "ownKeys");
const __velarServeMapEntries = __velarServeDataOperation(__velarServeMap.prototype, "entries");
const __velarServeMapGet = __velarServeDataOperation(__velarServeMap.prototype, "get");
const __velarServeMapHas = __velarServeDataOperation(__velarServeMap.prototype, "has");
const __velarServeMapSet = __velarServeDataOperation(__velarServeMap.prototype, "set");
const __velarServeMapDelete = __velarServeDataOperation(__velarServeMap.prototype, "delete");
const __velarServeMapSize = __velarServeOwnDescriptor(__velarServeMap.prototype, "size")?.get;
const __velarServeMapIterator = __velarServeApply(__velarServeMapEntries, new __velarServeMap(), []);
const __velarServeMapIteratorNext = __velarServeDataOperation(__velarServeApply(__velarServeObjectGetPrototypeOf, __velarServeObject, [__velarServeMapIterator]), "next");
const __velarServeStringIncludes = __velarServeDataOperation(__velarServeString.prototype, "includes");
const __velarServeStringStartsWith = __velarServeDataOperation(__velarServeString.prototype, "startsWith");
const __velarServeStringToLowerCase = __velarServeDataOperation(__velarServeString.prototype, "toLowerCase");
const __velarServeRegExpTest = __velarServeDataOperation(__velarServeRegExp.prototype, "test");
const __velarServeHeaderNamePattern = /^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u;
const __velarServeHeaderValuePattern = /[\0\r\n]/u;
const __velarServeMethodPattern = /^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u;
const __velarServeMaxBodyBytes = 16 * 1024 * 1024;
const __velarServeMaxPathCodeUnits = 4096;
const __velarServeFileMarker = Symbol("velar.serve.file-response");
const __velarServeHandlers = new __velarServeMap();
const __velarServeResponseFields = __velarServeFieldMap(["status", "json", "text", "contentType", "stream", "headers"]);
const __velarServeBodyFields = __velarServeFieldMap(["text", "bytes", "tooLarge"]);
const __velarServeRequestFields = __velarServeFieldMap(["token", "request", "method", "path", "query", "headers"]);
const __velarServeStartFields = __velarServeFieldMap(["handle", "port"]);
let __velarServeNextToken = 1;

function __velarServeCall(operation, receiver, args) {
  return __velarServeApply(operation, receiver, args);
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

function __velarServeTypeObject(check, message) {
  const value = __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    is(candidate) { try { return check(candidate); } catch { return false; } },
    parse(candidate) { if (!check(candidate)) throw new __velarServeTypeError(message); return candidate; },
  }]);
  return __velarRegisterRuntimeType(value);
}

export class RequestBodyTooLargeError extends __velarServeRangeError {
  constructor(maxBytes) {
    super("Request body exceeds maxBytes (" + maxBytes + ")");
    __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [this, "name", {value: "RequestBodyTooLargeError", enumerable: false, configurable: true, writable: true}]);
    __velarServeCall(__velarServeObjectDefineProperty, __velarServeObject, [this, "maxBytes", {value: maxBytes, enumerable: true, configurable: false, writable: false}]);
  }
}

function __velarServeIsFileResponse(value) {
  if (!value || typeof value !== "object") return false;
  const descriptor = __velarServeOwnDescriptor(value, __velarServeFileMarker);
  return descriptor?.enumerable === true && "value" in descriptor && descriptor.value === true;
}

function __velarServeResponse(value) {
  if (__velarServeIsFileResponse(value)) return value;
  const fields = __velarServeRecord(value, __velarServeResponseFields, "ServeResponse");
  if (!__velarServeIsSafeInteger(fields.status) || fields.status < 100 || fields.status > 599) {
    throw new __velarServeRangeError("ServeResponse.status must be an HTTP status integer from 100 through 599");
  }
  let bodies = 0;
  const bodyNames = ["json", "text", "stream"];
  for (let index = 0; index < bodyNames.length; index += 1) if (__velarServeOwnDescriptor(fields, bodyNames[index])) bodies += 1;
  if (bodies !== 1) throw new __velarServeTypeError("ServeResponse requires exactly one of json, text, or stream");
  if (__velarServeOwnDescriptor(fields, "json") && __velarUtf8ByteLength(__velarJsonStringify(fields.json)) > __velarServeMaxBodyBytes) {
    throw new __velarServeRangeError("ServeResponse.json cannot exceed 16 MiB");
  }
  if (__velarServeOwnDescriptor(fields, "text") && typeof fields.text !== "string") throw new __velarServeTypeError("ServeResponse.text must be a string");
  if (__velarServeOwnDescriptor(fields, "text") && __velarUtf8ByteLength(fields.text) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.text cannot exceed 16 MiB");
  if (__velarServeOwnDescriptor(fields, "stream") && typeof fields.stream !== "function") throw new __velarServeTypeError("ServeResponse.stream must be an async producer");
  if (fields.contentType != null && (typeof fields.contentType !== "string" || fields.contentType.length === 0 || fields.contentType.length > 1024
    || __velarServeCall(__velarServeStringIncludes, fields.contentType, ["\0"]) || __velarServeCall(__velarServeStringIncludes, fields.contentType, ["\r"])
    || __velarServeCall(__velarServeStringIncludes, fields.contentType, ["\n"]))) {
    throw new __velarServeTypeError("ServeResponse.contentType must be bounded single-line text");
  }
  __velarServeResponseHeaders(fields.headers);
  return fields;
}

function __velarServeResponseHeaders(value) {
  const pairs = value == null ? [] : __velarServeMapSnapshot(value, "ServeResponse.headers");
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
  }
  return pairs;
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
      && typeof __velarServeDataField(value, "json", "ServeRequest") === "function"
      && typeof __velarServeDataField(value, "parse", "ServeRequest") === "function";
    if (!valid) return false;
    __velarServeMapSnapshot(__velarServeDataField(value, "query", "ServeRequest"), "ServeRequest.query");
    __velarServeMapSnapshot(__velarServeDataField(value, "headers", "ServeRequest"), "ServeRequest.headers");
    return true;
  } catch { return false; }
}

export const ServeRequest = __velarServeTypeObject(__velarServeIsRequest, "ServeRequest requires the request fields provided by velar/serve");
export const ServeResponse = __velarServeTypeObject(value => { __velarServeResponse(value); return true; }, "ServeResponse requires exactly one checked body");
export const Server = __velarServeTypeObject(value => {
  try {
    value = __velarServePlainRecord(value, "Server");
    const port = __velarServeDataField(value, "port", "Server");
    return __velarServeIsSafeInteger(port) && port >= 0 && port <= 65535 && typeof __velarServeDataField(value, "stop", "Server") === "function";
  } catch { return false; }
}, "Server requires port and stop fields");

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
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{[__velarServeFileMarker]: true, root, path, fallback}]);
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

function __velarServeRequest(value) {
  value = __velarServeRecord(value, __velarServeRequestFields, "Node serve request event");
  if (!__velarServeIsSafeInteger(value.token) || value.token < 1 || !__velarServeIsSafeInteger(value.request) || value.request < 1
    || typeof value.method !== "string" || value.method.length === 0 || value.method.length > 32
    || !__velarServeCall(__velarServeRegExpTest, __velarServeMethodPattern, [value.method])
    || typeof value.path !== "string" || !__velarServeCall(__velarServeStringStartsWith, value.path, ["/"]) || value.path.length > __velarServeMaxPathCodeUnits) {
    throw new __velarServeTypeError("Node host returned an invalid serve request");
  }
  const handle = value.request;
  const body = async (maxBytes = __velarServeMaxBodyBytes) => {
    if (!__velarServeIsSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > __velarServeMaxBodyBytes) {
      throw new __velarServeRangeError("Request body maxBytes must be an integer from 1 through 16777216");
    }
    return __velarServeBodyResult(await __velarNodeHostInvoke("serve.body", [handle, maxBytes]), maxBytes);
  };
  const json = async (maxBytes = __velarServeMaxBodyBytes) => __velarJsonParse(await body(maxBytes), "ServeRequest JSON text");
  return {token: value.token, handle, request: __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{
    method: value.method,
    path: value.path,
    query: __velarServePairsMap(value.query, "ServeRequest.query"),
    headers: __velarServePairsMap(value.headers, "ServeRequest.headers"),
    text: body,
    json,
    parse: async (Type, maxBytes = __velarServeMaxBodyBytes) => {
      Type = __velarRequireRuntimeType(Type, "ServeRequest.parse");
      return Type.parse(await json(maxBytes));
    },
  }])};
}

async function __velarServeWriteResponse(handle, value) {
  if (__velarServeIsFileResponse(value)) {
    await __velarNodeHostInvoke("serve.respondFile", [handle, value.root, value.path, value.fallback]);
    return null;
  }
  const response = __velarServeResponse(value);
  const headers = __velarServeResponseHeaders(response.headers);
  if (__velarServeOwnDescriptor(response, "json")) {
    const body = __velarJsonStringify(response.json);
    if (__velarUtf8ByteLength(body) > __velarServeMaxBodyBytes) throw new __velarServeRangeError("ServeResponse.json cannot exceed 16 MiB");
    await __velarNodeHostInvoke("serve.respond", [handle, response.status, headers, "json", body, null]);
    return null;
  }
  if (__velarServeOwnDescriptor(response, "text")) {
    await __velarNodeHostInvoke("serve.respond", [handle, response.status, headers, "text", response.text, response.contentType ?? null]);
    return null;
  }
  await __velarNodeHostInvoke("serve.streamStart", [handle, response.status, headers]);
  const write = async chunk => {
    if (typeof chunk !== "string") throw new __velarServeTypeError("ServeResponse.stream chunks must be strings");
    if (__velarUtf8ByteLength(chunk) > 1024 * 1024) throw new __velarServeRangeError("ServeResponse.stream chunks cannot exceed 1 MiB");
    await __velarNodeHostInvoke("serve.streamWrite", [handle, chunk]);
    return null;
  };
  const result = await response.stream(write);
  if (result !== null) throw new __velarServeTypeError("ServeResponse.stream producer must resolve to null");
  await __velarNodeHostInvoke("serve.streamEnd", [handle]);
  return null;
}

async function __velarServeDispatch(event) {
  let value;
  try { value = __velarServeRequest(event); }
  catch {
    const request = event && typeof event === "object" ? __velarServeOwnDescriptor(event, "request") : null;
    if (request && "value" in request && __velarServeIsSafeInteger(request.value) && request.value > 0) {
      try { await __velarNodeHostInvoke("serve.fail", [request.value]); }
      catch {}
    }
    return;
  }
  const handler = __velarServeCall(__velarServeMapGet, __velarServeHandlers, [value.token]);
  if (typeof handler !== "function") { await __velarNodeHostInvoke("serve.fail", [value.handle]); return; }
  try { await __velarServeWriteResponse(value.handle, await handler(value.request)); }
  catch {
    try { await __velarNodeHostInvoke("serve.fail", [value.handle]); }
    catch {}
  }
}

__velarNodeHostOn("serve.request", event => { __velarServeDispatch(event); });

export async function serve(handler, port, host = "127.0.0.1") {
  if (typeof handler !== "function") throw new __velarServeTypeError("serve requires an async request handler");
  if (!__velarServeIsSafeInteger(port) || port < 0 || port > 65535) throw new __velarServeRangeError("serve port must be an integer from 0 through 65535");
  if (typeof host !== "string" || host.length === 0 || host.length > 255 || __velarServeCall(__velarServeStringIncludes, host, ["\0"])) {
    throw new __velarServeTypeError("serve host must be bounded text");
  }
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
  let started;
  try { started = __velarServeRecord(await __velarNodeHostInvoke("serve.start", [token, port, host]), __velarServeStartFields, "Node serve start result"); }
  catch (error) { __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]); throw error; }
  if (!__velarServeIsSafeInteger(started.handle) || started.handle < 1 || !__velarServeIsSafeInteger(started.port) || started.port < 0 || started.port > 65535) {
    __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
    throw new __velarServeTypeError("Node host returned an invalid server");
  }
  let stopped = null;
  const stop = async () => {
    if (stopped !== null) return stopped;
    stopped = (async () => {
      const result = await __velarNodeHostInvoke("serve.stop", [started.handle]);
      if (result !== null) throw new __velarServeTypeError("Node host returned an invalid server stop completion");
      __velarServeCall(__velarServeMapDelete, __velarServeHandlers, [token]);
      return null;
    })();
    return stopped;
  };
  return __velarServeCall(__velarServeObjectFreeze, __velarServeObject, [{port: started.port, stop}]);
}
`.trimStart();
