import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);

// Wave N-2w of the Web surface audit (docs/handoff/COMPLETENESS-AUDITS.md,
// 审计九): the Web runtime hotfixes. Each regression runs at the level the
// audit's evidence was taken at -- the reactive-graph items run the real
// `velar test` pipeline headless, and the two no-blank-page paths run in
// Chromium, because the defect was a blank page.

interface Fixture {
  readonly application: string;
  readonly tests?: string;
  readonly browserTests?: string;
}

interface RunResult {
  readonly output: string;
  readonly code: number | null;
}

async function runFixture(prefix: string, fixture: Fixture, browser: boolean): Promise<RunResult> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "Web runtime hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), fixture.application, "utf8");
    if (fixture.tests !== undefined) {
      await writeFile(join(directory, "src", "runtime.test.vel"), fixture.tests, "utf8");
    }
    if (fixture.browserTests !== undefined) {
      await writeFile(join(directory, "src", "runtime.browser.test.vel"), fixture.browserTests, "utf8");
    }
    return await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory,
      ...(browser ? ["--browser", "chromium"] : []),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Captures output and exit code without rejecting: half of these regressions
// assert that a run FAILS in a specific bounded way instead of dying.
function runCommand(command: string, arguments_: readonly string[]): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => resolvePromise({ output, code }));
  });
}

const probeApplication = `
component App:
    return <p>unused</p>

mount(<App />, "#app")
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

const a = computed(readA)

def readB() -> number:
    return base + a()

const b = computed(readB)
bRef = b

async def test_cycle_yields_the_owned_error_and_the_flush_survives() -> null:
    let first = "none"
    try:
        print(f"unexpected value {a()}")
    catch error:
        first = error.message
    expect(first).toBe("A computed value cannot read itself recursively")
    await tick()
    base = 2
    await tick()
    let second = "none"
    try:
        print(f"unexpected value {a()}")
    catch error:
        second = error.message
    expect(second).toBe("A computed value cannot read itself recursively")

def test_the_process_survived_the_cycle() -> null:
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

const loud = computed(noisy)

watch loud() as current, previous:
    reports.append(f"watched {current}")

async def test_computed_self_invalidation_stops_at_the_cap() -> null:
    expect(loud()).toBe(150)
    await tick()
    expect(reports.size).toBe(1)
    expect(reports[0]).toBe("update:A computed value cannot invalidate itself more than 100 times")
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

async def test_flush_failure_fails_this_test() -> null:
    count = 1
    await tick()
    print("this line must not be reached")

def test_runner_continues_after_the_failure() -> null:
    expect(1 + 1).toBe(2)
`,
  }, false);
  assert.match(result.output, /✗ .*test_flush_failure_fails_this_test/u, result.output);
  assert.match(result.output, /watch exploded/u, result.output);
  assert.match(result.output, /✓ .*test_runner_continues_after_the_failure/u, result.output);
  assert.match(result.output, /1 passed, 1 failed/u, result.output);
  // The suite failed, but as a counted test failure -- not a dead process.
  assert.equal(result.code, 1, result.output);
});

// ---------------------------------------------------------------------------
// WEB-N3: action failures report exactly once and keep their detail.
// ---------------------------------------------------------------------------

test("[WEB-N3] a detached action failure reports exactly once and superseded failures carry their detail", { timeout: 180_000 }, async () => {
  // The audit's rt4 evidence: a detached `async failing()` reported the same
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
import {sleep} from "velar/async"

state reports: List<string> = []
const stop = onError(report => reports.append(f"{report.phase}/{report.detail}: {report.error.message}"))

action fires(tag: string, ms: number) -> null:
    await sleep(ms)
    throw Error(f"bang {tag}")

async def test_fire_and_forget_failures_report_once_with_detail() -> null:
    async fires("old", 20)
    async fires("new", 60)
    await sleep(150)
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

// ---------------------------------------------------------------------------
// WEB-D3: the no-blank-page promise on its two previously broken paths.
// ---------------------------------------------------------------------------

test("[WEB-D3] a dynamic-region failure during the initial render shows the fatal state", { timeout: 180_000 }, async () => {
  // web-api.md promises a compiler-owned accessible fatal state instead of a
  // blank page when the initial render fails. A throw inside a dynamic region
  // during the INITIAL render used to be swallowed by the region's observer:
  // the page stayed blank and the failure was console-only. Initial DOM
  // observer runs are construction and construction is transactional, so the
  // failure now reaches the mount transaction and the fatal state renders.
  const result = await runFixture("velar-web-runtime-renderthrow-", {
    application: `
import {onError} from "velar/app"

onError(report => null)

def explode() -> string:
    throw Error("construction boom")

component App:
    return <p>{explode()}</p>

mount(<App />, "#app")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_initial_render_failure_shows_the_fatal_state() -> null:
    await browser.open("/")
    expect(await browser.count("[data-velar-fatal]")).toBe(1)
    expect(await browser.text("[data-velar-fatal]")).toContain("construction boom")
`,
  }, true);
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});

test("[WEB-D3] a missing mount target shows the fatal state instead of a blank page", { timeout: 180_000 }, async () => {
  // The missing-target throw used to escape module evaluation: console-only
  // in a production build, blank page in every build. The failure is now
  // reported through velar/app with the mount phase and the fatal state
  // renders into the document body, since the requested target is exactly
  // what does not exist.
  const result = await runFixture("velar-web-runtime-missingtarget-", {
    application: `
import {onError} from "velar/app"

onError(report => null)

component App:
    return <p>hello</p>

mount(<App />, "#missing")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_missing_mount_target_shows_the_fatal_state() -> null:
    await browser.open("/")
    expect(await browser.count("[data-velar-fatal]")).toBe(1)
    expect(await browser.text("[data-velar-fatal]")).toContain("mount target was not found")
`,
  }, true);
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});
