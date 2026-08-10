// Canonical host-intrinsic boundary shared by the Node and Desktop targets of
// velar/process. It is compiler-extension infrastructure, not a public Velar
// module: target runtimes inline it before accepting application or bridge
// values so later JavaScript prototype replacement cannot change validation.
export const VELAR_PROCESS_HOST_RUNTIME = String.raw`
const __velarProcessNativeArray = globalThis.Array;
const __velarProcessNativeError = globalThis.Error;
const __velarProcessNativeMap = globalThis.Map;
const __velarProcessNativeNumber = globalThis.Number;
const __velarProcessNativeObject = globalThis.Object;
const __velarProcessNativePromise = globalThis.Promise;
const __velarProcessNativeRangeError = globalThis.RangeError;
const __velarProcessNativeReflect = globalThis.Reflect;
const __velarProcessNativeSet = globalThis.Set;
const __velarProcessNativeString = globalThis.String;
const __velarProcessNativeTypeError = globalThis.TypeError;
const __velarProcessOwnDescriptor = __velarProcessNativeObject.getOwnPropertyDescriptor;
const __velarProcessApply = __velarProcessNativeReflect.apply;
function __velarProcessDataOperation(target, name) {
  const descriptor = __velarProcessOwnDescriptor(target, name);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new __velarProcessNativeError("VelarScript process host operation '" + name + "' is unavailable");
  }
  return descriptor.value;
}
const __velarProcessArrayIsArray = __velarProcessDataOperation(__velarProcessNativeArray, "isArray");
const __velarProcessArrayShift = __velarProcessDataOperation(__velarProcessNativeArray.prototype, "shift");
const __velarProcessNumberIsSafeInteger = __velarProcessDataOperation(__velarProcessNativeNumber, "isSafeInteger");
const __velarProcessObjectCreate = __velarProcessDataOperation(__velarProcessNativeObject, "create");
const __velarProcessObjectFreeze = __velarProcessDataOperation(__velarProcessNativeObject, "freeze");
const __velarProcessObjectGetPrototypeOf = __velarProcessDataOperation(__velarProcessNativeObject, "getPrototypeOf");
const __velarProcessObjectSeal = __velarProcessDataOperation(__velarProcessNativeObject, "seal");
const __velarProcessOwnKeys = __velarProcessDataOperation(__velarProcessNativeReflect, "ownKeys");
const __velarProcessPromiseReject = __velarProcessDataOperation(__velarProcessNativePromise, "reject");
const __velarProcessPromiseResolve = __velarProcessDataOperation(__velarProcessNativePromise, "resolve");
const __velarProcessPromiseThen = __velarProcessDataOperation(__velarProcessNativePromise.prototype, "then");
const __velarProcessSetHas = __velarProcessDataOperation(__velarProcessNativeSet.prototype, "has");
const __velarProcessStringIncludes = __velarProcessDataOperation(__velarProcessNativeString.prototype, "includes");
const __velarProcessMapEntries = __velarProcessDataOperation(__velarProcessNativeMap.prototype, "entries");
const __velarProcessMapSize = __velarProcessOwnDescriptor(__velarProcessNativeMap.prototype, "size")?.get;
const __velarProcessMapIterator = __velarProcessApply(__velarProcessMapEntries, new __velarProcessNativeMap(), []);
const __velarProcessMapIteratorNext = __velarProcessDataOperation(__velarProcessObjectGetPrototypeOf(__velarProcessMapIterator), "next");
const __velarProcessEnvironmentPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const __velarProcessRegExpTest = __velarProcessDataOperation(globalThis.RegExp.prototype, "test");
const __velarProcessSetTimeout = globalThis.setTimeout;
const __velarProcessClearTimeout = globalThis.clearTimeout;
function __velarProcessCall(operation, receiver, arguments_) {
  return __velarProcessApply(operation, receiver, arguments_);
}
function __velarProcessIsArray(value) {
  return __velarProcessCall(__velarProcessArrayIsArray, __velarProcessNativeArray, [value]);
}
function __velarProcessIsSafeInteger(value) {
  return __velarProcessCall(__velarProcessNumberIsSafeInteger, __velarProcessNativeNumber, [value]);
}
function __velarProcessIncludes(value, search) {
  return __velarProcessCall(__velarProcessStringIncludes, value, [search]);
}
function __velarProcessFreeze(value) {
  return __velarProcessCall(__velarProcessObjectFreeze, __velarProcessNativeObject, [value]);
}
function __velarProcessSeal(value) {
  return __velarProcessCall(__velarProcessObjectSeal, __velarProcessNativeObject, [value]);
}
function __velarProcessCreate(prototype) {
  return __velarProcessCall(__velarProcessObjectCreate, __velarProcessNativeObject, [prototype]);
}
function __velarProcessGetPrototypeOf(value) {
  return __velarProcessCall(__velarProcessObjectGetPrototypeOf, __velarProcessNativeObject, [value]);
}
function __velarProcessKeys(value) {
  return __velarProcessCall(__velarProcessOwnKeys, __velarProcessNativeReflect, [value]);
}
function __velarProcessSetContains(value, item) {
  return __velarProcessCall(__velarProcessSetHas, value, [item]);
}
function __velarProcessShift(value) {
  return __velarProcessCall(__velarProcessArrayShift, value, []);
}
function __velarProcessReject(error) {
  return __velarProcessCall(__velarProcessPromiseReject, __velarProcessNativePromise, [error]);
}
function __velarProcessResolve(value) {
  return __velarProcessCall(__velarProcessPromiseResolve, __velarProcessNativePromise, [value]);
}
function __velarProcessThen(value, fulfilled, rejected) {
  return __velarProcessCall(__velarProcessPromiseThen, value, [fulfilled, rejected]);
}
function __velarProcessEnvironmentName(value) {
  return typeof value === "string" && __velarProcessCall(__velarProcessRegExpTest, __velarProcessEnvironmentPattern, [value]);
}
function __velarProcessMapSnapshot(value) {
  if (typeof __velarProcessMapSize !== "function") throw new __velarProcessNativeTypeError("Process env must be Map<string, string>");
  let size;
  let iterator;
  try {
    size = __velarProcessCall(__velarProcessMapSize, value, []);
    iterator = __velarProcessCall(__velarProcessMapEntries, value, []);
  } catch {
    throw new __velarProcessNativeTypeError("Process env must be Map<string, string>");
  }
  const entries = [];
  while (true) {
    let step;
    try { step = __velarProcessCall(__velarProcessMapIteratorNext, iterator, []); }
    catch { throw new __velarProcessNativeTypeError("Process env must be Map<string, string>"); }
    const done = __velarProcessOwnDescriptor(step, "done");
    if (!done || !("value" in done) || typeof done.value !== "boolean") throw new __velarProcessNativeTypeError("Process env must be Map<string, string>");
    if (done.value) return {size, entries};
    const item = __velarProcessOwnDescriptor(step, "value");
    if (!item || !("value" in item) || !__velarProcessIsArray(item.value) || item.value.length !== 2) throw new __velarProcessNativeTypeError("Process env must be Map<string, string>");
    const name = __velarProcessOwnDescriptor(item.value, "0");
    const valueDescriptor = __velarProcessOwnDescriptor(item.value, "1");
    if (!name || !("value" in name) || !valueDescriptor || !("value" in valueDescriptor)) throw new __velarProcessNativeTypeError("Process env must be Map<string, string>");
    entries[entries.length] = [name.value, valueDescriptor.value];
  }
}
function __velarProcessRecord(value, name, allowed) {
  if (!value || typeof value !== "object" || __velarProcessIsArray(value)) throw new __velarProcessNativeTypeError(name + " must be a record");
  const prototype = __velarProcessGetPrototypeOf(value);
  if (prototype !== __velarProcessNativeObject.prototype && prototype !== null) throw new __velarProcessNativeTypeError(name + " must be a plain record");
  const output = __velarProcessCreate(null);
  const keys = __velarProcessKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw new __velarProcessNativeTypeError(name + " fields must use string names");
    if (!__velarProcessSetContains(allowed, key)) throw new __velarProcessNativeTypeError(name + " has unknown field '" + key + "'");
    const descriptor = __velarProcessOwnDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new __velarProcessNativeTypeError(name + " fields must be enumerable data values");
    output[key] = descriptor.value;
  }
  return output;
}
`.trim();
