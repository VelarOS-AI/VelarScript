import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { checkVelarLibraryEntries, resolveVelarLibraryBuild, writeVelarLibraryArtifact } from "../packages/cli/src/library-artifact-build.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { projectPackageTarget } from "../packages/cli/src/project-package-target.ts";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function runCli(arguments_: readonly string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function writeNodeOnlyDependency(
  root: string,
  name: string,
  frozen: boolean,
): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "index.vel"), [
    `export def value() -> string: return ${JSON.stringify(name)}`,
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      ...(frozen ? { artifacts: { node: "dist/velar-library.json" } } : {}),
      targets: ["node"],
      requires: { capabilities: ["node"] },
    },
  }, null, 2)}\n`, "utf8");
  if (!frozen) return;

  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  const project = {
    ...await resolveVelarProject(root),
    compilerExtensions: [velarNodeCompilerExtension],
  };
  const library = await resolveVelarLibraryBuild(project);
  const checked = await checkVelarLibraryEntries(library, project.entryPath);
  assert.equal(checked.failed, false, checked.output);
  await writeVelarLibraryArtifact(library, checked.projects, library.outputRoot, "readable");
}

async function writeConfigBackedLibrary(root: string, target: "core" | "node"): Promise<{
  readonly entryPath: string;
  readonly frozenName: string;
  readonly sourceName: string;
}> {
  const sourceName = `matrix-${target}-node-source`;
  const frozenName = `matrix-${target}-node-frozen`;
  await mkdir(join(root, "src"), { recursive: true });
  await writeNodeOnlyDependency(join(root, "node_modules", sourceName), sourceName, false);
  await writeNodeOnlyDependency(join(root, "node_modules", frozenName), frozenName, true);
  const imports = [
    `import {value as sourceValue} from ${JSON.stringify(sourceName)}`,
    `import {value as frozenValue} from ${JSON.stringify(frozenName)}`,
  ];
  await writeFile(join(root, "src", "index.vel"), [
    ...imports,
    "export def combined() -> string:",
    '    return f"{sourceValue()}:{frozenValue()}"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "matrix.test.vel"), [
    'import {expect} from "velar/test"',
    ...imports,
    'test "package target follows the project configuration":',
    `    expect(sourceValue()).toBe(${JSON.stringify(sourceName)})`,
    `    expect(frozenValue()).toBe(${JSON.stringify(frozenName)})`,
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: `matrix-${target}-library`,
    version: "1.0.0",
    type: "module",
    dependencies: { [sourceName]: "1.0.0", [frozenName]: "1.0.0" },
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { [target]: "dist/velar-library.json" },
      targets: [target],
      requires: { capabilities: target === "node" ? ["node"] : [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: target === "node" ? ["@velarscript/node"] : [],
  }, null, 2)}\n`, "utf8");
  return { entryPath: join(root, "src", "index.vel"), frozenName, sourceName };
}

