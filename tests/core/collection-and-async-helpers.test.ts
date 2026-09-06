import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { standardModuleWithDependencies } from "../support/standard-module-inline.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compileProject, standardModuleSource, emittedCollectionRuntime, linkedStandardModuleSource } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("collection ordering, predicates, equality, and List boundaries follow VelarScript semantics", async () => {
  const execution = executeModule(`${emittedCollectionRuntime()}
const values = [{ id: "a", key: 1 }, { id: "b", key: 2 }, { id: "c", key: 2 }, { id: "d", key: 1 }];
console.log(__velarListSorted(values, null, value => value.key).map(value => value.id).join(""));
console.log(__velarListSorted(values, null, value => value.key, true).map(value => value.id).join(""));
console.log(__velarListHas([-0], 0), __velarListCount([-0], 0), __velarListHas([NaN], NaN), __velarListCount([NaN], NaN));
for (const operation of [
  () => __velarListSome([1], () => "yes"),
  () => __velarListPartition([1], () => 1),
  () => __velarListSorted([1, 2], null, value => value === 1 ? "one" : 2),
  () => __velarListSorted([1], null, () => NaN),
  () => __velarListSorted([1], value => 0, null, true),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
const sparse = []; sparse.length = 1;
const extended = [1]; extended.label = "hidden";
const frozen = Object.freeze([1]);
for (const list of [sparse, extended, frozen]) {
  try { __velarCollectionSlice(list, 0, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
}
class HostileList extends Array {
  [Symbol.iterator]() { throw new Error("iterator override"); }
  map() { throw new Error("map override"); }
  slice() { throw new Error("slice override"); }
}
const hostile = new HostileList(1, 2);
for (const operation of [
  () => __velarListZip(hostile, hostile).length,
  () => __velarListChunk(hostile, 1).length,
  () => __velarListPartition(hostile, value => value > 0).matches.length,
  () => __velarListGroupBy(hostile, value => value).size,
  () => __velarListKeyBy(hostile, value => value).size,
  () => __velarListCountBy(hostile, value => value).size,
  () => __velarListUnique(hostile).length,
  () => __velarListRepeat(hostile, 1).length,
  () => __velarListMin(hostile, value => value),
]) console.log(operation());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "adbc", "bcad", "true 1 true 1",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    "TypeError", "TypeError", "TypeError",
    "2", "2", "2", "2", "2", "2", "2", "2", "1", "",
  ].join("\n"));

  const directory = await makeTemporaryDirectory("velar-collection-keys-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
const sorted = [1].sorted(by=value => true)
const lowest = [1].min(by=value => null)
const highest = [1].max(by=value => {label: "one"})
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.deepEqual(invalid.failures, []);
  assert.equal(invalid.modules.flatMap((module) => module.result.diagnostics).filter((item) => /key must return only string or only number/u.test(item.message)).length, 3);
});

test("the emitted collection runtime captures its host operations when the module initializes", () => {
  const execution = executeModule(`${emittedCollectionRuntime()}
const OriginalTypeError = TypeError;
const nativeMapGet = Map.prototype.get;
const nativeIsFrozen = Object.isFrozen;
let poisonedCalls = 0;
const poison = () => { poisonedCalls += 1; throw new Error("late collection host mutation"); };
for (const name of ["join", "sort", "map", "filter", "slice", "reverse", "find", "findIndex", "some", "every", "reduce", "push"]) Array.prototype[name] = poison;
Map.prototype.get = poison;
Map.prototype.set = poison;
Set.prototype.has = poison;
Set.prototype.add = poison;
Number.isFinite = poison;
Number.isNaN = poison;
Number.isSafeInteger = poison;
Math.min = poison;
Math.max = poison;
Math.floor = poison;
Object.freeze = poison;
Object.is = poison;
Object.getOwnPropertyDescriptor = poison;
Object.getOwnPropertyNames = poison;
Object.getOwnPropertySymbols = poison;
Reflect.apply = poison;
globalThis.Array = class PoisonArray {};
globalThis.Map = class PoisonMap {};
globalThis.Set = class PoisonSet {};
globalThis.TypeError = class PoisonTypeError extends Error {};
globalThis.RangeError = class PoisonRangeError extends Error {};

const zipped = __velarListZip([1, 2], ["a"]);
const grouped = __velarListGroupBy([1, 2, 3], value => value % 2);
const keyed = __velarListKeyBy(["a", "bb"], value => value.length);
const counted = __velarListCountBy(["x", "x", "y"], value => value);
console.log(JSON.stringify([
  zipped, __velarListUnique(["a", "a", "b"]),
  __velarListChunk([1, 2, 3], 2), __velarListFlatten([[1], [2, 3]]), __velarListCompact([1, null, 2]),
  __velarListReversed([1, 2, 3]), __velarCollectionSlice([1, 2, 3], 0, 2), __velarCollectionSlice([1, 2, 3], 1),
]));
console.log(__velarListFind([1, 2], value => value === 2), __velarListIndex([-0], 0), __velarListHas([NaN], NaN), __velarListCount([1, 1, 2], 1), __velarListSome([1], value => value === 1), __velarListEvery([1, 2], value => value > 0));
console.log(JSON.stringify(__velarListPartition([1, 2, 3], value => value % 2 === 1)), nativeIsFrozen(zipped[0]));
console.log(JSON.stringify([nativeMapGet.call(grouped, 1), nativeMapGet.call(keyed, 2), nativeMapGet.call(counted, "x")]));
const sorted = __velarListSorted([{ value: "a", key: 2 }, { value: "b", key: 1 }], null, item => item.key);
console.log(JSON.stringify([sorted[0].value, sorted[1].value]));
console.log(__velarListMin([3, 1, 2], value => value), __velarListMax([3, 1, 2], value => value), __velarListSum([1, 2, 3]), __velarListJoin(["a", "b"], "-"), JSON.stringify(__velarListRepeat(["x"], 2)));
try { __velarListSum([1, "2"]); console.log("accepted"); } catch (error) { console.log(error instanceof OriginalTypeError); }
console.log(poisonedCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    '[[{"first":1,"second":"a"}],["a","b"],[[1,2],[3]],[1,2,3],[1,2],[3,2,1],[1,2],[2,3]]',
    "2 0 true 2 true true",
    '{"matches":[1,3],"rest":[2]} true',
    '[[1,3],"bb",2]',
    '["b","a"]',
    '1 3 6 a-b ["x","x"]',
    "true",
    "0",
    "",
  ].join("\n"));
});

