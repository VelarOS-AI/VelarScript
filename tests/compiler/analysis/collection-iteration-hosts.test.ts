import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("supports reduce callbacks, map key iteration, and friendly core builtins", () => {
  const result = compile(`
const values = [1, 2, 3]
const total = values.reduce((sum, value) => sum + value, 0)
const lookup: Map<string, number> = Map()
lookup.set("first", total)
for key in lookup:
    print(f"{key}:{str(total)}")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /of __velarReactiveMapKeyIterator\(lookup\)/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:6\n");
});

test("Map iterator pulls one live key at a time and keeps null keys distinct from exhaustion", () => {
  const result = compile(`
const lookup: Map<string?, number> = Map([[null, 1], ["removed", 2]])
const cursor = lookup.iterator()
const first = cursor.next()
if first != null:
    print(str(first.value == null))

lookup.remove("removed")
lookup.set("added", 3)
const second = cursor.next()
if second != null:
    print(second.value)
print(str(cursor.next() == null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarMapIterator\(lookup\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nadded\ntrue\n");
});

test("Map iterator captures its host operations before JavaScript prototypes can be replaced", () => {
  const result = compile(`
export def pullKeys() -> string:
    const lookup = Map([["first", 1], ["second", 2]])
    const cursor = lookup.iterator()
    const first = cursor.next()!
    const second = cursor.next()!
    return first.value + ":" + second.value + ":" + str(cursor.next() == null)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  const execution = executeModule(`${result.code ?? ""}
const originalDefineProperty = Object.defineProperty;
const iteratorPrototype = Object.getPrototypeOf(Map.prototype.keys.call(new Map()));
const poison = () => { throw new Error("poisoned Map iterator host"); };
for (const [owner, name] of [
  [Map.prototype, "keys"],
  [iteratorPrototype, "next"],
  [Object, "freeze"],
  [Reflect, "apply"],
]) originalDefineProperty(owner, name, {configurable: true, writable: true, value: poison});
console.log(pullKeys());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:second:true\n");
});

test("collection loops validate boundaries and ignore instance iterator overrides", () => {
  const result = compileCore(`
import js {numbers, tags, lookup} from "fixture"

type ForeignCollections:
    tags: Set<string>
    lookup: Map<string, number>

const checked = ForeignCollections.parse({tags, lookup})
print(checked.tags.size)
print(checked.lookup.size)
print(numbers.size)
print(2 in numbers)
print(numbers[0])
print(numbers.copy().size)
print(numbers.sorted().get(0))
print(numbers.reversed().get(0))
numbers.append(3)
print(numbers.get(2))
print(tags.size)
print("web" in tags)
print(lookup.size)
print("Ada" in lookup)
for value in numbers:
    print(value)
for tag in tags:
    print(tag)
for key in lookup:
    print(key)
for character in "A😀":
    print(character)
`.trimStart(), { analysis: { imports: new Map([
    ["numbers", { kind: "list", element: { kind: "number" } }],
    ["tags", { kind: "set", element: { kind: "string" } }],
    ["lookup", { kind: "map", key: { kind: "string" }, value: { kind: "number" } }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  const boundary = `
import { runInNewContext } from "node:vm";
class HostileList extends Array { static get [Symbol.species]() { throw new Error("list species override"); } set 2(value) { throw new Error("list inherited index setter"); } [Symbol.iterator]() { throw new Error("list override"); } includes() { throw new Error("list includes override"); } }
const numbers = new HostileList(1, 2);
const tags = runInNewContext('class HostileSet extends Set { get size() { throw new Error("set size override") } [Symbol.iterator]() { throw new Error("set override") } values() { throw new Error("set values override") } has() { throw new Error("set has override") } }; new HostileSet(["web"])');
const lookup = runInNewContext('class HostileMap extends Map { get size() { throw new Error("map size override") } [Symbol.iterator]() { throw new Error("map override") } keys() { throw new Error("map keys override") } has() { throw new Error("map has override") } }; new HostileMap([["Ada", 9]])');
`;
  const executable = (result.code ?? "").replace(/^import .*?;\n+/mu, boundary);
  const execution = executeModule(executable);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\n1\n2\ntrue\n1\n2\n1\n2\n3\n1\ntrue\n1\ntrue\n1\n2\n3\nweb\nAda\nA\n😀\n");

  const accessor = compileCore(`
import js {values, reads} from "fixture"
try:
    print(values[0])
catch error:
    print(error.message)
print(reads())
`.trimStart(), { analysis: { imports: new Map([
    ["values", { kind: "list", element: { kind: "number" } }],
    ["reads", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "number" } }],
  ]) } });
  assert.deepEqual(accessor.diagnostics, []);
  const accessorBoundary = `
let readCount = 0;
const values = [];
Object.defineProperty(values, "0", { enumerable: true, get() { readCount += 1; return 1; } });
const reads = () => readCount;
`;
  const accessorExecution = executeModule((accessor.code ?? "").replace(/^import .*?;\n+/mu, accessorBoundary));
  assert.equal(accessorExecution.status, 0, String(accessorExecution.stderr));
  assert.equal(accessorExecution.stdout, "List index requires ordinary mutable List data elements\n0\n");
});

test("List callback operations use a stable checked snapshot", () => {
  const result = compile(`
let values = [1, 2]

def grow(value: number) -> number:
    values.append(9)
    return value

const mapped = values.map(grow)
print(values.size)
print(mapped.size)
print(mapped.get(0))
print(mapped.get(1))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4\n2\n1\n2\n");
});
