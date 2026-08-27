import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { repositoryRoot } from "./repository-root.ts";

const root = repositoryRoot;

// Wave N-2w of the Web surface audit (docs/decisions/archive/COMPLETENESS-AUDITS.md,
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

state reports: List<string> = []
const stop = onError(report => reports.append(f"{report.phase}/{report.detail}: {report.error.message}"))

action fires(tag: string, delay: Duration):
    await Promise.sleep(delay)
    throw Error(f"bang {tag}")

test "fire and forget failures report once with detail":
    async fires("old", 20ms)
    async fires("new", 60ms)
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
// Wave web: the JSX, DOM and component half of the emitted runtime. Every one
// of these was a defect the DOM itself decided, so each runs the emitted
// application in Chromium and asks the document what happened.
// ---------------------------------------------------------------------------

async function mountInChromium(
  source: string,
  visit: (page: Page, failures: readonly string[]) => Promise<void>,
): Promise<void> {
  const result = compileCore(source, { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => {
      failures.push(String(error));
    });
    await page.setContent(
      '<!doctype html><html><body><div id="app"></div></body></html>',
    );
    await page.addScriptTag({ content: result.code ?? "", type: "module" });
    await page.waitForFunction(
      "document.querySelector('#app').childNodes.length > 0",
    );
    await visit(page, failures);
  } finally {
    await browser.close();
  }
}

const keyedApplication = `
type Item:
    id: string

state items: List<Item> = [{id: "a"}, {id: "b"}]
state phase: number = 0

component Row(id: string):
    return <>
        <li host data-id={id}>head</li>
        {phase > 0 ? <li data-dyn="yes">second</li> : <li data-dyn="no">first</li>}
    </>

component App:
    def advance():
        phase = 1

    def reorder():
        items = items.reversed()

    return <main>
        <ul data-list>{items.map(row => <Row key={row.id} id={row.id} />)}</ul>
        <button data-advance on:click={advance}>advance</button>
        <button data-reorder on:click={reorder}>reorder</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a keyed reorder moves the nodes a row has now, not the ones it was built from",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(keyedApplication, async (page, failures) => {
      const replaced = await page.evaluateHandle<readonly Element[]>(
        "Array.from(document.querySelectorAll('[data-dyn=\"no\"]'))",
      );
      await page.click("[data-advance]");
      await page.waitForFunction(
        "document.querySelectorAll('[data-dyn=\"yes\"]').length === 2",
      );
      await page.click("[data-reorder]");
      await page.waitForFunction(
        "Array.from(document.querySelectorAll('[data-id]')).map(node => node.dataset.id).join(',') === 'b,a'",
      );

      // The rows a reorder moves are the ones on screen. Before the fix the
      // cached node list put the destroyed nodes back into the document and
      // left the live ones stranded outside their own markers.
      assert.equal(
        await page.evaluate(
          "Array.from(document.querySelectorAll('[data-dyn]')).map(node => node.dataset.dyn).join(',')",
        ),
        "yes,yes",
      );
      assert.equal(
        await page.evaluate(
          (nodes: readonly Element[]) => nodes.filter((node) => node.isConnected).length,
          replaced,
        ),
        0,
      );
      // Every live node still sits between its own region markers, so it can
      // still be updated and removed.
      assert.equal(
        await page.evaluate(
          "Array.from(document.querySelector('[data-list]').childNodes).map(node => node.nodeType === 8 ? '#' + node.data : node.dataset.id ? 'head:' + node.dataset.id : 'dyn:' + node.dataset.dyn).join('|')",
        ),
        "#velar:keyed-start|head:b|#velar:start|dyn:yes|#velar:end|head:a|#velar:start|dyn:yes|#velar:end|#velar:keyed-end",
      );
      assert.deepEqual(failures, []);
    });
  },
);

const childrenApplication = `
state shown: bool = true

component Toggle(children: WebNode):
    return <div data-slot>{shown ? children : null}</div>

component Twice(children: WebNode):
    return <div data-twice><span data-first>{children}</span><span data-second>{children}</span></div>

