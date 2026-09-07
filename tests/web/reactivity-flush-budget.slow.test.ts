import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { WEB_FOUNDATION_BODY, WEB_RUNTIME_BODY } from "../../packages/web/src/runtime-sources.generated.ts";
import { repositoryRoot } from "../support/repository-root.ts";
import { mountInChromium } from "../support/mount-in-chromium.ts";

/**
 * D115 P5 — the queue budget is the flush's failure to own, one subject of the
 * file that was `tests/web/reactivity.slow.test.ts` before it reached 1,018
 * lines.
 *
 * The queue-budget rulings put the bound on the flush rather than on the
 * assignment that happened to cross it: a runaway stops the observers that ran
 * away and leaves the innocent ones alone, and a cycle wider than the budget's
 * run count still ends the turn instead of repeating the pass forever. rw-3 is
 * the same rule read in the source: there is exactly one drain, and it carries
 * the overrun progress rules. The two runaways run the emitted application in
 * Chromium; rw-3 reads the emitter family. The bodies below are the bodies that
 * file had.
 */

const root = repositoryRoot;

const overflowApplication = `
state stormA: number = 0
state stormB: number = 0
state unrelated: number = 0
state unrelatedRuns: number = 0

watch stormA:
    stormB = stormB + 1

watch stormB:
    stormA = stormA + 1

watch unrelated:
    unrelatedRuns = unrelatedRuns + 1

component App:
    def storm():
        stormA = stormA + 1
        unrelated = unrelated + 1

    def bumpUnrelated():
        unrelated = unrelated + 1

    return <main>
        <p data-runs>{unrelatedRuns}</p>
        <button data-storm on:click={storm}>storm</button>
        <button data-unrelated on:click={bumpUnrelated}>unrelated</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "[R1] a runaway flush stops the observers that ran away and keeps the innocent ones",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(overflowApplication, async (page, failures) => {
      await page.click("[data-storm]");
      await page.waitForFunction(
        "document.querySelector('[data-runs]').textContent === '1'",
        undefined,
        { timeout: 60_000 },
      );
      await page.click("[data-unrelated]");
      // The watch queued by an unrelated write in the same turn ran at most
      // once during the overrun, so it survives it: before the fix the overflow
      // stopped it for good and it never fired again.
      await page.waitForFunction(
        "document.querySelector('[data-runs]').textContent === '2'",
        undefined,
        { timeout: 60_000 },
      );
      assert.equal(failures.length, 1);
      assert.match(
        failures[0] ?? "",
        /Reactive updates cannot run more than 100000 observers in one task/u,
      );
    });
  },
);

// The budget stops a runaway by run count, so a cycle wide enough that the
// budget cannot run any of its observers four times reached the threshold
// nowhere: every observer was put back, the next flush repeated the pass, and
// the microtask chain never yielded. 100000 / 4 is 25000, so a cycle wider than
// that is the case, and it must end the same way a two-observer cycle does.
const wideCycleObservers = 30000;

const wideCycleApplication = `
state ticks: List<number> = []
state cells: List<number> = []
state unrelated: number = 0
state unrelatedRuns: number = 0

watch unrelated:
    unrelatedRuns = unrelatedRuns + 1

component Cell(index: number, total: number):
    watch ticks[index] as value, _:
        if value > 0:
            ticks[(index + 1) % total] = value + 1
    return <i></i>

component App:
    def build():
        let nextTicks: List<number> = []
        let ids: List<number> = []
        let index = 0
        while index < ${String(wideCycleObservers)}:
            nextTicks.append(0)
            ids.append(index)
            index = index + 1
        ticks = nextTicks
        cells = ids

    def storm():
        ticks[0] = ticks[0] + 1

    def bumpUnrelated():
        unrelated = unrelated + 1

    return <main>
        <p data-runs>{unrelatedRuns}</p>
        <div data-cells>{cells.map(id => <Cell key={str(id)} index={id} total={${String(wideCycleObservers)}} />)}</div>
        <button data-build on:click={build}>build</button>
        <button data-storm on:click={storm}>storm</button>
        <button data-unrelated on:click={bumpUnrelated}>unrelated</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "[R1] a runaway wider than the budget's run count still ends the turn",
  { timeout: 300_000 },
  async () => {
    await mountInChromium(wideCycleApplication, async (page, failures) => {
      await page.click("[data-build]");
      await page.waitForFunction(
        `document.querySelectorAll('[data-cells] i').length === ${String(wideCycleObservers)}`,
        undefined,
        { timeout: 120_000 },
      );
      await page.click("[data-storm]");
      // The page answers again, and an unrelated write still reaches its watch:
      // before the fix this click never landed, because the overrun stopped no
      // observer and rescheduled itself forever.
      await page.click("[data-unrelated]", { timeout: 60_000 });
      await page.waitForFunction(
        "document.querySelector('[data-runs]').textContent === '1'",
        undefined,
        { timeout: 60_000 },
      );
      // The budget is reported exactly once and is the only thing reported,
      // which is the progress rule this test exists for. D90 R1-a-scope briefly
      // added a second failure here -- every Cell in the ring is a live instance
      // of one `watch` declaration writing one module state, which its runtime
      // referee refused from the second instance on. R21 deleted that referee:
      // the ring is an ordinary program now, and the budget is the only gate
      // that stops it. The turn still ends, the page still answers, and the
      // unrelated write still reaches its watch.
      const budget = failures.filter((item) => /Reactive updates cannot run more than 100000 observers in one task/u.test(item));
      assert.equal(budget.length, 1, JSON.stringify(failures.slice(0, 2)));
      assert.deepEqual(failures, budget);
    });
  },
);

