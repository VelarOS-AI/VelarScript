import { optionalOf, type CompilerExtension, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { VELAR_STRICT_JSON_RUNTIME, VELAR_TYPE_REGISTRY_RUNTIME, VELAR_UTF8_RUNTIME } from "@velarscript/compiler/extension";
import { velarCompilerExtension as webCompilerExtension, webModuleSource } from "@velarscript/web/compiler";
import { nodeModuleInterfaces, VELAR_NODE_API_VERSION, VELAR_PROCESS_HOST_RUNTIME } from "@velarscript/node/compiler";
import { DESKTOP_MAIN_WINDOW_KIND, VELAR_DESKTOP_API_VERSION, velarProjectExtension, type VelarDesktopConfig } from "./config.ts";

const stringType: ValueType = { kind: "string" };
const boolType: ValueType = { kind: "bool" };
const numberType: ValueType = { kind: "number" };
const nullType: ValueType = { kind: "null" };
const optionalStringType = optionalOf(stringType);

function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

function promiseOf(value: ValueType): ValueType {
  return { kind: "promise", value };
}

function listOf(element: ValueType): ValueType {
  return { kind: "list", element };
}

function objectType(fields: Readonly<Record<string, ValueType>>, optionalFields: readonly string[] = []): ValueType {
  return {
    kind: "object",
    fields: new Map(Object.entries(fields)),
    ...(optionalFields.length > 0 ? { optionalFields: new Set(optionalFields) } : {}),
  };
}

function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes: new Map(),
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

// D60 rule 153: a capability fails where it is *used*, never where it is
// imported. The bridge is still captured while the module initializes, so a
// later write to globalThis cannot substitute one -- only the report of its
// absence moves to the call. Module initialization that threw punished code
// that never called the capability: a pure function written beside a
// `velar/desktop` import could not be loaded by a non-browser `velar test`,
// which made the language demand a file split for testability. This mirrors
// what velar/storage already does on the Web side.
const DESKTOP_HOST_ABI_RUNTIME = String.raw`
const __velarDesktopBridgeKey = Symbol.for("velar.desktop.bridge.v1");
const __velarDesktopGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarDesktopReflectApply = Reflect.apply;
const __velarDesktopBridgeDescriptor = __velarDesktopGetOwnPropertyDescriptor(globalThis, __velarDesktopBridgeKey);
const __velarDesktopBridge = __velarDesktopBridgeDescriptor && "value" in __velarDesktopBridgeDescriptor
  && __velarDesktopBridgeDescriptor.value && typeof __velarDesktopBridgeDescriptor.value === "object"
  ? __velarDesktopBridgeDescriptor.value
  : null;
const __velarDesktopInvokeDescriptor = __velarDesktopBridge === null
  ? null
  : __velarDesktopGetOwnPropertyDescriptor(__velarDesktopBridge, "invoke");
const __velarDesktopInvoke = __velarDesktopInvokeDescriptor && "value" in __velarDesktopInvokeDescriptor
  && typeof __velarDesktopInvokeDescriptor.value === "function"
  ? __velarDesktopInvokeDescriptor.value
  : null;
function __velarDesktopRequireBridge() {
  if (__velarDesktopBridge === null) throw new Error("VelarScript Desktop bridge is unavailable");
  if (__velarDesktopInvoke === null) throw new TypeError("Desktop bridge invoke must be a function data value");
  return __velarDesktopBridge;
}
function __velarDesktopHostField(name) {
  const descriptor = __velarDesktopGetOwnPropertyDescriptor(__velarDesktopRequireBridge(), name);
  if (!descriptor || !("value" in descriptor)) throw new TypeError("Desktop bridge field '" + name + "' must be a data value");
  return descriptor.value;
}
function __velarDesktopHostCall(capability, operation, args, timeout = 30000) {
  const bridge = __velarDesktopRequireBridge();
  return __velarDesktopReflectApply(__velarDesktopInvoke, bridge, [capability, operation, args, timeout]);
}
`.trim();

const desktopPlatformIdentity = "velar/desktop#enum:DesktopPlatform";
const desktopPlatforms = new Set(["macos", "test"]);
const desktopPlatformWireValues = new Map([...desktopPlatforms].map((member) => [member, member]));
const desktopPlatformType: ValueType = { kind: "enum", name: "DesktopPlatform", identity: desktopPlatformIdentity };
const desktopModuleInterface = moduleInterface(new Map([
  ["DesktopPlatform", { kind: "enumObject", name: "DesktopPlatform", identity: desktopPlatformIdentity, members: desktopPlatforms }],
  ["platform", functionType([], desktopPlatformType)],
  ["packaged", functionType([], boolType)],
  ["homeDirectory", functionType([], { kind: "promise", value: stringType })],
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["projectDirectory", functionType([], { kind: "promise", value: stringType })],
  ["selectedProjectDirectory", functionType([], { kind: "promise", value: optionalStringType })],
  ["selectProjectDirectory", functionType([], { kind: "promise", value: optionalStringType })],
]), new Map(), new Map(), new Map([
  ["DesktopPlatform", { identity: desktopPlatformIdentity, members: desktopPlatforms, wireValues: desktopPlatformWireValues }],
]));

// `velar/window` — the Desktop window surface. A window kind is declared in
// `desktop.windows`; nothing here invents one. The handle families follow the
// two contracts the rest of the target already keeps: an owned resource is
// released by `close()` (charter section 16, so `using` supplies the release),
// and an event source is a bounded pull stream with no callback registry, the
// same shape `velar/fs.watchFiles` publishes.
const windowStateIdentity = "velar/window#enum:WindowState";
const windowStateMembers = new Set(["moved", "resized", "focused", "blurred", "closed"]);
const windowStateWireValues = new Map([...windowStateMembers].map((member) => [member, member]));
const windowStateType: ValueType = { kind: "enum", name: "WindowState", identity: windowStateIdentity };
const windowType: ValueType = { kind: "named", name: "Window", identity: "velar/window#type:Window" };
const windowStateStreamType: ValueType = { kind: "named", name: "WindowStateStream", identity: "velar/window#type:WindowStateStream" };
const windowBoundsType = objectType({ x: numberType, y: numberType, width: numberType, height: numberType });
const windowInfoType = objectType({ kind: stringType, key: optionalStringType, focused: boolType });
// The `Display` record spec section 5 names. It is spelled structurally here
// because `velar/desktop.displays()` — the L1b half of the same concept —
// publishes the name, and a type alias is structural, so the two stay one
// record rather than two.
const windowDisplayType = objectType({
  id: stringType,
  bounds: windowBoundsType,
  workArea: windowBoundsType,
  scale: numberType,
  primary: boolType,
});
const openWindowOptionsType = objectType({
  route: stringType,
  key: optionalStringType,
  bounds: optionalOf(windowBoundsType),
}, ["key", "bounds"]);

const windowModuleInterface = moduleInterface(
  new Map<string, ValueType>([
    ["Window", { kind: "typeObject", name: "Window" }],
    ["WindowBounds", { kind: "typeObject", name: "WindowBounds" }],
    ["WindowState", { kind: "enumObject", name: "WindowState", identity: windowStateIdentity, members: windowStateMembers }],
    ["WindowStateStream", { kind: "typeObject", name: "WindowStateStream" }],
    ["currentWindowKind", functionType([], stringType)],
    ["currentWindow", functionType([], windowType)],
    ["openWindow", functionType([stringType, openWindowOptionsType], promiseOf(windowType))],
    ["windows", functionType([], promiseOf(listOf(windowInfoType)))],
  ]),
  new Map([
    ["Window", new Map<string, ValueType>([
      ["focus", functionType([], promiseOf(nullType))],
      ["close", functionType([], promiseOf(nullType))],
      ["bounds", functionType([], promiseOf(windowBoundsType))],
      ["setBounds", functionType([windowBoundsType], promiseOf(nullType))],
      ["display", functionType([], promiseOf(windowDisplayType))],
      ["watchState", functionType([], promiseOf(windowStateStreamType))],
    ])],
    ["WindowStateStream", new Map<string, ValueType>([
      ["next", functionType([], promiseOf(optionalOf(windowStateType)))],
      ["close", functionType([], promiseOf(nullType))],
    ])],
  ]),
  new Map([
    ["Window", "velar/window#type:Window"],
    ["WindowStateStream", "velar/window#type:WindowStateStream"],
  ]),
  new Map([
    ["WindowState", { identity: windowStateIdentity, members: windowStateMembers, wireValues: windowStateWireValues }],
  ]),
  new Map([["WindowBounds", windowBoundsType]]),
);

const desktopTestModuleInterface = moduleInterface(new Map([
  ["setPlatform", functionType([desktopPlatformType], { kind: "promise", value: nullType })],
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["projectDirectory", functionType([], { kind: "promise", value: stringType })],
  ["makeDirectory", functionType([stringType], { kind: "promise", value: nullType })],
  ["readText", functionType([stringType, { kind: "number" }], { kind: "promise", value: stringType })],
  ["writeText", functionType([stringType, stringType], { kind: "promise", value: nullType })],
  ["removeFile", functionType([stringType], { kind: "promise", value: nullType })],
  // The fake window registry. `setWindowKind` is the `setPlatform` shape — one
  // pre-navigation choice, sealed by the first `browser.open()` — and the four
  // below are the host events a real window system produces, so a test drives
  // the same stream the native host feeds rather than a second mechanism.
  ["setWindowKind", functionType([stringType], promiseOf(nullType))],
  ["openWindows", functionType([], promiseOf(listOf(windowInfoType)))],
  ["focusWindow", functionType([stringType, optionalStringType], promiseOf(nullType), 1)],
  ["moveWindow", functionType([stringType, optionalStringType, windowBoundsType], promiseOf(nullType))],
  ["closeWindow", functionType([stringType, optionalStringType], promiseOf(nullType), 1)],
]));

const nodeProcessInterface = nodeModuleInterfaces.get("velar/process")!;
const desktopProcessInterface: ModuleInterface = nodeProcessInterface;

const DESKTOP_MODULE_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
const __velarDesktopFreeze = Object.freeze;
export const DesktopPlatform = __velarRegisterRuntimeType(__velarDesktopFreeze({
  macos: "macos", test: "test",
  is(value) { return value === "macos" || value === "test"; },
  parse(value) {
    if (!DesktopPlatform.is(value)) throw new TypeError("Value does not match DesktopPlatform");
    return value;
  },
  values() { return ["macos", "test"]; },
}));
export function platform() {
  return DesktopPlatform.parse(__velarDesktopHostField("platform"));
}
export function packaged() {
  const value = __velarDesktopHostField("packaged");
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid packaged marker");
  return value;
}
async function path(operation) {
  const value = await __velarDesktopHostCall("desktop", operation, []);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop host returned an invalid absolute path");
  return value;
}
async function optionalPath(operation, timeout = 30000) {
  const value = await __velarDesktopHostCall("desktop", operation, [], timeout);
  if (value === null) return null;
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop host returned an invalid optional project path");
  return value;
}
export async function homeDirectory() { return path("homeDirectory"); }
export async function appDataDirectory() { return path("appDataDirectory"); }
export async function projectDirectory() { return path("projectDirectory"); }
export async function selectedProjectDirectory() { return optionalPath("selectedProjectDirectory"); }
export async function selectProjectDirectory() { return optionalPath("selectProjectDirectory", 0); }
`.trimStart();

const DESKTOP_TEST_SOURCE = String.raw`
const runtimeKey = Symbol.for("velar.browser.test.v1");
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
function invoke(capability, operation, args, timeout) {
  // The controller replaces this runtime for every isolated browser test, so
  // this test-only module deliberately resolves one data-only snapshot per
  // call instead of retaining a previous test's Page authority.
  const runtimeDescriptor = getOwnPropertyDescriptor(globalThis, runtimeKey);
  if (!runtimeDescriptor || !("value" in runtimeDescriptor) || !runtimeDescriptor.value || typeof runtimeDescriptor.value !== "object") {
    throw new Error("velar/desktop-test requires 'velar test --browser'");
  }
  const runtime = runtimeDescriptor.value;
  const invokeDescriptor = getOwnPropertyDescriptor(runtime, "frameworkInvoke");
  if (!invokeDescriptor || !("value" in invokeDescriptor) || typeof invokeDescriptor.value !== "function") {
    throw new Error("velar/desktop-test requires 'velar test --browser'");
  }
  return reflectApply(invokeDescriptor.value, runtime, [capability, operation, args, timeout]);
}
export async function setPlatform(value) {
  if (value !== "macos" && value !== "test") throw new TypeError("Desktop test setPlatform requires a DesktopPlatform value");
  const result = await invoke("desktop-test", "setPlatform", [value], 30000);
  if (result !== null) throw new TypeError("Desktop test host returned an invalid platform setup result");
  return null;
}
export async function appDataDirectory() {
  const value = await invoke("desktop", "appDataDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute app-data path");
  return value;
}
export async function projectDirectory() {
  const value = await invoke("desktop", "projectDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute project path");
  return value;
}
export async function makeDirectory(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test makeDirectory requires a bounded path");
  const value = await invoke("fs", "makeDirectory", [path], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid directory result");
  return null;
}
export async function readText(path, maxBytes) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test readText requires a bounded path");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new RangeError("Desktop test readText maxBytes is outside its supported bounds");
  const value = await invoke("fs", "readText", [path, maxBytes], 30000);
  if (typeof value !== "string") throw new TypeError("Desktop test host returned invalid file text");
  return value;
}
export async function writeText(path, text) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test writeText requires a bounded path");
  if (typeof text !== "string") throw new TypeError("Desktop test writeText requires text");
  const value = await invoke("fs", "writeText", [path, text], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid write result");
  return null;
}
export async function removeFile(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test removeFile requires a bounded path");
  const value = await invoke("fs", "removeFile", [path], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid remove result");
  return null;
}
// The declared kinds live in the manifest, and the fake registry answers from
// them, so this bounds the argument and lets the registry refuse an undeclared
// kind by name rather than restating the manifest's own naming rule here.
function testWindowKind(value, operation) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError("Desktop test " + operation + " requires a declared window kind");
  }
  return value;
}
function testWindowKey(value, operation) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new TypeError("Desktop test " + operation + " key must be at most 128 characters of letters, digits, '.', '_', ':' or '-'");
  }
  return value;
}
function testWindowBounds(value, operation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop test " + operation + " requires WindowBounds");
  const output = {};
  for (const name of ["x", "y", "width", "height"]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "number" || !Number.isFinite(descriptor.value)) {
      throw new TypeError("Desktop test " + operation + " requires WindowBounds");
    }
    output[name] = descriptor.value;
  }
  return output;
}
export async function setWindowKind(kind) {
  const result = await invoke("desktop-test", "setWindowKind", [testWindowKind(kind, "setWindowKind")], 30000);
  if (result !== null) throw new TypeError("Desktop test host returned an invalid window kind setup result");
  return null;
}
export async function openWindows() {
  const value = await invoke("window", "list", [], 30000);
  if (!Array.isArray(value) || value.length > 256) throw new TypeError("Desktop test host returned an invalid window list");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || typeof item.focused !== "boolean") throw new TypeError("Desktop test host returned invalid window information");
    output[output.length] = Object.freeze({
      kind: testWindowKind(item.kind, "openWindows"),
      key: testWindowKey(item.key, "openWindows"),
      focused: item.focused,
    });
  }
  return output;
}
async function windowEvent(operation, args) {
  const value = await invoke("window-test", operation, args, 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid " + operation + " result");
  return null;
}
export async function focusWindow(kind, key = null) {
  return windowEvent("focus", [testWindowKind(kind, "focusWindow"), testWindowKey(key, "focusWindow")]);
}
export async function moveWindow(kind, key, bounds) {
  return windowEvent("move", [testWindowKind(kind, "moveWindow"), testWindowKey(key, "moveWindow"), testWindowBounds(bounds, "moveWindow")]);
}
export async function closeWindow(kind, key = null) {
  return windowEvent("close", [testWindowKind(kind, "closeWindow"), testWindowKey(key, "closeWindow")]);
}
`.trimStart();

/**
 * `velar/window`'s runtime, closed over the window kinds this project's
 * manifest declares. The kinds are baked in rather than fetched, so an
 * undeclared kind is refused at the `openWindow` call with the manifest field
 * that would declare it, before any request reaches the host — and the host
 * refuses the same kind again on its own side.
 */
function desktopWindowSource(kinds: readonly string[]): string {
  return String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
const windowToken = Symbol("velar.desktop.window");
const windowStreamToken = Symbol("velar.desktop.window.state");
const declaredWindowKinds = new Set(${JSON.stringify(kinds)});
const declaredWindowKindList = ${JSON.stringify(kinds.join(", "))};
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
`.trimStart();
}

