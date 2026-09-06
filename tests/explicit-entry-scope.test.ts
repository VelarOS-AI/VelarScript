import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { BUILD_OUTPUT_RECEIPT } from "../packages/cli/src/build-output-directory.ts";
import { applyProjectMechanicalFixes } from "../packages/cli/src/mechanical-fixer.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { checkedProjectForCommand } from "../packages/cli/src/project-check-command.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function runCli(root: string, ...arguments_: readonly string[]) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

test("explicit nested check, build, and fix exclude configured workers outside their source scope", async () => {
  const root = await makeTemporaryDirectory("velar-explicit-entry-scope-");
  const worker = 'export def one(value: string) -> bool:\n    return value === "one"\n';
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/main.vel",
      outDir: "dist",
      workers: { outside: "workers/outside.vel" },
    }, null, 2)}\n`,
    "src/main.vel": "export const mainValue = 1\n",
    "src/nested/tool.vel": "export const toolValue = 2\n",
    "workers/outside.vel": worker,
  });

  const scoped = await resolveVelarProject("src/nested/tool.vel", root);
  assert.equal(scoped.workerEntries.size, 0);
  assert.equal(runCli(root, "check", "src/nested/tool.vel").status, 0);
  const built = runCli(root, "build", "src/nested/tool.vel", "--out", "single/tool.js", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(await readFile(join(root, "single", "tool.js"), "utf8"), /toolValue/u);
  const fixed = runCli(root, "fix", "src/nested/tool.vel");
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.equal(await readFile(join(root, "workers", "outside.vel"), "utf8"), worker);

  const whole = runCli(root, "check");
  assert.equal(whole.status, 1, whole.stdout + whole.stderr);
  assert.match(whole.stderr, /'workers\.outside' must stay inside the entry source directory/u);
});

test("API project resolution retains explicit source scope independently of process cwd", async () => {
  const root = await makeTemporaryDirectory("velar-explicit-entry-api-cwd-");
  const worker = 'export def one(value: string) -> bool:\n    return value === "one"\n';
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/main.vel",
      outDir: "dist",
      workers: { outside: "src/outside.vel" },
    }, null, 2)}\n`,
    "src/main.vel": "export const mainValue = 1\n",
    "src/nested/tool.vel": "export const toolValue = 2\n",
    "src/outside.vel": worker,
  });

  // The API's cwd is deliberately not process.cwd(): downstream commands must
  // retain what the resolver selected instead of resolving this relative input
  // a second time against the ambient process directory.
  const config = await resolveVelarProject("src/nested/tool.vel", root);
  assert.equal(config.explicitSourcePath, join(root, "src", "nested", "tool.vel"));

  const checked = await checkResolvedProject(config, "src/nested/tool.vel");
  assert.deepEqual(checked.errors, []);
  assert.deepEqual([...checked.compiled], [join(root, "src", "nested", "tool.vel")]);

  const fixed = await applyProjectMechanicalFixes(config, "src/nested/tool.vel", (path) => path);
  assert.deepEqual(fixed.changedFiles, []);
  assert.equal(await readFile(join(root, "src", "outside.vel"), "utf8"), worker);

  const built = await checkedProjectForCommand("build", config, {
    input: "src/nested/tool.vel",
    output: "single/tool.js",
    outputDirectory: null,
    sourceMaps: null,
  });
  assert.equal(built.exitCode, 0);
  assert.ok(built.checked);
  assert.deepEqual([...built.checked.compiled], [join(root, "src", "nested", "tool.vel")]);

  for (const projectInput of [null, ".", "velar.json"] as const) {
    const project = await resolveVelarProject(projectInput, root);
    assert.equal(project.explicitSourcePath, null);
    const rejected = await checkedProjectForCommand("build", project, {
      input: projectInput,
      output: "single/tool.js",
      outputDirectory: null,
      sourceMaps: null,
    });
    assert.equal(rejected.exitCode, 2);
    assert.equal(rejected.error, "--out requires an explicit .vel source input");
  }
});

test("an explicit project source cannot replace the complete declared output by default", async () => {
  const root = await makeTemporaryDirectory("velar-explicit-project-output-");
  await writeTree(root, {
    "velar.json": `${JSON.stringify({
      formatVersion: 2,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
    }, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: "explicit-project-output",
      version: "1.0.0",
      private: true,
      type: "module",
      exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
      velar: {
        entry: "src/index.vel",
        entries: { "./worker": "src/worker.vel" },
        targets: ["core"],
        requires: { capabilities: [] },
      },
    }, null, 2)}\n`,
    "src/index.vel": "export const mainValue = 1\n",
    "src/worker.vel": "export const workerValue = 2\n",
  });

  const complete = runCli(root, "build", "--mode", "readable");
  assert.equal(complete.status, 0, complete.stdout + complete.stderr);
  const workerOutput = await readFile(join(root, "dist", "worker.js"), "utf8");

  const ambiguous = runCli(root, "build", "src/index.vel");
  assert.equal(ambiguous.status, 2, ambiguous.stdout + ambiguous.stderr);
  assert.match(ambiguous.stderr, /explicit \.vel source inside a project cannot replace the project's declared outDir/u);
  assert.equal(await readFile(join(root, "dist", "worker.js"), "utf8"), workerOutput);

  await symlink("dist", join(root, "dist-alias"), "dir");
  for (const outputDirectory of ["dist", "./dist/../dist", "dist-alias"]) {
    const replacing = runCli(root, "build", "src/index.vel", "--out-dir", outputDirectory, "--mode", "readable");
    assert.equal(replacing.status, 2, replacing.stdout + replacing.stderr);
    assert.match(replacing.stderr, /cannot replace the project's declared outDir/u);
    assert.equal(await readFile(join(root, "dist", "worker.js"), "utf8"), workerOutput);
  }
  const crossCwd = runCli(dirname(root), "build", join(root, "src", "index.vel"), "--out-dir", join(root, "dist"));
  assert.equal(crossCwd.status, 2, crossCwd.stdout + crossCwd.stderr);
  assert.match(crossCwd.stderr, /cannot replace the project's declared outDir/u);
  assert.equal(await readFile(join(root, "dist", "worker.js"), "utf8"), workerOutput);

  const scopedDirectory = runCli(root, "build", "src/index.vel", "--out-dir", "scoped", "--mode", "readable");
  assert.equal(scopedDirectory.status, 0, scopedDirectory.stdout + scopedDirectory.stderr);
  assert.deepEqual((await readdir(join(root, "scoped"))).sort(), [BUILD_OUTPUT_RECEIPT, "index.js"]);
});

test("a bare source file retains its default directory build", async () => {
  const root = await makeTemporaryDirectory("velar-explicit-bare-output-");
  await writeTree(root, { "main.vel": "print(\"ready\")\n" });

  const built = runCli(root, "build", "main.vel", "--mode", "readable");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(await readFile(join(root, "dist", "main.js"), "utf8"), /ready/u);
});
