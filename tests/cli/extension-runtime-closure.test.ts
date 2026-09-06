import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import type {CompilerExtension} from "@velarscript/compiler";
import { variadicCliRunner } from "../support/run-cli.ts";
import {
  MAX_ACTIVE_EXTENSION_RUNTIME_DEPENDENCIES,
  MAX_ACTIVE_EXTENSION_RUNTIME_SOURCE_BYTES,
  MAX_EXTENSION_RUNTIME_DEPENDENCIES,
  MAX_EXTENSION_RUNTIME_MODULES,
  MAX_EXTENSION_RUNTIME_SOURCE_BYTES,
  snapshotExtensionRuntimeModules,
  validateExtensionRuntimeClosure,
} from "../../packages/cli/src/extension-runtime-closure.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");

test("project check rejects an extension runtime source with an ordinary npm edge", async () => {
  const root = await extensionProject(
    "fixture-closed-runtime",
    'import "ordinary-runtime-dependency"; export const ready = true;\n',
    [],
  );
  try {
    const checked = runCli(root, "check");
    assert.equal(checked.status, 1, checked.stdout + checked.stderr);
    assert.match(checked.stderr, /may import only active compiler-owned modules/u);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("project check accepts an explicitly declared active compiler-runtime edge", async () => {
  const root = await extensionProject(
    "fixture-compiler-runtime",
    'import {sha256Text} from "velar/hash"; export const digest = sha256Text("fixture");\n',
    ["velar/hash"],
  );
  try {
    const checked = runCli(root, "check");
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("project check rejects a third-party module interface without a runtime implementation", async () => {
  const root = await extensionProject(
    "fixture-missing-runtime",
    "",
    [],
    {publicInterface: true, runtimeSource: false},
  );
  try {
    const checked = runCli(root, "check");
    assert.equal(checked.status, 1, checked.stdout + checked.stderr);
    assert.match(checked.stderr, /module interface .* has no runtime source implementation/u);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test("third-party runtime imports are static, declared, and compiler-owned", () => {
  const module = "fixture-runtime/runtime";
  const active = new Set([module, "velar/hash"]);
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, 'import "velar/hash";\n')], active, "velar.json",
    ),
    /without declaring it in modules\.dependencies/u,
  );
  for (const source of [
    'import "./relative.js";',
    'import "data:text/javascript,export default 1";',
    'import "/absolute.js";',
    'import "node:fs";',
    'import "ordinary-package";',
  ]) {
    assert.throws(
      () => validateExtensionRuntimeClosure([extension(module, source)], active, "velar.json"),
      /may import only active compiler-owned modules/u,
    );
  }
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, 'const target = "velar/hash"; import(target);')], active, "velar.json",
    ),
    /computed dynamic import/u,
  );
  assert.throws(
    () => snapshotExtensionRuntimeModules({
      ...extension(module, "export const fallback = true;"),
      modules: {
        interfaces: new Map(),
        sources: new Map([[module, "export const fallback = true;"]]),
        source: () => "export const generated = true;",
      },
    }, "velar.json"),
    /cannot generate runtime module source dynamically/u,
  );
});

test("extension runtime snapshots detach package-owned Maps and dependency arrays", () => {
  const module = "fixture-runtime/runtime";
  const sourceMap = new Map([[module, "export const ready = true;"]]);
  const targets = ["velar/hash"];
  const dependencies = new Map<string, readonly string[]>([[module, targets]]);
  const snapshot = snapshotExtensionRuntimeModules(extensionWithSources(sourceMap, dependencies), "velar.json");
  sourceMap.set(module, 'import "ordinary-package";');
  targets[0] = "ordinary-package";
  assert.equal(snapshot.modules?.sources.get(module), "export const ready = true;");
  assert.deepEqual(snapshot.modules?.dependencies?.get(module), ["velar/hash"]);
  validateExtensionRuntimeClosure([snapshot], new Set([module, "velar/hash"]), "velar.json");
});

test("every third-party public compiler module has a runtime source", () => {
  const module = "fixture-runtime/public";
  const extensionWithMissingSource = snapshotExtensionRuntimeModules({
    id: "fixture-runtime",
    modules: {
      interfaces: new Map([[module, {}]]) as unknown as NonNullable<CompilerExtension["modules"]>["interfaces"],
      sources: new Map(),
    },
  }, "velar.json");
  assert.throws(
    () => validateExtensionRuntimeClosure([extensionWithMissingSource], new Set(), "velar.json"),
    /module interface 'fixture-runtime\/public' has no runtime source implementation/u,
  );
});

test("third-party runtime dependency declarations have bounded keys, targets, and totals", () => {
  const module = "fixture-runtime/runtime";
  const keyedSources = new Map(Array.from(
    {length: MAX_EXTENSION_RUNTIME_MODULES + 1},
    (_, index) => [`fixture-runtime/key-${index}`, ""] as const,
  ));
  const tooManyKeys = new Map([...keyedSources].map(([specifier]) => [specifier, []] as const));
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extensionWithSources(keyedSources, tooManyKeys)], new Set(keyedSources.keys()), "velar.json",
    ),
    /cannot declare more than 256 module keys/u,
  );
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, "", new Map([["fixture-runtime/missing", []]]))], new Set([module]), "velar.json",
    ),
    /dependencies key .* must identify one of its runtime module sources/u,
  );
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, "", new Map([[module, ["missing-runtime"]]]))], new Set([module]), "velar.json",
    ),
    /must identify an active compiler-owned runtime module/u,
  );
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, "", new Map([[module, "velar/hash"]]) as unknown as ReadonlyMap<string, readonly string[]>)],
      new Set([module, "velar/hash"]),
      "velar.json",
    ),
    /dependencies must be an array of module specifiers/u,
  );
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, "", new Map([[module, ["velar/hash", "velar/hash"]]]))],
      new Set([module, "velar/hash"]),
      "velar.json",
    ),
    /duplicate runtime dependency/u,
  );

  const targets = Array.from({length: MAX_EXTENSION_RUNTIME_DEPENDENCIES + 1}, (_, index) => `compiler/runtime-${index}`);
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, "", new Map([[module, targets]]))], new Set([module, ...targets]), "velar.json",
    ),
    /cannot declare more than 256 runtime dependencies/u,
  );

  const sharedTargets = targets.slice(0, MAX_EXTENSION_RUNTIME_DEPENDENCIES);
  const sources = new Map(Array.from(
    {length: Math.floor(MAX_ACTIVE_EXTENSION_RUNTIME_DEPENDENCIES / sharedTargets.length) + 1},
    (_, index) => [`fixture-runtime/runtime-${index}`, ""] as const,
  ));
  const dependencies = new Map([...sources].map(([specifier]) => [specifier, sharedTargets] as const));
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extensionWithSources(sources, dependencies)],
      new Set([...sources.keys(), ...sharedTargets]),
      "velar.json",
    ),
    /cannot declare more than 4096 dependency edges in total/u,
  );
});

