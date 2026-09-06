import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { VELAR_PROJECT_FORMAT_VERSION } from "../../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { argumentsFirstCliRunner } from "../support/run-cli.ts";

after(removeTemporaryDirectories);

const cli = new URL("../../packages/cli/src/cli.ts", import.meta.url).pathname;

const runCli = argumentsFirstCliRunner({ timeout: 300_000, environment: { NODE_OPTIONS: "--preserve-symlinks" } });

async function writeDependency(root: string, version: string, label: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "deep-dep",
    version,
    type: "module",
    exports: "./index.js",
  }), "utf8");
  await writeFile(join(root, "index.js"), [
    "let calls = 0;",
    `export function dependencyLabel() { calls += 1; return ${JSON.stringify(label)} + "-" + String(calls); }`,
    "",
  ].join("\n"), "utf8");
}

async function writeFrozenLibrary(
  root: string,
  packageName: string,
  dependencyVersion: string,
  dependencyLabel: string,
): Promise<{ readonly artifactPath: string; readonly code: string }> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeDependency(join(root, "node_modules", "deep-dep"), dependencyVersion, dependencyLabel);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    dependencies: { "deep-dep": dependencyVersion },
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }), "utf8");
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "deep-dep":',
    "    export def dependencyLabel() -> string",
    "",
    'import js {dependencyLabel} from "deep-dep"',
    "",
    "export def frozenLabel() -> string:",
    "    return dependencyLabel()",
    "",
  ].join("\n"), "utf8");
  const built = runCli(["build-library", root, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  const artifactPath = join(root, "dist", "index.js");
  const code = await readFile(artifactPath, "utf8");
  assert.match(code, /from "deep-dep"/u);
  return { artifactPath, code };
}

test("run, test, and portable builds preserve nested npm dependency owners", async () => {
  const root = await makeTemporaryDirectory("velar-artifact-nested-dependency-");
  const firstLibrary = join(root, "library-one");
  const secondLibrary = join(root, "library-two");
  const consumer = join(root, "consumer");
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  const firstArtifact = await writeFrozenLibrary(firstLibrary, "frozen-nested-one", "1.0.0", "nested-one");
  const secondArtifact = await writeFrozenLibrary(secondLibrary, "frozen-nested-two", "2.0.0", "nested-two");
  await writeDependency(join(consumer, "node_modules", "deep-dep"), "3.0.0", "consumer");

  await symlink(firstLibrary, join(consumer, "node_modules", "frozen-nested-one"), "dir");
  await symlink(secondLibrary, join(consumer, "node_modules", "frozen-nested-two"), "dir");
  await writeFile(join(consumer, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    entry: "main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }), "utf8");
  await writeFile(join(consumer, "main.vel"), [
    'import {frozenLabel as firstLabel} from "frozen-nested-one"',
    'import {frozenLabel as secondLabel} from "frozen-nested-two"',
    'print(f"{firstLabel()}|{secondLabel()}")',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(consumer, "nested.test.vel"), [
    'import {expect} from "velar/test"',
    'import {frozenLabel as firstLabel} from "frozen-nested-one"',
    'import {frozenLabel as secondLabel} from "frozen-nested-two"',
    "",
    'test "each artifact keeps its own nested dependency version":',
    '    expect(f"{firstLabel()}|{secondLabel()}").toBe("nested-one-1|nested-two-1")',
    "",
  ].join("\n"), "utf8");
  const ran = runCli(["run"], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "nested-one-1|nested-two-1\n", "run must preserve both owners' nested versions");
  const tested = runCli(["test"], consumer);
  assert.equal(tested.status, 0, `${tested.stdout}${tested.stderr}`);
  assert.match(tested.stdout, /each artifact keeps its own nested dependency version/u);
  const frameworkFreeOutput = join(root, "generic-release");
  const frameworkFreeBuild = runCli(["build", "--out-dir", frameworkFreeOutput, "--mode", "readable"], consumer);
  assert.equal(frameworkFreeBuild.status, 0, `${frameworkFreeBuild.stdout}${frameworkFreeBuild.stderr}`);

  const nodeConsumer = join(root, "node-consumer");
  const created = runCli(["create", nodeConsumer, "--template", "node"], root);
  assert.equal(created.status, 0, `${created.stdout}${created.stderr}`);
  await mkdir(join(nodeConsumer, "node_modules"), { recursive: true });
  await symlink(firstLibrary, join(nodeConsumer, "node_modules", "frozen-nested-one"), "dir");
  await symlink(secondLibrary, join(nodeConsumer, "node_modules", "frozen-nested-two"), "dir");
  await writeDependency(join(nodeConsumer, "node_modules", "deep-dep"), "3.0.0", "consumer");
  await writeFile(join(nodeConsumer, "src", "main.vel"), [
    'import {frozenLabel as firstLabel} from "frozen-nested-one"',
    'import {frozenLabel as secondLabel} from "frozen-nested-two"',
    '@main: print(f"{firstLabel()}|{secondLabel()}")',
    "",
  ].join("\n"), "utf8");
  const nodeOutput = join(root, "node-release");
  const nodeBuild = runCli(["build", "--out-dir", nodeOutput, "--mode", "readable"], nodeConsumer);
  assert.equal(nodeBuild.status, 0, `${nodeBuild.stdout}${nodeBuild.stderr}`);
  assert.equal(await readFile(firstArtifact.artifactPath, "utf8"), firstArtifact.code, "artifact consumption must not rewrite the first source package");
  assert.equal(await readFile(secondArtifact.artifactPath, "utf8"), secondArtifact.code, "artifact consumption must not rewrite the second source package");

  await rm(firstLibrary, { recursive: true, force: true });
  await rm(secondLibrary, { recursive: true, force: true });
  await rm(consumer, { recursive: true, force: true });
  await rm(nodeConsumer, { recursive: true, force: true });
  const frameworkFreeDeployment = join(root, "generic-deployed");
  const nodeDeployment = join(root, "node-deployed");
  await rename(frameworkFreeOutput, frameworkFreeDeployment);
  await rename(nodeOutput, nodeDeployment);

  const frameworkFreeRuntime = spawnSync(process.execPath, [join(frameworkFreeDeployment, "main.js")], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(frameworkFreeRuntime.status, 0, frameworkFreeRuntime.stderr);
  assert.equal(frameworkFreeRuntime.stdout, "nested-one-1|nested-two-1\n", "generic output must preserve both owners' nested versions");
  const nodeRuntime = spawnSync(process.execPath, [join(nodeDeployment, "main.js")], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(nodeRuntime.status, 0, nodeRuntime.stderr);
  assert.equal(nodeRuntime.stdout, "nested-one-1|nested-two-1\n", "Node output must preserve both owners' nested versions");
});
