import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import type { CompilerExtension, ModuleInterface } from "@velarscript/compiler";
import type { FrameworkHostExtension } from "@velarscript/compiler/framework-host";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { createFrameworkArtifacts } from "../../packages/cli/src/framework-host.ts";
import { bundleVelarLibraryEntry } from "../../packages/cli/src/library-artifact-bundle.ts";
import { buildProductionFramework } from "../../packages/cli/src/production-build.ts";
import { compileProject } from "../../packages/cli/src/project.ts";
import { standardModuleAsset, standardModuleRoute } from "../../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

const extensionName = "@fixture/browser-runtime";
const runtimeSpecifier = `${extensionName}/runtime`;
const helperSpecifier = `${extensionName}/internal/helper`;
const sentinel = "extension-runtime-browser-ok";

function moduleInterface(exports: ReadonlyMap<string, unknown> = new Map()): ModuleInterface {
  return {
    exports: exports as ModuleInterface["exports"],
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes: new Map(),
    namedTypeIdentities: new Map(),
    typeAliases: new Map(),
    enums: new Map(),
    classes: new Map(),
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

function browserRuntimeExtension(capabilities: readonly string[] = ["web"]): CompilerExtension {
  return {
    id: extensionName,
    contract: { protocolVersion: 1, apiVersion: "1.0", kind: "capability", extends: {} },
    capabilities,
    modules: {
      apiVersion: "1.0",
      interfaces: new Map([[runtimeSpecifier, moduleInterface(new Map([
        ["runtimeValue", { kind: "string" }],
      ]))]]),
      sources: new Map([
        [runtimeSpecifier, `import {helperValue} from ${JSON.stringify(helperSpecifier)};\nexport const runtimeValue = helperValue;\n`],
        [helperSpecifier, `export const helperValue = ${JSON.stringify(sentinel)};\n`],
      ]),
      dependencies: new Map([[runtimeSpecifier, [helperSpecifier]]]),
    },
  };
}

const fixtureHost: FrameworkHostExtension = {
  protocolVersion: 3,
  id: "fixture-browser-host",
  capability: "web",
  displayName: "Fixture browser host",
  target: "browser",
  apiVersion: "1.0",
  artifactKind: "fixture-browser-build",
  base: () => "/",
  createArtifacts: (input) => ({
    entryModule: `/${input.entryPath}`,
    css: input.styles,
    html: `<script type="importmap">${JSON.stringify({ imports: input.imports })}</script>`,
  }),
  createErrorDocument: ({ errors }) => errors.join("\n"),
  staticDeployment: () => ({ base: "/", spaFallback: false, contentSecurityPolicy: null }),
};

test("compiler-owned package modules have canonical traversal-proof development routes", () => {
  const extension = browserRuntimeExtension();
  const route = standardModuleRoute(runtimeSpecifier);
  assert.match(route, /^\/@velar\/module\/[0-9a-f]+\.js$/u);
  assert.doesNotMatch(route, /@fixture|\.\.|%|\\/u);
  assert.equal(standardModuleAsset(route, {}, [extension]), extension.modules!.sources.get(runtimeSpecifier));
  assert.equal(standardModuleAsset(`${route.slice(0, -4)}0000.js`, {}, [extension]), null);
  assert.equal(standardModuleAsset("/@velar/module/002e002e002f006500730063006100700065.js", {}, [extension]), null);
  assert.equal(standardModuleAsset(`/@velar/module/${"0061".repeat(513)}.js`, {}, [extension]), null);
  assert.equal(standardModuleRoute("velar/json"), "/@velar/json.js");
  assert.throws(() => standardModuleRoute(""), /cannot be empty/u);
  assert.throws(() => standardModuleRoute("x".repeat(513)), /cannot exceed 512/u);
});

test("framework imports and browser production bundle extension-owned runtime modules", async () => {
  const root = await makeTemporaryDirectory("velar-extension-browser-runtime-");
  const entryPath = join(root, "main.vel");
  await writeFile(entryPath, [
    `import {runtimeValue} from ${JSON.stringify(runtimeSpecifier)}`,
    "@main:",
    "    print(runtimeValue)",
    "",
  ].join("\n"), "utf8");
  const extension = browserRuntimeExtension();
  const project = await compileProject(entryPath, new Map(), {
    sourceRoot: root,
    projectRoot: root,
    publicRoot: join(root, "public"),
    extensions: [extension],
    framework: { host: fixtureHost, config: {} },
    packageTarget: "web",
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const artifacts = createFrameworkArtifacts(project, true);
  assert.ok(artifacts);
  assert.match(artifacts.html, new RegExp(JSON.stringify(runtimeSpecifier).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(artifacts.html, new RegExp(standardModuleRoute(runtimeSpecifier).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

  const output = join(root, "production");
  const built = await buildProductionFramework(project, output, "readable");
  const javascript = await readFile(join(output, built.entryPath), "utf8");
  assert.match(javascript, new RegExp(sentinel, "u"));
  assert.doesNotMatch(javascript, new RegExp(`from ["']${runtimeSpecifier}`, "u"));
  assert.doesNotMatch(javascript, new RegExp(`from ["']${helperSpecifier}`, "u"));
});

test("library bundling treats extension-owned runtime modules as compiler input", async () => {
  const root = await makeTemporaryDirectory("velar-extension-library-runtime-");
  const entryPath = join(root, "library.vel");
  await writeFile(entryPath, [
    `import {runtimeValue} from ${JSON.stringify(runtimeSpecifier)}`,
    "export def libraryValue() -> string:",
    "    return runtimeValue",
    "",
  ].join("\n"), "utf8");
  const project = await compileProject(entryPath, new Map(), {
    sourceRoot: root,
    projectRoot: root,
    extensions: [browserRuntimeExtension([])],
    packageTarget: "core",
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const entry = project.modules.find((module) => module.inputPath === entryPath);
  assert.ok(entry);
  const bundled = await bundleVelarLibraryEntry(
    project,
    entry,
    "fixture-library",
    "core",
    join(root, "dist", "index.js"),
    "readable",
  );
  assert.match(bundled.code, new RegExp(sentinel, "u"));
  assert.doesNotMatch(bundled.code, new RegExp(`from ["']${runtimeSpecifier}`, "u"));
  assert.doesNotMatch(bundled.code, new RegExp(`from ["']${helperSpecifier}`, "u"));
});

async function writeExtensionPackage(root: string, name: string, modules: readonly string[]): Promise<void> {
  const packageRoot = join(root, "node_modules", ...name.split("/"));
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "capability", apiVersion: "1.0", extends: {} } },
  }), "utf8");
  await writeFile(join(packageRoot, "compiler.js"), [
    "const empty = Object.freeze({exports:new Map(),mutableExports:new Set(),reactiveExports:new Map(),reExports:new Map(),namedTypes:new Map(),namedTypeIdentities:new Map(),typeAliases:new Map(),enums:new Map(),classes:new Map(),tests:[],extensionExports:new Map(),extensionData:new Map()});",
    `const names = ${JSON.stringify(modules)};`,
    `export const velarCompilerExtension = Object.freeze({id:${JSON.stringify(name)},contract:Object.freeze({protocolVersion:1,apiVersion:"1.0",kind:"capability",extends:Object.freeze({})}),modules:Object.freeze({apiVersion:"1.0",interfaces:new Map(names.map(name => [name, empty])),sources:new Map(names.map(name => [name, "export {};\\n"]))})});`,
    "",
  ].join("\n"), "utf8");
}

async function resolveHostileExtension(name: string, modules: readonly string[]): Promise<PromiseSettledResult<unknown>> {
  const root = await makeTemporaryDirectory("velar-hostile-extension-");
  await writeFile(join(root, "main.vel"), "const ready = true\n", "utf8");
  await writeExtensionPackage(root, name, modules);
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [name] }), "utf8");
  const [result] = await Promise.allSettled([resolveVelarProject(root)]);
  return result!;
}

test("extension loading bounds and confines compiler-owned module namespaces", async () => {
  const cases: readonly [string, readonly string[], RegExp][] = [
    ["fixture-bare-velar", ["velar"], /the 'velar' package belongs to the language/u],
    ["fixture-foreign-runtime", ["victim-package/runtime"], /under its own npm package name/u],
    ["fixture-traversal-runtime", ["fixture-traversal-runtime/../victim"], /without wildcards or traversal/u],
    ["fixture-long-runtime", [`fixture-long-runtime/${"a".repeat(513)}`], /cannot exceed 512/u],
    ["fixture-many-runtime", Array.from({ length: 257 }, (_, index) => `fixture-many-runtime/module-${index}`), /cannot declare more than 256 modules/u],
  ];
  for (const [name, modules, message] of cases) {
    const result = await resolveHostileExtension(name, modules);
    assert.equal(result.status, "rejected", `${name} unexpectedly loaded`);
    assert.match(String((result as PromiseRejectedResult).reason), message);
  }

  const roots = Array.from({ length: 5 }, (_, index) => `fixture-total-runtime-${index}`);
  const root = await makeTemporaryDirectory("velar-extension-module-total-");
  await writeFile(join(root, "main.vel"), "const ready = true\n", "utf8");
  for (const name of roots) {
    await writeExtensionPackage(root, name, Array.from({ length: 205 }, (_, index) => `${name}/module-${index}`));
  }
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: roots }), "utf8");
  await assert.rejects(resolveVelarProject(root), /cannot declare more than 1024 modules in total/u);
});
