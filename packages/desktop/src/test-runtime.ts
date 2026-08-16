import type { VelarDesktopConfig } from "./config.ts";

/**
 * Creates the deterministic capability host used by `velar test --browser`.
 * It is intentionally an in-memory filesystem, not a browser polyfill for the
 * operating system. The native worker has a separate integration suite.
 */
export function desktopBrowserTestInitScript(config: VelarDesktopConfig): string {
  const files = JSON.stringify(config.permissions.files);
  const processes = JSON.stringify(config.permissions.processes);
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
  const projectChanges = new Map();
  const projectChangeHandles = new Map();
  let nextProcessHandle = 1;
  let nextFileWatcherHandle = 1;
  let nextProjectChangeHandle = 1;
  let nextProjectChangeSequence = 1;
  const now = 0;
  const maxFileBytes = 16 * 1024 * 1024;
  const maxListItems = 100000;
  const maxListTextUnits = 2 * 1024 * 1024;
  const maxWatchPaths = 4096;
  const maxWatchTextUnits = 2 * 1024 * 1024;

  function projectChangeLifecycle(value) {
    if (value === "prepared" || value === "amended" || value === "validated" || value === "applied" || value === "discarded") return value;
    if (value === "validationFailed" || value === "validation_failed") return "validation_failed";
    if (value === "rolledBack" || value === "rolled_back") return "rolled_back";
    throw new TypeError("Desktop test project change lifecycle is invalid");
  }
  function projectChangeId(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\0")) {
      throw new TypeError("Desktop test project change id must be bounded text");
    }
    return value;
  }
  function projectChangeDiff(value) {
    if (typeof value !== "string" || new TextEncoder().encode(value).byteLength > 16 * 1024 * 1024) {
      throw new RangeError("Desktop test project change diff cannot exceed 16 MiB");
    }
    return value;
  }
  function changeLines(diff) {
    if (diff.length === 0) return 0;
    return diff.split("\n").filter(line => line.startsWith("+") || line.startsWith("-")).length;
  }
  function notifyProjectChanges(change) {
    for (const handle of projectChangeHandles.values()) {
      if (handle.closed) continue;
      if (!handle.queue.has(change.transactionId) && handle.queue.size >= 100) {
        handle.queue.clear();
        handle.rescan = true;
      } else if (!handle.rescan) handle.queue.set(change.transactionId, change);
      if (handle.pending) {
        const resolveNext = handle.pending;
        handle.pending = null;
        const changes = [...handle.queue.values()];
        handle.queue.clear();
        const rescan = handle.rescan;
        handle.rescan = false;
        resolveNext({changes, rescan});
      }
    }
  }
  function recordProjectChange(transactionId, lifecycle, diff, previous = null) {
    const sequence = nextProjectChangeSequence++;
    const changedLines = changeLines(diff);
    const change = Object.freeze({
      transactionId,
      sequence,
      lifecycle,
      reason: null,
      intents: Object.freeze([Object.freeze({type: "replace_text", path: "src/main.vel", from: null, to: null, targetId: null, reason: "desktop browser test"})]),
      patches: Object.freeze([Object.freeze({
        patchId: "desktop-test:" + transactionId,
        strategyId: "desktop-test",
        path: "src/main.vel",
        baseRevision: null,
        diff,
        changedLines,
        risk: "low",
        operation: "replace_text",
      })]),
      changedFiles: Object.freeze(["src/main.vel"]),
      diff,
      changedLines,
      risk: "low",
      revisions: Object.freeze([Object.freeze({path: "src/main.vel", before: previous ? previous.revisions[0].before : "desktop-test:before", after: "desktop-test:" + sequence})]),
      createdAt: previous ? previous.createdAt : sequence,
      updatedAt: sequence,
      appliedAt: lifecycle === "applied" ? sequence : previous?.appliedAt ?? null,
    });
    projectChanges.set(transactionId, change);
    notifyProjectChanges(change);
    return change;
  }
  async function projectChangeCapability(operation, args) {
    if (!grants.has("project")) throw new Error("Desktop test project changes require the project file grant");
    if (operation === "start") {
      if (args.length !== 0) throw new TypeError("Desktop test projectChanges start arguments are invalid");
      const handle = nextProjectChangeHandle++;
      projectChangeHandles.set(handle, {queue: new Map(), rescan: false, pending: null, closed: false});
      return handle;
    }
    const handle = projectChangeHandles.get(args[0]);
    if (!handle || handle.closed) throw new Error("Desktop test ProjectChanges handle is unknown or already released");
    if (operation === "list") {
      const limit = args[1];
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Desktop test ProjectChanges list limit is invalid");
      const values = [...projectChanges.values()].sort((left, right) => right.sequence - left.sequence);
      return {changes: values.slice(0, limit), truncated: values.length > limit};
    }
    if (operation === "get") return projectChanges.get(projectChangeId(args[1])) ?? null;
    if (operation === "subscribe") {
      if (handle.pending) throw new Error("Desktop test ProjectChanges subscribe already has an active pull");
      if (handle.rescan || handle.queue.size > 0) {
        const changes = [...handle.queue.values()];
        handle.queue.clear();
        const rescan = handle.rescan;
        handle.rescan = false;
        return {changes, rescan};
      }
      return new Promise(resolveNext => { handle.pending = resolveNext; });
    }
    if (operation === "apply" || operation === "rollback") {
      const transactionId = projectChangeId(args[1]);
      const current = projectChanges.get(transactionId);
      if (!current) throw new Error("Desktop test project transaction is unknown");
      if (operation === "apply" && current.lifecycle === "applied") throw new Error("Desktop test project transaction is already applied");
      if (operation === "rollback" && current.lifecycle !== "applied") throw new Error("Desktop test project transaction is not applied");
      return recordProjectChange(transactionId, operation === "apply" ? "applied" : "rolled_back", current.diff, current);
    }
    if (operation === "close") {
      handle.closed = true;
      projectChangeHandles.delete(args[0]);
      if (handle.pending) { const resolveNext = handle.pending; handle.pending = null; resolveNext(null); }
      return null;
    }
    throw new Error("Unsupported Desktop test project change operation '" + operation + "'");
  }
  async function projectChangeTest(operation, args) {
    if (operation !== "seed" || args.length !== 3) throw new TypeError("Desktop test project change seed arguments are invalid");
    if (!grants.has("project")) throw new Error("Desktop test project change seed requires the project file grant");
    const transactionId = projectChangeId(args[0]);
    recordProjectChange(transactionId, projectChangeLifecycle(args[1]), projectChangeDiff(args[2]), projectChanges.get(transactionId) ?? null);
    return null;
  }

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

  const bridge = Object.freeze({
    platform: "test",
    packaged: false,
    projectDirectory: projectRoot,
    projectDirectoryValue() { return projectRoot; },
    environment,
    async invoke(capability, operation, args) {
      if (!Array.isArray(args)) throw new TypeError("Desktop test bridge args must be a list");
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
      if (capability === "project-changes") return projectChangeCapability(operation, args);
      if (capability === "project-change-test") return projectChangeTest(operation, args);
      throw new Error("Desktop test capability '" + capability + "' is not configured");
    },
  });
  Object.defineProperty(globalThis, protocol, { value: bridge, enumerable: false, configurable: false, writable: false });
})();
`.trim();
}
