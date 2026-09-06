import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test, { after } from "node:test";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { requiredCompilerRuntimeModules } from "../../packages/cli/src/compiler-runtime-modules.ts";
import { writeNodeCompilerRuntimeResolverBootstrap } from "../../packages/cli/src/node-compiler-runtime-resolver.ts";
import { checkResolvedProject } from "../../packages/cli/src/project-check.ts";
import { writeNodeStandardModuleSandbox } from "../../packages/cli/src/standard-module-sandbox.ts";
import {
  compiledTestModulePath,
  createCompiledSandbox,
  removeCompiledSandbox,
  writeCompiledTestProject,
} from "../../packages/cli/src/test-output.ts";
import {
  cliPath,
  createFrozenCompilerRuntimeLibrary,
  createGenericFrozenRuntimeConsumer,
  frozenRuntimePackageName,
  linkFrozenCompilerRuntimeLibrary,
  runCli,
} from "../support/frozen-artifact.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("frozen compiler runtime roots survive generic build, run, and test", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-runtime-node-");
  const library = await createFrozenCompilerRuntimeLibrary(root);
  const consumer = await createGenericFrozenRuntimeConsumer(root, library);
  const config = await resolveVelarProject(consumer);
  const checked = await checkResolvedProject(config, config.entryPath);
  assert.deepEqual(checked.errors, []);
  const artifact = [...checked.project.velarArtifactImports.values()][0]!;
  assert.deepEqual(artifact.compilerRuntimeModules, ["velar/hash"]);
  assert.equal(Object.isFrozen(artifact.compilerRuntimeModules), true);
  assert.equal(requiredCompilerRuntimeModules(checked.project).has("velar/hash"), true);

  const ran = runCli(["run"], consumer);
  assert.equal(ran.status, 0, `${ran.stdout}${ran.stderr}`);
  assert.equal(ran.stdout, "artifact-runtime\n");
  const tested = runCli(["test"], consumer);
  assert.equal(tested.status, 0, `${tested.stdout}${tested.stderr}`);
  assert.match(tested.stdout, /frozen artifact compiler runtime/u);

  const release = join(root, "generic-release");
  const built = runCli(["build", "--out-dir", release, "--mode", "readable"], consumer);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await readFile(join(release, "node_modules", "velar", "hash.js"), "utf8");
  await rm(library, { recursive: true, force: true });
  await rm(consumer, { recursive: true, force: true });
  const deployed = join(root, "generic-deployed");
  await rename(release, deployed);
  const executed = spawnSync(process.execPath, [join(deployed, "main.js")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout, "artifact-runtime\n");
});

test("sandbox execution uses authenticated frozen bytes after the installed artifact changes", async () => {
  const root = await makeTemporaryDirectory("velar-frozen-runtime-snapshot-");
  const library = await createFrozenCompilerRuntimeLibrary(root);
  const consumer = await createGenericFrozenRuntimeConsumer(root, library);
  const config = await resolveVelarProject(consumer);
  const checked = await checkResolvedProject(config, config.entryPath);
  assert.deepEqual(checked.errors, []);
  const { project } = checked;
  const entry = project.modules.find((module) => module.inputPath === project.entryPath)!;
  const artifact = [...project.velarArtifactImports.values()][0]!;
  const sandbox = await createCompiledSandbox(consumer, "run");
  try {
    const runtimeModules = requiredCompilerRuntimeModules(project);
    await writeNodeStandardModuleSandbox(sandbox, config, runtimeModules);
    await writeCompiledTestProject(project, sandbox, true, runtimeModules);
    const resolver = await writeNodeCompilerRuntimeResolverBootstrap(
      sandbox,
      runtimeModules,
      project.velarArtifactImports.values(),
    );
    await writeFile(
      artifact.entrySnapshot.path,
      artifact.entrySnapshot.code.replaceAll("artifact-runtime", "tampered-runtime"),
      "utf8",
    );
    const executed = spawnSync(process.execPath, [
      "--enable-source-maps",
      "--import",
      resolver,
      compiledTestModulePath(project, entry, sandbox),
    ], { cwd: consumer, encoding: "utf8" });
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(executed.stdout, "artifact-runtime\n");
  } finally {
    await removeCompiledSandbox(sandbox);
  }
});

test("Node directory and serve route frozen compiler runtimes through owned output", async (context) => {
  const root = await makeTemporaryDirectory("velar-frozen-runtime-server-");
  const library = await createFrozenCompilerRuntimeLibrary(root);
  const project = join(root, "node-app");
  const created = runCli(["create", project, "--template", "node"], root);
  assert.equal(created.status, 0, `${created.stdout}${created.stderr}`);
  await linkFrozenCompilerRuntimeLibrary(project, library);
  const mainPath = join(project, "src", "main.vel");
  const original = await readFile(mainPath, "utf8");
  await writeFile(mainPath, [
    `import {artifactLabel} from "${frozenRuntimePackageName}"`,
    original.replace("@main:\n", "@main:\n    print(artifactLabel())\n"),
  ].join("\n"), "utf8");
  const port = await availablePort();
  await writeFile(join(project, "application.yml"), [
    "server:",
    "  host: 127.0.0.1",
    `  port: ${port}`,
    "  maxBodyBytes: 16777216",
    "",
  ].join("\n"), "utf8");

  const serving = spawn(process.execPath, [cliPath, "serve", project], {
    cwd: project,
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => stop(serving));
  await waitForOutput(serving, "artifact-runtime");
  await stop(serving);

  const release = join(root, "node-release");
  const built = runCli(["build", project, "--out-dir", release, "--mode", "readable"], root);
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await readFile(join(release, "node_modules", "velar", "hash.js"), "utf8");
  await rm(library, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
  const deployed = join(root, "node-deployed");
  await rename(release, deployed);
  const production = spawn(process.execPath, [join(deployed, "main.js")], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => stop(production));
  await waitForOutput(production, "artifact-runtime");
  await stop(production);
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForOutput(child: ChildProcess, expected: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${JSON.stringify(expected)} in ${output}`)), 30_000);
    const consume = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (!output.includes(expected)) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("exit", (code) => {
      if (output.includes(expected)) return;
      clearTimeout(timer);
      reject(new Error(`Node serve exited with ${String(code)} before ${JSON.stringify(expected)}: ${output}`));
    });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}
