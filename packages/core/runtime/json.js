function runtimeType(Type) { return __velarRequireRuntimeType(Type, "JSON validation", true); }
export function parse(text, Type = null) { if (typeof text !== "string") throw new __velarJsonNativeTypeError("json.parse requires a string"); Type = runtimeType(Type); const value = __velarJsonParse(text); return Type ? Type.parse(value) : value; }
export function tryParse(text, Type = null, fallback = null) { Type = runtimeType(Type); try { return parse(text, Type); } catch { return fallback; } }
export function stringify(value, pretty = false) { return __velarJsonStringify(value, pretty); }
function sorted(value) {
  if (value === null || typeof value !== "object") return value;
  if (__velarJsonApply(__velarJsonArrayIsArray, __velarJsonNativeArray, [value], "Array.isArray")) {
    const output = new __velarJsonNativeArray(value.length);
    for (let index = 0; index < value.length; index += 1) output[index] = sorted(__velarJsonGetOwnPropertyDescriptor(value, index).value);
    return output;
  }
  const result = __velarJsonApply(__velarJsonCreate, __velarJsonNativeObject, [null], "Object.create");
  const keys = __velarJsonGetOwnPropertyNames(value);
  __velarJsonApply(__velarJsonArraySort, keys, [], "Array.sort");
  for (let index = 0; index < keys.length; index += 1) { const key = keys[index]; __velarJsonApply(__velarJsonDefineProperty, __velarJsonNativeObject, [result, key, { value: sorted(__velarJsonGetOwnPropertyDescriptor(value, key).value), enumerable: true, configurable: true, writable: true }], "Object.defineProperty"); }
  return result;
}
export function stableStringify(value, pretty = false) { return __velarJsonStringify(sorted(__velarJsonSnapshot(value).value), pretty); }
export function clone(value, Type = null) { Type = runtimeType(Type); const cloned = __velarJsonClone(value); return Type ? Type.parse(cloned) : cloned; }
export function isSerializable(value) { try { __velarAssertJson(value); return true; } catch { return false; } }
