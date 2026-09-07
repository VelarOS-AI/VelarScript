import assert from "node:assert/strict";
import test from "node:test";
import { runBrowserFixture } from "../support/web-marathon-fixture.ts";

/**
 * D115 P5 — the reactive graph where its symptom was a live page, one subject
 * of the file that was
 * `tests/web/reactive-graph-and-runtime-abi.slow.test.ts` before it reached
 * 881 lines.
 *
 * Fix wave 2 of the marathon defect ledger
 * (docs/decisions/archive/MARATHON-DEFECTS.md): the Web runtime items. Each
 * probe stays at the level the ledger's evidence was taken at.
 * Three of them showed up as something a browser did and are held there:
 * importing `velar/app` must leave every observed computed still scheduling,
 * two watches that invalidate each other must be bounded and reported rather
 * than freezing the flush, and a keyed re-render with identical keys must leave
 * the focused row alone. The bodies below are the bodies that file had.
 */

test("[WEB-D1] importing velar/app keeps every observed computed scheduling", { timeout: 180_000 }, async () => {
  // The first velar/app browser test. Under ESM import order the generated
  // velar/app module stamps the shared runtime registry before the
  // application prelude runs, so registry-owned computed observers resolve
  // their scheduler in velar/app's module scope. That scheduler used to live
  // only in the emitter prelude: one `import {onError} from "velar/app"` made
  // every observed computed throw `__velarSchedule is not defined` on its
  // first invalidation and froze the DOM forever. The scheduler now lives on
  // the registry itself, so whichever module stamps it, notify works.
  const output = await runBrowserFixture("velar-marathon-web-app-computed-", {
    application: `
import {onError} from "velar/app"

component App:
    state count = 0
    computed label = f"count is {count}"

    def bump():
        count += 1

    return <div>
        <p data-label>{label}</p>
        <button data-bump on:click={bump}>inc</button>
    </div>

@main: mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "observed computed updates after state write":
    await browser.open("/")
    expect(await browser.text("[data-label]")).toBe("count is 0")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-label]", "count is 1")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-label]", "count is 2")
`,
  });
  assert.match(output, /1 passed, 0 failed/u);
});

test("[beta-4] two watches that invalidate each other are bounded and reported", { timeout: 180_000 }, async () => {
  // The self-invalidation cap only counted while an observer was running, so a
  // pair of watches that write each other's state never tripped it: the live
  // drain in __velarFlush never terminated, the page froze, and nothing ever
  // reached the error channel.
  const output = await runBrowserFixture("velar-marathon-web-flush-", {
    application: `
import {onError} from "velar/app"

state left = 0
state right = 0
state failure = ""
state independent = 0

def capture(phase: string, message: string):
    failure = phase + ":" + message

watch left:
    right += 1

watch right:
    left += 1

def start():
    left += 1

def bump():
    independent += 1

component App:
    return <main>
        <button data-start on:click={start}>start</button>
        <button data-bump on:click={bump}>bump</button>
        <span data-failure>{failure}</span>
        <span data-independent>{str(independent)}</span>
    </main>

@main:
    onError(report => capture(report.phase, report.error.message))
    mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "cross observer invalidation is reported":
    await browser.open("/")
    await browser.click("[data-start]")
    await browser.waitForText("[data-failure]", "update:Reactive updates cannot run more than 100000 observers in one task")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-independent]", "1")
    expect(await browser.text("[data-independent]")).toBe("1")
`,
  });
  assert.match(output, /1 passed, 0 failed/u);
});

test("[beta-5] a keyed re-render with identical keys leaves the focused row alone", { timeout: 180_000 }, async () => {
  // The placement loop moved every row on every render, so a re-render with
  // identical keys and identical values detached and reattached the focused
  // <input>: a real blur in Chromium, and with it IME composition and any
  // transient subtree state.
  const output = await runBrowserFixture("velar-marathon-web-keyed-", {
    application: `
type Row:
    id: string
    label: string

state rows: List<Row> = [{id: "a", label: "Alpha"}, {id: "b", label: "Beta"}, {id: "c", label: "Gamma"}]
state blurs = 0
state renders = 0

def rerender(event: KeyboardEvent):
    rows = rows.map(row => row)
    renders += 1

def countBlur(event: Event):
    blurs += 1

component App:
    return <main>
        <button data-elsewhere>elsewhere</button>
        <span data-blurs>{str(blurs)}</span>
        <span data-renders>{str(renders)}</span>
        <ul>{rows.map(row =>
            <li key={row.id}><input data-row={row.id} value={row.label} on:keydown={rerender} on:blur={countBlur} /></li>
        )}</ul>
    </main>

@main: mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "identical keys keep focus":
    await browser.open("/")
    await browser.press("[data-row='b']", "x")
    await browser.waitForText("[data-renders]", "1")
    expect(await browser.text("[data-blurs]")).toBe("0")
    await browser.press("[data-row='b']", "y")
    await browser.waitForText("[data-renders]", "2")
    expect(await browser.text("[data-blurs]")).toBe("0")
    expect(await browser.count("li")).toBe(3)

test "the blur probe can observe a real blur":
    await browser.open("/")
    await browser.press("[data-row='b']", "x")
    await browser.waitForText("[data-renders]", "1")
    await browser.click("[data-elsewhere]")
    await browser.waitForText("[data-blurs]", "1")
    expect(await browser.text("[data-blurs]")).toBe("1")
`,
  });
  assert.match(output, /2 passed, 0 failed/u);
});