const DESKTOP_PATH_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const maxPathCodeUnits = 4096;
const pathApply = Reflect.apply;
const pathArrayIsArray = Array.isArray;
const pathArrayJoin = Array.prototype.join;
const pathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const pathStringIndexOf = String.prototype.indexOf;
const pathStringSlice = String.prototype.slice;
const pathStringToLowerCase = String.prototype.toLowerCase;
const pathEncodeURIComponent = encodeURIComponent;
const pathDecodeURIComponent = decodeURIComponent;
const pathNativeURL = URL;
const pathURLProtocol = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "protocol")?.get;
const pathURLUsername = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "username")?.get;
const pathURLPassword = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "password")?.get;
const pathURLPort = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "port")?.get;
const pathURLSearch = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "search")?.get;
const pathURLHash = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "hash")?.get;
const pathURLHostname = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "hostname")?.get;
const pathURLPathname = pathGetOwnPropertyDescriptor(pathNativeURL.prototype, "pathname")?.get;
if (typeof pathURLProtocol !== "function" || typeof pathURLUsername !== "function" || typeof pathURLPassword !== "function"
  || typeof pathURLPort !== "function" || typeof pathURLSearch !== "function" || typeof pathURLHash !== "function"
  || typeof pathURLHostname !== "function" || typeof pathURLPathname !== "function") {
  throw new TypeError("Desktop path URL runtime is unavailable");
}
function stringIndexOf(value, search) { return pathApply(pathStringIndexOf, value, [search]); }
function stringSlice(value, start, end) { return pathApply(pathStringSlice, value, end === undefined ? [start] : [start, end]); }
function stringToLowerCase(value) { return pathApply(pathStringToLowerCase, value, []); }
function arrayJoin(value, separator) { return pathApply(pathArrayJoin, value, [separator]); }
function urlValue(value, getter) { return pathApply(getter, value, []); }
function checked(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(operation + " requires a non-empty path string");
  if (value.length > maxPathCodeUnits || stringIndexOf(value, "\0") !== -1) throw new RangeError(operation + " path is outside the supported bounds");
  return value;
}
function bounded(value, operation) {
  if (value.length > maxPathCodeUnits) throw new RangeError(operation + " result is outside the supported bounds");
  return value;
}
function normalizePath(value) {
  const absolute = value[0] === "/";
  const trailing = value[value.length - 1] === "/";
  const output = [];
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "/") continue;
    const part = stringSlice(value, start, index);
    start = index + 1;
    if (part === "" || part === ".") continue;
    if (part !== "..") {
      output[output.length] = part;
      continue;
    }
    if (output.length > 0 && output[output.length - 1] !== "..") output.length -= 1;
    else if (!absolute) output[output.length] = "..";
  }
  const body = arrayJoin(output, "/");
  let result = absolute ? "/" + body : body;
  if (result === "") result = absolute ? "/" : ".";
  if (trailing && result !== "/") result += "/";
  return result;
}
function dirnamePath(value) {
  const absolute = value[0] === "/";
  let end = -1;
  let matchedSlash = true;
  for (let index = value.length - 1; index >= 1; index -= 1) {
    if (value[index] === "/") {
      if (!matchedSlash) {
        end = index;
        break;
      }
    } else matchedSlash = false;
  }
  if (end === -1) return absolute ? "/" : ".";
  if (absolute && end === 1) return "//";
  return stringSlice(value, 0, end);
}
function basenamePath(value) {
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === "/") {
      if (!matchedSlash) {
        start = index + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
  }
  return end === -1 ? "" : stringSlice(value, start, end);
}
function extensionPath(value) {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index];
    if (character === "/") {
      if (!matchedSlash) {
        startPart = index + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = index + 1;
    }
    if (character === ".") {
      if (startDot === -1) startDot = index;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) preDotState = -1;
  }
  if (startDot === -1 || end === -1 || preDotState === 0
    || (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)) return "";
  return stringSlice(value, startDot, end);
}
function parts(value, operation) {
  if (!pathArrayIsArray(value) || value.length > 256) throw new TypeError(operation + " requires a bounded List<string>");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = pathGetOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError(operation + " path parts must contain enumerable data values");
    output[output.length] = checked(descriptor.value, operation);
  }
  return output;
}
function projectDirectory() {
  const provider = __velarDesktopHostField("projectDirectoryValue");
  if (typeof provider !== "function") throw new TypeError("Desktop project directory provider must be a function data value");
  const value = checked(pathApply(provider, undefined, []), "resolve");
  if (!value.startsWith("/")) throw new TypeError("Desktop project directory must be absolute");
  return value;
}
function resolved(values, operation) {
  let value = projectDirectory();
  const normalizedParts = parts(values, operation);
  for (let index = 0; index < normalizedParts.length; index += 1) {
    const item = normalizedParts[index];
    value = item[0] === "/" ? item : value + "/" + item;
  }
  return normalizePath(value);
}
function pathSegments(value) {
  const output = [];
  let start = value[0] === "/" ? 1 : 0;
  for (let index = start; index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "/") continue;
    if (index > start) output[output.length] = stringSlice(value, start, index);
    start = index + 1;
  }
  return output;
}
function relativeValue(from, to) {
  const left = pathSegments(resolved([checked(from, "relative")], "relative"));
  const right = pathSegments(resolved([checked(to, "relative")], "relative"));
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
  const output = [];
  for (let index = shared; index < left.length; index += 1) output[output.length] = "..";
  for (let index = shared; index < right.length; index += 1) output[output.length] = right[index];
  return arrayJoin(output, "/");
}
export function normalize(path) { return bounded(normalizePath(checked(path, "normalize")), "normalize"); }
export function join(values = []) { return bounded(normalizePath(arrayJoin(parts(values, "join"), "/")), "join"); }
export function resolve(values = []) { return bounded(resolved(values, "resolve"), "resolve"); }
export function relative(from, to) { return bounded(relativeValue(from, to), "relative"); }
export function dirname(path) { return bounded(dirnamePath(checked(path, "dirname")), "dirname"); }
export function basename(path) { return basenamePath(checked(path, "basename")); }
export function extension(path) { return extensionPath(checked(path, "extension")); }
export function isAbsolute(path) { return checked(path, "isAbsolute")[0] === "/"; }
export function contains(root, target) { const value = relativeValue(root, target); return value === "" || (value !== ".." && stringIndexOf(value, "../") !== 0 && value[0] !== "/"); }
export function toFileUrl(path) {
  const segments = pathSegments(resolved([checked(path, "toFileUrl")], "toFileUrl"));
  const encoded = [];
  for (let index = 0; index < segments.length; index += 1) encoded[index] = pathEncodeURIComponent(segments[index]);
  return "file:///" + arrayJoin(encoded, "/");
}
export function fromFileUrl(value) {
  value = checked(value, "fromFileUrl");
  let url;
  try { url = new pathNativeURL(value); } catch { throw new TypeError("fromFileUrl requires a valid file URL"); }
  const pathname = urlValue(url, pathURLPathname);
  const lowercasePathname = stringToLowerCase(pathname);
  const encodedSeparator = stringIndexOf(lowercasePathname, "%2f") !== -1 || stringIndexOf(lowercasePathname, "%5c") !== -1;
  const hostname = urlValue(url, pathURLHostname);
  if (urlValue(url, pathURLProtocol) !== "file:" || urlValue(url, pathURLUsername) !== "" || urlValue(url, pathURLPassword) !== ""
    || urlValue(url, pathURLPort) !== "" || urlValue(url, pathURLSearch) !== "" || urlValue(url, pathURLHash) !== ""
    || hostname !== "" && hostname !== "localhost" || encodedSeparator) throw new TypeError("fromFileUrl requires a local file URL");
  let path;
  try { path = pathDecodeURIComponent(pathname); } catch { throw new TypeError("fromFileUrl requires a valid encoded file URL"); }
  return bounded(normalizePath(path), "fromFileUrl");
}
`.trimStart();

const DESKTOP_FS_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
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
`.trimStart();

