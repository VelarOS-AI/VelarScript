import assert from "node:assert/strict";
import test, { after } from "node:test";
import { removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { BENCHMARK_WALL_CLOCK_BUDGET_MS, benchmarkProgram, dimension, timeBudget } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — emitted equality, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is what `==` costs once the analyzer knows the operand
 * types: numbers pay for SameValueZero, strings and enums must have the call
 * elided entirely. The harness and the budget convention are in
 * `tests/support/runtime-benchmark.ts`; the bodies below are the bodies that
 * file had.
 */

after(removeTemporaryDirectories);

const equalityProgram = `
import {monotonic} from "velar/time"

enum Status:
    active
    paused

const iterations = 10000000

def numberEquality(rounds: number) -> number:
    let hits = 0
    let index = 0
    while index < rounds:
        const left = index % 7 < 3 ? 11 : 22
        const right = index % 5 < 3 ? 11 : 22
        if left == right:
            hits += 1
        index += 1
    return hits

def stringEquality(rounds: number) -> number:
    let hits = 0
    let index = 0
    while index < rounds:
        const left = index % 7 < 3 ? "alpha" : "beta"
        const right = index % 5 < 3 ? "alpha" : "beta"
        if left == right:
            hits += 1
        index += 1
    return hits

def enumEquality(rounds: number) -> number:
    let hits = 0
    let index = 0
    while index < rounds:
        const left = index % 7 < 3 ? Status.active : Status.paused
        const right = index % 5 < 3 ? Status.active : Status.paused
        if left == right:
            hits += 1
        index += 1
    return hits

let sink = 0
let numberSamples = ""
let stringSamples = ""
let enumSamples = ""

sink += numberEquality(iterations)
sink += stringEquality(iterations)
sink += enumEquality(iterations)

let round = 0
while round < 5:
    let start = monotonic()
    sink += numberEquality(iterations)
    numberSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += stringEquality(iterations)
    stringSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += enumEquality(iterations)
    enumSamples += f"{str(monotonic() - start)},"
    round += 1

print(f"number={numberSamples}")
print(f"string={stringSamples}")
print(f"enum={enumSamples}")
print(f"sink={str(sink)},")
`.trimStart();

test("emitted equality holds the SameValueZero hot-loop budget", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples, code } = await benchmarkProgram("velar-runtime-equality-", equalityProgram);

  // The three loops are structurally identical -- same modulo, same
  // comparison, same select -- so the only difference between them is the
  // operand type and therefore the lowering the analyzer chose.
  assert.match(code, /if \(__velarSameValueZero\(left, right\)\) \{/u,
    "numeric == no longer lowers to the SameValueZero repair");
  assert.equal(code.match(/if \(\(left === right\)\) \{/gu)?.length, 2,
    "string and enum == no longer elide the SameValueZero repair down to ===");

  const iterations = 10_000_000;
  const numberElapsed = dimension(samples, "number");
  const stringElapsed = dimension(samples, "string");
  const enumElapsed = dimension(samples, "enum");
  const ratio = numberElapsed / stringElapsed;
  const perComparison = (elapsed: number): string => `${((elapsed * 1e6) / iterations).toFixed(2)}ns/comparison`;
  const context = `${iterations.toLocaleString("en-US")} comparisons: number ${numberElapsed.toFixed(1)}ms (${perComparison(numberElapsed)}), `
    + `string ${stringElapsed.toFixed(1)}ms (${perComparison(stringElapsed)}), enum ${enumElapsed.toFixed(1)}ms (${perComparison(enumElapsed)}), `
    + `number/string ratio ${ratio.toFixed(2)}`;
  t.diagnostic(context);

  // Baseline 2026-08-12: number 20.9ms (2.09ns/comparison) for 10M `==` on
  // numbers, which the analyzer cannot prove NaN-free so every one calls
  // __velarSameValueZero.
  assert.ok(numberElapsed < timeBudget(63), `SameValueZero numeric equality exceeded its budget -- ${context}`);
  // Baseline 2026-08-12: string 15.1ms (1.51ns/comparison). Elided to ===.
  assert.ok(stringElapsed < timeBudget(45), `elided string equality exceeded its budget -- ${context}`);
  // Baseline 2026-08-12: enum 20.4ms (2.04ns/comparison). Also elided to ===;
  // the gap to the string case is the frozen-object property load an enum
  // member read costs, not equality work.
  assert.ok(enumElapsed < timeBudget(62), `elided enum equality exceeded its budget -- ${context}`);
  // Baseline 2026-08-12: ratio 1.32 to 1.41 across runs, so SameValueZero
  // costs roughly 0.6ns per comparison once V8 inlines it. This bound is the
  // diagnostic that separates "equality lowering regressed" from "the whole
  // machine got slower", since both loops move together in the second case.
  assert.ok(ratio < 4, `SameValueZero cost too much relative to elided equality -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the equality benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});
