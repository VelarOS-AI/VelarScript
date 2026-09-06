import { Buffer } from "node:buffer";
import { createReadStream, watch as watchNode } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request as createHttpRequest } from "node:http";
import { request as createHttpsRequest } from "node:https";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { URL as NodeURL } from "node:url";
import { brotliCompress as brotliCompressNode, gzip as gzipNode } from "node:zlib";
import { promisify } from "node:util";
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
const maxServeRequestTargetBytes = 64 * 1024;
const maxServeRequestMetadataBytes = 512 * 1024;
const maxServeQueryFields = 1000;
const maxServeHeaderTextBytes = 64 * 1024;
const maxServeSockets = 4096;
const maxServeSocketsPerServer = 2048;
const serveHeadersTimeoutMilliseconds = 10_000;
const serveRequestTimeoutMilliseconds = 60_000;
const serveKeepAliveTimeoutMilliseconds = 5_000;
const serveShutdownTimeoutMilliseconds = 30_000;
const maxHttpBodyBytes = 16 * 1024 * 1024;
const maxHttpResponseBytes = 64 * 1024 * 1024;
const maxHttpResponseChunks = 1000000;
const maxHttpRequests = 1024;
const maxServers = 128;
const maxRequests = 4096;
const maxFileWatchers = 128;
const maxWatchPaths = 4096;
const maxWatchTextUnits = 2 * 1024 * 1024;
const watchDebounceMilliseconds = 20;
const operations = new Set([
  "fs.readFile", "fs.createFile", "fs.replaceFileIfMatches", "fs.writeFile", "fs.appendFile", "fs.exists", "fs.list", "fs.info",
  "fs.canonical", "fs.makeDirectory", "fs.copyFile", "fs.move", "fs.removeFile", "fs.watchStart", "fs.watchNext", "fs.watchClose",
  "http.request", "http.read", "http.readBytes", "http.cancel", "http.close",
  "serve.start", "serve.stop", "serve.body", "serve.bodyBytes", "serve.readFile", "serve.respond", "serve.respondFile",
  "serve.streamStart", "serve.streamWrite", "serve.streamEnd", "serve.fail",
]);
const servers = new Map();
const requests = new Map();
const httpRequests = new Map();
const fileMutationTails = new Map();
const fileWatchers = new Map();
let nextServerHandle = 1;
let nextRequestHandle = 1;
let nextTextReplacementIdentity = 1;
let nextFileWatcherHandle = 1;
let reservedServeBytes = 0;
let activeServeSockets = 0;
const contentTypes = Object.freeze({
  ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
  ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2",
});
const gzip = promisify(gzipNode);
const brotliCompress = promisify(brotliCompressNode);

class StaticNotFound extends Error {}
class RequestHeadersTooLarge extends RangeError {}

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

// Exhausting the aggregate budget is a temporary load condition, not a server
// fault: admission already answers it with 503 at rejectIncomingRequest, and a
// response that cannot be reserved now gets the same answer instead of the
// opaque 500 that every other late failure gets. The identity is a class rather
// than the message so the send path can tell it apart from a genuine fault.
class ServeBudgetError extends RangeError {
  constructor() { super("Node serve aggregate byte budget is exhausted"); }
}

function reserveServeBytes(task, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Node serve byte reservation must be a non-negative integer");
  if (reservedServeBytes + bytes > maxServeAggregateBytes) throw new ServeBudgetError();
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
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Node serve byte reservation must be a non-negative integer");
  if (reservedServeBytes + bytes > maxServeAggregateBytes) throw new ServeBudgetError();
  reservedServeBytes += bytes;
}

function releaseTransientServeBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > reservedServeBytes) {
    throw new Error("Node serve transient byte ownership is invalid");
  }
  reservedServeBytes -= bytes;
}

function cleanupRequest(task) {
  if (!task.transportDone || !task.completed && !task.abandoned || task.activeOperations !== 0 || !requests.delete(task.handle)) return;
  releaseServeBytes(task);
}

function cancelRequest(task, reason = "client_disconnect") {
  if (task.cancelled || task.completed) return;
  task.cancelled = true;
  try { port.postMessage({kind: "event", event: "serve.cancel", value: {token: task.token, request: task.handle, reason}}); }
  catch {}
}

