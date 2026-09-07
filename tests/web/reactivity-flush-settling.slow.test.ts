import assert from "node:assert/strict";
import test from "node:test";
import { mountInChromium } from "../support/mount-in-chromium.ts";

/**
 * D115 P5 — the flush settles before the DOM, and declaration order decides the
 * rest: one subject of the file that was `tests/web/reactivity.slow.test.ts`
 * before it reached 1,018 lines.
 *
 * Ruling R1 says every derived value and every watch reaches a fixed point
 * before anything is written to the document; D90 R21 says nothing classifies a
 * watch that writes, so whichever block is written first is the block that runs
 * first — including when the write is hidden in a named function it calls. The
 * reactive queue is a browser-lifetime thing, so both run the emitted
 * application in Chromium. The bodies below are the bodies that file had.
 */

// Six render-driven stages: each one writes state from a rendered position, so
// reaching the last of them takes six alternating settle-and-commit rounds. A
// tick() that is one microtask hop resolves at the first of them.
const tickCascadeStages = 6;

const settlingApplication = `
let watchLog = ""
let renderLog = ""
let evalLog = ""

state a: number = 0
state b: number = 0
state secondA: number = 0
state secondB: number = 0
state corrected: number = 0
state revision: number = 0
state subjectValue: number = 0
state unwatched: number = 0
state sink: number = 0
state trigger: number = 0
state tickReport = ""
${Array.from(
  { length: tickCascadeStages },
  (_, index) => `state rendered${index}: number = 0\nstate settled${index}: number = 0`,
).join("\n")}

// The observing watch is declared first here and second below, and D90 R21 made
// that difference the point: the first pair reports the half-updated value and
// then the settled one, the second pair reports only the settled one. D90 R15(a)
// moved the sum out of the subject and into a computed, which is the same
// observation through one more node: the computed recomputes once per flush and
// the watch reads it after it has recomputed, never mid-recomputation.
computed sum = a + b

watch sum as current, _:
    watchLog = watchLog + "one=" + str(current) + ";"

watch a:
    b = a * 2

watch secondA:
    secondB = secondA * 2

computed total = secondA + secondB

watch total as current, _:
    watchLog = watchLog + "two=" + str(current) + ";"

watch corrected:
    if corrected > 5:
        corrected = 5

def subject() -> number:
    evalLog = evalLog + "e"
    return subjectValue

// The call moved out of the subject the same way (D90 R15(a)), so evalLog
// now counts evaluations of the computed rather than of the subject expression.
// The count is what this pins, and it is unchanged: the computed is evaluated
// once when the watch first reads it and once when the state behind it moves,
// and the write to the value only the body reads still evaluates it not at all.
computed subjectDerived = subject()

watch subjectDerived as value, _:
    sink = value + unwatched

${Array.from({ length: tickCascadeStages }, (_, index) =>
  index === 0
    ? `watch trigger:\n    settled0 = trigger`
    : `watch rendered${index - 1}:\n    settled${index} = rendered${index - 1}`,
).join("\n\n")}

${Array.from(
  { length: tickCascadeStages },
  (_, index) =>
    `def stage${index}(value: number) -> string:\n    rendered${index} = value\n    return str(value)`,
).join("\n\n")}

def show(value: number) -> string:
    renderLog = renderLog + "n=" + str(value) + ";"
    return str(value)

def at(_: number, text: string) -> string:
    return text

component App:
    action runCascade():
        trigger = 1
        await tick()
        tickReport = str(rendered${tickCascadeStages - 1}) + "/" + str(settled${tickCascadeStages - 1})

    def runWatches():
        a = 1
        secondA = 1

    def correct():
        corrected = 10

    def bumpSubject():
        subjectValue = subjectValue + 1

    def bumpUnwatched():
        unwatched = unwatched + 1

    def refresh():
        revision = revision + 1

    return <main>
        <p data-watch-log>{at(revision, watchLog)}</p>
        <p data-render-log>{at(revision, renderLog)}</p>
        <p data-eval-log>{at(revision, evalLog)}</p>
        <p data-corrected>{show(corrected)}</p>
        <p data-tick>{tickReport}</p>
${Array.from(
  { length: tickCascadeStages },
  (_, index) => `        <p data-stage${index}>{stage${index}(settled${index})}</p>`,
).join("\n")}
        <button data-run on:click={runWatches}>run</button>
        <button data-correct on:click={correct}>correct</button>
        <button data-subject on:click={bumpSubject}>subject</button>
        <button data-unwatched on:click={bumpUnwatched}>unwatched</button>
        <button data-cascade on:click={runCascade}>cascade</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "[R1/R21] reactive updates settle before the DOM, and watch declaration order decides the watch log",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(settlingApplication, async (page, failures) => {
      await page.click("[data-run]");
      await page.click("[data-correct]");
      await page.click("[data-subject]");
      await page.click("[data-unwatched]");
      await page.click("[data-cascade]");
      await page.waitForFunction(
        "document.querySelector('[data-tick]').textContent !== ''",
      );
      await page.click("[data-refresh]");
      await page.waitForFunction(
        "document.querySelector('[data-watch-log]').textContent !== ''",
      );

      // Both pairs settle to 3, and which of them reports the trip there is
      // decided by where its observing watch is written. Sides one writes the
      // observer first, so it runs first on a world where `b` is not yet
      // written, reports 1, and runs again once the writer has run. Sides two
      // writes the writer first, so its observer runs once, after. Under R1 this
      // was required to read "one=3;two=3;" either way; R21 revoked the promise
      // that made the two orders equal, and this is the order-decides shape at
      // its plainest.
      assert.equal(
        await page.textContent("[data-watch-log]"),
        "one=1;two=3;one=3;",
      );
      // A corrective watch settles before the DOM is written, so the invalid 10
      // is never rendered.
      assert.equal(
        await page.textContent("[data-render-log]"),
        "n=0;n=5;",
      );
      assert.equal(await page.textContent("[data-corrected]"), "5");
      // The watch body's own reads belong to the body: one write to the watched
      // subject evaluates it once, and the write to the value only the body
      // reads evaluates it not at all.
      assert.equal(await page.textContent("[data-eval-log]"), "ee");
      // tick() drains the queues instead of hopping one microtask.
      assert.equal(await page.textContent("[data-tick]"), "1/1");
      assert.deepEqual(failures, []);
    });
  },
);

// D90 R21, for the spelling that puts the write in a named function: moving the
// two watch blocks past each other changes what the program prints, and that is
// now the guarantee rather than the defect. Nothing classifies the writing watch
// -- not the header, not an inference over the body -- so whichever block is
// written first is the block that runs first.
function helperOrderApplication(writerFirst: boolean): string {
  // The `computed` D90 R15(a) requires travels with the watch that observes it,
  // so the two arrangements stay mirror images: whichever block is written
  // first, the observing watch still reads a value derived from both states.
  const observing = `computed sum = a + b\n\nwatch sum as current, _:\n    log = log + "sum=" + str(current) + ";"`;
  const writing = `watch a:\n    bump(a)`;
  return `
