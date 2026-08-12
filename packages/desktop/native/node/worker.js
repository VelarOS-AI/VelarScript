import { constants as fsConstants, watch as watchNode } from "node:fs";
import { access, appendFile, copyFile as copyNodeFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const MAX_MESSAGE_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LIST_TEXT_UNITS = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_HTTP_CHUNKS = 1000000;
const MAX_HTTP_REDIRECTS = 20;
const MAX_PATH_UNITS = 4096;
const MAX_FILE_WATCHERS = 128;
const MAX_WATCH_PATHS = 4096;
const MAX_WATCH_TEXT_UNITS = 2 * 1024 * 1024;
const MAX_LANGUAGE_SERVER_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_LANGUAGE_SERVER_QUEUED_BYTES = 64 * 1024 * 1024;
const MAX_LANGUAGE_SERVERS = 4;
const WATCH_DEBOUNCE_MS = 20;
const PROCESS_STOP_CONFIRMATION_TIMEOUT_MS = 5000;
const PROCESS_EXIT_PIPE_CONFIRMATION_TIMEOUT_MS = 5000;
const FATAL_DRAIN_TIMEOUT_MS = 8000;
const processTerminationMarker = Object.freeze({});
const processRootExitMarker = Object.freeze({});
const processStopMarker = Object.freeze({});
const transportCharCodeAt = Object.getOwnPropertyDescriptor(String.prototype, "charCodeAt")?.value;
const transportReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const [configPath, appDataRoot, launchRoot] = process.argv.slice(2);
if (!configPath || !appDataRoot || !launchRoot) throw new Error("Velar Desktop worker requires config, app-data, and launch roots");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.protocolVersion !== 1 || !config.permissions || typeof config.permissions !== "object") throw new Error("Invalid Velar Desktop worker configuration");
const fileScopes = new Set(config.permissions.files ?? []);
const allowedProcesses = new Set(config.permissions.processes ?? []);
const allowedOrigins = new Set(config.permissions.network ?? []);
const allowedSecrets = new Set(config.permissions.secrets ?? []);
const processHandles = new Map();
let nextProcessHandle = 1;
const httpHandles = new Map();
const activeRequests = new Map();
const fileMutationTails = new Map();
const fileWatchers = new Map();
let nextFileWatcherHandle = 1;
const languageServers = new Map();
let nextLanguageServerHandle = 1_000_000_000;
let nextTextReplacementIdentity = 1;
let fatalDrainStarted = false;
let activeOwner = null;
const roots = [];
const lexicalRoots = [];
let appDataCanonicalRoot = null;
let appDataLexicalRoot = null;
let projectRoot = null;
let projectLexicalRoot = null;
let projectRootUpdate = Promise.resolve();
let languageServerPath = null;

class HttpTransportFailure extends Error {
  constructor(phase) {
    super(phase === "request" ? "HTTP request transport failed" : "HTTP response transport failed");
    this.name = "HttpTransportError";
    this.phase = phase;
  }
}
const launchDirectory = await realpath(launchRoot);
if (config.languageServer !== undefined) {
  if (!config.languageServer || typeof config.languageServer !== "object" || Array.isArray(config.languageServer)
    || Object.keys(config.languageServer).some(key => key !== "path")
    || config.languageServer.path !== "host/language-server.js") throw new Error("Invalid bundled language-server configuration");
  const candidate = resolve(dirname(configPath), config.languageServer.path);
  languageServerPath = await realpath(candidate);
  if (!(await stat(languageServerPath)).isFile()) throw new Error("Bundled language server must be an ordinary file");
}
if (fileScopes.has("app-data")) {
  const dataRoot = resolve(appDataRoot, "data");
  await mkdir(dataRoot, { recursive: true });
  appDataLexicalRoot = dataRoot;
  appDataCanonicalRoot = await realpath(dataRoot);
}
if (fileScopes.has("project")) {
  projectLexicalRoot = resolve(launchRoot);
  projectRoot = launchDirectory;
}
rebuildFileRoots();

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
reader.once("close", () => {
  if (activeOwner !== null) retireOwner(activeOwner);
  for (const task of fileWatchers.values()) releaseFileWatcher(task, new Error("Desktop capability host closed"));
  for (const task of languageServers.values()) releaseLanguageServer(task, new Error("Desktop capability host closed"));
  for (const activity of activeRequests.values()) cancelActivity(activity);
});
reader.on("line", async (line) => {
  let id = 0;
  let activity = null;
  try {
    if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) throw new RangeError("Desktop request exceeds its 128 MiB transport bound");
    const request = JSON.parse(line);
    if (request?.hostCommand !== undefined) {
      await handleHostCommand(request);
      return;
    }
    id = request.id;
    if (request.protocolVersion !== 1 || !Number.isSafeInteger(id) || id < 1
      || typeof request.capability !== "string" || typeof request.operation !== "string" || !Array.isArray(request.args)
      || !validOwner(request.owner) || request.owner !== activeOwner) {
      throw new TypeError("Invalid Desktop worker request");
    }
    if (activeRequests.has(id)) throw new Error("Desktop worker request identity is already active");
    activity = { owner: request.owner, cancelled: false, cancel: null };
    activeRequests.set(id, activity);
    const value = await dispatch(request.capability, request.operation, request.args, request.owner, activity);
    if (activity.cancelled) throw new Error("Desktop host request was cancelled");
    if (request.owner !== activeOwner) throw new Error("Desktop document generation is no longer active");
    respond({ id, ok: true, value });
  } catch (error) {
    respond({ id, ok: false, error: safeError(error) });
  } finally {
    if (activity !== null && activeRequests.get(id) === activity) activeRequests.delete(id);
  }
});

async function handleHostCommand(request) {
  if (request.protocolVersion !== 1 || !validOwner(request.owner)) {
    throw new TypeError("Invalid Desktop host command");
  }
  if (request.hostCommand === "owner-activate") {
    if (Object.keys(request).some((key) => !["protocolVersion", "hostCommand", "owner"].includes(key))) throw new TypeError("Invalid Desktop host command");
    if (activeOwner !== null && activeOwner !== request.owner) retireOwner(activeOwner);
    activeOwner = request.owner;
    return;
  }
  if (request.hostCommand === "owner-retire") {
    if (Object.keys(request).some((key) => !["protocolVersion", "hostCommand", "owner"].includes(key))) throw new TypeError("Invalid Desktop host command");
    retireOwner(request.owner);
    return;
  }
  if (request.hostCommand === "request-cancel") {
    if (Object.keys(request).some((key) => !["protocolVersion", "hostCommand", "owner", "requestID"].includes(key))
      || !Number.isSafeInteger(request.requestID) || request.requestID < 1) throw new TypeError("Invalid Desktop host command");
    const activity = activeRequests.get(request.requestID);
    if (activity && activity.owner === request.owner) cancelActivity(activity);
    return;
  }
  if (request.hostCommand === "project-root-set") {
    if (Object.keys(request).some((key) => !["protocolVersion", "hostCommand", "owner", "commandID", "path"].includes(key))
      || request.owner !== activeOwner || !Number.isSafeInteger(request.commandID) || request.commandID < 1
      || typeof request.path !== "string" || !isAbsolute(request.path) || request.path.length === 0
      || request.path.length > MAX_PATH_UNITS || request.path.includes("\0") || !fileScopes.has("project")) {
      throw new TypeError("Invalid Desktop project-root command");
    }
    const update = projectRootUpdate.then(() => replaceProjectRoot(request.path));
    projectRootUpdate = update.catch(() => {});
    try {
      await update;
      respond({ protocolVersion: 1, hostEvent: "project-root-settled", owner: request.owner, commandID: request.commandID, ok: true });
    } catch (error) {
      respond({ protocolVersion: 1, hostEvent: "project-root-settled", owner: request.owner, commandID: request.commandID, ok: false, error: safeError(error) });
    }
    return;
  }
  throw new TypeError("Unknown Desktop host command");
}

