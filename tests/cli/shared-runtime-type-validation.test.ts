import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_TYPE_VALIDATION_MODULE } from "@velarscript/compiler/extension";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";

/**
 * D115 P5 — the shared runtime Type validation, one subject of the file that
 * was `shared-runtime-validation.test.ts` before it reached 796 lines.
 *
 * What is held here is the one runtime the declared types and the class-valued
 * flow narrowings both reach: the standalone build inlines it, the project
 * build imports it, the registry it keeps is never a module a program may name,
 * and a host that has poisoned every intrinsic it touches changes none of that.
 * The bodies below are the bodies that file had.
 */

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
    "ValidationPathKind",
    "importModule",
    "listTypeIs",
    "mapTypeIs",
    "moduleNamespace",
    "objectTypeIs",
    "recordTypeIs",
    "registerRuntimeType",
    "setTypeIs",
    "validationExplain",
    "validationFormatPath",
    "validationFreeze",
    "validationIsArray",
    "validationIsInstance",
    // D44 rule 70: records accept only plain data objects; the check and the
    // parse-failure teaching hint ride the shared validation runtime.
    "validationIsPlainObject",
    "validationIsPromise",
    "validationOwnDescriptor",
    "validationPath",
    "validationPathAppend",
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
