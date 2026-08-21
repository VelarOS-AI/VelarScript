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
export const VELAR_RUNTIME_SCHEMA_VERSION = "0.12";

/**
 * Generation of the compiler-known runtime Type surface. It is deliberately
 * not `VELAR_RUNTIME_SCHEMA_VERSION`: Type identity is shared by Core and every
 * extension, including targets with no reactive runtime, so it moves on its own
 * schedule. Bump it whenever the shape a registered Type presents changes, so
 * two generations converge on two registries instead of one mixed one.
 */
export const VELAR_TYPE_REGISTRY_VERSION = "1";

/**
 * Global identity for compiler-known runtime Type objects. The registry is
 * separate from the reactive runtime schema because Type identity is shared by
 * Core and every extension, including targets with no Web runtime. The
 * generation above is the key's trailing `v` component, so a bump renames the
 * global slot rather than reusing a foreign generation's WeakSet.
 */
export const VELAR_TYPE_REGISTRY_KEY = `velar.type.registry.v${VELAR_TYPE_REGISTRY_VERSION}`;

/**
 * Generation of the Promise normalization cache. Independent of both versions
 * above: it moves when the normalized identity a cached entry stands for
 * changes. Bumping it gives the next generation its own WeakMap instead of
 * letting whichever module loaded first hand its cached values to every other
 * generation in the realm. Eviction is not part of this contract and must not
 * be added — the cache is a WeakMap keyed by the source Promise, so an entry is
 * released with the Promise it belongs to.
 */
export const VELAR_PROMISE_NORMALIZATION_REGISTRY_VERSION = "1";

/**
 * Global identity for Promise values already normalized at a checked
 * JavaScript boundary. Multiple generated modules must converge on one cache
 * without exposing it as a language-level registry.
 */
export const VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY =
  `velar.promise.normalization.v${VELAR_PROMISE_NORMALIZATION_REGISTRY_VERSION}`;