let log = ""

state a: number = 0
state b: number = 0
state revision: number = 0

def bump(value: number):
    b = value * 2

${writerFirst ? writing : observing}

${writerFirst ? observing : writing}

def at(_: number, text: string) -> string:
    return text

component App:
    def run():
        a = 1

    def refresh():
        revision = revision + 1

    return <main>
        <p data-log>{at(revision, log)}</p>
        <button data-run on:click={run}>run</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`.trimStart();
}

test(
  "[R21] a watch that writes through a helper runs where it is written",
  { timeout: 120_000 },
  async () => {
    const logs: string[] = [];
    for (const writerFirst of [false, true]) {
      await mountInChromium(helperOrderApplication(writerFirst), async (page, failures) => {
        await page.click("[data-run]");
        await page.click("[data-refresh]");
        logs.push((await page.textContent("[data-log]")) ?? "");
        assert.deepEqual(failures, []);
      });
    }
    // These two strings are the values this file recorded as the behaviour
    // before R1's fix. Under R21 they are the behaviour: the observing watch
    // declared first runs first, sees a=1 with b not yet written, and runs again
    // when the writer has written it; declared second it runs once, after. This
    // is not a glitch -- the DOM still commits once per turn, and R1's
    // glitch-free guarantee is a different axis and stays live. What changed is
    // how many times the observing watch's body runs.
    assert.deepEqual(logs, ["sum=1;sum=3;", "sum=3;"]);
  },
);
