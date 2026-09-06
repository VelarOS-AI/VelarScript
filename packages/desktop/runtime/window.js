const maxWindowInfoItems = 256;
const maxWindowCoordinate = 1000000;
const boundsFields = new Set(["x", "y", "width", "height"]);
const displayFields = new Set(["id", "bounds", "workArea", "scale", "primary"]);
const infoFields = new Set(["kind", "key", "focused"]);
const openOptionFields = new Set(["route", "key", "bounds"]);
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
function coordinate(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maxWindowCoordinate) {
    throw new RangeError(name + " must be a finite screen coordinate within 1000000 points");
  }
  return value;
}
function extent(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > maxWindowCoordinate) {
    throw new RangeError(name + " must be a finite size of at least 1 point");
  }
  return value;
}
function boundsOf(value, name) {
  const fields = recordOf(value, name, boundsFields);
  if (Reflect.ownKeys(fields).length !== 4) throw new TypeError(name + " must contain x, y, width and height");
  return Object.freeze({
    x: coordinate(fields.x, name + " x"),
    y: coordinate(fields.y, name + " y"),
    width: extent(fields.width, name + " width"),
    height: extent(fields.height, name + " height"),
  });
}
function displayOf(value) {
  const fields = recordOf(value, "Desktop display", displayFields);
  if (Reflect.ownKeys(fields).length !== 5 || typeof fields.id !== "string" || fields.id.length === 0 || fields.id.length > 128
    || typeof fields.primary !== "boolean" || typeof fields.scale !== "number" || !Number.isFinite(fields.scale)
    || fields.scale <= 0 || fields.scale > 16) {
    throw new TypeError("Desktop host returned an invalid display");
  }
  return Object.freeze({
    id: fields.id,
    bounds: boundsOf(fields.bounds, "Desktop display bounds"),
    workArea: boundsOf(fields.workArea, "Desktop display work area"),
    scale: fields.scale,
    primary: fields.primary,
  });
}
function windowKindOf(value, operation) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError(operation + " requires a window kind declared in desktop.windows");
  }
  if (!declaredWindowKinds.has(value)) {
    throw new Error(operation + " cannot open the undeclared window kind '" + value
      + "'; declare it under 'desktop.windows' in this project's velar.json (declared kinds: " + declaredWindowKindList + ")");
  }
  return value;
}
// The instance-key rule is re-checked at every boundary it crosses, because a
// boundary that trusts the last one is a boundary that is not there: this is the
// renderer's copy, windowKeyValue in packages/desktop/src/test-runtime.ts is the
// fake registry's, and validate(key:) in
// packages/desktop/native/macos/VelarDesktopHost.swift is the native host's.
// The three must not drift.
function windowKeyOf(value, operation) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new TypeError(operation + " key must be at most 128 characters of letters, digits, '.', '_', ':' or '-'");
  }
  return value;
}
function routeOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || value.includes("\0")) {
    throw new TypeError("openWindow route must be a bounded in-application path");
  }
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") {
    throw new TypeError("openWindow route must start with '/' and stay inside this application");
  }
  return value;
}
function openOptionsOf(value) {
  if (value == null) value = {};
  const fields = recordOf(value, "openWindow options", openOptionFields);
  return {
    route: routeOf(fields.route),
    key: windowKeyOf(fields.key, "openWindow"),
    bounds: fields.bounds == null ? null : boundsOf(fields.bounds, "openWindow bounds"),
  };
}
function windowHandleOf(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Desktop host returned an invalid window handle");
  return value;
}
function infoOf(value) {
  const fields = recordOf(value, "Desktop window info", infoFields);
  if (Reflect.ownKeys(fields).length !== 3 || typeof fields.focused !== "boolean" || !declaredWindowKinds.has(fields.kind)) {
    throw new TypeError("Desktop host returned invalid window information");
  }
  return Object.freeze({kind: fields.kind, key: windowKeyOf(fields.key, "windows"), focused: fields.focused});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("window", operation, args, timeout);
}
async function settle(operation, args) {
  const value = await invoke(operation, args);
  if (value !== null) throw new TypeError("Desktop host returned an invalid " + operation + " result");
  return null;
}
export const WindowState = __velarRegisterRuntimeType(Object.freeze({
  moved: "moved", resized: "resized", focused: "focused", blurred: "blurred", closed: "closed",
  is(value) { return value === "moved" || value === "resized" || value === "focused" || value === "blurred" || value === "closed"; },
  parse(value) {
    if (!WindowState.is(value)) throw new TypeError("Value does not match WindowState");
    return value;
  },
  // D60 rule 149: values() is the third name charter section 6 reserves on
  // every enum, and it returns a fresh mutable List in declaration order.
  values() { return ["moved", "resized", "focused", "blurred", "closed"]; },
}));
export const WindowBounds = Object.freeze({
  is(value) { try { boundsOf(value, "WindowBounds"); return true; } catch { return false; } },
  parse(value) { return boundsOf(value, "WindowBounds"); },
});
class WindowStateStreamHandle {
  constructor(token, handle) {
    if (token !== windowStreamToken) throw new TypeError("WindowStateStream values are created only by velar/window.watchState");
    this.handle = windowHandleOf(handle);
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new Error("WindowStateStream.next already has an active pull");
      this.pending = true;
      try {
        const value = await invoke("watchNext", [this.handle], 0);
        if (value === null) { this.closed = true; return null; }
        return WindowState.parse(value);
      } catch (error) {
        this.closed = true;
        try { await invoke("watchClose", [this.handle]); } catch {}
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
    const value = await invoke("watchClose", [this.handle]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid window state stream release result");
    return null;
  }
}
class WindowHandle {
  constructor(token, handle, kind) {
    if (token !== windowToken) throw new TypeError("Window values are created only by velar/window");
    this.handle = windowHandleOf(handle);
    this.kind = kind;
    this.released = false;
    Object.seal(this);
  }
  async focus() { return settle("focus", [this.handle]); }
  // Releasing a Window closes it, and closing an already closed window is the
  // state it is already in, so the second call is not an error: the host
  // answers false for a handle its registry no longer holds.
  async close() {
    if (this.released) return null;
    this.released = true;
    const value = await invoke("close", [this.handle]);
    if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid window release result");
    return null;
  }
  async bounds() { return boundsOf(await invoke("bounds", [this.handle]), "Desktop window bounds"); }
  async setBounds(bounds) { return settle("setBounds", [this.handle, boundsOf(bounds, "setBounds bounds")]); }
  async display() { return displayOf(await invoke("display", [this.handle])); }
  async watchState() { return new WindowStateStreamHandle(windowStreamToken, await invoke("watchStart", [this.handle])); }
}
export const Window = Object.freeze({
  is(value) { return value instanceof WindowHandle; },
  parse(value) { if (!(value instanceof WindowHandle)) throw new TypeError("Value does not match Window"); return value; },
});
export const WindowStateStream = Object.freeze({
  is(value) { return value instanceof WindowStateStreamHandle; },
  parse(value) { if (!(value instanceof WindowStateStreamHandle)) throw new TypeError("Value does not match WindowStateStream"); return value; },
});
export function currentWindowKind() {
  const value = __velarDesktopHostField("windowKind");
  if (typeof value !== "string" || !declaredWindowKinds.has(value)) throw new TypeError("Desktop host reported an undeclared window kind");
  return value;
}
export function currentWindow() {
  return new WindowHandle(windowToken, __velarDesktopHostField("windowHandle"), currentWindowKind());
}
export async function openWindow(kind, options = {}) {
  kind = windowKindOf(kind, "openWindow");
  return new WindowHandle(windowToken, await invoke("open", [kind, openOptionsOf(options)]), kind);
}
export async function windows() {
  const value = await invoke("list", []);
  if (!Array.isArray(value) || value.length > maxWindowInfoItems) throw new TypeError("Desktop host returned an invalid window list");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop host returned an invalid window list");
    output[output.length] = infoOf(descriptor.value);
  }
  return output;
}
