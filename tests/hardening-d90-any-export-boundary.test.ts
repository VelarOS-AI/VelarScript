import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

// D90 R12: `any` may not appear at an export position, written or inferred.
//
// The written spelling was already refused — `export const leaked: any = thing`
// reports "'any' is reserved for explicit unsafe JavaScript boundaries" — while
// the inferred `export const leaked = thing` published `leaked: any` with zero
// diagnostics. That asymmetry was the whole defect: the spelling that got
// refused is the honest one. This file pins the completed rule, not a new one —
// same diagnostic code, no contagious unsafe marker.
//
// `any` has exactly one origin in a module, `import js unsafe`, so every case
// below starts from one.

function diagnostics(source: string): string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

const wayOut = "validate the value into a declared type in this module first";

test("an inferred any at an export position is refused", () => {
  const direct = diagnostics(`
import js unsafe {thing} from "./x.js"

export const leaked = thing
`);
  assert.deepEqual(direct, [
    `VEL4001 Export 'leaked' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // Vel has no bare `export {a}`, so the indirect spelling is a second
  // declaration whose inferred type is the same `any`.
  const indirect = diagnostics(`
import js unsafe {thing} from "./x.js"

const a = thing

export const b = a
`);
  assert.ok(indirect.some((item) => item.includes("Export 'b' is 'any'")), indirect.join("\n"));

  // A container of `any` is read out of by the consumer exactly as a bare one is.
  const inList = diagnostics(`
import js unsafe {thing} from "./x.js"

export const items = [thing]
`);
  assert.ok(inList.some((item) => item.includes("Export 'items' is 'any'")), inList.join("\n"));
});

test("the refusal names every binding a pattern exports", () => {
  // Checking the settled type at statement level, before the pattern is
  // declared, covers every pattern shape in one place; both names used to be
  // published as `any`.
  const destructured = diagnostics(`
import js unsafe {thing} from "./x.js"

export const {a, b} = thing
`);
  assert.ok(destructured.some((item) => item.includes("Exports 'a', 'b' are 'any'")), destructured.join("\n"));

  const mutable = diagnostics(`
import js unsafe {thing} from "./x.js"

export let held = thing
`);
  assert.ok(mutable.some((item) => item.includes("Export 'held' is 'any'")), mutable.join("\n"));
});

test("an exported function with an omitted result annotation is refused", () => {
  // This module has no other omitted result, so the driver never runs the
  // converge-and-finalize loop: the report is deliberately not gated on
  // `finalizeFunctionResultInference`, and a probe pass is discarded whole,
  // which is why an ungated report cannot duplicate.
  const inferred = diagnostics(`
import js unsafe {thing} from "./x.js"

export def get():
    return thing
`);
  assert.deepEqual(inferred, [
    `VEL4001 Export 'get' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // An async result is a Promise of the inferred value, and the predicate
  // visits what the promise resolves to.
  const asynchronous = diagnostics(`
import js unsafe {thing} from "./x.js"

export async def get():
    return thing
`);
  assert.ok(asynchronous.some((item) => item.includes("Export 'get' is 'any'")), asynchronous.join("\n"));
});

test("the refusal teaches the way out instead of only announcing itself", () => {
  const reported = diagnostics(`
import js unsafe {thing} from "./x.js"

export const leaked = thing
`);
  assert.equal(reported.length, 1);
  // The escape the ruling names, in the repository's own spelling
  // (examples/tour/core/13-javascript-boundary.vel writes `Config.parse`).
  assert.match(reported[0]!, /Config\.parse\(candidate\)/u);
  assert.match(reported[0]!, /cannot cross a module boundary/u);
});

test("an any that never leaves the module is untouched", () => {
  // The boundary block itself, and every internal use of what it imports.
  const internal = diagnostics(`
import js unsafe {thing} from "./x.js"

const kept = thing

def read() -> string:
    const settled: string = kept
    return settled
`);
  assert.deepEqual(internal, []);

  // A function that infers `any` but is not exported publishes nothing.
  const privateFunction = diagnostics(`
import js unsafe {thing} from "./x.js"

def get():
    return thing

const used = get()
`);
  assert.deepEqual(privateFunction, []);
});

test("a value validated into a declared type exports cleanly", () => {
  const validated = diagnostics(`
import js unsafe {thing} from "./x.js"

type Config:
    retries: number

export const settled = Config.parse(thing)
`);
  assert.deepEqual(validated, []);

  const annotatedResult = diagnostics(`
import js unsafe {thing} from "./x.js"

export def get() -> string:
    return thing
`);
  assert.deepEqual(annotatedResult, []);
});

test("an any in a callable input position leaks nothing and is allowed", () => {
  // The rule exists so a consumer never *receives* a value the compiler makes
  // no promise about; an input position accepts a value from the consumer
  // instead. `Json.stringify` is the repository's own case — an `any` first
  // parameter and a `string` result — and it is re-exported from
  // examples/tour/core/08-collections-and-math.vel today.
  const reexported = diagnostics(`
export const encode = Json.stringify
`);
  assert.deepEqual(reexported, []);

  const inRecord = diagnostics(`
export const chapter = {encode: Json.stringify}
`);
  assert.deepEqual(inRecord, []);
});

test("the written spelling is still refused by the rule this completes", () => {
  // Unchanged, and quoted here so the two halves of one rule stay visible
  // together: the point of R12 is that these two now agree.
  const written = diagnostics(`
import js unsafe {thing} from "./x.js"

export const leaked: any = thing
`);
  assert.deepEqual(written, [
    "VEL4001 'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript",
  ]);
});
