import type { CompilerExtension, ModuleInterface, ValueType } from "@velarscript/compiler";
import { VELAR_STRICT_JSON_RUNTIME, VELAR_TYPE_REGISTRY_RUNTIME, VELAR_UTF8_RUNTIME } from "@velarscript/compiler/extension";
import { velarCompilerExtension as webCompilerExtension, webModuleSource } from "@velarscript/web/compiler";
import { nodeModuleInterfaces, VELAR_NODE_API_VERSION, VELAR_PROCESS_HOST_RUNTIME } from "@velarscript/node/compiler";
import { VELAR_DESKTOP_API_VERSION, velarProjectExtension, type VelarDesktopConfig } from "./config.ts";

const stringType: ValueType = { kind: "string" };
const boolType: ValueType = { kind: "bool" };

function functionType(parameters: readonly ValueType[], result: ValueType): ValueType {
  return { kind: "function", parameters, requiredParameters: parameters.length, result };
}

function moduleInterface(exports: ReadonlyMap<string, ValueType>): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes: new Map(),
    namedTypeIdentities: new Map(),
    typeAliases: new Map(),
    enums: new Map(),
    classes: new Map(),
    testFunctions: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

const DESKTOP_HOST_ABI_RUNTIME = String.raw`
const __velarDesktopBridgeKey = Symbol.for("velar.desktop.bridge.v1");
const __velarDesktopGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const __velarDesktopReflectApply = Reflect.apply;
const __velarDesktopBridgeDescriptor = __velarDesktopGetOwnPropertyDescriptor(globalThis, __velarDesktopBridgeKey);
if (!__velarDesktopBridgeDescriptor || !("value" in __velarDesktopBridgeDescriptor)
  || !__velarDesktopBridgeDescriptor.value || typeof __velarDesktopBridgeDescriptor.value !== "object") {
  throw new Error("VelarScript Desktop bridge is unavailable");
}
const __velarDesktopBridge = __velarDesktopBridgeDescriptor.value;
const __velarDesktopInvokeDescriptor = __velarDesktopGetOwnPropertyDescriptor(__velarDesktopBridge, "invoke");
if (!__velarDesktopInvokeDescriptor || !("value" in __velarDesktopInvokeDescriptor) || typeof __velarDesktopInvokeDescriptor.value !== "function") {
  throw new TypeError("Desktop bridge invoke must be a function data value");
}
const __velarDesktopInvoke = __velarDesktopInvokeDescriptor.value;
function __velarDesktopHostField(name) {
  const descriptor = __velarDesktopGetOwnPropertyDescriptor(__velarDesktopBridge, name);
  if (!descriptor || !("value" in descriptor)) throw new TypeError("Desktop bridge field '" + name + "' must be a data value");
  return descriptor.value;
}
function __velarDesktopHostCall(capability, operation, args, timeout = 30000) {
  return __velarDesktopReflectApply(__velarDesktopInvoke, __velarDesktopBridge, [capability, operation, args, timeout]);
}
`.trim();

const desktopModuleInterface = moduleInterface(new Map([
  ["platform", functionType([], stringType)],
  ["packaged", functionType([], boolType)],
  ["homeDirectory", functionType([], { kind: "promise", value: stringType })],
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["projectDirectory", functionType([], { kind: "promise", value: stringType })],
]));

const desktopTestModuleInterface = moduleInterface(new Map([
  ["appDataDirectory", functionType([], { kind: "promise", value: stringType })],
  ["readText", functionType([stringType, { kind: "number" }], { kind: "promise", value: stringType })],
]));

const nodeProcessInterface = nodeModuleInterfaces.get("velar/process")!;
const desktopProcessInterface: ModuleInterface = nodeProcessInterface;

const DESKTOP_MODULE_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const desktopPlatform = __velarDesktopHostField("platform");
const desktopPackaged = __velarDesktopHostField("packaged");
export function platform() {
  const value = desktopPlatform;
  if (typeof value !== "string" || value.length === 0) throw new TypeError("Desktop host returned an invalid platform");
  return value;
}
export function packaged() {
  const value = desktopPackaged;
  if (typeof value !== "boolean") throw new TypeError("Desktop host returned an invalid packaged marker");
  return value;
}
async function path(operation) {
  const value = await __velarDesktopHostCall("desktop", operation, []);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop host returned an invalid absolute path");
  return value;
}
export async function homeDirectory() { return path("homeDirectory"); }
export async function appDataDirectory() { return path("appDataDirectory"); }
export async function projectDirectory() { return path("projectDirectory"); }
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
export async function appDataDirectory() {
  const value = await invoke("desktop", "appDataDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute app-data path");
  return value;
}
export async function readText(path, maxBytes) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test readText requires a bounded path");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new RangeError("Desktop test readText maxBytes is outside its supported bounds");
  const value = await invoke("fs", "readText", [path, maxBytes], 30000);
  if (typeof value !== "string") throw new TypeError("Desktop test host returned invalid file text");
  return value;
}
`.trimStart();

const DESKTOP_PATH_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const maxPathCodeUnits = 4096;
const pathApply = Reflect.apply;
const pathArrayIsArray = Array.isArray;
const pathArrayJoin = Array.prototype.join;
const pathGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const pathStringIndexOf = String.prototype.indexOf;
const pathStringSlice = String.prototype.slice;
const desktopProjectDirectory = __velarDesktopHostField("projectDirectory");
function stringIndexOf(value, search) { return pathApply(pathStringIndexOf, value, [search]); }
function stringSlice(value, start, end) { return pathApply(pathStringSlice, value, end === undefined ? [start] : [start, end]); }
function arrayJoin(value, separator) { return pathApply(pathArrayJoin, value, [separator]); }
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
  const value = checked(desktopProjectDirectory, "resolve");
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
`.trimStart();

