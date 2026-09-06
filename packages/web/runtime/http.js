const formBodies = new WeakMap();
const nativeFetch = typeof globalThis.fetch === "function" ? globalThis.fetch : null;
const NativeHeaders = typeof globalThis.Headers === "function" ? globalThis.Headers : null;
const NativeResponse = typeof globalThis.Response === "function" ? globalThis.Response : null;
const NativeAbortController = typeof globalThis.AbortController === "function" ? globalThis.AbortController : null;
const NativeFormData = typeof globalThis.FormData === "function" ? globalThis.FormData : null;
const NativeBlob = typeof globalThis.Blob === "function" ? globalThis.Blob : null;
const NativeTextDecoder = typeof globalThis.TextDecoder === "function" ? globalThis.TextDecoder : null;
const NativeUint8Array = typeof globalThis.Uint8Array === "function" ? globalThis.Uint8Array : null;
const NativeMap = typeof globalThis.Map === "function" ? globalThis.Map : null;
const nativeReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const nativeMapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const nativeMapGet = Object.getOwnPropertyDescriptor(Map.prototype, "get")?.value;
const nativeMapHas = Object.getOwnPropertyDescriptor(Map.prototype, "has")?.value;
const nativeMapSet = Object.getOwnPropertyDescriptor(Map.prototype, "set")?.value;
const nativeMapForEach = Object.getOwnPropertyDescriptor(Map.prototype, "forEach")?.value;
const nativeWeakMapGet = Object.getOwnPropertyDescriptor(WeakMap.prototype, "get")?.value;
const nativeWeakMapSet = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set")?.value;
const nativeHeadersSet = typeof NativeHeaders === "function" ? Object.getOwnPropertyDescriptor(NativeHeaders.prototype, "set")?.value : null;
const nativeHeadersHas = typeof NativeHeaders === "function" ? Object.getOwnPropertyDescriptor(NativeHeaders.prototype, "has")?.value : null;
const nativeHeadersForEach = typeof NativeHeaders === "function" ? Object.getOwnPropertyDescriptor(NativeHeaders.prototype, "forEach")?.value : null;
const nativeResponseOk = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "ok")?.get : null;
const nativeResponseStatus = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "status")?.get : null;
const nativeResponseStatusText = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "statusText")?.get : null;
const nativeResponseUrl = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "url")?.get : null;
const nativeResponseHeaders = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "headers")?.get : null;
const nativeResponseBody = typeof NativeResponse === "function" ? Object.getOwnPropertyDescriptor(NativeResponse.prototype, "body")?.get : null;
const nativeAbort = typeof NativeAbortController === "function" ? Object.getOwnPropertyDescriptor(NativeAbortController.prototype, "abort")?.value : null;
const nativeAbortSignal = typeof NativeAbortController === "function" ? Object.getOwnPropertyDescriptor(NativeAbortController.prototype, "signal")?.get : null;
const nativeFormAppend = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "append")?.value : null;
const nativeFormDelete = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "delete")?.value : null;
const nativeFormHas = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "has")?.value : null;
const nativeFormGetAll = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "getAll")?.value : null;
const nativeFormForEach = typeof NativeFormData === "function" ? Object.getOwnPropertyDescriptor(NativeFormData.prototype, "forEach")?.value : null;
const nativeTextDecode = typeof NativeTextDecoder === "function" ? Object.getOwnPropertyDescriptor(NativeTextDecoder.prototype, "decode")?.value : null;
const nativeSetTimeout = typeof globalThis.setTimeout === "function" ? globalThis.setTimeout : null;
const nativeClearTimeout = typeof globalThis.clearTimeout === "function" ? globalThis.clearTimeout : null;
const nativeStreamGetReader = typeof ReadableStream === "function" ? Object.getOwnPropertyDescriptor(ReadableStream.prototype, "getReader")?.value : null;
const nativeStreamCancel = typeof ReadableStream === "function" ? Object.getOwnPropertyDescriptor(ReadableStream.prototype, "cancel")?.value : null;
const nativeReaderRead = typeof ReadableStreamDefaultReader === "function" ? Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, "read")?.value : null;
const nativeReaderCancel = typeof ReadableStreamDefaultReader === "function" ? Object.getOwnPropertyDescriptor(ReadableStreamDefaultReader.prototype, "cancel")?.value : null;
const nativeTypedArrayPrototype = typeof NativeUint8Array === "function" ? Object.getPrototypeOf(NativeUint8Array.prototype) : null;
const nativeTypedArrayTag = nativeTypedArrayPrototype ? Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, Symbol.toStringTag)?.get : null;
const nativeTypedArrayByteLength = nativeTypedArrayPrototype ? Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, "byteLength")?.get : null;
const nativeUint8ArraySet = Object.getOwnPropertyDescriptor(nativeTypedArrayPrototype, "set")?.value;

