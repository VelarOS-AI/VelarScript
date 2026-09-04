import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D90 R21: execution order is the order the watches are written.
//
// The charter used to promise that a watch's declaration order is not
// observable in the output, and the runtime kept that promise by running a
// watch that declared it writes state ahead of a watch that only observes. R1,
// R1-a, the R1-a revision and R16 were four rounds of work in service of that
// one sentence. The owner overturned the sentence: by ordinary code intuition
// whoever is defined first runs first, two watches writing one state is not an
// error -- both take effect, in order -- and an author who clobbers his own
// earlier write owns the mistake.
//
// So the `writes` clause, its three compile-time diagnostics and the two
// runtime referees are gone, and this file is the new guarantee in their place:
// order decides. Its browser half deliberately asserts the opposite of what the
// R1/R1-a files asserted -- swapping two watches changes the output.
//
// R1's own guarantee is a different axis and is unchanged: derived values
// settle to a fixed point before a single DOM commit. It is pinned here too, so
// the reversal cannot quietly take it along.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

/** Every diagnostic of the compile, `CODE message`, so a "stays legal" case cannot pass by being broken. */
function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

// ---------------------------------------------------------------------------
// r21-1: the clause is gone from the grammar, and `writes` is an ordinary name
// ---------------------------------------------------------------------------

test("[R21] 'writes' is an ordinary identifier in every position that binds", () => {
  // The lexer's Web contextual-keyword set no longer claims it, so nothing here
  // needs to know that a watch header once did.
  assert.deepEqual(messages(`
const writes = 3

print(writes)
`), []);
  assert.deepEqual(messages(`
def writes(value: number) -> number:
    return value * 2

print(writes(1))
`), []);
  assert.deepEqual(messages(`
const box = { writes: 1 }

print(box.writes)
`), []);
  // A state really named `writes`, watched. One name, and the header is whole.
  assert.deepEqual(messages(`
state writes = 0

watch writes:
    print(writes)
`), []);
});

test("[R22] a retired 'writes' clause is an ordinary syntax error", () => {
  // D90 R22: no version of this language was ever published, so there is nobody
  // holding a `watch t writes x:` header to migrate. The clause is not a shape
  // the parser knows, and the header that omits its colon reports exactly that.
  const source = `
state t = 0
state x = 1

watch t writes x:
    x = x + 1
`;
  assert.deepEqual(messages(source), [
    "VEL2001 Expected ':' before an indented block",
    "VEL2001 Expected a newline before an indented block",
    "VEL2001 Expected an indented block",
    "VEL2026 Unknown declaration keyword 'writes'; VelarScript declarations start with 'def', 'type', 'enum', 'class', 'const', or 'let'",
    "VEL2001 Expected the end of an indented block",
  ]);
  // `watch writes writes writes:` used to watch a state named `writes` and
  // declare that it writes it. It has no legal reading now, and reads the same
  // ordinary answer as any other header the parser cannot finish.
  assert.equal(messages(`
state writes = 0

watch writes writes writes:
    writes = writes + 1
`)[0], "VEL2001 Expected ':' before an indented block");
});

test("[R21] the two legal watch headers round-trip through the formatter", () => {
  // The clause used to be part of the printed header; these are its
  // replacement, and they are the whole header the language now has.
  for (const source of [
    "state t = 0\n\nwatch t:\n    print(t)\n",
    "state t = 0\n\nwatch t as current, previous:\n    print(current)\n    print(previous)\n",
  ]) {
    assert.equal(formatSource(source, { extensions: [velarCompilerExtension] }), source);
  }
});

// ---------------------------------------------------------------------------
// r21-2: compile time no longer analyzes who writes what
// ---------------------------------------------------------------------------

