import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { projectSessionDiagnostics } from "../packages/cli/src/project-session-diagnostics.ts";

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

test("check, build, fix, sessions, and LSP diagnostics share the entry source boundary", async () => {
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

    for (const command of [["check", "."], ["build", "."], ["fix", "."]] as const) {
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
    assert.ok(snapshot.project.failures.some((failure) => failure.path === entry
      && failure.message.includes("cannot escape the entry source directory")));
    assert.ok(projectSessionDiagnostics(snapshot, entry).some((diagnostic) => diagnostic.code === "VEL9001"
      && diagnostic.message.includes("cannot escape the entry source directory")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
