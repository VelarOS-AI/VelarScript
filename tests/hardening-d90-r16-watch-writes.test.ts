import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { compile as compileCore } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D90 R21: R16 is revoked, and this file is what outlived it.
//
// R16 made a watch declare which state it writes, so that the charter's promise
// -- that a watch's declaration order is unobservable in the output -- could
// hold by construction. The owner overturned the promise itself on 2026-08-23:
// by ordinary code intuition whoever is defined first runs first, two watches
// writing one state is not an error (both take effect, in order), and an author
// who clobbers his own earlier write owns the mistake. The `writes` clause, its
// three compile-time diagnostics and the two runtime referees are gone, and
// tests/hardening-d90-r21-source-order.test.ts states the new guarantee.
//
// Three things stayed here rather than going with them:
//
//   the four cases that asserted "order does not change the result", turned
//   around to assert that order decides it -- deleting them would erase the
//   evidence that the behaviour changed, which is the whole reason a reversal
//   needs tests of its own;
//
//   the writes R16 was built around -- a member path, a mutating method, a
//   `computed` evaluated inside a watch body, a mutating method reaching an
//   imported collection across a module boundary. They are ordinary legal code
//   now, declared by nothing, and they still have to land;
//
//   rw-5, the audit's seventh root cause -- VEL5074, a `def` that declares
//   reactive state and answers WebNode. It was closed in the R16 packet but it
//   is a different rule, R21 says nothing about it, and it stays live.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function codes(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

// ---------------------------------------------------------------------------
// The audit's seventh root cause, closed in the same packet: a `def` that
// declares reactive state and answers WebNode.
// ---------------------------------------------------------------------------

test("[rw-5] a stateless 'def -> WebNode' and one that only reads stay legal", () => {
  assert.deepEqual(messages(`
def statelessBadge(label: string) -> WebNode:
    return <span>{label}</span>

component App():
    return <div>{statelessBadge("a")}</div>
`), []);
  // A `def -> WebNode` nested inside a component binds its observers to that
  // component's scope, so reading state or a prop from one is correct.
  assert.deepEqual(messages(`
component App():
    state failure = "none"

    def banner() -> WebNode:
        return <p>{failure}</p>

    return <div>{banner()}</div>
`), []);
});

test("[rw-5] a 'def -> WebNode' that declares reactive state is refused", () => {
  const source = `
def statefulRow(label: string) -> WebNode:
    state count = 0
    return <span>{label}{count}</span>

component App():
    return <div>{statefulRow("a")}</div>
`;
  assert.deepEqual(codes(source), ["VEL5074"]);
  const message = compile(source).diagnostics[0]!.message;
  assert.match(message, /declares 'state' and returns WebNode/u);
  assert.match(message, /bypasses JSX ownership, prop cells, and lifecycle/u);
  assert.match(message, /'component StatefulRow\(\.\.\.\)'/u);
  // A `computed` is the same declaration in a second spelling.
  assert.deepEqual(codes(`
state seed = 1

def statefulRow() -> WebNode:
    computed doubled = seed * 2
    return <span>{doubled}</span>
`), ["VEL5074"]);
});

