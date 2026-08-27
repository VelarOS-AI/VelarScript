import { DESKTOP_MAIN_WINDOW_KIND, type VelarDesktopConfig } from "./config.ts";
import type { FrameworkBrowserTestController } from "@velarscript/compiler/framework-host";

export type DesktopTestPlatform = "macos" | "test";

/**
 * Owns the one pre-navigation choice a Desktop browser test may make. Each
 * test receives a fresh controller, and the choice is sealed when its first
 * `browser.open()` requests the application init script.
 */
export function desktopBrowserTestController(config: VelarDesktopConfig): FrameworkBrowserTestController {
  let platform: DesktopTestPlatform = "test";
  let windowKind: string = DESKTOP_MAIN_WINDOW_KIND;
  let opened = false;
  return Object.freeze({
    initScript() {
      opened = true;
      return desktopBrowserTestInitScript(config, platform, windowKind);
    },
    invoke(capability: string, operation: string, args: readonly unknown[]) {
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
  const windows = JSON.stringify(config.windows);
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
      if (capability === "window") return windowCapability(operation, args);
      if (capability === "window-test") return windowTestCapability(operation, args);
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
