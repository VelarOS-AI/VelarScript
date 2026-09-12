import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { inspectModule, type ModuleInterface } from "@velarscript/compiler";
import { compileProject, type ProjectResult } from "../../packages/cli/src/project.ts";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { requiredCompilerRuntimeModules } from "../../packages/cli/src/compiler-runtime-modules.ts";
import { writeNodeCompilerRuntimeResolverBootstrap } from "../../packages/cli/src/node-compiler-runtime-resolver.ts";
import { compiledTestModulePath, writeCompiledTestProject } from "../../packages/cli/src/test-output.ts";
import { writeNodeStandardModuleSandbox } from "../../packages/cli/src/standard-module-sandbox.ts";
import { decodeVelarLibraryInterface, encodeVelarLibraryInterface, rebaseModuleInterfaceIdentities, sha256Text } from "../../packages/cli/src/library-artifact.ts";
import { moduleInterfaceIdentity } from "../../packages/cli/src/project/interfaces/identity.ts";
import { publishedRuntimeTypeExports, missingArtifactRuntimeTypes } from "../../packages/cli/src/project/interfaces/runtime-types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { runCli } from "../support/run-cli.ts";

after(removeTemporaryDirectories);

const store = 'type Leaf:\n    name: string\nconst shared: Leaf = {name: "ok"}\nexport def value() -> Leaf:\n    return shared\n';
const consumer = (source: string): string => `import {value} from ${JSON.stringify(source)}\nlet item = true ? {leaf: value()} : null\nexport def current(): return value()\nexport def read() -> string:\n    if item == null: return "none"\n    return item.leaf.name\n`;

async function sourceProject(files: Readonly<Record<string, string>>): Promise<{ root: string; project: ProjectResult }> {
  const root = await makeTemporaryDirectory("velar-runtime-type-routing-");
  await Promise.all(Object.entries(files).map(async ([name, source]) => {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), source);
  }));
  const project = await compileProject(join(root, "main.vel"), new Map(), { sourceRoot: root, emitSourceMaps: false });
  accepts(project);
  return { root, project };
}

function accepts(project: ProjectResult): void {
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
}

async function execute(project: ProjectResult, body: string, expectedOutput?: string): Promise<void> {
  const output = await makeTemporaryDirectory("velar-runtime-type-output-");
  const config = await resolveVelarProject(project.entryPath);
  const runtimeModules = requiredCompilerRuntimeModules(project);
  await writeNodeStandardModuleSandbox(output, config, runtimeModules);
  await writeCompiledTestProject(project, output, false, runtimeModules);
  const resolver = await writeNodeCompilerRuntimeResolverBootstrap(output, runtimeModules, project.velarArtifactImports.values());
  const entry = project.modules.find((module) => module.inputPath === project.entryPath)!;
  const main = pathToFileURL(compiledTestModulePath(project, entry, output)).href;
  const runner = join(output, "verify.mjs");
  await writeFile(runner, `import assert from "node:assert/strict";\nimport * as main from ${JSON.stringify(main)};\n${body}\n`);
  const run = spawnSync(process.execPath, ["--import", resolver, runner], { encoding: "utf8", timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  if (expectedOutput !== undefined) assert.equal(run.stdout, expectedOutput);
}

const rejectsMutatedLeaf = 'assert.equal(main.read(), "ok"); main.current().name = 7; assert.throws(() => main.read(), /NarrowingError|Expected/);';

test("private returned records route real validators through multiple re-exports", async () => {
  const { root, project } = await sourceProject({
    "store.vel": store,
    "first.vel": 'export {value as renamed} from "./store.vel"\n',
    "second.vel": 'export {renamed as value} from "./first.vel"\n',
    "main.vel": consumer("./second.vel"),
  });
  await execute(project, rejectsMutatedLeaf);
  const interface_ = project.moduleInterfaces.get(join(root, "second.vel"))!;
  assert.deepEqual([...interface_.exports.keys()], ["value"]);
  assert.equal(interface_.runtimeTypeExports?.size, 1);
  assert.match(project.modules.find((module) => module.inputPath.endsWith("second.vel"))!.result.code!, /export \{ __velarRuntimeTypeForward_[a-f0-9]+ as __velarRuntimeTypeForward_[a-f0-9]+ \} from "\.\/first\.js"/u);
  const forbidden = await compileProject(join(root, "forbidden.vel"), new Map([
    [join(root, "forbidden.vel"), 'import {Leaf} from "./store.vel"\n'],
  ]), { sourceRoot: root });
  assert.equal(forbidden.failures[0]?.code, "VEL6007");
});

test("same-named private record owners remain distinct and source aliases retain validation", async () => {
  const { project } = await sourceProject({
    "left.vel": store,
    "right.vel": store.replaceAll("name: string", "name: number").replaceAll('name: "ok"', "name: 1"),
    "main.vel": 'import {value as left} from "./left.vel"\nimport {value as right} from "./right.vel"\nlet item = true ? {left: left(), right: right()} : null\nexport def current(): return right()\nexport def read() -> string:\n    if item == null: return "none"\n    return item.left.name\n',
  });
  await execute(project, 'assert.equal(main.read(), "ok"); main.current().name = "wrong"; assert.throws(() => main.read(), /NarrowingError|Expected/);');
});

test("private runtime forwarding in a module cycle converges without export loops", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "a.vel": 'import {ping} from "./b.vel"\nexport {value} from "./store.vel"\nexport def again() -> number: return ping()\n',
    "b.vel": 'import {again} from "./a.vel"\nexport {value} from "./a.vel"\nexport def ping() -> number: return 1\n',
    "main.vel": consumer("./b.vel"),
  });
  await execute(project, rejectsMutatedLeaf);
});