test("[rw-5] the refusal follows the markup, not the one annotation that spells it", () => {
  // AGENTS.md's third shape, found against this packet's own fix: the check
  // read the literal `-> WebNode` annotation, and the identical body reached
  // the identical defect through three other doors. Each of these emits the
  // state declaration inside the function and registers the markup's observers
  // on whatever scope the call site was building.
  assert.deepEqual(codes(`
state seed = 1

def statefulRow() -> WebNode?:
    state count = 0
    return <span>{count + seed}</span>
`), ["VEL5074"], "an optional row is still a row");
  assert.deepEqual(codes(`
state seed = 1

def statefulRows() -> List<WebNode>:
    state count = 0
    return [<span>{count + seed}</span>]
`), ["VEL5074"], "a list of rows is still rows");
  assert.deepEqual(codes(`
state seed = 1

def statefulRow():
    state count = 0
    return <span>{count + seed}</span>
`), ["VEL5074"], "a 'def' need not annotate its answer, and the markup answers for it");
  assert.deepEqual(codes(`
state seed = 1

def statefulRows(items: List<string>):
    state count = 0
    return items.map(item => <li>{item}{count + seed}</li>)
`), ["VEL5074"], "a row per item is markup however the list is built");
  // The stateless shapes of all four stay legal: only the declaration is refused.
  assert.deepEqual(messages(`
state seed = 1

def optionalBadge(label: string) -> WebNode?:
    return label == "" ? null : <span>{label}{seed}</span>

def listedBadges(items: List<string>) -> List<WebNode>:
    return items.map(item => <li>{item}{seed}</li>)

def inferredBadge(label: string):
    return <span>{label}{seed}</span>

component App():
    return <div>{optionalBadge("a")}{listedBadges(["b"])}{inferredBadge("c")}</div>
`), []);
});

// ---------------------------------------------------------------------------
// Execution. The finding's evidence was execution-level and so is the ruling
// that replaced it: only running the program shows which write landed last.
// ---------------------------------------------------------------------------

async function runEmitted(source: string): Promise<string> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const directory = await mkdtemp(join(tmpdir(), "velar-r16-"));
  try {
    const file = join(directory, "main.mjs");
    await writeFile(file, result.code ?? "", "utf8");
    return await new Promise<string>((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [file], { stdio: ["ignore", "pipe", "pipe"] });
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

/**
 * Two watches that write one state, in the two possible orders, with a derived
 * value observing the result. Under R16 the two orders were required to print
 * the same thing; under R21 the second assignment is the one that lands, so
 * which watch is written second decides `total`.
 */
function swapApplication(doubleFirst: boolean): string {
  const double = `watch a:\n    total = a * 2`;
  const triple = `watch a:\n    total = a * 3`;
  return `
state a = 0
state total = 0

computed scaled = total * 10

watch scaled as current, _:
    print(f"scaled={current}")

${doubleFirst ? double : triple}

${doubleFirst ? triple : double}

action main():
    a = 1
    await tick()
    print(f"total={total}")

async main()
`;
}

test("[R21] swapping two writing watches changes the output", { timeout: 60_000 }, async () => {
  // The turned-around case. Its R16 name was "swapping two writing watches
  // leaves the output identical" and it asserted the two outputs were equal;
  // the promise it guarded is the one the owner overturned, so it now asserts
  // they differ and names both.
  const doubleFirst = await runEmitted(swapApplication(true));
  const tripleFirst = await runEmitted(swapApplication(false));
  assert.notEqual(doubleFirst, tripleFirst);
  assert.equal(doubleFirst, "scaled=30\ntotal=3\n");
  assert.equal(tripleFirst, "scaled=20\ntotal=2\n");
});

test("[R21] a watch write, a computed that writes, and a body-local state all land once", { timeout: 60_000 }, async () => {
  // Three shapes the deleted backstop had to carve out by name, and which are
  // now simply what they always were. A `computed` callback may write state and
  // the write publishes normally, so evaluating a lazy derived value inside a
  // watch body runs its writer exactly once; a state declared during the
  // watch's own run is that run's; and the watch's own write is ordinary code.
  const output = await runEmitted(`
state t = 0
state calls = 0
state declared = 0

def counted() -> number:
    calls = calls + 1
    return calls

computed derived = counted()

def helperWithOwnState() -> number:
    state inner = 0
    inner = inner + 1
    return inner

watch t:
    declared = declared + 1
    print(f"derived={derived}")
    print(f"inner={helperWithOwnState()}")

action main():
    t = 1
    await tick()
    print(f"calls={calls} declared={declared}")

async main()
`);
  assert.equal(output, "derived=1\ninner=1\ncalls=1 declared=1\n");
});

test("[R21] a member-path write and a mutating method both land from a watch body", { timeout: 60_000 }, async () => {
  // Shapes A and C of the finding. Under R16 they were legal because the header
  // said so; under R21 nothing says so, and they still have to land -- these are
  // the two spellings the pre-R16 inference could not see, so a reversal that
  // silently dropped them would reopen the hole from the other side.
  const output = await runEmitted(`
state t = 0
state box = { n: 0 }
state log: List<string> = []

watch t:
    box.n = box.n + 1
    log.append("a")

action main():
    t = 1
    await tick()
    print(f"n={box.n} size={log.size}")

async main()
`);
  assert.equal(output, "n=1 size=1\n");
});

// ---------------------------------------------------------------------------
// Across modules. R16-a widened the clause to imported cells and R1-a-scope
// added a runtime referee for the contention compile time could not see; both
// are revoked. What is left is the program they were built around -- one
// module's watch writing another module's state -- which is legal, silent, and
// ordered by the order the modules initialize in.
//
// These need more than one module, so they compile through the CLI's project
// resolver rather than the single-module `compile` above.
// ---------------------------------------------------------------------------

async function withProjectDirectory<T>(
  files: Readonly<Record<string, string>>,
  use: (directory: string, project: Awaited<ReturnType<typeof compileProject>>) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "velar-r16a-"));
  try {
    const overrides = new Map(Object.entries(files).map(([name, text]) => [join(directory, name), text.trimStart()]));
    const project = await compileProject(join(directory, "main.vel"), overrides, { extensions: [velarCompilerExtension] });
    assert.deepEqual(project.failures.map((item) => item.message), []);
    return await use(directory, project);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Every diagnostic the project reports, in module order, `CODE message`. */
async function projectMessages(files: Readonly<Record<string, string>>): Promise<readonly string[]> {
  return await withProjectDirectory(files, (_directory, project) => Promise.resolve(
    project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)),
  ));
}

