import { VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY } from "./runtime-abi.ts";

/** Compiler-owned Promise normalization and async-result host ABI. */
export const VELAR_PROMISE_NORMALIZATION_RUNTIME = String.raw`
const __velarNormalizeGlobal = globalThis;
const __velarNormalizeNativeObject = globalThis.Object;
const __velarNormalizeNativeReflect = globalThis.Reflect;
const __velarNormalizeNativeWeakMap = globalThis.WeakMap;
const __velarNormalizeNativePromise = globalThis.Promise;
const __velarNormalizeNativeSymbol = globalThis.Symbol;
const __velarNormalizeTypeError = globalThis.TypeError;
const __velarNormalizeGetOwnPropertyDescriptor = __velarNormalizeNativeObject.getOwnPropertyDescriptor;
const __velarNormalizeGetPrototypeOf = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeNativeObject, "getPrototypeOf")?.value;
const __velarNormalizeDefineProperty = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeNativeObject, "defineProperty")?.value;
const __velarNormalizeApply = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeNativeReflect, "apply")?.value;
const __velarNormalizeWeakMapPrototype = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeNativeWeakMap, "prototype")?.value;
const __velarNormalizeWeakMapHas = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeWeakMapPrototype, "has")?.value;
const __velarNormalizeWeakMapGet = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeWeakMapPrototype, "get")?.value;
const __velarNormalizeWeakMapSet = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeWeakMapPrototype, "set")?.value;
const __velarNormalizePromisePrototype = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeNativePromise, "prototype")?.value;
const __velarNormalizePromiseThen = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizePromisePrototype, "then")?.value;
const __velarNormalizeSymbolFor = __velarNormalizeGetOwnPropertyDescriptor(__velarNormalizeNativeSymbol, "for")?.value;
function __velarNormalizeCall(operation, receiver, arguments_) {
  if (typeof operation !== "function" || typeof __velarNormalizeApply !== "function") throw new __velarNormalizeTypeError("The JavaScript Promise normalization runtime is unavailable");
  return __velarNormalizeApply(operation, receiver, arguments_);
}
const __velarNormalizedPromiseRegistryKey = __velarNormalizeCall(__velarNormalizeSymbolFor, __velarNormalizeNativeSymbol, [${JSON.stringify(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY)}]);
const __velarNormalizedPromiseValues = (() => {
  const descriptor = __velarNormalizeCall(__velarNormalizeGetOwnPropertyDescriptor, __velarNormalizeNativeObject, [__velarNormalizeGlobal, __velarNormalizedPromiseRegistryKey]);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
      throw new __velarNormalizeTypeError("VelarScript Promise normalization registry ownership is invalid");
    }
    try { __velarNormalizeCall(__velarNormalizeWeakMapHas, descriptor.value, [descriptor.value]); }
    catch { throw new __velarNormalizeTypeError("VelarScript Promise normalization registry is invalid"); }
    return descriptor.value;
  }
  const registry = new __velarNormalizeNativeWeakMap();
  __velarNormalizeCall(__velarNormalizeDefineProperty, __velarNormalizeNativeObject, [__velarNormalizeGlobal, __velarNormalizedPromiseRegistryKey, {
    value: registry,
    enumerable: false,
    configurable: false,
    writable: false,
  }]);
  return registry;
})();
function __velarNormalizePromiseValue(value) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) throw new __velarNormalizeTypeError("Expected an actual Promise");
  const known = __velarNormalizeCall(__velarNormalizeWeakMapGet, __velarNormalizedPromiseValues, [value]);
  if (known) return known;
  let normalized;
  try { normalized = __velarNormalizeCall(__velarNormalizePromiseThen, value, [(resolved) => resolved ?? null]); }
  catch { throw new __velarNormalizeTypeError("Expected an actual Promise"); }
  __velarNormalizeCall(__velarNormalizeWeakMapSet, __velarNormalizedPromiseValues, [value, normalized]);
  __velarNormalizeCall(__velarNormalizeWeakMapSet, __velarNormalizedPromiseValues, [normalized, normalized]);
  return normalized;
}
function __velarAsyncResolvedValue(value) {
  if (value === undefined) return null;
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  try { return __velarNormalizePromiseValue(value); } catch {}
  let owner = value;
  for (let depth = 0; owner !== null && depth < 128; depth += 1) {
    let descriptor;
    try { descriptor = __velarNormalizeCall(__velarNormalizeGetOwnPropertyDescriptor, __velarNormalizeNativeObject, [owner, "then"]); }
    catch { throw new __velarNormalizeTypeError("An async result must not expose a callable 'then' or a 'then' getter"); }
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value === "function") throw new __velarNormalizeTypeError("An async result must not expose a callable 'then' or a 'then' getter");
      return value;
    }
    try { owner = __velarNormalizeCall(__velarNormalizeGetPrototypeOf, __velarNormalizeNativeObject, [owner]); }
    catch { throw new __velarNormalizeTypeError("An async result must have an inspectable prototype chain"); }
  }
  if (owner !== null) throw new __velarNormalizeTypeError("An async result prototype chain is too deep");
  return value;
}
`.trimStart();

export const VELAR_PROMISE_NORMALIZATION_MODULE = "velar/compiler-runtime-promises-v1";

/** Project-shared implementation of compiler-lowered Promise boundaries. */
export const VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE = String.raw`
${VELAR_PROMISE_NORMALIZATION_RUNTIME}
export {
  __velarNormalizePromiseValue as normalizePromiseValue,
  __velarAsyncResolvedValue as asyncResolvedValue,
};
`.trimStart();
