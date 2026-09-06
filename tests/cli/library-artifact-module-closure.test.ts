import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  assertVelarLibraryArtifactModuleClosure,
  assertVelarLibraryArtifactStaticDeployment,
} from "../../packages/cli/src/library-artifact-module-closure.ts";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "../../packages/cli/src/library-artifact-snapshot.ts";
import { compileProject } from "../../packages/cli/src/project.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { argumentsFirstCliRunner } from "../support/run-cli.ts";

after(removeTemporaryDirectories);

const cli = new URL("../../packages/cli/src/cli.ts", import.meta.url).pathname;

function snapshot(path: string, code: string): VelarLibraryArtifactJavaScriptSnapshot {
  return { path, code, sourceMapPath: `${path}.map`, sourceMap: "{}\n" };
}

const runCli = argumentsFirstCliRunner({ timeout: 300_000 });

test("artifact module closure accepts only receipt-covered relative ESM edges", () => {
  const root = join(process.cwd(), ".artifact-closure-fixture");
  const entry = snapshot(join(root, "index.js"), [
    'import { shared } from "./__velar_chunks/shared.js";',
    'export { run } from "./worker.js";',
    "export const root = shared;",
    "",
  ].join("\n"));
  const worker = snapshot(join(root, "worker.js"), [
    'import "external-package";',
    "export async function run() {",
    "  return import(`./__velar_chunks/shared.js`);",
    "}",
    "",
  ].join("\n"));
  const chunk = snapshot(join(root, "__velar_chunks", "shared.js"), "export const shared = 1;\n");
  const external = assertVelarLibraryArtifactModuleClosure([entry, worker, chunk], "closed-package", "core");
  assert.deepEqual([...external], ["external-package"]);
});

test("artifact module closure permits only exact compiler-owned package-self runtime edges", () => {
  const root = join(process.cwd(), ".artifact-closure-self-runtime");
  const module = snapshot(
    join(root, "index.js"),
    'import "@fixture/runtime-owner/runtime";\n',
  );
  assert.deepEqual(
    [...assertVelarLibraryArtifactModuleClosure(
      [module],
      "@fixture/runtime-owner",
      "core",
      new Set(["@fixture/runtime-owner/runtime"]),
    )],
    ["@fixture/runtime-owner/runtime"],
  );
  assert.throws(
    () => assertVelarLibraryArtifactModuleClosure(
      [module],
      "@fixture/runtime-owner",
      "core",
      new Set(["@fixture/runtime-owner/other"]),
    ),
    /retains package-owned import '@fixture\/runtime-owner\/runtime'/u,
  );
});

test("artifact module closure checks every static edge form and rejects computed dynamic imports", () => {
  const root = join(process.cwd(), ".artifact-closure-invalid");
  const cases = [
    ['import "./extra.js";', /imports relative module '\.\/extra\.js'.*absent from the receipt entries and chunks/u],
    ['export { value } from "./extra.js";', /imports relative module '\.\/extra\.js'.*absent from the receipt entries and chunks/u],
    ['export * from "./extra.js";', /imports relative module '\.\/extra\.js'.*absent from the receipt entries and chunks/u],
    ['void import("./extra.js");', /imports relative module '\.\/extra\.js'.*absent from the receipt entries and chunks/u],
    ['import "#internal";', /retains package-owned import '#internal'/u],
    ['export * from "invalid-package/helper";', /retains package-owned import 'invalid-package\/helper'/u],
    ['import "/absolute/module.js";', /unsupported module specifier '\/absolute\/module\.js'/u],
    ['import "C:/absolute/module.js";', /unsupported module specifier 'C:\/absolute\/module\.js'/u],
    ['import "file:\/\/\/absolute\/module.js";', /unsupported module specifier 'file:\/\/\/absolute\/module\.js'/u],
    ['import "https:\/\/example.test/module.js";', /unsupported module specifier 'https:\/\/example\.test\/module\.js'/u],
    ['import "package\\\\module";', /unsupported module specifier 'package\\module'/u],
    ['import "external-package/../escape";', /unsupported module specifier 'external-package\/\.\.\/escape'/u],
    ['import "data:text/plain,export const value = 1";', /retains data URL import/u],
    ['import "data:text/javascript,import%20%22node%3Afs%22";', /build-library must inline data JavaScript/u],
    ['const name = "extra"; void import(`./${name}.js`);', /uses a computed dynamic import/u],
    ["export const = 1;", /contains invalid ESM/u],
  ] as const;
  for (const [code, expected] of cases) {
    assert.throws(
      () => assertVelarLibraryArtifactModuleClosure([snapshot(join(root, "index.js"), code)], "invalid-package", "core"),
      expected,
      code,
    );
  }
});

