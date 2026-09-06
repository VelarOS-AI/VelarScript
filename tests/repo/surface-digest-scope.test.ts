import assert from "node:assert/strict";
import test from "node:test";
import { ADVISORY_ROSTER } from "../../packages/compiler/src/analysis/advisories/roster.ts";
import { coreBuiltinErrorClasses } from "../../packages/compiler/src/analysis/builtin-errors.ts";
import { NUMBER_MEMBER_CONTRACTS, STRING_MEMBER_CONTRACTS } from "../../packages/compiler/src/analysis/published-members.ts";
import { RETIRED_MODULE_EXPORTS } from "../../packages/compiler/src/analysis/retired-imports.ts";
import { retiredCollectionExports } from "../../packages/compiler/src/analysis/collections/retired.ts";
import { builtinTypeNames } from "../../packages/compiler/src/analysis/scopes.ts";
import { surfaceDigest, surfaceInventory } from "../../scripts/surface-inventory.mjs";

/**
 * D114 item 11 / the Core ledger's 裁决项 (c): five compiler-owned tables the
 * charter calls normative were outside the `core` surface digest, so changing
 * `string.padStart`'s signature, adding an error class, retitling an advisory,
 * or retiring a spelling moved no counter and reddened no gate.
 *
 * The last test is the one that matters: it changes an entry in each table and
 * watches the digest move. A category that hashed a constant — or hashed
 * nothing — would pass every other assertion here and fail that one.
 */

function coreNames(): ReadonlyMap<string, { readonly shape: string }> {
  const inventory = surfaceInventory();
  assert.deepEqual(inventory.failures, []);
  const core = inventory.surfaces.get("core");
  assert.ok(core);
  return core.names;
}

function keysOf(category: string): readonly string[] {
  return [...coreNames().keys()].filter((key) => key.startsWith(`${category}:`)).sort();
}

test("[裁决项 c] every new category is non-empty and sourced from its own table", () => {
  const valueMethods = keysOf("value-method");
  for (const name of STRING_MEMBER_CONTRACTS.keys()) assert.ok(valueMethods.includes(`value-method:string.${name}`), name);
  for (const name of NUMBER_MEMBER_CONTRACTS.keys()) assert.ok(valueMethods.includes(`value-method:number.${name}`), name);
  assert.equal(valueMethods.length, STRING_MEMBER_CONTRACTS.size + NUMBER_MEMBER_CONTRACTS.size);

  const errors = keysOf("error-class");
  assert.deepEqual(errors, [...coreBuiltinErrorClasses().keys()].map((name) => `error-class:${name}`).sort());
  assert.ok(errors.includes("error-class:TimeoutError"));

  const typeNames = keysOf("builtin-type-name");
  assert.deepEqual(typeNames, [...builtinTypeNames].map((name) => `builtin-type-name:${name}`).sort());
  assert.ok(typeNames.includes("builtin-type-name:Pair"));

  const advisories = keysOf("advisory");
  assert.deepEqual(advisories, [...ADVISORY_ROSTER.keys()].map((code) => `advisory:${code}`).sort());
  assert.ok(advisories.includes("advisory:A18"));

  const retired = keysOf("retired-spelling");
  assert.equal(retired.length, retiredCollectionExports.size + 1 + [...RETIRED_MODULE_EXPORTS.values()].reduce((total, entries) => total + entries.size, 0));
  assert.ok(retired.some((key) => key.includes("TaskTimeoutError")));
});

test("[裁决项 c] a changed table entry moves the core digest", () => {
  const before = surfaceDigest(coreNames());
  const probes: readonly (readonly [string, () => () => void])[] = [
    ["value-method", () => mutate(STRING_MEMBER_CONTRACTS as Map<string, unknown>, "upper", { kind: "number" })],
    ["advisory", () => mutate(ADVISORY_ROSTER as Map<string, unknown>, "A1", "something else entirely")],
    ["retired-spelling", () => mutate(retiredCollectionExports as Map<string, unknown>, "unique", { parameters: ["values"], guidance: "changed", rewrite: null })],
  ];
  for (const [category, probe] of probes) {
    const restore = probe();
    try {
      assert.notEqual(surfaceDigest(coreNames()), before, `the ${category} category does not reach the digest`);
    } finally {
      restore();
    }
  }
  assert.equal(surfaceDigest(coreNames()), before);
});

test("[裁决项 c] an error class hashes its contract, not just its name", () => {
  const names = coreNames();
  const shape = (name: string): string => {
    const entry = names.get(`error-class:${name}`);
    assert.ok(entry, name);
    return entry.shape;
  };
  // ValidationError carries three detail fields, IndexError none, and a host
  // error carries `path` unless its recovery needs nothing the message does not
  // already say. Three different shapes is what proves the contract is hashed.
  assert.notEqual(shape("ValidationError"), shape("IndexError"));
  assert.notEqual(shape("FileNotFoundError"), shape("TimeoutError"));
  assert.equal(shape("AddressInUseError"), shape("TimeoutError"));
});

test("[裁决项 c] a value method hashes its signature, not just its name", () => {
  const names = coreNames();
  const shape = (key: string): string => {
    const entry = names.get(`value-method:${key}`);
    assert.ok(entry, key);
    return entry.shape;
  };
  assert.notEqual(shape("string.padStart"), shape("string.upper"));
  assert.notEqual(shape("number.toFixed"), shape("number.isNaN"));
});

test("[裁决项 c] the builtin type-name roster reaches the digest", () => {
  const before = surfaceDigest(coreNames());
  builtinTypeNames.add("ProbeOnlyTypeName");
  try {
    assert.notEqual(surfaceDigest(coreNames()), before);
  } finally {
    builtinTypeNames.delete("ProbeOnlyTypeName");
  }
  assert.equal(surfaceDigest(coreNames()), before);
});

/** Replaces one map entry and answers with the undo. A key of "" adds nothing. */
function mutate(table: Map<string, unknown>, key: string, value: unknown): () => void {
  if (key === "") return () => undefined;
  const had = table.has(key);
  const previous = table.get(key);
  table.set(key, value);
  return () => {
    if (had) table.set(key, previous);
    else table.delete(key);
  };
}
