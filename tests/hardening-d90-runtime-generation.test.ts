import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { standardModuleSource } from "@velarscript/core";
import {
  VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY,
  VELAR_REACTIVE_BRIDGE_RUNTIME,
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
  VELAR_STRICT_JSON_RUNTIME,
  VELAR_TYPE_REGISTRY_KEY,
  VELAR_TYPE_REGISTRY_RUNTIME,
} from "@velarscript/compiler/extension";
import { WEB_RUNTIME_FOUNDATION } from "../packages/web/src/runtime-foundation.ts";

// D90 fr-5/fr-6/fr-7/fr-8 — the runtime generation boundary.
//
// Two generations of @velarscript/* in one build converge on the same global
// registries. Until now that mismatch was *quiet* almost everywhere: the JSON
// bridge and Core's List guard both wrote `!runtime || runtime.version !== ...`
// and returned the raw value either way, so a foreign generation looked exactly
// like the blessed "this realm has no reactive runtime" case and reactivity was
// dropped with no trace. The one site that did fail closed, and the Web
// foundation, named no version at all — the Web foundation reported "fields are
// invalid" instead, because a schema bump usually moves the field roster too
// and the roster was checked first.
//
// This file pins the split: absent stays silent, present-but-foreign fails
// closed with a message naming BOTH schema versions, and identity alone is no
// longer enough to accept a registered Type.

const FOREIGN_SCHEMA_VERSION = "0.11";

/** Installs a reactive registry whose fields match the real one but for `version`. */
function registryPrelude(version: string, fields = "toRaw: (value) => value, collectionRead: (_value, _key, child) => child, trackDeep() {}"): string {
  return `
const __registry = Object.create(null);
for (const [name, value] of Object.entries({ version: ${JSON.stringify(version)}, ${fields} })) {
  Object.defineProperty(__registry, name, { value, enumerable: false, configurable: false, writable: false });
}
Object.preventExtensions(__registry);
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)}), {
  value: __registry, enumerable: false, configurable: false, writable: false,
});
`.trimStart();
}

/**
 * Runs generated runtime text in its own realm. A registry descriptor is
 * non-configurable once written, so a mismatch can only be exercised in a
 * process that has never seen the real one.
 */
function runInRealm(source: string): { readonly stdout: string; readonly status: number | null } {
  const execution = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: source });
  assert.equal(execution.status, 0, String(execution.stderr));
  return { stdout: String(execution.stdout), status: execution.status };
}

/** Reports the outcome of `body` as one line, so a silent path and a throw are both observable. */
function outcomeProbe(body: string): string {
  return `
try { console.log("returned " + (${body})); } catch (error) { console.log("threw " + error.message); }
`.trimStart();
}

function assertNamesBothSchemas(line: string, subject: string): void {
  assert.match(line, /^threw /u, line);
  assert.match(line, new RegExp(`${subject} schema ${FOREIGN_SCHEMA_VERSION} does not match this module's schema ${VELAR_RUNTIME_SCHEMA_VERSION}`, "u"), line);
  assert.match(line, /npm ls @velarscript\/compiler/u, line);
}

test("[fr-5] the JSON bridge fails closed on a foreign reactive generation", () => {
  const { stdout } = runInRealm(`
${registryPrelude(FOREIGN_SCHEMA_VERSION)}
${VELAR_STRICT_JSON_RUNTIME}
${outcomeProbe(`__velarJsonStringify({ a: 1 })`)}
`.trimStart());
  // Before the split this printed `returned {"a":1}`: the foreign runtime was
  // skipped, `trackDeep` never ran, and the JSON text was built from raw values.
  assertNamesBothSchemas(stdout.trim(), "VelarScript reactive runtime");
});

test("[fr-5] Core's List guard fails closed on a foreign reactive generation", () => {
  const collections = standardModuleSource("velar/collections");
  assert.ok(collections, "velar/collections must have a Core module source");
  const { stdout } = runInRealm(`
${registryPrelude(FOREIGN_SCHEMA_VERSION)}
${collections}
${outcomeProbe(`JSON.stringify(reversed([1, 2]))`)}
`.trimStart());
  // Before the split this printed `returned [2,1]`: every element was copied
  // raw and each `collectionRead` dependency the caller needed was lost.
  assertNamesBothSchemas(stdout.trim(), "VelarScript reactive runtime");
});

