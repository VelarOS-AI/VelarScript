import assert from "node:assert/strict";
import test, { after } from "node:test";
import { removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { BENCHMARK_WALL_CLOCK_BUDGET_MS, benchmarkProgram, dimension, timeBudget } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — the string and value methods, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is what the text methods cost over a corpus large
 * enough that a hidden copy or a per-code-point walk would show: slicing,
 * searching, padding and splitting. The budgets are calibrated against the
 * exact fixture sizes the program prints back, which is why the sizes are
 * asserted too. The harness and the budget convention are in
 * `tests/support/runtime-benchmark.ts`; the bodies below are the bodies that
 * file had.
 */

after(removeTemporaryDirectories);

const textProgram = `
import {monotonic} from "velar/time"

const corpus = "velarscript-runtime-benchmark-corpus;".repeat(6000)
const words = "alpha,beta,gamma,delta,epsilon,zeta,eta,theta,".repeat(4000)

def sliceCorpus(text: string, count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        const start = (index * 6553) % 200000
        total += text.slice(start, start + 24).size
        index += 1
    return total

def searchCorpus(text: string, count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        if text.has("benchmark-corpus"):
            total += 1
        if text.has("absent-needle-value"):
            total += 1
        index += 1
    return total

def padValues(count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        total += str(index).padStart(12, "0").size
        index += 1
    return total

def splitCorpus(text: string, count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        total += text.split(",").size
        index += 1
    return total

let sink = 0
let sliceSamples = ""
let searchSamples = ""
let padSamples = ""
let splitSamples = ""

sink += sliceCorpus(corpus, 300)
sink += searchCorpus(corpus, 2000)
sink += padValues(200000)
sink += splitCorpus(words, 20)

let round = 0
while round < 5:
    let start = monotonic()
    sink += sliceCorpus(corpus, 300)
    sliceSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += searchCorpus(corpus, 2000)
    searchSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += padValues(200000)
    padSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += splitCorpus(words, 20)
    splitSamples += f"{str(monotonic() - start)},"
    round += 1

print(f"slice={sliceSamples}")
print(f"search={searchSamples}")
print(f"pad={padSamples}")
print(f"split={splitSamples}")
print(f"corpus={str(corpus.size)},")
print(f"words={str(words.size)},")
print(f"sink={str(sink)},")
`.trimStart();

test("emitted string and value methods hold their large-corpus budgets", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples } = await benchmarkProgram("velar-runtime-text-", textProgram);

  // The budgets below are calibrated against these exact fixture sizes, so a
  // change to either invalidates them rather than merely moving the numbers.
  const corpus = dimension(samples, "corpus");
  assert.equal(corpus, 222_000, "the slice/has corpus changed size");
  assert.equal(dimension(samples, "words"), 184_000, "the split corpus changed size");

  const slice = dimension(samples, "slice");
  const search = dimension(samples, "search");
  const pad = dimension(samples, "pad");
  const split = dimension(samples, "split");
  const context = `over a ${corpus.toLocaleString("en-US")} code-point corpus: 300 slices ${slice.toFixed(1)}ms, `
    + `4,000 has ${search.toFixed(1)}ms, 200,000 padStart ${pad.toFixed(1)}ms, 20 splits ${split.toFixed(1)}ms`;
  t.diagnostic(context);

  // Baselines 2026-08-12.
  // slice 0.1ms for 300 slices spread evenly across the corpus (~0.3us each),
  // measured after the code-point-to-code-unit conversion gained the fast path
  // String.size already had: a string whose code-point count equals its
  // code-unit count carries no surrogate pair, so the position is already the
  // offset. Before that, the conversion walked code points from zero, making
  // every slice cost O(corpus + start offset) even for pure ASCII -- 153.8ms
  // for the same 300 slices (~510us each), which made any code that scans a
  // document by slicing quadratic. The budget stays well above the measured
  // value because the dimension is now dominated by fixed per-call overhead.
  assert.ok(slice < timeBudget(12), `String.slice exceeded its budget -- ${context}`);
  // search 31.6ms for 4,000 String.has calls (~7.9us each, half of them a
  // full scan for an absent needle). Delegates to native indexOf, and is the
  // noisiest dimension in this file (25.9ms to 35.2ms across runs).
  assert.ok(search < timeBudget(100), `String.has exceeded its budget -- ${context}`);
  // pad 13.6ms for 200,000 padStart calls (~68ns each)
  assert.ok(pad < timeBudget(42), `String.padStart exceeded its budget -- ${context}`);
  // split 58.3ms for 20 splits into 32,001 parts (~2.9ms each)
  assert.ok(split < timeBudget(180), `String.split exceeded its budget -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the text benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});
