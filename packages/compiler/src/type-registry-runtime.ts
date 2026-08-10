import { VELAR_TYPE_REGISTRY_KEY } from "./runtime-abi.ts";

/**
 * Canonical generated runtime for compiler-known Type identities. Core and
 * extensions embed this source into separate modules, then converge through
 * one immutable global WeakSet descriptor.
 */
export const VELAR_TYPE_REGISTRY_RUNTIME = String.raw`
const __velarTypeNativeWeakSet = globalThis.WeakSet;
const __velarTypeNativeObject = globalThis.Object;
const __velarTypeNativeTypeError = globalThis.TypeError;
const __velarTypeGetOwnPropertyDescriptor = __velarTypeNativeObject.getOwnPropertyDescriptor;
const __velarTypeDefineProperty = __velarTypeNativeObject.defineProperty;
const __velarTypeReflectApply = __velarTypeGetOwnPropertyDescriptor(globalThis.Reflect, "apply")?.value;
const __velarTypeSymbolFor = globalThis.Symbol.for;
const __velarTypeWeakSetPrototype = __velarTypeGetOwnPropertyDescriptor(__velarTypeNativeWeakSet, "prototype")?.value;
const __velarTypeWeakSetHas = __velarTypeGetOwnPropertyDescriptor(__velarTypeWeakSetPrototype, "has")?.value;
const __velarTypeWeakSetAdd = __velarTypeGetOwnPropertyDescriptor(__velarTypeWeakSetPrototype, "add")?.value;
function __velarTypeCall(operation, receiver, arguments_) { if (typeof operation !== "function" || typeof __velarTypeReflectApply !== "function") throw new __velarTypeNativeTypeError("The JavaScript runtime Type registry API is unavailable"); return __velarTypeReflectApply(operation, receiver, arguments_); }
const __velarRuntimeTypeRegistryKey = __velarTypeCall(__velarTypeSymbolFor, globalThis.Symbol, [${JSON.stringify(VELAR_TYPE_REGISTRY_KEY)}]);
const __velarRuntimeTypeRegistry = (() => {
  const descriptor = __velarTypeGetOwnPropertyDescriptor(globalThis, __velarRuntimeTypeRegistryKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
      throw new __velarTypeNativeTypeError("VelarScript runtime type registry descriptor is invalid");
    }
    try { __velarTypeCall(__velarTypeWeakSetHas, descriptor.value, [descriptor.value]); }
    catch { throw new __velarTypeNativeTypeError("VelarScript runtime type registry is invalid"); }
    return descriptor.value;
  }
  const registry = new __velarTypeNativeWeakSet();
  __velarTypeCall(__velarTypeDefineProperty, __velarTypeNativeObject, [globalThis, __velarRuntimeTypeRegistryKey, {
    value: registry,
    enumerable: false,
    configurable: false,
    writable: false,
  }]);
  return registry;
})();
function __velarRegisterRuntimeType(value) {
  __velarTypeCall(__velarTypeWeakSetAdd, __velarRuntimeTypeRegistry, [value]);
  return value;
}
function __velarRequireRuntimeType(value, name, optional = false) {
  if (optional && value == null) return null;
  if (!value || typeof value !== "object" || !__velarTypeCall(__velarTypeWeakSetHas, __velarRuntimeTypeRegistry, [value])) {
    throw new __velarTypeNativeTypeError(name + " requires a compiler-known VelarScript runtime type");
  }
  return value;
}
`.trimStart();
