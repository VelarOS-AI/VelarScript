import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { createContext, runInContext } from "node:vm";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";

after(removeTemporaryDirectories);

const runtimeSource = await readFile(new URL("../../../packages/compiler/runtime/module-namespace.js", import.meta.url), "utf8");
const runtimeModule = `${runtimeSource}\nexport { __velarModuleNamespace as namespace, __velarImportModule as importModule };\n`;

type Namespace = Record<string, unknown>;
interface Runtime {
  namespace(raw: object, names: readonly string[]): Namespace;
  importModule(promise: Promise<object>, receive: (raw: object) => void, names: readonly string[]): Promise<Namespace>;
}

async function fixture(files: Record<string, string>): Promise<{ root: string; runtime: Runtime }> {
  const root = await makeTemporaryDirectory("velar-module-namespace-");
  await writeFile(join(root, "runtime.mjs"), runtimeModule);
  for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
  const runtime: Runtime = await import(pathToFileURL(join(root, "runtime.mjs")).href);
  return { root, runtime };
}

const publicNames = ["count", "advance"];
const librarySource = "export let count = 1; export function advance() { count += 1; } export const __privateRuntimeType = {};\n";

test("public namespace exposes live data descriptors without private exports or symbols", async () => {
  const { root, runtime } = await fixture({ "library.mjs": librarySource });
  const raw = await import(pathToFileURL(join(root, "library.mjs")).href);
  const view = runtime.namespace(raw, publicNames);
  assert.deepEqual(Reflect.ownKeys(view), ["advance", "count"]);
  assert.equal(Object.getPrototypeOf(view), null);
  assert.equal(Object.isExtensible(view), false);
  assert.equal(view.__privateRuntimeType, undefined);
  assert.equal(Reflect.get(view, Symbol.toStringTag), undefined);
  assert.equal("__privateRuntimeType" in view, false);
  assert.equal(view.count, 1);
  assert.equal(Object.getOwnPropertyDescriptor(view, "count")?.value, 1);
  assert.equal(Object.getOwnPropertyDescriptor(view, "count")?.get, undefined);
  const copy = { ...view };
  raw.advance();
  assert.equal(copy.count, 1);
  assert.equal(view.count, 2);
  assert.equal(Object.getOwnPropertyDescriptor(view, "count")?.value, 2);
  assert.equal(Reflect.set(view, "count", 90), false);
  assert.equal(Reflect.defineProperty(view, "count", { value: 90 }), false);
  assert.equal(Reflect.deleteProperty(view, "count"), false);
  assert.equal(raw.count, 2);
  assert.ok(Reflect.ownKeys(raw).includes(Symbol.toStringTag), "the raw JS namespace remains untouched");
  assert.ok("__privateRuntimeType" in raw);
});

test("cyclic namespace creation stays lazy, retaining hoisted functions and lexical TDZ", async () => {
  const { root } = await fixture({
    "a.mjs": 'import { inspect } from "./b.mjs"; export const early = inspect(); export let count = 1; export function advance() { count += 1; }\n',
    "b.mjs": 'import * as raw from "./a.mjs"; import { namespace } from "./runtime.mjs"; export const view = namespace(raw, ["count", "advance"]); export function inspect() { let error; try { view.count; } catch (reason) { error = reason.name; } return { keys: Reflect.ownKeys(view), callable: typeof view.advance, error }; }\n',
  });
  const a = await import(pathToFileURL(join(root, "a.mjs")).href);
  const b = await import(pathToFileURL(join(root, "b.mjs")).href);
  assert.deepEqual(a.early, { keys: ["advance", "count"], callable: "function", error: "ReferenceError" });
  assert.equal(b.view.count, 1);
  a.advance();
  assert.equal(b.view.count, 2);
});

test("module views keep identity across runtime copies and dynamic captures", async () => {
  const { root, runtime } = await fixture({ "library.mjs": librarySource, "runtime-copy.mjs": runtimeModule });
  const raw = await import(pathToFileURL(join(root, "library.mjs")).href);
  const other: Runtime = await import(pathToFileURL(join(root, "runtime-copy.mjs")).href);
  const view = runtime.namespace(raw, publicNames);
  assert.equal(other.namespace(raw, publicNames), view);
  let captured: object | undefined;
  const dynamic = await other.importModule(import(pathToFileURL(join(root, "library.mjs")).href), value => { captured = value; }, publicNames);
  assert.equal(captured, raw);
  assert.equal(dynamic, view);
});

test("dynamic imports stay lazy and capture raw bindings before ordered public callbacks", async () => {
  const { root, runtime } = await fixture({ "library.mjs": librarySource });
  let imports = 0;
  let captured: object | undefined;
  const events: string[] = [];
  const load = () => {
    imports += 1;
    return runtime.importModule(import(pathToFileURL(join(root, "library.mjs")).href), raw => { captured = raw; events.push("capture"); }, publicNames);
  };
  assert.equal(imports, 0);
  const pending = load();
  assert.equal(imports, 1);
  assert.equal(events.length, 0);
  const first = pending.then(view => { assert.equal(view, runtime.namespace(captured!, publicNames)); events.push("first"); });
  const second = pending.then(() => { events.push("second"); });
  await Promise.all([first, second]);
  assert.deepEqual(events, ["capture", "first", "second"]);
});

test("dynamic import and capture failures stay on the one returned rejection chain", async () => {
  const { root, runtime } = await fixture({ "failure.mjs": 'throw new Error("module failed");\n' });
  const native = import(pathToFileURL(join(root, "failure.mjs")).href);
  let captures = 0;
  const projected = runtime.importModule(native, () => { captures += 1; }, []);
  const [nativeFailure, projectedFailure] = await Promise.all([
    native.catch((reason: unknown) => reason), projected.catch((reason: unknown) => reason),
  ]);
  assert.equal(projectedFailure, nativeFailure);
  assert.equal(captures, 0);
  const callbackFailure = new Error("capture failed");
  await assert.rejects(runtime.importModule(Promise.resolve({}), () => { throw callbackFailure; }, []), reason => reason === callbackFailure);
});

test("namespace and import operations use captured host intrinsics", async () => {
  const context = createContext({});
  const runtime: Runtime = runInContext(`${runtimeSource}\n({ namespace: __velarModuleNamespace, importModule: __velarImportModule });`, context);
  runInContext(`
    const fail = () => { throw new Error("poisoned host operation"); };
    Object.getOwnPropertyDescriptor = Object.create = Object.defineProperty = Object.preventExtensions = fail;
    WeakMap.prototype.get = WeakMap.prototype.set = WeakMap.prototype.has = fail;
    Array.prototype.sort = Promise.prototype.then = Reflect.apply = fail;
  `, context);
  const raw = { count: 3, __private: 4 };
  const view = runtime.namespace(raw, ["count"]);
  assert.equal(view.count, 3);
  assert.deepEqual(Object.keys(view), ["count"]);
  assert.equal(await runtime.importModule(Promise.resolve(raw), () => {}, ["count"]), view);
});