test("[fr-7] the reactive bridge names both schema versions instead of 'values are invalid'", () => {
  const { stdout } = runInRealm(`
${registryPrelude(FOREIGN_SCHEMA_VERSION)}
${VELAR_REACTIVE_BRIDGE_RUNTIME}
${outcomeProbe(`String(__velarReactiveRaw({}))`)}
`.trimStart());
  assertNamesBothSchemas(stdout.trim(), "VelarScript reactive runtime");
});

test("[fr-7] the Web foundation reports the schema even when the field roster also differs", () => {
  const { stdout } = runInRealm(`
${registryPrelude(FOREIGN_SCHEMA_VERSION, "toRaw: (value) => value")}
${outcomeProbe(`(() => { ${WEB_RUNTIME_FOUNDATION}\nreturn "loaded"; })()`)}
`.trimStart());
  // A schema bump nearly always moves the roster too, so the roster check used
  // to win the race and report "fields are invalid" — the one diagnostic that
  // cannot be acted on.
  const line = stdout.trim();
  assert.doesNotMatch(line, /fields are invalid/u, line);
  assertNamesBothSchemas(line, "VelarScript Web runtime");
});

test("[fr-7] a same-generation runtime with a broken field still reports that field", () => {
  const { stdout } = runInRealm(`
${registryPrelude(VELAR_RUNTIME_SCHEMA_VERSION, "toRaw: (value) => value")}
${outcomeProbe(`(() => { ${WEB_RUNTIME_FOUNDATION}\nreturn "loaded"; })()`)}
`.trimStart());
  // Moving the schema check first must not swallow the checks behind it.
  assert.match(stdout.trim(), /threw VelarScript Web runtime fields are invalid/u, stdout);
});

test("[fr-5] an absent registry keeps the silent path exactly as it was", () => {
  const collections = standardModuleSource("velar/collections");
  assert.ok(collections, "velar/collections must have a Core module source");
  const { stdout } = runInRealm(`
${VELAR_STRICT_JSON_RUNTIME}
${collections}
${VELAR_REACTIVE_BRIDGE_RUNTIME}
${outcomeProbe(`__velarJsonStringify({ a: 1 })`)}
${outcomeProbe(`JSON.stringify(reversed([1, 2]))`)}
${outcomeProbe(`JSON.stringify(__velarReactiveRaw([3]))`)}
`.trimStart());
  // No registry is the blessed "no reactive runtime in this realm" case the
  // runtime-boundary ledger keeps for ordinary Core behavior.
  assert.deepEqual(stdout.trim().split("\n"), [`returned {"a":1}`, "returned [2,1]", "returned [3]"]);
});

test("[fr-6] a registered value that no longer presents the Type surface is refused", () => {
  const { stdout } = runInRealm(`
${VELAR_TYPE_REGISTRY_RUNTIME}
const __missingParse = __velarRegisterRuntimeType({ is: () => true });
const __missingIs = __velarRegisterRuntimeType({ parse: (value) => value });
const __complete = __velarRegisterRuntimeType({ is: () => true, parse: (value) => value });
${outcomeProbe(`String(__velarRequireRuntimeType(__missingParse, "probe") !== null)`)}
${outcomeProbe(`String(__velarRequireRuntimeType(__missingIs, "probe") !== null)`)}
${outcomeProbe(`String(__velarRequireRuntimeType(__complete, "probe") === __complete)`)}
${outcomeProbe(`String(__velarRequireRuntimeType(null, "probe", true))`)}
`.trimStart());
  // WeakSet membership proves only that *something* registered the value. A
  // generation whose Type shape moved is still a member, so the surface the
  // caller is about to invoke is asserted too.
  assert.deepEqual(stdout.trim().split("\n"), [
    "threw probe requires a compiler-known VelarScript runtime type",
    "threw probe requires a compiler-known VelarScript runtime type",
    "returned true",
    "returned null",
  ]);
});

test("[fr-6][fr-8] both auxiliary registries carry a generation component", () => {
  assert.match(VELAR_TYPE_REGISTRY_KEY, /^velar\.type\.registry\.v\d+$/u);
  assert.match(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY, /^velar\.promise\.normalization\.v\d+$/u);
  // The generation lives in the key, so two generations claim two global slots
  // rather than whichever one loaded first claiming the realm.
  assert.ok(VELAR_TYPE_REGISTRY_RUNTIME.includes(JSON.stringify(VELAR_TYPE_REGISTRY_KEY)));
});
