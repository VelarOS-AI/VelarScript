import assert from "node:assert/strict";
import { VELAR_TYPE_REGISTRY_KEY } from "../../packages/compiler/src/runtime-abi.ts";

/**
 * D115 §一.6 — the one copy of "declare this literal a runtime Type".
 *
 * The hardened registry an emitted runtime keeps under
 * `VELAR_TYPE_REGISTRY_KEY` is what tells a `parse`/`is` pair apart from any
 * other object with those two members, and a test that hands a runtime its own
 * stand-in Type has to enter it there. The same six lines stood at the top of
 * `tests/node/node-platform.slow.test.ts` and `tests/desktop/desktop-runtime.test.ts`;
 * this is that declaration, unchanged.
 */
export function registerRuntimeType<T extends object>(value: T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(VELAR_TYPE_REGISTRY_KEY));
  assert.ok(descriptor && "value" in descriptor);
  WeakSet.prototype.add.call(descriptor.value, value);
  return value;
}
