import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { executeModule } from "../support/execute-module.ts";
import { compile } from "../support/compiler-suite.ts";

test("runtime List validation rejects sparse and extended JavaScript arrays", () => {
  const result = compile(`
type Numbers = List<number>

def acceptsNumbers(value: unknown) -> bool:
    return value is Numbers

print(acceptsNumbers([1, 2]))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const sparse = []; sparse.length = 1;
const extended = [1]; extended.label = "hidden";
const frozen = Object.freeze([1, 2]);
console.log(acceptsNumbers(sparse));
console.log(acceptsNumbers(extended));
console.log(acceptsNumbers(frozen));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\nfalse\n");
});

test("runtime collection types iterate Maps and Sets without copying or invoking overrides", () => {
  const result = compile(`
type Numbers = Set<number>
type Lookup = Map<string, number>
type Sequence = List<number>
type Row = Record<number>

def acceptsNumbers(value: unknown) -> bool:
    return value is Numbers

def acceptsLookup(value: unknown) -> bool:
    return value is Lookup

def acceptsSequence(value: unknown) -> bool:
    return value is Sequence

def acceptsRow(value: unknown) -> bool:
    return value is Row
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
let iteratorCalls = 0;
class HostileSet extends Set {
  values() { iteratorCalls += 1; return super.values(); }
  [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); }
}
class HostileMap extends Map {
  entries() { iteratorCalls += 1; return super.entries(); }
  [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); }
}
console.log(acceptsNumbers(new HostileSet([1, 2])));
console.log(acceptsLookup(new HostileMap([["value", 1]])));
console.log(iteratorCalls);

const stableSet = new HostileSet([1, 2]);
const stableMap = new HostileMap([["value", 1]]);
const stableList = [1, 2];
const stableRecord = {value: 1};
const OriginalTypeError = TypeError;
const originalDefineProperty = Object.defineProperty;
const setIteratorPrototype = Object.getPrototypeOf(Set.prototype.values.call(new Set()));
const mapIteratorPrototype = Object.getPrototypeOf(Map.prototype.entries.call(new Map()));
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned collection host"); };
for (const [owner, name] of [
  [Array, "isArray"],
  [Object, "getOwnPropertyDescriptor"], [Object, "getOwnPropertyNames"], [Object, "getOwnPropertySymbols"], [Object, "getPrototypeOf"],
  [Reflect, "apply"], [Reflect, "ownKeys"],
  [Map.prototype, "entries"], [Set.prototype, "values"],
  [mapIteratorPrototype, "next"], [setIteratorPrototype, "next"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
originalDefineProperty(Map.prototype, "size", { configurable: true, get: poison });
originalDefineProperty(Set.prototype, "size", { configurable: true, get: poison });
globalThis.Array = class PoisonedArray {};
globalThis.Map = class PoisonedMap {};
globalThis.Set = class PoisonedSet {};
globalThis.Object = class PoisonedObject {};
globalThis.Reflect = {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
console.log(acceptsNumbers(stableSet), acceptsLookup(stableMap), acceptsSequence(stableList), acceptsRow(stableRecord), poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n0\ntrue true true true 0\n");
});

test("List construction and receiver helpers retain their initialization-owned host ABI", () => {
  const result = compile(`
const seed = ["1"]
seed.append("2")
const seedFirst = seed[0]
seed[0] = seedFirst
print(seed.join(","))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const OriginalArray = Array;
const OriginalObject = Object;
const OriginalNumber = Number;
const OriginalMath = Math;
const OriginalReflect = Reflect;
const OriginalSymbol = Symbol;
const OriginalTypeError = TypeError;
const OriginalRangeError = RangeError;
const originalDefineProperty = Object.defineProperty;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned List host"); };
for (const [owner, name] of [
  [Array, "isArray"], [Array.prototype, "push"], [Array.prototype, "map"],
  [Array.prototype, "values"], [Array.prototype, "join"], [Array.prototype, "sort"], [Array.prototype, "reverse"],
  [Object, "getOwnPropertyDescriptor"], [Object, "getOwnPropertyNames"], [Object, "getOwnPropertySymbols"],
  [Object, "defineProperty"], [Object, "is"],
  [Number, "isInteger"], [Number, "isNaN"], [Number, "isFinite"],
  [Math, "max"], [Math, "min"], [Reflect, "apply"], [Symbol, "for"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
globalThis.Array = class PoisonedArray {};
globalThis.Object = class PoisonedObject {};
globalThis.Number = class PoisonedNumber {};
globalThis.Math = {};
globalThis.Reflect = {};
globalThis.Symbol = class PoisonedSymbol {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalRangeError {};

const target = [3, 1, 2];
__velarListAppend(target, 4);
__velarListExtend(target, [5, 6]);
__velarListInsert(target, 1, 0);
const popped = __velarListPop(target);
const removed = __velarListRemove(target, 3);
const copied = __velarListCopy(target);
const count = __velarListCount(target, 4);
const found = __velarListFind(target, value => value > 1);
const index = __velarListIndex(target, 4);
const some = __velarListSome(target, value => value === 5);
const every = __velarListEvery(target, value => value >= 0);
const mapped = __velarListMap(target, value => value * 2);
const filtered = __velarListFilter(mapped, value => value > 2);
const reduced = __velarListReduce(target, (sum, value) => sum + value, 0);
const joined = __velarListJoin(["a", "b"], ",");
const sorted = __velarListSorted(target);
const selected = __velarListSorted(target, null, value => -value);
const reversed = __velarListReversed(target);
const sum = __velarListSum(target);
const minimum = __velarListMin(target);
const maximum = __velarListMax(target);
const sliced = __velarCollectionSlice(target, 1, 3);
const indexed = __velarIndex(target, 0);
const assigned = __velarSetIndex(target, 0, 9);
const last = __velarCollectionGet(target, -1);
const missing = __velarCollectionGet(target, 100);
const present = __velarCollectionHas(target, 4);
const size = __velarCollectionSize(target);
const constructed = __velarCreateList([[false, () => 7], [true, () => [8, 9]]]);
const asynchronous = await __velarCreateListAsync([[false, false, () => 10], [true, true, async () => [11]]]);
const iterator = __velarCollectionIterator(target);
const first = iterator.next().value;
const predicateFailure = (() => { try { __velarListSome(target, () => 1); return null; } catch (error) { return error; } })();
const rangeFailure = (() => { try { __velarListInsert(target, -1, 0); return null; } catch (error) { return error; } })();
const indexFailure = (() => { try { __velarIndex(target, 100); return null; } catch (error) { return error; } })();
__velarCollectionClear(copied);

console.log(popped, removed, count, found, index, some, every, reduced, joined);
const listText = value => __velarListJoin(__velarListMap(value, item => "" + item), ":");
console.log(listText(mapped), listText(filtered));
console.log(sorted[0], selected[0], reversed[0], sum, minimum, maximum);
console.log(listText(sliced), indexed, assigned, last, missing === null, present, size, copied.length);
console.log(listText(constructed), listText(asynchronous), first);
console.log(predicateFailure instanceof OriginalTypeError, rangeFailure instanceof OriginalRangeError, indexFailure instanceof OriginalRangeError, poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "1,2",
    "6 true 1 2 3 true true 12 a,b",
    "0:2:4:8:10 4:8:10",
    "0 5 5 12 0 5",
    "1:2 0 9 5 true true 5 0",
    "7:8:9 10:11 9",
    "true true true 0",
    "",
  ].join("\n"));
});

test("Set and Map construction, traversal, and receiver helpers retain their initialization-owned host ABI", () => {
  const result = compile(`
let tags = Set(["seed"])
tags.add("next")
tags.update(["third"])
const tagCopy = tags.copy()
for tag in tags:
    const current = tag

let scores: Map<string, number> = Map()
scores.set("seed", 1)
const more = Map([["next", 2]])
scores.update(more)
const scoreCopy = scores.copy()
for key, value in scores:
    const current = value
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const hardened = (result.code ?? "").replaceAll("1000000", "3");
  const execution = executeModule(`${hardened}
const OriginalArray = Array;
const OriginalMap = Map;
const OriginalSet = Set;
const OriginalObject = Object;
const OriginalReflect = Reflect;
const OriginalTypeError = TypeError;
const OriginalRangeError = RangeError;
const originalDefineProperty = Object.defineProperty;
const originalIsFrozen = Object.isFrozen;
const mapIteratorPrototype = Object.getPrototypeOf(Map.prototype.entries.call(new Map()));
const setIteratorPrototype = Object.getPrototypeOf(Set.prototype.values.call(new Set()));
const targetSet = new Set(["a"]);
const updateSet = new Set(["c"]);
const oversizedSet = new Set([1, 2, 3, 4]);
const targetMap = new Map([["a", 1]]);
const updateMap = new Map([["c", 3]]);
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned Set/Map host"); };
for (const [owner, name] of [
  [Array, "isArray"],
  [Object, "getOwnPropertyDescriptor"], [Object, "getOwnPropertyNames"], [Object, "getOwnPropertySymbols"], [Object, "getPrototypeOf"], [Object, "freeze"],
  [Reflect, "apply"],
  [Set.prototype, "add"], [Set.prototype, "has"], [Set.prototype, "delete"], [Set.prototype, "clear"], [Set.prototype, "values"], [Set.prototype, Symbol.iterator],
  [Map.prototype, "get"], [Map.prototype, "set"], [Map.prototype, "has"], [Map.prototype, "delete"], [Map.prototype, "clear"],
  [Map.prototype, "keys"], [Map.prototype, "values"], [Map.prototype, "entries"], [Map.prototype, Symbol.iterator],
  [mapIteratorPrototype, "next"], [setIteratorPrototype, "next"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
originalDefineProperty(Map.prototype, "size", { configurable: true, get: poison });
originalDefineProperty(Set.prototype, "size", { configurable: true, get: poison });
globalThis.Array = class PoisonedArray {};
globalThis.Map = class PoisonedMap {};
globalThis.Set = class PoisonedSet {};
globalThis.Object = class PoisonedObject {};
globalThis.Reflect = {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalRangeError {};

const emptySet = __velarCreateSet();
const listSet = __velarCreateSet(["x", "y"]);
const copiedSet = __velarCreateSet(targetSet);
const emptyMap = __velarCreateMap();
const listMap = __velarCreateMap([["x", 7]]);
const recordMap = __velarCreateMap({y: 8});
const copiedMap = __velarCreateMap(targetMap);

__velarSetAdd(targetSet, "b");
__velarSetUpdate(targetSet, ["c", "b"]);
__velarSetUpdate(targetSet, updateSet);
const setCopy = __velarSetCopy(targetSet);
const setHas = __velarCollectionHas(targetSet, "b");
const setValues = __velarCollectionValues(targetSet);
const setIterator = __velarCollectionIterator(targetSet);
const firstSetValue = setIterator.next().value;
const setRemoved = __velarCollectionRemove(targetSet, "a");

__velarMapSet(targetMap, "b", 2);
__velarMapUpdate(targetMap, updateMap);
const mapCopy = __velarMapCopy(targetMap);
const mapValue = __velarCollectionGet(targetMap, "b");
const mapHas = __velarCollectionHas(targetMap, "c");
const mapKeys = __velarCollectionKeys(targetMap);
const mapValues = __velarCollectionValues(targetMap);
const mapEntries = __velarCollectionEntries(targetMap);
const mapIterator = __velarCollectionIterator(targetMap);
const firstMapKey = mapIterator.next().value;
const pairIterator = __velarCollectionPairIterator(targetMap);
const firstPair = pairIterator.next().value;
const mapRemoved = __velarCollectionRemove(targetMap, "a");

const typeFailure = (() => { try { __velarSetUpdate(targetSet, {}); return null; } catch (error) { return error; } })();
const rangeFailure = (() => { try { __velarSetCopy(oversizedSet); return null; } catch (error) { return error; } })();
__velarCollectionClear(setCopy);
__velarCollectionClear(mapCopy);

console.log(__velarCollectionSize(emptySet), __velarCollectionSize(listSet), __velarCollectionSize(copiedSet));
console.log(__velarCollectionSize(emptyMap), __velarCollectionGet(listMap, "x"), __velarCollectionGet(recordMap, "y"), __velarCollectionGet(copiedMap, "a"));
console.log(__velarCollectionSize(targetSet), setHas, setValues[0], setValues[1], setValues[2], firstSetValue, setRemoved, __velarCollectionSize(setCopy));
console.log(__velarCollectionSize(targetMap), mapValue, mapHas, mapKeys[0], mapKeys[1], mapKeys[2], mapValues[0], mapValues[1], mapValues[2]);
console.log(mapEntries[0].key, mapEntries[0].value, originalIsFrozen(mapEntries[0]), firstMapKey, firstPair[0], firstPair[1], mapRemoved, __velarCollectionSize(mapCopy));
console.log(typeFailure instanceof OriginalTypeError, rangeFailure instanceof OriginalRangeError, poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "0 2 1",
    "0 7 8 1",
    "2 true a b c a true 0",
    "2 2 true a b c 1 2 3",
    "a 1 true a a 1 true 0",
    "true true 0",
    "",
  ].join("\n"));
});

test("Record indexing, traversal, and receiver helpers retain their initialization-owned host ABI", () => {
  const result = compile(`
let row: Record<number> = {a: 1}
const first = row["a"]
row["a"] = 1
row.set("b", 2)
const rowCopy = row.copy()
for key in row:
    const current = key
for key, value in row:
    const current = value
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const hardened = (result.code ?? "").replaceAll("1000000", "3");
  const execution = executeModule(`${hardened}
const OriginalArray = Array;
const OriginalObject = Object;
const OriginalReflect = Reflect;
const OriginalTypeError = TypeError;
const OriginalRangeError = RangeError;
const originalDefineProperty = Object.defineProperty;
const originalIsFrozen = Object.isFrozen;
const record = {a: 1, b: 2};
const oversized = {a: 1, b: 2, c: 3, d: 4};
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned Record host"); };
for (const [owner, name] of [
  [Array, "isArray"], [Array.prototype, "values"], [Array.prototype, "map"], [Array.prototype, "push"],
  [Object, "getOwnPropertyDescriptor"], [Object, "getOwnPropertyNames"], [Object, "getOwnPropertySymbols"],
  [Object, "getPrototypeOf"], [Object, "defineProperty"], [Object, "is"], [Object, "freeze"],
  [Reflect, "apply"], [Reflect, "deleteProperty"],
]) originalDefineProperty(owner, name, { configurable: true, writable: true, value: poison });
globalThis.Array = class PoisonedArray {};
globalThis.Object = class PoisonedObject {};
globalThis.Reflect = {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalRangeError {};

const initialSize = __velarCollectionSize(record);
const initial = __velarCollectionGet(record, "a");
const missing = __velarCollectionGet(record, "missing");
const indexed = __velarIndex(record, "a");
const assigned = __velarSetIndex(record, "a", 3);
__velarRecordSet(record, "c", 4);
const copied = __velarRecordCopy(record);
const has = __velarCollectionHas(record, "b");
const contains = __velarContains("a", record);
const keys = __velarCollectionKeys(record);
const values = __velarCollectionValues(record);
const entries = __velarCollectionEntries(record);
const iterator = __velarCollectionIterator(record);
const firstKey = iterator.next().value;
const pairs = __velarCollectionPairIterator(record);
const firstPair = pairs.next().value;
const removed = __velarCollectionRemove(record, "b");
const typeFailure = (() => { try { __velarRecordSet(record, 1, 1); return null; } catch (error) { return error; } })();
const rangeFailure = (() => { try { __velarRecordCopy(oversized); return null; } catch (error) { return error; } })();
__velarCollectionClear(copied);

console.log(initialSize, initial, missing === null, indexed, assigned, __velarCollectionSize(record));
console.log(has, contains, keys[0], keys[1], keys[2], values[0], values[1], values[2]);
console.log(entries[0].key, entries[0].value, originalIsFrozen(entries[0]), firstKey, firstPair[0], firstPair[1]);
console.log(removed, __velarCollectionSize(record), __velarCollectionSize(copied));
console.log(typeFailure instanceof OriginalTypeError, rangeFailure instanceof OriginalRangeError, poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "2 1 true 1 3 2",
    "true true a b c 3 2 4",
    "a 3 true a a 3",
    "true 2 0",
    "true true 0",
    "",
  ].join("\n"));
});

test("language collection construction and mutation preserve the one-million-item invariant", () => {
  const result = compile(`
const values = [1]
const spread = [...values, 2]
values.append(2)
values.extend([3])
const selected = Set(values)
selected.add(3)
const lookup: Map<string, number> = Map()
lookup.set("value", 1)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateList/u);
  assert.match(result.code ?? "", /__velarListAppend/u);
  assert.match(result.code ?? "", /__velarListExtend/u);
  assert.match(result.code ?? "", /__velarCreateSet/u);
  assert.match(result.code ?? "", /__velarCreateMap/u);
  const hardened = (result.code ?? "").replaceAll("1000000", "3");
  const execution = executeModule(`${hardened}
let effects = 0;
let iteratorCalls = 0;
let getterReads = 0;
class HostileSet extends Set { values() { iteratorCalls += 1; return super.values(); } [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); } }
class HostileMap extends Map { entries() { iteratorCalls += 1; return super.entries(); } [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); } }
console.log(__velarCreateSet(new HostileSet([1])).size, __velarCreateMap(new HostileMap([["a", 1]])).size, iteratorCalls);
const extended = [1]; __velarListExtend(extended, [2, 3]); console.log(extended.join(":"));
const selfExtended = [1]; __velarListExtend(selfExtended, selfExtended); console.log(selfExtended.join(":"));
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, get() { getterReads += 1; return 1; } });
accessor.length = 1;
const failures = [];
const atomic = [1, 2];
for (const operation of [
  () => __velarListAppend([1, 2, 3], 4),
  () => __velarListExtend(atomic, [3, 4]),
  () => __velarListExtend([], accessor),
  () => __velarCreateList([[true, () => [1, 2, 3]], [false, () => { effects += 1; return 4; }]]),
  () => { const value = __velarCreateSet([1, 2, 3]); __velarSetAdd(value, 3); __velarSetAdd(value, 4); },
  () => { const value = __velarCreateMap(); __velarMapSet(value, "a", 1); __velarMapSet(value, "b", 2); __velarMapSet(value, "c", 3); __velarMapSet(value, "a", 4); __velarMapSet(value, "d", 4); },
  () => __velarCreateSet(accessor),
]) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(atomic.join(":") + ":" + effects + ":" + getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1 1 0\n1:2:3\n1:1\nRangeError,RangeError,TypeError,RangeError,RangeError,RangeError,TypeError\n1:2:0:0\n");
});