const DESKTOP_FS_SOURCE = String.raw`
${DESKTOP_HOST_ABI_RUNTIME}
const blobToken = Symbol("velar.desktop.fs.blob");
const maxPathCodeUnits = 4096;
const maxFileBytes = 16 * 1024 * 1024;
const maxListItems = 100000;
const maxListTextUnits = 2 * 1024 * 1024;
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
function invoke(operation, args) {
  return __velarDesktopHostCall("fs", operation, args);
}
async function mutate(operation, args) {
  const value = await invoke(operation, args);
  if (value !== null) throw new TypeError("Desktop host returned an invalid " + operation + " result");
}
export class Blob {
  constructor(token, base64) {
    if (token !== blobToken || typeof base64 !== "string") throw new TypeError("Blob values are created only by velar/fs.readBlob");
    Object.defineProperty(this, "base64", {value: base64, enumerable: false, configurable: false, writable: false});
    Object.freeze(this);
  }
}
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
export async function readBlob(path, maxBytes = maxFileBytes) {
  maxBytes = byteLimit(maxBytes, "readBlob");
  const value = recordOf(await invoke("readBlob", [pathOf(path, "readBlob"), maxBytes]), "Desktop Blob", new Set(["base64"]));
  if (typeof value.base64 !== "string" || value.base64.length > Math.ceil(maxBytes / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.base64)) {
    throw new TypeError("Desktop host returned an invalid Blob");
  }
  let bytes;
  try { bytes = atob(value.base64).length; }
  catch { throw new TypeError("Desktop host returned an invalid Blob"); }
  if (bytes > maxBytes) throw new RangeError("Desktop Blob exceeds maxBytes");
  return new Blob(blobToken, value.base64);
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
const desktopEnvironment = __velarDesktopHostField("environment");
let cachedSnapshot = null;
function variableName(value) {
  if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) || value.length > 256) {
    throw new TypeError("Environment variable names use ASCII letters, digits, and underscores, starting with a letter or underscore");
  }
  return value;
}
function snapshot() {
  if (cachedSnapshot) return cachedSnapshot;
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
export const HttpTransportPhase = Object.freeze({request: "request", response: "response"});
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
export class HttpError extends Error {
  constructor(message, status, url, body = null) {
    if (typeof message !== "string") throw new TypeError("HTTP error message must be text");
    if (message.length > 65536) throw new RangeError("HTTP error messages cannot exceed 64 KiB");
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new RangeError("HTTP error status must be an integer from 100 through 599");
    if (typeof url !== "string") throw new TypeError("HTTP error URL must be text");
    if (url.length > 2 * 1024 * 1024) throw new RangeError("HTTP error URLs cannot exceed 2 MiB");
    super(message); this.name = "HttpError"; this.status = status; this.url = url; this.body = body;
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
  constructor(value, request) {
    const response = responseOf(value);
    this.ok = response.ok; this.status = response.status; this.statusText = response.statusText; this.url = response.url;
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
        const response = new DesktopResponse(value, this);
        if (!response.ok) {
          const text = await response.text();
          let body = text;
          try { body = text ? parseJsonText(text) : null; } catch {}
          const errorUrl = response.url || this.url;
          throw new HttpError("HTTP " + response.status + " for " + errorUrl, response.status, errorUrl, body);
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
desktopModuleInterfaces.set("velar/fs", nodeModuleInterfaces.get("velar/fs")!);
desktopModuleInterfaces.set("velar/path", nodeModuleInterfaces.get("velar/path")!);
desktopModuleInterfaces.set("velar/process", desktopProcessInterface);
desktopModuleInterfaces.set("velar/http", nodeModuleInterfaces.get("velar/http")!);
desktopModuleInterfaces.set("velar/env", nodeModuleInterfaces.get("velar/env")!);
const desktopModuleSources = new Map(webCompilerExtension.modules!.sources);
const desktopModuleDependencies = new Map(webCompilerExtension.modules!.dependencies);
desktopModuleSources.set("velar/desktop", DESKTOP_MODULE_SOURCE);
desktopModuleSources.set("velar/desktop-test", DESKTOP_TEST_SOURCE);
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
