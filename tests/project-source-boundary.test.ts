import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { projectSessionDiagnostics } from "../packages/cli/src/project-session-diagnostics.ts";

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

test("check, build, run, fix, sessions, and LSP diagnostics share the entry source boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-project-source-boundary-"));
  const entry = join(root, "src", "main.vel");
  const escaped = join(root, "shared.vel");
  const write = async (path: string, source: string): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
  };
  const run = (...arguments_: readonly string[]) => spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  try {
    await write(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
    })}\n`);
    await write(entry, 'import {shared} from "../shared.vel"\n\nprint(shared)\n');
    await write(escaped, "export const shared = 42\n");

    for (const command of [["check", "."], ["build", "."], ["run", "."], ["fix", "."]] as const) {
      const result = run(...command);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /cannot escape the entry source directory/u);
    }

    const config = await resolveVelarProject(".", root);
    const widenedOutputLayout = await checkResolvedProject(config, ".", { sourceRoot: root });
    assert.ok(widenedOutputLayout.errors.some((message) =>
      message.includes("cannot escape the entry source directory")),
    "changing emitted path layout must not widen the project's physical source boundary");

    const snapshot = await new VelarProjectSessions().snapshot(escaped);
    assert.ok(snapshot.project.modules.find((module) => module.inputPath === entry)?.result.diagnostics
      .some((diagnostic) => diagnostic.code === "VEL6001"
        && diagnostic.message.includes("cannot escape the entry source directory")));
    assert.ok(projectSessionDiagnostics(snapshot, entry).some((diagnostic) => diagnostic.code === "VEL6001"
      && diagnostic.message.includes("cannot escape the entry source directory")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicit project tool may import project sources but cannot escape the manifest root", async () => {
  const container = await mkdtemp(join(tmpdir(), "velar-explicit-project-tool-boundary-"));
  const root = join(container, "project");
  const tool = join(root, "tools", "check-generated.vel");
  const outside = join(container, "outside.vel");
  const write = async (path: string, source: string): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
  };
  const run = (...arguments_: readonly string[]) => spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  try {
    await write(join(root, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
    })}\n`);
    await write(join(root, "src", "main.vel"), "export const application = true\n");
    await write(join(root, "src", "generated-value.vel"), "export const generatedValue = 42\n");
    await write(tool, [
      'import {generatedValue} from "../src/generated-value.vel"',
      "print(generatedValue)",
      "",
    ].join("\n"));

    for (const command of [
      ["check", "tools/check-generated.vel"],
      ["build", "tools/check-generated.vel", "--out-dir", "single", "--mode", "readable"],
      ["fix", "tools/check-generated.vel"],
    ] as const) {
      const result = run(...command);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const executed = run("run", "tools/check-generated.vel");
    assert.equal(executed.status, 0, executed.stdout + executed.stderr);
    assert.match(executed.stdout, /42/u);

    await write(outside, "export const escaped = 42\n");
    await write(tool, [
      'import {escaped} from "../../outside.vel"',
      "print(escaped)",
      "",
    ].join("\n"));
    for (const command of [
      ["check", "tools/check-generated.vel"],
      ["build", "tools/check-generated.vel", "--out-dir", "single", "--mode", "readable"],
      ["run", "tools/check-generated.vel"],
      ["fix", "tools/check-generated.vel"],
    ] as const) {
      const result = run(...command);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /cannot escape the entry source directory/u);
    }

    await symlink(outside, join(root, "src", "linked.vel"));
    await write(tool, [
      'import {escaped} from "../src/linked.vel"',
      "print(escaped)",
      "",
    ].join("\n"));
    const linked = run("run", "tools/check-generated.vel");
    assert.equal(linked.status, 1, linked.stdout + linked.stderr);
    assert.match(linked.stderr, /cannot escape the entry source directory/u);

    const bareRoot = join(container, "bare");
    await write(join(bareRoot, "src", "value.vel"), "export const value = 42\n");
    await write(join(bareRoot, "tools", "run.vel"), [
      'import {value} from "../src/value.vel"',
      "print(value)",
      "",
    ].join("\n"));
    const bare = spawnSync(process.execPath, [cli, "run", "tools/run.vel"], {
      cwd: bareRoot,
      encoding: "utf8",
      timeout: 120_000,
    });
    assert.equal(bare.status, 1, `${bare.stdout}${bare.stderr}`);
    assert.match(bare.stderr, /cannot escape the entry source directory/u);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
});
