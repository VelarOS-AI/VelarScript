import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeTemporaryDirectory } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";
import { linkVelarExtension } from "./web-project.ts";

/**
 * D115 P5 — the runtime benchmark harness, shared by the
 * `tests/compiler/analysis/runtime-*-performance.slow.test.ts` family.
 *
 * `performance-runtime.slow.test.ts` split into seven subject files, one per
 * runtime area it bounds, and this is the one thing all seven needed. The
 * banner below is the one that file carried, and the bodies are its bodies.
 */

// Runtime performance gate. `tests/cli/performance.test.ts` bounds compile-time
// work; this file bounds the wall-clock cost of the code the emitter produces,
// so a language change that slows every program down is visible as a failing
// gate instead of an invisible regression.
//
// Each benchmark is a VelarScript program that times itself with
// `monotonic()` (the compiler's binding for `performance.now()`), reports one
// `label=sample,sample,...` line per dimension, and is discarded. The harness
// takes the median of the reported rounds; every program runs one untimed
// warm-up round first so the samples describe optimized code rather than the
// interpreter's first pass.
//
// Budgets are set at roughly three times the median measured on the reference
// machine (Apple Silicon, Node 24, 2026-08-12) and each one records that
// measurement next to it. They are regression gates, not targets: a budget is
// only ever tightened after the measured baseline moves.

const root = repositoryRoot;

// The corpus and ratios remain identical on hosted CI; only wall-clock ceilings
// receive one explicit allowance for shared-runner scheduling noise.
export const timeBudget = (milliseconds: number): number => milliseconds * (process.env.CI ? 3 : 1);

/** Wall-clock ceiling for one benchmark, covering compilation and execution. */
export const BENCHMARK_WALL_CLOCK_BUDGET_MS = timeBudget(20_000);

export function median(values: readonly number[]): number {
  assert.ok(values.length > 0, "a benchmark dimension reported no samples");
  const ordered = [...values].sort((left, right) => left - right);
  const middle = ordered.length >> 1;
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function parseSamples(stdout: string): Map<string, number[]> {
  const samples = new Map<string, number[]>();
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const values = line.slice(separator + 1).split(",").filter((value) => value.trim() !== "").map(Number);
    assert.ok(values.every((value) => Number.isFinite(value)), `benchmark line reported a non-numeric sample: ${line}`);
    samples.set(line.slice(0, separator), values);
  }
  return samples;
}

export function dimension(samples: ReadonlyMap<string, number[]>, label: string): number {
  const values = samples.get(label);
  assert.ok(values, `benchmark did not report the '${label}' dimension`);
  return median(values);
}

/** Compiles a single-module VelarScript program and runs the emitted JavaScript under Node. */
export async function benchmarkProgram(prefix: string, source: string): Promise<{ samples: Map<string, number[]>; code: string }> {
  const directory = await makeTemporaryDirectory(prefix);
  const entry = join(directory, "main.vel");
  const output = join(directory, "performance-output");
  const readableOutput = join(directory, "readable");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(entry, source, "utf8");

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(build.status, 0, String(build.stderr || build.error));
  // 性能样本执行默认 production；静态 lowering 断言读取显式 readable，
  // 避免把压缩器允许改写的局部名字误当成语言 ABI。
  const readableBuild = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts", "build", entry, "--out-dir", readableOutput, "--mode", "readable",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(readableBuild.status, 0, String(readableBuild.stderr || readableBuild.error));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr || execution.error));
  return { samples: parseSamples(execution.stdout), code: await readFile(join(readableOutput, "main.js"), "utf8") };
}

/**
 * Compiles a Web application and runs its production bundle under Node. The
 * reactive runtime only reaches the DOM through `mount`, so an unmounted
 * program exercises state, `computed`, and `watch` headlessly; the repo's own
 * reactivity regressions still run in Chromium through the browser gate.
 */
export async function benchmarkWebProgram(prefix: string, source: string): Promise<Map<string, number[]>> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await linkVelarExtension(directory, "web");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "Runtime performance" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), source, "utf8");

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", directory], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(build.status, 0, String(build.stderr || build.error));
  const assets = await readdir(join(directory, "dist", "assets"));
  const bundle = assets.find((name) => name.startsWith("main-") && name.endsWith(".js"));
  assert.ok(bundle, `Web build produced no main bundle: ${assets.join(", ")}`);
  const execution = spawnSync(process.execPath, [join(directory, "dist", "assets", bundle)], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(execution.status, 0,
    `the Web bundle did not run under Node; if the reactive runtime now needs a DOM at module scope, move this case into tests/acceptance/browser.acceptance.ts: ${String(execution.stderr || execution.error)}`);
  return parseSamples(execution.stdout);
}
