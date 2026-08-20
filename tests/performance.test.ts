import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import { WorkspaceIndexCancelledError, WorkspaceTextIndex } from "../packages/cli/src/workspace-index.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

// Hosted CI runners share noisier CPU and I/O than the reference development
// machine. Keep the exact corpus and asymptotic checks there, with a single
// explicit 3x wall-clock allowance instead of platform-specific exceptions.
const timeBudget = (milliseconds: number): number => milliseconds * (process.env.CI ? 3 : 1);

test("application-scale incremental budget recompiles only the reverse dependency closure", async () => {
  const directory = await makeTemporaryDirectory("velar-scale-");
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
  assert.ok(first.project.stats.durationMs < timeBudget(5_000), `initial compile took ${first.project.stats.durationMs}ms`);
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
  assert.ok(rebuilt.project.stats.durationMs < timeBudget(2_000), `incremental compile took ${rebuilt.project.stats.durationMs}ms`);
});

test("session-persistent workspace search meets the 20k-file first and complete-result budgets", async () => {
  const root = join(tmpdir(), "velar-workspace-search-20k");
  const index = new WorkspaceTextIndex();
  index.configure([root]);
  for (let file = 0; file < 20_000; file += 1) {
    const marker = file % 200 === 0 ? `\nconst searchNeedle${file} = true` : "";
    index.openDocument(join(root, `source-${String(file).padStart(5, "0")}.ts`), `export const value${file} = ${file}${marker}\n`);
  }

  const firstStarted = performance.now();
  const first = await index.search("searchNeedle", { maximumResults: 1 });
  const firstElapsed = performance.now() - firstStarted;
  assert.equal(first.matches.length, 1);
  assert.equal(first.limitReached, true);
  assert.ok(firstElapsed < timeBudget(300), `20k-file first result took ${firstElapsed}ms`);

  const completeStarted = performance.now();
  const complete = await index.search("searchNeedle", { maximumResults: 1_000 });
  const completeElapsed = performance.now() - completeStarted;
  assert.equal(complete.matches.length, 100);
  assert.equal(complete.filesSearched, 20_000);
  assert.equal(complete.limitReached, false);
  assert.ok(completeElapsed < timeBudget(3_000), `20k-file complete search took ${completeElapsed}ms`);

  let cancelled = false;
  const cancelledSearch = index.search("absentNeedle", { maximumResults: 1_000, cancelled: () => cancelled });
  setImmediate(() => { cancelled = true; });
  await assert.rejects(cancelledSearch, WorkspaceIndexCancelledError);

  const changedPaths = new Set<string>();
  for (let file = 0; file < 4_096; file += 1) {
    changedPaths.add(join(root, `source-${String(file).padStart(5, "0")}.ts`));
  }
  let heartbeat = 0;
  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const sampler = setInterval(() => {
    heartbeat += 1;
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 1);
  const updateStarted = performance.now();
  const update = await index.update(changedPaths).finally(() => clearInterval(sampler));
  const updateElapsed = performance.now() - updateStarted;
  assert.equal(update.changesReceived, 4_096);
  assert.equal(update.changeRoots, 4_096);
  assert.equal(update.recordsRemoved, 4_096);
  assert.equal(update.indexedFiles, 20_000);
  assert.ok(heartbeat > 0, "20k/4096 workspace invalidation did not yield to the host");
  assert.ok(updateElapsed < timeBudget(3_000), `20k/4096 workspace invalidation took ${updateElapsed}ms`);
  assert.ok(peakRss - rssBefore < 64 * 1024 * 1024,
    `20k/4096 workspace invalidation grew RSS by ${peakRss - rssBefore} bytes`);
  await assert.rejects(index.update(new Set(Array.from({ length: 4_097 }, (_, item) => join(root, `overflow-${item}.ts`)))),
    /cannot contain more than 4096 changed paths/u);
});
