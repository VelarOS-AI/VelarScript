import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { compile as compileCore } from "@velarscript/compiler";
import { standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { LOOK_TRANSITION_PROPERTY_KEYWORDS } from "../packages/web/src/look.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { repositoryRoot } from "./repository-root.ts";

const root = repositoryRoot;

// Fix wave 2 of the marathon defect ledger (docs/decisions/archive/MARATHON-DEFECTS.md):
// the Web runtime items. Each probe stays at the level the ledger's evidence
// was taken at -- the reactive graph is read directly where retention was
// measured, and the two items whose symptom is a live page (a frozen flush, a
// lost focus) run in Chromium.

function compile(source: string) {
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

function compiled(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code);
  return result.code;
}

/** Runs an emitted Web module under Node with a JavaScript probe appended to it. */
function probeModule(source: string, probe: string, flags: readonly string[] = [], environment: Record<string, string> = {}) {
  const execution = spawnSync(process.execPath, [...flags, "--input-type=module"], {
    encoding: "utf8",
    input: `${compiled(source)}\n${probe}`,
    env: { ...process.env, ...environment },
  });
  assert.equal(execution.status, 0, String(execution.stderr || execution.error));
  return execution;
}

function measurement<T>(execution: { stdout: string }): T {
  const line = execution.stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line) as T;
}

interface RootReplacementProbe {
  readonly parents: number;
  readonly microseconds: number;
  readonly alive: number;
  readonly total: number;
}

// ---------------------------------------------------------------------------
// beta-1: replacing a state root left every descendant linked to the dead root.
// ---------------------------------------------------------------------------

const rootReplacementProgram = `
type Theme:
    mode: string

type Settings:
    label: string
    theme: Theme

state settings: Settings = {label: "start", theme: {mode: "dark"}}
let changes = 0

watch settings.theme.mode:
    changes += 1

def replace(label: string):
    settings = {...settings, label: label}

def touch(mode: string):
    settings.theme.mode = mode
`;

const rootReplacementProbe = `
const __probeRuntime = globalThis[Symbol.for("velar.runtime.v1")];
const __probeGenerations = Number(process.env.VELAR_PROBE_GENERATIONS);
const __probeRoots = [];
for (let index = 0; index < __probeGenerations; index += 1) {
  __probeRoots.push(new WeakRef(__probeRuntime.toRaw(settings.get())));
  replace("label-" + index);
}
const __probeTheme = __probeRuntime.toRaw(__probeRuntime.toRaw(settings.get()).theme);
const __probeMeasure = (rounds) => {
  const start = process.hrtime.bigint();
  for (let index = 0; index < rounds; index += 1) touch(index % 2 === 0 ? "dark" : "light");
  return Number(process.hrtime.bigint() - start) / rounds / 1000;
};
__probeMeasure(500);
const __probeCost = __probeMeasure(2000);
const __probeParents = __probeRuntime.parents.get(__probeTheme);
for (let round = 0; round < 3; round += 1) {
  globalThis.gc();
  await new Promise((resolve) => setTimeout(resolve, 20));
}
let __probeAlive = 0;
for (const reference of __probeRoots) if (reference.deref()) __probeAlive += 1;
console.log(JSON.stringify({
  parents: __probeParents ? __probeParents.size : 0,
  microseconds: __probeCost,
  alive: __probeAlive,
  total: __probeRoots.length,
}));
`;