function httpBytesKind(value) {
  if (typeof nativeReflectApply !== "function" || typeof nativeTypedArrayTag !== "function") return null;
  try { return nativeReflectApply(nativeTypedArrayTag, value, []); } catch { return null; }
}
const __velarHttpBytes = Object.freeze({
  is(value) { return httpBytesKind(value) === "Uint8Array"; },
  parse(value) {
    if (httpBytesKind(value) !== "Uint8Array" || typeof NativeUint8Array !== "function"
      || typeof nativeTypedArrayByteLength !== "function" || typeof nativeUint8ArraySet !== "function") {
      throw new TypeError("Bytes requires Uint8Array");
    }
    const output = new NativeUint8Array(nativeReflectApply(nativeTypedArrayByteLength, value, []));
    nativeReflectApply(nativeUint8ArraySet, output, [value]);
    return output;
  },
});

function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }

function requireHttpHost() {
  if (typeof nativeFetch !== "function" || typeof NativeHeaders !== "function" || typeof NativeResponse !== "function"
    || typeof NativeAbortController !== "function" || typeof NativeFormData !== "function" || typeof NativeBlob !== "function"
    || typeof NativeTextDecoder !== "function" || typeof NativeUint8Array !== "function" || typeof NativeMap !== "function"
    || typeof nativeReflectApply !== "function" || typeof nativeMapSize !== "function" || typeof nativeMapGet !== "function"
    || typeof nativeMapHas !== "function" || typeof nativeMapSet !== "function" || typeof nativeMapForEach !== "function"
    || typeof nativeWeakMapGet !== "function" || typeof nativeWeakMapSet !== "function" || typeof nativeHeadersSet !== "function"
    || typeof nativeHeadersHas !== "function" || typeof nativeHeadersForEach !== "function" || typeof nativeResponseOk !== "function"
    || typeof nativeResponseStatus !== "function" || typeof nativeResponseStatusText !== "function" || typeof nativeResponseUrl !== "function"
    || typeof nativeResponseHeaders !== "function" || typeof nativeResponseBody !== "function" || typeof nativeAbort !== "function"
    || typeof nativeAbortSignal !== "function"
    || typeof nativeFormAppend !== "function" || typeof nativeFormDelete !== "function" || typeof nativeFormHas !== "function"
    || typeof nativeFormGetAll !== "function" || typeof nativeFormForEach !== "function" || typeof nativeTextDecode !== "function"
    || typeof nativeSetTimeout !== "function" || typeof nativeClearTimeout !== "function") {
    throw new TypeError("The Web HTTP host ABI is unavailable");
  }
}

function headerMap(value) {
  requireHttpHost();
  const output = new NativeHeaders();
  nativeReflectApply(nativeMapForEach, value, [(item, name) => nativeReflectApply(nativeHeadersSet, output, [name, item])]);
  return output;
}

function methodOf(value) {
  const method = __velarString(value, "HTTP method").toUpperCase();
  if (method.length > 32) throw new RangeError("HTTP methods cannot exceed 32 characters");
  if (!/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) throw new TypeError("HTTP method is invalid or forbidden by Fetch");
  return method;
}

