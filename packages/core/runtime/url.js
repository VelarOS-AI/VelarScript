const fallbackBase = "https://velar.invalid/";
const maxUrlCodeUnits = 2 * 1024 * 1024;
const __velarUrlNativeObject = globalThis.Object;
const __velarUrlNativeMap = globalThis.Map;
const __velarUrlNativeNumber = globalThis.Number;
const __velarUrlNativeString = globalThis.String;
const __velarUrlNativeUrl = globalThis.URL;
const __velarUrlNativeSearchParams = globalThis.URLSearchParams;
const __velarUrlNativeTypeError = globalThis.TypeError;
const __velarUrlNativeRangeError = globalThis.RangeError;
const __velarUrlNativeUriError = globalThis.URIError;
const __velarUrlGetOwnPropertyDescriptor = __velarUrlNativeObject.getOwnPropertyDescriptor;
const __velarUrlGetOwnPropertyNames = __velarUrlNativeObject.getOwnPropertyNames;
const __velarUrlGetOwnPropertySymbols = __velarUrlNativeObject.getOwnPropertySymbols;
const __velarUrlGetPrototypeOf = __velarUrlNativeObject.getPrototypeOf;
const __velarUrlApply = __velarUrlGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
function __velarUrlHostData(owner, key, kind) {
  const descriptor = __velarUrlGetOwnPropertyDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== kind) throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API is unavailable");
  return descriptor.value;
}
function __velarUrlHostOperation(owner, key) { return __velarUrlHostData(owner, key, "function"); }
function __velarUrlHostAccessor(owner, key, setter = false) {
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarUrlGetOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      const operation = descriptor[setter ? "set" : "get"];
      if (typeof operation !== "function") throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API must be an accessor");
      return operation;
    }
    owner = __velarUrlGetPrototypeOf(owner);
  }
  throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API is unavailable");
}
function __velarUrlInheritedDescriptor(owner, key) {
  for (let depth = 0; owner !== null && depth < 32; depth += 1) {
    const descriptor = __velarUrlGetOwnPropertyDescriptor(owner, key);
    if (descriptor) return descriptor;
    owner = __velarUrlGetPrototypeOf(owner);
  }
  return null;
}
function __velarUrlInheritedOperation(owner, key) {
  const descriptor = __velarUrlInheritedDescriptor(owner, key);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") throw new __velarUrlNativeTypeError("The JavaScript " + key + " URL API must be a data function");
  return descriptor.value;
}
const __velarUrlObjectPrototype = __velarUrlHostData(__velarUrlNativeObject, "prototype", "object");
const __velarUrlStringPrototype = __velarUrlHostData(__velarUrlNativeString, "prototype", "object");
const __velarUrlUrlPrototype = __velarUrlHostData(__velarUrlNativeUrl, "prototype", "object");
const __velarUrlSearchParamsPrototype = __velarUrlHostData(__velarUrlNativeSearchParams, "prototype", "object");
const __velarUrlMapPrototype = __velarUrlHostData(__velarUrlNativeMap, "prototype", "object");
const __velarUrlEncodeURIComponent = globalThis.encodeURIComponent;
const __velarUrlDecodeURIComponent = globalThis.decodeURIComponent;
const __velarUrlNumberIsFinite = __velarUrlHostOperation(__velarUrlNativeNumber, "isFinite");
const __velarUrlObjectFreeze = __velarUrlHostOperation(__velarUrlNativeObject, "freeze");
const __velarUrlStringCharCodeAt = __velarUrlHostOperation(__velarUrlStringPrototype, "charCodeAt");
const __velarUrlStringEndsWith = __velarUrlHostOperation(__velarUrlStringPrototype, "endsWith");
const __velarUrlStringSlice = __velarUrlHostOperation(__velarUrlStringPrototype, "slice");
const __velarUrlStringStartsWith = __velarUrlHostOperation(__velarUrlStringPrototype, "startsWith");
const __velarUrlRegExpPattern = /^[a-z][a-z\d+.-]*:/iu;
const __velarUrlHttpPattern = /^https?:$/u;
const __velarUrlRegExpTest = __velarUrlInheritedOperation(__velarUrlRegExpPattern, "test");
const __velarUrlSearchParamsAppend = __velarUrlHostOperation(__velarUrlSearchParamsPrototype, "append");
const __velarUrlSearchParamsEntries = __velarUrlHostOperation(__velarUrlSearchParamsPrototype, "entries");
const __velarUrlSearchParamsToString = __velarUrlHostOperation(__velarUrlSearchParamsPrototype, "toString");
const __velarUrlMapEntries = __velarUrlHostOperation(__velarUrlMapPrototype, "entries");
const __velarUrlMapSet = __velarUrlHostOperation(__velarUrlMapPrototype, "set");
const __velarUrlMapSize = __velarUrlHostAccessor(__velarUrlMapPrototype, "size");
const __velarUrlHref = __velarUrlHostAccessor(__velarUrlUrlPrototype, "href");
const __velarUrlProtocol = __velarUrlHostAccessor(__velarUrlUrlPrototype, "protocol");
const __velarUrlHost = __velarUrlHostAccessor(__velarUrlUrlPrototype, "host");
const __velarUrlHostname = __velarUrlHostAccessor(__velarUrlUrlPrototype, "hostname");
const __velarUrlPort = __velarUrlHostAccessor(__velarUrlUrlPrototype, "port");
const __velarUrlPathname = __velarUrlHostAccessor(__velarUrlUrlPrototype, "pathname");
const __velarUrlSearch = __velarUrlHostAccessor(__velarUrlUrlPrototype, "search");
const __velarUrlSetSearch = __velarUrlHostAccessor(__velarUrlUrlPrototype, "search", true);
const __velarUrlHash = __velarUrlHostAccessor(__velarUrlUrlPrototype, "hash");
const __velarUrlSetHash = __velarUrlHostAccessor(__velarUrlUrlPrototype, "hash", true);
const __velarUrlOrigin = __velarUrlHostAccessor(__velarUrlUrlPrototype, "origin");
const __velarUrlSearchIterator = __velarUrlApply(__velarUrlSearchParamsEntries, new __velarUrlNativeSearchParams(), []);
const __velarUrlSearchIteratorNext = __velarUrlInheritedOperation(__velarUrlSearchIterator, "next");
const __velarUrlMapIterator = __velarUrlApply(__velarUrlMapEntries, new __velarUrlNativeMap(), []);
const __velarUrlMapIteratorNext = __velarUrlInheritedOperation(__velarUrlMapIterator, "next");
const __velarUrlLocation = globalThis.location;
const __velarUrlLocationHrefDescriptor = __velarUrlLocation && (typeof __velarUrlLocation === "object" || typeof __velarUrlLocation === "function") ? __velarUrlInheritedDescriptor(__velarUrlLocation, "href") : null;
const __velarUrlLocationHrefGetter = __velarUrlLocationHrefDescriptor && typeof __velarUrlLocationHrefDescriptor.get === "function" ? __velarUrlLocationHrefDescriptor.get : null;
const __velarUrlLocationHrefData = __velarUrlLocationHrefDescriptor && "value" in __velarUrlLocationHrefDescriptor ? __velarUrlLocationHrefDescriptor.value : null;
if (typeof __velarUrlApply !== "function" || typeof __velarUrlEncodeURIComponent !== "function" || typeof __velarUrlDecodeURIComponent !== "function") throw new __velarUrlNativeTypeError("The JavaScript URL host API is unavailable");
function __velarUrlCall(operation, receiver, arguments_) { return __velarUrlApply(operation, receiver, arguments_); }
function urlText(value, name = "velar/url") { if (typeof value !== "string") throw new __velarUrlNativeTypeError(name + " requires a string"); if (value.length > maxUrlCodeUnits) throw new __velarUrlNativeRangeError(name + " cannot exceed 2 MiB"); return value; }
function ownData(container, key, name) { if (container === null || typeof container !== "object") throw new __velarUrlNativeTypeError(name + " must belong to an object"); const descriptor = __velarUrlGetOwnPropertyDescriptor(container, key); if (!descriptor || !("value" in descriptor)) throw new __velarUrlNativeTypeError(name + " must be an own data field"); return descriptor.value; }
function encodedComponentUnits(value) {
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = __velarUrlCall(__velarUrlStringCharCodeAt, value, [index]);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
      || code === 45 || code === 95 || code === 46 || code === 33 || code === 126
      || code === 42 || code === 39 || code === 40 || code === 41) units += 1;
    else if (code < 0x80) units += 3;
    else if (code < 0x800) units += 6;
    else if (code >= 0xD800 && code <= 0xDBFF) {
      const next = __velarUrlCall(__velarUrlStringCharCodeAt, value, [index + 1]);
      if (next < 0xDC00 || next > 0xDFFF) throw new __velarUrlNativeUriError("URI malformed");
      units += 12;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) throw new __velarUrlNativeUriError("URI malformed");
    else units += 9;
    if (units > maxUrlCodeUnits) return units;
  }
  return units;
}
function baseOf(base) { if (base !== "") return urlText(base, "URL base"); if (!__velarUrlLocationHrefDescriptor) return fallbackBase; const href = __velarUrlLocationHrefGetter ? __velarUrlCall(__velarUrlLocationHrefGetter, __velarUrlLocation, []) : __velarUrlLocationHrefData; return urlText(href, "Browser URL base"); }
function urlOf(value, base = "") { return new __velarUrlNativeUrl(urlText(value), baseOf(base)); }
function urlField(url, operation, name) { return urlText(__velarUrlCall(operation, url, []), name); }
function urlSnapshot(url) {
  const search = urlField(url, __velarUrlSearch, "URL query");
  return __velarUrlCall(__velarUrlObjectFreeze, __velarUrlNativeObject, [{
    href: urlField(url, __velarUrlHref, "URL href"), protocol: urlField(url, __velarUrlProtocol, "URL protocol"), host: urlField(url, __velarUrlHost, "URL host"),
    hostname: urlField(url, __velarUrlHostname, "URL hostname"), port: urlField(url, __velarUrlPort, "URL port"), path: urlField(url, __velarUrlPathname, "URL path"),
    query: queryMap(search, "URL query"), hash: urlField(url, __velarUrlHash, "URL hash"), origin: urlField(url, __velarUrlOrigin, "URL origin"),
  }]);
}
function joinedUrlOutput(parts) {
  let units = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.length > maxUrlCodeUnits - units) throw new __velarUrlNativeRangeError("URL output cannot exceed 2 MiB");
    units += part.length;
  }
  let output = "";
  for (let index = 0; index < parts.length; index += 1) output += parts[index];
  return output;
}
function restore(original, url) {
  const href = urlField(url, __velarUrlHref, "URL href"), host = urlField(url, __velarUrlHost, "URL host"), path = urlField(url, __velarUrlPathname, "URL path");
  const search = urlField(url, __velarUrlSearch, "URL query"), hash = urlField(url, __velarUrlHash, "URL hash");
  if (__velarUrlCall(__velarUrlRegExpTest, __velarUrlRegExpPattern, [original])) return href;
  return __velarUrlCall(__velarUrlStringStartsWith, original, ["//"]) ? joinedUrlOutput(["//", host, path, search, hash]) : joinedUrlOutput([path, search, hash]);
}
function nextEntry(iterator, operation, name) { const step = __velarUrlCall(operation, iterator, []); const done = ownData(step, "done", name + " iterator result"); if (typeof done !== "boolean") throw new __velarUrlNativeTypeError(name + " iterator must return a boolean done field"); if (done) return null; const pair = ownData(step, "value", name + " iterator result"); if (!__velarUrlCall(__velarListArrayIsArray, __velarListArray, [pair]) || pair.length !== 2) throw new __velarUrlNativeTypeError(name + " iterator must return key/value pairs"); return [ownData(pair, 0, name + " key"), ownData(pair, 1, name + " value")]; }
function queryMap(search, name) {
  search = urlText(search, name);
  const output = new __velarUrlNativeMap();
  const iterator = __velarUrlCall(__velarUrlSearchParamsEntries, new __velarUrlNativeSearchParams(search), []);
  let count = 0;
  let codeUnits = 0;
  while (true) {
    const entry = nextEntry(iterator, __velarUrlSearchIteratorNext, name);
    if (entry === null) break;
    const key = entry[0], value = entry[1];
    count += 1;
    if (count > 100000) throw new __velarUrlNativeRangeError(name + " cannot exceed 100000 fields");
    if (typeof key !== "string" || typeof value !== "string") throw new __velarUrlNativeTypeError(name + " must contain string fields");
    codeUnits += key.length + value.length;
    if (codeUnits > 2 * 1024 * 1024) throw new __velarUrlNativeRangeError(name + " cannot exceed 2 MiB");
    __velarUrlCall(__velarUrlMapSet, output, [key, value]);
  }
  return output;
}
function appendQueryValue(output, name, value, budget) {
  if (value == null) return;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new __velarUrlNativeTypeError("URL query value '" + name + "' must be a string, number, bool, null, or List of those values");
  if (typeof value === "number" && !__velarUrlCall(__velarUrlNumberIsFinite, __velarUrlNativeNumber, [value])) throw new __velarUrlNativeTypeError("URL query numbers must be finite");
  const text = __velarUrlCall(__velarUrlNativeString, undefined, [value]);
  budget.units += (name.length + text.length) * 9 + 2;
  if (budget.units > 2 * 1024 * 1024) throw new __velarUrlNativeRangeError("URL query output cannot exceed 2 MiB");
  __velarUrlCall(__velarUrlSearchParamsAppend, output, [name, text]);
}
function appendNamedValue(output, name, value, budget) { if (typeof name !== "string") throw new __velarUrlNativeTypeError("URL query names must be strings"); if (__velarUrlCall(__velarListArrayIsArray, __velarListArray, [value])) { const values = __velarRequireList(value, "URL query list"); for (let index = 0; index < values.length; index += 1) appendQueryValue(output, name, values[index], budget); } else appendQueryValue(output, name, value, budget); }
function appendParams(params, output) {
  let mapSize = null;
  try { mapSize = __velarUrlCall(__velarUrlMapSize, params, []); } catch {}
  const budget = { units: 0 };
  if (mapSize !== null) {
    if (mapSize > 100000) throw new __velarUrlNativeRangeError("URL query values cannot exceed 100000 fields");
    const iterator = __velarUrlCall(__velarUrlMapEntries, params, []);
    for (let index = 0; index < mapSize; index += 1) {
      const entry = nextEntry(iterator, __velarUrlMapIteratorNext, "URL query Map");
      if (entry === null) throw new __velarUrlNativeTypeError("URL query Map ended before its size");
      appendNamedValue(output, entry[0], entry[1], budget);
    }
    if (nextEntry(iterator, __velarUrlMapIteratorNext, "URL query Map") !== null) throw new __velarUrlNativeTypeError("URL query Map exceeded its size");
  } else if (params && typeof params === "object" && !__velarUrlCall(__velarListArrayIsArray, __velarListArray, [params])
    && (__velarUrlGetPrototypeOf(params) === __velarUrlObjectPrototype || __velarUrlGetPrototypeOf(params) === null)
    && __velarUrlGetOwnPropertySymbols(params).length === 0) {
    const names = __velarUrlGetOwnPropertyNames(params);
    if (names.length > 100000) throw new __velarUrlNativeRangeError("URL query values cannot exceed 100000 fields");
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const descriptor = __velarUrlGetOwnPropertyDescriptor(params, name);
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarUrlNativeTypeError("URL query record fields must be enumerable data values");
      appendNamedValue(output, name, descriptor.value, budget);
    }
  } else throw new __velarUrlNativeTypeError("URL query values require a Map or record");
}
export function parse(value, base = "") { return urlSnapshot(urlOf(value, base)); }
export function join(...parts) {
  if (!parts.length) throw new __velarUrlNativeRangeError("url.join requires at least one part");
  let output = urlText(parts[0], "url.join");
  for (let index = 1; index < parts.length; index += 1) {
    const value = urlText(parts[index], "url.join");
    if (!value) continue;
    let start = 0, end = value.length;
    while (start < end && value[start] === "/") start += 1;
    while (end > start && value[end - 1] === "/") end -= 1;
    const segment = __velarUrlCall(__velarUrlStringSlice, value, [start, end]);
    const scheme = __velarUrlCall(__velarUrlStringEndsWith, output, ["://"]);
    let prefixEnd = output.length;
    while (!scheme && prefixEnd > 0 && output[prefixEnd - 1] === "/") prefixEnd -= 1;
    const prefix = scheme ? output : __velarUrlCall(__velarUrlStringSlice, output, [0, prefixEnd]);
    const separator = scheme ? "" : "/";
    if (separator.length + segment.length > maxUrlCodeUnits - prefix.length) {
      throw new __velarUrlNativeRangeError("url.join output cannot exceed 2 MiB");
    }
    output = prefix + separator + segment;
  }
  return output;
}
export function query(params) { const output = new __velarUrlNativeSearchParams(); appendParams(params, output); return urlText(__velarUrlCall(__velarUrlSearchParamsToString, output, []), "URL query output"); }
export function parseQuery(value) { value = urlText(value, "parseQuery"); if (value[0] === "?") value = __velarUrlCall(__velarUrlStringSlice, value, [1]); return queryMap(value, "URL query"); }
export function withQuery(value, params) { const url = urlOf(value); const searchParams = new __velarUrlNativeSearchParams(); appendParams(params, searchParams); const search = urlText(__velarUrlCall(__velarUrlSearchParamsToString, searchParams, []), "URL query output"); __velarUrlCall(__velarUrlSetSearch, url, [search ? "?" + search : ""]); return restore(value, url); }
export function withHash(value, hash) { const url = urlOf(value); hash = urlText(hash, "withHash"); if (hash[0] === "#") hash = __velarUrlCall(__velarUrlStringSlice, hash, [1]); __velarUrlCall(__velarUrlSetHash, url, [hash ? "#" + hash : ""]); return restore(value, url); }
export function isExternal(value, base = "") { value = urlText(value, "isExternal"); if (base) urlText(base, "URL base"); try { const url = urlOf(value, base); const baseUrl = new __velarUrlNativeUrl(baseOf(base)); const origin = urlField(baseUrl, __velarUrlOrigin, "URL origin"); return urlField(url, __velarUrlOrigin, "URL origin") !== origin || !__velarUrlCall(__velarUrlRegExpTest, __velarUrlHttpPattern, [urlField(url, __velarUrlProtocol, "URL protocol")]); } catch { return true; } }
export function encode(value) { value = urlText(value, "encode"); if (encodedComponentUnits(value) > maxUrlCodeUnits) throw new __velarUrlNativeRangeError("encode output cannot exceed 2 MiB"); return urlText(__velarUrlCall(__velarUrlEncodeURIComponent, globalThis, [value]), "encode output"); }
export function decode(value) { return urlText(__velarUrlCall(__velarUrlDecodeURIComponent, globalThis, [urlText(value, "decode")]), "decode output"); }
export function normalize(value, base = "") { const url = urlOf(value, base); return restore(value, url); }