test("[beta-1] replacing a state root releases the dead root and keeps deep mutation flat", { timeout: 180_000 }, (t) => {
  // The idiom is the one docs/web-api.md teaches: `settings = {...settings, ...}`.
  // Before the fix the surviving `theme` kept one parent link per replaced root,
  // so every dead root stayed strongly reachable (200/200 alive after gc, 200
  // parents) and each deep mutation walked one more generation (51 generations
  // 9.1us, 3200 generations 268.6us on the baseline machine).
  const shallow = measurement<RootReplacementProbe>(probeModule(rootReplacementProgram, rootReplacementProbe, ["--expose-gc"], {
    VELAR_PROBE_GENERATIONS: "51",
  }));
  const deep = measurement<RootReplacementProbe>(probeModule(rootReplacementProgram, rootReplacementProbe, ["--expose-gc"], {
    VELAR_PROBE_GENERATIONS: "3200",
  }));
  t.diagnostic(`51 generations: ${deep.total === 51 ? "" : ""}parents ${shallow.parents}, ${shallow.alive}/${shallow.total} roots alive, `
    + `${shallow.microseconds.toFixed(3)}us per deep mutation`);
  t.diagnostic(`3200 generations: parents ${deep.parents}, ${deep.alive}/${deep.total} roots alive, `
    + `${deep.microseconds.toFixed(3)}us per deep mutation`);

  // The live root owns the surviving descendant, and nothing else does.
  assert.equal(shallow.parents, 1, "a replaced state root still owns a descendant");
  assert.equal(deep.parents, 1, "a replaced state root still owns a descendant");
  // The most recent `previous` value can still be held by the running frame, so
  // the bound is a constant, not zero -- what must not survive is a count that
  // grows with the number of replacements.
  assert.ok(shallow.alive <= 2, `${shallow.alive} of ${shallow.total} replaced roots survived collection`);
  assert.ok(deep.alive <= 2, `${deep.alive} of ${deep.total} replaced roots survived collection`);
  // 3200 generations cost 268.6us per deep mutation before the fix; the bubble
  // walk is now independent of how many roots were replaced.
  assert.ok(deep.microseconds < 25, `a deep mutation after 3200 replacements took ${deep.microseconds.toFixed(3)}us`);
  assert.ok(deep.microseconds < shallow.microseconds * 4,
    `deep mutation still scales with replacements: ${shallow.microseconds.toFixed(3)}us at 51 vs ${deep.microseconds.toFixed(3)}us at 3200`);
});

// ---------------------------------------------------------------------------
// beta-7 / beta-9: the record write and property read paths.
// ---------------------------------------------------------------------------

const recordWriteProgram = `
type Section:
    label: string

type Form:
    one: string
    two: string
    three: string
    four: string
    five: string
    six: string
    seven: string
    eight: string
    section: Section

state form: Form = {one: "", two: "", three: "", four: "", five: "", six: "", seven: "", eight: "", section: {label: "start"}}

def typeInto(value: string):
    form.one = value

def replaceSection(label: string):
    form.section = {label: label}
`;

test("[beta-7] a primitive record-field write never probes collection identity", { timeout: 180_000 }, (t) => {
  // `contains` ran on every write, including writes of a primitive where
  // `unlink` is a documented no-op: two thrown-and-caught exceptions plus a
  // descriptor walk over every field, on every keystroke through bind:value.
  const measured = measurement<{ readonly microseconds: number; readonly detached: number; readonly attached: number }>(probeModule(recordWriteProgram, `
const __probeRuntime = globalThis[Symbol.for("velar.runtime.v1")];
const __probeMeasure = (rounds) => {
  const start = process.hrtime.bigint();
  for (let index = 0; index < rounds; index += 1) typeInto(index % 2 === 0 ? "a" : "b");
  return Number(process.hrtime.bigint() - start) / rounds / 1000;
};
__probeMeasure(2000);
const __probeCost = __probeMeasure(20000);

// The object case still detaches: the replaced section loses its owner and
// with it every link the dead section alone held.
const __probeSection = __probeRuntime.toRaw(form.get().section);
replaceSection("next");
console.log(JSON.stringify({
  microseconds: __probeCost,
  detached: __probeRuntime.parents.has(__probeSection) ? 0 : 1,
  attached: __probeRuntime.parents.has(__probeRuntime.toRaw(form.get().section)) ? 1 : 0,
}));
`));
  t.diagnostic(`record-field write ${(measured.microseconds * 1000).toFixed(0)}ns (baseline before the fix: 4858ns)`);
  assert.equal(measured.detached, 1, "the replaced record field kept its owner");
  assert.equal(measured.attached, 1, "the new record field never became owned");
  // 4.86us per write before the fix, 0.41us after. Windows' timer and hosted
  // runner overhead is measurably higher, but 3us still separates that noise
  // from the old throwing collection-brand probe.
  const budget = process.platform === "win32" ? 3 : 2;
  assert.ok(measured.microseconds < budget, `a primitive record-field write took ${measured.microseconds.toFixed(3)}us`);
});