const DESKTOP_PROCESS_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${VELAR_PROCESS_HOST_RUNTIME}
const processToken = Symbol("velar.desktop.process");
const maxTextBytes = 16 * 1024 * 1024;
const processOptionFields = new __velarProcessNativeSet(["cwd", "env", "stdin", "timeout", "maxOutputBytes"]);
const processStartFields = new __velarProcessNativeSet(["handle", "pid"]);
const processResultFields = new __velarProcessNativeSet(["code", "signal", "stdout", "stderr"]);
const processOutputFields = new __velarProcessNativeSet(["channel", "text"]);
const processErrorFields = new __velarProcessNativeSet(["name", "message"]);
const processStopFields = new __velarProcessNativeSet(["result", "error"]);
const processWaitFields = new __velarProcessNativeSet(["result", "error", "retained"]);
export const ProcessOutputChannel = __velarRegisterRuntimeType(__velarProcessFreeze({
  stdout: "stdout",
  stderr: "stderr",
  is(value) { return value === "stdout" || value === "stderr"; },
  parse(value) {
    if (!ProcessOutputChannel.is(value)) throw new __velarProcessNativeTypeError("Value does not match ProcessOutputChannel");
    return value;
  },
  // D60 rule 149: values() is the third name charter section 6 reserves on
  // every enum, and it returns a fresh mutable List in declaration order.
  values() { return ["stdout", "stderr"]; },
}));
function boundedText(value, name, maxCodeUnits = 4096) {
  if (typeof value !== "string" || value.length === 0) throw new __velarProcessNativeTypeError(name + " must be non-empty text");
  if (value.length > maxCodeUnits || __velarProcessIncludes(value, "\0")) throw new __velarProcessNativeRangeError(name + " is outside the supported bounds");
  return value;
}
function argumentsOf(value) {
  if (value == null) return [];
  if (!__velarProcessIsArray(value) || value.length > 1000) throw new __velarProcessNativeTypeError("Process args must be a bounded List<string>");
  let units = 0;
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = __velarProcessOwnDescriptor(value, __velarProcessNativeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarProcessNativeTypeError("Process args must contain enumerable data values");
    const item = descriptor.value;
    units += boundedText(item, "Process argument", 1024 * 1024).length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process arguments cannot exceed 1 MiB");
    output[output.length] = item;
  }
  return output;
}
function recordOf(value, name, allowed) {
  return __velarProcessRecord(value, name, allowed);
}
// An executable grant is only as narrow as that executable's own environment
// surface: many granted programs take a command, an interpreter option, or a
// loader path from their environment, so those names are not caller data. The
// identical predicate is duplicated host-side as reservedEnvironmentName in
// packages/desktop/native/node/worker.js; the two must not drift. PATH keeps
// its own longer-standing message. The bare spellings matter as much as the
// prefixed ones: git commit runs EDITOR, git log runs PAGER, and HOME moves the
// whole configuration surface — including the .gitconfig whose own core.editor
// runs a command — into a directory the caller chooses. The host's base
// environment snapshot owns HOME, SHELL and TMPDIR, so those are not caller
// data either.
const processReservedEnvironmentNames = /^(?:PATH|HOME|USERPROFILE|SHELL|TMPDIR|IFS|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|PS4|EDITOR|VISUAL|PAGER|MANPAGER|MANOPT|BROWSER|SSH_ASKPASS|SUDO_ASKPASS|NODE_OPTIONS|NODE_REPL_EXTERNAL_MODULE)$/iu;
const processReservedEnvironmentPrefixes = /^(?:LD_|DYLD_|GIT_|XDG_|PYTHON|PERL|RUBY|LESS)/iu;
const processReservedEnvironmentSuffixes = /(?:_COMMAND|_EDITOR|_PAGER|_OPTS)$/iu;
function __velarProcessReservedEnvironmentName(name) {
  return __velarProcessCall(__velarProcessRegExpTest, processReservedEnvironmentNames, [name])
    || __velarProcessCall(__velarProcessRegExpTest, processReservedEnvironmentPrefixes, [name])
    || __velarProcessCall(__velarProcessRegExpTest, processReservedEnvironmentSuffixes, [name]);
}
function mapEntries(value) {
  if (value == null) return null;
  const snapshot = __velarProcessMapSnapshot(value);
  if (snapshot.size > 1000) throw new __velarProcessNativeRangeError("Process env cannot exceed 1000 entries");
  const output = [];
  let units = 0;
  for (let index = 0; index < snapshot.entries.length; index += 1) {
    const name = snapshot.entries[index][0];
    const item = snapshot.entries[index][1];
    if (!__velarProcessEnvironmentName(name) || name === "PATH" || typeof item !== "string" || __velarProcessIncludes(item, "\0")) {
      throw new __velarProcessNativeTypeError("Desktop process env must contain valid string variables and cannot replace PATH");
    }
    if (__velarProcessReservedEnvironmentName(name)) {
      throw new __velarProcessNativeTypeError("Process env cannot set the transport- or interpreter-controlled variable '" + name + "'");
    }
    units += name.length + item.length;
    if (units > 1024 * 1024) throw new __velarProcessNativeRangeError("Process env cannot exceed 1 MiB");
    output[output.length] = [name, item];
  }
  return output;
}
function optionsOf(value) {
  if (value == null) value = {};
  value = recordOf(value, "Process options", processOptionFields);
  const cwd = value.cwd == null ? null : boundedText(value.cwd, "Process cwd");
  const stdin = value.stdin ?? "";
  if (typeof stdin !== "string" || __velarUtf8ByteLength(stdin) > maxTextBytes) throw new __velarProcessNativeRangeError("Process stdin cannot exceed 16 MiB");
  const timeout = value.timeout ?? 120000;
  if (!__velarProcessIsSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new __velarProcessNativeRangeError("Process timeout must be an integer from 0 through 600000 milliseconds");
  const maxOutputBytes = value.maxOutputBytes ?? 4 * 1024 * 1024;
  if (!__velarProcessIsSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > maxTextBytes) throw new __velarProcessNativeRangeError("Process maxOutputBytes must be an integer from 1 through 16777216");
  return {cwd, env: mapEntries(value.env), stdin, timeout, maxOutputBytes};
}
function startValueOf(value) {
  value = recordOf(value, "Desktop process start result", processStartFields);
  if (!__velarProcessIsSafeInteger(value.handle) || value.handle < 1 || !__velarProcessIsSafeInteger(value.pid) || value.pid < 0) {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid process start result");
  }
  return value;
}
function resultOf(value, maxOutputBytes) {
  value = recordOf(value, "Desktop process result", processResultFields);
  if ((value.code !== null && !__velarProcessIsSafeInteger(value.code))
    || (value.signal !== null && (typeof value.signal !== "string" || value.signal.length === 0 || value.signal.length > 128))
    || typeof value.stdout !== "string" || typeof value.stderr !== "string") {
    throw new __velarProcessNativeTypeError("Desktop host returned an invalid process result");
  }
  if (__velarUtf8ByteLength(value.stdout) + __velarUtf8ByteLength(value.stderr) > maxOutputBytes) {
    throw new __velarProcessNativeRangeError("Desktop process result exceeded maxOutputBytes");
  }
  return __velarProcessFreeze({code: value.code, signal: value.signal, stdout: value.stdout, stderr: value.stderr});
}
function processErrorOf(value) {
  value = recordOf(value, "Desktop process host error", processErrorFields);
  if (typeof value.name !== "string" || value.name !== "Error" && value.name !== "RangeError" && value.name !== "TypeError"
    || typeof value.message !== "string" || value.message.length === 0 || value.message.length > 65536) {
    throw new __velarProcessNativeTypeError("Desktop process host returned an invalid error");
  }
  if (value.name === "RangeError") return new __velarProcessNativeRangeError(value.message);
  if (value.name === "TypeError") return new __velarProcessNativeTypeError(value.message);
  return new __velarProcessNativeError(value.message);
}
function outputOf(value, maxOutputBytes) {
  if (value === null) return null;
  value = recordOf(value, "Desktop process output", processOutputFields);
  if (!ProcessOutputChannel.is(value.channel) || typeof value.text !== "string" || value.text.length === 0) {
    throw new __velarProcessNativeTypeError("Desktop host returned invalid process output");
  }
  const bytes = __velarUtf8ByteLength(value.text);
  if (bytes > maxOutputBytes) throw new __velarProcessNativeRangeError("Desktop process output exceeded maxOutputBytes");
  return __velarProcessFreeze({channel: value.channel, text: value.text, bytes});
}
function stopValueOf(value, maxOutputBytes) {
  value = recordOf(value, "Desktop process stop result", processStopFields);
  const resultDescriptor = __velarProcessOwnDescriptor(value, "result");
  const errorDescriptor = __velarProcessOwnDescriptor(value, "error");
  if (!resultDescriptor || !("value" in resultDescriptor) || !errorDescriptor || !("value" in errorDescriptor)
    || value.result !== null && value.error !== null) {
    throw new __velarProcessNativeTypeError("Desktop process stop result is invalid or contradictory");
  }
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
  };
}
function waitValueOf(value, maxOutputBytes) {
  value = recordOf(value, "Desktop process wait result", processWaitFields);
  const resultDescriptor = __velarProcessOwnDescriptor(value, "result");
  const errorDescriptor = __velarProcessOwnDescriptor(value, "error");
  const retainedDescriptor = __velarProcessOwnDescriptor(value, "retained");
  if (!resultDescriptor || !("value" in resultDescriptor) || !errorDescriptor || !("value" in errorDescriptor)
    || !retainedDescriptor || !("value" in retainedDescriptor) || typeof value.retained !== "boolean"
    || value.result !== null && value.error !== null
    || value.retained && (value.result !== null || value.error === null)
    || !value.retained && value.result === null && value.error === null) {
    throw new __velarProcessNativeTypeError("Desktop process wait result is invalid or contradictory");
  }
  return {
    result: value.result === null ? null : resultOf(value.result, maxOutputBytes),
    error: value.error === null ? null : processErrorOf(value.error),
    retained: value.retained,
  };
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("process", operation, args, timeout);
}
class ProcessHandle {
  constructor(token, handle, pid, maxOutputBytes) {
    if (token !== processToken || !__velarProcessIsSafeInteger(handle) || handle < 1 || !__velarProcessIsSafeInteger(pid) || pid < 0) {
      throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start");
    }
    this.handle = handle;
    this.pid = pid;
    this.maxOutputBytes = maxOutputBytes;
    this.result = null;
    this.stopping = null;
    this.stopRequested = false;
    this.cleanup = null;
    this.reading = false;
    this.waitStarted = false;
    this.outputBytes = 0;
    this.next = async () => {
      if (this.waitStarted) throw new __velarProcessNativeError("Process output must be consumed before wait()");
      if (this.stopRequested) throw new __velarProcessNativeError("Process output is unavailable after stop()");
      if (this.reading) throw new __velarProcessNativeError("Process.next() allows only one active pull");
      this.reading = true;
      try {
        const output = outputOf(await invoke("read", [this.handle], 0), this.maxOutputBytes);
        if (output === null) return null;
        this.outputBytes += output.bytes;
        if (this.outputBytes > this.maxOutputBytes) throw new __velarProcessNativeRangeError("Desktop process output exceeded maxOutputBytes");
        return __velarProcessFreeze({channel: output.channel, text: output.text});
      } finally {
        this.reading = false;
      }
    };
    __velarProcessSeal(this);
  }
  wait() {
    if (this.reading) return __velarProcessReject(new __velarProcessNativeError("Process wait() cannot run while next() is pending"));
    this.waitStarted = true;
    if (!this.result) {
      let result;
      result = __velarProcessThen(invoke("wait", [this.handle], 0), value => {
        let outcome;
        try { outcome = waitValueOf(value, this.maxOutputBytes); }
        catch (error) {
          if (this.result === result) this.result = null;
          throw error;
        }
        if (outcome.retained) {
          if (this.result === result) this.result = null;
          throw outcome.error;
        }
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }, error => {
        if (this.result === result) this.result = null;
        throw error;
      });
      this.result = result;
    }
    return this.result;
  }
  async stop() {
    return await __velarProcessRetryableStop(this, () => __velarProcessThen(invoke("stop", [this.handle], 10000), value => {
        const outcome = stopValueOf(value, this.maxOutputBytes);
        if (outcome.error) this.result = __velarProcessObservedReject(outcome.error);
        else if (outcome.result) this.result = __velarProcessResolve(outcome.result);
        return null;
      }));
  }
}
export const Process = __velarProcessFreeze({
  is(value) { return value instanceof ProcessHandle; },
  parse(value) { if (!(value instanceof ProcessHandle)) throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start"); return value; },
});
export async function start(command, args = [], options = {}) {
  const wire = optionsOf(options);
  const value = startValueOf(await invoke("start", [boundedText(command, "Process command"), argumentsOf(args), wire]));
  return new ProcessHandle(processToken, value.handle, value.pid, wire.maxOutputBytes);
}
export async function run(command, args = [], options = {}) {
  const owner = await start(command, args, options);
  try { return await owner.wait(); }
  catch (error) {
    if (!owner.result) __velarProcessRetainRun(owner);
    throw error;
  }
}
`.trimStart();

const DESKTOP_ENV_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
let cachedSnapshot = null;
function variableName(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) || value.length > 256) {
    throw new TypeError("Environment variable names use ASCII letters, digits, and underscores, starting with a letter or underscore");
  }
  return value;
}
function snapshot() {
  if (cachedSnapshot) return cachedSnapshot;
  const desktopEnvironment = __velarDesktopHostField("environment");
  if (!desktopEnvironment || typeof desktopEnvironment !== "object" || Array.isArray(desktopEnvironment)) {
    throw new Error("VelarScript Desktop environment snapshot is unavailable");
  }
  const value = desktopEnvironment;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop environment snapshot must be a plain record");
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) throw new RangeError("Desktop environment snapshot cannot exceed 64 variables");
  const output = Object.create(null);
  let bytes = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(key)) throw new TypeError("Desktop environment snapshot has an invalid variable name");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop environment snapshot fields must be enumerable data values");
    if (typeof descriptor.value !== "string") throw new TypeError("Desktop environment snapshot values must be text");
    const itemBytes = new TextEncoder().encode(descriptor.value).byteLength;
    bytes += new TextEncoder().encode(key).byteLength + itemBytes;
    if (itemBytes > 64 * 1024 || bytes > 1024 * 1024) throw new RangeError("Desktop environment snapshot exceeds its size boundary");
    output[key] = descriptor.value;
  }
  cachedSnapshot = Object.freeze(output);
  return cachedSnapshot;
}
export function get(name) {
  name = variableName(name);
  const values = snapshot();
  return Object.prototype.hasOwnProperty.call(values, name) ? Object.getOwnPropertyDescriptor(values, name).value : null;
}
export function require(name) {
  name = variableName(name);
  const value = get(name);
  if (value === null) throw new Error("VelarScript environment variable '" + name + "' is required");
  return value;
}
`.trimStart();

const DESKTOP_HTTP_SOURCE = String.raw`
${VELAR_STRICT_JSON_RUNTIME}
${VELAR_TYPE_REGISTRY_RUNTIME}
${VELAR_UTF8_RUNTIME}
${DESKTOP_HOST_ABI_RUNTIME}
const maxResponseChunks = 1000000;
let nextHandle = 1;
const secretHeaderValues = new WeakSet();
function parseJsonText(text) {
  return __velarJsonParse(text, "HTTP JSON text");
}
function runtimeHttpType(Type) { return __velarRequireRuntimeType(Type, "HTTP parsing"); }
function methodOf(value) {
  if (typeof value !== "string") throw new TypeError("HTTP method must be text");
  const method = value.toUpperCase();
  if (method.length === 0 || method.length > 32 || !/^[!#$%&'*+.^_\x60|~0-9A-Z-]+$/u.test(method) || ["CONNECT", "TRACE", "TRACK"].includes(method)) {
    throw new TypeError("HTTP method is invalid or forbidden");
  }
  return method;
}
function urlOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024) throw new TypeError("HTTP URL must be bounded text");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("HTTP URL must use http or https");
  if (url.username || url.password) throw new TypeError("HTTP URL credentials are not allowed; use an Authorization header");
  return url.href;
}
export class HttpAbortError extends Error {
  constructor(reason) {
    if (reason !== "cancelled" && reason !== "timeout") throw new TypeError("HTTP abort reason must be cancelled or timeout");
    super(reason === "timeout" ? "HTTP request timed out" : "HTTP request cancelled");
    this.name = "HttpAbortError"; this.reason = reason;
  }
}
// D60 rule 149: a module-provided enum carries the same runtime face a declared
// enum does -- charter section 6 reserves is, parse, and values on every enum.
export const HttpTransportPhase = __velarRegisterRuntimeType(Object.freeze({
  request: "request",
  response: "response",
  is(value) { return value === "request" || value === "response"; },
  parse(value) {
    if (!HttpTransportPhase.is(value)) throw new TypeError("Value does not match HttpTransportPhase");
    return value;
  },
  values() { return ["request", "response"]; },
}));
export class HttpTransportError extends Error {
  constructor(message, phase) {
    if (typeof message !== "string") throw new TypeError("HTTP transport error message must be text");
    if (message.length === 0 || message.length > 65536) throw new RangeError("HTTP transport error messages must contain at most 64 KiB");
    if (phase !== HttpTransportPhase.request && phase !== HttpTransportPhase.response) {
      throw new TypeError("HTTP transport phase must be request or response");
    }
    super(message); this.name = "HttpTransportError"; this.phase = phase;
  }
}
export class HttpResponseError extends Error {
  constructor(message, status, url, body = null) {
    if (typeof message !== "string") throw new TypeError("HTTP error message must be text");
    if (message.length > 65536) throw new RangeError("HTTP error messages cannot exceed 64 KiB");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    if (typeof url !== "string") throw new TypeError("HTTP error URL must be text");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP error URLs cannot exceed 2 MiB");
    super(message); this.name = "HttpResponseError"; this.status = status; this.url = url; this.body = body;
  }
}
function headersOf(value) {
  if (value == null) return [];
  let size;
  try { size = Reflect.getOwnPropertyDescriptor(Map.prototype, "size").get.call(value); }
  catch { throw new TypeError("HTTP headers must be Map<string, string>"); }
  if (size > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  const output = [];
  let units = 0;
  for (const pair of Map.prototype.entries.call(value)) {
    const name = pair[0]; const item = pair[1];
    if (typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("HTTP headers must use valid string names and single-line values");
    }
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
    output.push([name, item]);
  }
  return output;
}
function checkedHeaders(value) {
  if (value.length > 100) throw new RangeError("HTTP headers cannot exceed 100 fields");
  let units = 0;
  for (const pair of value) {
    units += pair[0].length + pair[1].length;
    if (units > 65536) throw new RangeError("HTTP headers cannot exceed 64 KiB");
  }
  return value;
}
const forbiddenSecretHeaders = new Set(["connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
export function secretHeader(name, environment, prefix = "") {
  if (typeof name !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || forbiddenSecretHeaders.has(name.toLowerCase())) {
    throw new TypeError("HTTP secret header name is invalid or transport-controlled");
  }
  if (typeof environment !== "string" || !/^[A-Z_][A-Z0-9_]{0,127}$/u.test(environment)) {
    throw new TypeError("HTTP secret environment name must be uppercase ASCII text");
  }
  if (typeof prefix !== "string" || prefix.length > 256 || /[\r\n]/u.test(prefix)) {
    throw new TypeError("HTTP secret header prefix must be single-line text of at most 256 characters");
  }
  const value = Object.freeze({name, environment, prefix});
  secretHeaderValues.add(value);
  return value;
}
function secretHeadersOf(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("HTTP secretHeaders must be a List with at most 16 entries");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor) || !secretHeaderValues.has(descriptor.value)) {
      throw new TypeError("HTTP secretHeaders entries must be created by secretHeader");
    }
    output.push(descriptor.value);
  }
  return output;
}
function plainOptions(value) {
  if (value == null) return Object.create(null);
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("HTTP options must be a record");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("HTTP options must be a plain record");
  const allowed = new Set(["headers", "secretHeaders", "body", "timeout", "maxBytes"]);
  const output = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError("HTTP options has an unknown field '" + String(key) + "'");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("HTTP options fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
function optionsOf(value, method) {
  const options = plainOptions(value);
  const timeout = options.timeout ?? 120000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError("HTTP maxBytes must be an integer from 1 through 67108864");
  const headers = headersOf(options.headers);
  const secretHeaders = secretHeadersOf(options.secretHeaders);
  let body = options.body ?? null;
  if ((method === "GET" || method === "HEAD") && body !== null) throw new TypeError(method + " requests cannot have a body");
  if (body !== null && typeof body !== "string") {
    body = __velarJsonStringify(body);
    if (!headers.some(pair => pair[0].toLowerCase() === "content-type")) headers.push(["content-type", "application/json"]);
    checkedHeaders(headers);
  }
  if (typeof body === "string" && __velarUtf8ByteLength(body) > 16 * 1024 * 1024) throw new RangeError("HTTP body cannot exceed 16 MiB");
  return Object.freeze({headers, secretHeaders, body, timeout, maxBytes});
}
function invoke(operation, args, timeout = 30000) {
  return __velarDesktopHostCall("http", operation, args, timeout);
}
function bridgeTransportError(error, phase) {
  if (!error || typeof error !== "object") return null;
  const name = Object.getOwnPropertyDescriptor(error, "name");
  const message = Object.getOwnPropertyDescriptor(error, "message");
  const actualPhase = Object.getOwnPropertyDescriptor(error, "phase");
  if (!name || !("value" in name) || name.value !== "VelarDesktopHttpTransportError"
    || !message || !("value" in message) || typeof message.value !== "string" || message.value.length === 0 || message.value.length > 65536
    || !actualPhase?.enumerable || !("value" in actualPhase) || actualPhase.value !== phase) return null;
  return new HttpTransportError(message.value, phase);
}
function responseOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop bridge returned an invalid HTTP response");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop bridge returned an invalid HTTP response");
  const allowed = new Set(["ok", "status", "statusText", "url", "headers", "body"]);
  const fields = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new TypeError("Desktop bridge returned an unknown HTTP response field");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop bridge HTTP response fields must be enumerable data values");
    fields[key] = descriptor.value;
  }
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(fields, key)) throw new TypeError("Desktop bridge HTTP response is missing field '" + key + "'");
  if (typeof fields.ok !== "boolean" || !Number.isInteger(fields.status) || fields.status < 100 || fields.status > 599
    || fields.ok !== (fields.status >= 200 && fields.status <= 299)) {
    throw new TypeError("Desktop bridge returned invalid HTTP response metadata");
  }
  if (typeof fields.statusText !== "string") throw new TypeError("HTTP response status text must be text");
  if (fields.statusText.length > 65536) throw new RangeError("HTTP response status text cannot exceed 64 KiB");
  if (typeof fields.url !== "string") throw new TypeError("HTTP response URL must be text");
  if (fields.url.length > 2 * 1024 * 1024) throw new RangeError("HTTP response URLs cannot exceed 2 MiB");
  if (typeof fields.body !== "boolean") throw new TypeError("Desktop bridge HTTP response body marker must be boolean");
  if (!Array.isArray(fields.headers) || fields.headers.length > 100) throw new TypeError("Desktop bridge HTTP response headers must be a bounded List");
  const headers = new Map();
  let units = 0;
  for (let index = 0; index < fields.headers.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(fields.headers, String(index));
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Desktop bridge HTTP response headers must be dense data values");
    const pair = descriptor.value;
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError("Desktop bridge HTTP response headers must contain pairs");
    const nameDescriptor = Object.getOwnPropertyDescriptor(pair, "0");
    const valueDescriptor = Object.getOwnPropertyDescriptor(pair, "1");
    const name = nameDescriptor?.value;
    const item = valueDescriptor?.value;
    if (!nameDescriptor?.enumerable || !("value" in nameDescriptor) || !valueDescriptor?.enumerable || !("value" in valueDescriptor)
      || typeof name !== "string" || typeof item !== "string" || !/^[!#$%&'*+.^_|~0-9A-Za-z-]+$/u.test(name) || /[\r\n]/u.test(item)) {
      throw new TypeError("Desktop bridge HTTP response headers are invalid");
    }
    units += name.length + item.length;
    if (units > 65536) throw new RangeError("HTTP response headers cannot exceed 64 KiB");
    headers.set(name, item);
  }
  return Object.freeze({ok: fields.ok, status: fields.status, statusText: fields.statusText, url: fields.url, headers, body: fields.body});
}
function chunkOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.includes("done") || !keys.includes("text")) throw new TypeError("Desktop bridge returned an invalid HTTP chunk");
  const done = Object.getOwnPropertyDescriptor(value, "done");
  const text = Object.getOwnPropertyDescriptor(value, "text");
  if (!done?.enumerable || !("value" in done) || !text?.enumerable || !("value" in text)
    || typeof done.value !== "boolean" || typeof text.value !== "string") {
    throw new TypeError("Desktop bridge HTTP chunks must contain boolean done and text data values");
  }
  return {done: done.value, text: text.value};
}
class DesktopResponse {
  constructor(response, request) {
    this.status = response.status; this.statusText = response.statusText; this.url = response.url;
    this.headers = response.headers; this.body = response.body; this.request = request; this.cachedText = null; this.textPending = null; this.consuming = false;
    if (!this.body) request.finish();
    Object.seal(this);
  }
  async consume(consumer) {
    if (this.cachedText !== null) {
      const result = await consumer(this.cachedText);
      if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
      return null;
    }
    if (this.consuming) throw new Error("HTTP response body is already being consumed");
    this.consuming = true;
    let chunks = 0;
    try {
      if (!this.body) return null;
      while (true) {
        let wire;
        try { wire = await invoke("read", [this.request.handle], 0); }
        catch (error) {
          if (this.request.abortError) throw this.request.abortError;
          throw bridgeTransportError(error, HttpTransportPhase.response) ?? error;
        }
        const chunk = chunkOf(wire);
        if (!chunk.done) {
          chunks += 1;
          if (chunks > maxResponseChunks) throw new RangeError("HTTP responses cannot exceed 1000000 chunks");
        }
        if (chunk.text) {
          const result = await consumer(chunk.text);
          if (result !== null) throw new TypeError("HTTP stream consumer must resolve to null");
        }
        if (chunk.done) break;
        if (this.request.abortError) throw this.request.abortError;
      }
      if (this.request.abortError) throw this.request.abortError;
      return null;
    } catch (error) {
      if (this.request.abortError) throw this.request.abortError;
      void invoke("cancel", [this.request.handle], 10000).catch(() => {});
      throw error;
    } finally {
      this.request.finish();
    }
  }
  async streamText(consumer) { if (typeof consumer !== "function") throw new TypeError("HTTP streamText requires an async consumer"); return this.consume(consumer); }
  async text() {
    if (this.cachedText !== null) return this.cachedText;
    if (this.textPending !== null) return this.textPending;
    const pending = (async () => {
      const chunks = [];
      await this.consume(async chunk => { chunks.push(chunk); return null; });
      return chunks.join("");
    })();
    this.textPending = pending;
    try {
      this.cachedText = await pending;
      return this.cachedText;
    } finally {
      if (this.textPending === pending) this.textPending = null;
    }
  }
  async json() { return parseJsonText(await this.text()); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
}
class DesktopRequest {
  constructor(method, url, options) {
    this.method = methodOf(method); this.url = urlOf(url); this.options = optionsOf(options, this.method); this.handle = nextHandle++; this.pending = null; this.timer = null; this.abortError = null; this.finished = false;
  }
  finish() { if (this.finished) return; this.finished = true; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  abort(reason) {
    if (this.finished || this.abortError) return;
    this.abortError = new HttpAbortError(reason);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    void invoke("cancel", [this.handle], 10000).catch(() => {});
  }
  async response() {
    if (this.pending) return this.pending;
    if (this.abortError) throw this.abortError;
    const timeout = this.options.timeout ?? 120000;
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 600000) throw new RangeError("HTTP timeout must be an integer from 0 through 600000 milliseconds");
    if (timeout) this.timer = setTimeout(() => this.abort("timeout"), timeout);
    this.pending = (async () => {
      try {
        let value;
        try { value = await invoke("request", [this.handle, this.method, this.url, this.options], timeout === 0 ? 0 : Math.min(600000, timeout + 1000)); }
        catch (error) {
          if (this.abortError) throw this.abortError;
          throw bridgeTransportError(error, HttpTransportPhase.request) ?? error;
        }
        if (this.abortError) throw this.abortError;
        const snapshot = responseOf(value);
        const response = new DesktopResponse(snapshot, this);
        // D90 R20: the 2xx question is asked here and nowhere else. The
        // transport snapshot still carries ok; the response an author holds
        // does not, because by the time it is returned the answer is always
        // yes.
        if (!snapshot.ok) {
          const text = await response.text();
          let body = text;
          try { body = text ? parseJsonText(text) : null; } catch {}
          const errorUrl = response.url || this.url;
          throw new HttpResponseError("HTTP " + response.status + " for " + errorUrl, response.status, errorUrl, body);
        }
        return response;
      } catch (error) {
        if (!this.abortError && !this.finished) void invoke("cancel", [this.handle], 10000).catch(() => {});
        this.finish();
        if (this.abortError) throw this.abortError;
        throw error;
      }
    })();
    return this.pending;
  }
  async text() { return (await this.response()).text(); }
  async json() { return (await this.response()).json(); }
  async streamText(consumer) { return (await this.response()).streamText(consumer); }
  async parse(Type) { Type = runtimeHttpType(Type); return Type.parse(await this.json()); }
  cancel() { this.abort("cancelled"); return null; }
}
const create = method => (url, options = {}) => new DesktopRequest(method, url, options);
export const http = Object.freeze({
  request(method, url, options = {}) { return new DesktopRequest(method, url, options); },
  get: create("GET"), post: create("POST"), put: create("PUT"), patch: create("PATCH"), delete: create("DELETE"), head: create("HEAD"),
});
`.trimStart();

const desktopModuleInterfaces = new Map(webCompilerExtension.modules!.interfaces);
desktopModuleInterfaces.set("velar/desktop", desktopModuleInterface);
desktopModuleInterfaces.set("velar/desktop-test", desktopTestModuleInterface);
desktopModuleInterfaces.set("velar/window", windowModuleInterface);
desktopModuleInterfaces.set("velar/fs", nodeModuleInterfaces.get("velar/fs")!);
desktopModuleInterfaces.set("velar/path", nodeModuleInterfaces.get("velar/path")!);
desktopModuleInterfaces.set("velar/process", desktopProcessInterface);
desktopModuleInterfaces.set("velar/http", nodeModuleInterfaces.get("velar/http")!);
desktopModuleInterfaces.set("velar/env", nodeModuleInterfaces.get("velar/env")!);
const desktopModuleSources = new Map(webCompilerExtension.modules!.sources);
const desktopModuleDependencies = new Map(webCompilerExtension.modules!.dependencies);
desktopModuleSources.set("velar/desktop", DESKTOP_MODULE_SOURCE);
desktopModuleSources.set("velar/desktop-test", DESKTOP_TEST_SOURCE);
// The fallback source outside a resolved project knows only the kind every
// manifest declares; `source()` below closes the module over the project's own
// `desktop.windows` whenever the project config is at hand.
desktopModuleSources.set("velar/window", desktopWindowSource([DESKTOP_MAIN_WINDOW_KIND]));
desktopModuleSources.set("velar/fs", DESKTOP_FS_SOURCE);
desktopModuleSources.set("velar/path", DESKTOP_PATH_SOURCE);
desktopModuleSources.set("velar/process", DESKTOP_PROCESS_SOURCE);
desktopModuleSources.set("velar/http", DESKTOP_HTTP_SOURCE);
desktopModuleSources.set("velar/env", DESKTOP_ENV_SOURCE);

export const velarCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/desktop",
  contract: Object.freeze({
    protocolVersion: 1,
    apiVersion: VELAR_DESKTOP_API_VERSION,
    kind: "application",
    extends: Object.freeze({}),
    composes: Object.freeze({
      "@velarscript/web": webCompilerExtension.contract!.apiVersion,
      "@velarscript/node": VELAR_NODE_API_VERSION,
    }),
  }),
  capabilities: Object.freeze(["web", "desktop"]),
  // Desktop is an application composition: Web owns surface syntax,
  // reactivity, DOM lowering, and browser runtime; Desktop owns only its
  // capability modules and host bridge. Keep each layer explicit so adding a
  // future application target cannot inherit hidden Web behavior via spread.
  lexical: webCompilerExtension.lexical!,
  parser: webCompilerExtension.parser!,
  syntax: webCompilerExtension.syntax!,
  analyzer: webCompilerExtension.analyzer!,
  semantic: webCompilerExtension.semantic!,
  inspection: webCompilerExtension.inspection!,
  analysis: webCompilerExtension.analysis!,
  editor: webCompilerExtension.editor!,
  formatting: webCompilerExtension.formatting!,
  createEmitter: webCompilerExtension.createEmitter!,
  modules: Object.freeze({
    apiVersion: VELAR_DESKTOP_API_VERSION,
    interfaces: desktopModuleInterfaces,
    sources: desktopModuleSources,
    dependencies: desktopModuleDependencies,
    source(specifier: string, projectConfig: unknown) {
      if (specifier === "velar/window") {
        const windows = (projectConfig as VelarDesktopConfig | undefined)?.windows;
        return desktopWindowSource(windows ? Object.keys(windows) : [DESKTOP_MAIN_WINDOW_KIND]);
      }
      if (specifier === "velar/desktop") return DESKTOP_MODULE_SOURCE;
      if (specifier === "velar/desktop-test") return DESKTOP_TEST_SOURCE;
      if (specifier === "velar/fs") return DESKTOP_FS_SOURCE;
      if (specifier === "velar/path") return DESKTOP_PATH_SOURCE;
      if (specifier === "velar/process") return DESKTOP_PROCESS_SOURCE;
      if (specifier === "velar/http") return DESKTOP_HTTP_SOURCE;
      const config = projectConfig as VelarDesktopConfig;
      return webModuleSource(specifier, { base: "/", publicConfig: { desktop: { identifier: config.identifier } } });
    },
  }),
});

export { velarProjectExtension, type VelarDesktopConfig } from "./config.ts";
