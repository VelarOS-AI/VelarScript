import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_COLLECTION_HOST_EXPORTS, VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_LOWERING_DEPENDENCIES, VELAR_COLLECTION_LOWERING_EXPORTS, VELAR_COLLECTION_LOWERING_MODULE, VELAR_REACTIVE_BRIDGE_MODULE } from "@velarscript/compiler/extension";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleClosure, standardModuleDependencies, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";

/**
 * D115 P5 — the shared collection lowering, one subject of the file that was
 * `shared-runtime-validation.test.ts` before it reached 796 lines.
 *
 * What is held here is the line between the lowering a program shares and the
 * collections a program owns: the standalone build inlines the lowering, a
 * project imports it and the host and reactive-bridge modules behind it, an
 * importing module takes only what it uses, and the whole graph still answers
 * correctly under a host whose `Array`, `Map`, `Set` and their iterators have
 * all been replaced. The body below is the body that file had.
 */

after(removeTemporaryDirectories);

test("project compilation shares collection lowering without sharing application collections", async () => {
  const source = `
export def exercise():
    const values = [3, 1]
    values.append(2)
    values[-1] = 2
    print(values[-3])
    print(values.sorted().sum())

    const tags = Set(values)
    tags.add(4)
    print(tags.size)

    const scores = Map({a: 1})
    scores.set("b", 2)
    print(scores.get("b"))
    const scoreCursor = scores.iterator()
    const firstScore = scoreCursor.next() ?? {value: "missing"}
    print(firstScore.value)

    let row: Record<number> = {...{a: 1}}
    row["b"] = 2
    print(row["b"])

export def optionalIndex(values: List<number>?) -> number?:
    return values?.[-1]
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /const __velarCollectionNativeArray = globalThis\.Array/u);
  assert.match(standalone.code ?? "", /class __VelarIndexError extends __velarIndexErrorNativeRangeError/u);
  assert.match(standalone.code ?? "", /function __velarOptionalIndex\(value, index\)/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-collections-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_HOST_MODULE, VELAR_REACTIVE_BRIDGE_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}`));
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}`));
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)}`));
  assert.match(shared.code ?? "", /\b__velarListIndexGet\b/u);
  assert.match(shared.code ?? "", /\b__velarRecordIndexGet\b/u);
  assert.match(shared.code ?? "", /\b__velarListIndexSet\b/u);
  assert.match(shared.code ?? "", /\b__velarRecordIndexSet\b/u);
  assert.match(shared.code ?? "", /\b__velarMapGet\b/u);
  assert.match(shared.code ?? "", /\b__velarMapIterator\b/u);
  assert.match(shared.code ?? "", /\b__velarSetSize\b/u);
  assert.doesNotMatch(shared.code ?? "", /\b__velarIndex\b/u);
  assert.doesNotMatch(shared.code ?? "", /\b__velarSetIndex\b/u);
  assert.doesNotMatch(shared.code ?? "", /\b__velarOptionalIndex\b/u);
  assert.doesNotMatch(shared.code ?? "", /__velarListExtend,/u);
  assert.doesNotMatch(shared.code ?? "", /__velarMapCopy,/u);
  assert.doesNotMatch(shared.code ?? "", /const __velarCollectionNativeArray = globalThis\.Array/u);
  assert.doesNotMatch(shared.code ?? "", /function __velarListAppend/u);
  assert.doesNotMatch(shared.code ?? "", /function __velarMapSet/u);
  assert.doesNotMatch(shared.code ?? "", /function __velarRecordSet/u);
  assert.doesNotMatch(shared.code ?? "", /class __VelarIndexError/u);
  assert.doesNotMatch(shared.code ?? "", /function __velarIndex/u);

  const directory = await makeTemporaryDirectory("velar-shared-collection-host-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, `
export def dependency() -> number:
    const values = [1]
    values.append(2)
    values[0] = 1
    return values[0] + values[1]
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {dependency} from "./dependency.vel"

const values = [3]
values.append(4)
values[0] = 3
print(dependency() + values[0])
`.trimStart(), "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_COLLECTION_LOWERING_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.deepEqual(module.result.runtimeModules, [VELAR_COLLECTION_LOWERING_MODULE]);
    assert.ok(!(module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}`));
    assert.ok(!(module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}`));
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /const __velarCollectionNativeArray = globalThis\.Array/u);
    assert.doesNotMatch(module.result.code ?? "", /function __velarListAppend/u);
    assert.doesNotMatch(module.result.code ?? "", /class __VelarIndexError/u);
    assert.doesNotMatch(module.result.code ?? "", /function __velarIndex/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_COLLECTION_HOST_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_COLLECTION_HOST_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_COLLECTION_HOST_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), [...VELAR_COLLECTION_HOST_EXPORTS].sort());

  const reactiveSource = standardModuleSourceCore(VELAR_REACTIVE_BRIDGE_MODULE);
  assert.ok(reactiveSource);
  const reactiveUrl = `data:text/javascript;base64,${Buffer.from(reactiveSource).toString("base64")}`;
  const loweringSource = standardModuleSourceCore(VELAR_COLLECTION_LOWERING_MODULE);
  assert.ok(loweringSource);
  assert.equal(standardModuleApiCore().modules[VELAR_COLLECTION_LOWERING_MODULE], undefined);
  assert.deepEqual(standardModuleDependencies(VELAR_COLLECTION_LOWERING_MODULE), VELAR_COLLECTION_LOWERING_DEPENDENCIES);
  assert.deepEqual([...standardModuleClosure([VELAR_COLLECTION_LOWERING_MODULE])].sort(), [
    VELAR_COLLECTION_HOST_MODULE,
    VELAR_COLLECTION_LOWERING_MODULE,
    VELAR_REACTIVE_BRIDGE_MODULE,
  ].sort());
  const loweringRoute = `/@velar/${VELAR_COLLECTION_LOWERING_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(loweringRoute), loweringSource);
  const resolvedLoweringSource = loweringSource
    .replace(JSON.stringify(VELAR_COLLECTION_HOST_MODULE), JSON.stringify(runtimeUrl))
    .replace(JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE), JSON.stringify(reactiveUrl));
  const loweringUrl = `data:text/javascript;base64,${Buffer.from(resolvedLoweringSource).toString("base64")}`;
  const loweringNamespace = await import(loweringUrl);
  assert.deepEqual(Object.keys(loweringNamespace).sort(), [...VELAR_COLLECTION_LOWERING_EXPORTS].sort());
  const sharedSource = (shared.code ?? "")
    .replace(JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE), JSON.stringify(loweringUrl))
    .replace(JSON.stringify(VELAR_COLLECTION_HOST_MODULE), JSON.stringify(runtimeUrl))
    .replace(JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE), JSON.stringify(reactiveUrl));
  const hostile = executeModule(`${sharedSource}
const OriginalArray = globalThis.Array;
const OriginalMap = globalThis.Map;
const OriginalSet = globalThis.Set;
const OriginalObject = globalThis.Object;
const OriginalNumber = globalThis.Number;
const OriginalMath = globalThis.Math;
const OriginalReflect = globalThis.Reflect;
const OriginalSymbol = globalThis.Symbol;
const OriginalTypeError = globalThis.TypeError;
const OriginalRangeError = globalThis.RangeError;
const originalDefineProperty = OriginalObject.defineProperty;
const mapIteratorPrototype = OriginalObject.getPrototypeOf(OriginalMap.prototype.entries.call(new OriginalMap()));
const setIteratorPrototype = OriginalObject.getPrototypeOf(OriginalSet.prototype.values.call(new OriginalSet()));
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new OriginalTypeError("poisoned shared collection host"); };
for (const [owner, name] of [
  [OriginalArray, "isArray"], [OriginalArray.prototype, "join"], [OriginalArray.prototype, "sort"], [OriginalArray.prototype, "reverse"],
  [OriginalObject, "getOwnPropertyDescriptor"], [OriginalObject, "getOwnPropertyNames"], [OriginalObject, "getOwnPropertySymbols"],
  [OriginalObject, "getPrototypeOf"], [OriginalObject, "defineProperty"], [OriginalObject, "is"], [OriginalObject, "freeze"],
  [OriginalNumber, "isInteger"], [OriginalNumber, "isNaN"], [OriginalNumber, "isFinite"],
  [OriginalMath, "max"], [OriginalMath, "min"], [OriginalReflect, "apply"], [OriginalReflect, "deleteProperty"], [OriginalSymbol, "for"],
  [OriginalSet.prototype, "add"], [OriginalSet.prototype, "has"], [OriginalSet.prototype, "delete"], [OriginalSet.prototype, "clear"], [OriginalSet.prototype, "values"],
  [OriginalMap.prototype, "get"], [OriginalMap.prototype, "set"], [OriginalMap.prototype, "has"], [OriginalMap.prototype, "delete"], [OriginalMap.prototype, "clear"],
  [OriginalMap.prototype, "keys"], [OriginalMap.prototype, "values"], [OriginalMap.prototype, "entries"],
  [mapIteratorPrototype, "next"], [setIteratorPrototype, "next"],
]) originalDefineProperty(owner, name, {configurable: true, writable: true, value: poison});
originalDefineProperty(OriginalMap.prototype, "size", {configurable: true, get: poison});
originalDefineProperty(OriginalSet.prototype, "size", {configurable: true, get: poison});
globalThis.Array = class PoisonedArray {};
globalThis.Map = class PoisonedMap {};
globalThis.Set = class PoisonedSet {};
globalThis.Object = class PoisonedObject {};
globalThis.Number = class PoisonedNumber {};
globalThis.Math = {};
globalThis.Reflect = {};
globalThis.Symbol = class PoisonedSymbol {};
globalThis.TypeError = class PoisonedTypeError extends OriginalTypeError {};
globalThis.RangeError = class PoisonedRangeError extends OriginalRangeError {};
exercise();
const optional = optionalIndex(null);
const indexed = [1, 2];
__velarListIndexSet(indexed, -1, 8);
const record = {a: 1};
__velarRecordIndexSet(record, "b", 2);
let indexFailure = null;
try { __velarListIndexGet(indexed, 2); } catch (error) { indexFailure = error; }
console.log(__velarListIndexGet(indexed, -1), __velarRecordIndexGet(record, "b"), optional, indexFailure?.name, indexFailure instanceof OriginalRangeError);
OriginalObject.defineProperty;
console.log(poisonCalls);
`);
  assert.equal(hostile.status, 0, String(hostile.stderr));
  assert.equal(hostile.stdout, "3\n6\n4\n2\na\n2\n8 2 null IndexError true\n0\n");
});