component App:
    def flip():
        shown = not shown

    return <main>
        <Toggle><p data-inner>inner</p></Toggle>
        <Twice><em data-copy>copy</em></Twice>
        <button data-flip on:click={flip}>flip</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a children slot is rendered content the showing position owns and can render again",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(childrenApplication, async (page, failures) => {
      assert.equal(await page.textContent("[data-slot]"), "inner");
      await page.click("[data-flip]");
      await page.waitForFunction(
        "document.querySelector('[data-slot]').textContent === ''",
      );
      await page.click("[data-flip]");
      // In JSX false means not rendered, and rendering it again is what
      // rendering means. Before the fix the slot was a one-shot fragment: the
      // first time it was hidden the content was destroyed for good.
      await page.waitForFunction(
        "document.querySelector('[data-slot]').textContent === 'inner'",
      );
      // Two positions each render their own subtree.
      assert.equal(await page.textContent("[data-first]"), "copy");
      assert.equal(await page.textContent("[data-second]"), "copy");
      assert.equal(
        await page.evaluate("document.querySelectorAll('[data-copy]').length"),
        2,
      );
      assert.deepEqual(failures, []);
    });
  },
);

const hostApplication = `
component Field:
    return <>
        <label>L</label>
        <input host data-field />
    </>

component Card:
    return <>
        <header data-header>H</header>
        <div host data-card>
            <Field />
        </div>
    </>

component Forwarded:
    return <Field />

component App:
    return <main>
        <Card look:color={"red"} />
        <Forwarded look:color={"blue"} />
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a nested component's host stays its own and the enclosing one keeps forwarding",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(hostApplication, async (page, failures) => {
      // The caller's look lands on the outer component's own host element, not
      // on the nested component's. Before the fix the subtree scan counted the
      // nested host as a second host and the whole region collapsed to a
      // component-error comment.
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-card]').getAttribute('data-velar-look')",
        ),
        "base:color",
      );
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-header]').getAttribute('data-velar-look')",
        ),
        null,
      );
      // A component whose root is another component still forwards to that
      // component's host in turn.
      assert.equal(
        await page.evaluate(
          "document.querySelectorAll('[data-field]')[1].getAttribute('data-velar-look')",
        ),
        "base:color",
      );
      assert.equal(
        await page.evaluate(
          "document.querySelectorAll('[data-field]')[0].getAttribute('data-velar-look')",
        ),
        null,
      );
      assert.equal(
        await page.evaluate(
          "document.querySelectorAll('#app main > *').length > 0",
        ),
        true,
      );
      assert.deepEqual(failures, []);
    });
  },
);

// Three nesting depths for one boundary: a nested component's host sits one
// level below its root, two levels below it, and inside a nested component of a
// nested component. Skipping the marked root alone left every one of these
// counted as a second host of the enclosing component.
const buriedHostApplication = `
component One:
    return <>
        <label>L</label>
        <div><input host data-one /></div>
    </>

component Two:
    return <>
        <label>L</label>
        <section><div><input host data-two /></div></section>
    </>

component Three:
    return <>
        <span>S</span>
        <div><One /></div>
        <p><input host data-three /></p>
    </>

component Card:
    return <>
        <header><One /></header>
        <div host data-card>D</div>
    </>

component Deep:
    return <>
        <header><Two /></header>
        <div host data-deep>D</div>
    </>

component Outer:
    return <>
        <header><Three /></header>
        <div host data-outer>D</div>
    </>

component App:
    return <main>
        <Card look:color={"red"} />
        <Deep look:color={"green"} />
        <Outer look:color={"blue"} />
    </main>

mount(<App />, "#app")
`.trimStart();

// The analyzer refuses a statically visible second host (VEL5043), so the
// runtime message is only reachable where the second host is decided at render
// time. That is also the case that proves the boundary walk still finds this
// component's own hosts at depth.
const twoHostApplication = `
state flag: bool = true

component Card:
    return <>
        <div><span host data-x>x</span></div>
        <div>{flag ? <span host data-y>y</span> : null}</div>
    </>

component App:
    return <main><Card look:color={"red"} /></main>

