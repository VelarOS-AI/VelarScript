import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { projectDefinitionAt } from "../../../packages/cli/src/project-semantic.ts";
import { verifyProductionBuild } from "../../../packages/cli/src/production-verifier.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, inspectModule, compileProject, linkWorkspaceWebExtension } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("compiles the Core language contract", async () => {
  // The corpus moved out of `examples/` with D56 rule 131 — a corpus is not an
  // example. Its three companions were only ever walked by the format gate, so
  // every corpus module is checked here too, discovered rather than listed: a
  // module nothing compiles is a module whose diagnostics nobody would ever
  // see. They go through the CLI because `standard-library.vel` imports
  // `velar/*` modules, and resolving those is project analysis, not a bare
  // `compile()` of one text.
  const corpus = (await readdir("tests/corpus")).filter((name) => name.endsWith(".vel")).sort();
  assert.ok(corpus.length >= 4, `expected the corpus modules to be found, saw ${corpus.join(", ")}`);
  for (const name of corpus) {
    const path = `tests/corpus/${name}`;
    const checked = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "check", path], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(checked.status, 0, `${path}: ${checked.stdout}${checked.stderr}`);
  }

  const source = await readFile("tests/corpus/core.vel", "utf8");
  const result = compile(source, { path: "tests/corpus/core.vel" });

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const User = __velarRegisterRuntimeType\(__velarValidationFreeze/);
  assert.match(result.code ?? "", /class Player/);
  assert.match(result.code ?? "", /new Player\(user\.name\)/);
  assert.match(result.code ?? "", /User\.is\(raw\)/);
  assert.match(result.code ?? "", /__velarListIndexGet\(names, 0\)/);
  assert.match(result.code ?? "", /for \(const/);
});

test("checks runtime type declarations and optional access", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

const raw = {name: "Ada", avatar: null}
const user = User.parse(raw)
const avatar = user?.avatar ?? "default.png"
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /User\.parse\(raw\)/);
  assert.match(result.code ?? "", /user\?\.avatar \?\? null\) \?\? "default\.png"/);
});

test("runtime record checks require own data fields without invoking accessors", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

const checked = User.parse({name: "Ada"})
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
let getterReads = 0;
const accessor = {};
Object.defineProperty(accessor, "name", { enumerable: true, get() { getterReads += 1; return "Ada"; } });
const inherited = Object.create({ name: "Ada" });
const optionalAccessor = { name: "Ada" };
Object.defineProperty(optionalAccessor, "avatar", { enumerable: true, get() { getterReads += 1; return "photo.png"; } });
console.log(User.is({ name: "Ada" }));
console.log(User.is(accessor));
console.log(User.is(inherited));
console.log(User.is(optionalAccessor));
try { User.parse(accessor); } catch (error) { console.log(error.name); }
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\nfalse\nValidationError\n0\n");
});

test("type checker rejects incompatible assignments", () => {
  const result = compile(`
let score: number = 1
score = "wrong"
`.trimStart());

  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => item.code === "VEL4001" && /string/.test(item.message)));
});