test("[R21] the contention and declaration diagnostics no longer exist", () => {
  // R1-a's own fixture: two watches of one scope assigning one state. It was
  // VEL5069 twice, then VEL5072 twice once the clause was required. Both writes
  // now simply take effect, in source order.
  const contention = `
state t = 0
state x = 1

watch t:
    x = x + 1

watch t:
    x = x * 10
`;
  assert.deepEqual(messages(contention), []);

  // The three shapes the inference machines chased across three rounds --- a
  // helper call, a member path, and a mutating method --- are silent for the
  // same reason: nothing asks the question any more.
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

watch t:
    bump()
`), []);
  assert.deepEqual(messages(`
state t = 0
state box = { n: 0 }

watch t:
    box.n = box.n + 1
`), []);
  assert.deepEqual(messages(`
state t = 0
state log: List<string> = []

watch t:
    log.append("a")
`), []);

  for (const code of ["VEL5069", "VEL5072", "VEL5073"]) {
    assert.equal(
      messages(contention).some((item) => item.startsWith(code)),
      false,
      `${code} must not be reachable`,
    );
  }
});

test("[R15] the watch subject is still narrowed, and VEL5071 still says so", () => {
  // Owner-ruled and untouched by R21: a subject names what to watch.
  assert.deepEqual(messages(`
state a = 0
state b = 0

watch a + b as sum, _:
    print(sum)
`), [
    "VEL5071 A watch subject names what to watch, not what to compute: 'a + b' computes a value. "
    + "Declare it — 'computed sum = a + b' — then 'watch sum as current, _:'",
  ]);
});

// ---------------------------------------------------------------------------
// r21-3 / r21-5: the emitter computes nothing about writing
// ---------------------------------------------------------------------------

test("[R21] an emitted watch carries its scope and its subject, and nothing else", () => {
  const result = compile(`
state a = 0
state b = 0
state c = 0
computed sum = a + b

watch sum:
    print(sum)

watch a:
    b = b + 1

watch a:
    c = c + 1

component Row(seed: string):
    state seen = 0

    watch seed:
        seen = seen + 1

    return <p>{seed}{seen}</p>
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  const emitted = code.split("\n")
    .filter((line) => /^\s*\}, __velar(?:Global|Component)Scope, /u.test(line))
    .map((line) => line.trim());
  // Three module watches and one component watch, each closed with the scope
  // and the subject as the author spelled it. The cell list, the `produces`
  // flag and the per-declaration site are all gone: the three machines that
  // each guessed "does this watch write?" have nothing left to say.
  assert.deepEqual(emitted, [
    `}, __velarGlobalScope, "sum");`,
    `}, __velarGlobalScope, "a");`,
    `}, __velarGlobalScope, "a");`,
    `}, __velarComponentScope, "seed");`,
  ]);
  for (const absent of [
    "__velarWatchSite",
    "produces",
    "__velarWatchEnter",
    "__velarWatchLeave",
    "__velarWatchViolation",
    "__velarWatchDeclared",
    "__velarWatchOwnCell",
    "__velarWatchSuspend",
  ]) {
    assert.equal(code.includes(absent), false, `${absent} must not be emitted`);
  }
});

// ---------------------------------------------------------------------------
// The browser half: order decides
// ---------------------------------------------------------------------------

async function mountInChromium(
  source: string,
  visit: (page: Page, failures: readonly string[]) => Promise<void>,
): Promise<void> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => { failures.push(String(error)); });
    await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: result.code ?? "", type: "module" });
    await page.waitForFunction("document.querySelector('#app').childNodes.length > 0");
    await visit(page, failures);
  } finally {
    await browser.close();
  }
}

/** Mounts one application, clicks `[data-go]`, and answers with the text of `[data-trail]`. */
async function trailOf(source: string): Promise<{ readonly trail: string; readonly failures: readonly string[] }> {
  let trail = "";
  let seen: readonly string[] = [];
  await mountInChromium(source, async (page, failures) => {
    await page.click("[data-go]");
    await page.waitForFunction("document.querySelector('[data-go]').dataset.done === '1'");
    trail = (await page.textContent("[data-trail]")) ?? "";
    seen = failures;
  });
  return { trail, failures: seen };
}

/** Two module watches on one subject, appending to one state; `order` swaps them. */
function twoModuleWatches(order: "first-then-second" | "second-then-first"): string {
  const first = `watch t:\n    trail = trail + "first"`;
  const second = `watch t:\n    trail = trail + "second"`;
  return `
state t = 0
state trail = ""

${order === "first-then-second" ? `${first}\n\n${second}` : `${second}\n\n${first}`}

component App:
    state done = 0

    def go():
        t = 1
        done = 1

    return <main>
        <p data-trail>{trail}</p>
        <button data-go data-done={done} on:click={go}>go</button>
    </main>

mount(<App />, "#app")
`;
}

