import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compileProject, standardModuleSource, linkedStandardModuleSource } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("the language's data comparison compares owned structures without recursive graph failure", () => {
  // D50 rule 90 retired Json.deepEqual and rule 97.2 retired velar/test's own
  // copy, so equals(a, b) is the single owner and carries the hardening for
  // every spelling that reaches it — including toEqual.
  const source = linkedStandardModuleSource("velar/test");
  const execution = executeModule(`${source}
// The inlined module already imports the one comparison there is; a refusal is
// reported verbatim, because refusing is an answer equals is entitled to give.
const deepEqual = (left, right) => { try { return __velarEquals(left, right); } catch (error) { return error.message; } };
import { runInNewContext } from "node:vm";
const left = { name: "Velar", nested: [1, { ready: true }] };
const right = { nested: [1, { ready: true }], name: "Velar" };
console.log(deepEqual(left, right));
console.log(deepEqual(left, { name: "Velar", nested: [1, { ready: false }] }));
console.log(deepEqual(new Map([["item", { value: 1 }]]), new Map([["item", { value: 1 }]])));
console.log(deepEqual(new Set(["a", "b"]), new Set(["b", "a"])));
const foreignList = runInNewContext('class HostileList extends Array { every() { throw new Error("list override") } }; new HostileList(1, 2)');
const foreignMap = runInNewContext('class HostileMap extends Map { get size() { throw new Error("map size override") } entries() { throw new Error("map entries override") } has() { throw new Error("map has override") } get() { throw new Error("map get override") } }; new HostileMap([["item", 1]])');
const foreignSet = runInNewContext('class HostileSet extends Set { get size() { throw new Error("set size override") } values() { throw new Error("set values override") } has() { throw new Error("set has override") } }; new HostileSet(["a", "b"])');
console.log(deepEqual(foreignList, [1, 2]));
console.log(deepEqual(foreignMap, new Map([["item", 1]])));
console.log(deepEqual(foreignSet, new Set(["b", "a"])));
class Box { constructor(value) { this.value = value; } }
const box = new Box(1);
console.log(deepEqual(box, box));
console.log(deepEqual(box, new Box(1)));
const shared = { value: 1 };
console.log(deepEqual({ first: shared, second: shared }, { first: { value: 1 }, second: { value: 1 } }));
const cycleA = {}; cycleA.self = cycleA;
const cycleB = {}; cycleB.self = cycleB;
console.log(deepEqual(cycleA, cycleB));
console.log(deepEqual(cycleA, cycleA));
const sparseA = []; sparseA.length = 1;
const sparseB = []; sparseB.length = 1;
console.log(deepEqual(sparseA, sparseB));
let getterReads = 0;
const getterA = {}, getterB = {};
Object.defineProperty(getterA, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
Object.defineProperty(getterB, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
console.log(deepEqual(getterA, getterB));
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  // The last three used to answer a quiet 'false'. The single owner names the
  // reason instead, which is the whole point of having one owner.
  assert.equal(execution.stdout, [
    "true", "false", "true", "true", "true", "true", "true", "true", "false", "true",
    "equals cannot compare cyclic data",
    "true",
    "equals requires a dense VelarScript List",
    "equals requires ordinary mutable enumerable data fields",
    "0",
    "",
  ].join("\n"));
});

test("velar/json captures validation, serialization, graph, and error hosts at initialization", () => {
  const source = standardModuleSource("velar/json") ?? "";
  const execution = executeModule(`${source}
const OriginalTypeError = TypeError;
const nativeDefineProperty = Object.defineProperty;
const regExpPrototype = Object.getPrototypeOf(/x/u);
let poisonedCalls = 0;
const poison = () => { poisonedCalls += 1; throw new Error("late JSON host mutation"); };
nativeDefineProperty(Map.prototype, "size", { configurable: true, get: poison });
nativeDefineProperty(Set.prototype, "size", { configurable: true, get: poison });
Array.isArray = poison;
Array.prototype.sort = poison;
Map.prototype.entries = poison;
Map.prototype.has = poison;
Map.prototype.get = poison;
Set.prototype.values = poison;
Set.prototype.has = poison;
Set.prototype.add = poison;
Set.prototype.delete = poison;
WeakSet.prototype.has = poison;
WeakSet.prototype.add = poison;
WeakSet.prototype.delete = poison;
Number.isFinite = poison;
Number.isInteger = poison;
Math.max = poison;
String.prototype.charCodeAt = poison;
regExpPrototype.test = poison;
Object.getOwnPropertyDescriptor = poison;
Object.getOwnPropertyNames = poison;
Object.getOwnPropertySymbols = poison;
Object.getPrototypeOf = poison;
Object.create = poison;
Object.defineProperty = poison;
Reflect.apply = poison;
Reflect.ownKeys = poison;
JSON.parse = poison;
JSON.stringify = poison;
globalThis.Array = class PoisonArray {};
globalThis.Map = class PoisonMap {};
globalThis.Set = class PoisonSet {};
globalThis.WeakSet = class PoisonWeakSet {};
globalThis.Object = class PoisonObject {};
globalThis.Number = class PoisonNumber {};
globalThis.String = class PoisonString {};
globalThis.TypeError = class PoisonTypeError extends Error {};
globalThis.RangeError = class PoisonRangeError extends Error {};

console.log(stringify({ b: 2, a: [1, true], text: "😀" }));
console.log(stableStringify({ b: 2, a: 1 }));
console.log(parse('{"a":1}').a, clone({ b: 2 }).b, isSerializable({ ready: true }));
try { stringify({ value: Infinity }); console.log("accepted"); } catch (error) { console.log(error instanceof OriginalTypeError); }
console.log(poisonedCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    '{"b":2,"a":[1,true],"text":"😀"}',
    '{"a":1,"b":2}',
    "1 2 true",
    "true",
    "0",
    "",
  ].join("\n"));
});

