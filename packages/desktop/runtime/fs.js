const watcherToken = Symbol("velar.desktop.fs.watcher");
const maxPathCodeUnits = 4096;
const maxFileBytes = 16 * 1024 * 1024;
const maxListItems = 100000;
const maxListTextUnits = 2 * 1024 * 1024;
const maxWatchPaths = 4096;
function pathOf(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || value.includes("\0")) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function byteLimit(value, operation) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxFileBytes) throw new RangeError(operation + " maxBytes must be an integer from 1 through 16777216");
  return value;
}
function textOf(value, operation) {
  if (typeof value !== "string") throw new TypeError(operation + " requires text");
  if (new TextEncoder().encode(value).byteLength > maxFileBytes) throw new RangeError(operation + " cannot write more than 16 MiB");
  return value;
}
function replaceOf(value, operation) {
  if (typeof value !== "boolean") throw new TypeError(operation + " replace must be bool");
  return value;
}
function recordOf(value, name, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(name + " must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(name + " must be a plain record");
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(name + " fields must use string names");
    if (!allowed.has(key)) throw new TypeError(name + " has unknown field '" + key + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function listOf(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError("Desktop host returned an invalid directory list");
  const output = [];
  let units = 0;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.length === 0 || descriptor.value.includes("/") || descriptor.value.includes("\0")) {
      throw new TypeError("Desktop host returned an invalid directory list");
    }
    units += descriptor.value.length;
    if (units > maxListTextUnits) throw new RangeError("Desktop directory list cannot exceed 2 MiB of text");
    output.push(descriptor.value);
  }
  return output.sort();
}
function infoOf(value) {
  if (value == null) return null;
  value = recordOf(value, "Desktop file info", new Set(["name", "kind", "size", "modifiedAt"]));
  if (typeof value.name !== "string" || value.name.length > maxPathCodeUnits || value.name.includes("/") || value.name.includes("\0")
    || !["file", "directory", "symlink", "other"].includes(value.kind)
    || !Number.isFinite(value.size) || value.size < 0
    || !Number.isFinite(value.modifiedAt)) throw new TypeError("Desktop host returned invalid file info");
  return Object.freeze({name: value.name, kind: value.kind, size: value.size, modifiedAt: value.modifiedAt});
}
function watchBatchOf(value) {
  value = recordOf(value, "Desktop file watch batch", new Set(["paths", "rescan"]));
  if (Reflect.ownKeys(value).length !== 2 || typeof value.rescan !== "boolean" || !Array.isArray(value.paths)
    || value.paths.length > maxWatchPaths || value.rescan && value.paths.length !== 0) {
    throw new TypeError("Desktop host returned an invalid file watch batch");
  }
  const paths = [];
  let units = 0;
  let previous = null;
  for (let index = 0; index < value.paths.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value.paths, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string"
      || descriptor.value.length === 0 || descriptor.value.length > maxPathCodeUnits || descriptor.value.includes("\0")
      || previous !== null && descriptor.value <= previous) throw new TypeError("Desktop host returned invalid file watch paths");
    units += descriptor.value.length;
    if (units > maxListTextUnits) throw new RangeError("Desktop file watch paths cannot exceed 2 MiB of text");
    paths.push(descriptor.value);
    previous = descriptor.value;
  }
  return Object.freeze({paths, rescan: value.rescan});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("fs", operation, args, timeout);
}
async function mutate(operation, args) {
  const value = await invoke(operation, args);
  if (value !== null) throw new TypeError("Desktop host returned an invalid " + operation + " result");
}
class FileWatcherHandle {
  constructor(token, handle) {
    if (token !== watcherToken || !Number.isSafeInteger(handle) || handle < 1) throw new TypeError("FileWatcher values are created only by velar/fs.watchFiles");
    this.handle = handle;
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new Error("FileWatcher.next already has an active pull");
      this.pending = true;
      try {
        const value = await invoke("watchNext", [this.handle], 0);
        if (value === null) { this.closed = true; return null; }
        return watchBatchOf(value);
      } catch (error) {
        this.closed = true;
        try { await invoke("watchClose", [this.handle]); } catch {}
        throw error;
      } finally {
        this.pending = false;
      }
    };
  }
  async close() {
    if (this.closed) return null;
    this.closed = true;
    const value = await invoke("watchClose", [this.handle]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid file watcher release result");
    return null;
  }
}
export const FileWatcher = Object.freeze({
  is(value) { return value instanceof FileWatcherHandle; },
  parse(value) { if (!(value instanceof FileWatcherHandle)) throw new TypeError("Value does not match FileWatcher"); return value; },
});
export const FileWatchBatch = Object.freeze({
  is(value) { try { watchBatchOf(value); return true; } catch { return false; } },
  parse(value) { return watchBatchOf(value); },
});
export async function readText(path, maxBytes = maxFileBytes) {
  maxBytes = byteLimit(maxBytes, "readText");
  const value = await invoke("readText", [pathOf(path, "readText"), maxBytes]);
  if (typeof value !== "string") throw new TypeError("Desktop host returned invalid file text");
  if (new TextEncoder().encode(value).byteLength > maxBytes) throw new RangeError("Desktop file text exceeds maxBytes");
  return value;
}
export async function createText(path, text) { await mutate("createText", [pathOf(path, "createText"), textOf(text, "createText")]); return null; }
export async function replaceTextIfMatches(path, expected, replacement) {
  const value = await invoke("replaceTextIfMatches", [pathOf(path, "replaceTextIfMatches"), textOf(expected, "replaceTextIfMatches expected"), textOf(replacement, "replaceTextIfMatches replacement")]);
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid replaceTextIfMatches result");
  return value;
}
export async function writeText(path, text) { await mutate("writeText", [pathOf(path, "writeText"), textOf(text, "writeText")]); return null; }
export async function appendText(path, text) { await mutate("appendText", [pathOf(path, "appendText"), textOf(text, "appendText")]); return null; }
export async function exists(path) {
  const value = await invoke("exists", [pathOf(path, "exists")]);
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned invalid file existence");
  return value;
}
export async function list(path, maxItems = maxListItems) {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > maxListItems) throw new RangeError("list maxItems must be an integer from 1 through 100000");
  return listOf(await invoke("list", [pathOf(path, "list"), maxItems]), maxItems);
}
export async function info(path) { return infoOf(await invoke("info", [pathOf(path, "info")])); }
export async function canonical(path) {
  const value = await invoke("canonical", [pathOf(path, "canonical")]);
  if (typeof value !== "string" || value.length === 0 || value.length > maxPathCodeUnits || value.includes("\0")) throw new TypeError("Desktop host returned an invalid canonical path");
  return value;
}
export async function makeDirectory(path) { await mutate("makeDirectory", [pathOf(path, "makeDirectory")]); return null; }
export async function copyFile(source, target, replace = false) { await mutate("copyFile", [pathOf(source, "copyFile"), pathOf(target, "copyFile"), replaceOf(replace, "copyFile")]); return null; }
export async function move(source, target, replace = false) { await mutate("move", [pathOf(source, "move"), pathOf(target, "move"), replaceOf(replace, "move")]); return null; }
export async function removeFile(path) { await mutate("removeFile", [pathOf(path, "removeFile")]); return null; }
export async function watchFiles(path, recursive = false) {
  path = pathOf(path, "watchFiles");
  if (typeof recursive !== "boolean") throw new TypeError("watchFiles recursive must be bool");
  return new FileWatcherHandle(watcherToken, await invoke("watchStart", [path, recursive]));
}
