const __velarBrowserMissingField = Object.freeze({});
const __velarBrowserReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarBrowserGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarBrowserGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarBrowserHasInstance = Object.getOwnPropertyDescriptor(Function.prototype, Symbol.hasInstance)?.value;
function __velarBrowserDescriptor(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof __velarBrowserGetOwnPropertyDescriptor !== "function" || typeof __velarBrowserGetPrototypeOf !== "function") return null;
  let current = value;
  while (current !== null) {
    const descriptor = __velarBrowserReflectApply(__velarBrowserGetOwnPropertyDescriptor, Object, [current, name]);
    if (descriptor) return descriptor;
    current = __velarBrowserReflectApply(__velarBrowserGetPrototypeOf, Object, [current]);
  }
  return null;
}
function __velarBrowserOwnDataField(value, name) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null
    || typeof __velarBrowserGetOwnPropertyDescriptor !== "function") return __velarBrowserMissingField;
  const descriptor = __velarBrowserReflectApply(__velarBrowserGetOwnPropertyDescriptor, Object, [value, name]);
  return descriptor?.enumerable && "value" in descriptor ? descriptor.value : __velarBrowserMissingField;
}
function __velarBrowserDataMethod(value, name) {
  const descriptor = __velarBrowserDescriptor(value, name);
  return descriptor && "value" in descriptor && typeof descriptor.value === "function"
    ? descriptor.value
    : __velarBrowserMissingField;
}
function __velarBrowserGlobalMember(name, kind) {
  const descriptor = __velarBrowserDescriptor(globalThis, name);
  if (!descriptor) return null;
  const member = kind === "get" ? descriptor.get : "value" in descriptor ? descriptor.value : null;
  return typeof member === "function" ? member : null;
}
function __velarBrowserGlobalField(name) {
  const descriptor = __velarBrowserDescriptor(globalThis, name);
  if (!descriptor) return __velarBrowserMissingField;
  if ("value" in descriptor) return descriptor.value;
  if (typeof descriptor.get !== "function" || typeof __velarBrowserReflectApply !== "function") return __velarBrowserMissingField;
  try { return __velarBrowserReflectApply(descriptor.get, globalThis, []); }
  catch { return __velarBrowserMissingField; }
}
function __velarBrowserConstructor(name) {
  const value = __velarBrowserGlobalField(name);
  return typeof value === "function" ? value : null;
}
function __velarBrowserPrototypeMember(constructor, name, kind) {
  if (typeof constructor !== "function" || typeof __velarBrowserGetOwnPropertyDescriptor !== "function") return null;
  const descriptor = __velarBrowserReflectApply(__velarBrowserGetOwnPropertyDescriptor, Object, [constructor, "prototype"]);
  const member = descriptor && "value" in descriptor ? __velarBrowserDescriptor(descriptor.value, name) : null;
  if (!member) return null;
  const operation = kind === "get" ? member.get : "value" in member ? member.value : null;
  return typeof operation === "function" ? operation : null;
}
function __velarBrowserHostMember(value, constructor, name, kind) {
  const descriptor = __velarBrowserDescriptor(value, name);
  if (descriptor) {
    const operation = kind === "get" ? descriptor.get : "value" in descriptor ? descriptor.value : null;
    if (typeof operation === "function") return operation;
  }
  return __velarBrowserPrototypeMember(constructor, name, kind);
}
function __velarBrowserNativeInstance(value, constructor) {
  if (typeof constructor !== "function" || typeof __velarBrowserHasInstance !== "function"
    || typeof __velarBrowserReflectApply !== "function") return false;
  try { return __velarBrowserReflectApply(__velarBrowserHasInstance, constructor, [value]) === true; }
  catch { return false; }
}
function __velarBrowserField(value, name, nativeGetter, constructor) {
  if (typeof nativeGetter === "function" && __velarBrowserNativeInstance(value, constructor)) {
    return __velarBrowserReflectApply(nativeGetter, value, []);
  }
  return __velarBrowserOwnDataField(value, name);
}
function __velarBrowserCallCaptured(operation, receiver, arguments_, name) {
  if (typeof operation !== "function" || typeof __velarBrowserReflectApply !== "function") {
    throw new TypeError("The browser does not expose native " + name);
  }
  return __velarBrowserReflectApply(operation, receiver, arguments_);
}
function __velarBrowserCall(value, name, nativeMethod, constructor, arguments_ = []) {
  if (typeof nativeMethod === "function" && __velarBrowserNativeInstance(value, constructor)) {
    return __velarBrowserReflectApply(nativeMethod, value, arguments_);
  }
  const method = __velarBrowserOwnDataField(value, name);
  if (typeof method !== "function") throw new TypeError("The browser returned an invalid " + name + " host operation");
  return __velarBrowserCallCaptured(method, value, arguments_, name);
}