mount(<App />, "#app")
`.trimStart();

test(
  "a host buried in a nested component stays that component's at every depth",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(buriedHostApplication, async (page, failures) => {
      const looks = await page.evaluate(`(() => {
        const read = (selector) => {
          const element = document.querySelector(selector);
          return element === null ? null : [
            element.getAttribute("data-velar-look"),
            element.style.getPropertyValue("--velar-look-base-color"),
          ];
        };
        return {
          card: read("[data-card]"), deep: read("[data-deep]"), outer: read("[data-outer]"),
          one: read("[data-one]"), two: read("[data-two]"), three: read("[data-three]"),
          collapsed: document.querySelector("#app").innerHTML.includes("velar:component-error"),
        };
      })()`);
      // Each caller's look lands on the outer component's own host, and the
      // buried hosts keep carrying nothing of the caller's.
      assert.deepEqual(looks, {
        card: ["base:color", "red"],
        deep: ["base:color", "green"],
        outer: ["base:color", "blue"],
        one: [null, ""],
        two: [null, ""],
        three: [null, ""],
        collapsed: false,
      });
      assert.deepEqual(failures, []);
    });
  },
);

// The same boundary standing at the root level. A nested component placed
// among the enclosing component's own root nodes carries its host on its own
// marked root, which the resolver read as a second host of the enclosing one —
// the buried-host defect one step sideways. 'Sibling' pairs it with an own host
// beside it, 'Deeper' with an own host below root level, 'Pair' with two nested
// components at once, and 'Chain' forwards twice with no own host at all.
const rootLevelHostApplication = `
component Leaf:
    return <>
        <i data-leaf>a</i>
        <b host data-leaf-host>b</b>
    </>

component Mid:
    return <Leaf />

component Sibling:
    return <>
        <header host data-sibling>H</header>
        <Leaf />
    </>

component Deeper:
    return <>
        <header><span host data-deeper>H</span></header>
        <Leaf />
    </>

component Pair:
    return <>
        <header host data-pair>H</header>
        <Leaf />
        <Leaf />
    </>

component Chain:
    return <Mid />

component App:
    return <main>
        <Sibling look:color={"red"} />
        <Deeper look:color={"green"} />
        <Pair look:color={"blue"} />
        <Chain look:color={"purple"} />
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a nested component's host at the enclosing root level stays its own",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(rootLevelHostApplication, async (page, failures) => {
      const looks = await page.evaluate(`(() => {
        const describe = (element) => element === null ? null : [
          element.getAttribute("data-velar-look"),
          element.style.getPropertyValue("--velar-look-base-color"),
        ];
        const read = (selector) => describe(document.querySelector(selector));
        return {
          sibling: read("[data-sibling]"), deeper: read("[data-deeper]"), pair: read("[data-pair]"),
          // Four Leaf instances in document order: Sibling's, Deeper's, Pair's
          // two, then Chain's, which is the only host forwarded to.
          leaves: Array.from(document.querySelectorAll("[data-leaf-host]"), describe),
          collapsed: document.querySelector("#app").innerHTML.includes("velar:component-error"),
        };
      })()`);
      assert.deepEqual(looks, {
        sibling: ["base:color", "red"],
        deeper: ["base:color", "green"],
        pair: ["base:color", "blue"],
        leaves: [
          [null, ""],
          [null, ""],
          [null, ""],
          [null, ""],
          ["base:color", "purple"],
        ],
        collapsed: false,
      });
      assert.deepEqual(failures, []);
    });
  },
);

test(
  "a component that really declares two hosts still says so",
  { timeout: 120_000 },
  async () => {
    const result = compileCore(twoHostApplication, {
      extensions: [velarCompilerExtension],
    });
    assert.deepEqual(result.diagnostics, []);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const failures: string[] = [];
      page.on("pageerror", (error) => {
        failures.push(String(error));
      });
      await page.setContent(
        '<!doctype html><html><body><div id="app"></div></body></html>',
      );
      await page.addScriptTag({ content: result.code ?? "", type: "module" });
      await page.waitForFunction(
        "document.querySelector('#app').childNodes.length > 0",
      );
      assert.deepEqual(failures, [
        "TypeError: A component can declare only one host element",
      ]);
    } finally {
      await browser.close();
    }
  },
);