function closeRequest(task, cancelled = false) {
  if (cancelled) cancelRequest(task);
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

async function withTerminalResponse(task, action) {
  if (task.responseMode !== "idle") throw new Error("Node serve request already owns a response operation");
  task.responseMode = "terminal";
  try { return await withRequest(task, action); }
  catch (error) {
    if (!task.completed && !task.transportDone && !task.response.headersSent) task.responseMode = "idle";
    throw error;
  }
}

async function withStreamWrite(task, action) {
  if (task.responseMode !== "streaming") throw new Error("ServeResponse stream has not started");
  if (task.writeActive) throw new Error("ServeResponse allows only one active stream write");
  task.writeActive = true;
  try { return await withRequest(task, action); }
  finally { task.writeActive = false; }
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

// D50 rule 89: a target that already exists is the same recovery whether the
// operating system reported EEXIST or this pre-check found it first, so both
// spellings carry the same evidence into the classification below.
class AlreadyExists extends Error {
  constructor(operation, path) {
    super(operation + " target already exists");
    this.code = "EEXIST";
    this.path = path;
  }
}

async function absent(path, operation) {
  try { await lstat(path); }
  catch (error) { if (missing(error)) return; throw error; }
  throw new AlreadyExists(operation, path);
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function fileMutationIdentities(paths) {
  const identities = new Set();
  for (const path of paths) {
    const lexical = resolve(path);
    identities.add(lexical);
    try { identities.add(await realpath(lexical)); }
    catch (error) { if (!missing(error)) throw error; }
  }
  return [...identities].sort();
}

async function withFileMutations(paths, action) {
  const identities = await fileMutationIdentities(paths);
  const reservations = identities.map(identity => {
    const previous = fileMutationTails.get(identity) ?? null;
    let release;
    const tail = new Promise(resolveTail => { release = resolveTail; });
    fileMutationTails.set(identity, tail);
    return {identity, previous, release, tail};
  });
  await Promise.all(reservations.map(reservation => reservation.previous));
  try { return await action(); }
  finally {
    for (const reservation of reservations) {
      reservation.release();
      if (fileMutationTails.get(reservation.identity) === reservation.tail) fileMutationTails.delete(reservation.identity);
    }
  }
}

function closeFileWatcher(task) {
  if (task.closed) return false;
  task.closed = true;
  if (task.timer !== null) {
    clearTimeout(task.timer);
    task.timer = null;
  }
  try { task.watcher.close(); } catch {}
  fileWatchers.delete(task.handle);
  if (task.pending !== null) {
    const pending = task.pending;
    task.pending = null;
    pending.resolve(null);
  }
  return true;
}

function fileWatchBatch(task) {
  if (task.rescan) {
    task.rescan = false;
    task.paths.clear();
    task.units = 0;
    return {paths: [], rescan: true};
  }
  const paths = [...task.paths].sort();
  task.paths.clear();
  task.units = 0;
  return {paths, rescan: false};
}

function settleFileWatch(task) {
  if (task.pending === null || task.timer !== null || task.failure !== null || !task.rescan && task.paths.size === 0) return;
  task.timer = setTimeout(() => {
    task.timer = null;
    if (task.pending === null || task.closed) return;
    const pending = task.pending;
    task.pending = null;
    pending.resolve(fileWatchBatch(task));
  }, watchDebounceMilliseconds);
}

function rescanFileWatch(task) {
  task.rescan = true;
  task.paths.clear();
  task.units = 0;
  settleFileWatch(task);
}

function enqueueFileWatch(task, filename) {
  if (task.closed || task.failure !== null || task.rescan) return;
  let path;
  if (!task.directory) path = task.root;
  else {
    if (typeof filename !== "string" || filename.length === 0 || filename.length > maxPathCodeUnits || filename.includes("\0") || isAbsolute(filename)) {
      rescanFileWatch(task);
      return;
    }
    path = resolve(task.root, filename);
    const local = relative(task.root, path);
    if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
      rescanFileWatch(task);
      return;
    }
  }
  if (!task.paths.has(path)) {
    if (task.paths.size >= maxWatchPaths || task.units + path.length > maxWatchTextUnits) {
      rescanFileWatch(task);
      return;
    }
    task.paths.add(path);
    task.units += path.length;
  }
  settleFileWatch(task);
}

function failFileWatch(task, error) {
  if (task.closed || task.failure !== null) return;
  task.failure = error instanceof Error ? error : new Error("Node file watcher failed");
  if (task.timer !== null) {
    clearTimeout(task.timer);
    task.timer = null;
  }
  try { task.watcher.close(); } catch {}
  if (task.pending !== null) {
    const pending = task.pending;
    task.pending = null;
    fileWatchers.delete(task.handle);
    task.closed = true;
    pending.reject(task.failure);
  }
}

async function startFileWatch(args) {
  if (args.length !== 2 || typeof args[1] !== "boolean") throw new TypeError("fs.watchStart arguments are invalid");
  if (fileWatchers.size >= maxFileWatchers) throw new RangeError("Node host cannot own more than 128 file watchers");
  const root = await realpath(boundedPath(args[0], "watchFiles"));
  const metadata = await stat(root);
  const directory = metadata.isDirectory();
  if (!directory && !metadata.isFile()) throw new TypeError("watchFiles requires a file or directory path");
  if (args[1] && !directory) throw new TypeError("recursive watchFiles requires a directory path");
  const handle = allocateHandle(fileWatchers, nextFileWatcherHandle, maxFileWatchers, "Node file watcher");
  nextFileWatcherHandle = advanceHandle(handle);
  const task = {handle, root, directory, watcher: null, paths: new Set(), units: 0, rescan: false, pending: null, timer: null, failure: null, closed: false};
  task.watcher = watchNode(root, {recursive: args[1], encoding: "utf8", persistent: true}, (_event, filename) => enqueueFileWatch(task, filename));
  task.watcher.once("error", error => failFileWatch(task, error));
  fileWatchers.set(handle, task);
  return handle;
}

function nextFileWatch(args) {
  if (args.length !== 1) throw new TypeError("fs.watchNext arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node file watcher handle");
  const task = fileWatchers.get(handle);
  if (!task) throw new Error("Node file watcher handle is unknown or already released");
  if (task.pending !== null) throw new Error("FileWatcher.next already has an active pull");
  if (task.failure !== null) {
    fileWatchers.delete(handle);
    task.closed = true;
    throw task.failure;
  }
  if (task.rescan || task.paths.size > 0) return fileWatchBatch(task);
  return new Promise((resolveNext, rejectNext) => {
    task.pending = {resolve: resolveNext, reject: rejectNext};
  });
}

function closeFileWatchHandle(args) {
  if (args.length !== 1) throw new TypeError("fs.watchClose arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node file watcher handle");
  const task = fileWatchers.get(handle);
  return task ? closeFileWatcher(task) : false;
}

async function commitTextReplacement(path, data, mode) {
  let temporary = null;
  for (let attempts = 0; attempts < 1024; attempts += 1) {
    const identity = nextTextReplacementIdentity;
    nextTextReplacementIdentity = nextTextReplacementIdentity >= Number.MAX_SAFE_INTEGER ? 1 : nextTextReplacementIdentity + 1;
    const candidate = resolve(dirname(path), ".velar-replace-" + identity + ".tmp");
    try {
      await writeFile(candidate, data, {flag: "wx", mode});
      temporary = candidate;
      break;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
    }
  }
  if (temporary === null) throw new Error("replaceTextIfMatches could not allocate a temporary file");
  try { await rename(temporary, path); }
  finally { await rm(temporary, {force: true, recursive: false}); }
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
// Framing and routing belong to the transport, not to the caller. An
// application that could set these beside Node's own framing could put two
// disagreeing lengths, a second encoding, or a forged authority on the wire.
// Credential names stay legal here: they are the caller's to send, and remain
// forbidden only for the secret-header path above.
const transportOwnedHttpHeaders = new Set([
  "connection", "content-length", "expect", "host", "keep-alive", "proxy-connection",
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
    if (transportOwnedHttpHeaders.has(pair[0].toLowerCase())) throw new TypeError("HTTP header '" + pair[0] + "' is transport-controlled");
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
  if (body !== null && typeof body !== "string" && !(body instanceof Uint8Array)) throw new TypeError("HTTP body must be validated text or bytes");
  if (body !== null && (typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength) > maxHttpBodyBytes) throw new RangeError("HTTP body cannot exceed 16 MiB");
  if ((method === "GET" || method === "HEAD") && body !== null) throw new TypeError(method + " requests cannot have a body");
  const maxBytes = integer(args[6], 1, maxHttpResponseBytes, "HTTP maxBytes");
  const task = {
    handle, request: null, response: null, iterator: null, decoder: new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}),
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

async function readHttpRequest(args, binary = false) {
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
      return binary ? {done: true, bytes: new Uint8Array()} : {done: true, text: task.decoder.decode()};
    }
    if (!(next.value instanceof Uint8Array)) throw new TypeError("Node HTTP returned a non-byte response chunk");
    task.bytes += next.value.byteLength;
    task.chunks += 1;
    if (task.bytes > task.maxBytes) throw new RangeError("HTTP response exceeds maxBytes");
    if (task.chunks > maxHttpResponseChunks) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
    if (binary) { const bytes = new Uint8Array(next.value.byteLength); bytes.set(next.value); return {done: false, bytes}; }
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
  if (!request || request.completed) throw new Error("Node serve request is unknown or already completed");
  if (request.transportDone) {
    request.abandoned = true;
    cleanupRequest(request);
    throw new Error("Node serve client connection is closed");
  }
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
    if (units > 64 * 1024) throw new RangeError("ServeResponse headers cannot exceed 64 KiB of text");
    output.push(item);
  }
  return output;
}

function cookieValues(value) {
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("ServeResponse cookies must be a bounded list");
  const output = [];
  let bytes = 0;
  for (const cookie of value) {
    if (typeof cookie !== "string" || cookie.length === 0 || cookie.length > 8192 || /[\0\r\n]/u.test(cookie)) throw new TypeError("ServeResponse cookie is invalid");
    bytes += Buffer.byteLength(cookie, "utf8");
    if (bytes > 64 * 1024) throw new RangeError("ServeResponse cookies cannot exceed 64 KiB");
    output.push(cookie);
  }
  return output;
}

function setHeaders(response, values, cookies = []) {
  const setCookies = [];
  for (const [name, value] of headerPairs(values)) {
    if (name.toLowerCase() === "set-cookie") setCookies.push(value);
    else response.setHeader(name, value);
  }
  for (const cookie of cookieValues(cookies)) setCookies.push(cookie);
  if (setCookies.length > 0) response.setHeader("Set-Cookie", setCookies);
}