test("private generic record factories and class identities survive source package routing", async () => {
  const root = await makeTemporaryDirectory("velar-runtime-type-package-");
  const library = join(root, "library");
  await mkdir(join(library, "src"), { recursive: true });
  await writeFile(join(library, "package.json"), JSON.stringify({ name: "runtime-routing-fixture", version: "1.0.0", type: "module", velar: { entry: "src/index.vel", targets: ["core"], requires: { capabilities: [] } } }));
  await writeFile(join(library, "src", "store.vel"), 'class Token:\n    const name: string = "token"\ntype Leaf<T>:\n    value: T\nconst shared: Leaf<Token> = {value: Token()}\nexport def value() -> Leaf<Token>: return shared\n');
  await writeFile(join(library, "src", "index.vel"), 'export {value} from "./store.vel"\n');
  const owner = join(root, "consumer");
  await mkdir(join(owner, "node_modules"), { recursive: true });
  await symlink(library, join(owner, "node_modules", "runtime-routing-fixture"), "dir");
  await writeFile(join(owner, "main.vel"), consumer("runtime-routing-fixture").replace("item.leaf.name", "item.leaf.value.name"));
  const project = await compileProject(join(owner, "main.vel"), new Map(), { sourceRoot: owner, projectRoot: owner, emitSourceMaps: false });
  accepts(project);
  const interfaces = [...project.moduleInterfaces.values()];
  assert.ok(interfaces.some((interface_) => [...(interface_.runtimeTypeExports?.keys() ?? [])].some((identity) => identity.includes("velar:package:runtime-routing-fixture@1.0.0/src/store.vel#Token"))));
  const rejectForgedToken = 'assert.equal(main.read(), "token"); main.current().value = {name: "forged"}; assert.throws(() => main.read(), /NarrowingError|Expected/);';
  await execute(project, rejectForgedToken);
  const entry = join(owner, "main.vel");
  const dynamicSource = consumer("runtime-routing-fixture").replace('import {value} from "runtime-routing-fixture"', 'const library = await import("./dynamic-bridge.vel")\nconst value = library.value').replace("item.leaf.name", "item.leaf.value.name");
  const bridge = join(owner, "dynamic-bridge.vel");
  const dynamic = await compileProject(entry, new Map([[entry, dynamicSource], [bridge, 'export {value} from "runtime-routing-fixture"\n']]), { sourceRoot: owner, projectRoot: owner, emitSourceMaps: false });
  accepts(dynamic);
  await execute(dynamic, rejectForgedToken);
});