function projectMessages(project: Awaited<ReturnType<VelarProjectSessions["snapshot"]>>["project"]): string {
  return [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
}

test("build-library checks source and frozen dependencies against its exact artifact target", async () => {
  const root = await makeTemporaryDirectory("velar-library-artifact-target-");
  const libraryRoot = join(root, "library");
  const sourceName = "node-source-boundary";
  const frozenName = "node-frozen-boundary";
  await mkdir(join(libraryRoot, "src"), { recursive: true });
  await writeNodeOnlyDependency(join(libraryRoot, "node_modules", sourceName), sourceName, false);
  await writeNodeOnlyDependency(join(libraryRoot, "node_modules", frozenName), frozenName, true);
  await writeFile(join(libraryRoot, "src", "index.vel"), [
    'export def portable() -> string: return "portable"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(libraryRoot, "src", "node-only.vel"), [
    `import {value as sourceValue} from ${JSON.stringify(sourceName)}`,
    `import {value as frozenValue} from ${JSON.stringify(frozenName)}`,
    "export def combined() -> string:",
    '    return f"{sourceValue()}:{frozenValue()}"',
    "",
  ].join("\n"), "utf8");
  const packageManifest = {
    name: "library-artifact-target-boundary",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./dist/index.js",
      "./node-only": "./dist/node-only.js",
    },
    velar: {
      entry: "src/index.vel",
      entries: { "./node-only": "src/node-only.vel" },
      artifacts: { core: "dist/velar-library.json" } as Record<string, string>,
      targets: ["core", "node"],
      requires: { capabilities: [] },
    },
  };
  await writeFile(join(libraryRoot, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  await writeFile(join(libraryRoot, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");

  const coreProject = await resolveVelarProject(libraryRoot);
  const coreLibrary = await resolveVelarLibraryBuild(coreProject);
  const coreChecked = await checkVelarLibraryEntries(coreLibrary, coreProject.entryPath);
  assert.equal(coreChecked.failed, true);
  assert.match(coreChecked.output, new RegExp(`package '${sourceName}'.*does not support the 'core' target`, "u"));
  assert.match(coreChecked.output, new RegExp(`package '${frozenName}'.*does not support the 'core' target`, "u"));

  packageManifest.velar.artifacts = { node: "dist/velar-library.json" };
  await writeFile(join(libraryRoot, "package.json"), `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");
  const nodeProject = {
    ...await resolveVelarProject(libraryRoot),
    compilerExtensions: [velarNodeCompilerExtension],
  };
  const nodeLibrary = await resolveVelarLibraryBuild(nodeProject);
  const nodeChecked = await checkVelarLibraryEntries(nodeLibrary, nodeProject.entryPath);
  assert.equal(nodeChecked.failed, false, nodeChecked.output);
  const checkedNodeEntry = nodeChecked.projects.get("./node-only");
  assert.ok(checkedNodeEntry);
  assert.equal(checkedNodeEntry.velarArtifactImports.size, 1, "the Node build selects the frozen Node artifact");
  assert.ok(checkedNodeEntry.modules.some((module) => module.inputPath.endsWith(`/node_modules/${sourceName}/src/index.vel`)),
    "the Node build accepts and compiles the Node-only source dependency");
});

test("config-backed commands share Core and Node library package targets", async () => {
  const root = await makeTemporaryDirectory("velar-library-command-target-");
  const applicationRoot = join(root, "extension-free-application");
  const coreRoot = join(root, "core-library");
  const nodeRoot = join(root, "node-library");
  await writeConfigBackedLibrary(applicationRoot, "core");
  const core = await writeConfigBackedLibrary(coreRoot, "core");
  const node = await writeConfigBackedLibrary(nodeRoot, "node");
  await writeFile(join(applicationRoot, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "application",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");
  assert.equal(projectPackageTarget(await resolveVelarProject(applicationRoot)), "node");
  assert.equal(projectPackageTarget(await resolveVelarProject(coreRoot)), "core");
  assert.equal(projectPackageTarget(await resolveVelarProject(nodeRoot)), "node");
  const applicationCheck = runCli(["check", applicationRoot], root);
  assert.equal(applicationCheck.status, 0, applicationCheck.stderr);

  for (const command of ["check", "run", "test", "fix", "build-library"] as const) {
    const rejected = runCli([command, coreRoot], root);
    assert.equal(rejected.status, 1, `${command} unexpectedly accepted a Core library's Node-only dependencies\n${rejected.stdout}${rejected.stderr}`);
    assert.match(rejected.stderr, new RegExp(`package '${core.sourceName}'.*does not support the 'core' target`, "u"));
    assert.match(rejected.stderr, new RegExp(`package '${core.frozenName}'.*does not support the 'core' target`, "u"));

    const accepted = runCli([command, nodeRoot], root);
    assert.equal(accepted.status, 0, `${command} unexpectedly rejected a Node library\n${accepted.stdout}${accepted.stderr}`);
  }

  const sessions = new VelarProjectSessions();
  const coreSnapshot = await sessions.snapshot(core.entryPath);
  assert.match(projectMessages(coreSnapshot.project), /does not support the 'core' target/u);
  const nodeSnapshot = await sessions.snapshot(node.entryPath);
  assert.equal(projectMessages(nodeSnapshot.project), "");
});
