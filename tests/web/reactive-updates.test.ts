import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("the shared runtime preserves proxy identity across Web bundles and skips host-shaped values", async () => {
  const first = compile("state first = 1\n");
  const second = compile("state second = 2\n");
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(second.diagnostics, []);
  const directory = await makeTemporaryDirectory("velar-reactive-bundles-");
  const firstPath = join(directory, "first.mjs");
  const secondPath = join(directory, "second.mjs");
  const mainPath = join(directory, "main.mjs");
  await writeFile(firstPath, first.code ?? "", "utf8");
  await writeFile(secondPath, second.code ?? "", "utf8");
  await writeFile(mainPath, `
await import(${JSON.stringify(pathToFileURL(firstPath).href)});
const key = Symbol.for("velar.runtime.v1");
const firstRuntime = globalThis[key];
const raw = {nested: {value: 1}};
const proxy = firstRuntime.reactive(raw);
const descriptorChild = Object.getOwnPropertyDescriptor(proxy, "nested").value;
await import(${JSON.stringify(pathToFileURL(secondPath).href)});
const secondRuntime = globalThis[key];
class HostValue {}
const frozen = Object.freeze({value: 1});
const sealed = Object.preventExtensions({value: 1});
const list = [];
const map = new Map();
const set = new Set();
const fn = () => null;
console.log(JSON.stringify({
  runtime: firstRuntime === secondRuntime,
  proxy: proxy !== raw && secondRuntime.reactive(raw) === proxy && secondRuntime.toRaw(proxy) === raw,
  descriptor: descriptorChild === raw.nested,
  skipped: secondRuntime.reactive(new HostValue()) instanceof HostValue
    && secondRuntime.reactive(frozen) === frozen
    && secondRuntime.reactive(sealed) === sealed
    && secondRuntime.reactive(list) === list
    && secondRuntime.reactive(map) === map
    && secondRuntime.reactive(set) === set
    && secondRuntime.reactive(fn) === fn,
}));
`.trimStart(), "utf8");
  const execution = spawnSync(process.execPath, [mainPath], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(execution.stdout), { runtime: true, proxy: true, descriptor: true, skipped: true });
});

test("reactivity retains captured collection and object operations after module initialization", () => {
  // `recordTotal` runs after the ambient natives are poisoned, so its body is
  // the late half of the test: declaring a `computed` there builds a cache
  // (Object.freeze on the accessor) and appending to a state list drives the
  // collection operations, both with every global already replaced.
  const result = compile(`
type Model:
    value: number

state count = 0
state model: Model = {value: 0}
state history: List<number> = []
computed total = count + model.value

export def recordTotal() -> number:
    computed snapshot = count + model.value
    history.append(snapshot)
    return history[history.size - 1]

watch total as current, previous:
    print("total:" + str(current))

export async def exercise():
    count = 1
    model.value = 2
    await tick()
    print("fresh:" + str(total))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}

const NativeSet = globalThis.Set;
const NativeMap = globalThis.Map;
const NativeWeakSet = globalThis.WeakSet;
const NativeWeakMap = globalThis.WeakMap;
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const fail = (name) => () => { throw new Error("ambient " + name + " was used"); };
globalThis.Set = fail("Set constructor");
globalThis.Map = fail("Map constructor");
globalThis.WeakSet = fail("WeakSet constructor");
globalThis.WeakMap = fail("WeakMap constructor");
globalThis.Array = fail("Array constructor");
globalThis.Object = fail("Object constructor");
globalThis.Proxy = fail("Proxy constructor");
NativeSet.prototype.has = fail("Set.has");
NativeSet.prototype.add = fail("Set.add");
NativeSet.prototype.delete = fail("Set.delete");
NativeSet.prototype.clear = fail("Set.clear");
NativeSet.prototype.values = fail("Set.values");
NativeMap.prototype.has = fail("Map.has");
NativeMap.prototype.get = fail("Map.get");
NativeMap.prototype.set = fail("Map.set");
NativeMap.prototype.delete = fail("Map.delete");
NativeMap.prototype.values = fail("Map.values");
NativeMap.prototype.keys = fail("Map.keys");
NativeWeakSet.prototype.has = fail("WeakSet.has");
NativeWeakSet.prototype.add = fail("WeakSet.add");
NativeWeakSet.prototype.delete = fail("WeakSet.delete");
NativeWeakMap.prototype.has = fail("WeakMap.has");
NativeWeakMap.prototype.get = fail("WeakMap.get");
NativeWeakMap.prototype.set = fail("WeakMap.set");
NativeWeakMap.prototype.delete = fail("WeakMap.delete");
NativeArray.isArray = fail("Array.isArray");
NativeObject.is = fail("Object.is");
NativeObject.freeze = fail("Object.freeze");
NativeReflect.get = fail("Reflect.get");
NativeReflect.set = fail("Reflect.set");
NativeReflect.has = fail("Reflect.has");
NativeReflect.deleteProperty = fail("Reflect.deleteProperty");
globalThis.Reflect = fail("Reflect object");
await exercise();
console.log("late:" + recordTotal());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "total:3\nfresh:3\nlate:3\n");
});

test("state snapshots, writable cells, and computed queries remain distinct", () => {
  const result = compile(`
type Task:
    label: string

state tasks: List<Task> = [{label: "first"}, {label: "second"}]
const snapshot = tasks[0]
state selected = tasks[0]
computed liveFirst = tasks[0]
state price = 2
state quantity = 3
state capturedTotal = price * quantity
state $updates = 0

export async def exercise():
    tasks.insert(0, {label: "new"})
    price = 4
    $updates += 1
    await tick()
    print(snapshot.label + ":" + selected.label + ":" + liveFirst.label + ":" + str(capturedTotal) + ":" + str($updates))
    selected = tasks[1]
    print(selected.label + ":" + liveFirst.label)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const \$updates = __velarState\(0, "\$updates"\)/u);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:first:new:6:1\nfirst:new\n");

  const hydratedState = compile(`
type Model:
    value: number

const seed: Model = {value: 0}
state model = seed
`.trimStart());
  assert.deepEqual(hydratedState.diagnostics, []);

  const rebuiltState = compile(`
type Model:
    value: number

type Wrapper:
    model: Model

state model: Model = {value: 0}
const wrapper: Wrapper = {model: {value: 1}}
model = wrapper.model
`.trimStart());
  assert.deepEqual(rebuiltState.diagnostics, []);

  const primitiveSnapshot = compile("const seed = {value: 1}\nstate count = seed.value\n");
  assert.deepEqual(primitiveSnapshot.diagnostics, []);

  const conventionOnly = compile("const $value = 1\nconst value = $value + 1\n");
  assert.deepEqual(conventionOnly.diagnostics, []);
  assert.doesNotMatch(conventionOnly.code ?? "", /\$value\.get\(\)/u);
});