test("runtime Type artifact metadata is serialized, rebased, fingerprinted, and identifier-checked", () => {
  const base = inspectModule(store, { path: "/physical/store.vel" }).moduleInterface;
  const identity = base.namedTypeIdentities.get("Leaf")!;
  const interface_: ModuleInterface = { ...base, runtimeTypeExports: new Map([[identity, "__velarRuntimeType_Leaf"]]) };
  const decoded = decodeVelarLibraryInterface(encodeVelarLibraryInterface(interface_));
  assert.deepEqual(decoded.runtimeTypeExports, interface_.runtimeTypeExports);
  assert.notEqual(moduleInterfaceIdentity(base), moduleInterfaceIdentity(interface_));
  const rebased = rebaseModuleInterfaceIdentities(decoded, [{ physical: "/physical/store.vel", logical: "package:fixture@1.0.0/store.vel" }]);
  assert.deepEqual([...rebased.runtimeTypeExports!], [["velar:package:fixture@1.0.0/store.vel#type:Leaf", "__velarRuntimeType_Leaf"]]);
  for (const exported of ['__velarRuntimeType_x;print(1)', '__velarRuntimeType_x\n', '__velarRuntimeType_"x', "Leaf"]) {
    assert.throws(() => encodeVelarLibraryInterface({ ...base, runtimeTypeExports: new Map([[identity, exported]]) }), /reserved runtime Type export/u);
    const poisonedWire = encodeVelarLibraryInterface(interface_).replaceAll(JSON.stringify("__velarRuntimeType_Leaf"), JSON.stringify(exported));
    assert.throws(() => decodeVelarLibraryInterface(poisonedWire), /reserved runtime Type export/u);
  }
  const alias = inspectModule(store + 'export type PublicLeaf = Leaf\n', { path: "/physical/store.vel" }).moduleInterface;
  assert.equal(publishedRuntimeTypeExports(alias).get(identity), "PublicLeaf");
  assert.deepEqual(missingArtifactRuntimeTypes(base, new Set()), [identity]);
  assert.deepEqual(missingArtifactRuntimeTypes(alias, new Set()), []);
  assert.deepEqual(missingArtifactRuntimeTypes(base, new Set([identity])), []);
});