test("[R21] two watches in one module run in source order, and swapping them changes the output", { timeout: 120_000 }, async () => {
  const forward = await trailOf(twoModuleWatches("first-then-second"));
  const swapped = await trailOf(twoModuleWatches("second-then-first"));
  assert.deepEqual(forward.failures, []);
  assert.deepEqual(swapped.failures, []);
  assert.equal(forward.trail, "firstsecond");
  assert.equal(swapped.trail, "secondfirst");
  // The point of the reversal, stated as an inequality so it cannot be
  // satisfied by both orders quietly producing the same string.
  assert.notEqual(forward.trail, swapped.trail);
});

test("[R21] two watches writing one state both take effect, in order", { timeout: 120_000 }, async () => {
  // `total = total + 1` twice adds twice. This is the program R1-a refused as
  // VEL5069 and R16 refused as VEL5072; it is now an ordinary program.
  const accumulating = await trailOf(`
state t = 0
state total = 0
state trail = ""

watch t:
    total = total + 1

watch t:
    total = total + 1

watch total:
    trail = str(total)

component App:
    state done = 0

    def go():
        t = 1
        done = 1

    return <main>
        <p data-trail>{trail}</p>
        <button data-go data-done={done} on:click={go}>go</button>
    </main>

mount(<App />, "#app")
`);
  assert.deepEqual(accumulating.failures, []);
  assert.equal(accumulating.trail, "2");

  // And a later plain assignment clobbers the earlier write. That is the
  // author's own mistake, not a diagnostic and not a runtime error --- the
  // compiler follows the rule, and the rule is source order.
  const clobbering = await trailOf(`
state t = 0
state total = 0
state trail = ""

watch t:
    total = total + 1

watch t:
    total = 99

watch total:
    trail = str(total)

component App:
    state done = 0

    def go():
        t = 1
        done = 1

    return <main>
        <p data-trail>{trail}</p>
        <button data-go data-done={done} on:click={go}>go</button>
    </main>

mount(<App />, "#app")
`);
  assert.deepEqual(clobbering.failures, []);
  assert.equal(clobbering.trail, "99");
});

test("[R21] two live instances of one component write one module state in mount order", { timeout: 120_000 }, async () => {
  // The shape the deleted R1-a-granularity referee refused at runtime: one
  // `watch` declaration, mounted twice, both instances writing one module-level
  // cell. Both writes land, in mount order, and the page reports nothing.
  const mounted = await trailOf(`
state trail = ""

component Row(seed: string):
    watch seed:
        trail = trail + seed

    return <p data-row>{seed}</p>

component App:
    state a = "a"
    state b = "b"
    state done = 0

    def go():
        a = "A"
        b = "B"
        done = 1

    return <main>
        <Row seed={a} />
        <Row seed={b} />
        <p data-trail>{trail}</p>
        <button data-go data-done={done} on:click={go}>go</button>
    </main>

mount(<App />, "#app")
`);
  assert.deepEqual(mounted.failures, []);
  assert.equal(mounted.trail, "AB");
});

test("[R1] a corrective watch still settles before a single DOM commit", { timeout: 120_000 }, async () => {
  // R21 changed the order watches run in, not R1's glitch-free guarantee: the
  // derived world reaches a fixed point before one DOM commit, so the
  // uncorrected 10 is never rendered and the correction is not a second frame.
  await mountInChromium(`
state n = 0
state revision = 0

// A plain module binding, not reactive state: the rendered position that
// appends to it must not become its own dependency, or the render invalidates
// itself instead of committing once. The revision counter publishes it.
let renderLog = ""

computed doubled = n * 2

watch n:
    if n > 5:
        n = 5

def show(value: number) -> string:
    renderLog = renderLog + "n=" + str(value) + ";"
    return str(value)

def at(_: number, text: string) -> string:
    return text

component App:
    def correct():
        n = 10

    def refresh():
        revision = revision + 1

    return <main>
        <p data-n>{show(n)}</p>
        <p data-doubled>{doubled}</p>
        <p data-log>{at(revision, renderLog)}</p>
        <button data-correct on:click={correct}>correct</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`, async (page, failures) => {
    await page.click("[data-correct]");
    await page.waitForFunction("document.querySelector('[data-n]').textContent === '5'");
    await page.click("[data-refresh]");
    await page.waitForFunction("document.querySelector('[data-log]').textContent !== ''");
    assert.equal(await page.textContent("[data-n]"), "5");
    assert.equal(await page.textContent("[data-doubled]"), "10");
    // One commit per settle: the invalid 10 never reached a node.
    assert.equal(await page.textContent("[data-log]"), "n=0;n=5;");
    assert.deepEqual(failures, []);
  });
});

