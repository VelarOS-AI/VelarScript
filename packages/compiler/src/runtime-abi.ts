/**
 * Global registry identity shared by generated Core helpers and optional
 * runtime-providing extensions. Change this key only when two runtime
 * generations must never share one registry value.
 */
export const VELAR_RUNTIME_REGISTRY_KEY = "velar.runtime.v1";

/**
 * Shape and semantic contract implemented by the value stored in the global
 * registry. This version is independent from npm package and language versions.
 */
export const VELAR_RUNTIME_SCHEMA_VERSION = "0.11";

/**
 * Global identity for compiler-known runtime Type objects. The registry is
 * separate from the reactive runtime schema because Type identity is shared by
 * Core and every extension, including targets with no Web runtime.
 */
export const VELAR_TYPE_REGISTRY_KEY = "velar.type.registry.v1";

/**
 * Global identity for Promise values already normalized at a checked
 * JavaScript boundary. Multiple generated modules must converge on one cache
 * without exposing it as a language-level registry.
 */
export const VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY = "velar.promise.normalization.v1";