test("[beta-9] a reused dependency buffer still drops and re-adds subscriptions", { timeout: 180_000 }, () => {
  // runTracked now recycles the previous run's dependency Set instead of
  // allocating one per run. The buffer must be empty when it is handed back,
  // or a stale dependency would keep an observer subscribed forever.
  //
  // D90 R15(a) moved the branch out of the watch subject and into a computed,
  // so the observer whose buffer is recycled here is the computed rather than
  // the watch. It is the same runTracked and the same redirect: the recorded
  // sequence below still says the subscription followed the branch.
  const execution = probeModule(`
state useLeft = true
state left = "L"
state right = "R"
let seen = ""

computed shown = useLeft ? left : right

watch shown:
    seen += useLeft ? "l" : "r"

def choose(next: bool):
    useLeft = next

def writeLeft(value: string):
    left = value

def writeRight(value: string):
    right = value

def report() -> string:
    return seen
`, `
const __probeTick = () => new Promise((resolve) => queueMicrotask(resolve));
writeLeft("L1");
await __probeTick();
writeRight("R1");
await __probeTick();
choose(false);
await __probeTick();
writeRight("R2");
await __probeTick();
writeLeft("L2");
await __probeTick();
console.log(JSON.stringify({ seen: report() }));
`);
  // 'l' for the tracked left write, nothing for the untracked right write,
  // 'r' for the switch itself and for the tracked right write, nothing for the
  // now-untracked left write.
  assert.equal(measurement<{ readonly seen: string }>(execution).seen, "lrr");
});

// ---------------------------------------------------------------------------
// beta-13: assigning `undefined` to an absent key.
// ---------------------------------------------------------------------------

test("[beta-13] creating an absent key with undefined publishes the structural change", { timeout: 180_000 }, () => {
  // Reachable through `import js unsafe`: the write created the property but
  // compared `undefined` with the absent key's `undefined` reading, decided
  // nothing changed, and published nothing.
  const measured = measurement<{ readonly created: number; readonly published: number }>(probeModule(`
type Row:
    label: string

state row: Row = {label: "start"}

def label(value: string):
    row.label = value
`, `
const __probeRuntime = globalThis[Symbol.for("velar.runtime.v1")];
const __probeRaw = __probeRuntime.toRaw(row.get());
const __probeBefore = __probeRuntime.versionOf(__probeRaw);
row.get().extra = undefined;
const __probeAfter = __probeRuntime.versionOf(__probeRaw);
console.log(JSON.stringify({
  created: "extra" in __probeRaw ? 1 : 0,
  published: __probeAfter > __probeBefore ? 1 : 0,
}));
`));
  assert.equal(measured.created, 1, "the key was not created");
  assert.equal(measured.published, 1, "creating the key published no change");
});

// ---------------------------------------------------------------------------
// alpha-4: the Web detached-task helper must follow `webOutput`.
// ---------------------------------------------------------------------------

test("[alpha-4] a module without Web syntax keeps the Core detached-task contract", () => {
  const dataOnly = compiled(`
async def boom():
    throw Error("data module failure")

detach boom()
print("still running")
`);
  assert.ok(!dataOnly.includes("__velarDetachedRegistryKey"),
    "a module with no Web syntax was given the browser detached-report path");
  assert.ok(!dataOnly.includes("__velarRuntime"), "a module with no Web syntax emitted the Web runtime");

  // The Node contract: report on stderr, do not end the process.
  const execution = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: dataOnly });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "still running\n");
  assert.match(String(execution.stderr), /data module failure/u);

  // A module that really is Web output still reports through velar/app.
  const webModule = compiled(`
state ready = true

async def boom():
    throw Error("web failure")

detach boom()
`);
  assert.ok(webModule.includes("__velarDetachedRegistryKey"), "Web output lost the velar/app detached-report path");
});