function headersOf(value) {
  if (value == null) { requireHttpHost(); return new NativeMap(); }
  try { requireHttpHost(); nativeReflectApply(nativeMapSize, value, []); }
  catch { throw new TypeError("HTTP headers must be Map<string, string>"); }
  const headers = new NativeMap();
  let units = 0;
  nativeReflectApply(nativeMapForEach, value, [(item, name) => {
    if (typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("HTTP headers must use valid string names and single-line values");
    }
    units += name.length + item.length;
    if ((!nativeReflectApply(nativeMapHas, headers, [name]) && nativeReflectApply(nativeMapSize, headers, []) >= 100) || units > 65536) throw new RangeError("HTTP headers cannot exceed 100 fields or 64 KiB");
    nativeReflectApply(nativeMapSet, headers, [name, item]);
  }]);
  return headers;
}

function responseHeadersOf(value) {
  requireHttpHost();
  const headers = new NativeMap();
  let units = 0;
  try {
    nativeReflectApply(nativeHeadersForEach, value, [(item, name) => {
      if (typeof name !== "string" || typeof item !== "string") throw new TypeError("HTTP response header names and values must be strings");
      units += name.length + item.length;
      if ((!nativeReflectApply(nativeMapHas, headers, [name]) && nativeReflectApply(nativeMapSize, headers, []) >= 100) || units > 65536) throw new RangeError("HTTP response headers cannot exceed 100 fields or 64 KiB");
      nativeReflectApply(nativeMapSet, headers, [name, item]);
    }]);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new TypeError("HTTP responses require native Headers");
  }
  return headers;
}