for (const generic of [false, true]) test(`compiled artifacts preserve private ${generic ? "generic " : ""}validators without parsing their installed sources`, async () => {
  const root = await makeTemporaryDirectory("velar-runtime-type-artifact-");
  const library = join(root, "library");
  await mkdir(join(library, "src"), { recursive: true });
  await writeFile(join(library, "package.json"), JSON.stringify({ name: "runtime-artifact-fixture", version: "1.0.0", type: "module", exports: { ".": "./dist/index.js" }, velar: { entry: "src/index.vel", artifacts: { core: "dist/velar-library.json" }, targets: ["core"], requires: { capabilities: [] } } }));
  await writeFile(join(library, "velar.json"), JSON.stringify({ formatVersion: 2, kind: "library", entry: "src/index.vel", outDir: "dist", extensions: [] }));
  const librarySource = generic ? 'class Token:\n    const name: string = "token"\ntype Leaf<T>:\n    value: T\nconst shared: Leaf<Token> = {value: Token()}\nexport def value() -> Leaf<Token>: return shared\n' : store;
  await writeFile(join(library, "src", "store.vel"), librarySource);
  await writeFile(join(library, "src", "index.vel"), 'export {value} from "./store.vel"\n');
  const built = runCli(library, ["build-library"], { timeout: 60_000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  await writeFile(join(library, "src", "index.vel"), "this is obsolete and invalid Velar source\n");
  const owner = join(root, "consumer");
  await mkdir(join(owner, "node_modules"), { recursive: true });
  await symlink(library, join(owner, "node_modules", "runtime-artifact-fixture"), "dir");
  const mainSource = generic ? consumer("runtime-artifact-fixture").replace("item.leaf.name", "item.leaf.value.name") : consumer("runtime-artifact-fixture");
  const mutationCheck = generic ? 'assert.equal(main.read(), "token"); main.current().value = {name: "forged"}; assert.throws(() => main.read(), /NarrowingError|Expected/);' : rejectsMutatedLeaf;
  await writeFile(join(owner, "main.vel"), mainSource);
  const project = await compileProject(join(owner, "main.vel"), new Map(), { sourceRoot: owner, projectRoot: owner, emitSourceMaps: false });
  accepts(project);
  assert.equal(project.velarArtifactImports.size, 1);
  await execute(project, mutationCheck);
  const entry = join(owner, "main.vel");
  const dynamicSource = mainSource.replace('import {value} from "runtime-artifact-fixture"', 'const library = await import("./dynamic-bridge.vel")\nconst value = library.value');
  const bridge = join(owner, "dynamic-bridge.vel");
  const dynamic = await compileProject(entry, new Map([[entry, dynamicSource], [bridge, 'export {value} from "runtime-artifact-fixture"\n']]), { sourceRoot: owner, projectRoot: owner, emitSourceMaps: false });
  accepts(dynamic);
  assert.equal(dynamic.velarArtifactImports.size, 1);
  await execute(dynamic, mutationCheck);
  assert.doesNotMatch(await readFile(join(library, "dist", "index.js"), "utf8"), /\/physical\/|\/src\/store\.vel/u);
  if (!generic) {
    const receiptPath = join(library, "dist", "velar-library.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const interfacePath = join(dirname(receiptPath), receipt.entry.interface);
    const current = decodeVelarLibraryInterface(await readFile(interfacePath, "utf8"));
    const { runtimeTypeExports: _internal, ...legacy } = current;
    const legacyText = encodeVelarLibraryInterface(legacy);
    await writeFile(interfacePath, legacyText);
    receipt.entry.sha256.interface = sha256Text(legacyText);
    await writeFile(receiptPath, JSON.stringify(receipt));
    const missing = await compileProject(entry, new Map(), { sourceRoot: owner, projectRoot: owner, emitSourceMaps: false });
    assert.ok(missing.failures.some((failure) => /does not publish Runtime Type validators.*velar build-library/u.test(failure.message)));
  }
});


test("inferred public helper results retain transitive private validator routes", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "helper.vel": 'import {value as original} from "./store.vel"\nexport def value(): return original()\n',
    "main.vel": consumer("./helper.vel"),
  });
  await execute(project, rejectsMutatedLeaf);
});

test("hoisted structural checks retain imported aliases used only as field types", async () => {
  const { project } = await sourceProject({
    "store.vel": store.replace("type Leaf:", "export type Leaf:"),
    "main.vel": 'import {Leaf as Label, value} from "./store.vel"\nconst leaf: Label = value()\nlet item = true ? {leaf} : null\nexport def current(): return value()\nexport def read() -> string:\n    if item == null: return "none"\n    return item.leaf.name\n',
  });
  await execute(project, rejectsMutatedLeaf);
});

test("cycle routes stay stable from either entry and after incremental recompilation", async () => {
  const { root, project: first } = await sourceProject({
    "store.vel": store,
    "a.vel": 'import {bValue} from "./b.vel"\nexport {value as aValue} from "./store.vel"\n',
    "b.vel": 'export {aValue as bValue} from "./a.vel"\n',
    "main.vel": consumer("./a.vel").replace('{value}', '{aValue as value}'),
  });
  await execute(first, rejectsMutatedLeaf);
  const main = join(root, "main.vel");
  const storePath = join(root, "store.vel");
  const overrides = new Map([[main, consumer("./b.vel").replace('{value}', '{bValue as value}')], [storePath, store + "// Incremental update.\n"]]);
  const next = await compileProject(main, overrides, { sourceRoot: root, emitSourceMaps: false }, first, new Set([main, storePath]));
  accepts(next);
  await execute(next, rejectsMutatedLeaf);
  for (const name of ["a.vel", "b.vel"]) {
    assert.deepEqual(next.moduleInterfaces.get(join(root, name))?.runtimeTypeExports, first.moduleInterfaces.get(join(root, name))?.runtimeTypeExports);
  }
});