// ---------------------------------------------------------------------------
// beta-11: the reactive wrapper rewrite must reach every occurrence.
// ---------------------------------------------------------------------------

test("[beta-11] the Web collection-call rewrite replaces every occurrence", async () => {
  const program = compiled(`
type Row:
    label: string

state rows: List<Row> = [{label: "a"}, {label: "b"}, {label: "c"}]

def take() -> Row:
    return rows.pop(0)

def pair() -> string:
    return rows.pop(0).label + rows.pop().label
`);
  assert.ok(program.includes("__velarWebListPop("), "pop() lost its reactive wrapper");
  // The raw operations survive inside the collection runtime that defines them;
  // what must never survive is a raw call in the application's own code.
  const application = program.slice(program.indexOf("function take()"));
  assert.ok(!/(?<![A-Za-z])__velarListPop\(/u.test(application), "a raw List pop survived in Web application code");
  // The defect was mechanical: `String.replace` with a string pattern rewrites
  // one occurrence, so a single lowered node emitting two collection calls
  // would silently keep a raw one. `pair` is exactly that node.
  assert.equal(application.match(/__velarWebListPop\(/gu)?.length, 3, "the rewrite missed an occurrence inside one expression");

  const emitter = await readFile(join(root, "packages", "web", "src", "emitter.ts"), "utf8");
  const rewrite = emitter.slice(emitter.indexOf("const emitted = super.emitExpression(expression);"), emitter.indexOf("private emitLook("));
  assert.equal(rewrite.match(/\.replaceAll\(/gu)?.length, 1, "the collection-call rewrite no longer replaces every occurrence");
  assert.ok(!/\.replace\(/u.test(rewrite), "the collection-call rewrite kept a single-occurrence replace");
});

// ---------------------------------------------------------------------------
// beta-6: the boundary gate must cover the whole emitted Web runtime template.
// ---------------------------------------------------------------------------

test("[beta-6] the ABI gate covers the whole emitted Web runtime template", async () => {
  const gate = await readFile(join(root, "scripts", "check-runtime-boundary.mjs"), "utf8");
  for (const phrase of [
    'const emittedWebRuntimeSource = webEmitterSource.slice(',
    "function emittedRuntimeUseSource(template)",
    "const emittedWebRuntimeUseSource = emittedRuntimeUseSource(emittedWebRuntimeSource)",
    "escaped the emitted Web runtime template that the ABI gate covers",
  ]) {
    assert.ok(gate.includes(phrase), `the runtime-boundary gate lost whole-template coverage: '${phrase}'`);
  }

  // Independent second opinion on the content itself: the surfaces that used
  // to sit outside every slice (keyed reconciliation, look, class, style,
  // events, form binding) must not reach a replaceable global or prototype.
  const emitter = await readFile(join(root, "packages", "web", "src", "emitter.ts"), "utf8");
  const template = emitter.slice(emitter.indexOf("const WEB_RUNTIME_BODY = String.raw`"), emitter.indexOf("`.trim();\n\nfunction webRuntime("));
  assert.ok(template.includes("function __velarKeyed(") && template.includes("function __velarApplyClasses(")
    && template.includes("function __velarOn(") && template.includes("function __velarBindValue("),
    "the emitted Web runtime template no longer spans the surfaces the gate must cover");
  const runtimeUse = template.split("\n")
    .filter((line) => !(/^const __velar[A-Za-z0-9]+ = /u.test(line) && !/=>|function\s*[(*]|function [A-Za-z_$]/u.test(line)))
    .join("\n");
  for (const pattern of [
    /\bnew (?:Set|Map|WeakSet|WeakMap)\s*\(/u,
    /\bObject\.(?:is|freeze|keys|entries|create|defineProperty|getOwnPropertyNames)\s*\(/u,
    /\bArray\.isArray\s*\(/u,
    /__velarRuntime\.[A-Za-z]+\.(?:get|set|has|add|delete)\b/u,
    /\.(?:classList|addEventListener|removeEventListener|innerHTML|valueAsNumber|checked)\b/u,
    /\.(?:flatMap|filter|map|forEach|join|reverse|push|includes)\s*\(/u,
  ]) {
    const match = pattern.exec(runtimeUse);
    assert.equal(match, null, `the emitted Web runtime reaches a replaceable operation: ${match?.[0] ?? ""}`);
  }
});

// ---------------------------------------------------------------------------
// beta-4 / beta-5: the two items whose symptom is a live page.
// ---------------------------------------------------------------------------

interface BrowserFixture {
  readonly application: string;
  readonly tests: string;
}

async function runBrowserFixture(prefix: string, fixture: BrowserFixture): Promise<string> {
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
      web: { title: "Marathon Web hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), fixture.application, "utf8");
    await writeFile(join(directory, "src", "marathon.browser.test.vel"), fixture.tests, "utf8");
    return await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runCommand(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(output || `Command exited with ${String(code)}`));
    });
  });
}

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
    await browser.waitForText("[data-failure]", "update:Reactive updates cannot run more than 100000 observers in one flush")
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

// ---------------------------------------------------------------------------
// web-4 / web-24 / web-28 / web-38: the two runtime module sources the CLI
// ships as standard modules. Each probe runs the shipped module itself -- the
// browser one in Chromium, because the defect was a URL the browser executed.
// ---------------------------------------------------------------------------

/** The velar/* module source a build writes, with the Web extension active. */
function shippedModule(name: string): string {
  const source = standardModuleSource(name, { base: "/" }, [velarCompilerExtension]);
  assert.ok(source, `${name} has no standard module source`);
  return source;
}

interface LookModule {
  readonly transition: (property: string, duration: string, easing?: string, delay?: string) => string;
  readonly asset: (path: string) => string;
}

/** Imports velar/look the way a built application does: as its own module. */
async function lookModule(): Promise<LookModule> {
  const directory = await mkdtemp(join(tmpdir(), "velar-marathon-look-"));
  const file = join(directory, "look.mjs");
  await writeFile(file, shippedModule("velar/look"), "utf8");
  return await import(pathToFileURL(file).href) as LookModule;
}

interface LinkProbe {
  readonly javascriptTarget: string;
  readonly navLinkTarget: string;
  readonly whitespaceTarget: string;
  readonly relativeHref: string | null;
  readonly externalHref: string | null;
  readonly relativePrevented: boolean;
  readonly externalPrevented: boolean;
  readonly relativePath: string;
}

test("[web-4] Link and NavLink refuse a target whose scheme is code", { timeout: 180_000 }, async () => {
  // isExternal classified 'javascript:' as external, so Link wrote it to
  // node.href and its click handler returned before preventDefault -- native
  // anchor activation then ran the script. Executing the shipped module read
  // the probe back as 1 with location.pathname unchanged.
  // A Link reads its props inside an observer, the way every framework
  // component now does, so the probe installs the reactive registry the way a
  // built application does -- velar/app carries the runtime foundation -- before
  // importing the module under test.
  const sources = { runtime: shippedModule("velar/app"), web: shippedModule("velar/web") };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A real origin, because the click handler compares the anchor's origin
    // with the document's before it intercepts anything.
    await page.route("**/*", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }));
    await page.goto("https://velar.test/");
    const probe: LinkProbe = await page.evaluate(async (moduleSources: { runtime: string; web: string }) => {
      const load = (moduleSource: string): Promise<unknown> =>
        import(URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" })));
      await load(moduleSources.runtime);
      const web = await load(moduleSources.web) as {
        Link: (props: Record<string, unknown>) => { node: HTMLAnchorElement; __mount: () => void };
        NavLink: (props: Record<string, unknown>) => unknown;
      };
      const refusal = (build: () => unknown): string => {
        try { build(); return "accepted"; }
        catch (error) { return String(error); }
      };
      // A click that reaches the document is the one the browser would act on,
      // so reading defaultPrevented there says whether Link intercepted it --
      // and preventing it there keeps the probe's own page from navigating.
      let prevented = false;
      document.addEventListener("click", (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      });
      const click = (to: string): boolean => {
        const instance = web.Link({ to, children: "Open" });
        document.body.append(instance.node);
        instance.__mount();
        instance.node.click();
        return prevented;
      };
      return {
        javascriptTarget: refusal(() => web.Link({ to: "javascript:globalThis.__velarProbePwned = 1; void 0", children: "Open" })),
        navLinkTarget: refusal(() => web.NavLink({ to: "javascript:void 0", children: "Open" })),
        whitespaceTarget: refusal(() => web.Link({ to: " java\tscript:void 0", children: "Open" })),
        relativeHref: web.Link({ to: "/about", children: "Open" }).node.getAttribute("href"),
        externalHref: web.Link({ to: "https://example.com/x", children: "Open" }).node.getAttribute("href"),
        relativePrevented: click("/about"),
        externalPrevented: click("https://example.com/x"),
        relativePath: location.pathname,
      };
    }, sources);
    for (const rejection of [probe.javascriptTarget, probe.whitespaceTarget]) {
      assert.match(rejection, /^TypeError: Link target rejected the 'javascript:' URL scheme/u);
    }
    assert.match(probe.navLinkTarget, /^TypeError: NavLink target rejected the 'javascript:' URL scheme/u);
    // The two targets a Link is for keep working, and keep the split the click
    // handler has always made: an application path is intercepted, an external
    // one is left to the browser.
    assert.equal(probe.relativeHref, "/about");
    assert.equal(probe.externalHref, "https://example.com/x");
    assert.equal(probe.relativePrevented, true);
    assert.equal(probe.externalPrevented, false);
    assert.equal(probe.relativePath, "/about");
  } finally {
    await browser.close();
  }
});

test("[web-24] Head reads its props on every update instead of once at construction", { timeout: 180_000 }, async () => {
  // __velarSnapshotProps read every prop exactly once through
  // __velarInternalRead, which is both untracked and excluded from D70's
  // frozen-read report: a title built from state stayed at the value the first
  // render saw, with no diagnostic and no console report. Document metadata is
  // rendered output, so Head follows Vel's ordinary rules and takes live props.
  const output = await runBrowserFixture("velar-marathon-web-head-", {
    application: `
import {Head} from "velar/web"

state unread = 0
state showHead = true

def bump():
    unread += 1

def hide():
    showHead = false

component App:
    return <main>
        {showHead ? <Head title={f"Inbox ({unread})"} description={f"unread {unread}"} language="de" /> : null}
        <button data-bump on:click={bump}>bump</button>
        <button data-hide on:click={hide}>hide</button>
        <span data-unread>{str(unread)}</span>
    </main>

@main: mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "Head metadata follows the state it is built from":
    await browser.open("/")
    expect(await browser.text("title")).toBe("Inbox (0)")
    expect(await browser.attribute("meta[name='description']", "content")).toBe("unread 0")
    expect(await browser.attribute("html", "lang")).toBe("de")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-unread]", "1")
    expect(await browser.text("title")).toBe("Inbox (1)")
    expect(await browser.attribute("meta[name='description']", "content")).toBe("unread 1")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-unread]", "2")
    expect(await browser.text("title")).toBe("Inbox (2)")

test "a removed Head gives the document back":
    await browser.open("/")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-unread]", "1")
    expect(await browser.text("title")).toBe("Inbox (1)")
    await browser.click("[data-hide]")
    await browser.waitForText("[data-unread]", "1")
    expect(await browser.text("title")).toBe("Marathon Web hardening")
    expect(await browser.attribute("html", "lang")).toBe("en")
`,
  });
  assert.match(output, /2 passed, 0 failed/u);
});

test("[web-24b] Router, Link and NavLink read their props on every update too", { timeout: 180_000 }, async () => {
  // D90's R4-a revision: leaving Head live and the other three snapshotting put
  // two behaviours behind one idea, and an author had to remember which
  // framework component was which. One rule covers all four -- reactive state
  // changed, the component updates -- so a Link follows the target it was given,
  // a NavLink moves its aria-current with it, and a routes table built from
  // state re-renders the position it fills.
  const output = await runBrowserFixture("velar-marathon-web-live-props-", {
    application: `
import {Link, NavLink, RouteContext, Router, route} from "velar/web"

state target = "/"
state swapped = false

component Alpha(route: RouteContext):
    return <article data-page>alpha</article>

component Beta(route: RouteContext):
    return <article data-page>beta</article>

component App:
    computed routes = swapped ? [route("/", Beta)] : [route("/", Alpha)]

    def move():
        target = "/elsewhere"

    def swap():
        swapped = true

    return <main>
        <nav data-links aria-label="plain">
            <Link to={target} style:color={target == "/" ? "blue" : "green"}>go</Link>
        </nav>
        <nav data-navs aria-label="current">
            <NavLink to={target} exact={true}>here</NavLink>
        </nav>
        <Router routes={routes} />
        <p data-target>{target}</p>
        <button data-move on:click={move}>move</button>
        <button data-swap on:click={swap}>swap</button>
    </main>

@main: mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "a Link and a NavLink follow the target they were given":
    await browser.open("/")
    expect(await browser.attribute("[data-links] a", "href")).toBe("/")
    expect(await browser.attribute("[data-navs] a", "aria-current")).toBe("page")
    // 'style:' on a component host decorates the instance root, and a Link is
    // a component host like any other.
    expect(await browser.style("[data-links] a", "color")).toBe("rgb(0, 0, 255)")
    await browser.click("[data-move]")
    await browser.waitForText("[data-target]", "/elsewhere")
    expect(await browser.style("[data-links] a", "color")).toBe("rgb(0, 128, 0)")
    expect(await browser.attribute("[data-links] a", "href")).toBe("/elsewhere")
    expect(await browser.attribute("[data-navs] a", "href")).toBe("/elsewhere")
    expect(await browser.attribute("[data-navs] a", "aria-current")).toBe(null)

test "a routes table built from state re-renders the Router":
    await browser.open("/")
    expect(await browser.text("[data-page]")).toBe("alpha")
    await browser.click("[data-swap]")
    await browser.waitForText("[data-page]", "beta")
`,
  });
  assert.match(output, /2 passed, 0 failed/u);
});

test("[web-28] the transition builder takes the vocabulary its longhand takes", async () => {
  // charter 3549 says the two transition longhands take the vocabularies the
  // matching builders take. transitionProperty read a closed set while the
  // builder read nothing, so the longhand taught the CSS spelling the builder
  // silently accepted and the browser discarded.
  assert.ok(LOOK_TRANSITION_PROPERTY_KEYWORDS.has("background-color"));
  assert.ok(!LOOK_TRANSITION_PROPERTY_KEYWORDS.has("backgroundColor"));
  const look = await lookModule();
  assert.throws(() => look.transition("backgroundColor", "200ms"), {
    name: "TypeError",
    message: "Transition property 'backgroundColor' is not a CSS property name; did you mean 'background-color'?",
  });
  assert.throws(() => look.transition("bakcground", "200ms"), {
    name: "TypeError",
    message: "Transition property 'bakcground' is not an animatable CSS property name",
  });
  // A property that does not interpolate is outside the set for the same reason
  // `keyframes:` rejects it, and the two aggregate keywords stay reachable.
  assert.throws(() => look.transition("display", "200ms"), { name: "TypeError" });
  assert.equal(look.transition("background-color", "200ms"), "background-color 200ms ease");
  assert.equal(look.transition("all", "200ms", "linear"), "all 200ms linear");
});

test("[web-38] asset() writes a CSS string, not a JSON string", async () => {
  // JSON and CSS agree on '"' and '\' and nothing else: CSS reads a backslash
  // before a non-hex character as that literal character, so JSON's "\n"
  // resolved to the letter 'n' and asset("a\nb") addressed the path "anb".
  const look = await lookModule();
  assert.equal(look.asset("a\nb"), 'url("a\\A b")');
  assert.equal(look.asset("a\tb"), 'url("a\\9 b")');
  assert.equal(look.asset("a\u007Fb"), 'url("a\\7F b")');
  assert.equal(look.asset('a"b\\c'), 'url("a\\"b\\\\c")');
  // Everything CSS can carry literally in a UTF-8 stylesheet stays literal.
  assert.equal(look.asset("/logo—2.png"), 'url("/logo—2.png")');
});
