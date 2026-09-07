import assert from "node:assert/strict";
import test from "node:test";
import { runFixture } from "../support/web-runtime-fixture.ts";

/**
 * D115 P5 — a Web runtime failure stays bounded and is reported once: one
 * subject of the file that was `tests/web/runtime.slow.test.ts` before it
 * reached 1,214 lines.
 *
 * Wave N-2w of the Web surface audit
 * (docs/decisions/archive/COMPLETENESS-AUDITS.md, 审计九). WEB-D2 is the
 * aftermath of a computed cycle, which has to stop instead of storming the
 * flush; WEB-N5 is an unhandled reactive-flush failure, which fails the test it
 * happened in and not the process; WEB-N3 is an action failure, which reports
 * exactly once and keeps its detail. Each runs the real `velar test` pipeline
 * headless, which is the level the audit's evidence was taken at. The bodies
 * below are the bodies that file had.
 */

const probeApplication = `
component App:
    return <p>unused</p>

@main: mount(<App />, "#app")
`;

// ---------------------------------------------------------------------------
// WEB-D2: the aftermath of a computed cycle must be bounded.
// ---------------------------------------------------------------------------

test("[WEB-D2] a recursion-failed computed detaches its edges instead of storming the flush", { timeout: 180_000 }, async () => {
  // The audit's rt5 shape: two computeds cycled through a late-assigned let.
  // The first read produced the owned recursion error (good), but the cyclic
  // edges persisted, so the next flush ping-ponged the two failed computeds
  // into the 100000 whole-flush budget and the resulting unhandled RangeError
  // killed the entire `velar test` process. The recursion-failed computed now
  // detaches its dependency edges, which unwinds the cycle: both flushes
  // survive, re-reads keep yielding the owned error, and the test after it
  // still runs.
  const result = await runFixture("velar-web-runtime-cycle-", {
    application: probeApplication,
    tests: `
import {expect} from "velar/test"

state base = 1
let bRef: (() -> number)? = null

def readA() -> number:
    const f = bRef
    if f != null:
        return base + f()
    return base

computed a = readA()

def readB() -> number:
    return base + a

computed b = readB()
bRef = () => b

test "cycle yields the owned error and the flush survives":
    let first = "none"
    try:
        print(f"unexpected value {a}")
    catch error:
        first = error.message
    expect(first).toBe("A computed value cannot read itself recursively")
    await tick()
    base = 2
    await tick()
    let second = "none"
    try:
        print(f"unexpected value {a}")
    catch error:
        second = error.message
    expect(second).toBe("A computed value cannot read itself recursively")

test "the process survived the cycle":
    expect(1 + 1).toBe(2)
`,
  }, false);
  assert.match(result.output, /2 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});

test("[WEB-D2] computed observers share the 100 self-invalidation cap", { timeout: 180_000 }, async () => {
  // The documented cap only counted render/watch observers; a computed whose
  // own turn kept invalidating it escaped to the whole-flush budget. A
  // computed that writes its own dependency past the cap is now stopped with
  // the same owned report, and the stopped computed stays inert: a later
  // external write must not restart the storm.
  //
  // D114 0.28.0 H-U1: the report names the write. A `state` cell notifies its
  // own subscribers rather than going through the graph's keyed notify, so
  // until that item every self-invalidating write of a declared state was
  // reported with no path at all -- here, and in the watch tier's own 100-round
  // report.
  const result = await runFixture("velar-web-runtime-cap-", {
    application: probeApplication,
    tests: `
import {expect} from "velar/test"
import {onError} from "velar/app"

state counter = 0
state reports: List<string> = []

const stop = onError(report => reports.append(f"{report.phase}:{report.error.message}"))

def noisy() -> number:
    let step = 0
    while step < 150:
        counter += 1
        step += 1
    return counter

computed loud = noisy()

watch loud as current, previous:
    reports.append(f"watched {current}")

test "computed self invalidation stops at the cap":
    expect(loud).toBe(150)
    await tick()
    expect(reports.size).toBe(1)
    expect(reports[0]).toBe("update:A computed value cannot invalidate itself more than 100 times: it writes state 'counter' while reading it")
    counter = 9999
    await tick()
    expect(counter).toBe(9999)
    expect(reports.size).toBe(1)
    stop()
`,
  }, false);
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});

// ---------------------------------------------------------------------------
// WEB-N5: a reactive-flush failure fails one test, not the process.
// ---------------------------------------------------------------------------

test("[WEB-N5] an unhandled reactive-flush failure fails that test and the runner continues", { timeout: 180_000 }, async () => {
  // The unhandled-report escalation used to rethrow from a microtask, which
  // in the headless `velar test` process was an uncaughtException: one bad
  // module killed the whole suite. In a non-browser host the runtime now
  // parks the failure and the next tick() rejects with it, so the test that
  // awaited the flush fails with the real error and the runner reaches the
  // remaining tests and its own summary line.
  const result = await runFixture("velar-web-runtime-flushfail-", {
    application: probeApplication,
    tests: `
import {expect} from "velar/test"

state count = 0

watch count as current, previous:
    if current > 0:
        throw Error("watch exploded")

test "flush failure fails this test":
    count = 1
    await tick()
    print("this line must not be reached")

test "runner continues after the failure":
    expect(1 + 1).toBe(2)
`,
  }, false);
  assert.match(result.output, /✗ .*flush failure fails this test/u, result.output);
  assert.match(result.output, /watch exploded/u, result.output);
  assert.match(result.output, /✓ .*runner continues after the failure/u, result.output);
  assert.match(result.output, /1 passed, 1 failed/u, result.output);
  // The suite failed, but as a counted test failure -- not a dead process.
  assert.equal(result.code, 1, result.output);
});

// ---------------------------------------------------------------------------
// WEB-N3: action failures report exactly once and keep their detail.
// ---------------------------------------------------------------------------

test("[WEB-N3] a detached action failure reports exactly once and superseded failures carry their detail", { timeout: 180_000 }, async () => {
  // The audit's rt4 evidence: a `detach failing()` statement reported the same
  // failure twice (action phase, then a detail-less detached phase), while a
  // superseded older-generation failure arrived only as that empty detached
  // report. The action's own report now wins -- every action failure reports
  // once through the action phase with the action's name as detail -- and the
  // detached observer skips a rejection the action already reported. The
  // newest generation still owns the public error field.
  const result = await runFixture("velar-web-runtime-action-", {
    application: probeApplication,
    tests: `
import {expect} from "velar/test"
import {onError} from "velar/app"

state reports: List<string> = []
const stop = onError(report => reports.append(f"{report.phase}/{report.detail}: {report.error.message}"))

action fires(tag: string, delay: Duration):
    await Promise.sleep(delay)
    throw Error(f"bang {tag}")

test "fire and forget failures report once with detail":
    detach fires("old", 20ms)
    detach fires("new", 60ms)
    await Promise.sleep(150ms)
    await tick()
    expect(fires.error?.message ?? "null").toBe("bang new")
    expect(reports.size).toBe(2)
    expect(reports[0]).toBe("action/fires: bang old")
    expect(reports[1]).toBe("action/fires: bang new")
    stop()
`,
  }, false);
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});