test("standard records returned without a Type import retain their published validators", async () => {
  const { project } = await sourceProject({
    "main.vel": 'import {uint32Builder} from "velar/binary"\nconst shared = {builder: uint32Builder(8)}\nlet item = true ? shared : null\nexport def current(): return shared\nexport def read() -> number:\n    if item == null: return 0\n    return item.builder.maxElements\n',
  });
  assert.match(project.modules[0]!.result.code!, /UInt32Builder as __velarRuntimeTypeImport/u);
  await execute(project, 'assert.equal(main.read(), 8); main.current().builder = {maxElements: 8}; assert.throws(() => main.read(), /NarrowingError|Expected/);');
});

test("unused private record declarations cannot acquire default-expression effects", async () => {
  const root = await makeTemporaryDirectory("velar-unused-runtime-type-");
  const entry = join(root, "main.vel");
  const project = await compileProject(entry, new Map([[entry, 'def effect() -> number:\n    print("effect")\n    return 1\ntype Unused:\n    value: number = effect()\nexport def read() -> number: return 1\n']]), { sourceRoot: root });
  assert.ok(project.modules.flatMap((module) => module.result.diagnostics).some((diagnostic) => diagnostic.code === "VEL2017"));
  assert.ok(project.modules.every((module) => module.result.code === null));
});

test("hoisted exported functions can validate private records during cyclic initialization", async () => {
  const { project } = await sourceProject({
    "main.vel": 'import {read} from "./dependent.vel"\ntype Leaf:\n    name: string\nexport def value() -> Leaf: return {name: "ok"}\n',
    "dependent.vel": 'import {value} from "./main.vel"\nlet item = true ? {leaf: value()} : null\nexport def read() -> string:\n    if item == null: return "none"\n    return item.leaf.name\nassert read() == "ok" else "Cyclic initialization failed"\n',
  });
  await execute(project, 'assert.equal(main.value().name, "ok");');
});


test("dynamic private validators preserve deferred loading and pending import promises", async () => {
  const { project } = await sourceProject({
    "store.vel": 'print("owner loaded")\n' + store,
    "main.vel": 'export async def open():\n    const pending = import("./store.vel")\n    const library = await pending\n    let item = true ? {leaf: library.value()} : null\n    def read() -> string:\n        if item == null: return "none"\n        return item.leaf.name\n    return {read, current: library.value}\n',
  });
  await execute(project, 'console.log("before"); const api = await main.open(); console.log("after"); assert.equal(api.read(), "ok"); api.current().name = 7; assert.throws(() => api.read(), /NarrowingError|Expected/);', "before\nowner loaded\nafter\n");
});

test("dynamic private validator routes cross inferred public asynchronous helpers", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "helper.vel": 'export async def value():\n    const library = await import("./store.vel")\n    return library.value()\n',
    "main.vel": 'import {value} from "./helper.vel"\nconst shared = await value()\nlet item = true ? {leaf: shared} : null\nexport def current(): return shared\nexport def read() -> string:\n    if item == null: return "none"\n    return item.leaf.name\n',
  });
  await execute(project, rejectsMutatedLeaf);
});

test("Velar namespaces retain only public fields through static and dynamic record spread", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "main.vel": 'import * as library from "./store.vel"\nexport def snapshot(): return {...library}\nexport async def later():\n    const loaded = await import("./store.vel")\n    return {...loaded}\n',
  });
  await execute(project, 'assert.deepEqual(Object.keys(main.snapshot()), ["value"]); assert.deepEqual(Object.keys(await main.later()), ["value"]); assert.equal(main.snapshot().value().name, "ok");');
});