test("computed suppresses equal results and switches dynamic dependencies", () => {
  const result = compile(`
state useLeft = true
state left = 1
state right = 10

def selectValue() -> number:
    print("derive:" + str(useLeft ? left : right))
    return useLeft ? left % 2 : right % 2

computed selected = selectValue()

watch selected as current, previous:
    print("watch:" + str(current))

export async def exercise():
    left = 3
    await tick()
    useLeft = false
    await tick()
    left = 5
    await tick()
    right = 11
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:1",
    "derive:3",
    "derive:10",
    "watch:0",
    "derive:11",
    "watch:1",
    "",
  ].join("\n"));
});

test("a synchronous computed read before flush still publishes a changed result", () => {
  const result = compile(`
state count = 1
computed parity = count % 2

watch parity as current, previous:
    print("watch:" + str(current))

export async def exercise():
    count = 2
    print("sync:" + str(parity))
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "sync:0\nwatch:0\n");
});

test("computed invalidation reaches a synchronously read downstream computed", () => {
  const result = compile(`
state items: List<number> = []
state page = 2
computed count = items.size
computed pages = count > 1 ? count : 1

watch pages as current, previous:
    print("watch:" + str(current))

export async def exercise():
    items = [1, 2]
    page = page < pages ? page : pages
    print("sync:" + str(page))
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "sync:2\nwatch:2\n");
});

test("computed failures recover through downstream caches and disposed consumers detach", () => {
  const result = compile(`
state shouldFail = false
state count = 1

def derive() -> number:
    print("derive:" + str(count))
    if shouldFail:
        throw Error("derived failed")
    return count

computed base = derive()
computed doubled = base * 2

watch doubled as current, previous:
    print("watch:" + str(current))

export async def exercise():
    shouldFail = true
    await tick()
    shouldFail = false
    await tick()
    print("recovered:" + str(doubled))
    count = 2
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
__velarRuntime.errorHandlers.add((report) => console.log("error:" + report.phase + ":" + report.error.message));
await exercise();

let ownedReads = 0;
const ownedCell = __velarState(1);
const owned = __velarRuntime.computed(() => { ownedReads += 1; return ownedCell.get() * 2; });
const ownedScope = __velarScope("OwnedProbe");
__velarObserver(() => owned(), "watch", ownedScope);
console.log("owned:" + ownedReads);
__velarDestroyScope(ownedScope);
ownedCell.set(2);
await __velarTick();
console.log("detached:" + ownedReads);
console.log("direct:" + owned() + ":" + ownedReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:1",
    "derive:1",
    "error:watch:derived failed",
    "derive:1",
    "recovered:2",
    "derive:2",
    "watch:4",
    "owned:1",
    "detached:1",
    "direct:4:2",
    "",
  ].join("\n"));
});

