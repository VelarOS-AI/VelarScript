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
