const __velarReactiveBridgeGlobal = globalThis;
const __velarReactiveBridgeNativeObject = globalThis.Object;
const __velarReactiveBridgeNativeSymbol = globalThis.Symbol;
const __velarReactiveBridgeNativeTypeError = globalThis.TypeError;
const __velarReactiveBridgeGetOwnPropertyDescriptor = __velarReactiveBridgeNativeObject.getOwnPropertyDescriptor;
const __velarReactiveBridgeGetPrototypeOf = __velarReactiveBridgeGetOwnPropertyDescriptor(__velarReactiveBridgeNativeObject, "getPrototypeOf")?.value;
const __velarReactiveBridgeIsExtensible = __velarReactiveBridgeGetOwnPropertyDescriptor(__velarReactiveBridgeNativeObject, "isExtensible")?.value;
const __velarReactiveBridgeOwnSymbols = __velarReactiveBridgeGetOwnPropertyDescriptor(__velarReactiveBridgeNativeObject, "getOwnPropertySymbols")?.value;
const __velarReactiveBridgeSymbolFor = __velarReactiveBridgeGetOwnPropertyDescriptor(__velarReactiveBridgeNativeSymbol, "for")?.value;
if (typeof __velarReactiveBridgeGetOwnPropertyDescriptor !== "function" || typeof __velarReactiveBridgeGetPrototypeOf !== "function"
  || typeof __velarReactiveBridgeIsExtensible !== "function" || typeof __velarReactiveBridgeOwnSymbols !== "function"
  || typeof __velarReactiveBridgeSymbolFor !== "function") throw new __velarReactiveBridgeNativeTypeError("The JavaScript reactive bridge runtime is unavailable");
const __velarReactiveRuntimeKey = __velarReactiveBridgeSymbolFor("velar.runtime.v1");
const __velarReactiveIterateKey = __velarReactiveBridgeSymbolFor("velar.reactive.iterate.v1");
const __velarReactiveStructureKey = __velarReactiveBridgeSymbolFor("velar.reactive.structure.v1");
let __velarReactiveBridge = null;
function __velarReactiveBridgeField(runtime, name) {
  const descriptor = __velarReactiveBridgeGetOwnPropertyDescriptor(runtime, name);
  if (!descriptor || !("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive runtime field '" + name + "' is invalid");
  }
  return descriptor.value;
}
function __velarResolveReactiveBridge() {
  if (__velarReactiveBridge) return __velarReactiveBridge;
  const descriptor = __velarReactiveBridgeGetOwnPropertyDescriptor(__velarReactiveBridgeGlobal, __velarReactiveRuntimeKey);
  if (!descriptor) return null;
  if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable) {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive runtime registry ownership is invalid");
  }
  const runtime = descriptor.value;
  if (!runtime || typeof runtime !== "object"
    || __velarReactiveBridgeGetPrototypeOf(runtime) !== null
    || __velarReactiveBridgeIsExtensible(runtime)
    || __velarReactiveBridgeOwnSymbols(runtime).length > 0) {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive runtime ownership is invalid");
  }
  const version = __velarReactiveBridgeField(runtime, "version");
  const toRaw = __velarReactiveBridgeField(runtime, "toRaw");
  if (version !== "0.12") {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive runtime schema " + (typeof version === "string" ? version : "(unknown)") + " does not match this module's schema 0.12; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
  }
  if (typeof toRaw !== "function") {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive runtime values are invalid");
  }
  __velarReactiveBridge = { runtime, toRaw };
  return __velarReactiveBridge;
}
function __velarReactiveRaw(value) {
  const bridge = __velarResolveReactiveBridge();
  return bridge ? bridge.toRaw(value) : value;
}
function __velarHostRaw(value) { return __velarReactiveRaw(value); }
