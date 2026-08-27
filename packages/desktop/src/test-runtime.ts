import { DESKTOP_MAIN_WINDOW_KIND, type VelarDesktopConfig } from "./config.ts";
import { startLoopbackServiceServer, type LoopbackServiceRequest, type LoopbackServiceServer } from "./service-test-server.ts";
import type { FrameworkBrowserTestController } from "@velarscript/compiler/framework-host";

export type DesktopTestPlatform = "macos" | "test";

/**
 * One served fake service: a real loopback WebSocket server, and the real
 * authenticated client connection the host would have opened to it. Both halves
 * are real because the point of the seam is to let a test watch a message leave
 * the application, cross a socket, reach a handler, and come back.
 */
interface ServedFakeService {
  readonly server: LoopbackServiceServer;
  readonly socket: WebSocket;
  readonly inbound: string[];
  readonly waiting: ((message: string | null) => void)[];
  pending: LoopbackServiceRequest | null;
  closed: boolean;
}

/**
 * Owns the one pre-navigation choice a Desktop browser test may make. Each
 * test receives a fresh controller, and the choice is sealed when its first
 * `browser.open()` requests the application init script.
 */
export function desktopBrowserTestController(config: VelarDesktopConfig): FrameworkBrowserTestController {
  let platform: DesktopTestPlatform = "test";
  let windowKind: string = DESKTOP_MAIN_WINDOW_KIND;
  let opened = false;
  const served = new Map<string, ServedFakeService>();
  return Object.freeze({
    initScript() {
      opened = true;
      return desktopBrowserTestInitScript(config, platform, windowKind);
    },
    async invoke(capability: string, operation: string, args: readonly unknown[]) {
      if (capability === "service-test") return { handled: true, value: await fakeService(config, served, operation, args) };
      if (capability !== "desktop-test") return { handled: false };
      if (operation === "setPlatform") {
        if (opened) throw new Error("Desktop test platform must be set before the first browser.open()");
        if (args.length !== 1 || args[0] !== "macos" && args[0] !== "test") {
          throw new TypeError("Desktop test platform must be DesktopPlatform.macos or DesktopPlatform.test");
        }
        platform = args[0];
        return { handled: true, value: null };
      }
      // The window a document belongs to is decided before that document
      // exists, exactly as the platform is: a page cannot move itself into
      // another window kind after it has loaded, and neither can its test.
      if (operation === "setWindowKind") {
        if (opened) throw new Error("Desktop test window kind must be set before the first browser.open()");
        if (args.length !== 1 || typeof args[0] !== "string" || !Object.hasOwn(config.windows, args[0])) {
          throw new Error(`Desktop test window kind must be declared in desktop.windows (declared kinds: ${Object.keys(config.windows).join(", ")})`);
        }
        windowKind = args[0];
        return { handled: true, value: null };
      }
      return { handled: false };
    },
  });
}

/**
 * The half of `serveService` that needs real authority: a real listener, a real
 * upgrade, and the real authenticated client connection the native host would
 * have opened. The handler stays in the test's own VelarScript, driven from
 * `velar/desktop-test` through `accept` and `reply`, so what a test writes is a
 * service and what runs is a socket.
 */
async function fakeService(
  config: VelarDesktopConfig,
  served: Map<string, ServedFakeService>,
  operation: string,
  args: readonly unknown[],
): Promise<unknown> {
  const name = args[0];
  if (typeof name !== "string" || !Object.hasOwn(config.services, name)) {
    throw new Error(`Desktop test serveService cannot serve the undeclared service '${String(name)}'; `
      + `declare it under 'desktop.services' (declared services: ${Object.keys(config.services).join(", ") || "none"})`);
  }
  if (operation === "serve") {
    if (served.has(name)) throw new Error(`Desktop test service '${name}' is already served`);
    const server = await startLoopbackServiceServer();
    const entry: ServedFakeService = {
      server,
      socket: await openAuthenticatedSocket(server.port, server.token),
      inbound: [],
      waiting: [],
      pending: null,
      closed: false,
    };
    entry.socket.addEventListener("message", (event) => {
      const message = typeof event.data === "string" ? event.data : "";
      const next = entry.waiting.shift();
      if (next) next(message);
      else entry.inbound.push(message);
    });
    served.set(name, entry);
    return null;
  }
  const entry = served.get(name);
  if (!entry) throw new Error(`Desktop test service '${name}' is not served; call serveService first`);
  if (operation === "accept") {
    const request = await entry.server.accept();
    if (request === null) return null;
    entry.pending = request;
    return request.message;
  }
  if (operation === "reply") {
    if (typeof args[1] !== "string") throw new TypeError("Desktop test service reply requires text");
    entry.pending?.reply(args[1]);
    entry.pending = null;
    return null;
  }
  if (operation === "roundTrip") {
    if (typeof args[1] !== "string") throw new TypeError("Desktop test service round trip requires text");
    entry.socket.send(args[1]);
    const queued = entry.inbound.shift();
    if (queued !== undefined) return queued;
    return new Promise<string | null>((resolve) => entry.waiting.push(resolve));
  }
  // The proof that the token gates the channel: the same endpoint, a token the
  // host never issued, and a service that ends the connection instead of
  // answering it.
  if (operation === "wrongToken") {
    const refused = entry.server.rejectedHandshakes();
    try {
      await openAuthenticatedSocket(entry.server.port, `${entry.server.token}00`);
    } catch {
      return entry.server.rejectedHandshakes() > refused;
    }
    return false;
  }
  if (operation === "close") {
    entry.closed = true;
    for (const resolve of entry.waiting.splice(0)) resolve(null);
    entry.socket.close();
    await entry.server.close();
    served.delete(name);
    return null;
  }
  throw new Error(`Unsupported Desktop test service operation '${operation}'`);
}

/**
 * The host's side of the handshake, written out once here so that a test proves
 * the same two frames `packages/desktop/README.md` pins and the native host
 * sends.
 */
async function openAuthenticatedSocket(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    const failed = (): void => reject(new Error("The fake service refused the handshake"));
    socket.addEventListener("error", failed, { once: true });
    socket.addEventListener("close", failed, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ velar: "service-hello", token }));
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string" && (JSON.parse(event.data) as { velar?: string }).velar === "service-ready") {
          socket.removeEventListener("error", failed);
          socket.removeEventListener("close", failed);
          resolve();
        } else failed();
      }, { once: true });
    }, { once: true });
  });
  return socket;
}