test("async and URL helpers reject malformed Lists at dynamic boundaries", () => {
  const asyncSource = standardModuleWithDependencies(standardModuleSource("velar/async") ?? "");
  const asyncExecution = executeModule(`${asyncSource}
const sparse = []; sparse.length = 1;
const extended = [Promise.resolve(1)]; extended.label = "hidden";
for (const [name, callback] of [["all", () => all(sparse)], ["race", () => race(extended)], ["map", () => map(sparse, value => value)], ["series", () => series(extended)]]) {
  try { await callback(); console.log("accepted"); } catch (error) { console.log(name, error.name); }
}
try { await timeout(Promise.resolve(1), "1ms", 42); console.log("accepted"); } catch (error) { console.log("timeout", error.name); }
try { await retry(() => 1, Number.MAX_SAFE_INTEGER + 1); console.log("accepted"); } catch (error) { console.log("retry", error.name); }
let asyncThenReads = 0;
const fakePromise = Object.defineProperty({}, "then", { get() { asyncThenReads += 1; return resolve => resolve(1); } });
for (const [name, callback] of [["all-value", () => all([1])], ["race-thenable", () => race([fakePromise])], ["timeout-value", () => timeout(1, "1ms")]]) {
  try { await callback(); console.log("accepted"); } catch (error) { console.log(name, error.name); }
}
console.log(asyncThenReads);
console.log(
  (await all([Promise.resolve(undefined)]))[0] === null,
  await race([Promise.resolve(undefined)]) === null,
  await timeout(Promise.resolve(undefined), "1ms") === null,
  await retry(async () => undefined) === null,
  (await map([1], () => undefined))[0] === null,
  (await series([() => undefined]))[0] === null,
);
`);
  assert.equal(asyncExecution.status, 0, String(asyncExecution.stderr));
  assert.equal(asyncExecution.stdout, "all TypeError\nrace TypeError\nmap TypeError\nseries TypeError\ntimeout TypeError\nretry RangeError\nall-value TypeError\nrace-thenable TypeError\ntimeout-value TypeError\n0\ntrue true true true true true\n");

  const urlSource = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`${urlSource}
import { runInNewContext } from "node:vm";
const sparse = []; sparse.length = 1;
console.log(join("https://", "example.test", "api", "items"));
console.log(query({ flag: true, page: 2, empty: null, tag: ["a", "b"] }));
const foreignParams = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["page", 3]])');
console.log(query(foreignParams));
for (const operation of [
  () => query({ tag: sparse }),
  () => query({ filter: { active: true } }),
  () => query(new Map([[1, "value"]])),
  () => query({ page: Number.POSITIVE_INFINITY }),
  () => query({ page: Number.NaN }),
  () => parseQuery(42),
  () => encode(42),
  () => withHash("/items", 42),
  () => isExternal(42),
  () => join("/items", 42),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, [
    "https://example.test/api/items",
    "flag=true&page=2&tag=a&tag=b",
    "page=3",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "",
  ].join("\n"));
});

test("async helpers capture their host ABI and never invoke List overrides or magic thenables", () => {
  const asyncSource = standardModuleWithDependencies(standardModuleSource("velar/async") ?? "");
  const execution = executeModule(`${asyncSource}
let listOverrideCalls = 0;
class HostileList extends Array {
  map() { listOverrideCalls += 1; throw new Error("map override"); }
  some() { listOverrideCalls += 1; throw new Error("some override"); }
  [Symbol.iterator]() { listOverrideCalls += 1; throw new Error("iterator override"); }
}
console.log((await all(new HostileList(Promise.resolve(1))))[0]);
console.log(await race(new HostileList(Promise.resolve(2))));
console.log((await map(new HostileList(3, 4), value => value + 1, 2)).join(" "));
console.log((await series(new HostileList(() => 5, () => Promise.resolve(6)))).join(" "));
console.log(listOverrideCalls);

let thenReads = 0;
const fakeThenable = Object.defineProperty({ value: 7 }, "then", {
  get() { thenReads += 1; return resolve => resolve(7); },
});
const mapped = await map([1], () => fakeThenable);
const sequenced = await series([() => fakeThenable]);
console.log(mapped[0] === fakeThenable, sequenced[0] === fakeThenable, thenReads);
try { await retry(() => fakeThenable, 1); console.log("accepted"); }
catch (error) { console.log(error.name, thenReads); }

let poisonedCalls = 0;
const poison = () => { poisonedCalls += 1; throw new Error("late host mutation"); };
const first = Promise.resolve(8);
const second = Promise.resolve(9);
Object.defineProperty(first, "then", { value: poison });
Object.defineProperty(second, "then", { value: poison });
Reflect.apply = poison;
Promise.all = poison;
Promise.race = poison;
Array.isArray = poison;
Object.getOwnPropertyDescriptor = poison;
Object.getOwnPropertyNames = poison;
Object.getOwnPropertySymbols = poison;
Object.getPrototypeOf = poison;
Number.isFinite = poison;
Number.isSafeInteger = poison;
RegExp.prototype.exec = poison;
globalThis.Number = poison;
globalThis.setTimeout = poison;
globalThis.clearTimeout = poison;
console.log((await all([first]))[0]);
console.log(await race([second]));
console.log(await timeout(Promise.resolve(10), "100ms"));
console.log(await retry(() => 11, 1));
console.log((await map([12], value => value + 1, 1))[0]);
console.log((await series([() => 14]))[0]);
console.log(await sleep("0ms") === null, poisonedCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "1", "2", "4 5", "5 6", "0",
    "true true 0", "TypeError 0",
    "8", "9", "10", "11", "13", "14", "true 0", "",
  ].join("\n"));
});