function cancelActivity(activity) {
  if (activity.cancelled) return;
  activity.cancelled = true;
  try { activity.cancel?.(); } catch {}
}

function validOwner(value) {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}

async function dispatch(capability, operation, args, owner, activity) {
  await projectRootUpdate;
  if (capability === "fs") return fsOperation(operation, args, owner, activity);
  if (capability === "process") {
    if (operation === "run") return processRun(args, owner, activity);
    if (operation === "start") return processStart(args, owner, activity);
    if (operation === "read") return processRead(args, owner);
    if (operation === "wait") return processWait(args, owner);
    if (operation === "stop") return processStop(args, owner);
  }
  if (capability === "language-server") return languageServerOperation(operation, args, owner, activity);
  if (capability === "http") {
    if (operation === "request") return httpRequest(args, owner, activity);
    if (operation === "read") return httpRead(args, owner);
    if (operation === "cancel") return httpCancel(args, owner);
  }
  throw new Error(`Unknown Desktop capability '${capability}.${operation}'`);
}

function rebuildFileRoots() {
  roots.length = 0;
  lexicalRoots.length = 0;
  if (appDataCanonicalRoot !== null && appDataLexicalRoot !== null) {
    roots.push(appDataCanonicalRoot);
    lexicalRoots.push(appDataLexicalRoot);
  }
  if (projectRoot !== null && projectLexicalRoot !== null) {
    roots.push(projectRoot);
    lexicalRoots.push(projectLexicalRoot);
  }
}

async function replaceProjectRoot(path) {
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new TypeError("Desktop project grant must identify a directory");
  for (const task of fileWatchers.values()) releaseFileWatcher(task, new Error("Desktop project grant changed"));
  for (const task of languageServers.values()) releaseLanguageServer(task, new Error("Desktop project grant changed"));
  for (const activity of activeRequests.values()) cancelActivity(activity);
  for (const [handle, task] of processHandles) retainRetiredProcess(handle, task);
  for (const [handle, request] of httpHandles) {
    request.controller.abort(new Error("Desktop project grant changed"));
    void request.reader?.cancel().catch(() => {});
    finishHttp(handle, request);
  }
  projectLexicalRoot = resolve(path);
  projectRoot = canonical;
  rebuildFileRoots();
}

function allocateFileWatcherHandle() {
  let candidate = nextFileWatcherHandle;
  for (let attempts = 0; attempts <= MAX_FILE_WATCHERS; attempts += 1) {
    if (!fileWatchers.has(candidate)) {
      nextFileWatcherHandle = candidate >= Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
      return candidate;
    }
    candidate = candidate >= Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
  }
  throw new RangeError("Desktop file watcher handle space is unavailable");
}

function releaseFileWatcher(task, error = null) {
  if (task.closed) return false;
  task.closed = true;
  if (task.timer !== null) { clearTimeout(task.timer); task.timer = null; }
  try { task.watcher.close(); } catch {}
  fileWatchers.delete(task.handle);
  if (task.pending !== null) {
    const pending = task.pending;
    task.pending = null;
    pending.activity.cancel = null;
    if (error === null) pending.resolve(null);
    else pending.reject(error);
  }
  return true;
}

function fileWatchBatch(task) {
  if (task.rescan) {
    task.rescan = false;
    task.paths.clear();
    task.units = 0;
    return { paths: [], rescan: true };
  }
  const paths = [...task.paths].sort();
  task.paths.clear();
  task.units = 0;
  return { paths, rescan: false };
}

function settleFileWatch(task) {
  if (task.pending === null || task.timer !== null || task.failure !== null || !task.rescan && task.paths.size === 0) return;
  task.timer = setTimeout(() => {
    task.timer = null;
    if (task.pending === null || task.closed) return;
    const pending = task.pending;
    task.pending = null;
    pending.activity.cancel = null;
    pending.resolve(fileWatchBatch(task));
  }, WATCH_DEBOUNCE_MS);
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
    if (typeof filename !== "string" || filename.length === 0 || filename.length > MAX_PATH_UNITS || filename.includes("\0") || isAbsolute(filename)) {
      rescanFileWatch(task);
      return;
    }
    path = resolve(task.root, filename);
    if (!contained(task.root, path) || path.length > MAX_PATH_UNITS) {
      rescanFileWatch(task);
      return;
    }
  }
  if (!task.paths.has(path)) {
    if (task.paths.size >= MAX_WATCH_PATHS || task.units + path.length > MAX_WATCH_TEXT_UNITS) {
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
  task.failure = error instanceof Error ? error : new Error("Desktop file watcher failed");
  if (task.timer !== null) { clearTimeout(task.timer); task.timer = null; }
  try { task.watcher.close(); } catch {}
  if (task.pending !== null) releaseFileWatcher(task, task.failure);
}

async function startFileWatch(args, owner) {
  if (args.length !== 2 || typeof args[1] !== "boolean") throw new TypeError("watchStart arguments are invalid");
  if (fileWatchers.size >= MAX_FILE_WATCHERS) throw new RangeError("Desktop host cannot own more than 128 file watchers");
  const root = await authorizedExisting(args[0]);
  const metadata = await stat(root);
  const directory = metadata.isDirectory();
  if (!directory && !metadata.isFile()) throw new TypeError("watchFiles requires a file or directory path");
  if (args[1] && !directory) throw new TypeError("recursive watchFiles requires a directory path");
  const handle = allocateFileWatcherHandle();
  const task = { handle, owner, root, directory, watcher: null, paths: new Set(), units: 0, rescan: false, pending: null, timer: null, failure: null, closed: false };
  task.watcher = watchNode(root, { recursive: args[1], encoding: "utf8", persistent: true }, (_event, filename) => enqueueFileWatch(task, filename));
  task.watcher.once("error", error => failFileWatch(task, error));
  fileWatchers.set(handle, task);
  return handle;
}

function ownedFileWatcher(value, owner) {
  const handle = integer(value, 1, Number.MAX_SAFE_INTEGER, "Desktop file watcher handle");
  const task = fileWatchers.get(handle);
  if (!task) throw new Error("Desktop file watcher handle is unknown or already released");
  if (task.owner !== owner) throw new Error("Desktop file watcher belongs to another document generation");
  return task;
}

function nextFileWatch(args, owner, activity) {
  if (args.length !== 1) throw new TypeError("watchNext arguments are invalid");
  const task = ownedFileWatcher(args[0], owner);
  if (task.pending !== null) throw new Error("FileWatcher.next already has an active pull");
  if (task.failure !== null) {
    const failure = task.failure;
    releaseFileWatcher(task);
    throw failure;
  }
  if (task.rescan || task.paths.size > 0) return fileWatchBatch(task);
  return new Promise((resolveNext, rejectNext) => {
    const pending = { resolve: resolveNext, reject: rejectNext, activity };
    task.pending = pending;
    activity.cancel = () => {
      if (task.pending === pending) releaseFileWatcher(task, new Error("Desktop file watcher pull was cancelled"));
    };
  });
}

function closeFileWatchHandle(args, owner) {
  if (args.length !== 1) throw new TypeError("watchClose arguments are invalid");
  const handle = integer(args[0], 1, Number.MAX_SAFE_INTEGER, "Desktop file watcher handle");
  const task = fileWatchers.get(handle);
  if (!task) return false;
  if (task.owner !== owner) throw new Error("Desktop file watcher belongs to another document generation");
  return releaseFileWatcher(task);
}

function allocateLanguageServerHandle() {
  let candidate = nextLanguageServerHandle;
  for (let attempts = 0; attempts <= MAX_LANGUAGE_SERVERS; attempts += 1) {
    if (!languageServers.has(candidate)) {
      nextLanguageServerHandle = candidate >= 1_000_000_003 ? 1_000_000_000 : candidate + 1;
      return candidate;
    }
    candidate = candidate >= 1_000_000_003 ? 1_000_000_000 : candidate + 1;
  }
  throw new RangeError("Desktop language-server handle space is unavailable");
}

function ownedLanguageServer(value, owner) {
  const handle = integer(value, 1, Number.MAX_SAFE_INTEGER, "Desktop language-server handle");
  const task = languageServers.get(handle);
  if (!task) throw new Error("Desktop language-server handle is unknown or already released");
  if (task.owner !== owner) throw new Error("Desktop language server belongs to another document generation");
  return task;
}

function settleLanguageServerPull(task) {
  if (task.waiter === null) return;
  if (task.queue.length > 0) {
    const waiter = task.waiter;
    task.waiter = null;
    waiter.activity.cancel = null;
    const value = task.queue.shift();
    task.queuedBytes -= Buffer.byteLength(value, "utf8");
    waiter.resolve(value);
  } else if (task.failure || task.settled) {
    const waiter = task.waiter;
    task.waiter = null;
    waiter.activity.cancel = null;
    if (task.failure) waiter.reject(task.failure);
    else waiter.resolve(null);
  }
}

function failLanguageServer(task, error) {
  if (!task.failure) task.failure = error instanceof Error ? error : new Error("Bundled language server failed");
  settleLanguageServerPull(task);
  signalTree(task.child, "SIGKILL");
}

function enqueueLanguageServerMessage(task, body) {
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes < 1 || bytes > MAX_LANGUAGE_SERVER_MESSAGE_BYTES) {
    failLanguageServer(task, new RangeError("Bundled language-server message exceeds 16 MiB"));
    return;
  }
  if (task.waiter !== null) {
    const waiter = task.waiter;
    task.waiter = null;
    waiter.activity.cancel = null;
    waiter.resolve(body);
    return;
  }
  if (task.queuedBytes + bytes > MAX_LANGUAGE_SERVER_QUEUED_BYTES) {
    failLanguageServer(task, new RangeError("Bundled language-server queue exceeds 64 MiB"));
    return;
  }
  task.queue.push(body);
  task.queuedBytes += bytes;
}

