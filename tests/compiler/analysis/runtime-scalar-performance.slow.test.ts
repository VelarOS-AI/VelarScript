import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "../../../packages/compiler/src/index.ts";
import { median } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — the scalar hot loop, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is the one case with no runtime under it at all: a Core
 * arithmetic loop must lower to the corresponding direct JavaScript operations
 * and then run at that JavaScript's speed. It is the only benchmark in the
 * family that compiles in process and times both sides itself, so it takes no
 * temporary directory and no build. The harness and the budget convention are
 * in `tests/support/runtime-benchmark.ts`; the body below is the body that
 * file had.
 */

test("Core scalar hot loops keep JavaScript code shape and native throughput", async (t) => {
  const compiled = compileCore(`
export def arithmetic(rounds: number) -> number:
    let total = 0
    let index = 0
    while index < rounds:
        total += (index * 17) % 97
        index += 1
    return total
`.trimStart());
  assert.deepEqual(compiled.diagnostics, []);
  assert.deepEqual(compiled.runtimeModules, []);
  const code = compiled.code ?? "";
  assert.equal(code, `export function arithmetic(rounds) {
  let total = 0;
  let index = 0;
  while ((index < rounds)) {
    total += ((index * 17) % 97);
    index += 1;
  }
  return total;
}
`, "Core scalar lowering must remain the corresponding direct JavaScript operations");
  assert.doesNotMatch(code, /\b__velar|\bglobalThis\b|\bimport\s/u, "target or safety runtime work crossed into a scalar Core hot loop");

  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  const runtime = await import(runtimeUrl) as { arithmetic(rounds: number): number };
  function javaScriptArithmetic(rounds: number): number {
    let total = 0;
    let index = 0;
    while (index < rounds) {
      total += (index * 17) % 97;
      index += 1;
    }
    return total;
  }
  // Best of 31 interleaved ~0.7ms samples per side, order alternating: a disturbance can
  // only lengthen a sample, and one this short still fits a scheduler quantum. At 10M
  // iterations (~7ms, median of 7) none did, so load read 1.21 and 1.49 where quiet reads 1.00.
  const rounds = 1_000_000;
  for (let warm = 0; warm < 20; warm += 1) { runtime.arithmetic(rounds); javaScriptArithmetic(rounds); }
  const coreSamples: number[] = [];
  const javaScriptSamples: number[] = [];
  let coreResult = 0;
  let javaScriptResult = 0;
  for (let round = 0; round < 31; round += 1) {
    let started = performance.now();
    if ((round & 1) === 0) coreResult = runtime.arithmetic(rounds);
    else javaScriptResult = javaScriptArithmetic(rounds);
    const first = performance.now() - started;
    started = performance.now();
    if ((round & 1) === 0) javaScriptResult = javaScriptArithmetic(rounds);
    else coreResult = runtime.arithmetic(rounds);
    const second = performance.now() - started;
    coreSamples.push((round & 1) === 0 ? first : second);
    javaScriptSamples.push((round & 1) === 0 ? second : first);
  }
  assert.equal(coreResult, javaScriptResult);
  const coreElapsed = Math.min(...coreSamples);
  const javaScriptElapsed = Math.min(...javaScriptSamples);
  const ratio = coreElapsed / javaScriptElapsed;
  // The disturbance figure is reported, never asserted: ~1.05 idle, ~1.4 beside two suites, >2.0 saturated.
  const disturbance = median([...coreSamples, ...javaScriptSamples]) / Math.min(...coreSamples, ...javaScriptSamples);
  const context = `${rounds.toLocaleString("en-US")} iterations x ${coreSamples.length} rounds: best Core ${coreElapsed.toFixed(3)}ms, best JavaScript ${javaScriptElapsed.toFixed(3)}ms, ratio ${ratio.toFixed(2)} (disturbance ${disturbance.toFixed(2)}x)`;
  t.diagnostic(context);
  // The source-level types and extension mechanism are compile-time facts in this
  // loop, so generated Core has no adapter to amortize or probe and the allowance
  // covers JIT noise only. The emitted-operation equality above is the non-statistical part.
  assert.ok(ratio < (process.env.CI ? 1.35 : 1.20), `Core scalar execution drifted from JavaScript throughput -- ${context}`);
});
