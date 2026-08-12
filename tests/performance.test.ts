import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";

test("application-scale incremental budget recompiles only the reverse dependency closure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-scale-"));
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "main.vel"), "import {value} from \"./chain-0.vel\"\nprint(value)\n", "utf8");

  const chainLength = 40;
  for (let index = 0; index < chainLength; index += 1) {
    const source = index === chainLength - 1
      ? "export const value = 1\n"
      : `import {value as next} from "./chain-${index + 1}.vel"\nexport const value = next\n`;
    await writeFile(join(directory, `chain-${index}.vel`), source, "utf8");
  }
  for (let index = 0; index < 80; index += 1) {
    await writeFile(join(directory, `independent-${index}.vel`), `export const value = ${index}\n`, "utf8");
  }

  const sessions = new VelarProjectSessions();
  const mainPath = join(directory, "main.vel");
  const first = await sessions.snapshot(mainPath);
  assert.equal(first.project.stats.moduleCount, 121);
  assert.equal(first.project.stats.compiledModules, 121);
  assert.equal(first.project.stats.reusedModules, 0);
  assert.ok(first.project.stats.durationMs < 5_000, `initial compile took ${first.project.stats.durationMs}ms`);
  assert.equal(first.activity.workspaceScans, 1);
  assert.equal(first.activity.filesRead, 121);

  const unchanged = await sessions.update(mainPath, new Set());
  assert.equal(unchanged.project, first.project);
  assert.deepEqual(unchanged.activity, {
    strategy: "known-changes",
    workspaceScans: 0,
    filesRead: 0,
    projectReused: true,
  });

  const leaf = join(directory, `chain-${chainLength - 1}.vel`);
  await writeFile(leaf, "export const value = 2\n", "utf8");
  const rebuilt = await sessions.update(mainPath, new Set([leaf]));
  assert.deepEqual([...rebuilt.changedPaths], [leaf]);
  assert.equal(rebuilt.activity.workspaceScans, 0);
  assert.equal(rebuilt.activity.filesRead, 1);
  assert.equal(rebuilt.project.stats.compiledModules, 41);
  assert.equal(rebuilt.project.stats.reusedModules, 80);
  assert.equal(rebuilt.project.stats.affectedModules, 41);
  assert.ok(rebuilt.project.stats.durationMs < 2_000, `incremental compile took ${rebuilt.project.stats.durationMs}ms`);
});
