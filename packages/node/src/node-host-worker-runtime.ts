// Privileged Node transport shared by official Node standard modules. This
// worker loads only compiler-owned source and static Node built-ins; VelarScript
// application code and npm dependencies remain in the application Realm.
export const VELAR_NODE_HOST_WORKER_SOURCE = String.raw`
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
  // relative() emits ".." only as a whole segment, so the escape test compares
  // whole segments too: a prefix test also rejects an ordinary top-level file
  // whose own name begins with two dots. The separator is the platform's,
  // because relative() writes an escape with a backslash on Windows.
  const path = relative(root, target);
  return path === "" || path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

async function staticFile(rootValue, pathValue, fallbackValue) {
  const root = await realpath(resolve(boundedPath(rootValue, "fileResponse")));
  const relativePath = requestPath(pathValue);
  const fallback = fallbackValue === null ? null : requestPath(fallbackValue);
  const load = async path => {
    const target = await realpath(resolve(root, path));
    if (!inside(root, target)) throw new StaticNotFound();
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > maxServeFileBytes) throw new StaticNotFound();
    return {target, metadata, contentType: contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream"};
  };
  try { return await load(relativePath); }
  catch (error) {
    if ((error instanceof StaticNotFound || missing(error) || error?.code === "EISDIR") && fallback !== null) return load(fallback);
    throw error;
  }
}

function staticEtag(metadata) {
  const modified = Number.isFinite(metadata.mtimeMs) ? Math.floor(metadata.mtimeMs) : 0;
  return 'W/"' + metadata.size.toString(16) + "-" + modified.toString(16) + '"';
}

function staticNotModified(request, metadata, etag) {
  const noneMatch = request.headers["if-none-match"];
  if (typeof noneMatch === "string") {
    for (const candidate of noneMatch.split(",")) if (candidate.trim() === "*" || candidate.trim() === etag) return true;
    return false;
  }
  const modifiedSince = request.headers["if-modified-since"];
  if (typeof modifiedSince !== "string") return false;
  const time = Date.parse(modifiedSince);
  return Number.isFinite(time) && Math.floor(metadata.mtimeMs / 1000) * 1000 <= time;
}

function staticRange(request, metadata, etag) {
  const value = request.headers.range;
  if (typeof value !== "string") return null;
  const ifRange = request.headers["if-range"];
  if (typeof ifRange === "string" && ifRange !== etag) {
    const time = Date.parse(ifRange);
    if (!Number.isFinite(time) || Math.floor(metadata.mtimeMs / 1000) * 1000 > time) return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (!match || match[1] === "" && match[2] === "" || metadata.size === 0) return false;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return false;
    start = Math.max(0, metadata.size - suffix);
    end = metadata.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? metadata.size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= metadata.size || end < start) return false;
    if (end >= metadata.size) end = metadata.size - 1;
  }
  return {start, end};
}

async function writeStaticRange(task, file, start, end) {
  if (end < start) return;
  const source = createReadStream(file.target, {start, end, highWaterMark: 64 * 1024});
  try {
    for await (const chunk of source) {
      const bytes = chunk.byteLength;
      reserveTransientServeBytes(bytes);
      try {
        await new Promise((resolveWrite, rejectWrite) => {
          let settled = false;
          const cleanup = () => { task.response.off("error", failed); task.response.off("close", closed); };
          const finish = action => { if (settled) return; settled = true; cleanup(); action(); };
          const failed = error => finish(() => rejectWrite(error));
          const closed = () => finish(() => rejectWrite(new Error("ServeResponse client connection is closed")));
          task.response.once("error", failed);
          task.response.once("close", closed);
          task.response.write(chunk, error => error ? failed(error) : finish(resolveWrite));
        });
      } finally { releaseTransientServeBytes(bytes); }
    }
  } finally { source.destroy(); }
}

async function testStaticFile(rootValue, pathValue, fallbackValue) {
  const root = await realpath(resolve(boundedPath(rootValue, "fileResponse")));
  const relativePath = requestPath(pathValue);
  const fallback = fallbackValue === null ? null : requestPath(fallbackValue);
  const load = async path => {
    const target = await realpath(resolve(root, path));
    if (!inside(root, target)) throw new StaticNotFound();
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > maxServeBodyBytes) throw new StaticNotFound();
    let reserved = metadata.size * 2;
    reserveTransientServeBytes(reserved);
    try {
      const source = await readFile(target);
      if (source.byteLength > maxServeBodyBytes) throw new StaticNotFound();
      if (source.byteLength > metadata.size) { const extra = (source.byteLength - metadata.size) * 2; reserveTransientServeBytes(extra); reserved += extra; }
      else if (source.byteLength < metadata.size) { const surplus = (metadata.size - source.byteLength) * 2; releaseTransientServeBytes(surplus); reserved -= surplus; }
      const data = new Uint8Array(source.byteLength);
      data.set(source);
      releaseTransientServeBytes(source.byteLength);
      reserved -= source.byteLength;
      return {data, contentType: contentTypes[extname(target).toLowerCase()] ?? "application/octet-stream"};
    } catch (error) { releaseTransientServeBytes(reserved); throw error; }
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
    task.response.end(task.request.method === "HEAD" ? undefined : "Internal server error");
  }
  completeRequest(task);
}

function responseHasNoBody(task, status) {
  return task.request.method === "HEAD" || status >= 100 && status < 200 || status === 204 || status === 304;
}

async function shedServeResponse(task) {
  task.response.statusCode = 503;
  task.response.setHeader("Retry-After", "1");
  task.response.setHeader("Content-Type", "application/json; charset=utf-8");
  await endServeResponse(task, responseHasNoBody(task, 503) ? undefined : '{"error":"outbound_budget_exhausted"}');
  completeRequest(task);
  return null;
}

async function endServeResponse(task, value) {
  await new Promise((resolveEnd, rejectEnd) => {
    let settled = false;
    const cleanup = () => {
      task.response.off("error", failed);
      task.response.off("close", closed);
    };
    const finish = action => { if (settled) return; settled = true; cleanup(); action(); };
    const failed = error => finish(() => rejectEnd(error));
    const closed = () => finish(() => task.response.writableFinished ? resolveEnd(null) : rejectEnd(new Error("ServeResponse client connection is closed")));
    task.response.once("error", failed);
    task.response.once("close", closed);
    task.response.end(value, () => finish(() => resolveEnd(null)));
    if (task.response.destroyed && !task.response.writableFinished) closed();
  });
}

function rawBodyOf(task, maximum) {
  if (task.body !== null) return task.body;
  task.body = (async () => {
    const declaredText = task.request.headers["content-length"];
    let declared = null;
    if (typeof declaredText === "string" && /^[0-9]+$/u.test(declaredText)) {
      declared = Number(declaredText);
      if (!Number.isSafeInteger(declared) || declared > maximum) {
        task.request.resume();
        return {data: null, bytes: maximum, tooLarge: true};
      }
    }
    // A declared Content-Length is a client claim, not a delivered body, so it
    // buys no allocation and no budget reservation up front: a header-only
    // socket that declares 16 MiB and sends nothing would otherwise spend the
    // process-global aggregate budget for the whole request timeout. The
    // declaration is only the effective ceiling; the bytes that actually arrive
    // are charged as they arrive.
    const limit = declared === null ? maximum : declared;
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of task.request) {
        const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        if (total + data.byteLength > limit) {
          task.request.resume();
          releaseServeBytes(task, total);
          return {data: null, bytes: maximum, tooLarge: true};
        }
        reserveServeBytes(task, data.byteLength);
        total += data.byteLength;
        chunks.push(data);
      }
      if (declared !== null && total !== declared) throw new TypeError("Request body length does not match Content-Length");
      reserveTransientServeBytes(total);
      try { return {data: Buffer.concat(chunks, total), bytes: total, tooLarge: false}; }
      finally { releaseTransientServeBytes(total); }
    } catch (error) {
      releaseServeBytes(task, total);
      throw error;
    }
  })();
  return task.body;
}

async function bodyOf(task, maximum) {
  const value = await rawBodyOf(task, maximum);
  if (value.tooLarge) return {text: null, bytes: value.bytes, tooLarge: true};
  try { return {text: new TextDecoder("utf-8", {fatal: true}).decode(value.data), bytes: value.bytes, tooLarge: false}; }
  catch { throw new TypeError("Request body must be valid UTF-8 text"); }
}

async function bodyBytesOf(task, maximum) {
  const value = await rawBodyOf(task, maximum);
  return value.tooLarge
    ? {data: null, bytes: value.bytes, tooLarge: true}
    : {data: new Uint8Array(value.data.buffer, value.data.byteOffset, value.data.byteLength), bytes: value.bytes, tooLarge: false};
}

function canonicalServePath(rawPath) {
  const source = rawPath.split("/");
  const decoded = new Array(source.length);
  let units = 0;
  for (let index = 0; index < source.length; index += 1) {
    let segment;
    try { segment = decodeURIComponent(source[index]); }
    catch { throw new TypeError("Request path is not valid percent-encoded UTF-8"); }
    if (segment.includes("/") || segment.includes("\\") || segment.includes("\0") || segment === "." || segment === "..") {
      throw new TypeError("Request path contains an unsafe encoded segment");
    }
    units += segment.length + (index === 0 ? 0 : 1);
    if (units > maxPathCodeUnits) throw new RangeError("Request target path is too long");
    decoded[index] = segment;
  }
  const path = decoded.join("/");
  if (!path.startsWith("/")) throw new TypeError("Request target must use an absolute path");
  return path;
}

function serveHeaderPairs(request) {
  const headers = [];
  let bytes = 0;
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value !== "string" && !Array.isArray(value)) continue;
    const text = typeof value === "string" ? value : value.join(", ");
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(text, "utf8");
    if (bytes > maxServeHeaderTextBytes || headers.length >= maxServeQueryFields) throw new RequestHeadersTooLarge("Request headers are too large");
    headers.push([name, text]);
  }
  return {headers, bytes};
}

function serveQueryPairs(source) {
  const query = [];
  let bytes = 0;
  if (source === "") return {query, bytes};
  const fields = source.split("&");
  if (fields.length > maxServeQueryFields) throw new RangeError("Request query is too large");
  for (const field of fields) {
    const separator = field.indexOf("=");
    const rawName = separator < 0 ? field : field.slice(0, separator);
    const rawValue = separator < 0 ? "" : field.slice(separator + 1);
    let name;
    let value;
    try {
      name = decodeURIComponent(rawName.replaceAll("+", " "));
      value = decodeURIComponent(rawValue.replaceAll("+", " "));
    } catch { throw new TypeError("Request query is not valid percent-encoded UTF-8"); }
    bytes += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (bytes > maxServeRequestTargetBytes) throw new RangeError("Request query is too large");
    query.push([name, value]);
  }
  return {query, bytes};
}

function rejectIncomingRequest(request, response, status, message) {
  response.statusCode = status;
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
  request.resume();
}

function incomingRequest(server, request, response) {
  if (server.stopping) { rejectIncomingRequest(request, response, 503, "Service unavailable"); return; }
  if (requests.size >= maxRequests) { rejectIncomingRequest(request, response, 503, "Service unavailable"); return; }
  const target = request.url ?? "/";
  if (typeof target !== "string" || target.length === 0 || !target.startsWith("/") || Buffer.byteLength(target, "utf8") > maxServeRequestTargetBytes || target.includes("\0")) {
    rejectIncomingRequest(request, response, 414, "Request target too long"); return;
  }
  let path;
  let headerResult;
  let queryResult;
  try {
    if (target.includes("#")) throw new TypeError("Request target must not contain a URL fragment");
    const separator = target.indexOf("?");
    path = canonicalServePath(separator < 0 ? target : target.slice(0, separator));
    headerResult = serveHeaderPairs(request);
    queryResult = serveQueryPairs(separator < 0 ? "" : target.slice(separator + 1));
  } catch (error) {
    const status = error instanceof RequestHeadersTooLarge ? 431 : error instanceof RangeError ? 414 : 400;
    rejectIncomingRequest(request, response, status, status === 431 ? "Request headers too large" : status === 414 ? "Request target too long" : "Bad request");
    return;
  }
  const declaredText = request.headers["content-length"];
  if (typeof declaredText === "string" && /^[0-9]+$/u.test(declaredText)) {
    const declared = Number(declaredText);
    if (!Number.isSafeInteger(declared) || declared > maxServeBodyBytes) {
      rejectIncomingRequest(request, response, 413, "Request body too large");
      return;
    }
  }
  const handle = allocateHandle(requests, nextRequestHandle, maxRequests, "Node serve request");
  nextRequestHandle = advanceHandle(handle);
  const task = {
    handle, token: server.token, server: server.handle, request, response, body: null, streamBytes: 0, responseMode: "idle", writeActive: false, suppressBody: false,
    reservedBytes: 0, completed: false, abandoned: false, cancelled: false, transportDone: false, activeOperations: 0,
  };
  const metadataBytes = (Buffer.byteLength(target, "utf8") + headerResult.bytes + queryResult.bytes + Buffer.byteLength(path, "utf8") + 256) * 2;
  if (metadataBytes > maxServeRequestMetadataBytes) { rejectIncomingRequest(request, response, 431, "Request metadata too large"); return; }
  try { reserveServeBytes(task, metadataBytes); }
  catch { rejectIncomingRequest(request, response, 503, "Service unavailable"); return; }
  requests.set(handle, task);
  request.once("aborted", () => cancelRequest(task));
  response.once("finish", () => closeRequest(task, false));
  response.once("close", () => closeRequest(task, !response.writableFinished));
  port.postMessage({kind: "event", event: "serve.request", value: {
    token: server.token,
    request: handle,
    method: request.method ?? "GET",
    path,
    query: queryResult.query,
    headers: headerResult.headers,
  }});
}

async function startServer(args) {
  if (args.length !== 3 || servers.size >= maxServers) throw new RangeError("Node serve server limit reached");
  const token = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node serve token");
  const portValue = integer(args[1], 0, 65535, "serve port");
  const host = boundedHost(args[2]);
  const handle = allocateHandle(servers, nextServerHandle, maxServers, "Node serve server");
  nextServerHandle = advanceHandle(handle);
  const task = {handle, token, server: null, sockets: new Set(), stopping: false, stopPromise: null};
  const server = createServer({
    maxHeaderSize: maxServeHeaderTextBytes,
    headersTimeout: serveHeadersTimeoutMilliseconds,
    requestTimeout: serveRequestTimeoutMilliseconds,
    keepAliveTimeout: serveKeepAliveTimeoutMilliseconds,
    connectionsCheckingInterval: 1000,
  }, (request, response) => incomingRequest(task, request, response));
  task.server = server;
  server.maxConnections = maxServeSocketsPerServer;
  server.maxRequestsPerSocket = 1000;
  server.on("connection", socket => {
    if (task.stopping || task.sockets.size >= maxServeSocketsPerServer || activeServeSockets >= maxServeSockets) {
      socket.destroy();
      return;
    }
    task.sockets.add(socket);
    activeServeSockets += 1;
    socket.setNoDelay(true);
    socket.setKeepAlive(true, serveKeepAliveTimeoutMilliseconds);
    socket.once("close", () => {
      if (!task.sockets.delete(socket)) return;
      activeServeSockets -= 1;
      if (activeServeSockets < 0) activeServeSockets = 0;
    });
  });
  servers.set(handle, task);
  try {
    await new Promise((resolveListen, rejectListen) => {
      const failed = error => { server.off("listening", ready); rejectListen(error); };
      const ready = () => { server.off("error", failed); resolveListen(); };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen({port: portValue, host});
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("velar/serve could not determine the bound port");
    server.on("error", error => {
      if (task.stopping) return;
      const failure = errorRecord(error);
      try { port.postMessage({kind: "event", event: "serve.error", value: {token, message: failure.message}}); }
      catch {}
    });
    return {handle, port: address.port};
  } catch (error) {
    if (servers.get(handle) === task) servers.delete(handle);
    try { server.close(); } catch {}
    throw error;
  }
}

async function stopServer(args) {
  if (args.length < 1 || args.length > 2) throw new TypeError("serve.stop arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Node serve server handle");
  const grace = args.length === 2 ? integer(args[1], 1, 120_000, "serve stop grace") : serveShutdownTimeoutMilliseconds;
  const task = servers.get(handle);
  if (!task) return null;
  if (task.stopPromise !== null) return await task.stopPromise;
  task.stopping = true;
  for (const request of requests.values()) if (request.server === handle && !request.completed) {
    request.response.shouldKeepAlive = false;
    if (!request.response.headersSent) request.response.setHeader("Connection", "close");
    cancelRequest(request, "server_stopping");
  }
  const pending = (async () => {
    await new Promise((resolveStop, rejectStop) => {
      let settled = false;
      let forceTimer = null;
      let finalTimer = null;
      const finish = action => {
        if (settled) return;
        settled = true;
        if (forceTimer !== null) clearTimeout(forceTimer);
        if (finalTimer !== null) clearTimeout(finalTimer);
        action();
      };
      task.server.close(error => error ? finish(() => rejectStop(error)) : finish(() => resolveStop(null)));
      task.server.closeIdleConnections?.();
      forceTimer = setTimeout(() => {
        try { task.server.closeAllConnections?.(); } catch {}
        for (const socket of task.sockets) try { socket.destroy(); } catch {}
        finalTimer = setTimeout(() => finish(() => rejectStop(new Error("Node serve transport did not stop within its graceful shutdown deadline"))), 1000);
        finalTimer.unref?.();
      }, grace);
      forceTimer.unref?.();
    });
    if (servers.get(handle) === task) servers.delete(handle);
    return null;
  })();
  task.stopPromise = pending;
  try { return await pending; }
  catch (error) { if (task.stopPromise === pending) { task.stopPromise = null; task.stopping = false; } throw error; }
}

async function dispatch(operation, args) {
  if (!operations.has(operation) || !Array.isArray(args)) throw new TypeError("Node host request is invalid");
  if (operation === "http.request") return startHttpRequest(args);
  if (operation === "http.read") return readHttpRequest(args);
  if (operation === "http.readBytes") return readHttpRequest(args, true);
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
    if (args.length !== 3 || args[2] !== "readText" && args[2] !== "readBytes") throw new TypeError("fs.readFile arguments are invalid");
    return regularFile(boundedPath(args[0], args[2]), args[2], byteLimit(args[1], args[2]));
  }
  if (operation === "fs.createFile") {
    if (args.length !== 2 && args.length !== 3 || args.length === 3 && args[2] !== "createBytes") throw new TypeError("fs.createFile arguments are invalid");
    const name = args.length === 3 ? "createBytes" : "createText";
    const path = boundedPath(args[0], name);
    const data = byteArray(args[1], name);
    return withFileMutations([path], async () => {
      try { await writeFile(path, data, {flag: "wx"}); }
      catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") throw new AlreadyExists(name, path);
        throw error;
      }
      return null;
    });
  }
  if (operation === "fs.replaceFileIfMatches") {
    if (args.length !== 3) throw new TypeError("fs.replaceFileIfMatches arguments are invalid");
    const requestedPath = boundedPath(args[0], "replaceTextIfMatches");
    const expected = byteArray(args[1], "replaceTextIfMatches expected text");
    const replacement = byteArray(args[2], "replaceTextIfMatches replacement text");
    return withFileMutations([requestedPath], async () => {
      const path = await realpath(requestedPath);
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new TypeError("replaceTextIfMatches requires a file path");
      if (metadata.size > maxFileBytes) throw new RangeError("replaceTextIfMatches file exceeds 16 MiB");
      const current = await readFile(path);
      if (current.byteLength > maxFileBytes) throw new RangeError("replaceTextIfMatches file exceeds 16 MiB");
      if (!equalBytes(current, expected)) return false;
      await commitTextReplacement(path, replacement, metadata.mode);
      return true;
    });
  }
  if (operation === "fs.writeFile" || operation === "fs.appendFile") {
    if (args.length !== 2 && args.length !== 3 || args.length === 3 && (operation !== "fs.writeFile" || args[2] !== "writeBytes")) throw new TypeError(operation + " arguments are invalid");
    const name = args.length === 3 ? "writeBytes" : operation === "fs.writeFile" ? "writeText" : "appendText";
    const path = boundedPath(args[0], name);
    const data = byteArray(args[1], name);
    return withFileMutations([path], async () => {
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
    });
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
    return withFileMutations([target], async () => {
      if (!replace) await absent(target, "copyFile");
      await copyFile(source, target);
      return null;
    });
  }
  if (operation === "fs.move") {
    if (args.length !== 3) throw new TypeError("fs.move arguments are invalid");
    const source = boundedPath(args[0], "move");
    const target = boundedPath(args[1], "move");
    const replace = boolean(args[2], "move");
    return withFileMutations([source, target], async () => {
      if (!replace) await absent(target, "move");
      else await rm(target, {force: true, recursive: false});
      await rename(source, target);
      return null;
    });
  }
  if (operation === "fs.removeFile") {
    if (args.length !== 1) throw new TypeError("fs.removeFile arguments are invalid");
    const path = boundedPath(args[0], "removeFile");
    return withFileMutations([path], async () => {
      if ((await lstat(path)).isDirectory()) throw new TypeError("removeFile refuses directories");
      await rm(path, {force: false, recursive: false});
      return null;
    });
  }
  if (operation === "fs.watchStart") return startFileWatch(args);
  if (operation === "fs.watchNext") return nextFileWatch(args);
  if (operation === "fs.watchClose") return closeFileWatchHandle(args);
  if (operation === "serve.start") return startServer(args);
  if (operation === "serve.stop") return stopServer(args);
  if (operation === "serve.body") {
    if (args.length !== 2) throw new TypeError("serve.body arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const maximum = integer(args[1], 1, maxServeBodyBytes, "Request body maxBytes");
      return bodyOf(task, maximum);
    });
  }
  if (operation === "serve.bodyBytes") {
    if (args.length !== 2) throw new TypeError("serve.bodyBytes arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => {
      const maximum = integer(args[1], 1, maxServeBodyBytes, "Request body maxBytes");
      return bodyBytesOf(task, maximum);
    });
  }
  if (operation === "serve.readFile") {
    if (args.length !== 3) throw new TypeError("serve.readFile arguments are invalid");
    return testStaticFile(args[0], args[1], args[2]);
  }
  if (operation === "serve.respond") {
    if (args.length !== 8) throw new TypeError("serve.respond arguments are invalid");
    const task = requestHandle(args[0]);
    return withTerminalResponse(task, async () => {
      const status = integer(args[1], 200, 599, "ServeResponse.status");
      const headers = headerPairs(args[2]);
      const kind = args[3];
      const body = args[4];
      const contentType = args[5];
      const compression = args[6];
      const cookies = cookieValues(args[7]);
      if (kind !== "json" && kind !== "text" || typeof body !== "string" || Buffer.byteLength(body, "utf8") > maxServeBodyBytes) {
        throw new TypeError("ServeResponse body is invalid");
      }
      if (contentType !== null && (typeof contentType !== "string" || contentType.length === 0 || contentType.length > 1024 || /[\0\r\n]/u.test(contentType))) {
        throw new TypeError("ServeResponse.contentType must be bounded single-line text");
      }
      if (compression !== null && compression !== "gzip" && compression !== "br") throw new TypeError("ServeResponse compression is invalid");
      const suppressBody = responseHasNoBody(task, status);
      let output = body;
      try {
        if (!suppressBody && compression !== null) {
          const inputBytes = Buffer.byteLength(body, "utf8");
          reserveTransientServeBytes(inputBytes * 2);
          try { output = await (compression === "br" ? brotliCompress(body) : gzip(body)); }
          finally { releaseTransientServeBytes(inputBytes * 2); }
          if (output.byteLength > maxServeBodyBytes) throw new RangeError("Compressed ServeResponse exceeds 16 MiB");
        }
        if (!suppressBody) reserveServeBytes(task, typeof output === "string" ? Buffer.byteLength(output, "utf8") : output.byteLength);
      } catch (error) {
        if (!(error instanceof ServeBudgetError)) throw error;
        return await shedServeResponse(task);
      }
      task.response.statusCode = status;
      setHeaders(task.response, headers, cookies);
      if (!task.response.hasHeader("Content-Type") && (task.request.method === "HEAD" || !suppressBody)) {
        task.response.setHeader("Content-Type", kind === "json" ? "application/json; charset=utf-8" : contentType ?? "text/plain; charset=utf-8");
      }
      if (compression !== null) {
        task.response.setHeader("Content-Encoding", compression);
        if (!task.response.hasHeader("Vary")) task.response.setHeader("Vary", "Accept-Encoding");
      }
      await endServeResponse(task, suppressBody ? undefined : output);
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.respondFile") {
    if (args.length !== 6) throw new TypeError("serve.respondFile arguments are invalid");
    const task = requestHandle(args[0]);
    return withTerminalResponse(task, async () => {
      try {
        const file = await staticFile(args[1], args[2], args[3]);
        setHeaders(task.response, headerPairs(args[4]), args[5]);
        task.response.setHeader("Content-Type", file.contentType);
        task.response.setHeader("Accept-Ranges", "bytes");
        const etag = staticEtag(file.metadata);
        task.response.setHeader("ETag", etag);
        task.response.setHeader("Last-Modified", file.metadata.mtime.toUTCString());
        if (staticNotModified(task.request, file.metadata, etag)) {
          task.response.statusCode = 304;
          await endServeResponse(task);
        } else {
          const range = staticRange(task.request, file.metadata, etag);
          if (range === false) {
            task.response.statusCode = 416;
            task.response.setHeader("Content-Range", "bytes */" + file.metadata.size);
            await endServeResponse(task, task.request.method === "HEAD" ? undefined : "Range not satisfiable");
          } else {
            const start = range === null ? 0 : range.start;
            const end = range === null ? file.metadata.size - 1 : range.end;
            task.response.statusCode = range === null ? 200 : 206;
            task.response.setHeader("Content-Length", Math.max(0, end - start + 1));
            if (range !== null) task.response.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + file.metadata.size);
            if (task.request.method !== "HEAD") await writeStaticRange(task, file, start, end);
            await endServeResponse(task);
          }
        }
      } catch (error) {
        if (!(error instanceof StaticNotFound) && !missing(error) && error?.code !== "EISDIR") throw error;
        task.response.statusCode = 404;
        task.response.setHeader("Content-Type", "text/plain; charset=utf-8");
        await endServeResponse(task, "Not found");
      }
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.streamStart") {
    if (args.length !== 4) throw new TypeError("serve.streamStart arguments are invalid");
    const task = requestHandle(args[0]);
    const status = integer(args[1], 200, 599, "ServeResponse.status");
    const headers = headerPairs(args[2]);
    return withRequest(task, async () => {
      if (task.responseMode !== "idle") throw new Error("Node serve request already owns a response operation");
      task.responseMode = "streaming";
      task.response.statusCode = status;
      setHeaders(task.response, headers, args[3]);
      task.suppressBody = responseHasNoBody(task, task.response.statusCode);
      return null;
    });
  }
  if (operation === "serve.streamWrite") {
    if (args.length !== 2) throw new TypeError("serve.streamWrite arguments are invalid");
    const task = requestHandle(args[0]);
    return withStreamWrite(task, async () => {
      const chunk = args[1];
      if (typeof chunk !== "string") throw new TypeError("ServeResponse.stream chunks must be strings");
      const bytes = Buffer.byteLength(chunk, "utf8");
      if (bytes > maxServeStreamChunkBytes || task.streamBytes + bytes > maxServeStreamBytes) {
        throw new RangeError("ServeResponse.stream exceeded its bounded output");
      }
      if (task.suppressBody) return null;
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
      if (task.responseMode !== "streaming") throw new Error("ServeResponse stream has not started");
      if (task.writeActive) throw new Error("ServeResponse stream still has an active write");
      task.responseMode = "terminal";
      await endServeResponse(task);
      completeRequest(task);
      return null;
    });
  }
  if (operation === "serve.fail") {
    if (args.length !== 1) throw new TypeError("serve.fail arguments are invalid");
    const task = requestHandle(args[0]);
    return withRequest(task, async () => { task.responseMode = "terminal"; opaqueFailure(task); return null; });
  }
  throw new TypeError("Unknown Node host operation");
}

// D50 rule 89: the operating system's errno vocabulary is not an API — it is
// evidence. These are the failures whose recovery differs (create the file,
// request access, take the other branch on kind, choose another name, choose
// another port); everything else stays an ordinary Error, because a caller
// writes the same recovery for all of it: none.
const namedFailures = new Map([
  ["ENOENT", "FileNotFoundError"],
  ["EACCES", "PermissionError"],
  ["EPERM", "PermissionError"],
  ["ENOTDIR", "NotADirectoryError"],
  ["EEXIST", "FileExistsError"],
  ["EADDRINUSE", "AddressInUseError"],
]);

function errorRecord(error) {
  if (error instanceof HttpTransportFailure) return {name: "HttpTransportError", message: error.message, phase: error.phase};
  const message = error instanceof Error && typeof error.message === "string" && error.message.length > 0
    ? error.message.slice(0, 65536)
    : "Node host operation failed";
  const failure = error && typeof error === "object" && typeof error.code === "string" ? namedFailures.get(error.code) : undefined;
  if (failure === "AddressInUseError") return {name: failure, message};
  if (failure) return {name: failure, message, path: typeof error.path === "string" ? error.path.slice(0, 65536) : ""};
  const name = error instanceof RangeError ? "RangeError" : error instanceof TypeError ? "TypeError" : "Error";
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
    result => {
      const message = {kind: "response", id, ok: true, value: result, error: null};
      if ((value?.operation === "serve.bodyBytes" || value?.operation === "serve.readFile") && result?.data instanceof Uint8Array && result.data.byteLength > 0) {
        let data = result.data;
        if (data.byteOffset !== 0 || data.buffer.byteLength !== data.byteLength) data = new Uint8Array(data);
        result.data = data;
        try { port.postMessage(message, [data.buffer]); }
        finally { if (value.operation === "serve.readFile") releaseTransientServeBytes(data.byteLength); }
      } else port.postMessage(message);
    },
    error => port.postMessage({kind: "response", id, ok: false, value: null, error: errorRecord(error)}),
  );
});
port.on("close", () => {
  for (const task of fileWatchers.values()) closeFileWatcher(task);
});
port.start();
port.postMessage({kind: "ready"});
`.trimStart();
