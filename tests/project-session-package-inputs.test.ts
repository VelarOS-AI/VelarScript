import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { compileProject, projectImportKey, type ProjectResult } from "../packages/cli/src/project.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = new URL("../packages/cli/src/cli.ts", import.meta.url).pathname;

function diagnostics(project: ProjectResult): string {
  return [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
}

async function writeProjectManifest(
  root: string,
  entry = "main.vel",
  kind: "application" | "library" = "application",
): Promise<void> {
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind,
    entry,
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }), "utf8");
}

test("project sessions rebuild the package graph when velar.entries remaps a subpath", async () => {
  const root = await makeTemporaryDirectory("velar-session-package-entry-");
  const packageRoot = join(root, "node_modules", "session-source");
  const manifestPath = join(packageRoot, "package.json");
  const mainPath = join(root, "main.vel");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeProjectManifest(root);
  await writeFile(mainPath, 'import {value} from "session-source/worker"\nprint(value)\n', "utf8");
  await writeFile(join(packageRoot, "src", "index.vel"), "export const rootValue = 0\n", "utf8");
  await writeFile(join(packageRoot, "src", "a.vel"), "export const value = 1\n", "utf8");
  await writeFile(join(packageRoot, "src", "b.vel"), "export const value = 2\n", "utf8");
  const packageManifest = (worker: string): string => JSON.stringify({
    name: "session-source",
    version: "1.0.0",
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": worker },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  });
  await writeFile(manifestPath, packageManifest("src/a.vel"), "utf8");

  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  assert.equal(diagnostics(first.project), "");
  assert.equal(first.project.velarImports.get(projectImportKey(mainPath, "session-source/worker")), join(packageRoot, "src", "a.vel"));

  await writeFile(manifestPath, packageManifest("src/b.vel"), "utf8");
  const remapped = await sessions.snapshot(mainPath);
  assert.deepEqual([...remapped.changedPaths], [manifestPath]);
  assert.equal(diagnostics(remapped.project), "");
  assert.equal(remapped.project.velarImports.get(projectImportKey(mainPath, "session-source/worker")), join(packageRoot, "src", "b.vel"));
  assert.ok(remapped.project.modules.some((module) => module.inputPath === join(packageRoot, "src", "b.vel")));
  assert.ok(!remapped.project.modules.some((module) => module.inputPath === join(packageRoot, "src", "a.vel")));
  assert.equal(remapped.project.stats.reusedModules, 0, "a package manifest changes the resolution graph and forces a full rebuild");

  const stable = await sessions.snapshot(mainPath);
  assert.equal(stable.project, remapped.project, "the removed entry is no longer retained as a phantom session input");
});

test("project sessions track every frozen artifact file and incrementally reload bare JSON resources", async () => {
  const root = await makeTemporaryDirectory("velar-session-artifact-inputs-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  const packageName = "session-artifact";
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(library, "generated"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await writeFile(join(library, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js", "./data": "./generated/data.json" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      resources: { "./data": { path: "generated/data.json", type: "json" } },
      targets: ["core", "node"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  await writeProjectManifest(library, "src/index.vel", "library");
  await writeFile(join(library, "src", "index.vel"), 'export def libraryLabel() -> string: return "library"\n', "utf8");
  const resourcePath = join(library, "generated", "data.json");
  await writeFile(resourcePath, JSON.stringify({ label: "old" }), "utf8");
  const built = spawnSync(process.execPath, [cli, "build-library", library], { cwd: root, encoding: "utf8", timeout: 300_000 });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await symlink(library, join(consumer, "node_modules", packageName), "dir");
  await writeProjectManifest(consumer);
  const mainPath = join(consumer, "main.vel");
  const otherPath = join(consumer, "other.vel");
  await writeFile(mainPath, [
    `import {libraryLabel} from "${packageName}"`,
    `import json rawData from "${packageName}/data"`,
    "type Payload:",
    "    readonly label: string",
    "print(f\"{libraryLabel()}:{Payload.parse(rawData).label}\")",
    "",
  ].join("\n"), "utf8");
  await writeFile(otherPath, "export const untouched = 1\n", "utf8");

  const sessions = new VelarProjectSessions();
  let current = await sessions.snapshot(mainPath);
  assert.equal(diagnostics(current.project), "");
  const artifact = current.project.velarPackages[0]?.artifacts.get(".");
  const trackedResourcePath = current.project.resources.find((resource) => resource.packageSubpath === "./data")?.inputPath;
  assert.ok(artifact);
  assert.ok(trackedResourcePath);
  for (const [path, expected] of [
    [artifact.receiptPath, null],
    [artifact.entrySnapshot.path, /JavaScript hash mismatch/u],
    [artifact.entrySnapshot.sourceMapPath, /source map hash mismatch/u],
    [artifact.interfacePaths[0]!, /interface hash mismatch/u],
  ] as const) {
    const original = await readFile(path, "utf8");
    await writeFile(path, `${original}\n`, "utf8");
    const changed = await sessions.snapshot(mainPath);
    assert.deepEqual([...changed.changedPaths], [path]);
    assert.equal(changed.project.stats.reusedModules, 0, `${path} is a structural dependency input`);
    if (expected === null) assert.equal(diagnostics(changed.project), "");
    else assert.match(diagnostics(changed.project), expected);
    await writeFile(path, original, "utf8");
    current = await sessions.snapshot(mainPath);
    assert.equal(diagnostics(current.project), "");
  }

  const trackedSourceMapPath = artifact.entrySnapshot.sourceMapPath;
  const removedMap = await readFile(trackedSourceMapPath, "utf8");
  await unlink(trackedSourceMapPath);
  const removed = await sessions.update(mainPath, new Set([trackedSourceMapPath]));
  assert.deepEqual([...removed.changedPaths], [trackedSourceMapPath]);
  assert.notEqual(removed.project, current.project);
  assert.notEqual(diagnostics(removed.project), "");
  await writeFile(trackedSourceMapPath, removedMap, "utf8");
  current = await sessions.update(mainPath, new Set([trackedSourceMapPath]));
  assert.equal(diagnostics(current.project), "");

  const realMapPath = `${trackedSourceMapPath}.real`;
  await rename(trackedSourceMapPath, realMapPath);
  await symlink(realMapPath, trackedSourceMapPath);
  const linked = await sessions.snapshot(mainPath);
  assert.deepEqual([...linked.changedPaths], [trackedSourceMapPath]);
  assert.notEqual(linked.project, current.project, "a same-byte final symlink must rerun artifact authorization");
  assert.notEqual(diagnostics(linked.project), "");
  await unlink(trackedSourceMapPath);
  await rename(realMapPath, trackedSourceMapPath);
  current = await sessions.snapshot(mainPath);
  assert.equal(diagnostics(current.project), "");

  const untouched = current.project.modules.find((module) => module.inputPath === otherPath)?.result;
  await writeFile(resourcePath, JSON.stringify({ label: "new" }), "utf8");
  const resourceChanged = await sessions.snapshot(mainPath);
  assert.deepEqual([...resourceChanged.changedPaths], [trackedResourcePath]);
  assert.equal(diagnostics(resourceChanged.project), "");
  assert.equal(resourceChanged.project.resources.find((resource) => resource.inputPath === trackedResourcePath)?.content, '{"label":"new"}');
  assert.equal(resourceChanged.project.modules.find((module) => module.inputPath === otherPath)?.result, untouched);
  assert.equal(resourceChanged.project.stats.reusedModules, 1, "a resource edit only recompiles its importer closure");
});

test("incremental compilation reanalyzes a frozen artifact importer when any selected artifact input changes", async () => {
  const root = await makeTemporaryDirectory("velar-incremental-artifact-inputs-");
  const library = join(root, "library");
  const consumer = join(root, "consumer");
  const packageName = "incremental-artifact";
  await mkdir(join(library, "src"), { recursive: true });
  await mkdir(join(consumer, "node_modules"), { recursive: true });
  await writeFile(join(library, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core", "node"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  await writeProjectManifest(library, "src/index.vel", "library");
  const librarySource = join(library, "src", "index.vel");
  await writeFile(librarySource, "export const value: number = 1\n", "utf8");
  let built = spawnSync(process.execPath, [cli, "build-library", library], { cwd: root, encoding: "utf8", timeout: 300_000 });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  await symlink(library, join(consumer, "node_modules", packageName), "dir");
  const mainPath = join(consumer, "main.vel");
  await writeFile(mainPath, `import {value} from "${packageName}"\nconst exact: number = value\nprint(exact)\n`, "utf8");

  const first = await compileProject(mainPath, new Map(), { projectRoot: consumer });
  assert.equal(diagnostics(first), "");
  const artifact = first.velarPackages[0]?.artifacts.get(".");
  assert.ok(artifact);

  await writeFile(librarySource, 'export const value: string = "changed"\n', "utf8");
  built = spawnSync(process.execPath, [cli, "build-library", library], { cwd: root, encoding: "utf8", timeout: 300_000 });
  assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
  for (const changedPath of [artifact.receiptPath, artifact.entryPath, artifact.sourceMapPath, artifact.interfacePath]) {
    const changed = await compileProject(mainPath, new Map(), { projectRoot: consumer }, first, new Set([changedPath]));
    assert.match(diagnostics(changed), /Cannot assign string to number/u, changedPath);
    assert.equal(changed.stats.compiledModules, 1, changedPath);
    assert.equal(changed.stats.reusedModules, 0, changedPath);
    assert.equal(changed.stats.affectedModules, 1, changedPath);
  }
});