test("[rw-3] there is exactly one flush drain, and it carries the overrun progress rules", async () => {
  // This test used to read both runtimes and assert that the two drains matched.
  // It existed only because there were two: the registry drain in the foundation
  // and a twin in the emitted prelude, sharing the queues under one flushPending
  // flag, with the scheduling epoch a watch used to be classified by living in
  // only one of them. The emitted prelude is inlined into the same module scope as
  // the foundation, so one definition serves both: the second one is now gone.
  const foundation = WEB_FOUNDATION_BODY;
  // D115 P4 R3d: the Web emission layer is `emitter.ts` plus every collaborator it owns under
  // `emit/`, read as one text so a lowering that moved into a sibling module is still covered.
  const emitDirectory = join(root, "packages", "web", "src", "emit");
  const emitNames = (await readdir(emitDirectory, { recursive: true })).filter((name) => name.endsWith(".ts"));
  const emitted = [WEB_RUNTIME_BODY, ...await Promise.all([join(root, "packages", "web", "src", "emitter.ts"), ...emitNames.map((name) => join(emitDirectory, name))].map((path) => readFile(path, "utf8")))].join("\n");
  // The threshold falls to the highest run count present, so an overrun that
  // ran nobody four times still stops the observers it did run.
  assert.match(foundation, /if \(observer\.flushToken === token && observer\.flushRuns > threshold\) threshold = observer\.flushRuns;/u);
  assert.match(foundation, /if \(threshold > 4\) threshold = 4;/u);
  assert.match(foundation, /if \(threshold > 0 && observer\.flushToken === token && observer\.flushRuns >= threshold\)/u);
  // D114 W/A1 as narrowed by W2: an ordinary flush continues the open window
  // only when an observer run in it started asynchronous work, and opens a new
  // one otherwise, which is the per-flush budget this runtime had before W. The
  // overrun's continuation is the exception and carries explicitly: the overrun
  // schedules a microtask, the microtask is this same task, and the flush it
  // runs is the overrun's own unfinished work rather than a new write. The
  // carry is one-shot, so exactly the flush the overrun scheduled gets it, and
  // the budget is granted again so the exhausted count cannot trip that flush.
  assert.match(foundation, /const carried = __velarFlushCarried;\n\s*__velarFlushCarried = false;/u);
  assert.match(foundation, /if \(__velarFlushToken === null \|\| !\(carried \|\| __velarAsyncWorkCell\[1\]\)\) \{\n\s*__velarFlushToken = \{\};\n\s*__velarFlushBudget = __velarFlushBudgetPerTask;/u);
  assert.match(foundation, /__velarFlushBudget = __velarFlushBudgetPerTask;\n\s*__velarFlushCarried = requeued;\n\s*__velarRuntime\.report\(new RangeError\(/u);
  assert.match(foundation, /if \(requeued\) __velarScheduleFlush\(\);/u);
  // W2's two marks are compiler-owned lowering points, and the fact they record
  // is read here, in the settle. The foundation declares the recorder; the emitter
  // calls it at the detached task and at the action call, and nowhere else
  // decides whether an observer run is in progress.
  assert.match(foundation, /function __velarNoteAsyncWork\(\) \{\n\s*if \(__velarAsyncWorkCell\[0\] > 0\) __velarAsyncWorkCell\[1\] = true;/u);
  assert.equal((emitted.match(/__velarNoteAsyncWork\(\);/gu) ?? []).length, 2);
  assert.equal(foundation.includes("__velarAsyncWorkCell[0] += 1;"), true);
  // One definition of each, and the emitter defines none of them.
  for (const name of ["__velarFlush", "__velarScheduleFlush", "__velarFlushOverflow"]) {
    assert.equal((foundation.match(new RegExp(`function ${name}\\(`, "gu")) ?? []).length, 1, name);
    assert.equal(emitted.match(new RegExp(`function ${name}\\(`, "gu")), null, name);
  }
  assert.equal(emitted.includes("__velarFlushToken ="), false);
  assert.equal(emitted.includes("function __velarSchedule("), false);
});