async function responseSnapshot(response) {
  let body = null;
  try {
    requireHttpHost();
    const ok = nativeReflectApply(nativeResponseOk, response, []);
    const status = nativeReflectApply(nativeResponseStatus, response, []);
    const statusText = __velarString(nativeReflectApply(nativeResponseStatusText, response, []), "HTTP response status text");
    const url = __velarString(nativeReflectApply(nativeResponseUrl, response, []), "HTTP response URL");
    const nativeHeaders = nativeReflectApply(nativeResponseHeaders, response, []);
    body = nativeReflectApply(nativeResponseBody, response, []);
    if (typeof ok !== "boolean" || !Number.isInteger(status) || status < 100 || status > 599
      || ok !== (status >= 200 && status <= 299)) {
      throw new TypeError("Fetch returned invalid HTTP response metadata");
    }
    if (statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
    return {ok, status, statusText, url, headers: responseHeadersOf(nativeHeaders), body};
  } catch (error) {
    if (body !== null && typeof nativeStreamCancel === "function") {
      try { await nativeReflectApply(nativeStreamCancel, body, [error]); } catch {}
    }
    throw error;
  }
}

function optionsOf(value) {
  value = __velarOptions(value, "HTTP options", __velarOptionFields(["headers", "body", "timeout", "maxBytes", "credentials", "cache"]));
  const timeout = value.timeout ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
  const maxBytes = value.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const credentials = value.credentials == null ? undefined : __velarString(value.credentials, "HTTP credentials");
  if (credentials !== undefined && !["omit", "same-origin", "include"].includes(credentials)) throw new TypeError("HTTP credentials must be omit, same-origin, or include");
  const cache = value.cache == null ? undefined : __velarString(value.cache, "HTTP cache mode");
  if (cache !== undefined && !["default", "no-store", "reload", "no-cache", "force-cache"].includes(cache)) throw new TypeError("HTTP cache mode must be default, no-store, reload, no-cache, or force-cache");
  let headers = headersOf(value.headers);
  let body = value.body ?? null;
  const multipart = body && typeof body === "object" ? nativeReflectApply(nativeWeakMapGet, formBodies, [body]) : null;
  const nativeForm = typeof NativeFormData === "function" && body instanceof NativeFormData;
  const nativeBlob = typeof NativeBlob === "function" && body instanceof NativeBlob;
  const bytes = body != null && __velarHttpBytes.is(body);
  if (bytes) body = __velarHttpBytes.parse(body);
  else if (body != null && typeof body !== "string" && !multipart && !nativeForm && !nativeBlob) {
    if (typeof body !== "object") throw new TypeError("HTTP body must be text, JSON data, a Blob, or a VelarScript form body");
    body = __velarJsonStringify(body);
    let hasContentType = false;
    nativeReflectApply(nativeMapForEach, headers, [(_item, name) => { if (name.toLowerCase() === "content-type") hasContentType = true; }]);
    if (!hasContentType) nativeReflectApply(nativeMapSet, headers, ["content-type", "application/json"]);
    headers = headersOf(headers);
  }
  if (typeof body === "string" && __velarUtf8ByteLength(body) > 16 * 1024 * 1024) throw new RangeError("HTTP body cannot exceed 16 MiB");
  return __velarFreezeOptionsValue({ headers, body, timeout, maxBytes, credentials, cache });
}

function fieldName(value) {
  const name = __velarString(value, "Form body field name");
  if (!name) throw new TypeError("Form body field names cannot be empty");
  if (name.length > 1024) throw new RangeError("Form body field names cannot exceed 1024 characters");
  return name;
}

function nativeFile(value) {
  return __velarNativeFile(value, "Form body files must come from velar/files pick()");
}

export function formBody() {
  requireHttpHost();
  const data = new NativeFormData();
  let fieldCount = 0;
  const reserve = (count = 1) => { if (fieldCount + count > 100000) throw new RangeError("Form bodies cannot exceed 100000 fields"); fieldCount += count; };
  const fieldValue = (value) => { value = __velarString(value, "Form body field value"); if (__velarUtf8ByteLength(value) > 16 * 1024 * 1024) throw new RangeError("Form body field values cannot exceed 16 MiB"); return value; };
  const body = {
    field(name, value) { name = fieldName(name); value = fieldValue(value); reserve(); nativeReflectApply(nativeFormAppend, data, [name, value]); return null; },
    file(name, value, fileName = "") {
      const file = nativeFile(value);
      fileName = __velarString(fileName, "Form body file name");
      if (fileName.length > 4096) throw new RangeError("Form body file names cannot exceed 4096 characters");
      name = fieldName(name);
      reserve();
      if (fileName) nativeReflectApply(nativeFormAppend, data, [name, file, fileName]);
      else nativeReflectApply(nativeFormAppend, data, [name, file]);
      return null;
    },
    files(name, values) {
      name = fieldName(name);
      const input = __velarRequireList(values, "Form body files");
      const files = new __velarListNativeArray(input.length);
      for (let index = 0; index < input.length; index += 1) {
        __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [files, index, {
          value: nativeFile(input[index]), enumerable: true, configurable: true, writable: true,
        }]);
      }
      reserve(files.length);
      for (let index = 0; index < files.length; index += 1) nativeReflectApply(nativeFormAppend, data, [name, files[index]]);
      return null;
    },
    remove(name) { name = fieldName(name); fieldCount -= nativeReflectApply(nativeFormGetAll, data, [name]).length; nativeReflectApply(nativeFormDelete, data, [name]); return null; },
    has(name) { return nativeReflectApply(nativeFormHas, data, [fieldName(name)]); },
    names() {
      const names = new __velarListNativeArray();
      const seen = new NativeMap();
      nativeReflectApply(nativeFormForEach, data, [(_value, name) => {
        if (nativeReflectApply(nativeMapHas, seen, [name])) return;
        const index = nativeReflectApply(nativeMapSize, seen, []);
        nativeReflectApply(nativeMapSet, seen, [name, true]);
        __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [names, index, {
          value: name, enumerable: true, configurable: true, writable: true,
        }]);
      }]);
      return names;
    },
  };
  nativeReflectApply(nativeWeakMapSet, formBodies, [body, data]);
  return __velarFreezeOptionsValue(body);
}

export class HttpResponseError extends Error {
  constructor(message, status, url, body = null) {
    message = __velarString(message, "HTTP error message");
    url = __velarString(url, "HTTP error URL");
    if (message.length > 65536) throw new RangeError("HTTP error messages cannot exceed 64 KiB");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP error URLs cannot exceed 2 MiB");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    super(message);
    this.name = "HttpResponseError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError";
    this.reason = reason;
  }
}

