import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore, type CompilerExtension } from "@velarscript/compiler";
import { VELAR_CLASS_FIELD_MODULE, VELAR_COLLECTION_HOST_EXPORTS, VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_LOWERING_DEPENDENCIES, VELAR_COLLECTION_LOWERING_EXPORTS, VELAR_COLLECTION_LOWERING_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_REACTIVE_BRIDGE_MODULE, VELAR_TYPE_VALIDATION_MODULE } from "@velarscript/compiler/extension";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleClosure, standardModuleDependencies, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("class-valued flow narrowings include their nominal validation runtime", async () => {
  const source = `
class RopeNode:
    const child: RopeNode?
    const length: number

    constructor(child: RopeNode? = null):
        self.child = child
        self.length = child == null ? 1 : child.length + 1

const root = RopeNode(RopeNode())
print(root.length)
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.match(standalone.code ?? "", /function __velarValidationIsInstance/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-types-v1/u);
  const execution = executeModule(standalone.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n");

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.ok(shared.runtimeModules.includes(VELAR_TYPE_VALIDATION_MODULE));
  assert.match(shared.code ?? "", /validationIsInstance as __velarValidationIsInstance/u);
  assert.doesNotMatch(shared.code ?? "", /function __velarValidationIsInstance/u);

  const directory = await makeTemporaryDirectory("velar-class-narrowing-runtime-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, source, "utf8");
  const run = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "run", entry], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, String(run.stderr));
  assert.equal(run.stdout, "2\n");
});

test("project compilation shares error normalization across Core and Web without publishing it", async () => {
  const source = `
def recover() -> string:
    try:
        throw Error("boom")
    catch error:
        return error.message
    return "missing"

print(recover())
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /const __velarErrorNativeError = globalThis\.Error/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-errors-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_CLASS_FIELD_MODULE, VELAR_ERROR_NORMALIZATION_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)}`));
  assert.doesNotMatch(shared.code ?? "", /const __velarErrorNativeError = globalThis\.Error/u);

  const webSource = `
component App():
    return <main>Ready</main>
`.trimStart();
  const standaloneWeb = compile(webSource);
  assert.deepEqual(standaloneWeb.diagnostics, []);
  assert.deepEqual(standaloneWeb.runtimeModules, []);
  assert.match(standaloneWeb.code ?? "", /const __velarErrorNativeError = globalThis\.Error/u);
  const sharedWeb = compile(webSource, { sharedRuntimeModules: true });
  assert.deepEqual(sharedWeb.diagnostics, []);
  assert.ok(sharedWeb.runtimeModules.includes(VELAR_ERROR_NORMALIZATION_MODULE));
  assert.match(sharedWeb.code ?? "", /errorApply as __velarErrorApply, errorCode as __velarErrorCode, isError as __velarIsError, normalizeError as __velarNormalizeError/u);
  assert.doesNotMatch(sharedWeb.code ?? "", /const __velarErrorNativeError = globalThis\.Error/u);

  const directory = await makeTemporaryDirectory("velar-shared-error-runtime-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, `
export def recoverDependency() -> string:
    try:
        throw Error("dependency")
    catch error:
        return error.message
    return "missing"
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {recoverDependency} from "./dependency.vel"

def recoverEntry() -> string:
    try:
        throw Error("entry")
    catch error:
        return error.message
    return "missing"

print(recoverDependency() + ":" + recoverEntry())
`.trimStart(), "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_ERROR_NORMALIZATION_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /const __velarErrorNativeError = globalThis\.Error/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_ERROR_NORMALIZATION_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_ERROR_NORMALIZATION_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_ERROR_NORMALIZATION_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  // D50 rule 89: the shared error module also owns the nameable capability
  // error classes and the code projection, so every consumer builds the same
  // class identities. `assert` and `value!` raise AssertionError (D86 rule
  // 212), so that class ships here too rather than being inlined per module.
  // CO-I6: `hostErrorTrace` is the one frame policy every host error channel
  // prints through — the emitted detached and release reporters, `velar run`'s
  // uncaught path, and `velar/async`'s own detached reporter.
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), [
    "AddressInUseError", "AssertionError", "FileExistsError", "FileNotFoundError", "NotADirectoryError", "PermissionError",
    "TimeoutError", "errorApply", "errorCode", "hostErrorTrace", "isError", "normalizeError",
  ]);
  assert.equal(runtimeNamespace.AssertionError.name, "AssertionError");
  assert.equal(runtimeNamespace.errorCode(new runtimeNamespace.AssertionError("boom")), "AssertionError");

  const hostile = executeModule(`