function parseLanguageServerOutput(task, chunk) {
  task.buffer = Buffer.concat([task.buffer, chunk]);
  while (!task.failure) {
    const boundary = task.buffer.indexOf("\r\n\r\n");
    if (boundary === -1) {
      if (task.buffer.byteLength > 64 * 1024) failLanguageServer(task, new RangeError("Bundled language-server header exceeds 64 KiB"));
      return;
    }
    if (boundary > 64 * 1024) { failLanguageServer(task, new RangeError("Bundled language-server header exceeds 64 KiB")); return; }
    const header = task.buffer.subarray(0, boundary).toString("ascii");
    const match = /(?:^|\r\n)Content-Length:\s*(\d+)/iu.exec(header);
    if (!match) { failLanguageServer(task, new Error("Bundled language server emitted an invalid frame")); return; }
    const size = Number(match[1]);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_LANGUAGE_SERVER_MESSAGE_BYTES) {
      failLanguageServer(task, new RangeError("Bundled language-server message exceeds 16 MiB"));
      return;
    }
    const end = boundary + 4 + size;
    if (task.buffer.byteLength < end) return;
    const body = task.buffer.subarray(boundary + 4, end).toString("utf8");
    task.buffer = task.buffer.subarray(end);
    try { JSON.parse(body); }
    catch { failLanguageServer(task, new Error("Bundled language server emitted invalid JSON")); return; }
    enqueueLanguageServerMessage(task, body);
  }
}