test("URL snapshots and test diagnostics never invoke conversion hooks", () => {
  const urlSource = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`
let coercions = 0;
const hostile = { toString() { coercions += 1; return "https://coerced.test"; } };
globalThis.location = { href: hostile };
${urlSource}
try { parse("/items"); console.log("accepted"); } catch (error) { console.log(error.name); }
const NativeUrl = globalThis.URL;
globalThis.URL = class {
  constructor() {
    this.href = hostile; this.protocol = "https:"; this.host = "example.test"; this.hostname = "example.test";
    this.port = ""; this.pathname = "/"; this.search = ""; this.hash = ""; this.origin = "https://example.test";
  }
};
try { console.log(parse("/items", "https://example.test").href); } catch (error) { console.log(error.name); }
globalThis.URL = NativeUrl;
console.log(coercions);
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, "TypeError\nhttps://example.test/items\n0\n");

  const invalidUrlExecution = executeModule(`
let coercions = 0;
const hostile = { toString() { coercions += 1; return "https://coerced.test"; } };
const NativeUrl = globalThis.URL;
globalThis.URL = class extends NativeUrl { get href() { return hostile; } };
${urlSource}
try { parse("/items", "https://example.test"); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(coercions);
`);
  assert.equal(invalidUrlExecution.status, 0, String(invalidUrlExecution.stderr));
  assert.equal(invalidUrlExecution.stdout, "TypeError\n0\n");

  const capturedUrlExecution = executeModule(`${urlSource}
const NativeUrl = globalThis.URL;
const NativeSearchParams = globalThis.URLSearchParams;
const params = new Map([["page", 3]]);
let poisonedCalls = 0;
const poison = () => { poisonedCalls += 1; throw new Error("late URL host mutation"); };
globalThis.URL = class { constructor() { poison(); } };
globalThis.URLSearchParams = class { constructor() { poison(); } };
globalThis.encodeURIComponent = poison;
globalThis.decodeURIComponent = poison;
Reflect.apply = poison;
Number.isFinite = poison;
Object.freeze = poison;
Object.getOwnPropertyDescriptor = poison;
Object.getOwnPropertyNames = poison;
Object.getOwnPropertySymbols = poison;
Object.getPrototypeOf = poison;
Object.defineProperty(NativeUrl.prototype, "href", { configurable: true, get: poison });
Object.defineProperty(NativeUrl.prototype, "search", { configurable: true, get: poison, set: poison });
NativeSearchParams.prototype.append = poison;
NativeSearchParams.prototype.entries = poison;
NativeSearchParams.prototype.toString = poison;
Map.prototype.set = poison;
Map.prototype.entries = poison;
Object.defineProperty(Map.prototype, "size", { configurable: true, get: poison });
const snapshot = parse("/items?page=2", "https://example.test");
console.log(snapshot.href, snapshot.query.get("page"));
console.log(query(params));
console.log(join("https://", "example.test", "items"));
console.log(withQuery("/items", { page: 4 }), withHash("/items", "done"));
console.log(isExternal("https://other.test", "https://example.test"));
console.log(encode("a b"), decode("a%20b"), poisonedCalls);
`);
  assert.equal(capturedUrlExecution.status, 0, String(capturedUrlExecution.stderr));
  assert.equal(capturedUrlExecution.stdout, [
    "https://example.test/items?page=2 2",
    "page=3",
    "https://example.test/items",
    "/items?page=4 /items#done",
    "true",
    "a%20b a b 0",
    "",
  ].join("\n"));

  const testSource = linkedStandardModuleSource("velar/test");
  const testExecution = executeModule(`${testSource}
let coercions = 0;
let getterReads = 0;
const hostileFunction = function () {};
hostileFunction[Symbol.toPrimitive] = () => { coercions += 1; return "coerced"; };
const Constructor = function () {};
Object.defineProperty(Constructor, "name", { configurable: true, get() { getterReads += 1; return "Hostile"; } });
const prototype = Object.create(null);
Object.defineProperty(prototype, "constructor", { value: Constructor });
const hostileObject = Object.create(prototype);
const large = new Array(100000).fill("x".repeat(1000));
for (const value of [hostileFunction, hostileObject, large]) {
  try { expect(value).toBe(null); console.log("accepted"); }
  catch (error) { console.log(error.message.length < 20000); }
}
const hostileThrown = { toString() { coercions += 1; return "converted"; } };
globalThis.RegExp = class { constructor() { throw hostileThrown; } };
try { expect("Velar").toMatch("Velar"); console.log("accepted"); }
catch (error) { console.log(error.message); }
try { expect("Velar").toMatch("x".repeat(4097)); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(coercions + ":" + getterReads);
`);
  assert.equal(testExecution.status, 0, String(testExecution.stderr));
  assert.equal(testExecution.stdout, "true\ntrue\ntrue\naccepted\nRangeError\n0:0\n");

  const textSource = standardModuleSource("velar/text") ?? "";
  const textExecution = executeModule(`${textSource}
let coercions = 0;
const hostile = { toString() { coercions += 1; return "converted"; } };
globalThis.RegExp = class { constructor() { throw hostile; } };
console.log(matches("Velar", "Velar"));
console.log(coercions);
`);
  assert.equal(textExecution.status, 0, String(textExecution.stderr));
  assert.equal(textExecution.stdout, "true\n0\n");
});
