import assert from "node:assert/strict";
import test, { after } from "node:test";
import { standardModuleSource as coreStandardModuleSource } from "../../../packages/core/src/index.ts";
import { removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { BENCHMARK_WALL_CLOCK_BUDGET_MS, benchmarkProgram, dimension, timeBudget } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — runtime Type validation, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is what a declared type costs at run time: an acyclic
 * Type check must stay on the straight-line validation path the emitter writes
 * for it, and an integer range must be validated by arithmetic rather than by
 * replaying the loop it describes. The harness and the budget convention are
 * in `tests/support/runtime-benchmark.ts`; the bodies below are the bodies
 * that file had.
 */

after(removeTemporaryDirectories);

const runtimeTypeProgram = `
import {monotonic} from "velar/time"

type Point:
    x: number
    y: number

type Sample:
    point: Point
    label: string
    active: bool

const point = {x: 1, y: 2}
const sample = {point, label: "origin", active: true}
const iterations = 2000000

def pointChecks(value: unknown, count: number) -> number:
    let hits = 0
    let index = 0
    while index < count:
        if Point.is(value):
            hits += 1
        index += 1
    return hits

def sampleChecks(value: unknown, count: number) -> number:
    let hits = 0
    let index = 0
    while index < count:
        if Sample.is(value):
            hits += 1
        index += 1
    return hits

let sink = pointChecks(point, iterations) + sampleChecks(sample, iterations)
let pointSamples = ""
let sampleSamples = ""
let round = 0
while round < 5:
    let start = monotonic()
    sink += pointChecks(point, iterations)
    pointSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += sampleChecks(sample, iterations)
    sampleSamples += f"{str(monotonic() - start)},"
    round += 1

print(f"point={pointSamples}")
print(f"sample={sampleSamples}")
print(f"sink={str(sink)},")
`.trimStart();

test("acyclic runtime Type checks stay on the straight-line validation path", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples, code } = await benchmarkProgram("velar-runtime-type-", runtimeTypeProgram);
  const pointCheck = code.slice(code.indexOf("function __velarTypeCheck_Point"), code.indexOf("\n}\n", code.indexOf("function __velarTypeCheck_Point")) + 3);
  const sampleCheck = code.slice(code.indexOf("function __velarTypeCheck_Sample"), code.indexOf("\n}\n", code.indexOf("function __velarTypeCheck_Sample")) + 3);
  assert.match(pointCheck, /function __velarTypeCheck_Point\(value\)/u);
  assert.match(sampleCheck, /function __velarTypeCheck_Sample\(value\)/u);
  assert.doesNotMatch(pointCheck + sampleCheck, /__velarValidation(?:State|WeakMap|Set)/u,
    "an acyclic Type validator reintroduced graph-traversal state");

  const iterations = 2_000_000;
  const point = dimension(samples, "point");
  const sample = dimension(samples, "sample");
  const perCheck = (elapsed: number): string => `${((elapsed * 1e6) / iterations).toFixed(1)}ns/check`;
  const context = `${iterations.toLocaleString("en-US")} Type.is calls: Point ${point.toFixed(1)}ms (${perCheck(point)}), `
    + `nested Sample ${sample.toFixed(1)}ms (${perCheck(sample)})`;
  t.diagnostic(context);

  // Baseline 2026-08-19 after acyclic validators stopped allocating graph
  // traversal state: Point 66.1ms (33.0ns/check), nested Sample 157.2ms
  // (78.6ns/check) for 2M checks.
  assert.ok(point < timeBudget(105), `flat Type.is exceeded its budget -- ${context}`);
  assert.ok(sample < timeBudget(240), `nested acyclic Type.is exceeded its budget -- ${context}`);
  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the runtime Type benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});

test("direct integer range validation does not replay the complete loop", async (t) => {
  const source = coreStandardModuleSource("velar/compiler-runtime-range-v1");
  assert.ok(source);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const runtime = await import(runtimeUrl) as {
    range: ((start: number, stop?: number | null, step?: number) => number[]) & {
      __velarCounted(start: number, stop?: number | null, step?: number): number[];
    };
  };
  let sink = 0;
  for (let warm = 0; warm < 3; warm += 1) {
    for (let index = 0; index < 100; index += 1) sink += runtime.range.__velarCounted(100_000 + (index & 1))[1]!;
  }
  const started = performance.now();
  for (let index = 0; index < 1_000; index += 1) sink += runtime.range.__velarCounted(100_000 + (index & 1))[1]!;
  const elapsed = performance.now() - started;
  const context = `1,000 validations of ~100,000 integer iterations: ${elapsed.toFixed(2)}ms`;
  t.diagnostic(context);
  assert.ok(sink > 0);
  // Baseline 2026-08-26 after safe-integer ranges switched to exact arithmetic:
  // about 0.1ms. Replaying every future loop during validation took ~75ms.
  assert.ok(elapsed < timeBudget(20), `direct range validation exceeded its budget -- ${context}`);
});
