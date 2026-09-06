const maxResponseChunks = 1000000;
let nextHandle = 1;
const secretHeaderValues = new WeakSet();
function parseJsonText(text) {
  return __velarJsonParse(text, "HTTP JSON text");
}
function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }
function methodOf(value) {
  if (typeof value !== "string") throw new TypeError("HTTP method must be text");
  const method = value.toUpperCase();
  if (method.length === 0 || method.length > 32 || !/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) {
    throw new TypeError("HTTP method is invalid or forbidden");
  }
  return method;
}
function urlOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024) throw new TypeError("HTTP URL must be bounded text");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("HTTP URL must use http or https");
  if (url.username || url.password) throw new TypeError("HTTP URL credentials are not allowed; use an Authorization header");
  return url.href;
}
export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError"; this.reason = reason;
  }
}
// D60 rule 149: a module-provided enum carries the same runtime face a declared
// enum does -- charter section 6 reserves is, parse, and values on every enum.
export const HttpTransportPhase = __velarRegisterRuntimeType(Object.freeze({
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
    if (typeof message !== "string") throw new TypeError("HTTP transport error message must be text");
    if (message.length === 0 || message.length > 65536) throw new RangeError("HTTP transport error messages must contain at most 64 KiB");
    if (phase !== HttpTransportPhase.request && phase !== HttpTransportPhase.response) {
      throw new TypeError("HTTP transport phase must be request or response");
    }
    super(message); this.name = "HttpTransportError"; this.phase = phase;
  }
}
export class HttpResponseError extends Error {
  constructor(message, status, url, body = null) {
    if (typeof message !== "string") throw new TypeError("HTTP error message must be text");
    if (message.length > 65536) throw new RangeError("HTTP error messages cannot exceed 64 KiB");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    if (typeof url !== "string") throw new TypeError("HTTP error URL must be text");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP error URLs cannot exceed 2 MiB");
    super(message); this.name = "HttpResponseError"; this.status = status; this.url = url; this.body = body;
  }
}
function headersOf(value) {
  if (value == null) return [];
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { throw new TypeError("HTTP headers must be Map<string, string>"); }
  if (size > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  const output = [];
  let units = 0;
  for (const pair of Map.prototype.entries.call(value)) {
    const name = pair[0]; const item = pair[1];
    if (typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("HTTP headers must use valid string names and single-line values");
    }
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
    output.push([name, item]);
  }
  return output;
}
function checkedHeaders(value) {
  if (value.length > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  let units = 0;
  for (const pair of value) {
    units += pair[0].length + pair[1].length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
  }
  return value;
}
const forbiddenSecretHeaders = new Set(["connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
export function secretHeader(name, environment, prefix = "") {
  if (typeof name !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || forbiddenSecretHeaders.has(name.toLowerCase())) {
    throw new TypeError("HTTP secret header name is invalid or transport-controlled");
  }
  if (typeof environment !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(environment)) {
    throw new TypeError("HTTP secret environment name must be uppercase ASCII text");
  }
  if (typeof prefix !== "string" || prefix.length > 256 || /[\r\n]/u.test(prefix)) {
    throw new TypeError("HTTP secret header prefix must be single-line text of at most 256 characters");
  }
  const value = Object.freeze({name, environment, prefix});
  secretHeaderValues.add(value);
  return value;
}
function secretHeadersOf(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("HTTP secretHeaders must be a List with at most 16 entries");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor) || !secretHeaderValues.has(descriptor.value)) {
      throw new TypeError("HTTP secretHeaders entries must be created by secretHeader");
    }
    output.push(descriptor.value);
  }
  return output;
}
function plainOptions(value) {
  if (value == null) return Object.create(null);
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("HTTP options must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("HTTP options must be a plain record");
  const allowed = new Set(["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError("HTTP options has an unknown field '" + String(key) + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("HTTP options fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function optionsOf(value, method) {
  const options = plainOptions(value);
  const timeout = options.timeout ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const headers = headersOf(options.headers);
  const secretHeaders = secretHeadersOf(options.secretHeaders);
  let body = options.body ?? null;
  if ((method === "GET" || method === "HEAD") && body !== null) throw new TypeError(method + " requests cannot have a body");
  if (body !== null && typeof body !== "string") {
    body = __velarJsonStringify(body);
    if (!headers.some(pair => pair[0].toLowerCase() === "content-type")) headers.push(["content-type", "application/json"]);
    checkedHeaders(headers);
  }
  if (typeof body === "string" && __velarUtf8ByteLength(body) > 16 * 1024 * 1024) throw new RangeError("HTTP body cannot exceed 16 MiB");
  return Object.freeze({headers, secretHeaders, body, timeout, maxBytes});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("http", operation, args, timeout);
}
function bridgeTransportError(error, phase) {
  if (!error || typeof error !== "object") return null;
  const name = Object.getOwnPropertyDescriptor(error, "name");
  const message = Object.getOwnPropertyDescriptor(error, "message");
  const actualPhase = Object.getOwnPropertyDescriptor(error, "phase");
  if (!name || !("value" in name) || name.value !== "VelarDesktopHttpTransportError"
    || !message || !("value" in message) || typeof message.value !== "string" || message.value.length === 0 || message.value.length > 65536
    || !actualPhase?.enumerable || !("value" in actualPhase) || actualPhase.value !== phase) return null;
  return new HttpTransportError(message.value, phase);
}
function responseOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop bridge returned an invalid HTTP response");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop bridge returned an invalid HTTP response");
  const allowed = new Set(["ok", "status", "statusText", "url", "headers", "body"]);
  const fields = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError("Desktop bridge returned an unknown HTTP response field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop bridge HTTP response fields must be enumerable data values");
    fields[key] = descriptor.value;
  }
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new TypeError("Desktop bridge HTTP response is missing field '" + key + "'");
  if (typeof fields.ok !== "boolean" || !Number.isInteger(fields.status) || fields.status < 100 || fields.status > 599
    || fields.ok !== (fields.status >= 200 && fields.status <= 299)) {
    throw new TypeError("Desktop bridge returned invalid HTTP response metadata");
  }
  if (typeof fields.statusText !== "string") throw new TypeError("HTTP response status text must be text");
  if (fields.statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
  if (typeof fields.url !== "string") throw new TypeError("HTTP response URL must be text");
  if (fields.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
  if (typeof fields.body !== "boolean") throw new TypeError("Desktop bridge HTTP response body marker must be boolean");
  if (!Array.isArray(fields.headers) || fields.headers.length > 100) throw new TypeError("Desktop bridge HTTP response headers must be a bounded List");
  const headers = new Map();
  let units = 0;
  for (let index = 0; index < fields.headers.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(fields.headers, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop bridge HTTP response headers must be dense data values");
    const pair = descriptor.value;
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError("Desktop bridge HTTP response headers must contain pairs");
    const nameDescriptor = Object.getOwnPropertyDescriptor(pair, "0");
    const valueDescriptor = Object.getOwnPropertyDescriptor(pair, "1");
    const name = nameDescriptor?.value;
    const item = valueDescriptor?.value;
    if (!nameDescriptor?.enumerable || !("value" in nameDescriptor) || !valueDescriptor?.enumerable || !("value" in valueDescriptor)
      || typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("Desktop bridge HTTP response headers are invalid");
    }
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP response headers cannot exceed 64 KiB");
    headers.set(name, item);
  }
  return Object.freeze({ok: fields.ok, status: fields.status, statusText: fields.statusText, url: fields.url, headers, body: fields.body});
}
function chunkOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("done") || !keys.includes("text")) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const done = Object.getOwnPropertyDescriptor(value, "done");
  const text = Object.getOwnPropertyDescriptor(value, "text");
  if (!done?.enumerable || !("value" in done) || !text?.enumerable || !("value" in text)
    || typeof done.value !== "boolean" || typeof text.value !== "string") {
    throw new TypeError("Desktop bridge HTTP chunks must contain boolean done and text data values");
  }
  return {done: done.value, text: text.value};
}
class DesktopResponse {
  constructor(response, request) {
    this.status = response.status; this.statusText = response.statusText; this.url = response.url;
    this.headers = response.headers; this.body = response.body; this.request = request; this.cachedText = null; this.textPending = null; this.consuming = false;
    if (!this.body) request.finish();
    Object.seal(this);
  }
  async consume(consumer) {
    if (this.cachedText !== null) {
      const result = await consumer(this.cachedText);
      if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      return null;
    }
    if (this.consuming) throw new Error("HTTP response body is already being consumed");
    this.consuming = true;
    let chunks = 0;
    try {
      if (!this.body) return null;
      while (true) {
        let wire;
        try { wire = await invoke("read", [this.request.handle], 0); }
        catch (error) {
          if (this.request.abortError) throw this.request.abortError;
          throw bridgeTransportError(error, HttpTransportPhase.response) ?? error;
        }
        const chunk = chunkOf(wire);
        if (!chunk.done) {
          chunks += 1;
          if (chunks > maxResponseChunks) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
        }
        if (chunk.text) {
          const result = await consumer(chunk.text);
          if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
        }
        if (chunk.done) break;
        if (this.request.abortError) throw this.request.abortError;
      }
      if (this.request.abortError) throw this.request.abortError;
      return null;
    } catch (error) {
      if (this.request.abortError) throw this.request.abortError;
      void invoke("cancel", [this.request.handle], 10000).catch(() => {});
      throw error;
    } finally {
      this.request.finish();
    }
  }
  async streamText(consumer) { if (typeof consumer !== "function") throw new TypeError("HTTP streamText requires an async consumer"); return this.consume(consumer); }
  async text() {
    if (this.cachedText !== null) return this.cachedText;
    if (this.textPending !== null) return this.textPending;
    const pending = (async () => {
      const chunks = [];
      await this.consume(async chunk => { chunks.push(chunk); return null; });
      return chunks.join("");
    })();
    this.textPending = pending;
    try {
      this.cachedText = await pending;
      return this.cachedText;
    } finally {
      if (this.textPending === pending) this.textPending = null;
    }
  }
  async json() { return parseJsonText(await this.text()); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
}
class DesktopRequest {
  constructor(method, url, options) {
    this.method = methodOf(method); this.url = urlOf(url); this.options = optionsOf(options, this.method); this.handle = nextHandle++; this.pending = null; this.timer = null; this.abortError = null; this.finished = false;
  }
  finish() { if (this.finished) return; this.finished = true; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void invoke("cancel", [this.handle], 10000).catch(() => {});
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    const timeout = this.options.timeout ?? 120000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
    if (timeout) this.timer = setTimeout(() => this.abort("timeout"), timeout);
    this.pending = (async () => {
      try {
        let value;
        try { value = await invoke("request", [this.handle, this.method, this.url, this.options], timeout === 0 ? 0 : Math.min(600000, timeout + 1000)); }
        catch (error) {
          if (this.abortError) throw this.abortError;
          throw bridgeTransportError(error, HttpTransportPhase.request) ?? error;
        }
        if (this.abortError) throw this.abortError;
        const snapshot = responseOf(value);
        const response = new DesktopResponse(snapshot, this);
        // D90 R20: the 2xx question is asked here and nowhere else. The
        // transport snapshot still carries ok; the response an author holds
        // does not, because by the time it is returned the answer is always
        // yes.
        if (!snapshot.ok) {
          const text = await response.text();
          let body = text;
          try { body = text ? parseJsonText(text) : null; } catch {}
          const errorUrl = response.url || this.url;
          throw new HttpResponseError("HTTP " + response.status + " for " + errorUrl, response.status, errorUrl, body);
        }
        return response;
      } catch (error) {
        if (!this.abortError && !this.finished) void invoke("cancel", [this.handle], 10000).catch(() => {});
        this.finish();
        if (this.abortError) throw this.abortError;
        throw error;
      }
    })();
    return this.pending;
  }
  async text() { return (await this.response()).text(); }
  async json() { return (await this.response()).json(); }
  async streamText(consumer) { return (await this.response()).streamText(consumer); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
  cancel() { this.abort("cancelled"); return null; }
}
const create = method => (url, options = {}) => new DesktopRequest(method, url, options);
export const http = Object.freeze({
  request(method, url, options = {}) { return new DesktopRequest(method, url, options); },
  get: create("GET"), post: create("POST"), put: create("PUT"), patch: create("PATCH"), delete: create("DELETE"), head: create("HEAD"),
});