test("a multi-root component with no host is refused before it renders", () => {
  const result = compileCore(
    [
      "component Card:",
      "    return <>",
      "        <div data-a>a</div>",
      "        <div data-b>b</div>",
      "    </>",
      "",
      "component App:",
      '    return <main><Card look:color={"red"} /></main>',
      "",
      'mount(<App />, "#app")',
      "",
    ].join("\n"),
    { extensions: [velarCompilerExtension] },
  );
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
    "Component 'Card' has multiple roots and must mark exactly one native element with 'host'",
  ]);
});

// R3(b) at the level the defect was reported at: the caller writes the property
// only under a condition, so the component's resting value must survive.
const refinedLookApplication = `
export const inner = look:
    color = "black"
    padding = 20px
    if @hover:
        color = "red"

export const caller = look:
    if @hover:
        color = "blue"

component Inner:
    return <div look={inner} data-target>inner</div>

component App:
    return <main><Inner look={caller} /></main>

mount(<App />, "#app")
`.trimStart();

test(
  "a caller's conditional Look refines the condition and keeps the resting value",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(refinedLookApplication, async (page, failures) => {
      const applied = await page.evaluate(`(() => {
        const element = document.querySelector("[data-target]");
        return {
          tokens: element.getAttribute("data-velar-look"),
          base: element.style.getPropertyValue("--velar-look-base-color"),
          hover: element.style.getPropertyValue("--velar-look-hover-color"),
          padding: element.style.getPropertyValue("--velar-look-base-padding"),
        };
      })()`);
      assert.deepEqual(applied, {
        tokens: "base:color base:padding hover:color",
        base: "black",
        hover: "blue",
        padding: "20px",
      });
      assert.deepEqual(failures, []);
    });
  },
);

const surfaceApplication = `
let heavyRuns = ""

state count: number = 0
state dismissed: number = 0
state revision: number = 0

def heavy(value: number) -> string:
    heavyRuns = heavyRuns + "x"
    return str(value)

def at(_: number, text: string) -> string:
    return text

component Child(unused: string):
    return <p data-child>fixed</p>

component App:
    def dismiss():
        dismissed = dismissed + 1

    def bump():
        count = count + 1

    def refresh():
        revision = revision + 1

    return <main>
        <Child unused={heavy(count)} />
        <p data-heavy>{at(revision, heavyRuns)}</p>
        <div data-group role="group" on:click.self.once={dismiss}>
            <button data-inner type="button">child</button>
        </div>
        <p data-dismissed>{dismissed}</p>
        <button data-bump on:click={bump}>bump</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "an unread prop is not re-evaluated and on:click.self.once still fires for the element itself",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(surfaceApplication, async (page, failures) => {
      await page.click("[data-bump]");
      await page.click("[data-bump]");
      await page.click("[data-refresh]");
      await page.waitForFunction(
        "document.querySelector('[data-heavy]').textContent !== ''",
      );
      // The prop expression runs once, when the component reads the prop it
      // declared. Before the fix an eager observer pushed it on every change of
      // a value the child's DOM never shows.
      assert.equal(await page.textContent("[data-heavy]"), "x");

      // A bubbled click from a descendant is filtered by 'self', and must not
      // spend the 'once' registration on the way.
      await page.click("[data-inner]");
      assert.equal(await page.textContent("[data-dismissed]"), "0");
      await page.evaluate("document.querySelector('[data-group]').click()");
      await page.waitForFunction(
        "document.querySelector('[data-dismissed]').textContent === '1'",
      );
      await page.evaluate("document.querySelector('[data-group]').click()");
      await page.waitForTimeout(50);
      assert.equal(await page.textContent("[data-dismissed]"), "1");
      assert.deepEqual(failures, []);
    });
  },
);

const urlApplication = `
state target = "/settings"

