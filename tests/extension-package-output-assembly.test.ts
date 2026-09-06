import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

test("a nested extension package assembles source resource and runtime exports in sandbox and build", async () => {
  const root = await makeTemporaryDirectory("velar-extension-source-assembly-");
  const name = "@fixture/source-extension";
  const wrapperName = "@fixture/source-wrapper";
  const wrapperRoot = join(root, "node_modules", ...wrapperName.split("/"));
  await writeWrapperPackage(wrapperRoot, wrapperName, name);
  const packageRoot = join(wrapperRoot, "node_modules", ...name.split("/"));
  await writeExtensionPackage(packageRoot, name, `${name}/runtime`, {
    artifacts: false,
    runtimeSource: 'export const runtimeLabel = "runtime";\n',
  });
  await symlink(packageRoot, join(root, "node_modules", ...name.split("/")), "dir");
  await writeTree(root, {
    "velar.json": projectManifest(name),
    "main.vel": [
      `import {wrappedLabel} from ${JSON.stringify(wrapperName)}`,
      "",
      "@main: print(wrappedLabel)",
      "",
    ].join("\n"),
  });

  const ran = runCli(root, "run");
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(ran.stdout, "runtime/resource\n");

  const built = runCli(root, "build", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const manifest = await outputManifest(root, name);
  assert.deepEqual(manifest.exports, {
    ".": "./src/index.js",
    "./metadata": "./data/metadata.json.js",
    "./runtime": "./runtime.js",
  });
  assert.equal(manifest.velarGeneratedRuntime, 1);
  const executed = runNode(join(root, "dist", "main.js"), join(root, "dist"));
  assert.equal(executed.status, 0, executed.stdout + executed.stderr);
  assert.equal(executed.stdout, "runtime/resource\n");
});

test("a nested extension package assembles frozen resource and runtime exports in sandbox and build", async () => {
  const root = await makeTemporaryDirectory("velar-extension-frozen-assembly-");
  const library = join(root, "library");
  const compilerInstall = join(root, "compiler-install");
  const consumer = join(root, "consumer");
  const name = "@fixture/frozen-extension";
  const wrapperName = "@fixture/frozen-wrapper";
  await writeExtensionPackage(library, name, `${name}/runtime`, {
    artifacts: true,
    runtimeSource: 'export const runtimeLabel = "frozen-runtime";\n',
  });
  await writeExtensionPackage(compilerInstall, name, `${name}/runtime`, {
    artifacts: false,
    runtimeSource: 'export const runtimeLabel = "frozen-runtime";\n',
  });
  await writeTree(library, {"velar.json": libraryManifest(name)});
  await mkdir(join(library, "node_modules", "@fixture"), {recursive: true});
  await symlink(compilerInstall, join(library, "node_modules", "@fixture", "frozen-extension"), "dir");
  const libraryBuild = runCli(library, "build-library");
  assert.equal(libraryBuild.status, 0, libraryBuild.stdout + libraryBuild.stderr);
  await addArtifactRuntimeImport(library, `${name}/runtime`);

  const wrapperRoot = join(consumer, "node_modules", ...wrapperName.split("/"));
  await writeWrapperPackage(wrapperRoot, wrapperName, name);
  const nestedPackage = join(wrapperRoot, "node_modules", ...name.split("/"));
  await cp(library, nestedPackage, {recursive: true});
  await symlink(nestedPackage, join(consumer, "node_modules", ...name.split("/")), "dir");
  await writeTree(consumer, {
    "velar.json": projectManifest(name),
    "main.vel": [
      `import {wrappedLabel} from ${JSON.stringify(wrapperName)}`,
      "",
      "@main: print(wrappedLabel)",
      "",
    ].join("\n"),
  });

  const ran = runCli(consumer, "run");
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(ran.stdout, "frozen-runtime/resource\n");
  const built = runCli(consumer, "build", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const manifest = await outputManifest(consumer, name);
  assert.equal(manifest.exports["."], "./dist/index.js", JSON.stringify(manifest));
  assert.equal(manifest.exports["./runtime"], "./runtime.js");
  const executed = runNode(join(consumer, "dist", "main.js"), join(consumer, "dist"));
  assert.equal(executed.status, 0, executed.stdout + executed.stderr);
  assert.equal(executed.stdout, "frozen-runtime/resource\n");
});

test("extension source and runtime file collisions fail before replacing the prior build", async () => {
  const root = await makeTemporaryDirectory("velar-extension-assembly-collision-");
  const name = "@fixture/colliding-extension";
  const packageRoot = join(root, "node_modules", ...name.split("/"));
  await writeExtensionPackage(packageRoot, name, `${name}/src/index`, {
    artifacts: false,
    runtimeSource: 'export const runtimeLabel = "collision";\n',
  });
  await writeTree(root, {
    "velar.json": projectManifest(name),
    "main.vel": `import {packageLabel} from ${JSON.stringify(name)}\n\n@main: print(packageLabel)\n`,
  });
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "sentinel.txt"), "prior output\n", "utf8");

  const rejected = runCli(root, "build", "--mode", "readable");
  assert.equal(rejected.status, 1, rejected.stdout + rejected.stderr);
  assert.match(rejected.stderr, /Standard runtime module .* conflicts with compiled module/u);
  assert.equal(await readFile(join(root, "dist", "sentinel.txt"), "utf8"), "prior output\n");
});

