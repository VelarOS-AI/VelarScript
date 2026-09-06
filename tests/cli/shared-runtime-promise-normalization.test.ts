import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_PROMISE_NORMALIZATION_MODULE } from "@velarscript/compiler/extension";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";

/**
 * D115 P5 — the shared Promise normalization, one subject of the file that was
 * `shared-runtime-validation.test.ts` before it reached 796 lines.
 *
 * What is held here is that an `async` program's awaited values normalize
 * through one runtime rather than one per module: the standalone build inlines
 * it, every module of a project imports the same copy, the registry it keeps
 * over already-normalized promises is not published, and the two exports it
 * does have survive a host that has poisoned `then` itself. The body below is
 * the body that file had.
 */

after(removeTemporaryDirectories);

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
