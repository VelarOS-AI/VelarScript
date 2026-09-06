const __velarOptionsNativeArray = globalThis.Array;
const __velarOptionsNativeObject = globalThis.Object;
const __velarOptionsNativeSet = globalThis.Set;
const __velarOptionsReflectApply = Object.getOwnPropertyDescriptor(Reflect, "apply")?.value;
const __velarOptionsArrayIsArray = Object.getOwnPropertyDescriptor(Array, "isArray")?.value;
const __velarOptionsGetPrototypeOf = Object.getOwnPropertyDescriptor(Object, "getPrototypeOf")?.value;
const __velarOptionsGetOwnPropertySymbols = Object.getOwnPropertyDescriptor(Object, "getOwnPropertySymbols")?.value;
const __velarOptionsGetOwnPropertyNames = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyNames")?.value;
const __velarOptionsGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")?.value;
const __velarOptionsCreate = Object.getOwnPropertyDescriptor(Object, "create")?.value;
const __velarOptionsFreeze = Object.getOwnPropertyDescriptor(Object, "freeze")?.value;
const __velarOptionsSetHas = Object.getOwnPropertyDescriptor(Set.prototype, "has")?.value;
const __velarOptionsSetAdd = Object.getOwnPropertyDescriptor(Set.prototype, "add")?.value;
const __velarOptionsObjectPrototype = Object.prototype;
function __velarRequireOptionsIntrinsics() {
  if (typeof __velarOptionsNativeArray !== "function" || typeof __velarOptionsNativeObject !== "function"
    || typeof __velarOptionsNativeSet !== "function" || typeof __velarOptionsReflectApply !== "function"
    || typeof __velarOptionsArrayIsArray !== "function" || typeof __velarOptionsGetPrototypeOf !== "function"
    || typeof __velarOptionsGetOwnPropertySymbols !== "function" || typeof __velarOptionsGetOwnPropertyNames !== "function"
    || typeof __velarOptionsGetOwnPropertyDescriptor !== "function" || typeof __velarOptionsCreate !== "function"
    || typeof __velarOptionsFreeze !== "function" || typeof __velarOptionsSetHas !== "function"
    || typeof __velarOptionsSetAdd !== "function") {
    throw new TypeError("The Web options guard intrinsics are unavailable");
  }
}
function __velarOptionFields(fields) {
  __velarRequireOptionsIntrinsics();
  if (!__velarOptionsReflectApply(__velarOptionsArrayIsArray, __velarOptionsNativeArray, [fields])) {
    throw new TypeError("Web option fields must be an internal List");
  }
  const allowed = new __velarOptionsNativeSet();
  for (let index = 0; index < fields.length; index += 1) {
    if (typeof fields[index] !== "string") throw new TypeError("Web option fields must be text");
    __velarOptionsReflectApply(__velarOptionsSetAdd, allowed, [fields[index]]);
  }
  return allowed;
}
function __velarFreezeOptionsValue(value) {
  __velarRequireOptionsIntrinsics();
  return __velarOptionsReflectApply(__velarOptionsFreeze, __velarOptionsNativeObject, [value]);
}
function __velarOptions(value, name, allowed) {
  return __velarOptionsRecord(value, name, allowed, false);
}
// A live props store publishes every prop as a tracked getter, so the rule that
// a field holds a data value cannot hold for it -- and the read through that
// getter is exactly what subscribes the reader to the prop. Every other part of
// the strict record rule still does: a plain record, no symbol fields, and no
// field outside the declared set.
function __velarLiveOptions(value, name, allowed) {
  return __velarOptionsRecord(value, name, allowed, true);
}
function __velarOptionsRecord(value, name, allowed, live) {
  __velarRequireOptionsIntrinsics();
  let prototype = null;
  if (value && typeof value === "object") {
    prototype = __velarOptionsReflectApply(__velarOptionsGetPrototypeOf, __velarOptionsNativeObject, [value]);
  }
  if (!value || typeof value !== "object"
    || __velarOptionsReflectApply(__velarOptionsArrayIsArray, __velarOptionsNativeArray, [value])
    || (prototype !== __velarOptionsObjectPrototype && prototype !== null)) {
    throw new TypeError(name + " must be a record");
  }
  if (__velarOptionsReflectApply(__velarOptionsGetOwnPropertySymbols, __velarOptionsNativeObject, [value]).length > 0) {
    throw new TypeError(name + " cannot contain symbol fields");
  }
  const output = __velarOptionsReflectApply(__velarOptionsCreate, __velarOptionsNativeObject, [null]);
  const keys = __velarOptionsReflectApply(__velarOptionsGetOwnPropertyNames, __velarOptionsNativeObject, [value]);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!__velarOptionsReflectApply(__velarOptionsSetHas, allowed, [key])) throw new TypeError("Unknown " + name + " field '" + key + "'");
    const descriptor = __velarOptionsReflectApply(__velarOptionsGetOwnPropertyDescriptor, __velarOptionsNativeObject, [value, key]);
    if (!descriptor?.enumerable || (!live && !("value" in descriptor))) {
      throw new TypeError(name + " field '" + key + "' must be an enumerable " + (live ? "field" : "data value"));
    }
    output[key] = "value" in descriptor ? descriptor.value : value[key];
  }
  return __velarFreezeOptionsValue(output);
}
function __velarString(value, name) { if (typeof value !== "string") throw new TypeError(name + " must be a string"); return value; }
function __velarBool(value, name) { if (typeof value !== "boolean") throw new TypeError(name + " must be bool"); return value; }
