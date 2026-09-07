import assert from "node:assert/strict";
import test from "node:test";
import { runFixture } from "../support/web-runtime-fixture.ts";

/**
 * D115 P5 — WEB-D3, the no-blank-page promise, from the file that was
 * `tests/web/runtime.slow.test.ts` before it reached 1,214 lines.
 *
 * `velar/app` promises the compiler-owned accessible fatal state on every
 * initial-render path, and wave N-2w of the Web surface audit found three paths
 * that showed a blank page instead: a dynamic region that failed during the
 * first render, a mount target that was not there, and a root built while the
 * module evaluated. The last of those runs in Chromium, Firefox and WebKit in
 * turn, with the healthy case beside it, because its evidence is that every
 * engine agrees. The bodies below are the bodies that file had.
 */

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

def explode() -> string:
    throw Error("construction boom")

component App:
    return <p>{explode()}</p>

@main:
    onError(report => null)
    mount(<App />, "#app")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "initial render failure shows the fatal state":
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

component App:
    return <p>hello</p>

@main:
    onError(report => null)
    mount(<App />, "#missing")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "missing mount target shows the fatal state":
    await browser.open("/")
    expect(await browser.count("[data-velar-fatal]")).toBe(1)
    expect(await browser.text("[data-velar-fatal]")).toContain("mount target was not found")
`,
  }, true);
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});

// ---------------------------------------------------------------------------
// WEB-D3, third path: the root built while the module evaluates.
// ---------------------------------------------------------------------------

test("[WEB-D3] a module-level root whose construction throws shows the fatal state on every engine", { timeout: 600_000 }, async () => {
  // `const root = <Boom />` is D90 R4-b's designed site, and it built its
  // instance outside every transaction the runtime owns: the construction throw
  // escaped module evaluation, so `mount(<Boom />, "#app")` showed the fatal
  // state and the identical application written with the root in a binding
  // showed a blank page. The site stays legal and stays eager; only its failure
  // moves, onto the same machinery the other initial-render paths use.
  //
  // The status root mounts into `body` before the failing one so it survives:
  // the fatal state replaces the children of the target it renders into, which
  // is `#app`. That is also what makes "once" measurable -- the handler counts
  // the reports and the surviving root shows the count.
  const result = await runFixture("velar-web-runtime-modulefatal-", {
    application: `
import {onError} from "velar/app"

state reports = ""

def record(phase: string):
    reports = reports + phase + ";"

component Boom():
    if true:
        throw Error("module setup exploded")
    return <p>ok</p>

component Status:
    return <p data-reports>{reports}</p>

const root = <Boom />

@main:
    onError(report => record(report.phase))
    mount(<Status />, "body")
    mount(root, "#app")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "a failed module-level construction shows the fatal state, once, in the mount target":
    await browser.open("/")
    expect(await browser.count("[data-velar-fatal]")).toBe(1)
    expect(await browser.text("[data-velar-fatal]")).toContain("module setup exploded")
    // The velar/app channel receives it exactly once, under the same phase the
    // inline 'mount(<Boom />, "#app")' spelling reports: one root, one failure.
    expect(await browser.text("[data-reports]")).toBe("mount;")
`,
  }, "all");
  assert.match(result.output, /3 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});

test("[WEB-D3] a healthy module-level root is untouched on every engine", { timeout: 600_000 }, async () => {
  // The other half of the ruling: the designed site keeps working exactly as it
  // did, props and all, and nothing about it now reports or renders a fatal
  // state it did not before.
  const result = await runFixture("velar-web-runtime-modulehealthy-", {
    application: `
import {onError} from "velar/app"

state reports = 0

def record():
    reports = reports + 1

component Child(label: string):
    return <p data-label>{label}</p>

const root = <Child label="ready" />

@main:
    onError(report => record())
    mount(root, "#app")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "a healthy module-level root renders and reports nothing":
    await browser.open("/")
    expect(await browser.count("[data-velar-fatal]")).toBe(0)
    expect(await browser.text("[data-label]")).toBe("ready")
`,
  }, "all");
  assert.match(result.output, /3 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});