test("third-party runtime source bytes have per-module and active-graph bounds", () => {
  const module = "fixture-runtime/runtime";
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extension(module, " ".repeat(MAX_EXTENSION_RUNTIME_SOURCE_BYTES + 1))], new Set([module]), "velar.json",
    ),
    /runtime source exceeds 1048576 bytes/u,
  );

  const count = Math.floor(MAX_ACTIVE_EXTENSION_RUNTIME_SOURCE_BYTES / MAX_EXTENSION_RUNTIME_SOURCE_BYTES) + 1;
  const sources = new Map(Array.from({length: count}, (_, index) => [
    `fixture-runtime/runtime-${index}`,
    " ".repeat(MAX_EXTENSION_RUNTIME_SOURCE_BYTES),
  ]));
  assert.throws(
    () => validateExtensionRuntimeClosure(
      [extensionWithSources(sources)], new Set(sources.keys()), "velar.json",
    ),
    /runtime module sources exceed 8388608 bytes in total/u,
  );
});

function extension(
  module: string,
  source: string,
  dependencies: ReadonlyMap<string, readonly string[]> = new Map(),
): CompilerExtension {
  return extensionWithSources(new Map([[module, source]]), dependencies);
}

function extensionWithSources(
  sources: ReadonlyMap<string, string>,
  dependencies: ReadonlyMap<string, readonly string[]> = new Map(),
): CompilerExtension {
  return {
    id: "fixture-runtime",
    modules: {interfaces: new Map(), sources, dependencies},
  };
}

async function extensionProject(
  name: string,
  source: string,
  dependencies: readonly string[],
  options: {readonly publicInterface: boolean; readonly runtimeSource: boolean} = {
    publicInterface: false,
    runtimeSource: true,
  },
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velar-extension-runtime-"));
  const packageRoot = join(root, "node_modules", name);
  const module = `${name}/runtime`;
  await mkdir(packageRoot, {recursive: true});
  await writeFile(join(root, "main.vel"), 'print("checked")\n', "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    extensions: [name],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    exports: {"./compiler": "./compiler.js"},
    velar: {extension: {kind: "capability", apiVersion: "1.0", extends: {}}},
  }, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "compiler.js"), [
    `const moduleName = ${JSON.stringify(module)};`,
    `const runtimeSource = ${JSON.stringify(source)};`,
    `const runtimeDependencies = ${JSON.stringify(dependencies)};`,
    `export const velarCompilerExtension = {`,
    `  id: ${JSON.stringify(name)},`,
    `  contract: {protocolVersion: 1, apiVersion: "1.0", kind: "capability", extends: {}},`,
    `  modules: {`,
    `    interfaces: new Map(${JSON.stringify(options.publicInterface ? [[module, {}]] : [])}),`,
    `    sources: new Map(${JSON.stringify(options.runtimeSource ? [[module, source]] : [])}),`,
    `    dependencies: new Map([[moduleName, runtimeDependencies]]),`,
    `  },`,
    `};`,
    "",
  ].join("\n"), "utf8");
  return root;
}

const runCli = variadicCliRunner({ timeout: 120_000 });