/**
 * Creates the deterministic capability host used by `velar test --browser`.
 * It is intentionally an in-memory filesystem, not a browser polyfill for the
 * operating system. The native worker has a separate integration suite.
 */
export function desktopBrowserTestInitScript(
  config: VelarDesktopConfig,
  platform: DesktopTestPlatform = "test",
  windowKind: string = DESKTOP_MAIN_WINDOW_KIND,
): string {
  const files = JSON.stringify(config.permissions.files);
  const processes = JSON.stringify(config.permissions.processes);
  const links = JSON.stringify(config.permissions.links);
  const secureStorage = JSON.stringify(config.permissions.secureStorage);
  const notifications = JSON.stringify(config.permissions.notifications);
  const windows = JSON.stringify(config.windows);
  const services = JSON.stringify(Object.keys(config.services));
  return String.raw`
(() => {
  "use strict";
  const protocol = Symbol.for("velar.desktop.bridge.v1");
  const projectRoot = "/velar-test/project";
  const appDataRoot = "/velar-test/app-data";
  let selectedProjectRoot = null;
  const grants = new Set(${files});
  const processGrants = new Set(${processes});
  // A permission is not a value. Tests start with an absent environment so a
  // granted production setting cannot accidentally activate external behavior.
  const environment = Object.freeze({});
  const nodes = new Map();
  const processHandles = new Map();
  const fileWatchers = new Map();
  let nextProcessHandle = 1;
  let nextFileWatcherHandle = 1;
  const now = 0;
  const maxFileBytes = 16 * 1024 * 1024;
  const maxListItems = 100000;
  const maxListTextUnits = 2 * 1024 * 1024;
  const maxWatchPaths = 4096;
  const maxWatchTextUnits = 2 * 1024 * 1024;

  function watchBatch(watcher) {
    if (watcher.rescan) {
      watcher.rescan = false;
      watcher.paths.clear();
      watcher.units = 0;
      return {paths: [], rescan: true};
    }
    const paths = [...watcher.paths].sort();
    watcher.paths.clear();
    watcher.units = 0;
    return {paths, rescan: false};
  }
  function settleWatch(watcher) {
    if (!watcher.pending || watcher.scheduled || !watcher.rescan && watcher.paths.size === 0) return;
    watcher.scheduled = true;
    Promise.resolve().then(() => {
      watcher.scheduled = false;
      if (!watcher.pending || watcher.closed) return;
      const resolveNext = watcher.pending;
      watcher.pending = null;
      resolveNext(watchBatch(watcher));
    });
  }
  function notifyWatchers(path) {
    for (const watcher of fileWatchers.values()) {
      if (watcher.closed || path !== watcher.root && !(watcher.recursive ? contained(watcher.root, path) : parent(path) === watcher.root)) continue;
      if (!watcher.paths.has(path)) {
        if (watcher.paths.size >= maxWatchPaths || watcher.units + path.length > maxWatchTextUnits) {
          watcher.rescan = true;
          watcher.paths.clear();
          watcher.units = 0;
        } else {
          watcher.paths.add(path);
          watcher.units += path.length;
        }
      }
      settleWatch(watcher);
    }
  }

  function normalize(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0")) {
      throw new TypeError("Desktop test paths must be bounded non-empty text");
    }
    const absolute = value.startsWith("/");
    const output = [];
    for (const part of value.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (output.length) output.pop();
        else if (!absolute) output.push("..");
      } else output.push(part);
    }
    return (absolute ? "/" : "") + output.join("/") || (absolute ? "/" : ".");
  }
  function contained(root, target) { return target === root || target.startsWith(root + "/"); }
  function authorized(value) {
    let path = normalize(value);
    if (!path.startsWith("/")) {
      const base = grants.has("project") ? projectRoot : grants.has("app-data") ? appDataRoot : null;
      if (!base) throw new Error("Desktop test application has no granted filesystem scope");
      path = normalize(base + "/" + path);
    }
    if (grants.has("project") && contained(projectRoot, path)) return path;
    if (grants.has("app-data") && contained(appDataRoot, path)) return path;
    throw new Error("Desktop test path is outside granted file roots");
  }
  function parent(path) { const index = path.lastIndexOf("/"); return index <= 0 ? "/" : path.slice(0, index); }
  function name(path) { return path === "/" ? "" : path.slice(path.lastIndexOf("/") + 1); }
  function directory(path) { nodes.set(path, Object.freeze({ kind: "directory", body: "", modifiedAt: now })); notifyWatchers(path); }
  function makeDirectories(value) {
    const path = authorized(value);
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      const existing = nodes.get(current);
      if (existing && existing.kind !== "directory") throw new Error("Desktop test directory conflicts with a file");
      if (!existing) directory(current);
    }
    return path;
  }
  function file(path, body) {
    path = authorized(path);
    if (!nodes.has(parent(path))) throw new Error("Desktop test parent directory does not exist");
    if (typeof body !== "string") throw new TypeError("Desktop test file content must be text");
    if (new TextEncoder().encode(body).byteLength > maxFileBytes) throw new RangeError("Desktop test file content cannot exceed 16 MiB");
    if (nodes.get(path)?.kind === "directory") throw new TypeError("Desktop test file operation requires a file path");
    nodes.set(path, Object.freeze({ kind: "file", body, modifiedAt: now }));
    notifyWatchers(path);
  }
  function existing(value) {
    const path = authorized(value);
    const node = nodes.get(path);
    if (!node) throw new Error("Desktop test path does not exist");
    return { path, node };
  }

  if (grants.has("project")) {
    makeDirectories(projectRoot);
    file(projectRoot + "/README.md", "# Velar Desktop test project\n");
    makeDirectories(projectRoot + "/src");
    file(projectRoot + "/src/main.vel", "import {App} from \"./app.vel\"\n\nmount(<App />, \"#app\")\n");
  }
  if (grants.has("app-data")) makeDirectories(appDataRoot);

  async function fs(operation, args) {
    if (operation === "watchStart") {
      if (args.length !== 2 || typeof args[1] !== "boolean") throw new TypeError("watchStart arguments are invalid");
      if (fileWatchers.size >= 128) throw new RangeError("Desktop test host cannot own more than 128 file watchers");
      const {path, node} = existing(args[0]);
      if (node.kind !== "directory" && node.kind !== "file") throw new TypeError("watchFiles requires a file or directory path");
      if (args[1] && node.kind !== "directory") throw new TypeError("recursive watchFiles requires a directory path");
      const handle = nextFileWatcherHandle++;
      fileWatchers.set(handle, {root: path, recursive: args[1], paths: new Set(), units: 0, rescan: false, pending: null, scheduled: false, closed: false});
      return handle;
    }
    if (operation === "watchNext") {
      const watcher = fileWatchers.get(args[0]);
      if (!watcher) throw new Error("Desktop test file watcher handle is unknown or already released");
      if (watcher.pending) throw new Error("FileWatcher.next already has an active pull");
      if (watcher.rescan || watcher.paths.size > 0) return watchBatch(watcher);
      return new Promise(resolveNext => { watcher.pending = resolveNext; });
    }
    if (operation === "watchClose") {
      const watcher = fileWatchers.get(args[0]);
      if (!watcher) return false;
      watcher.closed = true;
      fileWatchers.delete(args[0]);
      if (watcher.pending) { const resolveNext = watcher.pending; watcher.pending = null; resolveNext(null); }
      return true;
    }
    if (operation === "canonical") return existing(args[0]).path;
    if (operation === "exists") { const path = authorized(args[0]); return nodes.has(path); }
    if (operation === "makeDirectory") { makeDirectories(args[0]); return null; }
    if (operation === "readText") {
      const { node } = existing(args[0]);
      if (node.kind !== "file") throw new Error("readText requires a file path");
      const maximum = args[1] ?? maxFileBytes;
      if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maxFileBytes) throw new RangeError("readText maxBytes is outside its supported bounds");
      if (new TextEncoder().encode(node.body).byteLength > maximum) throw new RangeError("readText file exceeds maxBytes");
      return node.body;
    }
    if (operation === "createText") {
      const path = authorized(args[0]);
      if (nodes.has(path)) throw new Error("createText target already exists");
      file(path, args[1]);
      return null;
    }
    if (operation === "replaceTextIfMatches") {
      const path = authorized(args[0]);
      const current = nodes.get(path);
      if (!current || current.kind !== "file") throw new Error("replaceTextIfMatches requires a file path");
      if (typeof args[1] !== "string" || typeof args[2] !== "string") throw new TypeError("replaceTextIfMatches requires text");
      if (current.body !== args[1]) return false;
      file(path, args[2]);
      return true;
    }
    if (operation === "writeText") { file(args[0], args[1]); return null; }
    if (operation === "appendText") {
      const path = authorized(args[0]);
      const current = nodes.get(path);
      if (current && current.kind !== "file") throw new TypeError("appendText requires a file path");
      if (typeof args[1] !== "string") throw new TypeError("appendText requires text");
      file(path, (current?.kind === "file" ? current.body : "") + args[1]);
      return null;
    }
    if (operation === "list") {
      const { path, node } = existing(args[0]);
      if (node.kind !== "directory") throw new Error("list requires a directory path");
      const prefix = path + "/";
      const names = [...nodes.keys()].filter(candidate => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes("/"))
        .map(candidate => name(candidate)).sort();
      const maximum = args[1] ?? maxListItems;
      if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > maxListItems) throw new RangeError("list maxItems is outside its supported bounds");
      if (names.length > maximum) throw new RangeError("list result exceeds maxItems");
      let units = 0;
      for (const item of names) {
        units += item.length;
        if (units > maxListTextUnits) throw new RangeError("list result cannot exceed 2 MiB of text");
      }
      return names;
    }
    if (operation === "info") {
      const path = authorized(args[0]);
      const node = nodes.get(path);
      return node ? { name: name(path), kind: node.kind, size: new TextEncoder().encode(node.body).byteLength, modifiedAt: node.modifiedAt } : null;
    }
    if (operation === "copyFile") {
      const { node } = existing(args[0]);
      if (node.kind !== "file") throw new Error("copyFile requires a file source");
      const target = authorized(args[1]);
      if (nodes.has(target) && args[2] !== true) throw new Error("copyFile target already exists");
      file(target, node.body); return null;
    }
    if (operation === "move") {
      const source = existing(args[0]);
      const target = authorized(args[1]);
      if (nodes.has(target) && args[2] !== true) throw new Error("move target already exists");
      if (!nodes.has(parent(target)) || nodes.get(parent(target)).kind !== "directory") throw new Error("Desktop test move parent directory does not exist");
      if (source.path === projectRoot || source.path === appDataRoot) throw new Error("move refuses a granted Desktop file root");
      if (source.node.kind === "directory" && contained(source.path, target)) throw new Error("move target cannot be inside its source");
      if (nodes.get(target)?.kind === "directory") throw new Error("move cannot replace a directory");
      if (nodes.has(target)) { nodes.delete(target); notifyWatchers(target); }
      const moving = [...nodes.entries()].filter(([path]) => path === source.path || path.startsWith(source.path + "/"));
      for (const [path] of moving) nodes.delete(path);
      for (const [path, node] of moving) nodes.set(target + path.slice(source.path.length), node);
      notifyWatchers(source.path);
      notifyWatchers(target);
      return null;
    }
    if (operation === "removeFile") {
      const { path, node } = existing(args[0]);
      if (node.kind !== "file") throw new Error("removeFile requires a file path");
      nodes.delete(path); notifyWatchers(path); return null;
    }
    throw new Error("Unsupported Desktop test filesystem operation '" + operation + "'");
  }

  async function processCapability(operation, args) {
    if (operation === "start") {
      const [command, commandArgs = [], options = {}] = args;
      if (typeof command !== "string" || !processGrants.has(command)) throw new Error("Desktop test process is not granted");
      if (!Array.isArray(commandArgs) || commandArgs.length > 1000 || commandArgs.some(value => typeof value !== "string")) {
        throw new TypeError("Desktop test process args must be a bounded string list");
      }
      const stdout = "[desktop-test] " + command + (commandArgs.length ? " " + commandArgs.join(" ") : "") + "\n";
      const maximum = options.maxOutputBytes ?? 4 * 1024 * 1024;
      if (!Number.isSafeInteger(maximum) || maximum < 1 || new TextEncoder().encode(stdout).byteLength > maximum) {
        throw new RangeError("Desktop test process output exceeded maxOutputBytes");
      }
      const handle = nextProcessHandle++;
      const result = Object.freeze({code: 0, signal: null, stdout, stderr: ""});
      processHandles.set(handle, {
        result,
        output: stdout.length === 0 ? [] : [Object.freeze({channel: "stdout", text: stdout})],
      });
      return {handle, pid: 0};
    }
    const handle = args[0];
    if (!Number.isSafeInteger(handle) || handle < 1) throw new TypeError("Desktop test process handle is invalid");
    const process = processHandles.get(handle);
    if (operation === "read") {
      if (!process) throw new Error("Desktop test process handle is unknown or already released");
      return process.output.length === 0 ? null : process.output.shift();
    }
    if (operation === "wait") {
      if (!process) throw new Error("Desktop test process handle is unknown or already released");
      processHandles.delete(handle);
      return {result: process.result, error: null, retained: false};
    }
    if (operation === "stop") {
      processHandles.delete(handle);
      return {result: process?.result ?? null, error: null};
    }
    throw new Error("Unsupported Desktop test process operation '" + operation + "'");
  }

  // The fake window registry. It is the same registry the native host keeps —
  // kind plus optional key is the identity, one window per identity, and a
  // bounded pull stream carries the state changes — reduced to what a browser
  // test can observe. It simulates no operating system: only the contract.
  const windowKinds = ${windows};
  const currentWindowKind = ${JSON.stringify(windowKind)};
  const windowRegistry = new Map();
  const windowWatchers = new Map();
  const maxWindowStateEvents = 64;
  let nextWindowHandle = 1;
  let nextWindowWatcherHandle = 1;
  const display = Object.freeze({
    id: "velar-test-display",
    bounds: Object.freeze({x: 0, y: 0, width: 1440, height: 900}),
    workArea: Object.freeze({x: 0, y: 25, width: 1440, height: 875}),
    scale: 2,
    primary: true,
  });

  function declaredWindow(kind, operation) {
    if (typeof kind !== "string" || !Object.hasOwn(windowKinds, kind)) {
      throw new Error("Desktop test " + operation + " cannot use the undeclared window kind '" + String(kind)
        + "'; declare it under 'desktop.windows' (declared kinds: " + Object.keys(windowKinds).join(", ") + ")");
    }
    return windowKinds[kind];
  }
  // The fake registry's half of the instance-key rule; see windowKeyOf in
  // packages/desktop/src/compiler.ts for the other two copies and why.
  function windowKeyValue(value, operation) {
    if (value == null) return null;
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new TypeError("Desktop test " + operation + " key is invalid");
    return value;
  }
  function windowBoundsValue(value, operation) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop test " + operation + " requires bounds");
    const output = {};
    for (const name of ["x", "y", "width", "height"]) {
      const item = value[name];
      if (typeof item !== "number" || !Number.isFinite(item)) throw new TypeError("Desktop test " + operation + " requires bounds");
      output[name] = item;
    }
    if (output.width < 1 || output.height < 1) throw new RangeError("Desktop test " + operation + " requires a window at least one point wide and tall");
    return Object.freeze(output);
  }
  function ownedWindow(handle) {
    const record = windowRegistry.get(handle);
    if (!record || record.closed) throw new Error("Desktop test window handle is unknown or already closed");
    return record;
  }
  function windowIdentity(kind, key) {
    for (const record of windowRegistry.values()) {
      if (!record.closed && record.kind === kind && record.key === key) return record;
    }
    return null;
  }
  // A slow consumer never grows the queue: moved and resized carry no payload
  // of their own, so a repeat of one already queued *is* the latest, and the
  // focus pair is collapsed to whichever arrived last. A queue that reached
  // its bound drops its oldest entry rather than the newest, because the
  // newest is the state the window is actually in.
  function publishWindowState(record, state) {
    for (const watcher of record.watchers) {
      if (watcher.closed) continue;
      if ((state === "moved" || state === "resized") && watcher.events.includes(state)) continue;
      watcher.events.push(state);
      if (watcher.events.length > maxWindowStateEvents) watcher.events.shift();
      settleWindowWatcher(watcher);
    }
  }
  function settleWindowWatcher(watcher) {
    if (!watcher.pending || watcher.events.length === 0) return;
    const resolveNext = watcher.pending;
    watcher.pending = null;
    resolveNext(watcher.events.shift());
  }
  function releaseWindowWatcher(watcher) {
    if (watcher.closed) return;
    watcher.closed = true;
    windowWatchers.delete(watcher.handle);
    watcher.owner.watchers.delete(watcher);
    if (watcher.pending) { const resolveNext = watcher.pending; watcher.pending = null; resolveNext(null); }
  }
  function focusWindowRecord(record) {
    for (const other of windowRegistry.values()) {
      if (other === record || other.closed || !other.focused) continue;
      other.focused = false;
      publishWindowState(other, "blurred");
    }
    if (record.focused) return;
    record.focused = true;
    publishWindowState(record, "focused");
  }
  function closeWindowRecord(record) {
    if (record.closed) return false;
    record.closed = true;
    record.focused = false;
    publishWindowState(record, "closed");
    // A closed event is the stream's last, and the stream then drains
    // normally: queued events are still delivered, and the pull that finds the
    // queue empty answers null instead of failing on a released handle.
    for (const watcher of record.watchers) watcher.draining = true;
    return true;
  }
  function openWindowRecord(kind, options) {
    const declared = declaredWindow(kind, "openWindow");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Desktop test openWindow requires options");
    const key = windowKeyValue(options.key, "openWindow");
    const existing = windowIdentity(kind, key);
    if (existing) {
      focusWindowRecord(existing);
      return existing.handle;
    }
    if (windowRegistry.size >= 256) throw new RangeError("Desktop test host cannot own more than 256 windows");
    const handle = nextWindowHandle++;
    const record = {
      handle,
      kind,
      key,
      bounds: options.bounds == null
        ? Object.freeze({x: 0, y: 0, width: declared.width, height: declared.height})
        : windowBoundsValue(options.bounds, "openWindow"),
      focused: false,
      closed: false,
      watchers: new Set(),
    };
    windowRegistry.set(handle, record);
    focusWindowRecord(record);
    return handle;
  }

  const mainWindowHandle = openWindowRecord(currentWindowKind, {route: "/", key: null, bounds: null});

  async function windowCapability(operation, args) {
    if (operation === "open") return openWindowRecord(args[0], args[1]);
    if (operation === "list") {
      const output = [];
      for (const record of windowRegistry.values()) {
        if (!record.closed) output.push({kind: record.kind, key: record.key, focused: record.focused});
      }
      return output;
    }
    if (operation === "watchNext") {
      const watcher = windowWatchers.get(args[0]);
      if (!watcher) throw new Error("Desktop test window state stream handle is unknown or already released");
      if (watcher.pending) throw new Error("WindowStateStream.next already has an active pull");
      if (watcher.events.length > 0) return watcher.events.shift();
      if (watcher.draining) { releaseWindowWatcher(watcher); return null; }
      return new Promise(resolveNext => { watcher.pending = resolveNext; });
    }
    if (operation === "watchClose") {
      const watcher = windowWatchers.get(args[0]);
      if (!watcher) return false;
      releaseWindowWatcher(watcher);
      return true;
    }
    if (operation === "close") {
      const record = windowRegistry.get(args[0]);
      return record ? closeWindowRecord(record) : false;
    }
    const owned = ownedWindow(args[0]);
    if (operation === "focus") { focusWindowRecord(owned); return null; }
    if (operation === "bounds") return owned.bounds;
    if (operation === "setBounds") {
      const bounds = windowBoundsValue(args[1], "setBounds");
      const moved = bounds.x !== owned.bounds.x || bounds.y !== owned.bounds.y;
      const resized = bounds.width !== owned.bounds.width || bounds.height !== owned.bounds.height;
      owned.bounds = bounds;
      if (moved) publishWindowState(owned, "moved");
      if (resized) publishWindowState(owned, "resized");
      return null;
    }
    if (operation === "display") return display;
    if (operation === "watchStart") {
      if (windowWatchers.size >= 128) throw new RangeError("Desktop test host cannot own more than 128 window state streams");
      const handle = nextWindowWatcherHandle++;
      const watcher = {handle, owner: owned, events: [], pending: null, closed: false, draining: false};
      windowWatchers.set(handle, watcher);
      owned.watchers.add(watcher);
      return handle;
    }
    throw new Error("Unsupported Desktop test window operation '" + operation + "'");
  }

  async function windowTestCapability(operation, args) {
    declaredWindow(args[0], operation + "Window");
    const record = windowIdentity(args[0], windowKeyValue(args[1], operation + "Window"));
    if (!record) throw new Error("Desktop test window '" + args[0] + "' is not open");
    if (operation === "focus") { focusWindowRecord(record); return null; }
    if (operation === "close") { closeWindowRecord(record); return null; }
    if (operation === "move") {
      const bounds = windowBoundsValue(args[2], "moveWindow");
      const resized = bounds.width !== record.bounds.width || bounds.height !== record.bounds.height;
      record.bounds = bounds;
      publishWindowState(record, "moved");
      if (resized) publishWindowState(record, "resized");
      return null;
    }
    throw new Error("Unsupported Desktop test window event '" + operation + "'");
  }

  // The rest of the host surface, reduced to what a browser test can observe.
  // Every grant is asked a second time here, the way the native host asks it a
  // second time: the generated module already refused an ungranted call, and a
  // page that reached the bridge another way is refused again.
  const linkGrants = new Set(${links});
  const secureStorageGrants = new Set(${secureStorage});
  const notificationsDeclared = ${notifications};
  const droppedFilesGranted = grants.has("dropped");
  // The fake host's copy of the host event stream bounds. The native host
  // states them in packages/desktop/native/macos/VelarDesktopHost.swift and the
  // generated modules state them in packages/desktop/src/compiler.ts; the three
  // must not drift, which is why each names the other two.
  const maxHostEvents = 64;
  const maxDroppedPaths = 4096;
  const maxDroppedTextUnits = 2 * 1024 * 1024;
  const maxSecureStorageValueBytes = 8 * 1024;
  const notificationInbox = [];
  const openedLinks = [];
  // The fake install applyUpdate compares an archive against. A test build
  // starts ad-hoc — no Team ID — because that is what a development install
  // actually is, and because the refusal it produces is the one an author is
  // most likely to meet first.
  const installedIdentifier = ${JSON.stringify(config.identifier)};
  let installedTeam = null;
  const stagedUpdates = new Map();
  const appliedUpdates = [];
  const keychain = new Map();
  const systemPermissions = new Map();
  const powerWatchers = new Map();
  const dropWatchers = new Map();
  const notificationWatchers = new Map();
  let notificationPermission = "undetermined";
  let powerState = "resumed";
  let nextHostWatcherHandle = 1;

  function hostGrant(condition, operation, declaration) {
    if (!condition) throw new Error("Desktop test " + operation + " requires " + declaration + " in this project's velar.json");
  }
  function hostWatcher(watchers, handle, label) {
    const watcher = watchers.get(handle);
    if (!watcher) throw new Error("Desktop test " + label + " handle is unknown or already released");
    return watcher;
  }
  function startHostWatcher(watchers, label) {
    if (watchers.size >= 128) throw new RangeError("Desktop test host cannot own more than 128 " + label + " streams");
    const handle = nextHostWatcherHandle++;
    watchers.set(handle, {handle, events: [], pending: null});
    return handle;
  }
  function settleHostWatcher(watcher) {
    if (!watcher.pending || watcher.events.length === 0) return;
    const resolveNext = watcher.pending;
    watcher.pending = null;
    resolveNext(watcher.events.shift());
  }
  function nextHostEvent(watchers, handle, label) {
    const watcher = hostWatcher(watchers, handle, label);
    if (watcher.pending) throw new Error(label + ".next already has an active pull");
    if (watcher.events.length > 0) return watcher.events.shift();
    return new Promise(resolveNext => { watcher.pending = resolveNext; });
  }
  function closeHostWatcher(watchers, handle) {
    const watcher = watchers.get(handle);
    if (!watcher) return false;
    watchers.delete(handle);
    if (watcher.pending) { const resolveNext = watcher.pending; watcher.pending = null; resolveNext(null); }
    return true;
  }
  // Power is a transition stream: the machine is either asleep or awake, so a
  // state it is already in publishes nothing. A queue at its bound drops its
  // oldest entry, because the newest is the state the machine is actually in.
  function publishPower(state) {
    if (state === powerState) return null;
    powerState = state;
    for (const watcher of powerWatchers.values()) {
      watcher.events.push(state);
      if (watcher.events.length > maxHostEvents) watcher.events.shift();
      settleHostWatcher(watcher);
    }
    return null;
  }
  // A dropped-files stream is one batch deep. A gesture that arrives while a
  // batch is still waiting is appended to it in gesture order, so a slow
  // consumer sees the two drops as one drop rather than losing either. The
  // batch is bounded, and a merge that would pass the bound drops the oldest
  // paths in it — the newest gesture is the one the user just made.
  function publishDroppedFiles(paths) {
    for (const watcher of dropWatchers.values()) {
      const merged = watcher.events.length > 0 ? watcher.events[0].paths.concat(paths) : [...paths];
      while (merged.length > maxDroppedPaths || textUnits(merged) > maxDroppedTextUnits) merged.shift();
      watcher.events.length = 0;
      watcher.events.push(Object.freeze({paths: Object.freeze(merged)}));
      settleHostWatcher(watcher);
    }
    return null;
  }
  function textUnits(values) {
    let units = 0;
    for (const value of values) units += value.length;
    return units;
  }
  // Two activations of the same notification are one activation, so a tag
  // already queued is not queued twice; a queue at its bound drops its oldest.
  function publishActivation(tag) {
    for (const watcher of notificationWatchers.values()) {
      if (watcher.events.some(event => event.tag === tag)) continue;
      watcher.events.push(Object.freeze({tag}));
      if (watcher.events.length > maxHostEvents) watcher.events.shift();
      settleHostWatcher(watcher);
    }
    return null;
  }
  function notificationName(value, operation) {
    if (value == null) return null;
    if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new TypeError("Desktop test " + operation + " tag is invalid");
    return value;
  }
  function storageName(value, operation) {
    if (typeof value !== "string" || !secureStorageGrants.has(value)) {
      throw new Error("Desktop test " + operation + " cannot reach the undeclared secure storage name '" + String(value)
        + "'; declare it under 'desktop.permissions.secureStorage' (declared names: "
        + ([...secureStorageGrants].join(", ") || "none") + ")");
    }
    return value;
  }

  async function notificationCapability(operation, args) {
    hostGrant(notificationsDeclared, operation, "'notifications: true' under 'desktop.permissions'");
    if (operation === "requestPermission") return notificationPermission;
    if (operation === "show") {
      // The operating system's answer is the second gate, and a notification it
      // never authorized fails rather than being quietly dropped.
      if (notificationPermission !== "granted") {
        throw new Error("Desktop test show cannot deliver a notification the operating system has not authorized (permission: " + notificationPermission + ")");
      }
      const value = args[0];
      if (!value || typeof value !== "object" || typeof value.title !== "string" || typeof value.body !== "string"
        || value.title.length === 0 || value.title.length > 256 || value.body.length === 0 || value.body.length > 1024) {
        throw new TypeError("Desktop test show requires a bounded notification");
      }
      if (notificationInbox.length >= 256) throw new RangeError("Desktop test host cannot hold more than 256 notifications");
      notificationInbox.push(Object.freeze({title: value.title, body: value.body, tag: notificationName(value.tag, "show")}));
      return null;
    }
    if (operation === "watchStart") return startHostWatcher(notificationWatchers, "NotificationActivationStream");
    if (operation === "watchNext") return nextHostEvent(notificationWatchers, args[0], "NotificationActivationStream");
    if (operation === "watchClose") return closeHostWatcher(notificationWatchers, args[0]);
    throw new Error("Unsupported Desktop test notification operation '" + operation + "'");
  }

  async function secureStorageCapability(operation, args) {
    const name = storageName(args[0], operation);
    if (operation === "set") {
      const value = args[1];
      if (typeof value !== "string") throw new TypeError("Desktop test set requires a text value");
      if (new TextEncoder().encode(value).byteLength > maxSecureStorageValueBytes) throw new RangeError("Desktop test set cannot store more than 8 KiB");
      keychain.set(name, value);
      return null;
    }
    if (operation === "get") return keychain.has(name) ? keychain.get(name) : null;
    if (operation === "remove") { keychain.delete(name); return null; }
    throw new Error("Unsupported Desktop test secure storage operation '" + operation + "'");
  }

  async function desktopHostSurface(operation, args) {
    if (operation === "openExternal") {
      const url = args[0];
      if (typeof url !== "string" || url.length === 0 || url.length > 2048) throw new TypeError("Desktop test openExternal requires a bounded URL");
      let scheme;
      try { scheme = new URL(url).protocol.slice(0, -1); }
      catch { throw new TypeError("Desktop test openExternal requires an absolute URL"); }
      hostGrant(linkGrants.has(scheme), "openExternal", "the '" + scheme + "' scheme under 'desktop.permissions.links'");
      if (openedLinks.length >= 256) throw new RangeError("Desktop test host cannot record more than 256 opened links");
      openedLinks.push(url);
      return null;
    }
    // The same four questions the native host asks, asked here so a browser test
    // can drive the whole refusal matrix. The native copy is in
    // packages/desktop/native/macos/VelarDesktopHost.swift; the two must not
    // drift, and the wording below is deliberately the wording there.
    if (operation === "applyUpdate") {
      const archivePath = args[0];
      if (typeof archivePath !== "string" || archivePath.length === 0 || archivePath[0] !== "/" || archivePath.length > 4096) {
        throw new TypeError("Desktop test applyUpdate requires a bounded absolute archive path");
      }
      if (installedTeam === null) {
        throw new Error("Desktop applyUpdate refuses to update an application signed with no Team ID. "
          + "This install is ad-hoc or unsigned, so there is no signing identity an update could be required to match, "
          + "and accepting one anyway would accept every archive. Install a Developer ID signed build to update in place.");
      }
      const update = stagedUpdates.get(archivePath);
      if (!update) throw new Error("Desktop applyUpdate archive does not identify an ordinary file");
      if (update.bundleIdentifier !== installedIdentifier) {
        throw new Error("Desktop applyUpdate refuses an archive whose bundle identifier is '" + update.bundleIdentifier
          + "' and not '" + installedIdentifier + "'");
      }
      if (update.teamIdentifier === null) throw new Error("Desktop applyUpdate refuses an archive signed with no Team ID");
      if (update.teamIdentifier !== installedTeam) {
        throw new Error("Desktop applyUpdate refuses an archive signed by Team ID '" + update.teamIdentifier + "' and not '" + installedTeam + "'");
      }
      if (appliedUpdates.length >= 64) throw new RangeError("Desktop test host cannot record more than 64 applied updates");
      appliedUpdates.push(archivePath);
      return null;
    }
    if (operation === "displays") return [display];
    if (operation === "permissionStatus") {
      const kind = args[0];
      if (kind !== "screenRecording" && kind !== "accessibility" && kind !== "microphone") {
        throw new TypeError("Desktop test permissionStatus requires a SystemPermission value");
      }
      return systemPermissions.get(kind) ?? "undetermined";
    }
    if (operation === "powerWatchStart") return startHostWatcher(powerWatchers, "PowerStream");
    if (operation === "powerWatchNext") return nextHostEvent(powerWatchers, args[0], "PowerStream");
    if (operation === "powerWatchClose") return closeHostWatcher(powerWatchers, args[0]);
    if (operation === "dropWatchStart") {
      hostGrant(droppedFilesGranted, "watchDroppedFiles", "the 'dropped' root in 'desktop.permissions.files'");
      return startHostWatcher(dropWatchers, "DroppedFilesStream");
    }
    if (operation === "dropWatchNext") return nextHostEvent(dropWatchers, args[0], "DroppedFilesStream");
    if (operation === "dropWatchClose") return closeHostWatcher(dropWatchers, args[0]);
    return undefined;
  }

  async function hostTestCapability(capability, operation, args) {
    if (capability === "notification-test") {
      if (operation === "setPermission") {
        if (args[0] !== "granted" && args[0] !== "denied" && args[0] !== "undetermined") {
          throw new TypeError("Desktop test setNotificationPermission requires a NotificationPermission value");
        }
        notificationPermission = args[0];
        return null;
      }
      if (operation === "shown") return notificationInbox.map(item => ({title: item.title, body: item.body, tag: item.tag}));
      if (operation === "activate") return publishActivation(notificationName(args[0], "activateNotification"));
      throw new Error("Unsupported Desktop test notification event '" + operation + "'");
    }
    if (capability === "secure-storage-test") {
      if (operation === "names") return [...keychain.keys()].sort();
      throw new Error("Unsupported Desktop test secure storage event '" + operation + "'");
    }
    if (operation === "publishPower") {
      if (args[0] !== "suspended" && args[0] !== "resumed") throw new TypeError("Desktop test publishPower requires a PowerState value");
      return publishPower(args[0]);
    }
    if (operation === "dropFiles") {
      hostGrant(droppedFilesGranted, "dropFiles", "the 'dropped' root in 'desktop.permissions.files'");
      const paths = args[0];
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > maxDroppedPaths
        || paths.some(path => typeof path !== "string" || path.length === 0 || path[0] !== "/" || path.length > 4096 || path.includes("\0"))) {
        throw new TypeError("Desktop test dropFiles requires a non-empty bounded list of absolute paths");
      }
      return publishDroppedFiles(paths);
    }
    if (operation === "setSystemPermission") {
      if (args[0] !== "screenRecording" && args[0] !== "accessibility" && args[0] !== "microphone") {
        throw new TypeError("Desktop test setSystemPermission requires a SystemPermission value");
      }
      if (args[1] !== "granted" && args[1] !== "denied" && args[1] !== "undetermined") {
        throw new TypeError("Desktop test setSystemPermission requires a PermissionStatus value");
      }
      systemPermissions.set(args[0], args[1]);
      return null;
    }
    if (operation === "openedLinks") return [...openedLinks];
    // The two halves of the update identity check a test controls: what this
    // install was signed by, and what an archive on disk claims to be. Neither
    // is a value the application can read — a program cannot ask its own host
    // for its Team ID — so they exist here and nowhere in velar/desktop.
    if (operation === "setSigningTeam") {
      if (args[0] !== null && (typeof args[0] !== "string" || !/^[A-Z0-9]{2,32}$/u.test(args[0]))) {
        throw new TypeError("Desktop test setSigningTeam requires an Apple Team ID or none");
      }
      installedTeam = args[0];
      return null;
    }
    if (operation === "stageUpdate") {
      const archivePath = args[0];
      if (typeof archivePath !== "string" || archivePath.length === 0 || archivePath[0] !== "/" || archivePath.length > 4096) {
        throw new TypeError("Desktop test stageUpdate requires a bounded absolute archive path");
      }
      if (typeof args[1] !== "string" || args[1].length === 0 || args[1].length > 256) {
        throw new TypeError("Desktop test stageUpdate requires the archived application's bundle identifier");
      }
      if (args[2] !== null && (typeof args[2] !== "string" || !/^[A-Z0-9]{2,32}$/u.test(args[2]))) {
        throw new TypeError("Desktop test stageUpdate requires an Apple Team ID or none");
      }
      if (stagedUpdates.size >= 64) throw new RangeError("Desktop test host cannot stage more than 64 update archives");
      stagedUpdates.set(archivePath, {bundleIdentifier: args[1], teamIdentifier: args[2]});
      return null;
    }
    if (operation === "appliedUpdates") return [...appliedUpdates];
    throw new Error("Desktop test capability '" + capability + "' has no operation '" + operation + "'");
  }

  // The page's side of the service channel. It is deliberately the same shape
  // the native host presents — the renderer holds a handle and never a socket —
  // and the frames it carries are pumped over a real loopback WebSocket by
  // 'velar/desktop-test.serveService' in the test process. The renderer never
  // opens a socket in production either: the host dials, so a fake that opened
  // one from the page would be modelling the wrong architecture.
  const declaredServices = new Set(${services});
  const serviceStates = new Map([...declaredServices].map(name => [name, "starting"]));
  const serviceConnections = new Map();
  const serviceWatchers = new Map();
  const serviceOutbound = [];
  const serviceOutboundWaiting = [];
  let nextServiceHandle = 1;
  const maxServiceQueuedMessages = 1024;
  function serviceConnection(handle, operation) {
    const connection = serviceConnections.get(handle);
    if (!connection) throw new Error("Desktop test service connection is closed or unknown");
    return connection;
  }
  function settleServiceOutbound() {
    while (serviceOutboundWaiting.length > 0 && serviceOutbound.length > 0) {
      serviceOutboundWaiting.shift()(serviceOutbound.shift());
    }
  }
  function publishServiceState(name, state) {
    serviceStates.set(name, state);
    for (const watcher of serviceWatchers.values()) {
      if (watcher.closed) continue;
      if (watcher.pending && watcher.events.length === 0) {
        const deliver = watcher.pending;
        watcher.pending = null;
        deliver({name, state});
        continue;
      }
      const index = watcher.events.findIndex(event => event.name === name);
      if (index >= 0) watcher.events[index] = {name, state};
      else watcher.events.push({name, state});
    }
    return null;
  }
  async function serviceCapability(operation, args) {
    if (operation === "connect") {
      const name = args[0];
      if (!declaredServices.has(name)) throw new Error("Desktop service '" + String(name) + "' is not declared in 'desktop.services'");
      const state = serviceStates.get(name);
      if (state !== "ready") {
        throw new Error("Desktop service '" + name + "' is " + state + " rather than ready; watchServices() reports when it becomes ready");
      }
      const handle = nextServiceHandle++;
      serviceConnections.set(handle, {
        name, queue: [], pending: null, closed: false,
        closeCode: 1006, closeReason: "the service channel ended without a close frame",
      });
      return handle;
    }
    if (operation === "send") {
      const connection = serviceConnection(args[0], "send");
      if (typeof args[1] !== "string") throw new TypeError("Desktop test service send requires text");
      if (connection.closed) throw new Error("Desktop test service connection is closed");
      serviceOutbound.push({connection: args[0], message: args[1]});
      settleServiceOutbound();
      return null;
    }
    if (operation === "receive") {
      const connection = serviceConnections.get(args[0]);
      if (!connection) return null;
      if (connection.pending) throw new Error("ServiceConnection.next already has an active pull");
      if (connection.queue.length > 0) return connection.queue.shift();
      if (connection.closed) { serviceConnections.delete(args[0]); return null; }
      return new Promise(resolve => { connection.pending = resolve; });
    }
    if (operation === "state") return serviceConnections.get(args[0])?.closed === false ? "open" : "closed";
    if (operation === "closeInfo") {
      const connection = serviceConnection(args[0], "closeInfo");
      return {code: connection.closeCode, reason: connection.closeReason};
    }
    if (operation === "close") {
      const connection = serviceConnections.get(args[0]);
      if (!connection) return false;
      connection.closed = true;
      connection.closeCode = args[1];
      connection.closeReason = args[2];
      if (connection.pending) { const deliver = connection.pending; connection.pending = null; deliver(null); }
      serviceConnections.delete(args[0]);
      return true;
    }
    if (operation === "watchStart") {
      const handle = nextServiceHandle++;
      serviceWatchers.set(handle, {
        events: [...serviceStates].map(([name, state]) => ({name, state})),
        pending: null,
        closed: false,
      });
      return handle;
    }
    if (operation === "watchNext") {
      const watcher = serviceWatchers.get(args[0]);
      if (!watcher || watcher.closed) throw new Error("Desktop ServiceStateStream handle is unknown or already released");
      if (watcher.pending) throw new Error("ServiceStateStream.next already has an active pull");
      if (watcher.events.length > 0) return watcher.events.shift();
      return new Promise(resolve => { watcher.pending = resolve; });
    }
    if (operation === "watchClose") {
      const watcher = serviceWatchers.get(args[0]);
      if (!watcher) return false;
      watcher.closed = true;
      watcher.pending = null;
      serviceWatchers.delete(args[0]);
      return true;
    }
    throw new Error("Unsupported Desktop test service operation '" + operation + "'");
  }
  async function serviceTestCapability(operation, args) {
    if (operation === "setState") {
      if (!declaredServices.has(args[0])) throw new Error("Desktop test setServiceState cannot name the undeclared service '" + String(args[0]) + "'");
      return publishServiceState(args[0], args[1]);
    }
    // The test process pulls what the application sent and pushes back what the
    // real loopback service answered. A bounded wait rather than an open-ended
    // one, so a pump outlives neither the page nor the test that started it.
    if (operation === "poll") {
      if (serviceOutbound.length > 0) return serviceOutbound.shift();
      return new Promise(resolve => {
        const waiter = value => resolve(value ?? null);
        serviceOutboundWaiting.push(waiter);
        setTimeout(() => {
          const index = serviceOutboundWaiting.indexOf(waiter);
          if (index >= 0) { serviceOutboundWaiting.splice(index, 1); resolve(null); }
        }, 100);
      });
    }
    if (operation === "deliver") {
      const connection = serviceConnections.get(args[0]);
      if (!connection || connection.closed) return null;
      if (connection.pending) { const deliver = connection.pending; connection.pending = null; deliver(args[1]); return null; }
      if (connection.queue.length >= maxServiceQueuedMessages) throw new RangeError("Desktop test service receive queue reached its bound");
      connection.queue.push(args[1]);
      return null;
    }
    throw new Error("Unsupported Desktop test service seam operation '" + operation + "'");
  }

  const bridge = Object.freeze({
    platform: ${JSON.stringify(platform)},
    packaged: false,
    projectDirectory: projectRoot,
    projectDirectoryValue() { return projectRoot; },
    windowKind: currentWindowKind,
    windowHandle: mainWindowHandle,
    environment,
    async invoke(capability, operation, args) {
      if (!Array.isArray(args)) throw new TypeError("Desktop test bridge args must be a list");
      if (capability === "service") return serviceCapability(operation, args);
      if (capability === "service-fake") return serviceTestCapability(operation, args);
      if (capability === "window") return windowCapability(operation, args);
      if (capability === "window-test") return windowTestCapability(operation, args);
      if (capability === "notification") return notificationCapability(operation, args);
      if (capability === "secure-storage") return secureStorageCapability(operation, args);
      // The pre-navigation half of 'desktop-test' is answered by the browser
      // test controller before this document exists; what reaches here is the
      // half that produces host events inside a running page.
      if (capability === "notification-test" || capability === "secure-storage-test" || capability === "desktop-test") {
        return hostTestCapability(capability, operation, args);
      }
      if (capability === "desktop") {
        if (operation === "homeDirectory") return "/velar-test/home";
        if (operation === "appDataDirectory") return appDataRoot;
        if (operation === "projectDirectory") return projectRoot;
        if (operation === "selectedProjectDirectory") return selectedProjectRoot;
        if (operation === "selectProjectDirectory") {
          if (!grants.has("project")) throw new Error("Desktop test application has no project file grant");
          selectedProjectRoot = projectRoot;
          return selectedProjectRoot;
        }
        const value = await desktopHostSurface(operation, args);
        if (value !== undefined) return value;
      }
      if (capability === "fs") return fs(operation, args);
      if (capability === "process") return processCapability(operation, args);
      throw new Error("Desktop test capability '" + capability + "' is not configured");
    },
  });
  Object.defineProperty(globalThis, protocol, { value: bridge, enumerable: false, configurable: false, writable: false });
})();
`.trim();
}