test("artifact production rejects opaque package loaders without changing ABI-1 loading", () => {
  const root = join(process.cwd(), ".artifact-closure-opaque-load");
  const cases = [
    ['const parser = require("hidden-package");', /uses opaque CommonJS require/u],
    ['const parser = (0, require)("hidden-package");', /uses opaque CommonJS require/u],
    ['const parser = (0, globalThis.require)("hidden-package");', /uses opaque CommonJS require/u],
    ['const parser = globalThis["require"]("hidden-package");', /uses opaque CommonJS require/u],
    ['const path = require.resolve("hidden-package");', /uses opaque CommonJS require/u],
    ['import { createRequire as makeRequire } from "node:module"; const load = makeRequire(import.meta.url); load("hidden-package");', /uses opaque createRequire/u],
    ['import * as moduleApi from "node:module"; const requireFrom = moduleApi.createRequire(import.meta.url);', /uses opaque createRequire/u],
    ['process.getBuiltinModule("node:module").createRequire(import.meta.url)("hidden-package");', /uses opaque process\.getBuiltinModule/u],
  ] as const;
  for (const [code, expected] of cases) {
    assert.throws(
      () => assertVelarLibraryArtifactStaticDeployment([snapshot(join(root, "index.js"), code)], "opaque-package"),
      expected,
      code,
    );
  }
  assert.doesNotThrow(() => assertVelarLibraryArtifactStaticDeployment([
    snapshot(join(root, "ordinary.js"), [
      'const label = "globalThis.require hidden-package";',
      "const validator = { require(value) { return value; } };",
      "validator.require(label);",
      "validator.createRequire();",
      "const process = { getBuiltinModule() {} };",
      'process.getBuiltinModule("local");',
      "",
    ].join("\n")),
  ], "ordinary-package"));
  assert.doesNotThrow(() => assertVelarLibraryArtifactModuleClosure([
    snapshot(join(root, "legacy.js"), 'if (false) globalThis.require("legacy-runtime");\n'),
  ], "legacy-package", "node"));
});

test("old ABI-1 opaque loaders remain checkable and runnable but cannot enter production output", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-legacy-loader-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await createLibrary(library);
  const built = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await addLegacyOpaqueLoader(library);
  const input = await createConsumer(consumer, library);
  const testInput = join(consumer, "legacy.test.vel");
  await writeFile(testInput, [
    'import {value} from "open-artifact-fixture"',
    "",
    'test "legacy ABI remains executable":',
    "    assert value() == 1",
    "",
  ].join("\n"), "utf8");

  const checked = runCli(["check", input], consumer);
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  const ran = runCli(["run", input], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.match(ran.stdout, /(?:^|\n)1(?:\n|$)/u);
  const tested = runCli(["test", testInput], consumer);
  assert.equal(tested.status, 0, `${tested.stdout}${tested.stderr}`);
  assert.match(tested.stdout, /legacy ABI remains executable/u);

  const application = join(root, "application.js");
  const production = runCli(["build", input, "--out", application], consumer);
  assert.equal(production.status, 1, `${production.stdout}${production.stderr}`);
  assert.match(`${production.stdout}${production.stderr}`, /uses opaque CommonJS require.*production deployment/u);
});

test("artifact module closure permits Node builtins only for Node artifacts", () => {
  const root = join(process.cwd(), ".artifact-closure-target");
  for (const specifier of ["node:fs", "fs/promises"]) {
    const module = snapshot(join(root, "index.js"), `import ${JSON.stringify(specifier)};\n`);
    assert.doesNotThrow(() => assertVelarLibraryArtifactModuleClosure([module], "node-package", "node"));
    assert.throws(
      () => assertVelarLibraryArtifactModuleClosure([module], "core-package", "core"),
      /Core Velar library artifact 'core-package'.*imports Node builtin/u,
    );
  }
});

test("the loader rejects a hash-valid artifact edge outside its receipt before commands diverge", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-module-closure-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await createLibrary(library);
  const built = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const entryPath = await addUnlistedArtifactModule(library);
  const input = await createConsumer(consumer, library);

  const checked = await compileProject(input, new Map(), { projectRoot: consumer });
  const loaderMessages = [
    ...checked.failures.map((failure) => failure.message),
    ...checked.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
  assert.match(loaderMessages, /imports relative module '\.\/extra\.js'.*absent from the receipt entries and chunks/u);

  for (const arguments_ of [
    ["check", input],
    ["run", input],
    ["build", input, "--out", join(root, "application.js")],
  ] as const) {
    const result = runCli(arguments_, consumer);
    assert.equal(result.status, 1, `${arguments_[0]} unexpectedly accepted the open artifact graph`);
    assert.match(`${result.stdout}${result.stderr}`, /imports relative module '\.\/extra\.js'.*absent from the receipt entries and chunks/u);
  }

  await truncate(entryPath, 16 * 1024 * 1024 + 1);
  const oversized = await compileProject(input, new Map(), { projectRoot: consumer });
  assert.match(projectMessages(oversized), /Velar library artifact JavaScript set exceeds 16777216 bytes/u);
});