// D60 rule 149: a module-provided enum carries the same runtime face a declared
// enum does -- charter section 6 reserves is, parse, and values on every enum,
// and member access alone kept the gap invisible until a call threw.
export const HttpTransportPhase = __velarRegisterRuntimeType(__velarFreezeOptionsValue({
  request: "request",
  response: "response",
  is(value) { return value === "request" || value === "response"; },
  parse(value) {
    if (!HttpTransportPhase.is(value)) throw new TypeError("Value does not match HttpTransportPhase");
    return value;
  },
  values() { return ["request", "response"]; },
}));
export class HttpTransportError extends Error {
  constructor(message, phase) {
    message = __velarString(message, "HTTP transport error message");
    if (message.length === 0 || message.length > 65536) throw new RangeError("HTTP transport error messages must contain at most 64 KiB");
    if (phase !== HttpTransportPhase.request && phase !== HttpTransportPhase.response) {
      throw new TypeError("HTTP transport phase must be request or response");
    }
    super(message);
    this.name = "HttpTransportError";
    this.phase = phase;
  }
}

async function readHttpTransportChunk(reader) {
  try { return await nativeReflectApply(nativeReaderRead, reader, []); }
  catch { throw new HttpTransportError("HTTP response transport failed", HttpTransportPhase.response); }
}