import {errorApply, isError, normalizeError} from ${JSON.stringify(runtimeUrl)};
const NativeError = globalThis.Error;
const NativeString = globalThis.String;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeDefine = NativeObject.defineProperty;
const nativeApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(globalThis.Function.prototype, globalThis.Symbol.hasInstance).value;
const original = new NativeError("original");
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned shared error host"); };
globalThis.Error = poison;
globalThis.String = poison;
globalThis.Object = poison;
globalThis.Reflect = {apply: poison};
globalThis.TypeError = poison;
nativeDefine(NativeObject, "getOwnPropertyDescriptor", {value: poison, writable: true, configurable: true});
nativeDefine(NativeReflect, "apply", {value: poison, writable: true, configurable: true});
nativeDefine(NativeError, "isError", {value: poison, writable: true, configurable: true});
const normalized = normalizeError(42);
console.log(isError(original), normalizeError(original) === original, normalized.name + ":" + normalized.message, errorApply(NativeString, globalThis, [7], "String"));
let failure = null;
try { errorApply(null, null, [], "missing"); } catch (error) { failure = error; }
console.log(nativeApply(nativeHasInstance, NativeTypeError, [failure]), isError(failure), poisonCalls);
`);
  assert.equal(hostile.status, 0, String(hostile.stderr));
  assert.equal(hostile.stdout, "true true Error:42 7\ntrue true 0\n");
});

test("project compilation shares runtime Type validation without publishing type identities", async () => {
  const source = `
export type Tree:
    label: string
    children: List<Tree>

export type FutureNumber = Promise<number>

export enum Status:
    ready
    done

class Box:
    const value: number

    constructor(value: number):
        self.value = value

export type Boxed:
    box: Box
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /const __velarValidationNativeWeakMap = globalThis\.WeakMap/u);
  assert.match(standalone.code ?? "", /const __velarRuntimeTypeRegistryKey/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-types-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_TYPE_VALIDATION_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_TYPE_VALIDATION_MODULE)}`));
  assert.match(shared.code ?? "", /registerRuntimeType as __velarRegisterRuntimeType/u);
  assert.match(shared.code ?? "", /listTypeIs as __velarListTypeIs/u);
  assert.doesNotMatch(shared.code ?? "", /recordTypeIs as __velarRecordTypeIs/u);
  assert.doesNotMatch(shared.code ?? "", /const __velarValidationNativeWeakMap = globalThis\.WeakMap/u);
  assert.doesNotMatch(shared.code ?? "", /const __velarRuntimeTypeRegistryKey/u);

  const directory = await makeTemporaryDirectory("velar-shared-runtime-types-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, `
export type Dependency:
    value: number
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {Dependency} from "./dependency.vel"

type Entry:
    dependency: Dependency