// ---------------------------------------------------------------------------
// r21-6: the runaway-cycle budget is the only gate left, and it names the ring
// ---------------------------------------------------------------------------

/**
 * Installs an error handler on the shared runtime registry and answers every
 * report the page raised. `velar/app`'s `onError` is the spelling an
 * application uses, but it arrives as a module import and this harness mounts
 * one inlined script; the registry slot is the same object that export writes
 * to, and reading it here keeps the whole report --- `detail` and `component`
 * included --- rather than the message a `pageerror` would flatten it to.
 */
async function reportsOf(source: string, click: string): Promise<readonly {
  readonly detail: string;
  readonly component: string;
  readonly message: string;
}[]> {
  let reports: readonly { readonly detail: string; readonly component: string; readonly message: string }[] = [];
  await mountInChromium(source, async (page) => {
    await page.evaluate(`(() => {
      const runtime = globalThis[Symbol.for("velar.runtime.v1")];
      globalThis.__velarTestReports = [];
      runtime.errorHandlers.add((report) => {
        globalThis.__velarTestReports.push({ detail: report.detail, component: report.component, message: report.error.message });
        return null;
      });
    })()`);
    await page.click(click);
    await page.waitForFunction("globalThis.__velarTestReports.length > 0", undefined, { timeout: 60_000 });
    reports = await page.evaluate("globalThis.__velarTestReports") as never;
  });
  return reports;
}

test("[R21] a runaway write cycle names the watches in the ring", { timeout: 120_000 }, async () => {
  // Two watches that each write the other's state. Compile time used to refuse
  // the cross-writing shape before it could ever run; it does not any more, so
  // this budget is the only gate and it has to point at something. Before this
  // wave it reported `detail: ""` and `component: ""` --- a number and no line
  // to go to.
  const moduleLevel = await reportsOf(`
state alpha = 0
state beta = 0

watch alpha:
    beta = beta + 1

watch beta:
    alpha = alpha + 1

component App:
    def go():
        alpha = 1

    return <main>
        <p data-alpha>{alpha}</p>
        <button data-go on:click={go}>go</button>
    </main>

mount(<App />, "#app")
`, "[data-go]");
  const budget = moduleLevel.filter((item) => item.message === "Reactive updates cannot run more than 100000 observers in one flush");
  assert.equal(budget.length, 1, JSON.stringify(moduleLevel));
  assert.match(budget[0]!.detail, /the watch on 'alpha' \(\d+ runs\)/u);
  assert.match(budget[0]!.detail, /the watch on 'beta' \(\d+ runs\)/u);
  // A module-level cycle belongs to no component, and the field says so rather
  // than naming one at random.
  assert.equal(budget[0]!.component, "");

  const inComponent = await reportsOf(`
state ping = 0
state pong = 0

component Cycle:
    watch ping:
        pong = pong + 1

    watch pong:
        ping = ping + 1

    return <p data-cycle>{ping}</p>

component App:
    def go():
        ping = 1

    return <main>
        <Cycle />
        <button data-go on:click={go}>go</button>
    </main>

mount(<App />, "#app")
`, "[data-go]");
  const componentBudget = inComponent.filter((item) => item.message === "Reactive updates cannot run more than 100000 observers in one flush");
  assert.equal(componentBudget.length, 1, JSON.stringify(inComponent));
  assert.match(componentBudget[0]!.detail, /the watch on 'ping' \(\d+ runs\)/u);
  assert.match(componentBudget[0]!.detail, /the watch on 'pong' \(\d+ runs\)/u);
  // The reference bar is Vue's "Maximum recursive updates exceeded", which
  // names the component. This one does too.
  assert.equal(componentBudget[0]!.component, "Cycle");
});