class HttpResponse {
  constructor(response, request) {
    this.request = request;
    this.maxBytes = request.options.maxBytes;
    this.bytesValue = null;
    this.bytesPending = null;
    this.streaming = false;
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = response.url;
    this.headers = response.headers;
    this.body = response.body;
    this.declaredLength = nativeReflectApply(nativeMapGet, response.headers, ["content-length"]) ?? null;
    this.contentType = nativeReflectApply(nativeMapGet, response.headers, ["content-type"]) ?? "";
    if (response.body === null) request.finish();
  }
  async bytes() {
    if (this.bytesValue) return this.bytesValue;
    if (this.bytesPending) return this.bytesPending;
    const declared = __velarDeclaredLength(this.declaredLength);
    if (this.body !== null && declared !== null && declared > this.maxBytes) {
      if (this.body !== null && typeof nativeStreamCancel === "function") {
        try { await nativeReflectApply(nativeStreamCancel, this.body, ["VelarScript HTTP response exceeded maxBytes"]); } catch {}
      }
      this.request.finish();
      throw new RangeError("HTTP response exceeds maxBytes");
    }
    this.bytesPending = (async () => {
      if (this.body === null) return new NativeUint8Array();
      let reader = null;
      try {
        if (typeof nativeStreamGetReader !== "function" || typeof nativeReaderRead !== "function" || typeof nativeReaderCancel !== "function"
          || typeof nativeTypedArrayTag !== "function" || typeof nativeTypedArrayByteLength !== "function" || typeof nativeUint8ArraySet !== "function") {
          throw new TypeError("The browser does not expose the required native response stream API");
        }
        try { reader = nativeReflectApply(nativeStreamGetReader, this.body, []); }
        catch { throw new TypeError("Fetch returned an invalid HTTP response body"); }
        const chunks = new __velarListNativeArray();
        let total = 0;
        while (true) {
          const next = await readHttpTransportChunk(reader);
          if (next.done) break;
          let kind;
          let length;
          try {
            kind = nativeReflectApply(nativeTypedArrayTag, next.value, []);
            length = nativeReflectApply(nativeTypedArrayByteLength, next.value, []);
          } catch { throw new TypeError("Fetch returned a non-byte response chunk"); }
          if (kind !== "Uint8Array") throw new TypeError("Fetch returned a non-byte response chunk");
          total += length;
          if (total > this.maxBytes) throw new RangeError("HTTP response exceeds maxBytes");
          if (chunks.length >= 1000000) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
          const chunk = new NativeUint8Array(length);
          nativeReflectApply(nativeUint8ArraySet, chunk, [next.value]);
          __velarListReflectApply(__velarListDefineProperty, __velarListNativeObject, [chunks, chunks.length, {
            value: chunk, enumerable: true, configurable: true, writable: true,
          }]);
        }
        const output = new NativeUint8Array(total);
        let offset = 0;
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          nativeReflectApply(nativeUint8ArraySet, output, [chunk, offset]);
          offset += nativeReflectApply(nativeTypedArrayByteLength, chunk, []);
        }
        return __velarHttpBytes.parse(output);
      } catch (error) {
        if (reader !== null) {
          try { await nativeReflectApply(nativeReaderCancel, reader, [error]); } catch {}
        } else if (typeof nativeStreamCancel === "function") {
          try { await nativeReflectApply(nativeStreamCancel, this.body, [error]); } catch {}
        }
        throw error;
      }
    })();
    try { this.bytesValue = await this.bytesPending; return this.bytesValue; }
    catch (error) { if (this.request.abortError) throw this.request.abortError; throw error; }
    finally { this.bytesPending = null; this.request.finish(); }
  }
  async json() { return __velarJsonParse(await this.text(), "HTTP JSON text"); }
  async text() { const decoder = new NativeTextDecoder("utf-8", { fatal: true }); return nativeReflectApply(nativeTextDecode, decoder, [await this.bytes()]); }
  async streamText(consume) {
    if (typeof consume !== "function") throw new TypeError("HTTP streamText requires an async consumer");
    if (this.bytesValue) {
      const decoder = new NativeTextDecoder("utf-8", { fatal: true });
      const result = await consume(nativeReflectApply(nativeTextDecode, decoder, [this.bytesValue]));
      if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      return null;
    }
    if (this.bytesPending || this.streaming) throw new Error("HTTP response body is already being consumed");
    if (this.body === null) return null;
    const declared = __velarDeclaredLength(this.declaredLength);
    if (declared !== null && declared > this.maxBytes) {
      if (typeof nativeStreamCancel === "function") {
        try { await nativeReflectApply(nativeStreamCancel, this.body, ["VelarScript HTTP response exceeded maxBytes"]); } catch {}
      }
      this.request.finish();
      throw new RangeError("HTTP response exceeds maxBytes");
    }
    if (typeof nativeStreamGetReader !== "function" || typeof nativeReaderRead !== "function" || typeof nativeReaderCancel !== "function"
      || typeof nativeTypedArrayTag !== "function" || typeof nativeTypedArrayByteLength !== "function") {
      this.request.finish();
      throw new TypeError("The browser does not expose the required native response stream API");
    }
    this.streaming = true;
    let reader;
    try { reader = nativeReflectApply(nativeStreamGetReader, this.body, []); }
    catch { this.request.finish(); throw new TypeError("Fetch returned an invalid HTTP response body"); }
    const decoder = new NativeTextDecoder("utf-8", { fatal: true });
    let total = 0;
    let chunks = 0;
    try {
      while (true) {
        const next = await readHttpTransportChunk(reader);
        if (next.done) break;
        let kind;
        let length;
        try { kind = nativeReflectApply(nativeTypedArrayTag, next.value, []); length = nativeReflectApply(nativeTypedArrayByteLength, next.value, []); }
        catch { throw new TypeError("Fetch returned a non-byte response chunk"); }
        if (kind !== "Uint8Array") throw new TypeError("Fetch returned a non-byte response chunk");
        total += length;
        chunks += 1;
        if (total > this.maxBytes || chunks > 1000000) {
          try { await nativeReflectApply(nativeReaderCancel, reader, ["VelarScript HTTP response exceeded its bound"]); } catch {}
          throw new RangeError(total > this.maxBytes ? "HTTP response exceeds maxBytes" : "HTTP responses cannot exceed 1000000 chunks");
        }
        const text = nativeReflectApply(nativeTextDecode, decoder, [next.value, { stream: true }]);
        if (text) {
          const result = await consume(text);
          if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
        }
        if (this.request.abortError) throw this.request.abortError;
      }
      const tail = nativeReflectApply(nativeTextDecode, decoder, []);
      if (tail) {
        const result = await consume(tail);
        if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      }
      if (this.request.abortError) throw this.request.abortError;
      return null;
    } catch (error) {
      if (this.request.abortError) throw this.request.abortError;
      try { await nativeReflectApply(nativeReaderCancel, reader, [error]); } catch {}
      throw error;
    } finally {
      this.request.finish();
    }
  }
  async blob() { return new NativeBlob([await this.bytes()], { type: this.contentType }); }
  async parse(Type) { Type = runtimeHttpType(Type); return __velarJsonParseTyped(Type, await this.text(), "HTTP JSON text"); }
}

