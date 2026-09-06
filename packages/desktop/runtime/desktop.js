const maxDisplays = 64;
const maxDroppedPaths = 4096;
const maxDroppedTextUnits = 2 * 1024 * 1024;
const maxDesktopPathUnits = 4096;
const maxDesktopCoordinate = 1000000;
const desktopBoundsFields = new Set(["x", "y", "width", "height"]);
const desktopDisplayFields = new Set(["id", "bounds", "workArea", "scale", "primary"]);
const desktopDropFields = new Set(["paths"]);
export const DesktopPlatform = __velarRegisterRuntimeType(__velarDesktopFreeze({
  macos: "macos", test: "test",
  is(value) { return value === "macos" || value === "test"; },
  parse(value) {
    if (!DesktopPlatform.is(value)) throw new TypeError("Value does not match DesktopPlatform");
    return value;
  },
  values() { return ["macos", "test"]; },
}));
// D60 rule 149: is, parse and values on every module-provided enum, and a
// member whose runtime value is its own name.
export const SystemPermission = __velarRegisterRuntimeType(__velarDesktopFreeze({
  screenRecording: "screenRecording", accessibility: "accessibility", microphone: "microphone",
  is(value) { return value === "screenRecording" || value === "accessibility" || value === "microphone"; },
  parse(value) {
    if (!SystemPermission.is(value)) throw new TypeError("Value does not match SystemPermission");
    return value;
  },
  values() { return ["screenRecording", "accessibility", "microphone"]; },
}));
export const PermissionStatus = __velarRegisterRuntimeType(__velarDesktopFreeze({
  granted: "granted", denied: "denied", undetermined: "undetermined",
  is(value) { return value === "granted" || value === "denied" || value === "undetermined"; },
  parse(value) {
    if (!PermissionStatus.is(value)) throw new TypeError("Value does not match PermissionStatus");
    return value;
  },
  values() { return ["granted", "denied", "undetermined"]; },
}));
export const PowerState = __velarRegisterRuntimeType(__velarDesktopFreeze({
  suspended: "suspended", resumed: "resumed",
  is(value) { return value === "suspended" || value === "resumed"; },
  parse(value) {
    if (!PowerState.is(value)) throw new TypeError("Value does not match PowerState");
    return value;
  },
  values() { return ["suspended", "resumed"]; },
}));
// Every module validates the host's answer on its own side of the bridge, so
// this record reader is the peer of recordOf in the velar/window, velar/fs and
// velar/process runtimes rather than a stray copy: the shape is defined once in
// packages/desktop/src/compiler.ts's type tables, and each module checks it.
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
function boundsOf(value, name) {
  const fields = recordOf(value, name, desktopBoundsFields);
  if (Reflect.ownKeys(fields).length !== 4) throw new TypeError(name + " must contain x, y, width and height");
  for (const key of ["x", "y"]) {
    if (typeof fields[key] !== "number" || !Number.isFinite(fields[key]) || Math.abs(fields[key]) > maxDesktopCoordinate) {
      throw new RangeError(name + " " + key + " must be a finite screen coordinate within 1000000 points");
    }
  }
  for (const key of ["width", "height"]) {
    if (typeof fields[key] !== "number" || !Number.isFinite(fields[key]) || fields[key] < 1 || fields[key] > maxDesktopCoordinate) {
      throw new RangeError(name + " " + key + " must be a finite size of at least 1 point");
    }
  }
  return __velarDesktopFreeze({x: fields.x, y: fields.y, width: fields.width, height: fields.height});
}
function displayOf(value) {
  const fields = recordOf(value, "Desktop display", desktopDisplayFields);
  if (Reflect.ownKeys(fields).length !== 5 || typeof fields.id !== "string" || fields.id.length === 0 || fields.id.length > 128
    || typeof fields.primary !== "boolean" || typeof fields.scale !== "number" || !Number.isFinite(fields.scale)
    || fields.scale <= 0 || fields.scale > 16) {
    throw new TypeError("Desktop host returned an invalid display");
  }
  return __velarDesktopFreeze({
    id: fields.id,
    bounds: boundsOf(fields.bounds, "Desktop display bounds"),
    workArea: boundsOf(fields.workArea, "Desktop display work area"),
    scale: fields.scale,
    primary: fields.primary,
  });
}
function droppedFilesOf(value) {
  const fields = recordOf(value, "Desktop dropped files", desktopDropFields);
  if (Reflect.ownKeys(fields).length !== 1 || !Array.isArray(fields.paths) || fields.paths.length === 0 || fields.paths.length > maxDroppedPaths) {
    throw new TypeError("Desktop host returned an invalid dropped file batch");
  }
  const paths = [];
  let units = 0;
  for (let index = 0; index < fields.paths.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(fields.paths, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string"
      || descriptor.value.length === 0 || descriptor.value[0] !== "/" || descriptor.value.length > maxDesktopPathUnits
      || descriptor.value.includes("\0")) throw new TypeError("Desktop host returned an invalid dropped file path");
    units += descriptor.value.length;
    if (units > maxDroppedTextUnits) throw new RangeError("Desktop dropped file paths cannot exceed 2 MiB of text");
    paths[paths.length] = descriptor.value;
  }
  // The order is the order of the gesture, so it is preserved rather than
  // sorted: the first file the user dropped is the first path here.
  return __velarDesktopFreeze({paths});
}
export const Display = __velarDesktopFreeze({
  is(value) { try { displayOf(value); return true; } catch { return false; } },
  parse(value) { return displayOf(value); },
});
export const DroppedFiles = __velarDesktopFreeze({
  is(value) { try { droppedFilesOf(value); return true; } catch { return false; } },
  parse(value) { return droppedFilesOf(value); },
});
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("desktop", operation, args, timeout);
}
export function platform() {
  return DesktopPlatform.parse(__velarDesktopHostField("platform"));
}
export function packaged() {
  const value = __velarDesktopHostField("packaged");
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid packaged marker");
  return value;
}
async function path(operation) {
  const value = await invoke(operation, []);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > maxDesktopPathUnits || value.includes("\0")) throw new TypeError("Desktop host returned an invalid absolute path");
  return value;
}
async function optionalPath(operation, timeout = 30000) {
  const value = await invoke(operation, [], timeout);
  if (value === null) return null;
  if (typeof value !== "string" || !value.startsWith("/") || value.length > maxDesktopPathUnits || value.includes("\0")) throw new TypeError("Desktop host returned an invalid optional project path");
  return value;
}
export async function homeDirectory() { return path("homeDirectory"); }
export async function appDataDirectory() { return path("appDataDirectory"); }
export async function projectDirectory() { return path("projectDirectory"); }
export async function selectedProjectDirectory() { return optionalPath("selectedProjectDirectory"); }
export async function selectProjectDirectory() { return optionalPath("selectProjectDirectory", 0); }
// The scheme is read off the parsed URL rather than off its text, because a
// nested scheme such as blob:https://host/id names one scheme and reads as
// another. The same question is asked again in the native host before
// NSWorkspace opens anything.
function linkSchemeOf(url) {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048 || url.includes("\0")) {
    throw new TypeError("openExternal requires a bounded URL string");
  }
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new TypeError("openExternal requires an absolute URL"); }
  const scheme = parsed.protocol.slice(0, -1);
  if (!grantedLinkSchemes.has(scheme)) {
    throw new Error("openExternal cannot open a '" + scheme + "' URL; declare the scheme under 'desktop.permissions.links' in this project's velar.json (granted schemes: " + grantedLinkSchemeList + ")");
  }
  return url;
}
export async function openExternal(url) {
  const value = await invoke("openExternal", [linkSchemeOf(url)]);
  if (value !== null) throw new TypeError("Desktop host returned an invalid openExternal result");
  return null;
}
// The update mechanism, and only the mechanism. Downloading the archive,
// deciding when to look for one, which channel to look on, and what to do when
// the user declines are the product's; what this does is hand the host a local
// archive and let it decide whether that archive is this same application,
// signed by the same team. It is not a permission the manifest grants: the
// identity check is the grant, and an archive that fails it changes nothing.
//
// There is no timeout, because expanding and verifying a signed application
// bundle is bounded by its size rather than by a number chosen here. On success
// the application relaunches immediately, so a program should not expect to run
// its own code afterwards.
export async function applyUpdate(archivePath) {
  if (typeof archivePath !== "string" || archivePath.length === 0 || archivePath[0] !== "/"
    || archivePath.length > maxDesktopPathUnits || archivePath.includes("\0")) {
    throw new TypeError("applyUpdate requires a bounded absolute path to a downloaded application archive");
  }
  const value = await invoke("applyUpdate", [archivePath], 0);
  if (value !== null) throw new TypeError("Desktop host returned an invalid applyUpdate result");
  return null;
}
export async function displays() {
  const value = await invoke("displays", []);
  if (!Array.isArray(value) || value.length === 0 || value.length > maxDisplays) throw new TypeError("Desktop host returned an invalid display list");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop host returned an invalid display list");
    output[output.length] = displayOf(descriptor.value);
  }
  return output;
}
export async function permissionStatus(kind) {
  return PermissionStatus.parse(await invoke("permissionStatus", [SystemPermission.parse(kind)]));
}
// The two bounded pull streams §5 publishes. Both are the shape watchFiles and
// watchState already keep: one active pull at a time, a release that answers
// the host once, and a failed pull that closes the stream rather than leaving
// a handle behind.
class DesktopStreamHandle {
  constructor(token, handle, operations, read) {
    if (token !== desktopStreamToken) throw new TypeError("Desktop streams are created only by velar/desktop");
    if (!Number.isSafeInteger(handle) || handle < 1) throw new TypeError("Desktop host returned an invalid stream handle");
    this.handle = handle;
    this.operations = operations;
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new Error(operations.label + ".next already has an active pull");
      this.pending = true;
      try {
        const value = await invoke(operations.next, [this.handle], 0);
        if (value === null) { this.closed = true; return null; }
        return read(value);
      } catch (error) {
        this.closed = true;
        try { await invoke(operations.close, [this.handle]); } catch {}
        throw error;
      } finally {
        this.pending = false;
      }
    };
    Object.seal(this);
  }
  async close() {
    if (this.closed) return null;
    this.closed = true;
    const value = await invoke(this.operations.close, [this.handle]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid " + this.operations.label + " release result");
    return null;
  }
}
const powerOperations = __velarDesktopFreeze({label: "PowerStream", next: "powerWatchNext", close: "powerWatchClose"});
const dropOperations = __velarDesktopFreeze({label: "DroppedFilesStream", next: "dropWatchNext", close: "dropWatchClose"});
export const PowerStream = __velarDesktopFreeze({
  is(value) { return value instanceof DesktopStreamHandle && value.operations === powerOperations; },
  parse(value) {
    if (!PowerStream.is(value)) throw new TypeError("Value does not match PowerStream");
    return value;
  },
});
export const DroppedFilesStream = __velarDesktopFreeze({
  is(value) { return value instanceof DesktopStreamHandle && value.operations === dropOperations; },
  parse(value) {
    if (!DroppedFilesStream.is(value)) throw new TypeError("Value does not match DroppedFilesStream");
    return value;
  },
});
export async function watchPower() {
  return new DesktopStreamHandle(desktopStreamToken, await invoke("powerWatchStart", []), powerOperations, (value) => PowerState.parse(value));
}
export async function watchDroppedFiles() {
  if (!droppedFilesGranted) {
    throw new Error("watchDroppedFiles requires the 'dropped' root in 'desktop.permissions.files' in this project's velar.json");
  }
  return new DesktopStreamHandle(desktopStreamToken, await invoke("dropWatchStart", []), dropOperations, droppedFilesOf);
}