async function startLanguageServer(args, owner, activity) {
  if (args.length !== 0) throw new TypeError("languageServer start arguments are invalid");
  if (languageServerPath === null) throw new Error("This Desktop package does not contain an official language server");
  if (projectRoot === null || !fileScopes.has("project")) throw new Error("Desktop language services require the project file grant");
  if (languageServers.size >= MAX_LANGUAGE_SERVERS) throw new RangeError("Desktop cannot own more than 4 language servers");
  const handle = allocateLanguageServerHandle();
  const environment = Object.create(null);
  for (const name of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  const child = spawn(process.execPath, [languageServerPath], {
    cwd: projectRoot,
    env: environment,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const task = { handle, owner, child, buffer: Buffer.alloc(0), queue: [], queuedBytes: 0, waiter: null, stderr: "", settled: false, failure: null, ownershipPublished: false, closed, resolveClosed };
  languageServers.set(handle, task);
  activity.cancel = () => releaseLanguageServer(task, new Error("Desktop language-server start was cancelled"));
  child.stdout.on("data", chunk => parseLanguageServerOutput(task, chunk));
  child.stderr.on("data", chunk => {
    if (task.stderr.length < 64 * 1024) task.stderr += chunk.toString("utf8").slice(0, 64 * 1024 - task.stderr.length);
  });
  child.once("error", error => failLanguageServer(task, error));
  child.once("close", (code, signal) => {
    task.settled = true;
    task.resolveClosed();
    if (!task.failure && code !== 0) task.failure = new Error(`Bundled language server exited with ${code === null ? signal ?? "an unknown signal" : `code ${code}`}${task.stderr ? `: ${task.stderr}` : ""}`);
    settleLanguageServerPull(task);
    if (task.ownershipPublished) respond({ protocolVersion: 1, hostEvent: "language-server-settled", owner, handle });
  });
  try {
    await new Promise((resolveStart, rejectStart) => {
      child.once("spawn", resolveStart);
      child.once("error", rejectStart);
    });
  } catch (error) {
    releaseLanguageServer(task, error instanceof Error ? error : new Error("Bundled language server failed to start"));
    throw error;
  }
  activity.cancel = null;
  task.ownershipPublished = true;
  respond({ protocolVersion: 1, hostEvent: "language-server-owned", owner, handle, pid: child.pid });
  if (activity.cancelled || owner !== activeOwner) {
    releaseLanguageServer(task, new Error("Desktop document generation is no longer active"));
    throw new Error("Desktop document generation is no longer active");
  }
  return handle;
}

async function sendLanguageServer(args, owner) {
  if (args.length !== 2 || typeof args[1] !== "string") throw new TypeError("languageServer send arguments are invalid");
  const task = ownedLanguageServer(args[0], owner);
  if (task.failure) throw task.failure;
  if (task.settled || !task.child.stdin.writable) throw new Error("Bundled language server is closed");
  const bytes = Buffer.byteLength(args[1], "utf8");
  if (bytes < 1 || bytes > MAX_LANGUAGE_SERVER_MESSAGE_BYTES) throw new RangeError("Language-server request exceeds 16 MiB");
  try { JSON.parse(args[1]); }
  catch { throw new TypeError("Language-server request must contain valid JSON"); }
  const frame = `Content-Length: ${bytes}\r\n\r\n${args[1]}`;
  await new Promise((resolveWrite, rejectWrite) => task.child.stdin.write(frame, error => error ? rejectWrite(error) : resolveWrite()));
  return null;
}

function nextLanguageServer(args, owner, activity) {
  if (args.length !== 1) throw new TypeError("languageServer next arguments are invalid");
  const task = ownedLanguageServer(args[0], owner);
  if (task.waiter !== null) throw new Error("LanguageServer.next already has an active pull");
  if (task.queue.length > 0) {
    const value = task.queue.shift();
    task.queuedBytes -= Buffer.byteLength(value, "utf8");
    return value;
  }
  if (task.failure) throw task.failure;
  if (task.settled) return null;
  return new Promise((resolveNext, rejectNext) => {
    const waiter = { resolve: resolveNext, reject: rejectNext, activity };
    task.waiter = waiter;
    activity.cancel = () => {
      if (task.waiter !== waiter) return;
      task.waiter = null;
      waiter.reject(new Error("Desktop language-server pull was cancelled"));
    };
  });
}

function releaseLanguageServer(task, error = null) {
  if (languageServers.get(task.handle) !== task) return false;
  languageServers.delete(task.handle);
  if (task.waiter !== null) {
    const waiter = task.waiter;
    task.waiter = null;
    waiter.activity.cancel = null;
    if (error) waiter.reject(error);
    else waiter.resolve(null);
  }
  try { task.child.stdin.end(); } catch {}
  if (error) signalTree(task.child, "SIGTERM");
  else setTimeout(() => { if (!task.settled) signalTree(task.child, "SIGTERM"); }, 500).unref();
  setTimeout(() => { if (!task.settled) signalTree(task.child, "SIGKILL"); }, 2500).unref();
  return true;
}

async function closeLanguageServer(args, owner) {
  if (args.length !== 1) throw new TypeError("languageServer close arguments are invalid");
  const task = ownedLanguageServer(args[0], owner);
  releaseLanguageServer(task);
  let timer = null;
  try {
    const closed = await Promise.race([
      task.closed.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
    ]);
    if (!closed) {
      signalTree(task.child, "SIGKILL");
      throw new Error("Bundled language server did not close within 5000 milliseconds");
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
  return null;
}

function languageServerOperation(operation, args, owner, activity) {
  if (operation === "start") return startLanguageServer(args, owner, activity);
  if (operation === "send") return sendLanguageServer(args, owner);
  if (operation === "next") return nextLanguageServer(args, owner, activity);
  if (operation === "close") return closeLanguageServer(args, owner);
  throw new Error(`Unknown language-server operation '${operation}'`);
}

async function fsOperation(operation, args, owner, activity) {
  if (operation === "watchStart") return startFileWatch(args, owner);
  if (operation === "watchNext") return nextFileWatch(args, owner, activity);
  if (operation === "watchClose") return closeFileWatchHandle(args, owner);
  if (operation === "readText") {
    const [path, maximum = MAX_FILE_BYTES] = args;
    const data = await boundedFile(path, maximum, "readText");
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  }
  if (operation === "readBlob") {
    const [path, maximum = MAX_FILE_BYTES] = args;
    return { base64: (await boundedFile(path, maximum, "readBlob")).toString("base64") };
  }
  if (operation === "exists") {
    try { await authorizedExisting(args[0]); return true; }
    catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  }
  if (operation === "list") {
    const maximum = integer(args[1] ?? 100000, 1, 100000, "list maxItems");
    const names = await readdir(await authorizedExisting(args[0]));
    if (names.length > maximum) throw new RangeError("list result exceeds maxItems");
    let units = 0;
    for (const name of names) {
      units += name.length;
      if (units > MAX_LIST_TEXT_UNITS) throw new RangeError("list result cannot exceed 2 MiB of text");
    }
    return names.sort();
  }
  if (operation === "info") {
    let path;
    try { path = await authorizedEntry(args[0]); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    const metadata = await lstat(path);
    return { name: basename(path), kind: metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : metadata.isSymbolicLink() ? "symlink" : "other", size: metadata.size, modifiedAt: metadata.mtimeMs };
  }
  if (operation === "canonical") return authorizedExisting(args[0]);
  if (operation === "makeDirectory") { await mkdir(await authorizedDirectoryTarget(args[0]), { recursive: true }); return null; }
  if (operation === "createText") {
    const path = await authorizedTarget(args[0]);
    const text = textValue(args[1], "createText text", MAX_FILE_BYTES);
    return withFileMutations([path], async () => {
      try { await writeFile(path, text, {encoding: "utf8", flag: "wx"}); }
      catch (error) {
        if (error?.code === "EEXIST") throw new Error("createText target already exists");
        throw error;
      }
      return null;
    });
  }
  if (operation === "replaceTextIfMatches") {
    const path = await authorizedExisting(args[0]);
    const expected = Buffer.from(textValue(args[1], "replaceTextIfMatches expected text", MAX_FILE_BYTES), "utf8");
    const replacement = Buffer.from(textValue(args[2], "replaceTextIfMatches replacement text", MAX_FILE_BYTES), "utf8");
    return withFileMutations([path], async () => {
      const metadata = await stat(path);
      if (!metadata.isFile()) throw new TypeError("replaceTextIfMatches requires a file path");
      if (metadata.size > MAX_FILE_BYTES) throw new RangeError("replaceTextIfMatches file exceeds 16 MiB");
      const current = await readFile(path);
      if (current.byteLength > MAX_FILE_BYTES) throw new RangeError("replaceTextIfMatches file exceeds 16 MiB");
      if (!current.equals(expected)) return false;
      await commitTextReplacement(path, replacement, metadata.mode);
      return true;
    });
  }
  if (operation === "writeText" || operation === "appendText") {
    const path = await authorizedTarget(args[0]);
    const text = textValue(args[1], `${operation} text`, MAX_FILE_BYTES);
    return withFileMutations([path], async () => {
      const existing = await stat(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
      if (existing && !existing.isFile()) throw new TypeError(`${operation} requires a file path`);
      if (operation === "writeText") await writeFile(path, text, "utf8");
      else {
        if (existing && existing.size + Buffer.byteLength(text, "utf8") > MAX_FILE_BYTES) throw new RangeError("appendText result cannot exceed 16 MiB");
        await appendFile(path, text, "utf8");
      }
      return null;
    });
  }
  if (operation === "copyFile") {
    const source = await authorizedExisting(args[0]);
    if (!(await stat(source)).isFile()) throw new TypeError("copyFile requires a regular file source");
    const target = await authorizedTarget(args[1]);
    return withFileMutations([target], async () => {
      if (args[2] !== true) await absent(target, "copyFile");
      await copyNodeFile(source, target);
      return null;
    });
  }
  if (operation === "move") {
    const source = await authorizedEntry(args[0]);
    if (roots.includes(source)) throw new Error("move refuses a granted Desktop file root");
    const target = await authorizedEntry(args[1], true);
    return withFileMutations([source, target], async () => {
      if (args[2] !== true) await absent(target, "move");
      else await rm(target, { force: true, recursive: false });
      await rename(source, target);
      return null;
    });
  }
  if (operation === "removeFile") {
    const path = await authorizedEntry(args[0]);
    return withFileMutations([path], async () => {
      if ((await lstat(path)).isDirectory()) throw new TypeError("removeFile refuses directories");
      await rm(path, { recursive: false, force: false });
      return null;
    });
  }
  throw new Error(`Unknown filesystem operation '${operation}'`);
}

async function boundedFile(path, maximum, operation) {
  maximum = integer(maximum, 1, MAX_FILE_BYTES, `${operation} maxBytes`);
  path = await authorizedExisting(path);
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new TypeError(`${operation} requires a file path`);
  if (metadata.size > maximum) throw new RangeError(`${operation} file exceeds maxBytes`);
  const data = await readFile(path);
  if (data.byteLength > maximum) throw new RangeError(`${operation} file exceeds maxBytes`);
  return data;
}

async function authorizedExisting(input) {
  const candidate = pathValue(input);
  // Authorize the lexical path before touching the filesystem so an
  // out-of-scope missing path cannot be disguised as an ordinary ENOENT.
  authorizeLexical(candidate);
  const canonical = await realpath(candidate);
  authorize(canonical);
  return canonical;
}

async function authorizedTarget(input) {
  const candidate = pathValue(input);
  try { return await authorizedExisting(candidate); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    try {
      await lstat(candidate);
      throw new Error("Filesystem write target cannot be a dangling symbolic link");
    } catch (entryError) {
      if (entryError?.code !== "ENOENT") throw entryError;
    }
    const parent = await realpath(dirname(candidate));
    authorize(parent);
    return resolve(parent, basename(candidate));
  }
}

async function authorizedEntry(input, allowMissing = false) {
  const candidate = pathValue(input);
  authorizeLexical(candidate);
  for (let index = 0; index < lexicalRoots.length; index += 1) {
    if (candidate === lexicalRoots[index] || candidate === roots[index]) {
      if (!allowMissing) await lstat(roots[index]);
      return roots[index];
    }
  }
  const parent = await realpath(dirname(candidate));
  authorize(parent);
  const entry = resolve(parent, basename(candidate));
  authorize(entry);
  if (!allowMissing) await lstat(entry);
  return entry;
}

async function authorizedDirectoryTarget(input) {
  const candidate = pathValue(input);
  authorizeLexical(candidate);
  const missing = [];
  let probe = candidate;
  while (true) {
    try {
      const metadata = await lstat(probe);
      if (metadata.isSymbolicLink() && missing.length === 0) throw new TypeError("makeDirectory refuses a symbolic-link target");
      const canonical = await realpath(probe);
      authorize(canonical);
      if (!(await stat(canonical)).isDirectory()) throw new TypeError("makeDirectory requires every existing ancestor to be a directory");
      let target = canonical;
      for (let index = missing.length - 1; index >= 0; index -= 1) target = resolve(target, missing[index]);
      authorize(target);
      return target;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(probe);
      if (parent === probe) throw error;
      missing.push(basename(probe));
      probe = parent;
    }
  }
}

function pathValue(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_UNITS || value.includes("\0")) throw new TypeError("Filesystem operation requires a bounded path");
  const base = projectRoot ?? roots[0];
  if (!base) throw new Error("Desktop application has no granted filesystem scope");
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

function authorize(path) {
  if (!roots.some((root) => contained(root, path))) throw new Error("Filesystem path is outside granted Desktop file roots");
}

function authorizeLexical(path) {
  if (![...lexicalRoots, ...roots].some((root) => contained(root, path))) throw new Error("Filesystem path is outside granted Desktop file roots");
}

function contained(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith("../") && !isAbsolute(path));
}

async function absent(path, operation) {
  try { await lstat(path); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  throw new Error(`${operation} target already exists`);
}

async function withFileMutations(paths, action) {
  const identities = [...new Set(paths.map(path => resolve(path)))].sort();
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

async function commitTextReplacement(path, data, mode) {
  let temporary = null;
  for (let attempts = 0; attempts < 1024; attempts += 1) {
    const identity = nextTextReplacementIdentity;
    nextTextReplacementIdentity = nextTextReplacementIdentity >= Number.MAX_SAFE_INTEGER ? 1 : nextTextReplacementIdentity + 1;
    const candidate = resolve(dirname(path), `.velar-replace-${identity}.tmp`);
    try {
      await writeFile(candidate, data, {flag: "wx", mode});
      temporary = candidate;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  if (temporary === null) throw new Error("replaceTextIfMatches could not allocate a temporary file");
  try { await rename(temporary, path); }
  finally { await rm(temporary, {force: true, recursive: false}); }
}

async function processRun(args, owner, activity) {
  const started = await processStart(args, owner, activity);
  const outcome = await processWait([started.handle], owner);
  if (outcome.retained) {
    retainRunHandle(started.handle, owner);
    throw processError(outcome.error);
  }
  if (outcome.error) throw processError(outcome.error);
  return outcome.result;
}

function retainRunHandle(handle, owner) {
  const retry = () => {
    processStop([handle], owner).catch(() => { setTimeout(retry, 1000); });
  };
  setTimeout(retry, 0);
}

async function processStart(args, owner, activity) {
  if (processHandles.size >= 128) throw new RangeError("Desktop process handle limit reached");
  if (activity.cancelled) throw new Error("Desktop host request was cancelled");
  const handle = nextProcessHandle++;
  let task = null;
  activity.cancel = () => { if (task !== null) retainRetiredProcess(handle, task); };
  task = await launchProcess(args, () => respond({ protocolVersion: 1, hostEvent: "process-settled", owner, handle }));
  task.owner = owner;
  processHandles.set(handle, task);
  // The native shell becomes the crash-recovery owner before the renderer
  // receives the public start/run result.
  respond({ protocolVersion: 1, hostEvent: "process-owned", owner, handle, pid: task.pid });
  // A caller may start before it waits. Keep rejection observed while the
  // explicit wait/stop operation still owns delivery and handle release.
  task.result.catch(() => {});
  if (activity.cancelled || owner !== activeOwner) {
    retainRetiredProcess(handle, task);
    throw new Error("Desktop document generation is no longer active");
  }
  return { handle, pid: task.pid };
}

async function processWait(args, owner) {
  const [handle, task] = ownedProcess(args[0], owner);
  if (task.reading) throw new Error("Process wait() cannot run while next() is pending");
  task.waitStarted = true;
  if (task.waitRetained && !task.settled) signalTree(task.child, "SIGKILL");
  const outcome = await waitForTask(task);
  task.waitRetained = outcome.retained;
  if (!outcome.retained) processHandles.delete(handle);
  return outcome;
}

async function processRead(args, owner) {
  const [, task] = ownedProcess(args[0], owner);
  return task.next();
}

async function processStop(args, owner) {
  const handle = processHandle(args[0]);
  const task = processHandles.get(handle);
  if (!task) return { result: null, error: null };
  if (task.owner !== owner) throw new Error("Desktop process handle belongs to another document generation");
  task.stop();
  const outcome = await waitForTask(task);
  if (outcome.retained) throw processError(outcome.error);
  processHandles.delete(handle);
  return { result: outcome.result, error: outcome.error };
}

function ownedProcess(value, owner) {
  const handle = processHandle(value);
  const task = processHandles.get(handle);
  if (!task) throw new Error("Desktop process handle is unknown or already released");
  if (task.owner !== owner) throw new Error("Desktop process handle belongs to another document generation");
  return [handle, task];
}

function retainRetiredProcess(handle, task) {
  if (task.retirementStarted) return;
  task.retirementStarted = true;
  task.stop();
  const retry = async () => {
    try {
      const outcome = await waitForTask(task);
      if (outcome.retained) throw processError(outcome.error);
      if (processHandles.get(handle) === task) processHandles.delete(handle);
    } catch {
      setTimeout(retry, 1000);
    }
  };
  void retry();
}

function retireOwner(owner) {
  if (activeOwner === owner) activeOwner = null;
  for (const task of fileWatchers.values()) {
    if (task.owner === owner) releaseFileWatcher(task, new Error("Desktop document generation retired"));
  }
  for (const activity of activeRequests.values()) if (activity.owner === owner) cancelActivity(activity);
  for (const task of languageServers.values()) {
    if (task.owner === owner) releaseLanguageServer(task, new Error("Desktop document generation retired"));
  }
  for (const [handle, task] of processHandles) {
    if (task.owner === owner) retainRetiredProcess(handle, task);
  }
  for (const [handle, request] of httpHandles) {
    if (request.owner !== owner) continue;
    request.controller.abort(new Error("Desktop document generation retired"));
    void request.reader?.cancel().catch(() => {});
    finishHttp(handle, request);
  }
}

async function fatalDrain() {
  if (fatalDrainStarted) return;
  fatalDrainStarted = true;
  reader.removeAllListeners("line");
  reader.close();
  for (const task of fileWatchers.values()) releaseFileWatcher(task, new Error("Desktop capability host failed"));
  for (const task of languageServers.values()) releaseLanguageServer(task, new Error("Desktop capability host failed"));
  const tasks = Array.from(processHandles.values());
  for (const task of tasks) task.stop();
  for (const request of httpHandles.values()) request.controller.abort(new Error("Desktop capability host failed"));
  let timer = null;
  try {
    await Promise.race([
      Promise.allSettled(tasks.map((task) => task.result)),
      new Promise((resolveDrain) => { timer = setTimeout(resolveDrain, FATAL_DRAIN_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    for (const task of tasks) if (!task.settled) signalTree(task.child, "SIGKILL");
    process.exit(1);
  }
}

function processErrorRecord(error) {
  const name = error instanceof TypeError ? "TypeError" : error instanceof RangeError ? "RangeError" : "Error";
  let message = error instanceof Error ? error.message : "Desktop process failed";
  if (typeof message !== "string" || message.length === 0) message = "Desktop process failed";
  if (message.length > 65536) message = message.slice(0, 65536);
  return { name, message };
}

function processError(value) {
  if (value.name === "TypeError") return new TypeError(value.message);
  if (value.name === "RangeError") return new RangeError(value.message);
  return new Error(value.message);
}

function terminalProcessOutcome(task) {
  return task.result.then(
    (result) => ({ result, error: null, retained: false }),
    (failure) => ({ result: null, error: processErrorRecord(failure), retained: false }),
  );
}

async function processConfirmationOutcome(terminal) {
  let timer = null;
  const confirmationFailure = new Error(`Process termination could not be confirmed within ${PROCESS_STOP_CONFIRMATION_TIMEOUT_MS} milliseconds`);
  try {
    return await Promise.race([
      terminal,
      new Promise((resolveOutcome) => {
        timer = setTimeout(
          () => resolveOutcome({ result: null, error: processErrorRecord(confirmationFailure), retained: true }),
          PROCESS_STOP_CONFIRMATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitForTask(task) {
  const terminal = terminalProcessOutcome(task);
  if (!task.terminationRequested) {
    const first = await Promise.race([terminal, task.termination.then(() => processTerminationMarker)]);
    if (first !== processTerminationMarker) return first;
  }
  if (task.rootExited && !task.stopping) {
    const afterExit = await Promise.race([terminal, task.stopRequest.then(() => processStopMarker)]);
    if (afterExit !== processStopMarker) return afterExit;
    return await processConfirmationOutcome(terminal);
  }
  const confirmation = processConfirmationOutcome(terminal);
  const first = await Promise.race([
    terminal,
    confirmation,
    task.stopping ? new Promise(() => {}) : task.rootExit.then(() => processRootExitMarker),
  ]);
  if (first !== processRootExitMarker) return first;
  if (task.stopping) return await confirmation;
  const afterExit = await Promise.race([terminal, task.stopRequest.then(() => processStopMarker)]);
  if (afterExit !== processStopMarker) return afterExit;
  return await processConfirmationOutcome(terminal);
}

function processHandle(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Desktop process handle is invalid");
  return value;
}

async function launchProcess(args, settled) {
  const [command, commandArgs = [], options = {}] = args;
  if (typeof command !== "string" || !allowedProcesses.has(command) || command !== basename(command)) throw new Error(`Process '${String(command)}' is not granted by desktop.permissions.processes`);
  if (!Array.isArray(commandArgs) || commandArgs.length > 1000) throw new TypeError("Process args must be a bounded List<string>");
  let argumentUnits = 0;
  for (const item of commandArgs) {
    if (typeof item !== "string" || item.length === 0 || item.includes("\0") || item.length > 1024 * 1024) throw new TypeError("Process args must be a bounded List<string>");
    argumentUnits += item.length;
    if (argumentUnits > 1024 * 1024) throw new RangeError("Process arguments cannot exceed 1 MiB");
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Process options must be a record");
  const allowedOptionFields = new Set(["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
  for (const key of Object.keys(options)) if (!allowedOptionFields.has(key)) throw new TypeError(`Process options has unknown field '${key}'`);
  const timeout = integer(options.timeout ?? 120000, 0, 600000, "Process timeout");
  const maxOutputBytes = integer(options.maxOutputBytes ?? 4 * 1024 * 1024, 1, 16 * 1024 * 1024, "Process maxOutputBytes");
  const cwd = options.cwd == null ? projectRoot ?? launchDirectory : await authorizedExisting(options.cwd);
  const stdin = options.stdin ?? "";
  textValue(stdin, "Process stdin", 16 * 1024 * 1024);
  const environment = Object.create(null);
  for (const name of ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TERM", "TMPDIR", "USER"]) if (typeof process.env[name] === "string") environment[name] = process.env[name];
  if (options.env != null) {
    if (!Array.isArray(options.env) || options.env.length > 1000) throw new TypeError("Process env must be Map<string, string>");
    let environmentUnits = 0;
    for (const pair of options.env) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(pair[0]) || pair[0] === "PATH" || typeof pair[1] !== "string" || pair[1].includes("\0")) throw new TypeError("Process env must contain valid string variables and cannot replace PATH");
      environmentUnits += pair[0].length + pair[1].length;
      if (environmentUnits > 1024 * 1024) throw new RangeError("Process env cannot exceed 1 MiB");
      environment[pair[0]] = pair[1];
    }
  }
  const executable = await resolveExecutable(command, environment.PATH ?? "");
  const child = spawn(executable, commandArgs, {
    cwd,
    env: environment,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  let resolveTermination;
  const termination = new Promise((resolveTerminationRequest) => { resolveTermination = resolveTerminationRequest; });
  let resolveRootExit;
  const rootExit = new Promise((resolveRootExitRequest) => { resolveRootExit = resolveRootExitRequest; });
  let resolveStopRequest;
  const stopRequest = new Promise((resolveStopRequestValue) => { resolveStopRequest = resolveStopRequestValue; });
  const task = {
    child,
    pid: child.pid ?? 0,
    settled: false,
    stopping: false,
    terminationRequested: false,
    termination,
    rootExited: false,
    rootExit,
    stopRequest,
    stdout: [],
    stderr: [],
    bytes: 0,
    outputChunks: 0,
    outputQueue: [],
    outputWaiter: null,
    reading: false,
    waitStarted: false,
    waitRetained: false,
    stdoutDecoder: new StringDecoder("utf8"),
    stderrDecoder: new StringDecoder("utf8"),
    failure: null,
    timer: null,
    exitTimer: null,
    result: null,
    terminate(failure, signal) {
      if (failure && !task.failure) task.failure = failure;
      if (!task.terminationRequested) {
        task.terminationRequested = true;
        resolveTermination();
      }
      if (task.outputWaiter) {
        const waiter = task.outputWaiter;
        task.outputWaiter = null;
        waiter.reject(task.failure ?? new Error("Process output is unavailable after stop()"));
      }
      signalTree(child, signal);
    },
    stop() {
      if (task.settled) return;
      if (task.stopping) {
        signalTree(child, "SIGKILL");
        return;
      }
      task.stopping = true;
      resolveStopRequest();
      if (task.exitTimer) {
        clearTimeout(task.exitTimer);
        task.exitTimer = null;
      }
      task.terminate(null, "SIGTERM");
      setTimeout(() => { if (!task.settled) signalTree(child, "SIGKILL"); }, 2000).unref();
    },
    async next() {
      if (task.waitStarted) throw new Error("Process output must be consumed before wait()");
      if (task.stopping) throw new Error("Process output is unavailable after stop()");
      if (task.terminationRequested) throw task.failure ?? new Error("Process output is unavailable after termination");
      if (task.reading) throw new Error("Process.next() allows only one active pull");
      task.reading = true;
      try {
        if (task.outputQueue.length > 0) return task.outputQueue.shift();
        if (task.settled) {
          if (task.failure) throw task.failure;
          return null;
        }
        return await new Promise((resolveOutput, rejectOutput) => { task.outputWaiter = { resolve: resolveOutput, reject: rejectOutput }; });
      } finally {
        task.reading = false;
      }
    },
  };
  task.result = new Promise((resolveRun, rejectRun) => {
    const deliver = (channel, text) => {
      if (text.length === 0 || task.failure) return;
      task.outputChunks += 1;
      if (task.outputChunks > 1000000) {
        task.terminate(new RangeError("Process output cannot exceed 1000000 chunks"), "SIGKILL");
        return;
      }
      const value = Object.freeze({ channel, text });
      if (task.outputWaiter) {
        const waiter = task.outputWaiter;
        task.outputWaiter = null;
        waiter.resolve(value);
      } else task.outputQueue.push(value);
    };
    const collect = (target, decoder, channel, chunk) => {
      if (task.failure) return;
      task.bytes += chunk.byteLength;
      if (task.bytes > maxOutputBytes) {
        task.terminate(new RangeError("Process output exceeded maxOutputBytes"), "SIGKILL");
        return;
      }
      const copy = Buffer.from(chunk);
      target.push(copy);
      deliver(channel, decoder.write(copy));
    };
    child.stdout.on("data", (chunk) => collect(task.stdout, task.stdoutDecoder, "stdout", chunk));
    child.stderr.on("data", (chunk) => collect(task.stderr, task.stderrDecoder, "stderr", chunk));
    child.once("error", (error) => { task.terminate(error, "SIGKILL"); });
    child.once("exit", () => {
      task.rootExited = true;
      resolveRootExit();
      if (!task.stopping) {
        signalTree(child, "SIGTERM");
        setTimeout(() => { if (!task.settled) signalTree(child, "SIGKILL"); }, 2000).unref();
        task.exitTimer = setTimeout(() => {
          if (task.settled) return;
          if (!task.failure) task.failure = new Error(`Process output streams did not close within ${PROCESS_EXIT_PIPE_CONFIRMATION_TIMEOUT_MS} milliseconds after process exit`);
          child.stdout.destroy();
          child.stderr.destroy();
        }, PROCESS_EXIT_PIPE_CONFIRMATION_TIMEOUT_MS);
        task.exitTimer.unref();
      }
    });
    child.once("close", (code, signal) => {
      task.settled = true;
      if (task.timer) clearTimeout(task.timer);
      if (task.exitTimer) clearTimeout(task.exitTimer);
      deliver("stdout", task.stdoutDecoder.end());
      deliver("stderr", task.stderrDecoder.end());
      if (task.outputWaiter) {
        const waiter = task.outputWaiter;
        task.outputWaiter = null;
        if (task.outputQueue.length > 0) waiter.resolve(task.outputQueue.shift());
        else if (task.failure) waiter.reject(task.failure);
        else waiter.resolve(null);
      }
      if (task.failure) rejectRun(task.failure);
      else resolveRun({ code, signal, stdout: Buffer.concat(task.stdout).toString("utf8"), stderr: Buffer.concat(task.stderr).toString("utf8") });
      settled();
    });
  });
  task.timer = timeout === 0 ? null : setTimeout(() => {
    if (task.settled) return;
    task.terminate(new Error(`Process timed out after ${timeout} milliseconds`), "SIGKILL");
  }, timeout);
  child.stdin.end(stdin);
  return task;
}

function signalTree(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try { child.kill(signal); } catch {}
    return;
  }
  try { process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch {} }
}

async function resolveExecutable(name, pathValue) {
  for (const directory of pathValue.split(process.platform === "win32" ? ";" : ":")) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = resolve(directory, name);
    try {
      await access(candidate, fsConstants.X_OK);
      const canonical = await realpath(candidate);
      if (roots.some((root) => contained(root, canonical))) throw new Error(`Process '${name}' resolves inside a writable Desktop file root`);
      return canonical;
    } catch (error) {
      if (error instanceof Error && error.message.includes("writable Desktop file root")) throw error;
    }
  }
  throw new Error(`Granted process '${name}' was not found on the trusted executable path`);
}

async function httpRequest(args, owner, activity) {
  if (activity.cancelled) throw new Error("Desktop host request was cancelled");
  const [handleValue, methodValue, urlValue, options = {}] = args;
  const handle = httpHandle(handleValue);
  if (httpHandles.has(handle)) throw new Error("Desktop HTTP handle is already active");
  if (httpHandles.size >= 128) throw new RangeError("Desktop HTTP handle limit reached");
  if (typeof methodValue !== "string") throw new TypeError("HTTP method must be text");
  const method = methodValue.toUpperCase();
  if (method.length === 0 || method.length > 32 || !/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) {
    throw new TypeError("HTTP method is invalid or forbidden");
  }
  const url = httpUrl(urlValue);
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("HTTP options must be a record");
  const allowedOptionFields = new Set(["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
  for (const key of Object.keys(options)) if (!allowedOptionFields.has(key)) throw new TypeError(`HTTP options has an unknown field '${key}'`);
  const timeout = integer(options.timeout ?? 120000, 0, 600000, "HTTP timeout");
  const maxBytes = integer(options.maxBytes ?? 16 * 1024 * 1024, 1, MAX_RESPONSE_BYTES, "HTTP maxBytes");
  const headers = new Headers();
  if (options.headers != null) {
    if (!Array.isArray(options.headers) || options.headers.length > 100) throw new TypeError("HTTP headers must be Map<string, string>");
    for (const pair of options.headers) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string" || /[\r\n]/u.test(pair[1])) throw new TypeError("HTTP headers are invalid");
      headers.append(pair[0], pair[1]);
    }
  }
  const secretHeaderNames = applySecretHeaders(options.secretHeaders, headers);
  let body = options.body ?? null;
  if (body !== null && typeof body !== "string") throw new TypeError("Desktop HTTP body must be validated text");
  if (body !== null && Buffer.byteLength(body, "utf8") > MAX_FILE_BYTES) throw new RangeError("HTTP body cannot exceed 16 MiB");
  if ((method === "GET" || method === "HEAD") && body !== null) throw new TypeError(`${method} requests cannot have a body`);
  const controller = new AbortController();
  activity.cancel = () => controller.abort(new Error("Desktop host request was cancelled"));
  const request = {
    owner,
    controller,
    reader: null,
    decoder: new TextDecoder("utf-8", { fatal: true }),
    maxBytes,
    bytes: 0,
    chunks: 0,
    declaredTooLarge: false,
    timer: timeout === 0 ? null : setTimeout(() => controller.abort(new Error("HTTP request timed out")), timeout),
  };
  httpHandles.set(handle, request);
  if (activity.cancelled) controller.abort(new Error("Desktop host request was cancelled"));
  let response = null;
  try {
    response = await fetchAuthorized(url, method, headers, secretHeaderNames, body, controller.signal);
    if (owner !== activeOwner) throw new Error("Desktop document generation is no longer active");
    const ok = response.ok;
    const status = response.status;
    const statusText = response.statusText;
    const responseUrl = response.url;
    if (typeof ok !== "boolean" || !Number.isInteger(status) || status < 100 || status > 599
      || ok !== (status >= 200 && status <= 299)) {
      throw new TypeError("Fetch returned invalid HTTP response metadata");
    }
    if (typeof statusText !== "string") throw new TypeError("HTTP response status text must be text");
    if (statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
    if (typeof responseUrl !== "string") throw new TypeError("HTTP response URL must be text");
    if (responseUrl.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
    const responseHeaders = [...response.headers.entries()];
    let headerUnits = 0;
    if (responseHeaders.length > 100) throw new RangeError("HTTP response headers cannot exceed 100 fields");
    for (const [name, value] of responseHeaders) {
      headerUnits += name.length + value.length;
      if (headerUnits > 65536) throw new RangeError("HTTP response headers cannot exceed 64 KiB");
    }
    const hasBody = response.body !== null;
    const declaredLength = transportDeclaredLength(response.headers.get("content-length"));
    request.declaredTooLarge = hasBody && declaredLength !== null && declaredLength > maxBytes;
    request.reader = response.body?.getReader() ?? null;
    if (!hasBody) finishHttp(handle, request);
    return { ok, status, statusText, url: responseUrl, headers: responseHeaders, body: hasBody };
  } catch (error) {
    try { await response?.body?.cancel(error); } catch {}
    finishHttp(handle, request);
    throw error;
  }
}

function applySecretHeaders(value, headers) {
  if (value == null) return new Set();
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("HTTP secretHeaders must be a List with at most 16 entries");
  const forbidden = new Set(["connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
  const names = new Set();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => !["name", "environment", "prefix"].includes(key))
      || typeof item.name !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(item.name)
      || typeof item.environment !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(item.environment)
      || typeof item.prefix !== "string" || item.prefix.length > 256 || /[\r\n]/u.test(item.prefix)) {
      throw new TypeError("HTTP secret header descriptor is invalid");
    }
    const lower = item.name.toLowerCase();
    if (forbidden.has(lower)) throw new TypeError("HTTP secret header name is transport-controlled");
    if (!allowedSecrets.has(item.environment)) throw new Error(`Secret '${item.environment}' is not granted by desktop.permissions.secrets`);
    if (headers.has(item.name) || names.has(lower)) throw new TypeError("HTTP secret header conflicts with another header");
    const secret = process.env[item.environment];
    if (secret === undefined) throw new Error(`Granted Desktop secret '${item.environment}' is unavailable`);
    const headerValue = item.prefix + secret;
    if (/\r|\n/u.test(headerValue) || Buffer.byteLength(headerValue, "utf8") > 65536) throw new RangeError("HTTP secret header value is outside the supported bounds");
    headers.set(item.name, headerValue);
    names.add(lower);
  }
  if ([...headers].length > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  let units = 0;
  for (const [name, item] of headers) {
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
  }
  return names;
}

async function fetchAuthorized(initialUrl, initialMethod, initialHeaders, secretHeaderNames, initialBody, signal) {
  let url = initialUrl;
  let method = initialMethod;
  let headers = initialHeaders;
  let body = initialBody;
  for (let redirects = 0; ; redirects += 1) {
    authorizeOrigin(url);
    let response;
    try { response = await fetch(url, { method, headers, body, signal, redirect: "manual" }); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new HttpTransportFailure("request");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (location === null) return response;
    if (redirects >= MAX_HTTP_REDIRECTS) {
      try { await response.body?.cancel(); } catch {}
      throw new Error(`HTTP redirect limit of ${MAX_HTTP_REDIRECTS} was exceeded`);
    }
    let nextUrl;
    try {
      nextUrl = httpUrl(new URL(location, url).href);
      authorizeOrigin(nextUrl);
    } finally {
      try { await response.body?.cancel(); } catch {}
    }
    if (nextUrl.origin !== url.origin) {
      headers = new Headers(headers);
      for (const name of ["authorization", "proxy-authorization", "cookie", "cookie2", ...secretHeaderNames]) headers.delete(name);
    }
    if (response.status === 303 && method !== "HEAD" || (response.status === 301 || response.status === 302) && method === "POST") {
      method = "GET";
      body = null;
      headers = new Headers(headers);
      headers.delete("content-encoding");
      headers.delete("content-language");
      headers.delete("content-location");
      headers.delete("content-type");
    }
    url = nextUrl;
  }
}

function httpUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024) throw new TypeError("HTTP URL must be bounded text");
  let url;
  try { url = new URL(value); }
  catch { throw new TypeError("HTTP URL must be absolute"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("HTTP URL must use http or https");
  if (url.username || url.password) throw new TypeError("HTTP URL credentials are not allowed");
  return url;
}

function authorizeOrigin(url) {
  if (!allowedOrigins.has(url.origin)) throw new Error(`Network origin '${url.origin}' is not granted by desktop.permissions.network`);
}

async function httpRead(args, owner) {
  const handle = httpHandle(args[0]);
  const request = httpHandles.get(handle);
  if (!request) throw new Error("Desktop HTTP handle is unknown or already released");
  if (request.owner !== owner) throw new Error("Desktop HTTP handle belongs to another document generation");
  try {
    if (request.declaredTooLarge) throw new RangeError("HTTP response exceeds maxBytes");
    if (!request.reader) {
      const tail = request.decoder.decode();
      finishHttp(handle, request);
      return { done: true, text: tail };
    }
    let result;
    try { result = await request.reader.read(); }
    catch (error) {
      if (request.controller.signal.aborted) throw error;
      throw new HttpTransportFailure("response");
    }
    if (owner !== activeOwner) throw new Error("Desktop document generation is no longer active");
    if (result.done) {
      const tail = request.decoder.decode();
      finishHttp(handle, request);
      return { done: true, text: tail };
    }
    if (!(result.value instanceof Uint8Array)) throw new TypeError("HTTP response yielded a non-byte chunk");
    request.bytes += result.value.byteLength;
    request.chunks += 1;
    if (request.bytes > request.maxBytes) throw new RangeError("HTTP response exceeds maxBytes");
    if (request.chunks > MAX_HTTP_CHUNKS) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
    return { done: false, text: request.decoder.decode(result.value, { stream: true }) };
  } catch (error) {
    try { await request.reader?.cancel(error); } catch {}
    finishHttp(handle, request);
    throw error;
  }
}

async function httpCancel(args, owner) {
  const handle = httpHandle(args[0]);
  const request = httpHandles.get(handle);
  if (!request) return null;
  if (request.owner !== owner) throw new Error("Desktop HTTP handle belongs to another document generation");
  request.controller.abort(new Error("HTTP request cancelled"));
  try { await request.reader?.cancel(); } catch {}
  finishHttp(handle, request);
  return null;
}

function httpHandle(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Desktop HTTP handle is invalid");
  return value;
}

function finishHttp(handle, expected) {
  const request = httpHandles.get(handle);
  if (!request || request !== expected) return;
  if (request.timer) clearTimeout(request.timer);
  httpHandles.delete(handle);
}

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} must be an integer from ${minimum} through ${maximum}`);
  return value;
}

function transportDeclaredLength(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (typeof transportCharCodeAt !== "function" || typeof transportReflectApply !== "function") {
    throw new TypeError("The host transport sizing intrinsics are unavailable");
  }
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = transportReflectApply(transportCharCodeAt, value, [index]);
    if (unit < 48 || unit > 57) return null;
    if (length > 900719925474099) return 1 / 0;
    length = length * 10 + unit - 48;
    if (length > 9007199254740991) return 1 / 0;
  }
  return length;
}

function textValue(value, name, maxBytes) {
  if (typeof value !== "string" || value.includes("\0") || Buffer.byteLength(value, "utf8") > maxBytes) throw new RangeError(`${name} is outside the supported bounds`);
  return value;
}

function safeError(error) {
  if (error instanceof HttpTransportFailure) {
    return { kind: "http-transport", message: error.message, phase: error.phase };
  }
  if (error instanceof Error && typeof error.message === "string") return error.message.slice(0, 4096);
  return "Desktop capability failed";
}

function respond(value) {
  const line = JSON.stringify(value);
  if (Buffer.byteLength(line, "utf8") > MAX_RESPONSE_BYTES + MAX_MESSAGE_BYTES) {
    process.stdout.write(`${JSON.stringify({ id: value.id, ok: false, error: "Desktop response exceeds its transport bound" })}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

process.once("exit", () => {
  for (const task of processHandles.values()) signalTree(task.child, "SIGKILL");
  for (const task of languageServers.values()) signalTree(task.child, "SIGKILL");
});
process.on("uncaughtException", () => { void fatalDrain(); });
process.on("unhandledRejection", () => { void fatalDrain(); });
