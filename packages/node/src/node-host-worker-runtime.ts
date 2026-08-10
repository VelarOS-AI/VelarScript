// Privileged Node transport shared by official Node standard modules. This
// worker loads only compiler-owned source and static Node built-ins; VelarScript
// application code and npm dependencies remain in the application Realm.
export const VELAR_NODE_HOST_WORKER_SOURCE = String.raw`
import { Buffer } from "node:buffer";
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request as createHttpRequest } from "node:http";
import { request as createHttpsRequest } from "node:https";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { URL as NodeURL } from "node:url";
import { workerData } from "node:worker_threads";

const port = workerData;
const maxFileBytes = 16 * 1024 * 1024;
const maxListItems = 100000;
const maxListCodeUnits = 2 * 1024 * 1024;
const maxPathCodeUnits = 4096;
const maxServeBodyBytes = 16 * 1024 * 1024;
const maxServeFileBytes = 64 * 1024 * 1024;
const maxServeStreamBytes = 64 * 1024 * 1024;
const maxServeStreamChunkBytes = 1024 * 1024;
const maxServeAggregateBytes = 128 * 1024 * 1024;
const maxHttpBodyBytes = 16 * 1024 * 1024;
const maxHttpResponseBytes = 64 * 1024 * 1024;
const maxHttpResponseChunks = 1000000;
const maxHttpRequests = 1024;
const maxServers = 128;
const maxRequests = 4096;
const operations = new Set([
  "fs.readFile", "fs.createFile", "fs.writeFile", "fs.appendFile", "fs.exists", "fs.list", "fs.info",
  "fs.canonical", "fs.makeDirectory", "fs.copyFile", "fs.move", "fs.removeFile",
  "http.request", "http.read", "http.cancel", "http.close",
  "serve.start", "serve.stop", "serve.body", "serve.respond", "serve.respondFile",
  "serve.streamStart", "serve.streamWrite", "serve.streamEnd", "serve.fail",
]);
const servers = new Map();
const requests = new Map();
const httpRequests = new Map();
let nextServerHandle = 1;
let nextRequestHandle = 1;
let reservedServeBytes = 0;
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
});

class StaticNotFound extends Error {}

function allocateHandle(values, next, maximum, name) {
  let candidate = next;
  for (let attempts = 0; attempts <= maximum; attempts += 1) {
    if (!values.has(candidate)) return candidate;
    candidate = candidate >= Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
  }
  throw new RangeError(name + " handle space is unavailable");
}

function advanceHandle(handle) {
  return handle >= Number.MAX_SAFE_INTEGER ? 1 : handle + 1;
}

function reserveServeBytes(task, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || reservedServeBytes + bytes > maxServeAggregateBytes) {
    throw new RangeError("Node serve aggregate byte budget is exhausted");
  }
  reservedServeBytes += bytes;
  task.reservedBytes += bytes;
}

function releaseServeBytes(task, bytes = task.reservedBytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > task.reservedBytes || bytes > reservedServeBytes) {
    throw new Error("Node serve byte ownership is invalid");
  }
  task.reservedBytes -= bytes;
  reservedServeBytes -= bytes;
}

function reserveTransientServeBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || reservedServeBytes + bytes > maxServeAggregateBytes) {
    throw new RangeError("Node serve aggregate byte budget is exhausted");
  }
  reservedServeBytes += bytes;
}

function releaseTransientServeBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > reservedServeBytes) {
    throw new Error("Node serve transient byte ownership is invalid");
  }
  reservedServeBytes -= bytes;
}

function cleanupRequest(task) {
  if (!task.transportDone || task.activeOperations !== 0 || !requests.delete(task.handle)) return;
  releaseServeBytes(task);
}

function closeRequest(task) {
  task.transportDone = true;
  cleanupRequest(task);
}

async function withRequest(task, action) {
  task.activeOperations += 1;
  try { return await action(); }
  finally {
    task.activeOperations -= 1;
    cleanupRequest(task);
  }
}

function completeRequest(task) {
  if (task.completed) throw new Error("Node serve request is already completed");
  task.completed = true;
}

function boundedPath(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || value.includes("\0")) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}

function byteLimit(value, operation) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileBytes) {
    throw new RangeError(operation + " maxBytes must be an integer from 1 through 16777216");
  }
  return value;
}

function boolean(value, operation) {
  if (typeof value !== "boolean") throw new TypeError(operation + " replace must be bool");
  return value;
}

function byteArray(value, operation) {
  if (!(value instanceof Uint8Array)) throw new TypeError(operation + " requires UTF-8 bytes");
  if (value.byteLength > maxFileBytes) throw new RangeError(operation + " cannot write more than 16 MiB");
  return value;
}

function missing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

async function regularFile(path, operation, maxBytes) {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new TypeError(operation + " requires a file path");
  if (metadata.size > maxBytes) throw new RangeError(operation + " file exceeds maxBytes");
  const data = await readFile(path);
  if (data.byteLength > maxBytes) throw new RangeError(operation + " file exceeds maxBytes");
  return data;
}

async function absent(path, operation) {
  try { await lstat(path); }
  catch (error) { if (missing(error)) return; throw error; }
  throw new Error(operation + " target already exists");
}

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(name + " must be an integer from " + minimum + " through " + maximum);
  }
  return value;
}

const httpMethodPattern = /^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u;
const httpHeaderNamePattern = /^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u;
const httpLineBreakPattern = /[\r\n]/u;
const forbiddenHttpSecretHeaders = new Set([
  "connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade",
]);

function httpMethod(value) {
  if (typeof value !== "string") throw new TypeError("HTTP method must be text");
  const method = value.toUpperCase();
  if (method.length === 0 || method.length > 32 || !httpMethodPattern.test(method)
    || method === "CONNECT" || method === "TRACE" || method === "TRACK") {
    throw new TypeError("HTTP method is invalid or forbidden");
  }
  return method;
}

function httpUrl(value, base = undefined) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024) {
    throw new TypeError("HTTP URL must be bounded text");
  }
  let url;
  try { url = base === undefined ? new NodeURL(value) : new NodeURL(value, base); }
  catch { throw new TypeError("HTTP URL must be absolute"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("HTTP URL must use http or https");
  if (url.username || url.password) throw new TypeError("HTTP URL credentials are not allowed; use an Authorization header");
  return url;
}

function httpHeaderRecord(value) {
  if (!Array.isArray(value) || value.length > 100) throw new TypeError("HTTP headers must be bounded pairs");
  const headers = Object.create(null);
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const pair = value[index];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string"
      || !httpHeaderNamePattern.test(pair[0]) || httpLineBreakPattern.test(pair[1])) {
      throw new TypeError("HTTP headers must use valid string names and single-line values");
    }
    units += pair[0].length + pair[1].length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
    headers[pair[0].toLowerCase()] = pair[1];
  }
  return headers;
}

function applyHttpSecrets(value, headers) {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("HTTP secretHeaders must be a List with at most 16 entries");
  const names = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).length !== 2 || typeof item.name !== "string" || !httpHeaderNamePattern.test(item.name)
      || typeof item.value !== "string" || httpLineBreakPattern.test(item.value) || Buffer.byteLength(item.value, "utf8") > 65536) {
      throw new TypeError("HTTP secret header descriptor is invalid");
    }
    const lower = item.name.toLowerCase();
    if (forbiddenHttpSecretHeaders.has(lower)) throw new TypeError("HTTP secret header name is transport-controlled");
    if (Object.hasOwn(headers, lower) || names.has(lower)) throw new TypeError("HTTP secret header conflicts with another header");
    headers[lower] = item.value;
    names.add(lower);
  }
  const headerNames = Object.keys(headers);
  if (headerNames.length > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  let units = 0;
  for (let index = 0; index < headerNames.length; index += 1) {
    const name = headerNames[index];
    units += name.length + headers[name].length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
  }
  return names;
}

function httpResponseHeaders(response) {
  if (!Array.isArray(response.rawHeaders) || response.rawHeaders.length % 2 !== 0) {
    throw new TypeError("Node HTTP returned invalid response headers");
  }
  const headers = new Map();
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (typeof name !== "string" || typeof value !== "string" || !httpHeaderNamePattern.test(name)) {
      throw new TypeError("Node HTTP returned invalid response headers");
    }
    const lower = name.toLowerCase();
    headers.set(lower, headers.has(lower) ? headers.get(lower) + ", " + value : value);
  }
  if (headers.size > 100) throw new RangeError("HTTP response headers cannot exceed 100 fields");
  const output = [];
  let units = 0;
  for (const [name, value] of headers) {
    units += name.length + value.length;
    if (units > 65536) throw new RangeError("HTTP response headers cannot exceed 64 KiB");
    output.push([name, value]);
  }
  return output;
}

class HttpTransportFailure extends Error {
  constructor(phase) {
    super(phase === "request" ? "HTTP request transport failed" : "HTTP response transport failed");
    this.name = "HttpTransportError";
    this.phase = phase;
  }
}

function requestHttpHop(task, url, method, headers, body) {
  return new Promise((resolveResponse, rejectResponse) => {
    const createRequest = url.protocol === "https:" ? createHttpsRequest : createHttpRequest;
    let settled = false;
    const finish = action => { if (settled) return; settled = true; action(); };
    const request = createRequest(url, {method, headers}, response => finish(() => resolveResponse(response)));
    task.request = request;
    request.once("error", () => finish(() => rejectResponse(new HttpTransportFailure("request"))));
    if (task.cancelled) request.destroy(new Error("HTTP request cancelled"));
    else if (body === null) request.end();
    else request.end(body);
  });
}

function releaseHttpRequest(task, reason = null) {
  if (!httpRequests.delete(task.handle)) return false;
  task.cancelled = reason !== null;
  const error = reason === null ? null : new Error(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
  if (task.request && !task.request.destroyed && error) task.request.destroy(error);
  if (task.response && !task.response.destroyed && !task.ended) task.response.destroy(error ?? undefined);
  return true;
}

async function startHttpRequest(args) {
  if (args.length !== 7) throw new TypeError("http.request arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node HTTP request handle");
  if (httpRequests.size >= maxHttpRequests) throw new RangeError("Node HTTP cannot have more than 1024 active requests");
  if (httpRequests.has(handle)) throw new Error("Node HTTP request handle is already active");
  let method = httpMethod(args[1]);
  let url = httpUrl(args[2]);
  let headers = httpHeaderRecord(args[3]);
  const secretHeaderNames = applyHttpSecrets(args[4], headers);
  let body = args[5];
  if (body !== null && typeof body !== "string") throw new TypeError("HTTP body must be validated text");
  if (body !== null && Buffer.byteLength(body, "utf8") > maxHttpBodyBytes) throw new RangeError("HTTP body cannot exceed 16 MiB");
  if ((method === "GET" || method === "HEAD") && body !== null) throw new TypeError(method + " requests cannot have a body");
  const maxBytes = integer(args[6], 1, maxHttpResponseBytes, "HTTP maxBytes");
  const task = {
    handle, request: null, response: null, iterator: null, decoder: new TextDecoder("utf-8", {fatal: true}),
    maxBytes, bytes: 0, chunks: 0, reading: false, ended: false, cancelled: false,
  };
  httpRequests.set(handle, task);
  try {
    for (let redirects = 0; ; redirects += 1) {
      if (task.cancelled) throw new Error("HTTP request cancelled");
      const response = await requestHttpHop(task, url, method, headers, body);
      task.request = null;
      if (task.cancelled) { response.destroy(); throw new Error("HTTP request cancelled"); }
      const status = response.statusCode;
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        response.destroy();
        throw new TypeError("Node HTTP returned invalid response status");
      }
      const location = response.headers.location;
      const redirected = status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
      if (!redirected || typeof location !== "string") {
        const statusText = response.statusMessage ?? "";
        if (typeof statusText !== "string" || statusText.length > 65536) {
          response.destroy();
          throw new RangeError("HTTP response status text cannot exceed 64 KiB");
        }
        const responseHeaders = httpResponseHeaders(response);
        const hasBody = method !== "HEAD" && status !== 101 && status !== 103 && status !== 204 && status !== 205 && status !== 304;
        if (!hasBody) {
          task.ended = true;
          response.resume();
          httpRequests.delete(handle);
        } else {
          task.response = response;
          task.iterator = response[Symbol.asyncIterator]();
        }
        return {handle, ok: status >= 200 && status <= 299, status, statusText, url: url.href, headers: responseHeaders, body: hasBody};
      }
      if (redirects >= 20) {
        response.destroy();
        throw new Error("HTTP redirect limit of 20 was exceeded");
      }
      let nextUrl;
      try { nextUrl = httpUrl(location, url.href); }
      finally { response.destroy(); }
      if (nextUrl.origin !== url.origin) {
        headers = {...headers};
        delete headers.authorization;
        delete headers["proxy-authorization"];
        delete headers.cookie;
        delete headers.cookie2;
        for (const name of secretHeaderNames) delete headers[name];
      }
      if (status === 303 && method !== "HEAD" || (status === 301 || status === 302) && method === "POST") {
        method = "GET";
        body = null;
        headers = {...headers};
        delete headers["content-encoding"];
        delete headers["content-language"];
        delete headers["content-location"];
        delete headers["content-type"];
        delete headers["content-length"];
      }
      url = nextUrl;
    }
  } catch (error) {
    releaseHttpRequest(task, null);
    throw error;
  }
}

async function readHttpRequest(args) {
  if (args.length !== 1) throw new TypeError("http.read arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node HTTP request handle");
  const task = httpRequests.get(handle);
  if (!task || task.ended || !task.iterator) throw new Error("Node HTTP request is unknown or already completed");
  if (task.reading) throw new Error("Node HTTP allows only one active body read");
  task.reading = true;
  try {
    let next;
    try { next = await task.iterator.next(); }
    catch { throw new HttpTransportFailure("response"); }
    if (!next || typeof next !== "object" || typeof next.done !== "boolean") throw new TypeError("Node HTTP returned an invalid response stream result");
    if (next.done) {
      task.ended = true;
      return {done: true, text: task.decoder.decode()};
    }
    if (!(next.value instanceof Uint8Array)) throw new TypeError("Node HTTP returned a non-byte response chunk");
    task.bytes += next.value.byteLength;
    task.chunks += 1;
    if (task.bytes > task.maxBytes) throw new RangeError("HTTP response exceeds maxBytes");
    if (task.chunks > maxHttpResponseChunks) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
    return {done: false, text: task.decoder.decode(next.value, {stream: true})};
  } finally {
    task.reading = false;
  }
}

function boundedHost(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || value.includes("\0")) {
    throw new TypeError("serve host must be bounded text");
  }
  return value;
}

function requestHandle(value) {
  const handle = integer(value, 1, Number.MAX_SAFE_INTEGER, "Node serve request handle");
  const request = requests.get(handle);
  if (!request || request.completed || request.transportDone) throw new Error("Node serve request is unknown or already completed");
  return request;
}

function headerPairs(value) {
  if (!Array.isArray(value) || value.length > 1000) throw new TypeError("ServeResponse headers must be bounded pairs");
  const output = [];
  let units = 0;
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== "string" || typeof item[1] !== "string"
      || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(item[0]) || /[\0\r\n]/u.test(item[1])) {
      throw new TypeError("ServeResponse headers must use valid HTTP names and single-line values");
    }
    const lower = item[0].toLowerCase();
    if (lower === "content-length" || lower === "transfer-encoding" || lower === "connection") {
      throw new TypeError("ServeResponse cannot set transport-owned header '" + item[0] + "'");
    }
    units += item[0].length + item[1].length;
    if (units > 1024 * 1024) throw new RangeError("ServeResponse headers cannot exceed 1 MiB of text");
    output.push(item);
  }
  return output;
}

function setHeaders(response, values) {
  for (const [name, value] of headerPairs(values)) response.setHeader(name, value);
}

function requestPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxPathCodeUnits || value.includes("\0") || value.includes("\\")) {
    throw new StaticNotFound();
  }
  const source = value.startsWith("/") ? value : "/" + value;
  const segments = source.split("/").filter(Boolean);
  if (segments.some(segment => segment === "." || segment === "..")) throw new StaticNotFound();
  return segments.join("/");
}

function inside(root, target) {
  const path = relative(root, target);
  return path === "" || !path.startsWith("..") && !isAbsolute(path);
}

async function staticFile(task, rootValue, pathValue, fallbackValue) {
  const root = await realpath(resolve(boundedPath(rootValue, "fileResponse")));
  const relativePath = requestPath(pathValue);
  const fallback = fallbackValue === null ? null : requestPath(fallbackValue);
  const load = async path => {
    const target = await realpath(resolve(root, path));
    if (!inside(root, target)) throw new StaticNotFound();
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > maxServeFileBytes) throw new StaticNotFound();
    reserveServeBytes(task, metadata.size);
    let reserved = metadata.size;
    try {
      const data = await readFile(target);
      if (data.byteLength > maxServeFileBytes) throw new StaticNotFound();
      if (data.byteLength > reserved) reserveServeBytes(task, data.byteLength - reserved);
      else if (data.byteLength < reserved) releaseServeBytes(task, reserved - data.byteLength);
      reserved = data.byteLength;
      return {data, contentType: contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream"};
    } catch (error) {
      releaseServeBytes(task, reserved);
      throw error;
    }
  };
  try { return await load(relativePath); }
  catch (error) {
    if ((error instanceof StaticNotFound || missing(error) || error?.code === "EISDIR") && fallback !== null) return load(fallback);
    throw error;
  }
}

function opaqueFailure(task) {
  if (task.response.headersSent) task.response.destroy();
  else {
    task.response.statusCode = 500;
    task.response.setHeader("Content-Type", "text/plain; charset=utf-8");
    task.response.end("Internal server error");
  }
  completeRequest(task);
}

function bodyOf(task) {
  if (task.body !== null) return task.body;
  task.body = (async () => {
    const declaredText = task.request.headers["content-length"];
    if (typeof declaredText === "string" && /^[0-9]+$/u.test(declaredText)) {
      const declared = Number(declaredText);
      if (!Number.isSafeInteger(declared) || declared > maxServeBodyBytes) {
        task.request.resume();
        throw new RangeError("Request body cannot exceed 16 MiB");
      }
    }
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of task.request) {
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if (total + data.byteLength > maxServeBodyBytes) {
          task.request.resume();
          throw new RangeError("Request body cannot exceed 16 MiB");
        }
        reserveServeBytes(task, data.byteLength);
        total += data.byteLength;
        chunks.push(data);
      }
      try { return {text: new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks, total)), bytes: total}; }
      catch { throw new TypeError("Request body must be valid UTF-8 text"); }
    } catch (error) {
      releaseServeBytes(task, total);
      throw error;
    }
  })();
  return task.body;
}

function incomingRequest(server, request, response) {
  if (requests.size >= maxRequests) { response.statusCode = 503; response.end("Service unavailable"); return; }
  const target = request.url ?? "/";
  if (typeof target !== "string" || target.length === 0 || target.length > 2 * 1024 * 1024 || target.includes("\0")) {
    response.statusCode = 400; response.end("Bad request"); return;
  }
  let url;
  let path;
  try {
    url = new URL(target, "http://velar.invalid");
    path = decodeURIComponent(url.pathname);
  } catch { response.statusCode = 400; response.end("Bad request"); return; }
  if (path.length === 0 || path.length > maxPathCodeUnits || path.includes("\0")) {
    response.statusCode = 414; response.end("Request target too long"); return;
  }
  const headers = [];
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.push([name, value]);
    else if (Array.isArray(value)) headers.push([name, value.join(", ")]);
  }
  const query = [];
  for (const [name, value] of url.searchParams) if (!query.some(item => item[0] === name)) query.push([name, value]);
  const handle = allocateHandle(requests, nextRequestHandle, maxRequests, "Node serve request");
  nextRequestHandle = advanceHandle(handle);
  const task = {
    handle, server: server.handle, request, response, body: null, streamBytes: 0, streaming: false,
    reservedBytes: 0, completed: false, transportDone: false, activeOperations: 0,
  };
  requests.set(handle, task);
  response.once("finish", () => closeRequest(task));
  response.once("close", () => closeRequest(task));
  port.postMessage({kind: "event", event: "serve.request", value: {
    token: server.token,
    request: handle,
    method: request.method ?? "GET",
    path,
    query,
    headers,
  }});
}

async function startServer(args) {
  if (args.length !== 3 || servers.size >= maxServers) throw new RangeError("Node serve server limit reached");
  const token = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node serve token");
  const portValue = integer(args[1], 0, 65535, "serve port");
  const host = boundedHost(args[2]);
  const handle = allocateHandle(servers, nextServerHandle, maxServers, "Node serve server");
  nextServerHandle = advanceHandle(handle);
  const task = {handle, token, server: null};
  const server = createServer((request, response) => incomingRequest(task, request, response));
  task.server = server;
  await new Promise((resolveListen, rejectListen) => {
    const failed = error => { server.off("listening", ready); rejectListen(error); };
    const ready = () => { server.off("error", failed); resolveListen(); };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen({port: portValue, host});
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("velar/serve could not determine the bound port");
  servers.set(handle, task);
  return {handle, port: address.port};
}

async function stopServer(args) {
  if (args.length !== 1) throw new TypeError("serve.stop arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node serve server handle");
  const task = servers.get(handle);
  if (!task) return null;
  await new Promise((resolveStop, rejectStop) => {
    task.server.close(error => error ? rejectStop(error) : resolveStop(null));
    task.server.closeIdleConnections?.();
  });
  servers.delete(handle);
  return null;
}

async function dispatch(operation, args) {
  if (!operations.has(operation) || !Array.isArray(args)) throw new TypeError("Node host request is invalid");
  if (operation === "http.request") return startHttpRequest(args);
  if (operation === "http.read") return readHttpRequest(args);
  if (operation === "http.cancel") {
    if (args.length !== 2 || args[1] !== "cancelled" && args[1] !== "timeout") throw new TypeError("http.cancel arguments are invalid");
    const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node HTTP request handle");
    const task = httpRequests.get(handle);
    return task ? releaseHttpRequest(task, args[1]) : false;
  }
  if (operation === "http.close") {
    if (args.length !== 1) throw new TypeError("http.close arguments are invalid");
    const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node HTTP request handle");
    const task = httpRequests.get(handle);
    return task ? releaseHttpRequest(task, null) : false;
  }
  if (operation === "fs.readFile") {
    if (args.length !== 3 || args[2] !== "readText" && args[2] !== "readBlob") throw new TypeError("fs.readFile arguments are invalid");
    return regularFile(boundedPath(args[0], args[2]), args[2], byteLimit(args[1], args[2]));
  }
  if (operation === "fs.createFile") {
    if (args.length !== 2) throw new TypeError("fs.createFile arguments are invalid");
    const path = boundedPath(args[0], "createText");
    const data = byteArray(args[1], "createText");
    try { await writeFile(path, data, {flag: "wx"}); }
    catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") throw new Error("createText target already exists");
      throw error;
    }
    return null;
  }
  if (operation === "fs.writeFile" || operation === "fs.appendFile") {
    if (args.length !== 2) throw new TypeError(operation + " arguments are invalid");
    const name = operation === "fs.writeFile" ? "writeText" : "appendText";
    const path = boundedPath(args[0], name);
    const data = byteArray(args[1], name);
    let metadata = null;
    try { metadata = await stat(path); }
    catch (error) { if (!missing(error)) throw error; }
    if (metadata && !metadata.isFile()) throw new TypeError(name + " requires a file path");
    if (operation === "fs.appendFile" && metadata && metadata.size > maxFileBytes - data.byteLength) {
      throw new RangeError("appendText result cannot exceed 16 MiB");
    }
    if (operation === "fs.writeFile") await writeFile(path, data);
    else await appendFile(path, data);
    return null;
  }
  if (operation === "fs.exists") {
    if (args.length !== 1) throw new TypeError("fs.exists arguments are invalid");
    try { await stat(boundedPath(args[0], "exists")); return true; }
    catch (error) { if (missing(error)) return false; throw error; }
  }
  if (operation === "fs.list") {
    if (args.length !== 2) throw new TypeError("fs.list arguments are invalid");
    const path = boundedPath(args[0], "list");
    const maximum = args[1];
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maxListItems) {
      throw new RangeError("list maxItems must be an integer from 1 through 100000");
    }
    const names = await readdir(path);
    if (names.length > maximum) throw new RangeError("list result exceeds maxItems");
    let units = 0;
    for (const name of names) {
      if (typeof name !== "string") throw new TypeError("list host result must contain text names");
      units += name.length;
      if (units > maxListCodeUnits) throw new RangeError("list result cannot exceed 2 MiB of text");
    }
    names.sort();
    return names;
  }
  if (operation === "fs.info") {
    if (args.length !== 1) throw new TypeError("fs.info arguments are invalid");
    const path = boundedPath(args[0], "info");
    let metadata;
    try { metadata = await lstat(path); }
    catch (error) { if (missing(error)) return null; throw error; }
    const kind = metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : metadata.isSymbolicLink() ? "symlink" : "other";
    return {name: basename(path), kind, size: metadata.size, modifiedAt: metadata.mtimeMs};
  }
  if (operation === "fs.canonical") {
    if (args.length !== 1) throw new TypeError("fs.canonical arguments are invalid");
    return realpath(boundedPath(args[0], "canonical"));
  }
  if (operation === "fs.makeDirectory") {
    if (args.length !== 1) throw new TypeError("fs.makeDirectory arguments are invalid");
    await mkdir(boundedPath(args[0], "makeDirectory"), {recursive: true});
    return null;
  }
  if (operation === "fs.copyFile") {
    if (args.length !== 3) throw new TypeError("fs.copyFile arguments are invalid");
    const source = boundedPath(args[0], "copyFile");
    const target = boundedPath(args[1], "copyFile");
    const replace = boolean(args[2], "copyFile");
    if (!(await stat(source)).isFile()) throw new TypeError("copyFile requires a regular file source");
    if (!replace) await absent(target, "copyFile");
    await copyFile(source, target);
    return null;
  }
  if (operation === "fs.move") {
    if (args.length !== 3) throw new TypeError("fs.move arguments are invalid");
    const source = boundedPath(args[0], "move");
    const target = boundedPath(args[1], "move");
    const replace = boolean(args[2], "move");
    if (!replace) await absent(target, "move");
    else await rm(target, {force: true, recursive: false});
    await rename(source, target);
    return null;
  }
  if (operation === "fs.removeFile") {
    if (args.length !== 1) throw new TypeError("fs.removeFile arguments are invalid");
    const path = boundedPath(args[0], "removeFile");
    if ((await lstat(path)).isDirectory()) throw new TypeError("removeFile refuses directories");
    await rm(path, {force: false, recursive: false});
    return null;
  }
  if (operation === "serve.start") return startServer(args);
  if (operation === "serve.stop") return stopServer(args);
  if (operation === "serve.body") {
    if (args.length !== 2) throw new TypeError("serve.body arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const maximum = integer(args[1], 1, maxServeBodyBytes, "Request body maxBytes");
      const body = await bodyOf(task);
      return body.bytes > maximum ? {text: null, bytes: body.bytes, tooLarge: true} : {text: body.text, bytes: body.bytes, tooLarge: false};
    });
  }
  if (operation === "serve.respond") {
    if (args.length !== 6) throw new TypeError("serve.respond arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const status = integer(args[1], 100, 599, "ServeResponse.status");
      const headers = headerPairs(args[2]);
      const kind = args[3];
      const body = args[4];
      const contentType = args[5];
      if (kind !== "json" && kind !== "text" || typeof body !== "string" || Buffer.byteLength(body, "utf8") > maxServeBodyBytes) {
        throw new TypeError("ServeResponse body is invalid");
      }
      if (contentType !== null && (typeof contentType !== "string" || contentType.length === 0 || contentType.length > 1024 || /[\0\r\n]/u.test(contentType))) {
        throw new TypeError("ServeResponse.contentType must be bounded single-line text");
      }
      reserveServeBytes(task, Buffer.byteLength(body, "utf8"));
      task.response.statusCode = status;
      setHeaders(task.response, headers);
      if (!task.response.hasHeader("Content-Type")) {
        task.response.setHeader("Content-Type", kind === "json" ? "application/json; charset=utf-8" : contentType ?? "text/plain; charset=utf-8");
      }
      task.response.end(body);
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.respondFile") {
    if (args.length !== 4) throw new TypeError("serve.respondFile arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      try {
        const file = await staticFile(task, args[1], args[2], args[3]);
        task.response.statusCode = 200;
        task.response.setHeader("Content-Type", file.contentType);
        task.response.setHeader("Content-Length", file.data.byteLength);
        task.response.end(file.data);
      } catch (error) {
        if (!(error instanceof StaticNotFound) && !missing(error) && error?.code !== "EISDIR") throw error;
        task.response.statusCode = 404;
        task.response.setHeader("Content-Type", "text/plain; charset=utf-8");
        task.response.end("Not found");
      }
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.streamStart") {
    if (args.length !== 3) throw new TypeError("serve.streamStart arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      if (task.streaming) throw new Error("ServeResponse stream has already started");
      task.response.statusCode = integer(args[1], 100, 599, "ServeResponse.status");
      setHeaders(task.response, args[2]);
      task.streaming = true;
      return null;
    });
  }
  if (operation === "serve.streamWrite") {
    if (args.length !== 2) throw new TypeError("serve.streamWrite arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const chunk = args[1];
      if (!task.streaming || typeof chunk !== "string") throw new TypeError("ServeResponse.stream chunks must be strings");
      const bytes = Buffer.byteLength(chunk, "utf8");
      if (bytes > maxServeStreamChunkBytes || task.streamBytes + bytes > maxServeStreamBytes) {
        throw new RangeError("ServeResponse.stream exceeded its bounded output");
      }
      if (task.response.destroyed || task.response.writableEnded) throw new Error("ServeResponse.stream client connection is closed");
      reserveTransientServeBytes(bytes);
      task.streamBytes += bytes;
      try {
        await new Promise((resolveWrite, rejectWrite) => {
          let settled = false;
          const cleanup = () => {
            task.response.off("error", failed);
            task.response.off("close", closed);
          };
          const finish = action => { if (settled) return; settled = true; cleanup(); action(); };
          const disconnected = () => new Error("ServeResponse.stream client connection is closed");
          const flushed = error => error ? finish(() => rejectWrite(disconnected())) : finish(resolveWrite);
          const failed = () => finish(() => rejectWrite(disconnected()));
          const closed = () => finish(() => rejectWrite(disconnected()));
          task.response.once("error", failed);
          task.response.once("close", closed);
          task.response.write(chunk, flushed);
          if (task.response.destroyed || task.response.writableEnded) closed();
        });
      } finally {
        releaseTransientServeBytes(bytes);
      }
      return null;
    });
  }
  if (operation === "serve.streamEnd") {
    if (args.length !== 1) throw new TypeError("serve.streamEnd arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      if (!task.streaming) throw new Error("ServeResponse stream has not started");
      task.response.end();
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.fail") {
    if (args.length !== 1) throw new TypeError("serve.fail arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => { opaqueFailure(task); return null; });
  }
  throw new TypeError("Unknown Node host operation");
}

function errorRecord(error) {
  if (error instanceof HttpTransportFailure) return {name: "HttpTransportError", message: error.message, phase: error.phase};
  const name = error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "Error";
  const message = error instanceof Error && typeof error.message === "string" && error.message.length > 0
    ? error.message.slice(0, 65536)
    : "Node host operation failed";
  return {name, message};
}

port.on("message", value => {
  const id = value && typeof value === "object" && Number.isSafeInteger(value.id) ? value.id : 0;
  Promise.resolve().then(() => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !Number.isSafeInteger(value.id) || value.id < 1
      || typeof value.operation !== "string" || !Array.isArray(value.args)) {
      throw new TypeError("Node host request is invalid");
    }
    return dispatch(value.operation, value.args);
  }).then(
    result => port.postMessage({kind: "response", id, ok: true, value: result, error: null}),
    error => port.postMessage({kind: "response", id, ok: false, value: null, error: errorRecord(error)}),
  );
});
port.start();
port.postMessage({kind: "ready"});
`.trimStart();