print(Entry.parse({dependency: {value: 7}}).dependency.value)
`.trimStart(), "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_TYPE_VALIDATION_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_TYPE_VALIDATION_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /const __velarValidationNativeWeakMap = globalThis\.WeakMap/u);
    assert.doesNotMatch(module.result.code ?? "", /const __velarRuntimeTypeRegistryKey/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_TYPE_VALIDATION_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_TYPE_VALIDATION_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_TYPE_VALIDATION_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), [
    "ValidationError",
    "listTypeIs",
    "mapTypeIs",
    "recordTypeIs",
    "registerRuntimeType",
    "setTypeIs",
    "validationFreeze",
    "validationIsArray",
    "validationIsInstance",
    // D44 rule 70: records accept only plain data objects; the check and the
    // parse-failure teaching hint ride the shared validation runtime.
    "validationIsPlainObject",
    "validationIsPromise",
    "validationOwnDescriptor",
    "validationRejectionHint",
    "validationSet",
    "validationSetAdd",
    "validationSetDelete",
    "validationSetHas",
    "validationSetSize",
    "validationState",
    "validationWeakMapDelete",
    "validationWeakMapGet",
    "validationWeakMapSet",
  ]);

  const sharedSource = (shared.code ?? "").replace(JSON.stringify(VELAR_TYPE_VALIDATION_MODULE), JSON.stringify(runtimeUrl));
  const hostile = executeModule(`${sharedSource}
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeWeakMap = globalThis.WeakMap;
const NativeSet = globalThis.Set;
const NativePromise = globalThis.Promise;
const NativeFunction = globalThis.Function;
const NativeSymbol = globalThis.Symbol;
const NativeTypeError = globalThis.TypeError;
const nativeDefine = NativeObject.defineProperty;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeIsFrozen = NativeObject.isFrozen;
const nativeReflectApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(NativeFunction.prototype, NativeSymbol.hasInstance).value;
const valid = {label: "root", children: [{label: "leaf", children: []}]};
const cyclic = {label: "cycle", children: []};
cyclic.children[0] = cyclic;
const leaf = {label: "shared", children: []};
const dag = {label: "dag", children: [leaf, leaf]};
let getterReads = 0;
const accessor = nativeDefine({children: []}, "label", {enumerable: true, configurable: true, get() { getterReads += 1; return "unsafe"; }});
const promise = NativePromise.resolve(1);
const box = new Box(1);
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned shared validation host"); };
globalThis.Array = poison;
globalThis.Object = poison;
globalThis.Reflect = {apply: poison};
globalThis.WeakMap = poison;
globalThis.Set = poison;
globalThis.Promise = poison;
globalThis.Function = poison;
globalThis.Symbol = poison;
globalThis.Boolean = poison;
globalThis.TypeError = poison;
NativeArray.isArray = poison;
NativeObject.getOwnPropertyDescriptor = poison;
NativeObject.freeze = poison;
NativeReflect.apply = poison;
for (const name of ["get", "set", "delete"]) nativeDefine(NativeWeakMap.prototype, name, {value: poison, writable: true, configurable: true});
for (const name of ["has", "add", "delete"]) nativeDefine(NativeSet.prototype, name, {value: poison, writable: true, configurable: true});
nativeDefine(NativeSet.prototype, "size", {get: poison, configurable: true});
nativeDefine(NativePromise, NativeSymbol.hasInstance, {value: poison, configurable: true});
nativeDefine(Box, NativeSymbol.hasInstance, {value: poison, configurable: true});
nativeDefine(NativeArray.prototype, NativeSymbol.iterator, {value: poison, writable: true, configurable: true});

const parseFailure = (() => { try { Tree.parse({label: 1, children: []}); return null; } catch (error) { return error; } })();
const originalError = nativeReflectApply(nativeHasInstance, NativeTypeError, [parseFailure]);
console.log(Tree.is(valid), Tree.is(cyclic), Tree.is(dag));
console.log(Tree.is(accessor), getterReads);
console.log(FutureNumber.is(promise), Status.is("ready"));
console.log(Boxed.is({box}), Boxed.is({box: {value: 1}}));
console.log(parseFailure?.name, originalError);
console.log(nativeIsFrozen(Tree), nativeIsFrozen(FutureNumber), nativeIsFrozen(Status), nativeIsFrozen(Boxed));
console.log(poisonCalls);
`);
  assert.equal(hostile.status, 0, String(hostile.stderr));
  assert.equal(hostile.stdout, "true false true\nfalse 0\ntrue true\ntrue false\nValidationError true\ntrue true true true\n0\n");
});

test("project compilation shares Promise normalization without publishing its registry", async () => {
  const source = `
async def inner() -> number:
    return 1

async def forward() -> number:
    return inner()

class Base:
    def value() -> number:
        return 1

const item: Base = Base()

async def load() -> Base:
    return item
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /const __velarNormalizeNativeWeakMap = globalThis\.WeakMap/u);
  assert.match(standalone.code ?? "", /function __velarAsyncResolvedValue/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-promises-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_PROMISE_NORMALIZATION_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)}`));
  assert.match(shared.code ?? "", /normalizePromiseValue as __velarNormalizePromiseValue/u);
  assert.match(shared.code ?? "", /asyncResolvedValue as __velarAsyncResolvedValue/u);
  assert.doesNotMatch(shared.code ?? "", /const __velarNormalizeNativeWeakMap = globalThis\.WeakMap/u);

  const directory = await makeTemporaryDirectory("velar-shared-promise-runtime-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, `
async def value() -> number:
    return 2

export async def dependency() -> number:
    return value()
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {dependency} from "./dependency.vel"

async def value() -> number:
    return 3

async def entry() -> number:
    return value()