test("a third-party runtime package named ws stays separate from velar websocket dependency", async () => {
  const root = await makeTemporaryDirectory("velar-extension-ws-owner-");
  const name = "ws";
  await writeExtensionPackage(join(root, "node_modules", name), name, `${name}/runtime`, {
    artifacts: false,
    runtimeSource: 'export const runtimeLabel = "extension-ws";\n',
  });
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      outDir: "dist",
      extensions: ["@velarscript/node", name],
    }, null, 2)}\n`,
    "main.vel": [
      `import {packageLabel} from ${JSON.stringify(name)}`,
      'import {listen} from "velar/websocket"',
      "",
      "@main:",
      "    const runtimeListen = listen",
      "    print(packageLabel)",
      "",
    ].join("\n"),
  });

  for (const command of [["check"], ["run"], ["build", "--mode", "readable"]] as const) {
    const result = runCli(root, ...command);
    assert.equal(result.status, 0, `${command.join(" ")}\n${result.stdout}${result.stderr}`);
    if (command[0] === "run") assert.equal(result.stdout, "extension-ws/resource\n");
  }
  const extensionManifest = await outputManifest(root, name);
  assert.equal(extensionManifest.exports["."], "./src/index.js");
  assert.equal(extensionManifest.exports["./runtime"], "./runtime.js");
  const dependencyManifest = JSON.parse(await readFile(
    join(root, "dist", "node_modules", "velar", "node_modules", "ws", "package.json"), "utf8",
  )) as {readonly name?: unknown};
  assert.equal(dependencyManifest.name, "ws");
  const executed = runNode(join(root, "dist", "main.js"), join(root, "dist"));
  assert.equal(executed.status, 0, executed.stdout + executed.stderr);
  assert.equal(executed.stdout, "extension-ws/resource\n");
});

interface ExtensionPackageOptions {
  readonly artifacts: boolean;
  readonly runtimeSource: string;
}

async function writeWrapperPackage(root: string, name: string, dependency: string): Promise<void> {
  await writeTree(root, {
    "package.json": `${JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      dependencies: {[dependency]: "1.0.0"},
      velar: {
        entry: "src/index.vel",
        targets: ["core"],
        requires: {capabilities: []},
      },
    }, null, 2)}\n`,
    "src/index.vel": [
      `import {packageLabel} from ${JSON.stringify(dependency)}`,
      "",
      "export const wrappedLabel = packageLabel",
      "",
    ].join("\n"),
  });
}

async function writeExtensionPackage(
  root: string,
  name: string,
  runtime: string,
  options: ExtensionPackageOptions,
): Promise<void> {
  await writeTree(root, {
    "package.json": `${JSON.stringify({
      name,
      version: "1.0.0",
      private: true,
      type: "module",
      exports: {
        ".": "./dist/index.js",
        "./compiler": "./compiler.js",
        "./metadata": "./data/metadata.json",
      },
      velar: {
        entry: "src/index.vel",
        ...(options.artifacts ? {artifacts: {core: "dist/velar-library.json"}} : {}),
        resources: {"./metadata": {path: "data/metadata.json", type: "json"}},
        targets: ["core"],
        requires: {capabilities: []},
        extension: {kind: "capability", apiVersion: "1.0", extends: {}},
      },
    }, null, 2)}\n`,
    "compiler.js": compilerExtension(name, runtime, options.runtimeSource),
    "data/metadata.json": '{"label":"resource"}\n',
    "src/index.vel": [
      `import {runtimeLabel} from ${JSON.stringify(runtime)}`,
      `import json metadata from ${JSON.stringify(`${name}/metadata`)}`,
      "",
      "type Metadata:",
      "    readonly label: string",
      "",
      "export const packageLabel = runtimeLabel + \"/\" + Metadata.parse(metadata).label",
      "",
    ].join("\n"),
  });
}

function compilerExtension(name: string, runtime: string, source: string): string {
  return [
    "const runtimeInterface = Object.freeze({",
    '  exports:new Map([["runtimeLabel",Object.freeze({kind:"string"})]]),',
    "  mutableExports:new Set(),reactiveExports:new Map(),reExports:new Map(),",
    "  namedTypes:new Map(),namedTypeIdentities:new Map(),typeAliases:new Map(),",
    "  enums:new Map(),classes:new Map(),tests:[],extensionExports:new Map(),extensionData:new Map(),",
    "});",
    `export const velarCompilerExtension = Object.freeze({id:${JSON.stringify(name)},`,
    '  contract:Object.freeze({protocolVersion:1,apiVersion:"1.0",kind:"capability",extends:Object.freeze({})}),',
    `  modules:Object.freeze({apiVersion:"1.0",interfaces:new Map([[${JSON.stringify(runtime)},runtimeInterface]]),`,
    `    sources:new Map([[${JSON.stringify(runtime)},${JSON.stringify(source)}]]),dependencies:new Map()}),`,
    "});",
    "",
  ].join("\n");
}

function projectManifest(extension: string): string {
  return `${JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    outDir: "dist",
    extensions: [extension],
  }, null, 2)}\n`;
}

function libraryManifest(extension: string): string {
  return `${JSON.stringify({
    formatVersion: 2,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    extensions: [extension],
  }, null, 2)}\n`;
}

async function addArtifactRuntimeImport(library: string, runtime: string): Promise<void> {
  const receiptPath = join(library, "dist", "velar-library.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
    readonly entry?: ArtifactEntry;
    readonly entries?: Record<string, ArtifactEntry>;
  };
  const entry = receipt.entries?.["."] ?? receipt.entry;
  if (!entry) throw new Error("Frozen assembly fixture has no root artifact entry");
  const javascriptPath = join(library, "dist", entry.javascript);
  const javascript = [
    `import {runtimeLabel as __runtimeLabel} from ${JSON.stringify(runtime)};`,
    "String(__runtimeLabel);",
    await readFile(javascriptPath, "utf8"),
  ].join("\n");
  await writeFile(javascriptPath, javascript, "utf8");
  entry.sha256.javascript = createHash("sha256").update(javascript).digest("hex");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

interface ArtifactEntry {
  readonly javascript: string;
  readonly sha256: {javascript: string};
}

async function outputManifest(root: string, name: string): Promise<{
  readonly exports: Readonly<Record<string, string>>;
  readonly velarGeneratedRuntime?: number;
}> {
  return JSON.parse(await readFile(join(root, "dist", "node_modules", ...name.split("/"), "package.json"), "utf8"));
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, contents, "utf8");
  }
}

function runCli(cwd: string, ...arguments_: readonly string[]): {readonly status: number | null; readonly stdout: string; readonly stderr: string} {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {cwd, encoding: "utf8", timeout: 300_000});
  return {status: result.status, stdout: String(result.stdout), stderr: String(result.stderr)};
}

function runNode(path: string, cwd: string): {readonly status: number | null; readonly stdout: string; readonly stderr: string} {
  const result = spawnSync(process.execPath, [path], {cwd, encoding: "utf8", timeout: 30_000});
  return {status: result.status, stdout: String(result.stdout), stderr: String(result.stderr)};
}