test("the consumer rejects hash-valid artifacts with forbidden module specifier shapes", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-module-specifier-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  await createLibrary(library);
  const built = runCli(["build-library", library, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const input = await createConsumer(consumer, library);
  const receiptPath = join(library, "dist", "velar-library.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    entry: { javascript: string; sha256: { javascript: string } };
  };
  const entryPath = join(library, "dist", receipt.entry.javascript);
  const original = await readFile(entryPath, "utf8");
  const cases = [
    ["node:fs", /Core Velar library artifact.*imports Node builtin 'node:fs'/u],
    ["/absolute/module.js", /unsupported module specifier '\/absolute\/module\.js'/u],
    ["file:///absolute/module.js", /unsupported module specifier 'file:\/\/\/absolute\/module\.js'/u],
    ["https://example.test/module.js", /unsupported module specifier 'https:\/\/example\.test\/module\.js'/u],
    ["external-package/../escape", /unsupported module specifier 'external-package\/\.\.\/escape'/u],
    ["data:text/javascript,import%20%22node%3Afs%22", /build-library must inline data JavaScript/u],
    ["undeclared-runtime-package", /package\.json#dependencies does not declare 'undeclared-runtime-package'/u],
  ] as const;
  for (const [specifier, expected] of cases) {
    const code = insertBeforeSourceMap(original, `import ${JSON.stringify(specifier)};`);
    receipt.entry.sha256.javascript = createHash("sha256").update(code, "utf8").digest("hex");
    await Promise.all([
      writeFile(entryPath, code, "utf8"),
      writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    ]);
    const checked = await compileProject(input, new Map(), { projectRoot: consumer });
    assert.match(projectMessages(checked), expected, specifier);
  }
});

async function createLibrary(library: string): Promise<void> {
  await mkdir(join(library, "src"), { recursive: true });
  await writeFile(join(library, "package.json"), `${JSON.stringify({
    name: "open-artifact-fixture",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(library, "src", "index.vel"), [
    'extern module "data:text/javascript,export const inline = 1":',
    "    export const inline: number",
    'import js {inline} from "data:text/javascript,export const inline = 1"',
    "export def value() -> number: return inline",
    "",
  ].join("\n"), "utf8");
}

async function addUnlistedArtifactModule(library: string): Promise<string> {
  const receiptPath = join(library, "dist", "velar-library.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    entry: { javascript: string; sha256: { javascript: string } };
  };
  const entryPath = join(library, "dist", receipt.entry.javascript);
  const code = insertBeforeSourceMap(await readFile(entryPath, "utf8"), 'import "./extra.js";');
  receipt.entry.sha256.javascript = createHash("sha256").update(code, "utf8").digest("hex");
  await Promise.all([
    writeFile(entryPath, code, "utf8"),
    writeFile(join(library, "dist", "extra.js"), "globalThis.__unlistedArtifactModuleRan = true;\n", "utf8"),
    writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
  ]);
  return entryPath;
}

async function addLegacyOpaqueLoader(library: string): Promise<void> {
  const receiptPath = join(library, "dist", "velar-library.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    entry: { javascript: string; sha256: { javascript: string } };
  };
  const entryPath = join(library, "dist", receipt.entry.javascript);
  const code = insertBeforeSourceMap(
    await readFile(entryPath, "utf8"),
    'if (false) (0, globalThis.require)("legacy-runtime");',
  );
  receipt.entry.sha256.javascript = createHash("sha256").update(code, "utf8").digest("hex");
  await Promise.all([
    writeFile(entryPath, code, "utf8"),
    writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
  ]);
}

function insertBeforeSourceMap(code: string, statement: string): string {
  const directive = /\/\/# sourceMappingURL=[^\r\n]+\r?\n?$/u;
  if (!directive.test(code)) throw new Error("artifact fixture has no trailing source map directive");
  return code.replace(directive, `${statement}\n$&`);
}

function projectMessages(project: Awaited<ReturnType<typeof compileProject>>): string {
  return [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
}

async function createConsumer(consumer: string, library: string): Promise<string> {
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await symlink(library, join(consumer, "node_modules", "open-artifact-fixture"), "dir");
  const input = join(consumer, "main.vel");
  await writeFile(input, 'import {value} from "open-artifact-fixture"\nprint(value())\n', "utf8");
  return input;
}
