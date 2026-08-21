import { VELAR_RUNTIME_REGISTRY_KEY, VELAR_RUNTIME_SCHEMA_VERSION } from "./runtime-abi.ts";

export const VELAR_REACTIVE_BRIDGE_MODULE = "velar/compiler-runtime-reactive-v1";

/**
 * Core has no reactive provider. Keep the same private module ABI so shared
 * collection lowering remains target-agnostic, but make absence a compile-time
 * fact instead of probing the Web registry on every collection operation.
 */
export const VELAR_NON_REACTIVE_BRIDGE_RUNTIME = String.raw`
const __velarReactiveIterateKey = null;
const __velarReactiveStructureKey = null;
function __velarReactiveRaw(value) { return value; }
function __velarHostRaw(value) { return value; }
`.trimStart();

export const VELAR_NON_REACTIVE_COLLECTION_BRIDGE_RUNTIME = String.raw`
function __velarReactiveCollectionRead(value, key, child) { return child === undefined ? null : child; }
function __velarReactiveCollectionTrack() {}
function __velarReactiveCollectionLink() {}
function __velarReactiveCollectionTrigger() {}
function __velarReactiveCollectionUnlink() {}
`.trimStart();

/** Compiler-owned late-binding bridge to an optional immutable reactive runtime provider. */
export const VELAR_REACTIVE_BRIDGE_RUNTIME = String.raw`
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
const __velarReactiveRuntimeKey = __velarReactiveBridgeSymbolFor(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)});
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
  // The generation mismatch gets its own message: it is the one failure an
  // author can act on, and the shared "values are invalid" wording never named
  // either version.
  if (version !== ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}) {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive runtime schema " + (typeof version === "string" ? version : "(unknown)") + " does not match this module's schema ${VELAR_RUNTIME_SCHEMA_VERSION}; one build mixed two generations of @velarscript/* — run 'npm ls @velarscript/compiler' and pin one version");
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
`.trimStart();

/** Collection-only extension of the base reactive bridge. */
export const VELAR_REACTIVE_COLLECTION_BRIDGE_RUNTIME = String.raw`
let __velarReactiveCollectionBridge = null;
function __velarResolveReactiveCollectionBridge() {
  if (__velarReactiveCollectionBridge) return __velarReactiveCollectionBridge;
  const bridge = __velarResolveReactiveBridge();
  if (!bridge) return null;
  const collectionRead = __velarReactiveBridgeField(bridge.runtime, "collectionRead");
  const collectionTrigger = __velarReactiveBridgeField(bridge.runtime, "collectionTrigger");
  const collectionUnlink = __velarReactiveBridgeField(bridge.runtime, "collectionUnlink");
  const reactive = __velarReactiveBridgeField(bridge.runtime, "reactive");
  const track = __velarReactiveBridgeField(bridge.runtime, "track");
  if (typeof collectionRead !== "function" || typeof collectionTrigger !== "function"
    || typeof collectionUnlink !== "function" || typeof reactive !== "function" || typeof track !== "function") {
    throw new __velarReactiveBridgeNativeTypeError("VelarScript reactive collection runtime values are invalid");
  }
  __velarReactiveCollectionBridge = { runtime: bridge.runtime, toRaw: bridge.toRaw, collectionRead, collectionTrigger, collectionUnlink, reactive, track };
  return __velarReactiveCollectionBridge;
}
function __velarReactiveCollectionRead(value, key, child) {
  if (child === undefined) child = null;
  const bridge = __velarResolveReactiveCollectionBridge();
  return bridge ? bridge.collectionRead(value, key, child) : child;
}
function __velarReactiveCollectionTrack(value, key = __velarReactiveIterateKey) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.track(bridge.toRaw(value), key);
}
function __velarReactiveCollectionLink(value, child) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.reactive(child, bridge.toRaw(value));
}
function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.collectionTrigger(value, key, iterate, structure, indexFrom, allKeys);
}
function __velarReactiveCollectionUnlink(value, child) {
  const bridge = __velarResolveReactiveCollectionBridge();
  if (bridge) bridge.collectionUnlink(value, child);
}
`.trimStart();

export const VELAR_REACTIVE_BRIDGE_MODULE_SOURCE = String.raw`
${VELAR_REACTIVE_BRIDGE_RUNTIME}
${VELAR_REACTIVE_COLLECTION_BRIDGE_RUNTIME}
export {
  __velarReactiveIterateKey as reactiveIterateKey,
  __velarReactiveStructureKey as reactiveStructureKey,
  __velarReactiveRaw as reactiveRaw,
  __velarHostRaw as hostRaw,
  __velarReactiveCollectionRead as reactiveCollectionRead,
  __velarReactiveCollectionTrack as reactiveCollectionTrack,
  __velarReactiveCollectionLink as reactiveCollectionLink,
  __velarReactiveCollectionTrigger as reactiveCollectionTrigger,
  __velarReactiveCollectionUnlink as reactiveCollectionUnlink,
};
`.trimStart();

export const VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE = String.raw`
${VELAR_NON_REACTIVE_BRIDGE_RUNTIME}
${VELAR_NON_REACTIVE_COLLECTION_BRIDGE_RUNTIME}
export {
  __velarReactiveIterateKey as reactiveIterateKey,
  __velarReactiveStructureKey as reactiveStructureKey,
  __velarReactiveRaw as reactiveRaw,
  __velarHostRaw as hostRaw,
  __velarReactiveCollectionRead as reactiveCollectionRead,
  __velarReactiveCollectionTrack as reactiveCollectionTrack,
  __velarReactiveCollectionLink as reactiveCollectionLink,
  __velarReactiveCollectionTrigger as reactiveCollectionTrigger,
  __velarReactiveCollectionUnlink as reactiveCollectionUnlink,
};
`.trimStart();
