import { VELAR_STRICT_JSON_RUNTIME, VELAR_TYPE_REGISTRY_RUNTIME, VELAR_UTF8_RUNTIME } from "@velarscript/compiler/extension";

export const VELAR_NODE_HTTP_RUNTIME = String.raw`
import { __velarNodeHostHttpTransportError, __velarNodeHostInvoke } from "velar/node-host-v1";
import { Bytes as __velarHttpBytes } from "velar/binary";

${VELAR_STRICT_JSON_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
const maxBodyBytes = 16 * 1024 * 1024;
const maxResponseBytes = 64 * 1024 * 1024;
const maxResponseChunks = 1000000;
const NativeArray = globalThis.Array;
const NativeError = globalThis.Error;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeRangeError = globalThis.RangeError;
const NativeRegExp = globalThis.RegExp;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;
const NativeWeakSet = globalThis.WeakSet;
const NativeUint8Array = globalThis.Uint8Array;
const NativeURL = typeof globalThis.URL === "function" ? globalThis.URL : null;
const NativeMap = typeof globalThis.Map === "function" ? globalThis.Map : null;
const NativeSet = typeof globalThis.Set === "function" ? globalThis.Set : null;
const nativeReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const nativeReflectOwnKeys = Object.getOwnPropertyDescriptor(Reflect, "ownKeys")?.value;
const nativeArrayIsArray = Object.getOwnPropertyDescriptor(NativeArray, "isArray")?.value;
const nativeArrayJoin = Object.getOwnPropertyDescriptor(NativeArray.prototype, "join")?.value;
const nativeArrayPush = Object.getOwnPropertyDescriptor(NativeArray.prototype, "push")?.value;
const nativeTypedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const nativeUint8ArraySet = Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, "set")?.value;
const nativePromiseThen = Object.getOwnPropertyDescriptor(NativePromise.prototype, "then")?.value;
const nativeNumberIsInteger = Object.getOwnPropertyDescriptor(NativeNumber, "isInteger")?.value;
const nativeNumberIsSafeInteger = Object.getOwnPropertyDescriptor(NativeNumber, "isSafeInteger")?.value;
const nativeObjectCreate = Object.getOwnPropertyDescriptor(NativeObject, "create")?.value;
const nativeObjectFreeze = Object.getOwnPropertyDescriptor(NativeObject, "freeze")?.value;
const nativeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(NativeObject, "getOwnPropertyDescriptor")?.value;
const nativeObjectGetPrototypeOf = Object.getOwnPropertyDescriptor(NativeObject, "getPrototypeOf")?.value;
const nativeRegExpTest = Object.getOwnPropertyDescriptor(NativeRegExp.prototype, "test")?.value;
const nativeStringToLowerCase = Object.getOwnPropertyDescriptor(NativeString.prototype, "toLowerCase")?.value;
const nativeStringToUpperCase = Object.getOwnPropertyDescriptor(NativeString.prototype, "toUpperCase")?.value;
const nativeMapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const nativeMapGet = Object.getOwnPropertyDescriptor(Map.prototype, "get")?.value;
const nativeMapHas = Object.getOwnPropertyDescriptor(Map.prototype, "has")?.value;
const nativeMapSet = Object.getOwnPropertyDescriptor(Map.prototype, "set")?.value;
const nativeMapForEach = Object.getOwnPropertyDescriptor(Map.prototype, "forEach")?.value;
const nativeSetSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get;
const nativeSetHas = Object.getOwnPropertyDescriptor(Set.prototype, "has")?.value;
const nativeSetAdd = Object.getOwnPropertyDescriptor(Set.prototype, "add")?.value;
const nativeSetDelete = Object.getOwnPropertyDescriptor(Set.prototype, "delete")?.value;
const nativeWeakSetHas = Object.getOwnPropertyDescriptor(WeakSet.prototype, "has")?.value;
const nativeWeakSetAdd = Object.getOwnPropertyDescriptor(WeakSet.prototype, "add")?.value;
const nativeUrlHref = typeof NativeURL === "function" ? Object.getOwnPropertyDescriptor(NativeURL.prototype, "href")?.get : null;
const nativeUrlProtocol = typeof NativeURL === "function" ? Object.getOwnPropertyDescriptor(NativeURL.prototype, "protocol")?.get : null;
const nativeUrlUsername = typeof NativeURL === "function" ? Object.getOwnPropertyDescriptor(NativeURL.prototype, "username")?.get : null;
const nativeUrlPassword = typeof NativeURL === "function" ? Object.getOwnPropertyDescriptor(NativeURL.prototype, "password")?.get : null;
const nativeSetTimeout = typeof globalThis.setTimeout === "function" ? globalThis.setTimeout : null;
const nativeClearTimeout = typeof globalThis.clearTimeout === "function" ? globalThis.clearTimeout : null;
const nativeProcessEnvironment = typeof process === "object" && process !== null ? process.env : null;
const nativeMaxSafeInteger = NativeNumber.MAX_SAFE_INTEGER;
const methodPattern = /^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u;
const headerNamePattern = /^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u;
const lineBreakPattern = /[\r\n]/u;
const secretEnvironmentPattern = /^[A-Z_][A-Z0-9_]{0,127}$/u;

function parseJsonText(text) {
  return __velarJsonParse(text, "HTTP JSON text");
}
function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }

function call(operation, receiver, argumentsValue) { return nativeReflectApply(operation, receiver, argumentsValue); }
function arrayJoin(value, separator) { return call(nativeArrayJoin, value, [separator]); }
function arrayPush(value, item) { return call(nativeArrayPush, value, [item]); }
function freeze(value) { return call(nativeObjectFreeze, NativeObject, [value]); }
function ownDescriptor(value, key) { return call(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, key]); }
function ownKeys(value) { return call(nativeReflectOwnKeys, Reflect, [value]); }
function stringLower(value) { return call(nativeStringToLowerCase, value, []); }
function stringUpper(value) { return call(nativeStringToUpperCase, value, []); }
function patternMatches(pattern, value) { return call(nativeRegExpTest, pattern, [value]); }
function setOf(values) {
  const output = new NativeSet();
  for (let index = 0; index < values.length; index += 1) call(nativeSetAdd, output, [values[index]]);
  return output;
}

function requireHttpHost() {
  if (typeof NativeArray !== "function" || typeof NativeError !== "function" || typeof NativeNumber !== "function"
    || typeof NativeObject !== "function" || typeof NativePromise !== "function" || typeof NativeRangeError !== "function" || typeof NativeRegExp !== "function"
    || typeof NativeString !== "function" || typeof NativeTypeError !== "function" || typeof NativeWeakSet !== "function"
    || typeof NativeURL !== "function" || typeof NativeMap !== "function" || typeof NativeSet !== "function"
    || typeof nativeReflectApply !== "function" || typeof nativeReflectOwnKeys !== "function"
    || typeof nativeArrayIsArray !== "function" || typeof nativeArrayJoin !== "function"
    || typeof nativeArrayPush !== "function" || typeof nativeUint8ArraySet !== "function" || typeof nativePromiseThen !== "function"
    || typeof nativeNumberIsInteger !== "function" || typeof nativeNumberIsSafeInteger !== "function"
    || typeof nativeObjectCreate !== "function" || typeof nativeObjectFreeze !== "function"
    || typeof nativeObjectGetOwnPropertyDescriptor !== "function" || typeof nativeObjectGetPrototypeOf !== "function"
    || typeof nativeRegExpTest !== "function" || typeof nativeStringToLowerCase !== "function" || typeof nativeStringToUpperCase !== "function"
    || typeof nativeMapSize !== "function" || typeof nativeMapGet !== "function" || typeof nativeMapHas !== "function" || typeof nativeMapSet !== "function"
    || typeof nativeMapForEach !== "function" || typeof nativeSetSize !== "function" || typeof nativeSetHas !== "function"
    || typeof nativeSetAdd !== "function" || typeof nativeSetDelete !== "function"
    || typeof nativeWeakSetHas !== "function" || typeof nativeWeakSetAdd !== "function" || typeof nativeUrlHref !== "function"
    || typeof nativeUrlProtocol !== "function" || typeof nativeUrlUsername !== "function" || typeof nativeUrlPassword !== "function"
    || typeof nativeSetTimeout !== "function" || typeof nativeClearTimeout !== "function" || nativeProcessEnvironment === null) {
    throw new NativeTypeError("The Node HTTP host ABI is unavailable");
  }
}

function urlHref(value) { return nativeReflectApply(nativeUrlHref, value, []); }
function urlProtocol(value) { return nativeReflectApply(nativeUrlProtocol, value, []); }
function urlUsername(value) { return nativeReflectApply(nativeUrlUsername, value, []); }
function urlPassword(value) { return nativeReflectApply(nativeUrlPassword, value, []); }
function plainRecord(value, name) {
  if (value == null) return call(nativeObjectCreate, NativeObject, [null]);
  if (typeof value !== "object" || call(nativeArrayIsArray, NativeArray, [value])) throw new NativeTypeError(name + " must be a record");
  const prototype = call(nativeObjectGetPrototypeOf, NativeObject, [value]);
  if (prototype !== NativeObject.prototype && prototype !== null) throw new NativeTypeError(name + " must be a plain record");
  const output = call(nativeObjectCreate, NativeObject, [null]);
  const keys = ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw new NativeTypeError(name + " fields must use string names");
    const descriptor = ownDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new NativeTypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function methodOf(value) {
  if (typeof value !== "string") throw new NativeTypeError("HTTP method must be text");
  const method = stringUpper(value);
  if (method.length === 0 || method.length > 32 || !patternMatches(methodPattern, method)
    || method === "CONNECT" || method === "TRACE" || method === "TRACK") {
    throw new NativeTypeError("HTTP method is invalid or forbidden");
  }
  return method;
}
function urlOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024) throw new NativeTypeError("HTTP URL must be bounded text");
  requireHttpHost();
  const url = new NativeURL(value);
  const protocol = urlProtocol(url);
  if (protocol !== "http:" && protocol !== "https:") throw new NativeTypeError("HTTP URL must use http or https");
  if (urlUsername(url) || urlPassword(url)) throw new NativeTypeError("HTTP URL credentials are not allowed; use an Authorization header");
  return urlHref(url);
}
// The transport owns message framing and routing, so an application header map
// may never restate them: a caller-supplied content-length, transfer-encoding
// or host lands on the wire beside the host's own framing and is a
// request-smuggling primitive. Cookie and proxy credentials are ordinary
// application headers here; they are forbidden only as secretHeader names.
const transportOwnedHttpHeaders = setOf(["connection", "content-length", "expect", "host", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]);
function headersOf(value) {
  if (value == null) { requireHttpHost(); return new NativeMap(); }
  let size;
  try { requireHttpHost(); size = nativeReflectApply(nativeMapSize, value, []); }
  catch { throw new NativeTypeError("HTTP headers must be Map<string, string>"); }
  if (size > 100) throw new NativeRangeError("HTTP headers cannot exceed 100 fields");
  const output = new NativeMap();
  let units = 0;
  nativeReflectApply(nativeMapForEach, value, [(item, name) => {
    if (typeof name !== "string" || typeof item !== "string" || !patternMatches(headerNamePattern, name) || patternMatches(lineBreakPattern, item)) {
      throw new NativeTypeError("HTTP headers must use valid string names and single-line values");
    }
    if (call(nativeSetHas, transportOwnedHttpHeaders, [stringLower(name)])) {
      throw new NativeTypeError("HTTP header '" + name + "' is transport-controlled");
    }
    units += name.length + item.length;
    if (units > 65536) throw new NativeRangeError("HTTP headers cannot exceed 64 KiB");
    nativeReflectApply(nativeMapSet, output, [name, item]);
  }]);
  return output;
}
const secretHeaderValues = new NativeWeakSet();
const forbiddenSecretHeaders = setOf(["connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const allowedOptionFields = setOf(["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
function secretHeaderName(value) {
  if (typeof value !== "string" || !patternMatches(headerNamePattern, value)
    || call(nativeSetHas, forbiddenSecretHeaders, [stringLower(value)])) {
    throw new NativeTypeError("HTTP secret header name is invalid or transport-controlled");
  }
  return value;
}
function secretEnvironment(value) {
  if (typeof value !== "string" || !patternMatches(secretEnvironmentPattern, value)) {
    throw new NativeTypeError("HTTP secret environment name must be uppercase ASCII text");
  }
  return value;
}
function secretPrefix(value) {
  if (typeof value !== "string" || value.length > 256 || patternMatches(lineBreakPattern, value)) {
    throw new NativeTypeError("HTTP secret header prefix must be single-line text of at most 256 characters");
  }
  return value;
}
export function secretHeader(name, environment, prefix = "") {
  const value = freeze({
    name: secretHeaderName(name),
    environment: secretEnvironment(environment),
    prefix: secretPrefix(prefix),
  });
  nativeReflectApply(nativeWeakSetAdd, secretHeaderValues, [value]);
  return value;
}
function secretHeadersOf(value) {
  if (value == null) return freeze([]);
  if (!call(nativeArrayIsArray, NativeArray, [value]) || value.length > 16) throw new NativeTypeError("HTTP secretHeaders must be a List with at most 16 entries");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = ownDescriptor(value, call(NativeString, undefined, [index]));
    if (!descriptor?.enumerable || !("value" in descriptor) || !nativeReflectApply(nativeWeakSetHas, secretHeaderValues, [descriptor.value])) {
      throw new NativeTypeError("HTTP secretHeaders entries must be created by secretHeader");
    }
    arrayPush(output, descriptor.value);
  }
  return freeze(output);
}

function resolvedSecretHeaders(value, headers) {
  const names = new NativeSet();
  const output = [];
  let units = 0;
  call(nativeMapForEach, headers, [(item, name) => { units += name.length + item.length; }]);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const lower = stringLower(item.name);
    let conflict = false;
    call(nativeMapForEach, headers, [(_item, name) => { if (stringLower(name) === lower) conflict = true; }]);
    if (conflict || call(nativeSetHas, names, [lower])) throw new NativeTypeError("HTTP secret header conflicts with another header");
    const secretDescriptor = ownDescriptor(nativeProcessEnvironment, item.environment);
    if (!secretDescriptor || !("value" in secretDescriptor) || typeof secretDescriptor.value !== "string") {
      throw new NativeError("HTTP secret environment variable '" + item.environment + "' is unavailable");
    }
    const headerValue = item.prefix + secretDescriptor.value;
    if (patternMatches(lineBreakPattern, headerValue) || __velarUtf8ByteLength(headerValue) > 65536) {
      throw new NativeRangeError("HTTP secret header value is outside the supported bounds");
    }
    units += item.name.length + headerValue.length;
    if (units > 65536 || value.length + call(nativeMapSize, headers, []) > 100) throw new NativeRangeError("HTTP headers exceed their supported bounds");
    call(nativeSetAdd, names, [lower]);
    arrayPush(output, {name: item.name, value: headerValue});
  }
  return output;
}
function jsonBody(value) {
  const text = __velarJsonStringify(value);
  if (__velarUtf8ByteLength(text) > maxBodyBytes) throw new NativeRangeError("HTTP body cannot exceed 16 MiB");
  return text;
}
function optionsOf(value) {
  value = plainRecord(value, "HTTP options");
  const keys = ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string" || !call(nativeSetHas, allowedOptionFields, [key])) throw new NativeTypeError("HTTP options has unknown field '" + key + "'");
  }
  const timeout = value.timeout ?? 120000;
  if (!call(nativeNumberIsSafeInteger, NativeNumber, [timeout]) || timeout < 0 || timeout > 600000) throw new NativeRangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
  const maxBytes = value.maxBytes ?? maxBodyBytes;
  if (!call(nativeNumberIsSafeInteger, NativeNumber, [maxBytes]) || maxBytes < 1 || maxBytes > maxResponseBytes) throw new NativeRangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  let headers = headersOf(value.headers);
  const secretHeaders = secretHeadersOf(value.secretHeaders);
  let body = value.body ?? null;
  if (body !== null && __velarHttpBytes.is(body)) {
    body = __velarHttpBytes.parse(body);
  } else if (body !== null && typeof body !== "string") {
    body = jsonBody(body);
    let hasContentType = false;
    call(nativeMapForEach, headers, [(_item, name) => { if (stringLower(name) === "content-type") hasContentType = true; }]);
    if (!hasContentType) call(nativeMapSet, headers, ["content-type", "application/json"]);
    headers = headersOf(headers);
  }
  if (typeof body === "string" && __velarUtf8ByteLength(body) > maxBodyBytes || __velarHttpBytes.is(body) && body.byteLength > maxBodyBytes) throw new NativeRangeError("HTTP body cannot exceed 16 MiB");
  return { headers, secretHeaders, body, timeout, maxBytes };
}

function headerPairs(value) {
  const output = [];
  call(nativeMapForEach, value, [(item, name) => { arrayPush(output, [name, item]); }]);
  return output;
}

function hostFields(value, names, label) {
  value = plainRecord(value, label);
  const allowed = setOf(names);
  const keys = ownKeys(value);
  if (keys.length !== names.length) throw new NativeTypeError(label + " is invalid");
  for (let index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] !== "string" || !call(nativeSetHas, allowed, [keys[index]])) throw new NativeTypeError(label + " is invalid");
  }
  for (let index = 0; index < names.length; index += 1) {
    if (!ownDescriptor(value, names[index])) throw new NativeTypeError(label + " is invalid");
  }
  return value;
}

function responseHeaderMap(value) {
  if (!call(nativeArrayIsArray, NativeArray, [value]) || value.length > 100) throw new NativeTypeError("Node host returned invalid HTTP response headers");
  const output = new NativeMap();
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const pair = ownDescriptor(value, call(NativeString, undefined, [index]));
    if (!pair?.enumerable || !("value" in pair) || !call(nativeArrayIsArray, NativeArray, [pair.value]) || pair.value.length !== 2) {
      throw new NativeTypeError("Node host returned invalid HTTP response headers");
    }
    const name = ownDescriptor(pair.value, "0");
    const item = ownDescriptor(pair.value, "1");
    if (!name?.enumerable || !("value" in name) || !item?.enumerable || !("value" in item)
      || typeof name.value !== "string" || typeof item.value !== "string" || !patternMatches(headerNamePattern, name.value)) {
      throw new NativeTypeError("Node host returned invalid HTTP response headers");
    }
    units += name.value.length + item.value.length;
    if (units > 65536 || call(nativeMapHas, output, [name.value])) throw new NativeRangeError("HTTP response headers exceed their supported bounds");
    call(nativeMapSet, output, [name.value, item.value]);
  }
  return output;
}

function hostResponse(value, expectedHandle) {
  value = hostFields(value, ["handle", "ok", "status", "statusText", "url", "headers", "body"], "Node HTTP response");
  if (!call(nativeNumberIsSafeInteger, NativeNumber, [value.handle]) || value.handle !== expectedHandle
    || typeof value.ok !== "boolean" || !call(nativeNumberIsInteger, NativeNumber, [value.status]) || value.status < 100 || value.status > 599
    || value.ok !== (value.status >= 200 && value.status <= 299) || typeof value.statusText !== "string" || value.statusText.length > 65536
    || typeof value.url !== "string" || value.url.length === 0 || value.url.length > 2 * 1024 * 1024 || typeof value.body !== "boolean") {
    throw new NativeTypeError("Node host returned invalid HTTP response metadata");
  }
  return {
    ok: value.ok,
    status: value.status,
    statusText: value.statusText,
    url: value.url,
    headers: responseHeaderMap(value.headers),
    body: value.body,
  };
}

function hostChunk(value) {
  value = hostFields(value, ["done", "text"], "Node HTTP chunk");
  if (typeof value.done !== "boolean" || typeof value.text !== "string") throw new NativeTypeError("Node host returned an invalid HTTP chunk");
  return value;
}

const activeHttpHandles = new NativeSet();
let nextHttpHandle = 1;

function allocateHttpHandle() {
  if (call(nativeSetSize, activeHttpHandles, []) >= 1024) throw new NativeRangeError("Node HTTP cannot have more than 1024 active requests");
  for (let attempts = 0; attempts <= 1024; attempts += 1) {
    const handle = nextHttpHandle;
    nextHttpHandle = handle >= nativeMaxSafeInteger ? 1 : handle + 1;
    if (!call(nativeSetHas, activeHttpHandles, [handle])) {
      call(nativeSetAdd, activeHttpHandles, [handle]);
      return handle;
    }
  }
  throw new NativeRangeError("Node HTTP request identity space is unavailable");
}

function observe(promise, fulfilled, rejected) {
  return call(nativePromiseThen, promise, [fulfilled, rejected]);
}

function releaseHttpHandle(handle, promise) {
  observe(promise,
    () => { call(nativeSetDelete, activeHttpHandles, [handle]); return null; },
    () => { call(nativeSetDelete, activeHttpHandles, [handle]); return null; });
}

export class HttpAbortError extends NativeError {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new NativeTypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError";
    this.reason = reason;
  }
}
// D60 rule 149: a module-provided enum carries the same runtime face a declared
// enum does -- charter section 6 reserves is, parse, and values on every enum,
// and this one published members only.
export const HttpTransportPhase = __velarRegisterRuntimeType(freeze({
  request: "request",
  response: "response",
  is(value) { return value === "request" || value === "response"; },
  parse(value) {
    if (!HttpTransportPhase.is(value)) throw new NativeTypeError("Value does not match HttpTransportPhase");
    return value;
  },
  values() { return ["request", "response"]; },
}));
export class HttpTransportError extends NativeError {
  constructor(message, phase) {
    if (typeof message !== "string") throw new NativeTypeError("HTTP transport error message must be text");
    if (message.length === 0 || message.length > 65536) throw new NativeRangeError("HTTP transport error messages must contain at most 64 KiB");
    if (phase !== HttpTransportPhase.request && phase !== HttpTransportPhase.response) {
      throw new NativeTypeError("HTTP transport phase must be request or response");
    }
    super(message);
    this.name = "HttpTransportError";
    this.phase = phase;
  }
}
export class HttpResponseError extends NativeError {
  constructor(message, status, url, body = null) {
    if (typeof message !== "string") throw new NativeTypeError("HTTP error message must be text");
    if (message.length > 65536) throw new NativeRangeError("HTTP error messages cannot exceed 64 KiB");
    if (!call(nativeNumberIsInteger, NativeNumber, [status]) || status < 100 || status > 599) throw new NativeRangeError("HTTP error status must be an integer from 100 through 599");
    if (typeof url !== "string") throw new NativeTypeError("HTTP error URL must be text");
    if (url.length > 2 * 1024 * 1024) throw new NativeRangeError("HTTP error URLs cannot exceed 2 MiB");
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

class HttpResponse {
  constructor(response, request) {
    this.request = request;
    this.body = response.body;
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = response.url;
    this.headers = response.headers;
    this.declaredLength = call(nativeMapGet, response.headers, ["content-length"]) ?? null;
    this.cachedText = null;
    this.cachedBytes = null;
    this.textPending = null;
    this.consuming = false;
    if (!this.body) request.finish();
  }
  async consume(consumer) {
    if (this.cachedText !== null) {
      const result = await consumer(this.cachedText);
      if (result !== null) throw new NativeTypeError("HTTP stream consumer must resolve to null");
      return null;
    }
    if (this.consuming) throw new NativeError("HTTP response body is already being consumed");
    const declared = __velarDeclaredLength(this.declaredLength);
    if (this.body && declared !== null && declared > this.request.options.maxBytes) {
      this.request.finish();
      throw new NativeRangeError("HTTP response exceeds maxBytes");
    }
    this.consuming = true;
    let chunks = 0;
    try {
      if (this.body) {
        while (true) {
          let wire;
          try { wire = await __velarNodeHostInvoke("http.read", [this.request.handle]); }
          catch (error) {
            if (this.request.abortError) throw this.request.abortError;
            if (error instanceof __velarNodeHostHttpTransportError && error.phase === "response") {
              throw new HttpTransportError(error.message, HttpTransportPhase.response);
            }
            throw error;
          }
          const next = hostChunk(wire);
          if (!next.done) {
            chunks += 1;
            if (chunks > maxResponseChunks) throw new NativeRangeError("HTTP responses cannot exceed 1000000 chunks");
          }
          if (next.text) {
            const result = await consumer(next.text);
            if (result !== null) throw new NativeTypeError("HTTP stream consumer must resolve to null");
          }
          if (next.done) break;
          if (this.request.abortError) throw this.request.abortError;
        }
      }
      if (this.request.abortError) throw this.request.abortError;
      return null;
    } catch (error) {
      if (this.request.abortError) throw this.request.abortError;
      throw error;
    } finally {
      this.request.finish();
    }
  }
  async streamText(consumer) {
    if (typeof consumer !== "function") throw new NativeTypeError("HTTP streamText requires an async consumer");
    return this.consume(consumer);
  }
  async text() {
    if (this.cachedText !== null) return this.cachedText;
    if (this.textPending !== null) return this.textPending;
    const pending = (async () => {
      const chunks = [];
      await this.consume(async chunk => { arrayPush(chunks, chunk); return null; });
      return arrayJoin(chunks, "");
    })();
    this.textPending = pending;
    try {
      this.cachedText = await pending;
      return this.cachedText;
    } finally {
      if (this.textPending === pending) this.textPending = null;
    }
  }
  async bytes() {
    if (this.cachedBytes !== null) return this.cachedBytes;
    if (this.cachedText !== null) throw new NativeError("HTTP response body was already consumed as text");
    if (this.consuming) throw new NativeError("HTTP response body is already being consumed");
    const declared = __velarDeclaredLength(this.declaredLength);
    if (this.body && declared !== null && declared > this.request.options.maxBytes) { this.request.finish(); throw new NativeRangeError("HTTP response exceeds maxBytes"); }
    this.consuming = true;
    const chunks = [];
    let total = 0;
    try {
      if (this.body) {
        while (true) {
          let wire;
          try { wire = await __velarNodeHostInvoke("http.readBytes", [this.request.handle]); }
          catch (error) { if (this.request.abortError) throw this.request.abortError; if (error instanceof __velarNodeHostHttpTransportError && error.phase === "response") throw new HttpTransportError(error.message, HttpTransportPhase.response); throw error; }
          if (!wire || typeof wire !== "object" || typeof wire.done !== "boolean" || !__velarHttpBytes.is(wire.bytes)) throw new NativeTypeError("Node host returned an invalid HTTP byte chunk");
          if (wire.bytes.byteLength) { total += wire.bytes.byteLength; if (total > this.request.options.maxBytes || chunks.length >= maxResponseChunks) throw new NativeRangeError("HTTP response exceeds its byte or chunk bound"); arrayPush(chunks, wire.bytes); }
          if (wire.done) break;
        }
      }
      const output = new NativeUint8Array(total); let offset = 0;
      for (let index = 0; index < chunks.length; index += 1) { call(nativeUint8ArraySet, output, [chunks[index], offset]); offset += chunks[index].byteLength; }
      this.cachedBytes = __velarHttpBytes.parse(output);
      return this.cachedBytes;
    } finally { this.request.finish(); }
  }
  async json() {
    const text = await this.text();
    return parseJsonText(text);
  }
  async parse(Type) { Type = runtimeHttpType(Type); return __velarJsonParseTyped(Type, await this.text(), "HTTP JSON text"); }
}

class Request {
  constructor(method, url, options) {
    this.method = methodOf(method);
    this.url = urlOf(url);
    this.options = optionsOf(options);
    if ((this.method === "GET" || this.method === "HEAD") && this.options.body !== null) throw new NativeTypeError(this.method + " requests cannot have a body");
    this.handle = null;
    this.timer = null;
    this.pending = null;
    this.abortError = null;
    this.finished = false;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) { nativeReflectApply(nativeClearTimeout, globalThis, [this.timer]); this.timer = null; }
    if (this.handle !== null) {
      const handle = this.handle;
      this.handle = null;
      releaseHttpHandle(handle, __velarNodeHostInvoke("http.close", [handle]));
    }
  }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.timer) { nativeReflectApply(nativeClearTimeout, globalThis, [this.timer]); this.timer = null; }
    if (this.handle !== null) observe(__velarNodeHostInvoke("http.cancel", [this.handle, reason]), () => null, () => null);
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    requireHttpHost();
    this.handle = allocateHttpHandle();
    if (this.options.timeout) this.timer = nativeReflectApply(nativeSetTimeout, globalThis, [() => this.abort("timeout"), this.options.timeout]);
    this.pending = (async () => {
      try {
        let wire;
        try {
          wire = await __velarNodeHostInvoke("http.request", [
            this.handle,
            this.method,
            this.url,
            headerPairs(this.options.headers),
            resolvedSecretHeaders(this.options.secretHeaders, this.options.headers),
            this.options.body,
            this.options.maxBytes,
          ]);
        } catch (error) {
          if (this.abortError) throw this.abortError;
          if (error instanceof __velarNodeHostHttpTransportError && error.phase === "request") {
            throw new HttpTransportError(error.message, HttpTransportPhase.request);
          }
          throw error;
        }
        const response = hostResponse(wire, this.handle);
        if (this.abortError) throw this.abortError;
        const wrapped = new HttpResponse(response, this);
        // D90 R20: the 2xx question is asked here and nowhere else. The
        // transport snapshot still carries ok; the response an author holds
        // does not, because by the time it is returned the answer is always
        // yes.
        if (!response.ok) {
          const text = await wrapped.text();
          let body = text;
          try { body = text ? parseJsonText(text) : null; } catch {}
          const errorUrl = wrapped.url || this.url;
          throw new HttpResponseError("HTTP " + wrapped.status + " for " + errorUrl, wrapped.status, errorUrl, body);
        }
        return wrapped;
      } catch (error) {
        this.finish();
        if (this.abortError) throw this.abortError;
        throw error;
      }
    })();
    return this.pending;
  }
  async text() { return (await this.response()).text(); }
  async bytes() { return (await this.response()).bytes(); }
  async json() { return (await this.response()).json(); }
  async streamText(consumer) { return (await this.response()).streamText(consumer); }
  async parse(Type) { Type = runtimeHttpType(Type); return (await this.response()).parse(Type); }
  cancel() { this.abort("cancelled"); return null; }
}

const createRequest = method => (url, options = {}) => new Request(method, url, options);
export const http = freeze({
  request(method, url, options = {}) { return new Request(method, url, options); },
  get: createRequest("GET"), post: createRequest("POST"), put: createRequest("PUT"), patch: createRequest("PATCH"), delete: createRequest("DELETE"), head: createRequest("HEAD"),
});
`.trimStart();