test("velar/test toEqual uses the language deepEqual contract", () => {
  const source = linkedStandardModuleSource("velar/test");
  const execution = executeModule(`${source}
import { runInNewContext } from "node:vm";
function passes(callback) { try { callback(); return true; } catch { return false; } }
console.log(passes(() => expect({ value: [1, 2] }).toEqual({ value: [1, 2] })));
const sparseA = []; sparseA.length = 1;
const sparseB = []; sparseB.length = 1;
console.log(passes(() => expect(sparseA).toEqual(sparseB)));
class Box { constructor(value) { this.value = value; } }
const box = new Box(1);
console.log(passes(() => expect(box).toEqual(new Box(1))));
console.log(passes(() => expect(box).toEqual(box)));
console.log(passes(() => expect(new Map([["item", { value: 1 }]])).toEqual(new Map([["item", { value: 1 }]]))));
console.log(passes(() => expect(new Set(["a"])).toEqual(new Set(["a"]))));
console.log(passes(() => expect(new Set(["a"])).toEqual(new Set(["b"]))));
const foreignMap = runInNewContext('class HostileMap extends Map { get size() { throw new Error("map size override") } entries() { throw new Error("map entries override") } }; new HostileMap([["item", 1]])');
console.log(passes(() => expect(foreignMap).toEqual(new Map([["item", 1]]))));
try { expect(foreignMap).toEqual(new Map([["item", 2]])); } catch (error) { console.log(error.message.startsWith("Expected Map(")); }
const cycleA = {}; cycleA.self = cycleA;
const cycleB = {}; cycleB.self = cycleB;
console.log(passes(() => expect(cycleA).toEqual(cycleB)));
console.log(passes(() => expect(cycleA).toEqual(cycleA)));
let getterReads = 0;
const getterA = {}, getterB = {};
Object.defineProperty(getterA, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
Object.defineProperty(getterB, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
console.log(passes(() => expect(getterA).toEqual(getterB)));
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\ntrue\ntrue\ntrue\nfalse\ntrue\ntrue\nfalse\ntrue\nfalse\n0\n");
});

test("velar/test matchers cannot turn invalid subjects into false positives", async () => {
  const source = linkedStandardModuleSource("velar/test");
  const execution = executeModule(`${source}
function passes(callback) { try { callback(); return true; } catch { return false; } }
async function passesAsync(callback) { try { await callback(); return true; } catch { return false; } }
console.log(passes(() => expect(-0).toBe(0)), passes(() => expect(NaN).toBe(NaN)));
console.log(passes(() => expect(true).toBeTruthy()), passes(() => expect(1).toBeTruthy()));
console.log(passes(() => expect(false).toBeFalsy()), passes(() => expect("").toBeFalsy()));
console.log(passes(() => expect([-0]).toContain(0)), passes(() => expect([NaN]).toContain(NaN)));
class HostileList extends Array { some() { throw new Error("list override"); } }
console.log(passes(() => expect(new HostileList("value")).toContain("value")));
const sparse = []; sparse.length = 1;
console.log(passes(() => expect(sparse).toHaveLength(1)));
console.log(passes(() => expect("Velar").toMatch("^Vel")), passes(() => expect("Velar").toMatch(42)));
console.log(passes(() => expect(() => { throw new Error("expected"); }).toThrow()), passes(() => expect(42).toThrow()));
console.log(await passesAsync(() => expect(Promise.reject(new Error("expected"))).toReject()));
console.log(await passesAsync(() => expect(() => Promise.reject(new Error("expected"))).toReject()));
console.log(await passesAsync(() => expect(() => { throw new Error("sync"); }).toReject()));
console.log(await passesAsync(() => expect(Promise.resolve(1)).toReject()));
console.log(await passesAsync(() => expect(42).toReject()));
let thenGetterReads = 0;
const hostileThenable = Object.defineProperty({}, "then", { get() { thenGetterReads += 1; return () => null; } });
console.log(await passesAsync(() => expect(hostileThenable).toReject()), thenGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // D59 rules 141/141.1: `toBe` and `toContain`'s List branch are the
    // language's own `==`, so both answer "true" for `-0`/`0` and for
    // NaN/NaN. Each read "true false" while it used native `===` -- first
    // `toBe`, then `toContain`, each in turn the one comparison in the
    // language that disagreed with the language.
    "true true", "true false", "true false", "true true", "true", "false",
    "true false", "true false", "true", "true", "false", "false", "false", "false 0", "",
  ].join("\n"));

  const directory = await makeTemporaryDirectory("velar-test-matchers-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {expect} from "velar/test"

def value() -> number:
    return 1

expect(1).toMatch("1")
expect("value").toThrow()
expect(true).toHaveLength(1)
expect(value).toReject()
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.deepEqual(invalid.failures, []);
  const matcherDiagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(matcherDiagnostics.filter((item) => /has no field/u.test(item.message)).length, 4, JSON.stringify(matcherDiagnostics));
});

test("velar/test captures matcher, display, Promise, and error hosts at initialization", () => {
  const source = linkedStandardModuleSource("velar/test");
  const execution = executeModule(`${source}
const OriginalError = Error;
const OriginalTypeError = TypeError;
const OriginalRangeError = RangeError;
const originalDefineProperty = Object.defineProperty;
const rejected = Promise.reject(new OriginalError("expected"));
const resolved = Promise.resolve(1);
const list = ["a", { value: 1 }];
const map = new Map([["item", { value: 1 }]]);
const set = new Set(["a"]);
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalError("poisoned host"); };
for (const [owner, name] of [
  [Array, "isArray"], [Array.prototype, "join"], [Array.prototype, "sort"],
  [Map.prototype, "entries"], [Map.prototype, "has"], [Map.prototype, "get"],
  [Set.prototype, "values"], [Set.prototype, "has"],
  [WeakSet.prototype, "has"], [WeakSet.prototype, "add"], [WeakSet.prototype, "delete"],
  [String.prototype, "slice"], [String.prototype, "includes"],
  [Number, "isSafeInteger"], [JSON, "stringify"], [Math, "min"],
  [Promise.prototype, "then"], [RegExp.prototype, "exec"],
  [Object, "getOwnPropertyDescriptor"], [Object, "getOwnPropertyNames"],
  [Object, "getOwnPropertySymbols"], [Object, "getPrototypeOf"], [Object, "freeze"],
  [Reflect, "apply"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
originalDefineProperty(Map.prototype, "size", { configurable: true, get: poison });
originalDefineProperty(Set.prototype, "size", { configurable: true, get: poison });
globalThis.Array = class PoisonedArray {};
globalThis.Map = class PoisonedMap {};
globalThis.Set = class PoisonedSet {};
globalThis.WeakSet = class PoisonedWeakSet {};
globalThis.Object = class PoisonedObject {};
globalThis.String = class PoisonedString {};
globalThis.Number = class PoisonedNumber {};
globalThis.Promise = class PoisonedPromise {};
globalThis.RegExp = class PoisonedRegExp {};
globalThis.Error = class PoisonedError extends OriginalError {};
globalThis.TypeError = class PoisonedTypeError extends OriginalError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalError {};
function failure(callback) { try { callback(); return null; } catch (error) { return error; } }
console.log(expect({ value: list }).toEqual({ value: ["a", { value: 1 }] }) === undefined);
console.log(expect("VelarScript").toContain("Script") === undefined);
console.log(expect("VelarScript").toMatch("^Velar") === undefined);
console.log(expect(list).toHaveLength(2) === undefined);
console.log(expect(() => { throw new OriginalError("expected"); }).toThrow() === undefined);
const displayFailure = failure(() => expect({ list, map, set }).toBe(null));
console.log(displayFailure instanceof OriginalError, displayFailure.message);
const typeFailure = failure(() => expect(1).toMatch("1"));
const patternFailure = failure(() => expect("x").toMatch("["));
const rangeFailure = failure(() => expect("x").toHaveLength(-1));
console.log(typeFailure instanceof OriginalTypeError, patternFailure instanceof OriginalTypeError, rangeFailure instanceof OriginalRangeError);
console.log(await expect(rejected).toReject() === null);
const rejectionFailure = await (async () => { try { await expect(resolved).toReject(); return null; } catch (error) { return error; } })();
console.log(rejectionFailure instanceof OriginalError, rejectionFailure.message);
console.log(poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true", "true", "true", "true", "true",
    'true Expected {"list": ["a", {"value": 1}], "map": Map("item" => {"value": 1}), "set": Set("a")} to be null',
    "true true true",
    "true",
    "true Expected Promise to reject",
    "0",
    "",
  ].join("\n"));
});

test("velar/time rejects JavaScript date rollover and parses deterministic ISO input", () => {
  const source = standardModuleSource("velar/time") ?? "";
  const execution = executeModule(`${source}
console.log(iso(utc(2024, 2, 29, 3, 4, 5)));
console.log(iso(utc(24, 1, 2)));
console.log(iso(parse("2024-01-02T03:04:05.6+02:30")));
console.log(parse("2024-02-29") === utc(2024, 2, 29));
const local = parts(date(2024, 1, 2, 3, 4, 5));
console.log([local.year, local.month, local.day, local.hour, local.minute, local.second].join("-"));
for (const value of ["2023-02-29", "2024-13-01", "2024-01-02T03:04", "2024-01-02T03:04Z+01:00", "2024-01-02T03:04+24:00", "January 2 2024"]) console.log(parse(value) === null);
for (const parts of [[2024, 2, 30], [2024, 0, 1], [2024, 1, 1, 24]]) {
  try { utc(...parts); console.log("accepted"); } catch (error) { console.log(error.name); }
}
try { parse(42); console.log("accepted"); } catch (error) { console.log(error.name); }
try { format(utc(2024, 1, 1), 42); console.log("accepted"); } catch (error) { console.log(error.name); }
try { parts(utc(2024, 1, 1), 42); console.log("accepted"); } catch (error) { console.log(error.name); }
try { iso(8_640_000_000_000_001); console.log("accepted"); } catch (error) { console.log(error.name); }
Date.now = () => NaN;
globalThis.performance = { now: () => Infinity };
let timeCoercions = 0;
let timeGetterReads = 0;
Intl.DateTimeFormat = class {
  format() { return { toString() { timeCoercions += 1; return "unsafe"; } }; }
  formatToParts() {
    const part = { type: "year" };
    Object.defineProperty(part, "value", { enumerable: true, get() { timeGetterReads += 1; return "2024"; } });
    return [part];
  }
};
Date.prototype.toISOString = () => "poisoned";
Date.prototype.getUTCFullYear = () => 9999;
Number.isFinite = () => false;
Number.isInteger = () => false;
Number.isSafeInteger = () => false;
Math.abs = () => Infinity;
Object.freeze = () => { throw new Error("poisoned"); };
console.log(typeof now() === "number", typeof monotonic() === "number", iso(0), typeof format(0) === "string", parts(0, "UTC").year);
console.log(timeCoercions + ":" + timeGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "2024-02-29T03:04:05.000Z",
    "0024-01-02T00:00:00.000Z",
    "2024-01-02T00:34:05.600Z",
    "true",
    "2024-1-2-3-4-5",
    "true", "true", "true", "true", "true", "true",
    "RangeError", "RangeError", "RangeError", "TypeError", "TypeError", "TypeError",
    "RangeError", "true true 1970-01-01T00:00:00.000Z true 1970", "0:0", "",
  ].join("\n"));

  const invalidClocks = executeModule(`Date.now = () => NaN;
globalThis.performance = { now: () => Infinity };
${source}
for (const operation of [() => now(), () => iso(), () => monotonic()]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(invalidClocks.status, 0, String(invalidClocks.stderr));
  assert.equal(invalidClocks.stdout, "TypeError\nTypeError\nTypeError\n");

  const invalidIntl = executeModule(`let timeCoercions = 0;
let timeGetterReads = 0;
Intl.DateTimeFormat = class {
  get format() { return () => ({ toString() { timeCoercions += 1; return "unsafe"; } }); }
  formatToParts() {
    const part = { type: "year" };
    Object.defineProperty(part, "value", { enumerable: true, get() { timeGetterReads += 1; return "2024"; } });
    return [part];
  }
};
${source}
try { format(0); console.log("accepted"); } catch (error) { console.log(error.name); }
try { parts(0, "UTC"); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(timeCoercions + ":" + timeGetterReads);
`);
  assert.equal(invalidIntl.status, 0, String(invalidIntl.stderr));
  assert.equal(invalidIntl.stdout, "TypeError\nTypeError\n0:0\n");

  const changingParts = executeModule(`let timePartLengthReads = 0;
const validTimeParts = [
  { type: "year", value: "1970" }, { type: "month", value: "1" }, { type: "day", value: "1" }, { type: "weekday", value: "Thu" },
  { type: "hour", value: "0" }, { type: "minute", value: "0" }, { type: "second", value: "0" }, { type: "era", value: "AD" },
];
Intl.DateTimeFormat = class {
  get format() { return () => "valid"; }
  formatToParts() { return new Proxy(validTimeParts, { get(target, key, receiver) { if (key === "length") { timePartLengthReads += 1; return timePartLengthReads === 1 ? target.length : 100; } return Reflect.get(target, key, receiver); } }); }
};
${source}
console.log(parts(0, "UTC").year, timePartLengthReads);
`);
  assert.equal(changingParts.status, 0, String(changingParts.stderr));
  assert.equal(changingParts.stdout, "1970 1\n");
});