/**
 * Materializes the whole project -- every emitted module beside the standard
 * modules its code imports -- and runs `main.js`. The emitter already writes a
 * neighbour's specifier as the emitted `.js` name, so only the `velar/*`
 * specifiers need linking.
 *
 * The standard modules are asked for with this project's own extensions. The
 * CLI's wrappers default to the Node extension when none is given, and the Node
 * flavour of `velar/compiler-runtime-reactive-v1` is the *non-reactive* stub --
 * every collection trigger a no-op. Linking that flavour beside Web modules
 * made shape C (a mutating method on an imported collection state) publish
 * nothing here while the real `velar dev` and the real bundle both react to it:
 * a harness that disagrees with the product cannot notice a regression in the
 * one shape three rounds of work kept failing to see.
 */
const standardModuleFlavour = { base: "/" } as const;

async function runProject(files: Readonly<Record<string, string>>): Promise<string> {
  return await withProjectDirectory(files, async (directory, project) => {
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
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
      const emitted = basename(module.inputPath).replace(/\.vel$/u, ".js");
      await writeFile(join(directory, emitted), link(module.result.code ?? ""), "utf8");
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
  });
}

/** A counter two other modules both drive, and a clock that wakes their watches. */
const counterModule = `
export state hits = 0
export state seed = 0

export def setHits(value: number):
    hits = value

export def advance():
    seed = seed + 1
`;

/** One module whose watch on the shared clock assigns `value` to the shared counter. */
function writerModule(value: number): string {
  return `
import {seed, setHits} from "./counter.vel"

export const ready${value} = true

watch seed:
    setHits(${value})
`;
}

/** The same two writer modules, initialized in the order `main.vel` imports them. */
function crossModuleApplication(firstWriter: 1 | 2): Readonly<Record<string, string>> {
  const second = firstWriter === 1 ? 2 : 1;
  return {
    "counter.vel": counterModule,
    "one.vel": writerModule(1),
    "two.vel": writerModule(2),
    "main.vel": `
import {hits, advance} from "./counter.vel"
import {ready${firstWriter}} from "./${firstWriter === 1 ? "one" : "two"}.vel"
import {ready${second}} from "./${second === 1 ? "one" : "two"}.vel"

action main():
    print(f"ready={ready${firstWriter} and ready${second}}")
    advance()
    await tick()
    print(f"hits={hits}")

async main()
`,
  };
}

