import assert from "node:assert/strict";
import test, { after } from "node:test";
import { removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { BENCHMARK_WALL_CLOCK_BUDGET_MS, benchmarkWebProgram, dimension, timeBudget } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — the reactive runtime, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is the update throughput of the Web reactive graph:
 * pushed notifications, `computed` recomputation, and deep record field reads
 * and writes, with every notification counted so a cheap run cannot be a run
 * that stopped notifying. It is the one benchmark in the family that builds a
 * Web application, which is why it goes through `benchmarkWebProgram`. The
 * harness and the budget convention are in
 * `tests/support/runtime-benchmark.ts`; the bodies below are the bodies that
 * file had.
 */

after(removeTemporaryDirectories);

const reactiveProgram = `
import {monotonic} from "velar/time"

type Fields:
    one: string
    two: string
    three: string
    four: string
    five: string
    six: string
    seven: string
    eight: string

type Form:
    fields: Fields

state counter = 0
state form: Form = {fields: {one: "", two: "", three: "", four: "", five: "", six: "", seven: "", eight: ""}}
computed doubled = counter * 2
let notifications = 0

watch doubled:
    notifications += 1

async def pushRound(updates: number) -> number:
    const start = monotonic()
    let index = 0
    while index < updates:
        counter += 1
        await tick()
        index += 1
    return monotonic() - start

def pullRound(updates: number) -> number:
    const start = monotonic()
    let total = 0
    let index = 0
    while index < updates:
        counter += 1
        total += doubled
        index += 1
    if total < 0:
        print("unreachable")
    return monotonic() - start

def writeRound(updates: number) -> number:
    const start = monotonic()
    let index = 0
    while index < updates:
        form.fields.one = index % 2 == 0 ? "a" : "b"
        index += 1
    return monotonic() - start

def readRound(updates: number) -> number:
    const start = monotonic()
    let total = 0
    let index = 0
    while index < updates:
        total += form.fields.one.size + form.fields.eight.size
        index += 1
    if total < 0:
        print("unreachable")
    return monotonic() - start

@main:
    let pushSamples = ""
    let pullSamples = ""
    let writeSamples = ""
    let readSamples = ""

    await pushRound(10000)
    pullRound(10000)
    writeRound(10000)
    readRound(10000)
    const observedAfterWarmUp = notifications

    let round = 0
    while round < 5:
        pushSamples += f"{str(await pushRound(10000))},"
        pullSamples += f"{str(pullRound(10000))},"
        writeSamples += f"{str(writeRound(10000))},"
        readSamples += f"{str(readRound(10000))},"
        round += 1

    await tick()
    print(f"push={pushSamples}")
    print(f"pull={pullSamples}")
    print(f"write={writeSamples}")
    print(f"read={readSamples}")
    print(f"notifications={str(notifications - observedAfterWarmUp)},")
`.trimStart();

test("emitted reactive updates hold the 10k-update throughput budget", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const samples = await benchmarkWebProgram("velar-runtime-reactive-", reactiveProgram);

  // Every pushed update must have reached the observer exactly once: five
  // rounds of 10,000 awaited updates, plus the trailing notification each
  // untimed pull round leaves queued.
  const notifications = dimension(samples, "notifications");
  assert.ok(notifications >= 50_000 && notifications <= 50_010,
    `reactive observer ran ${notifications} times for 50,000 pushed updates`);

  const push = dimension(samples, "push");
  const pull = dimension(samples, "pull");
  const write = dimension(samples, "write");
  const read = dimension(samples, "read");
  const context = `per 10,000 updates: state -> computed -> observer ${push.toFixed(1)}ms (${(push * 100).toFixed(0)}ns/update), `
    + `state -> computed recomputation ${pull.toFixed(1)}ms (${(pull * 100).toFixed(0)}ns/update), `
    + `deep record field write ${write.toFixed(1)}ms (${(write * 100).toFixed(0)}ns/write), `
    + `deep record field read ${read.toFixed(1)}ms (${(read * 100).toFixed(0)}ns/read-pair)`;
  t.diagnostic(context);

  // Baselines 2026-08-12, Web runtime driven headlessly under Node.
  // push 9.4ms per 10,000 mutate -> flush -> observer cycles (940ns each,
  // one microtask turn per update since each awaits tick()). The marathon
  // fix wave 2 did not move this dimension: the microtask turn dominates it.
  assert.ok(push < timeBudget(30), `reactive observer notification exceeded its budget -- ${context}`);
  // pull 1.9ms per 10,000 mutate -> computed recomputations (190ns each),
  // from 2.0ms before the reactive read path stopped linking primitives and
  // stopped rebuilding a dependency Set per observer run (marathon beta-9).
  assert.ok(pull < timeBudget(6), `computed recomputation exceeded its budget -- ${context}`);
  // write 4.2ms per 10,000 writes of one field of a nine-field reactive record
  // (420ns each), from 48.6ms (4,858ns each) before the write path stopped
  // running the containment probe -- two thrown-and-caught exceptions plus a
  // descriptor walk -- for primitive values (marathon beta-7).
  assert.ok(write < timeBudget(13), `deep record field writes exceeded their budget -- ${context}`);
  // read 3.7ms per 10,000 two-field deep reads (370ns each), from 4.1ms
  // (marathon beta-9's early primitive bail on the proxy read path).
  assert.ok(read < timeBudget(12), `deep record field reads exceeded their budget -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the reactive benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});