class Request {
  constructor(method, url, options) {
    this.method = methodOf(method);
    this.url = __velarString(url, "HTTP URL");
    if (this.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP URLs cannot exceed 2 MiB");
    this.options = optionsOf(options);
    if ((this.method === "GET" || this.method === "HEAD") && this.options.body != null) throw new TypeError(this.method + " requests cannot have a body");
    this.controller = null;
    this.pending = null;
    this.abortError = null;
    this.finished = false;
    this.timer = null;
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    requireHttpHost();
    this.controller = new NativeAbortController();
    const timeoutMs = this.options.timeout;
    this.timer = timeoutMs ? nativeReflectApply(nativeSetTimeout, globalThis, [() => this.abort("timeout"), timeoutMs]) : null;
    this.pending = this.perform(this.controller);
    return this.pending;
  }
  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) { nativeReflectApply(nativeClearTimeout, globalThis, [this.timer]); this.timer = null; }
  }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.timer) { nativeReflectApply(nativeClearTimeout, globalThis, [this.timer]); this.timer = null; }
    if (this.controller) nativeReflectApply(nativeAbort, this.controller, [this.abortError]);
  }
  async perform(controller) {
    try {
      const headers = headerMap(this.options.headers);
      let body = this.options.body;
      const multipart = body != null && typeof body === "object" ? nativeReflectApply(nativeWeakMapGet, formBodies, [body]) : null;
      if (multipart instanceof NativeFormData) {
        if (nativeReflectApply(nativeHeadersHas, headers, ["content-type"])) throw new TypeError("Do not set content-type for a VelarScript form body; the browser owns its multipart boundary");
        body = multipart;
      }
      const signal = nativeReflectApply(nativeAbortSignal, controller, []);
      let transportResponse;
      try {
        transportResponse = await nativeReflectApply(nativeFetch, globalThis, [this.url, {
          method: this.method,
          headers,
          body,
          credentials: this.options.credentials,
          cache: this.options.cache,
          signal,
        }]);
      } catch {
        if (this.abortError) throw this.abortError;
        throw new HttpTransportError("HTTP request transport failed", HttpTransportPhase.request);
      }
      const response = await responseSnapshot(transportResponse);
      if (this.abortError) throw this.abortError;
      const wrapped = new HttpResponse(response, this);
      // D90 R20: the 2xx question is asked here and nowhere else. The
      // transport snapshot still carries ok; the response an author holds does
      // not, because by the time it is returned the answer is always yes.
      if (!response.ok) {
        const text = await wrapped.text();
        let parsed = text;
        try { parsed = text ? __velarJsonParse(text, "HTTP error JSON text") : null; } catch { parsed = text; }
        const errorUrl = wrapped.url || this.url;
        throw new HttpResponseError("HTTP " + wrapped.status + " for " + errorUrl, wrapped.status, errorUrl, parsed);
      }
      return wrapped;
    } catch (error) {
      this.finish();
      if (this.abortError) throw this.abortError;
      throw error;
    }
  }
  async json() { return (await this.response()).json(); }
  async text() { return (await this.response()).text(); }
  async bytes() { return (await this.response()).bytes(); }
  async streamText(consume) { return (await this.response()).streamText(consume); }
  async blob() { return (await this.response()).blob(); }
  async parse(Type) { Type = runtimeHttpType(Type); return (await this.response()).parse(Type); }
  cancel() { this.abort("cancelled"); return null; }
}

const createRequest = (method) => (url, options = {}) => new Request(method, url, options);
export const http = __velarFreezeOptionsValue({
  request(method, url, options = {}) { return new Request(method, url, options); },
  get: createRequest("GET"), post: createRequest("POST"), put: createRequest("PUT"), patch: createRequest("PATCH"), delete: createRequest("DELETE"), head: createRequest("HEAD"),
});