test("cyclic initialization can validate nested private records with collection fields", async () => {
  const { project } = await sourceProject({
    "main.vel": 'import {read} from "./dependent.vel"\ntype Child:\n    values: List<string>\ntype Leaf:\n    child: Child\nexport def value() -> Leaf: return {child: {values: ["ok"]}}\n',
    "dependent.vel": 'import {value} from "./main.vel"\nlet item = true ? {leaf: value()} : null\nexport def read() -> number:\n    if item == null: return 0\n    return item.leaf.child.values.size\nassert read() == 1 else "Cyclic nested initialization failed"\n',
  });
  await execute(project, 'assert.deepEqual(main.value().child.values, ["ok"]);');
});


test("local bindings can shadow imported namespace names", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "main.vel": 'import * as library from "./store.vel"\nexport def read(library: string) -> string: return library\n',
  });
  await execute(project, 'assert.equal(main.read("local"), "local");');
});


test("cyclic initialization can instantiate private generic validators", async () => {
  const { project } = await sourceProject({
    "main.vel": 'import {read} from "./dependent.vel"\ntype Child:\n    name: string\ntype Box<T>:\n    child: T\nexport def value() -> Box<Child>: return {child: {name: "ok"}}\n',
    "dependent.vel": 'import {value} from "./main.vel"\nlet item = true ? {box: value()} : null\nexport def read() -> string:\n    if item == null: return "none"\n    return item.box.child.name\nassert read() == "ok" else "Cyclic generic initialization failed"\n',
  });
  await execute(project, 'assert.equal(main.value().child.name, "ok");');
});


test("validation uses the loaded dynamic route when another route shares its private Type", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "a.vel": 'export {value} from "./store.vel"\n',
    "b.vel": 'export {value} from "./store.vel"\n',
    "main.vel": 'export async def unused(): return await import("./a.vel")\nexport async def open():\n    const library = await import("./b.vel")\n    let item = true ? {leaf: library.value()} : null\n    def read() -> string:\n        if item == null: return "none"\n        return item.leaf.name\n    return {read, current: library.value}\n',
  });
  await execute(project, 'const api = await main.open(); assert.equal(api.read(), "ok"); api.current().name = 7; assert.throws(() => api.read(), /NarrowingError|Expected/);');
});


test("a loaded dynamic provider validates when a static helper has not opened its provider", async () => {
  const { project } = await sourceProject({
    "store.vel": store,
    "a.vel": 'export async def unopened():\n    const library = await import("./store.vel")\n    return library.value()\n',
    "b.vel": 'export {value} from "./store.vel"\n',
    "main.vel": 'import {unopened} from "./a.vel"\nexport async def open():\n    const library = await import("./b.vel")\n    let item = true ? {leaf: library.value()} : null\n    def read() -> string:\n        if item == null: return "none"\n        return item.leaf.name\n    return {read, current: library.value}\n',
  });
  await execute(project, 'const api = await main.open(); assert.equal(api.read(), "ok"); api.current().name = 7; assert.throws(() => api.read(), /NarrowingError|Expected/);');
});


test("explicit public Type imports validate through hoisted accessors during cyclic initialization", async () => {
  const { project } = await sourceProject({
    "main.vel": 'import {read} from "./dependent.vel"\nexport type Leaf:\n    name: string\nexport def value() -> Leaf: return {name: "ok"}\n',
    "dependent.vel": 'import {Leaf, value} from "./main.vel"\nconst leaf: Leaf = value()\nlet item = true ? {leaf} : null\nexport def read() -> string:\n    if item == null: return "none"\n    return item.leaf.name\nassert read() == "ok" else "Cyclic public Type initialization failed"\n',
  });
  await execute(project, 'assert.equal(main.value().name, "ok");');
});