// ---------------------------------------------------------------------------
// Across modules: order is module-initialization order
// ---------------------------------------------------------------------------

/**
 * Materializes a whole project beside the standard modules its code imports and
 * runs `main.js`. Copied in shape from the R16-a project harness: the emitter
 * already writes a neighbour's specifier as the emitted `.js` name, so only the
 * `velar/*` specifiers need linking, and the standard modules are asked for
 * with this project's own extensions so the Web flavour of the reactive runtime
 * is what runs.
 *
 * Two modules cannot be mounted through one inlined script tag, and module
 * initialization order is a property of the JavaScript module graph rather than
 * of the document, so the cross-module scenario runs here rather than in a
 * browser. The scheduler it exercises is the same one, byte for byte.
 */
const standardModuleFlavour = { base: "/" } as const;

async function runProject(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-r21-"));
  try {
    const overrides = new Map(Object.entries(files).map(([name, text]) => [join(directory, name), text.trimStart()]));
    const project = await compileProject(join(directory, "main.vel"), overrides, { extensions: [velarCompilerExtension] });
    assert.deepEqual(project.failures.map((item) => item.message), []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)), []);
    const standard = new Map([...standardModuleClosure(project.modules.flatMap((module) => [
      ...module.result.runtimeModules,
      ...module.result.dependencies.map((dependency) => dependency.source).filter((source) => source.startsWith("velar/")),
    ]), standardModuleFlavour, [velarCompilerExtension])].map((name, index) => [name, `module-${index}.js`]));
    const link = (text: string): string => {
      let linked = text;
      for (const [name, file] of standard) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(`./${file}`));
      return linked;
    };
    for (const [name, file] of standard) {
      await writeFile(join(directory, file), link(standardModuleSource(name, standardModuleFlavour, [velarCompilerExtension]) ?? ""), "utf8");
    }
    for (const module of project.modules) {
      await writeFile(join(directory, basename(module.inputPath).replace(/\.vel$/u, ".js")), link(module.result.code ?? ""), "utf8");
    }
    return await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [join(directory, "main.js")], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { output += chunk; });
      child.stderr.on("data", (chunk: string) => { output += chunk; });
      child.once("error", rejectPromise);
      child.once("exit", () => resolvePromise(output));
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const counterModule = `
export state hits = 0
export state trail = ""

export def bump():
    hits = hits + 1

export def append(text: string):
    trail = trail + text
`;

/** One module whose watch on the shared `hits` appends `name` to the shared trail. */
function watcherModule(name: string): string {
  return `
import {hits, append} from "./counter.vel"

export const ${name}Ready = true

watch hits:
    append("${name}")
`;
}

function crossModuleMain(order: readonly ["alpha" | "beta", "alpha" | "beta"]): Readonly<Record<string, string>> {
  return {
    "counter.vel": counterModule,
    "alpha.vel": watcherModule("alpha"),
    "beta.vel": watcherModule("beta"),
    "main.vel": `
import {trail, bump} from "./counter.vel"
import {${order[0]}Ready} from "./${order[0]}.vel"
import {${order[1]}Ready} from "./${order[1]}.vel"

action main():
    print(f"ready={${order[0]}Ready and ${order[1]}Ready}")
    bump()
    await tick()
    print(f"trail={trail}")

detach main()
`,
  };
}

test("[R21] two modules' watches on one imported state run in module-initialization order", { timeout: 120_000 }, async () => {
  // The shape the deleted R1-a-scope referee refused: two watches in two
  // modules, both writing one cell of a third. Both writes take effect, the
  // order is the order the modules initialized, and the process reports
  // nothing.
  assert.equal(await runProject(crossModuleMain(["alpha", "beta"])), "ready=true\ntrail=alphabeta\n");
  assert.equal(await runProject(crossModuleMain(["beta", "alpha"])), "ready=true\ntrail=betaalpha\n");
});