component App:
    def attack():
        target = "javascript:globalThis.velarPwned = 1"

    return <main>
        <a data-link href={target}>open</a>
        <button data-attack on:click={attack}>attack</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "URL attributes carry locations, never script schemes",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(urlApplication, async (page, failures) => {
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-link]').getAttribute('href')",
        ),
        "/settings",
      );
      await page.click("[data-attack]");
      await page.waitForTimeout(100);
      // The value is refused rather than written, so the anchor keeps the last
      // location it had and nothing executes.
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-link]').getAttribute('href')",
        ),
        "/settings",
      );
      await page.evaluate("document.querySelector('[data-link]').click()");
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate("globalThis.velarPwned ?? null"), null);
      assert.equal(failures.length, 1);
      assert.match(
        failures[0] ?? "",
        /JSX attribute 'href' rejected the 'javascript:' URL scheme/u,
      );
    });
  },
);

function listApplication(size: number): string {
  return `
type Item:
    id: string
    title: string

state items: List<Item> = []

component App:
    def build():
        let next: List<Item> = []
        let index = 0
        while index < ${String(size)}:
            next.append({id: str(index), title: "t"})
            index = index + 1
        items = next

    def rewrite():
        let index = 0
        while index < 2000:
            items[index] = {id: str(index), title: "u"}
            index = index + 1

    return <main>
        <ul data-list>{items.map(row => <li key={row.id}>{row.title}</li>)}</ul>
        <button data-build on:click={build}>build</button>
        <button data-rewrite on:click={rewrite}>rewrite</button>
    </main>

mount(<App />, "#app")
`.trimStart();
}

async function rewriteCost(size: number): Promise<number> {
  let elapsed = 0;
  await mountInChromium(listApplication(size), async (page, failures) => {
    await page.click("[data-build]");
    await page.waitForFunction(
      `document.querySelectorAll('[data-list] li').length === ${String(size)}`,
      undefined,
      { timeout: 60_000 },
    );
    elapsed = await page.evaluate(
      "(() => { const started = performance.now(); document.querySelector('[data-rewrite]').click(); return performance.now() - started; })()",
    );
    assert.deepEqual(failures, []);
  });
  return elapsed;
}

test(
  "an element write on a rendered List costs the same whatever the List's length",
  { timeout: 300_000 },
  async () => {
    const small = await rewriteCost(2000);
    const large = await rewriteCost(40_000);
    // Containment used to be re-derived by scanning the whole container on
    // every write, so the same 2000 writes cost twenty times more at twenty
    // times the length. The bound is loose enough for a busy machine and far
    // inside the linear cost it replaces.
    assert.ok(
      large <= small * 6 + 250,
      `2000 element writes cost ${String(Math.round(small))}ms at 2000 rows and ${String(Math.round(large))}ms at 40000 rows`,
    );
  },
);

const attributeStormApplication = `
type Row:
    id: string

state theme = "light"
state rows: List<Row> = []

component Cell(id: string, theme: string):
    return <li ${Array.from({ length: 30 }, (_, index) => `data-x${String(index)}={theme}`).join(" ")} data-id={id}>x</li>

component App:
    def build():
        let next: List<Row> = []
        let index = 0
        while index < 3500:
            next.append({id: str(index)})
            index = index + 1
        rows = next

    def toggle():
        theme = theme == "light" ? "dark" : "light"

    return <main>
        <ul data-list>{rows.map(row => <Cell key={row.id} id={row.id} theme={theme} />)}</ul>
        <button data-build on:click={build}>build</button>
        <button data-toggle on:click={toggle}>toggle</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "more observers than the queue bound is the flush budget's failure, not the assignment's",
  { timeout: 300_000 },
  async () => {
    await mountInChromium(attributeStormApplication, async (page, failures) => {
      await page.click("[data-build]");
      await page.waitForFunction(
        "document.querySelectorAll('[data-id]').length === 3500",
        undefined,
        { timeout: 120_000 },
      );
      await page.click("[data-toggle]");
      // 105000 attribute observers on one cell. Throwing from the queue left
      // the writing cell's subscriber walk half finished, with the last rows
      // subscribed and never notified again; the budget instead reports once
      // and finishes the work on the following microtask.
      await page.waitForFunction(
        "Array.from(document.querySelectorAll('[data-id]')).every(node => node.getAttribute('data-x29') === 'dark')",
        undefined,
        { timeout: 120_000 },
      );
      assert.ok(
        failures.every((failure) =>
          /Reactive updates cannot run more than 100000 observers in one flush/u.test(failure)
        ),
        failures.join(" | "),
      );
    });
  },
);