test("dynamic reactive keys release empty dependency slots", () => {
  const result = compile(`
export state active = "a"
export state scores: Map<string, number> = Map([["a", 1], ["b", 2]])
computed selected = scores.get(active)

watch selected as current, previous:
    print(str(current))

export async def switchKey():
    active = "b"
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const rawScores = __velarRuntime.toRaw(scores.get());
const initialByKey = __velarGraphWeakMapRead(__velarRuntime.dependencies, rawScores);
console.log("slots:" + __velarGraphMapCount(initialByKey));
await switchKey();
const nextByKey = __velarGraphWeakMapRead(__velarRuntime.dependencies, rawScores);
console.log("slots:" + __velarGraphMapCount(nextByKey));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "slots:1\n2\nslots:1\n");
});

test("collection invalidation distinguishes shifted indexes from Map key structure", () => {
  const result = compile(`
state items: List<number> = [10, 20, 30]
state lookup: Map<string, number> = Map([["a", 1]])

def readSecond() -> number:
    print("derive:index")
    return items[1]

def readKeys() -> string:
    print("derive:keys")
    return lookup.keys().join(",")

computed second = readSecond()
computed keys = readKeys()

watch second as current, previous:
    print("second:" + str(current))

watch keys as current, previous:
    print("keys:" + current)

export async def exercise():
    items.insert(0, 5)
    lookup.set("a", 2)
    await tick()
    lookup.set("b", 3)
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:index",
    "derive:keys",
    "derive:index",
    "second:10",
    "derive:keys",
    "keys:a,b",
    "",
  ].join("\n"));
});

test("clearing keyed collections invalidates every tracked key", () => {
  const result = compile(`
state lookup: Map<string, number> = Map([["a", 1]])
state selected: Set<string> = Set(["a"])
state fields: Record<number> = {a: 1}

computed mapValue = lookup.get("a")
computed hasValue = "a" in selected
computed recordValue = fields.get("a")

watch mapValue as current, previous:
    print("map:" + str(current))

watch hasValue as current, previous:
    print("set:" + str(current))

watch recordValue as current, previous:
    print("record:" + str(current))

export async def exercise():
    lookup.clear()
    selected.clear()
    fields.clear()
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "map:null\nset:false\nrecord:null\n");
});

test("state replacement releases the previous deep parent graph", () => {
  const result = compile(`
type Model:
    value: number

export state model: Model = {value: 1}

export def replace():
    model = {value: 2}
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const previous = __velarRuntime.toRaw(model.get());
console.log(__velarGraphWeakMapRead(__velarRuntime.parents, previous) == null ? "detached" : "attached");
replace();
console.log(__velarGraphWeakMapRead(__velarRuntime.parents, previous) == null ? "detached" : "attached");
const current = __velarRuntime.toRaw(model.get());
console.log(__velarGraphWeakMapRead(__velarRuntime.parents, current) == null ? "detached" : "attached");
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "attached\ndetached\nattached\n");
});

test("reactive module imports lower reads and reject ambiguous access", async () => {
  const directory = await makeTemporaryDirectory("velar-reactive-modules-");
  const storePath = join(directory, "store.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(storePath, `
export state count = 0
export computed doubled = count * 2
export def increment():
    count += 1
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {count, doubled, increment} from "./store.vel"

component App:
    return <button on:click={increment}>{count} / {doubled}</button>
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.match(main.result.code ?? "", /count\.get\(\)/);
  assert.match(main.result.code ?? "", /doubled\.get\(\)/);

  await writeFile(mainPath, "import * as store from \"./store.vel\"\nprint(store.count)\n", "utf8");
  const namespace = await compileProject(mainPath);
  assert.ok(namespace.failures.some((failure) => /import them by name/.test(failure.message)));

  await writeFile(mainPath, "import {count} from \"./store.vel\"\ncount = 2\n", "utf8");
  const assignment = await compileProject(mainPath);
  assert.ok(assignment.modules.some((module) => module.inputPath === mainPath
    && module.result.diagnostics.some((diagnostic) => diagnostic.code === "VEL3002")));
});
