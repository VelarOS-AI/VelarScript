import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_CLASS_FIELD_MODULE, VELAR_ERROR_NORMALIZATION_MODULE } from "@velarscript/compiler/extension";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile } from "../support/compiler-suite.ts";

/**
 * D115 P5 — the shared error normalization, one subject of the file that was
 * `shared-runtime-validation.test.ts` before it reached 796 lines.
 *
 * What is held here is the one error runtime Core and Web both compile against:
 * the standalone build inlines it, every module of a project imports the one
 * copy, the capability error classes and the code projection ride with it so
 * every consumer builds the same class identities, and it is not a module a
 * program may name. The body below is the body that file had.
 */

after(removeTemporaryDirectories);

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
  // D114 WB-D1: `hostErrorTrace` travels with the other four. The Web
  // foundation's report channel applies the one host-frame policy rather than
  // keeping a second copy of it, and a project build imports that runtime
  // instead of inlining it, so the name has to arrive on this line.
  assert.match(sharedWeb.code ?? "", /errorApply as __velarErrorApply, errorCode as __velarErrorCode, hostErrorTrace as __velarHostErrorTrace, isError as __velarIsError, normalizeError as __velarNormalizeError/u);
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