test("[R21] a cross-module write lands, and the order the two modules initialize in decides the result", { timeout: 60_000 }, async () => {
  // The turned-around case. Its R16-a name was "a declared cross-module write
  // lands, and swapping the two watches leaves the output identical". The first
  // half is unchanged and needs no clause to say so: a watch may write another
  // module's state through an action that module exports. The second half is
  // reversed -- both writers assign rather than accumulate, so the module that
  // initialized last registered last, runs last, and its value is the one left
  // standing.
  assert.deepEqual(await projectMessages(crossModuleApplication(1)), []);
  const oneFirst = await runProject(crossModuleApplication(1));
  const twoFirst = await runProject(crossModuleApplication(2));
  assert.notEqual(oneFirst, twoFirst);
  assert.equal(oneFirst, "ready=true\nhits=2\n");
  assert.equal(twoFirst, "ready=true\nhits=1\n");
});

/** counter.vel, owning a collection state its own exported `def` mutates. */
const collectionModule = `
export state log: List<string> = []

export def note(item: string):
    log.append(item)
`;

test("[R21] a mutating method on an imported collection lands from each module's watch, in order", { timeout: 60_000 }, async () => {
  // Shape C -- a mutating method on a state -- was one of the three shapes the
  // pre-R16 inference could not see, and across a module boundary it lands on
  // the ownership bubble rather than on the cell's own `set`. R16 asked it at
  // both referees; with the referees gone the question left is the one that
  // matters to an author: the write still lands, from either module, and the
  // two appends are in module-initialization order.
  const project = {
    "counter.vel": collectionModule,
    "clock.vel": `
export state tick_count = 0
export state beat = 0

export def advance():
    tick_count = tick_count + 1
    beat = beat + 1
`,
    "left.vel": `
import {log, note} from "./counter.vel"
import {beat} from "./clock.vel"

export const loaded = true

watch beat:
    note("left")
`,
    "main.vel": `
import {log, note} from "./counter.vel"
import {tick_count, advance} from "./clock.vel"
import {loaded} from "./left.vel"

watch tick_count:
    note("main")

action main():
    print(f"loaded={loaded}")
    advance()
    await tick()
    print(f"log={log.size} {log[0]} {log[1]}")

async main()
`,
  };
  assert.deepEqual(await projectMessages(project), []);
  assert.equal(await runProject(project), "loaded=true\nlog=2 left main\n");
});

// A resource lives at component scope, so this one needs a document. It is the
// spelling four charter fences and examples/tour/web/04 teach -- a watch whose
// whole body is `async profile.reload()` -- and reload synchronously sets the
// resource's own loading and error cells. R16 kept it legal by exempting the
// resource's own cells from the clause; R21 keeps it legal by having no clause,
// and the behaviour asserted here is the same either way.
const resourceApplication = `
state failure = ""

action loadName(seed: string) -> string:
    return "name-" + seed

component Profile(userId: string):
    resource profile: string = loadName(userId)

    watch userId:
        async profile.reload()

    return <p data-name>{profile.value ?? "loading"}</p>

component App:
    state userId = "a"

    def advance():
        userId = "b"

    return <main>
        <p data-failure>{failure}</p>
        <Profile userId={userId} />
        <button data-advance on:click={advance}>advance</button>
    </main>

mount(<App />, "#app")
`;

test("[R21] a resource reload inside a watch is ordinary, silent code", { timeout: 120_000 }, async () => {
  const result = compile(resourceApplication);
  assert.deepEqual(result.diagnostics, []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => { failures.push(String(error)); });
    await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: result.code ?? "", type: "module" });
    await page.waitForFunction("document.querySelector('[data-name]')?.textContent === 'name-a'");
    await page.click("[data-advance]");
    await page.waitForFunction("document.querySelector('[data-name]')?.textContent === 'name-b'");
    assert.deepEqual(failures, []);
  } finally {
    await browser.close();
  }
});
