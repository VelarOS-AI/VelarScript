import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import type { CompilerExtension } from "@velarscript/compiler";
import { compilerRuntimeTargetViolation } from "../packages/cli/src/compiler-runtime-target.ts";
import { snapshotExtensionRuntimeModules } from "../packages/cli/src/extension-runtime-closure.ts";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import {
  createFrozenCompilerRuntimeLibrary,
  createGenericFrozenRuntimeConsumer,
  prependFrozenArtifactJavaScript,
  runCli,
} from "./frozen-artifact-runtime-fixture.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

test("Core compiler-runtime target metadata rejects direct, transitive, and target-owned modules", () => {
  const wrapper = "@fixture/portable-wrapper/runtime";
  const wrapperExtension = runtimeExtension("@fixture/portable-wrapper", [], wrapper, ["velar/fs"]);
  const transitive = compilerRuntimeTargetViolation(
    wrapper,
    "core",
    new Map(),
    [velarNodeCompilerExtension, wrapperExtension],
  );
  assert.deepEqual(transitive, { root: wrapper, source: "velar/fs", owner: "@velarscript/node" });
  assert.deepEqual(
    compilerRuntimeTargetViolation("velar/fs", "core", new Map(), []),
    { root: "velar/fs", source: "velar/fs", owner: "@velarscript/node" },
  );

  const nodeOwned = runtimeExtension("@fixture/node-runtime", ["node"], "@fixture/node-runtime/module", []);
  assert.deepEqual(
    compilerRuntimeTargetViolation("@fixture/node-runtime/module", "core", new Map(), [nodeOwned]),
    {
      root: "@fixture/node-runtime/module",
      source: "@fixture/node-runtime/module",
      owner: "@fixture/node-runtime",
    },
  );
  const portable = runtimeExtension("@fixture/portable-runtime", [], "@fixture/portable-runtime/module", []);
  assert.equal(
    compilerRuntimeTargetViolation("@fixture/portable-runtime/module", "core", new Map(), [portable]),
    null,
  );
  const customHost = runtimeExtension("@fixture/custom-host-runtime", ["device"], "@fixture/custom-host-runtime/module", []);
  assert.equal(
    compilerRuntimeTargetViolation("@fixture/custom-host-runtime/module", "core", new Map(), [customHost])?.owner,
    "@fixture/custom-host-runtime",
  );
  assert.equal(compilerRuntimeTargetViolation("velar/fs", "node", new Map(), []), null);
});

test("third-party runtime target capabilities are validated and snapshotted", () => {
  const capabilities = ["node"];
  const extension = runtimeExtension("@fixture/mutable-runtime", capabilities, "@fixture/mutable-runtime/module", []);
  const snapshot = snapshotExtensionRuntimeModules(extension, "/fixture/velar.json");
  capabilities.length = 0;
  assert.deepEqual(snapshot.capabilities, ["node"]);
  assert.equal(Object.isFrozen(snapshot.capabilities), true);
  assert.throws(
    () => snapshotExtensionRuntimeModules(
      runtimeExtension("@fixture/invalid-runtime", ["Not Normalized"], "@fixture/invalid-runtime/module", []),
      "/fixture/velar.json",
    ),
    /capabilities must use normalized capability names/u,
  );
});

test("a hash-valid Core artifact cannot smuggle a Node-only compiler runtime", async () => {
  const root = await makeTemporaryDirectory("velar-core-artifact-node-runtime-");
  const library = await createFrozenCompilerRuntimeLibrary(root);
  await prependFrozenArtifactJavaScript(library, 'import "velar/fs";');
  const consumer = await createGenericFrozenRuntimeConsumer(root, library);
  const checked = runCli(["check"], consumer);
  assert.equal(checked.status, 1, `${checked.stdout}${checked.stderr}`);
  assert.match(
    checked.stderr,
    /Core Velar library artifact '@fixture\/compiler-runtime-artifact' imports compiler runtime 'velar\/fs'.*requires target extension '@velarscript\/node'/u,
  );
});

test("a Node artifact may retain velar/fs across check, run, and directory build", async () => {
  const root = await makeTemporaryDirectory("velar-node-artifact-runtime-");
  const library = join(root, "node-library");
  const consumer = join(root, "consumer");
  const packageName = "@fixture/node-runtime-artifact";
  await writeNodeRuntimeLibrary(library, packageName);
  const libraryBuild = runCli(["build-library", "--mode", "readable"], library);
  assert.equal(libraryBuild.status, 0, `${libraryBuild.stdout}${libraryBuild.stderr}`);
  await prependFrozenArtifactJavaScript(library, 'import "velar/fs";');
  assert.match(await readFile(join(library, "dist", "index.js"), "utf8"), /"velar\/fs"/u);
  await writeNodeRuntimeConsumer(consumer, library, packageName);

  const checked = runCli(["check"], consumer);
  assert.equal(checked.status, 0, `${checked.stdout}${checked.stderr}`);
  const ran = runCli(["run"], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "node-runtime\n");
  const release = join(root, "release");
  const built = runCli(["build", "--out-dir", release, "--mode", "readable"], consumer);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await readFile(join(release, "node_modules", "velar", "fs.js"), "utf8");
  const executed = spawnSync(process.execPath, [join(release, "main.js")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "node-runtime\n");
});

function runtimeExtension(
  id: string,
  capabilities: readonly string[],
  module: string,
  dependencies: readonly string[],
): CompilerExtension {
  return {
    id,
    capabilities,
    modules: {
      interfaces: new Map(),
      sources: new Map([[module, "export const ready = true;\n"]]),
      dependencies: new Map([[module, dependencies]]),
    },
  };
}

async function writeNodeRuntimeLibrary(root: string, packageName: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.vel"), [
    'export def artifactLabel() -> string: return "node-runtime"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { node: "dist/velar-library.json" },
      targets: ["node"],
      requires: { capabilities: ["node"] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/node"],
  }, null, 2)}\n`, "utf8");
}

async function writeNodeRuntimeConsumer(root: string, library: string, packageName: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "@fixture"), { recursive: true });
  await symlink(library, join(root, "node_modules", "@fixture", "node-runtime-artifact"), "dir");
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n', "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "application",
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "main.vel"), [
    `import {artifactLabel} from ${JSON.stringify(packageName)}`,
    "print(artifactLabel())",
    "",
  ].join("\n"), "utf8");
}
