import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const root = resolve(new URL("..", import.meta.url).pathname);

// Fix wave 2 of the marathon defect ledger (docs/handoff/MARATHON-DEFECTS.md):
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

def replace(label: string) -> null:
    settings = {...settings, label: label}

def touch(mode: string) -> null:
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

def typeInto(value: string) -> null:
    form.one = value

def replaceSection(label: string) -> null:
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
  // 4.86us per write before the fix, 0.41us after. The gate is deliberately
  // loose: it separates "the throwing probe came back" from machine noise.
  assert.ok(measured.microseconds < 2, `a primitive record-field write took ${measured.microseconds.toFixed(3)}us`);
});

test("[beta-9] a reused dependency buffer still drops and re-adds subscriptions", { timeout: 180_000 }, () => {
  // runTracked now recycles the previous run's dependency Set instead of
  // allocating one per run. The buffer must be empty when it is handed back,
  // or a stale dependency would keep an observer subscribed forever.
  const execution = probeModule(`
state useLeft = true
state left = "L"
state right = "R"
let seen = ""

watch useLeft ? left : right:
    seen += useLeft ? "l" : "r"

def choose(next: bool) -> null:
    useLeft = next

def writeLeft(value: string) -> null:
    left = value

def writeRight(value: string) -> null:
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

def label(value: string) -> null:
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
async def boom() -> null:
    throw Error("data module failure")

async boom()
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

async def boom() -> null:
    throw Error("web failure")

async boom()
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
    const label = computed(() => f"count is {count}")

    def bump() -> null:
        count += 1

    return <div>
        <p data-label>{label()}</p>
        <button data-bump on:click={bump}>inc</button>
    </div>

mount(<App />, "#app")
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

def capture(phase: string, message: string) -> null:
    failure = phase + ":" + message

onError(report => capture(report.phase, report.error.message))

watch left:
    right += 1

watch right:
    left += 1

def start() -> null:
    left += 1

def bump() -> null:
    independent += 1

component App:
    return <main>
        <button data-start on:click={start}>start</button>
        <button data-bump on:click={bump}>bump</button>
        <span data-failure>{failure}</span>
        <span data-independent>{str(independent)}</span>
    </main>

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

def rerender(event: KeyboardEvent) -> null:
    rows = rows.map(row => row)
    renders += 1

def countBlur(event: Event) -> null:
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

mount(<App />, "#app")
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