print(await dependency() + await entry())
`.trimStart(), "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_PROMISE_NORMALIZATION_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /const __velarNormalizeNativeWeakMap = globalThis\.WeakMap/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_PROMISE_NORMALIZATION_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_PROMISE_NORMALIZATION_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_PROMISE_NORMALIZATION_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), ["asyncResolvedValue", "normalizePromiseValue"]);

  const sharedSource = (shared.code ?? "").replace(JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE), JSON.stringify(runtimeUrl));
  const hostile = executeModule(`${sharedSource}
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeWeakMap = globalThis.WeakMap;
const NativePromise = globalThis.Promise;
const NativeSymbol = globalThis.Symbol;
const NativeTypeError = globalThis.TypeError;
const nativeDefine = NativeObject.defineProperty;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(globalThis.Function.prototype, NativeSymbol.hasInstance).value;
const nativePromiseThen = nativeDescriptor(NativePromise.prototype, "then").value;
const pending = NativePromise.resolve(undefined);
const rejected = NativePromise.reject(new NativeTypeError("failed"));
rejected.catch(() => null);
let getterReads = 0;
const fake = nativeDefine({}, "then", {configurable: true, get() { getterReads += 1; return () => null; }});
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned shared Promise host"); };
globalThis.Object = poison;
globalThis.Reflect = {apply: poison};
globalThis.WeakMap = poison;
globalThis.Promise = poison;
globalThis.Symbol = poison;
globalThis.TypeError = poison;
NativeObject.getOwnPropertyDescriptor = poison;
NativeObject.getPrototypeOf = poison;
NativeObject.defineProperty = poison;
NativeReflect.apply = poison;
for (const name of ["get", "set", "has"]) nativeDefine(NativeWeakMap.prototype, name, {value: poison, writable: true, configurable: true});
nativeDefine(NativePromise.prototype, "then", {value: poison, writable: true, configurable: true});
nativeDefine(NativeSymbol, "for", {value: poison, writable: true, configurable: true});

const first = __velarNormalizePromiseValue(pending);
const second = __velarNormalizePromiseValue(pending);
nativeDefine(NativePromise.prototype, "then", {value: nativePromiseThen, writable: true, configurable: true});
console.log(await first == null, first === second, await forward(), (await load()).value());
let fakeFailure = null;
try { __velarAsyncResolvedValue(fake); } catch (error) { fakeFailure = error; }
let rejection = null;
try { await __velarNormalizePromiseValue(rejected); } catch (error) { rejection = error; }
console.log(fakeFailure?.name, getterReads, rejection?.message, nativeApply(nativeHasInstance, NativeTypeError, [fakeFailure]));
console.log(poisonCalls);
`);
  assert.equal(hostile.status, 0, String(hostile.stderr));
  assert.equal(hostile.stdout, "true true 1 1\nTypeError 0 failed true\n0\n");
});

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
  assert.match(standalone.code ?? "", /class __VelarIndexError extends __velarCollectionListNativeRangeError/u);
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

test("extension runtime dependencies materialize transitively without becoming public modules", () => {
  const root = "velar/compiler-test-root-v1";
  const middle = "velar/compiler-test-middle-v1";
  const leaf = "velar/compiler-test-leaf-v1";
  const extension: CompilerExtension = {
    id: "test-runtime-dependencies",
    modules: {
      interfaces: new Map(),
      sources: new Map([[root, `import ${JSON.stringify(middle)};`], [middle, `import ${JSON.stringify(leaf)};`], [leaf, "export const ready = true;"]]),
      dependencies: new Map([[root, [middle]], [middle, [leaf]]]),
    },
  };
  assert.deepEqual([...standardModuleClosure([root], {}, [extension])], [root, middle, leaf]);
  assert.deepEqual(standardModuleDependencies(root, {}, [extension]), [middle]);
  assert.equal(standardModuleApiCore([extension]).modules[root], undefined);

  const replacement: CompilerExtension = {
    id: "test-runtime-replacement",
    modules: { interfaces: new Map(), sources: new Map([[root, "export const replaced = true;"]]) },
  };
  assert.deepEqual([...standardModuleClosure([root], {}, [replacement, extension])], [root]);

  const broken: CompilerExtension = {
    id: "test-runtime-broken",
    modules: {
      interfaces: new Map(),
      sources: new Map([[root, "export const broken = true;"]]),
      dependencies: new Map([[root, ["velar/compiler-test-missing-v1"]]]),
    },
  };
  assert.throws(
    () => standardModuleClosure([root], {}, [broken]),
    /standard module 'velar\/compiler-test-root-v1' depends on unknown module 'velar\/compiler-test-missing-v1'/u,
  );
});
