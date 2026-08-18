// Canonical application-facing filesystem boundary. Validation, UTF-8 and
// immutable Velar values stay in this Realm; all Node fs effects run through
// the private isolated velar/node-host-v1 runtime dependency.
export const VELAR_NODE_FILESYSTEM_RUNTIME = String.raw`
import { __velarNodeHostInvoke } from "velar/node-host-v1";
import { Bytes as __velarFsBytesType } from "velar/binary";

const __velarFsNativeArray = globalThis.Array;
const __velarFsNativeError = globalThis.Error;
const __velarFsNativeNumber = globalThis.Number;
const __velarFsNativeObject = globalThis.Object;
const __velarFsNativeRangeError = globalThis.RangeError;
const __velarFsNativeReflect = globalThis.Reflect;
const __velarFsNativeString = globalThis.String;
const __velarFsNativeTextDecoder = globalThis.TextDecoder;
const __velarFsNativeTextEncoder = globalThis.TextEncoder;
const __velarFsNativeTypeError = globalThis.TypeError;
const __velarFsNativeUint8Array = globalThis.Uint8Array;
const __velarFsOwnDescriptor = __velarFsNativeObject.getOwnPropertyDescriptor;
const __velarFsApply = __velarFsNativeReflect.apply;
function __velarFsDataOperation(target, name) {
  const descriptor = __velarFsOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarFsNativeError("VelarScript filesystem host operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarFsArraySort = __velarFsDataOperation(__velarFsNativeArray.prototype, "sort");
const __velarFsArrayIsArray = __velarFsDataOperation(__velarFsNativeArray, "isArray");
const __velarFsNumberIsFinite = __velarFsDataOperation(__velarFsNativeNumber, "isFinite");
const __velarFsNumberIsSafeInteger = __velarFsDataOperation(__velarFsNativeNumber, "isSafeInteger");
const __velarFsObjectCreate = __velarFsDataOperation(__velarFsNativeObject, "create");
const __velarFsObjectDefineProperty = __velarFsDataOperation(__velarFsNativeObject, "defineProperty");
const __velarFsObjectFreeze = __velarFsDataOperation(__velarFsNativeObject, "freeze");
const __velarFsObjectGetPrototypeOf = __velarFsDataOperation(__velarFsNativeObject, "getPrototypeOf");
const __velarFsObjectKeys = __velarFsDataOperation(__velarFsNativeObject, "keys");
const __velarFsStringIncludes = __velarFsDataOperation(__velarFsNativeString.prototype, "includes");
const __velarFsTextDecoderDecode = __velarFsDataOperation(__velarFsNativeTextDecoder.prototype, "decode");
const __velarFsTextEncoderEncode = __velarFsDataOperation(__velarFsNativeTextEncoder.prototype, "encode");
const __velarFsTypedArrayPrototype = __velarFsApply(__velarFsObjectGetPrototypeOf, __velarFsNativeObject, [__velarFsNativeUint8Array.prototype]);
const __velarFsTypedArrayByteLength = __velarFsOwnDescriptor(__velarFsTypedArrayPrototype, "byteLength")?.get;
if (typeof __velarFsTypedArrayByteLength !== "function") throw new __velarFsNativeError("VelarScript filesystem byte length operation is unavailable");
const __velarFsDecoder = new __velarFsNativeTextDecoder("utf-8", {fatal: true});
const __velarFsEncoder = new __velarFsNativeTextEncoder();
const __velarFsMaxPathCodeUnits = 4096;
const __velarFsMaxFileBytes = 16 * 1024 * 1024;
const __velarFsMaxListItems = 100000;
const __velarFsMaxListCodeUnits = 2 * 1024 * 1024;
const __velarFsWatcherToken = Symbol("velar.fs.watcher");
const __velarFsMaxWatchPaths = 4096;

function __velarFsCall(operation, receiver, arguments_) {
  return __velarFsApply(operation, receiver, arguments_);
}

function __velarFsPath(value, operation) {
  if (typeof value !== "string" || value.length === 0) throw new __velarFsNativeTypeError(operation + " requires a non-empty path string");
  if (value.length > __velarFsMaxPathCodeUnits || __velarFsCall(__velarFsStringIncludes, value, ["\0"])) {
    throw new __velarFsNativeRangeError(operation + " path is outside the supported bounds");
  }
  return value;
}

function __velarFsByteLimit(value, operation) {
  if (!__velarFsCall(__velarFsNumberIsSafeInteger, __velarFsNativeNumber, [value]) || value < 1 || value > __velarFsMaxFileBytes) {
    throw new __velarFsNativeRangeError(operation + " maxBytes must be an integer from 1 through 16777216");
  }
  return value;
}

function __velarFsByteLength(value) {
  return __velarFsCall(__velarFsTypedArrayByteLength, value, []);
}

function __velarFsEncode(value) {
  return __velarFsCall(__velarFsTextEncoderEncode, __velarFsEncoder, [value]);
}

function __velarFsBytes(value, operation) {
  const prototype = value && typeof value === "object"
    ? __velarFsCall(__velarFsObjectGetPrototypeOf, __velarFsNativeObject, [value])
    : null;
  if (prototype !== __velarFsNativeUint8Array.prototype) throw new __velarFsNativeTypeError(operation + " host returned invalid bytes");
  if (__velarFsByteLength(value) > __velarFsMaxFileBytes) throw new __velarFsNativeRangeError(operation + " host returned oversized bytes");
  return value;
}

function __velarFsNull(value, operation) {
  if (value !== null) throw new __velarFsNativeTypeError(operation + " host returned an invalid completion");
  return null;
}

function __velarFsInfo(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || __velarFsCall(__velarFsObjectGetPrototypeOf, __velarFsNativeObject, [value]) !== __velarFsNativeObject.prototype) {
    throw new __velarFsNativeTypeError("info host returned an invalid result");
  }
  const output = __velarFsCall(__velarFsObjectCreate, __velarFsNativeObject, [null]);
  const fields = ["name", "kind", "size", "modifiedAt"];
  for (let index = 0; index < fields.length; index += 1) {
    const name = fields[index];
    const descriptor = __velarFsOwnDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarFsNativeTypeError("info host returned an invalid result");
    output[name] = descriptor.value;
  }
  if (typeof output.name !== "string" || output.name.length > __velarFsMaxPathCodeUnits
    || output.kind !== "file" && output.kind !== "directory" && output.kind !== "symlink" && output.kind !== "other"
    || typeof output.size !== "number" || !__velarFsCall(__velarFsNumberIsFinite, __velarFsNativeNumber, [output.size]) || output.size < 0
    || typeof output.modifiedAt !== "number" || !__velarFsCall(__velarFsNumberIsFinite, __velarFsNativeNumber, [output.modifiedAt])) {
    throw new __velarFsNativeTypeError("info host returned an invalid result");
  }
  return __velarFsCall(__velarFsObjectFreeze, __velarFsNativeObject, [output]);
}

function __velarFsWatchBatch(value) {
  if (!value || typeof value !== "object" || __velarFsCall(__velarFsObjectGetPrototypeOf, __velarFsNativeObject, [value]) !== __velarFsNativeObject.prototype
    || __velarFsCall(__velarFsObjectKeys, __velarFsNativeObject, [value]).length !== 2) {
    throw new __velarFsNativeTypeError("FileWatcher.next host returned an invalid batch");
  }
  const pathsDescriptor = __velarFsOwnDescriptor(value, "paths");
  const rescanDescriptor = __velarFsOwnDescriptor(value, "rescan");
  if (!pathsDescriptor?.enumerable || !("value" in pathsDescriptor) || !rescanDescriptor?.enumerable || !("value" in rescanDescriptor)
    || typeof rescanDescriptor.value !== "boolean"
    || !__velarFsCall(__velarFsArrayIsArray, __velarFsNativeArray, [pathsDescriptor.value])
    || pathsDescriptor.value.length > __velarFsMaxWatchPaths
    || rescanDescriptor.value && pathsDescriptor.value.length !== 0) {
    throw new __velarFsNativeTypeError("FileWatcher.next host returned an invalid batch");
  }
  const paths = [];
  let units = 0;
  let previous = null;
  for (let index = 0; index < pathsDescriptor.value.length; index += 1) {
    const descriptor = __velarFsOwnDescriptor(pathsDescriptor.value, __velarFsNativeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string"
      || descriptor.value.length === 0 || descriptor.value.length > __velarFsMaxPathCodeUnits
      || __velarFsCall(__velarFsStringIncludes, descriptor.value, ["\0"])
      || previous !== null && descriptor.value <= previous) {
      throw new __velarFsNativeTypeError("FileWatcher.next host returned invalid paths");
    }
    units += descriptor.value.length;
    if (units > __velarFsMaxListCodeUnits) throw new __velarFsNativeRangeError("FileWatcher.next paths cannot exceed 2 MiB of text");
    paths[index] = descriptor.value;
    previous = descriptor.value;
  }
  return __velarFsCall(__velarFsObjectFreeze, __velarFsNativeObject, [{
    paths,
    rescan: rescanDescriptor.value,
  }]);
}

class FileWatcherHandle {
  constructor(token, handle) {
    if (token !== __velarFsWatcherToken || !__velarFsCall(__velarFsNumberIsSafeInteger, __velarFsNativeNumber, [handle]) || handle < 1) {
      throw new __velarFsNativeTypeError("FileWatcher values are created only by velar/fs.watchFiles");
    }
    this.handle = handle;
    this.closed = false;
    this.pending = false;
    this.next = async () => {
      if (this.closed) return null;
      if (this.pending) throw new __velarFsNativeError("FileWatcher.next already has an active pull");
      this.pending = true;
      try {
        const value = await __velarNodeHostInvoke("fs.watchNext", [this.handle]);
        if (value === null) {
          this.closed = true;
          return null;
        }
        return __velarFsWatchBatch(value);
      } catch (error) {
        this.closed = true;
        try { await __velarNodeHostInvoke("fs.watchClose", [this.handle]); } catch {}
        throw error;
      } finally {
        this.pending = false;
      }
    };
  }
  async close() {
    if (this.closed) return null;
    this.closed = true;
    const value = await __velarNodeHostInvoke("fs.watchClose", [this.handle]);
    if (typeof value !== "boolean") throw new __velarFsNativeTypeError("FileWatcher.close host returned an invalid result");
    return null;
  }
}

export const FileWatcher = __velarFsCall(__velarFsObjectFreeze, __velarFsNativeObject, [{
  is(value) { return value instanceof FileWatcherHandle; },
  parse(value) {
    if (!(value instanceof FileWatcherHandle)) throw new __velarFsNativeTypeError("Value does not match FileWatcher");
    return value;
  },
}]);

export const FileWatchBatch = __velarFsCall(__velarFsObjectFreeze, __velarFsNativeObject, [{
  is(value) { try { __velarFsWatchBatch(value); return true; } catch { return false; } },
  parse(value) { return __velarFsWatchBatch(value); },
}]);

export async function readText(path, maxBytes = __velarFsMaxFileBytes) {
  path = __velarFsPath(path, "readText");
  maxBytes = __velarFsByteLimit(maxBytes, "readText");
  const data = __velarFsBytes(await __velarNodeHostInvoke("fs.readFile", [path, maxBytes, "readText"]), "readText");
  if (__velarFsByteLength(data) > maxBytes) throw new __velarFsNativeRangeError("readText file exceeds maxBytes");
  try { return __velarFsCall(__velarFsTextDecoderDecode, __velarFsDecoder, [data]); }
  catch { throw new __velarFsNativeTypeError("readText requires valid UTF-8 text"); }
}

export async function readBytes(path, maxBytes = __velarFsMaxFileBytes) {
  path = __velarFsPath(path, "readBytes");
  maxBytes = __velarFsByteLimit(maxBytes, "readBytes");
  const data = __velarFsBytes(await __velarNodeHostInvoke("fs.readFile", [path, maxBytes, "readBytes"]), "readBytes");
  if (__velarFsByteLength(data) > maxBytes) throw new __velarFsNativeRangeError("readBytes file exceeds maxBytes");
  return __velarFsBytesType.parse(data);
}

export async function createText(path, text) {
  path = __velarFsPath(path, "createText");
  if (typeof text !== "string") throw new __velarFsNativeTypeError("createText requires text");
  if (__velarUtf8ByteLength(text) > __velarFsMaxFileBytes) throw new __velarFsNativeRangeError("createText cannot write more than 16 MiB");
  return __velarFsNull(await __velarNodeHostInvoke("fs.createFile", [path, __velarFsEncode(text)]), "createText");
}

export async function createBytes(path, bytes) {
  path = __velarFsPath(path, "createBytes");
  bytes = __velarFsBytesType.parse(bytes);
  if (__velarFsByteLength(bytes) > __velarFsMaxFileBytes) throw new __velarFsNativeRangeError("createBytes cannot write more than 16 MiB");
  return __velarFsNull(await __velarNodeHostInvoke("fs.createFile", [path, bytes, "createBytes"]), "createBytes");
}

export async function replaceTextIfMatches(path, expected, replacement) {
  path = __velarFsPath(path, "replaceTextIfMatches");
  if (typeof expected !== "string" || typeof replacement !== "string") throw new __velarFsNativeTypeError("replaceTextIfMatches requires expected and replacement text");
  if (__velarUtf8ByteLength(expected) > __velarFsMaxFileBytes || __velarUtf8ByteLength(replacement) > __velarFsMaxFileBytes) {
    throw new __velarFsNativeRangeError("replaceTextIfMatches text cannot exceed 16 MiB");
  }
  const value = await __velarNodeHostInvoke("fs.replaceFileIfMatches", [path, __velarFsEncode(expected), __velarFsEncode(replacement)]);
  if (typeof value !== "boolean") throw new __velarFsNativeTypeError("replaceTextIfMatches host returned an invalid result");
  return value;
}

export async function writeText(path, text) {
  path = __velarFsPath(path, "writeText");
  if (typeof text !== "string") throw new __velarFsNativeTypeError("writeText requires text");
  if (__velarUtf8ByteLength(text) > __velarFsMaxFileBytes) throw new __velarFsNativeRangeError("writeText cannot write more than 16 MiB");
  return __velarFsNull(await __velarNodeHostInvoke("fs.writeFile", [path, __velarFsEncode(text)]), "writeText");
}

export async function writeBytes(path, bytes) {
  path = __velarFsPath(path, "writeBytes");
  bytes = __velarFsBytesType.parse(bytes);
  if (__velarFsByteLength(bytes) > __velarFsMaxFileBytes) throw new __velarFsNativeRangeError("writeBytes cannot write more than 16 MiB");
  return __velarFsNull(await __velarNodeHostInvoke("fs.writeFile", [path, bytes, "writeBytes"]), "writeBytes");
}

export async function appendText(path, text) {
  path = __velarFsPath(path, "appendText");
  if (typeof text !== "string") throw new __velarFsNativeTypeError("appendText requires text");
  if (__velarUtf8ByteLength(text) > __velarFsMaxFileBytes) throw new __velarFsNativeRangeError("appendText cannot append more than 16 MiB at once");
  return __velarFsNull(await __velarNodeHostInvoke("fs.appendFile", [path, __velarFsEncode(text)]), "appendText");
}

export async function exists(path) {
  const value = await __velarNodeHostInvoke("fs.exists", [__velarFsPath(path, "exists")]);
  if (typeof value !== "boolean") throw new __velarFsNativeTypeError("exists host returned an invalid result");
  return value;
}

export async function list(path, maxItems = __velarFsMaxListItems) {
  path = __velarFsPath(path, "list");
  if (!__velarFsCall(__velarFsNumberIsSafeInteger, __velarFsNativeNumber, [maxItems]) || maxItems < 1 || maxItems > __velarFsMaxListItems) {
    throw new __velarFsNativeRangeError("list maxItems must be an integer from 1 through 100000");
  }
  const names = await __velarNodeHostInvoke("fs.list", [path, maxItems]);
  if (!__velarFsCall(__velarFsArrayIsArray, __velarFsNativeArray, [names]) || names.length > maxItems) throw new __velarFsNativeTypeError("list host returned an invalid result");
  const output = [];
  let units = 0;
  for (let index = 0; index < names.length; index += 1) {
    const descriptor = __velarFsOwnDescriptor(names, __velarFsNativeString(index));
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new __velarFsNativeTypeError("list host result must contain text names");
    }
    units += descriptor.value.length;
    if (units > __velarFsMaxListCodeUnits) throw new __velarFsNativeRangeError("list result cannot exceed 2 MiB of text");
    output[index] = descriptor.value;
  }
  return __velarFsCall(__velarFsArraySort, output, []);
}

export async function info(path) {
  return __velarFsInfo(await __velarNodeHostInvoke("fs.info", [__velarFsPath(path, "info")]));
}

export async function canonical(path) {
  const value = await __velarNodeHostInvoke("fs.canonical", [__velarFsPath(path, "canonical")]);
  return __velarFsPath(value, "canonical");
}

export async function makeDirectory(path) {
  return __velarFsNull(await __velarNodeHostInvoke("fs.makeDirectory", [__velarFsPath(path, "makeDirectory")]), "makeDirectory");
}

export async function copyFile(source, target, replace = false) {
  source = __velarFsPath(source, "copyFile");
  target = __velarFsPath(target, "copyFile");
  if (typeof replace !== "boolean") throw new __velarFsNativeTypeError("copyFile replace must be bool");
  return __velarFsNull(await __velarNodeHostInvoke("fs.copyFile", [source, target, replace]), "copyFile");
}

export async function move(source, target, replace = false) {
  source = __velarFsPath(source, "move");
  target = __velarFsPath(target, "move");
  if (typeof replace !== "boolean") throw new __velarFsNativeTypeError("move replace must be bool");
  return __velarFsNull(await __velarNodeHostInvoke("fs.move", [source, target, replace]), "move");
}

export async function removeFile(path) {
  return __velarFsNull(await __velarNodeHostInvoke("fs.removeFile", [__velarFsPath(path, "removeFile")]), "removeFile");
}

export async function watchFiles(path, recursive = false) {
  path = __velarFsPath(path, "watchFiles");
  if (typeof recursive !== "boolean") throw new __velarFsNativeTypeError("watchFiles recursive must be bool");
  const handle = await __velarNodeHostInvoke("fs.watchStart", [path, recursive]);
  return new FileWatcherHandle(__velarFsWatcherToken, handle);
}
`.trimStart();