test("emits explicit JavaScript imports without leaking import markers", () => {
  // D90 R17: the unsafe binding is unknown, so the module references it
  // without calling through the boundary; the emission under test is the
  // import line itself.
  const result = compile(`
import js unsafe {randomUUID} from "node:crypto"

const id = randomUUID == null
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /import \{ randomUUID \} from "node:crypto";/);
  assert.doesNotMatch(result.code ?? "", /import js/);
});

test("JSON resource imports are explicit unknown values and preserve contextual json bindings", () => {
  const source = `
import json catalog from "./catalog.json"

print(catalog)
`.trimStart();
  const inspection = inspectModule(source, { path: "main.vel" });
  const result = compile(source, { path: "main.vel" });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(inspection.resources, [{ source: "./catalog.json", kind: "json" }]);
  assert.equal(inspection.dependencies[0]?.resource, "json");
  assert.match(result.code ?? "", /import catalog from "\.\/catalog\.json\.js";/u);

  const unsafeAssumption = compile('import json catalog from "./catalog.json"\nconst name: string = catalog\n');
  assert.ok(unsafeAssumption.diagnostics.some((diagnostic) => /Cannot assign unknown to string/u.test(diagnostic.message)));

  const contextual = inspectModule('import json from "./module.vel"\nprint(json)\n');
  assert.deepEqual(contextual.resources, []);
  assert.equal(contextual.dependencies[0]?.resource, undefined);
  assert.equal(contextual.dependencies[0]?.specifiers[0]?.local, "json");
});

test("a standalone build bundles a checked relative JSON resource", async () => {
  const directory = await makeTemporaryDirectory("velar-standalone-json-");
  const entry = join(directory, "main.vel");
  const output = join(directory, "main.js");
  await writeFile(join(directory, "catalog.json"), JSON.stringify({ name: "standalone" }), "utf8");
  await writeFile(entry, `
import json rawCatalog from "./catalog.json"

type Catalog:
    readonly name: string

print(Catalog.parse(rawCatalog).name)
`.trimStart(), "utf8");
  const build = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", entry, "--out", output], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, String(build.stderr));
  const execution = spawnSync(process.execPath, [output], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "standalone\n");
});

test("type-checks literal dynamic VelarScript imports and lazy components", async () => {
  const directory = await makeTemporaryDirectory("velar-dynamic-import-");
  const mainPath = join(directory, "main.vel");
  const pagePath = join(directory, "page.vel");
  const stablePath = join(directory, "stable.vel");
  await writeFile(pagePath, `
export def label(value: number) -> string:
    return f"Page {value}"

export component Page(title: string):
    return <main><h1>{title}</h1></main>
`.trimStart(), "utf8");
  await writeFile(stablePath, "export const stable = \"stable\"\n", "utf8");
  await writeFile(mainPath, `
import {lazy} from "velar/web"
import {stable} from "./stable.vel"

component Loading:
    return <p>Loading</p>

const Page = lazy(() => import("./page.vel"), "Page", Loading)

async def loadLabel() -> string:
    const feature = await import("./page.vel")
    return feature.label(42)

component App:
    return <section><Page title={stable} /></section>

mount(<App />, "#app")
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.equal(project.modules.length, 3);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.match(main.result.code ?? "", /import\("\.\/page\.js"\)/u);
  assert.ok(main.result.dependencies.some((dependency) => dependency.dynamic && dependency.source === "./page.vel"));
  const dynamicPathOffset = main.result.source.text.indexOf("./page.vel") + 3;
  assert.deepEqual(projectDefinitionAt(project, mainPath, dynamicPathOffset), { path: pagePath, span: { start: 0, end: 0 } });

  const rebuilt = await compileProject(mainPath, new Map(), {}, project, new Set([pagePath]));
  assert.equal(rebuilt.stats.compiledModules, 2);
  assert.equal(rebuilt.stats.reusedModules, 1);
});

test("dynamic imports fail closed for unchecked paths, missing exports, and reactive modules", async () => {
  for (const source of [
    'const module = import("feature-package")\n',
    'const module = import("./feature.js")\n',
    'const path = "./feature.vel"\nconst module = import(path)\n',
  ]) {
    const result = compile(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2014" || /literal relative \.vel path/u.test(item.message)), source);
  }

  const directory = await makeTemporaryDirectory("velar-dynamic-refusal-");
  const mainPath = join(directory, "main.vel");
  await writeFile(join(directory, "feature.vel"), "export const value = 42\n", "utf8");
  await writeFile(mainPath, `
import {lazy} from "velar/web"
const Missing = lazy(() => import("./feature.vel"), "Missing")
`.trimStart(), "utf8");
  const missing = await compileProject(mainPath);
  assert.ok(missing.modules.some((module) => module.inputPath === mainPath
    && module.result.diagnostics.some((item) => /no export named 'Missing'/u.test(item.message))));

  await writeFile(join(directory, "feature.vel"), "export component Feature:\n    return <p>Feature</p>\n", "utf8");
  await writeFile(mainPath, `
import {lazy} from "velar/web"
component BadLoading(label: string):
    return <p>{label}</p>
component BadFailure(message: string):
    return <p>{message}</p>
const Feature = lazy(() => import("./feature.vel"), "Feature", BadLoading, BadFailure)
`.trimStart(), "utf8");
  const fallbacks = await compileProject(mainPath);
  const fallbackDiagnostics = fallbacks.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics ?? [];
  assert.ok(fallbackDiagnostics.some((item) => /loading fallback cannot require props/u.test(item.message)));
  assert.ok(fallbackDiagnostics.some((item) => /failure fallback must accept error: Error/u.test(item.message)));

  await writeFile(join(directory, "feature.vel"), "export state value = 42\nexport component Feature:\n    return <p>Feature</p>\n", "utf8");
  await writeFile(mainPath, 'const module = import("./feature.vel")\n', "utf8");
  const reactive = await compileProject(mainPath);
  assert.ok(reactive.failures.some((failure) => /exports reactive values/u.test(failure.message)));
});

test("production builds emit separately verified chunks for lazy VelarScript components", async () => {
  const directory = await makeTemporaryDirectory("velar-dynamic-build-");
  const output = join(directory, "dist");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(directory, "page.vel"), `
export component Page:
    return <main><h1>Split page</h1></main>
`.trimStart(), "utf8");
  await writeFile(join(directory, "main.vel"), `
import {lazy} from "velar/web"
const Page = lazy(() => import("./page.vel"), "Page")
component App:
    return <Page />
@main: mount(<App />, "#app")
`.trimStart(), "utf8");
  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts", "build", directory, "--out-dir", output,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  const assets = await readdir(join(output, "assets"));
  const entry = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  const chunk = assets.find((name) => /^chunk-page-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(entry && chunk, JSON.stringify(assets));
  assert.doesNotMatch(await readFile(join(output, "assets", entry), "utf8"), /Split page/u);
  assert.match(await readFile(join(output, "assets", chunk), "utf8"), /Split page/u);
  const manifest = JSON.parse(await readFile(join(output, "velar-build.json"), "utf8")) as {
    modules: { total: number };
    assets: Array<{ path: string; role: string }>;
  };
  assert.equal(manifest.modules.total, 2);
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${chunk}` && asset.role === "asset"));
  await verifyProductionBuild(output);
});
