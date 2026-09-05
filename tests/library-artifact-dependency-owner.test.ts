import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;
const deepDependencyName = "frozen-owner-deep-dep";
const frozenDependencyName = "frozen-owner-library-b";
const composedLibraryName = "frozen-owner-library-c";

function runCli(arguments_: readonly string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function writeJavaScriptDependency(root: string, version: string, label: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: deepDependencyName,
    version,
    type: "module",
    exports: "./index.js",
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "index.js"), [
    `export function dependencyLabel() { return ${JSON.stringify(label)}; }`,
    "",
  ].join("\n"), "utf8");
}

async function writeFrozenDependency(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeJavaScriptDependency(join(root, "node_modules", deepDependencyName), "1.0.0", "deep-one");
  await writeFile(join(root, "src", "shared.vel"), [
    `extern module ${JSON.stringify(deepDependencyName)}:`,
    "    export def dependencyLabel() -> string",
    `import js {dependencyLabel} from ${JSON.stringify(deepDependencyName)}`,
    "export def ownedLabel() -> string: return dependencyLabel()",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "index.vel"), [
    'import {ownedLabel} from "./shared.vel"',
    'export def label() -> string: return f"b:{ownedLabel()}"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "worker.vel"), [
    'import {ownedLabel} from "./shared.vel"',
    "export def workerLabel() -> string: return ownedLabel()",
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: frozenDependencyName,
    version: "1.0.0",
    type: "module",
    dependencies: { [deepDependencyName]: "1.0.0" },
    exports: {
      ".": "./dist/index.js",
      "./worker": "./dist/worker.js",
    },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeVelarConfig(root);
  const built = runCli(["build-library", root, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const receipt = JSON.parse(await readFile(join(root, "dist", "velar-library.json"), "utf8")) as {
    readonly chunks: readonly { readonly javascript: string }[];
  };
  assert.ok(receipt.chunks.length > 0, "B must exercise a receipt-authenticated relative chunk closure");
}

async function writeComposedLibrary(
  root: string,
  dependencyRoot: string,
  dependencyField: "dependencies" | "devDependencies" = "dependencies",
): Promise<ReturnType<typeof runCli>> {
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules"), { recursive: true });
  await cp(dependencyRoot, join(root, "node_modules", frozenDependencyName), { recursive: true });
  await writeFile(join(root, "src", "index.vel"), [
    `import {label} from ${JSON.stringify(frozenDependencyName)}`,
    'export def composedLabel() -> string: return f"c:{label()}"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: composedLibraryName,
    version: "1.0.0",
    type: "module",
    [dependencyField]: { [frozenDependencyName]: "1.0.0" },
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeVelarConfig(root);
  const built = runCli(["build-library", root, "--mode", "readable"], root);
  if (dependencyField === "dependencies") assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  return built;
}

async function writeVelarConfig(root: string): Promise<void> {
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
}

async function installWithoutNestedDependencies(source: string, destination: string): Promise<void> {
  await cp(source, destination, { recursive: true });
  await rm(join(destination, "node_modules"), { recursive: true, force: true });
}

test("a library keeps a frozen dependency's npm graph under the frozen package owner", async () => {
  const root = await makeTemporaryDirectory("velar-library-frozen-owner-");
  const dependency = join(root, "library-b");
  const composed = join(root, "library-c");
  const consumer = join(root, "consumer");
  await writeFrozenDependency(dependency);
  await writeComposedLibrary(composed, dependency);

  const composedOutput = await readFile(join(composed, "dist", "index.js"), "utf8");
  assert.match(composedOutput, new RegExp(`from ${JSON.stringify(frozenDependencyName)}`, "u"));
  assert.doesNotMatch(composedOutput, new RegExp(`from ${JSON.stringify(deepDependencyName)}`, "u"));

  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await installWithoutNestedDependencies(composed, join(consumer, "node_modules", composedLibraryName));
  await cp(dependency, join(consumer, "node_modules", frozenDependencyName), { recursive: true });
  await writeJavaScriptDependency(join(consumer, "node_modules", deepDependencyName), "2.0.0", "deep-two");
  const runtime = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import {composedLabel} from ${JSON.stringify(composedLibraryName)}; console.log(composedLabel());`,
  ], { cwd: consumer, encoding: "utf8", timeout: 120_000 });
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.equal(runtime.stdout, "c:b:deep-one\n", "B must resolve deep-dep@1 below B, never consumer-level deep-dep@2");
});

test("a frozen library retained by an artifact must be a runtime dependency", async () => {
  const root = await makeTemporaryDirectory("velar-library-frozen-runtime-owner-");
  const dependency = join(root, "library-b");
  const composed = join(root, "library-c");
  await writeFrozenDependency(dependency);
  const built = await writeComposedLibrary(composed, dependency, "devDependencies");
  assert.equal(built.status, 1, `${built.stdout}${built.stderr}`);
  assert.match(
    built.stderr,
    new RegExp(
      `retains runtime import '${frozenDependencyName}'.*package\\.json#dependencies does not declare '${frozenDependencyName}'`,
      "u",
    ),
  );
});
