import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D90 R16: a watch that writes state declares which state, in its header.
//
// The ruling ends a chase. "Does this watch write?" was inferred in three
// places -- the analyzer's VEL5069 call graph, the emitted `produces`, and a
// runtime scheduling epoch -- and the three disagreed, so the charter's
// promise that a watch's declaration order is unobservable was false for three
// shapes that compiled clean: a member path, a `let` alias, and a mutating
// method. R1-a refused the direct spelling, its revision followed a helper
// call, cr-3 followed a `const` alias; each round found the next spelling.
//
// R16 replaces the inference with a declaration and R19's two referees:
//
//   compile time reports what it can see -- a direct write, or one reached
//   through a resolvable intra-module call or alias, that the header does not
//   declare (VEL5072);
//
//   the runtime is the exact backstop -- during a watch's synchronous body, a
//   write to any state outside its declared list fails loudly, naming the watch
//   and the state.
//
// So the four silences the R1-a revision recorded (a `let` alias, a member
// path, a cross-module write, a write through `any`) stop being holes: what one
// referee misses the other catches. Neither may be weakened to make the other's
// job easier, which is why this file tests both at their own level.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function codes(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

function undeclared(source: string): readonly string[] {
  return compile(source).diagnostics.filter((item) => item.code === "VEL5072").map((item) => item.message);
}

function format(source: string): string {
  return formatSource(source.trimStart(), { extensions: [velarCompilerExtension] });
}

// ---------------------------------------------------------------------------
// The grammar. `writes` is a contextual word claimed only in a watch header.
// ---------------------------------------------------------------------------

const bareClause = `
state t = 0
state x = 1

watch t writes x:
    x = x + 1
`;

const namedClause = `
state t = 0
state x = 1

watch t as current, previous writes x:
    x = current + previous
`;

const severalTargets = `
state t = 0
state x = 1
state y = 2

watch t writes x, y:
    x = 1
    y = 2
`;

test("[R16] the clause parses bare, beside 'as', and with several targets", () => {
  for (const source of [bareClause, namedClause, severalTargets]) {
    assert.deepEqual(messages(source), [], source);
  }
});

test("[R16] the clause round-trips through the formatter unchanged", () => {
  for (const source of [bareClause, namedClause, severalTargets]) {
    const once = format(source);
    assert.equal(once, source.trimStart(), JSON.stringify(once));
    assert.equal(format(once), once);
  }
});

test("[R16] 'writes' outside a watch header is an ordinary name", () => {
  assert.deepEqual(messages(`
const writes = 3
print(f"{writes}")
`), []);
  assert.deepEqual(messages(`
def writes(count: number) -> number:
    return count

print(f"{writes(1)}")
`), []);
  assert.deepEqual(messages(`
const record = { writes: 1 }
print(f"{record.writes}")
`), []);
  // And a state actually named `writes`, watched, writing itself.
  assert.deepEqual(messages(`
state writes = 0

watch writes writes writes:
    writes = writes + 1
`), []);
});

test("[R16] a 'writes' target must name a writable state of this scope", () => {
  const notAState = `
state t = 0
const y = 3

watch t writes y:
    print("hi")
`;
  assert.deepEqual(codes(notAState), ["VEL5073"]);
  assert.match(compile(notAState).diagnostics[0]!.message, /'y' is not a 'state' of this scope/u);
  const duplicate = `
state t = 0
state x = 1

watch t writes x, x:
    x = 1
`;
  assert.deepEqual(codes(duplicate), ["VEL5073"]);
  assert.match(compile(duplicate).diagnostics[0]!.message, /already declares that it writes 'x'/u);
});

// ---------------------------------------------------------------------------
// Compile time reports the writes it can see. Each case below compiled clean
// before R16.
// ---------------------------------------------------------------------------

test("[R16] a direct assignment the header does not declare is refused", () => {
  const reported = undeclared(`
state t = 0
state x = 1

watch t:
    x = x + 1
`);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /This watch writes state 'x', which its header does not declare/u);
  assert.match(reported[0]!, /'watch t writes x:'/u);
});

test("[R16] shape A: a member path rooted in a state is a write", () => {
  // The finding's first shape. Two watches writing `box.n` reported nothing and
  // swapping them changed the value.
  const shapeA = `
state t = 0
state box = { n: 0 }

watch t:
    box.n = box.n + 1

watch t:
    box.n = box.n * 10
`;
  assert.equal(undeclared(shapeA).length, 2, JSON.stringify(messages(shapeA)));
  assert.equal(undeclared(`
state t = 0
state rows = [1, 2]

watch t:
    rows[0] = 3
`).length, 1);
});

test("[R16] shape B: a write reached through an alias is a write", () => {
  // The finding's second shape: `let chosen = bump` then `chosen()`. Before
  // R16 the emitter marked this watch produces=false while the direct one
  // beside it was produces=true, so the writer ran in the observer tier.
  const shapeB = `
state t = 0
state x = 1

def bump():
    x = x + 1

watch t:
    let chosen = bump
    chosen()

watch t:
    x = x * 10
`;
  assert.equal(undeclared(shapeB).length, 2, JSON.stringify(messages(shapeB)));
});

test("[R16] shape C: a mutating method on a state is a write", () => {
  const shapeC = `
state t = 0
state log: List<string> = []

watch t:
    log.append("a")

watch t:
    log.append("b")
`;
  assert.equal(undeclared(shapeC).length, 2, JSON.stringify(messages(shapeC)));
  assert.deepEqual(messages(`
state t = 0
state log: List<string> = []

watch t writes log:
    log.append("a")
`), []);
});

test("[R16] a write through an intra-module 'def' and through a 'const' alias is refused", () => {
  assert.equal(undeclared(`
state t = 0
state x = 1

def bump():
    x = x + 1

watch t:
    bump()
`).length, 1);
  assert.equal(undeclared(`
state t = 0
state x = 1

def bump():
    x = x + 1

const chosen = bump

watch t:
    chosen()
`).length, 1);
});

test("[rw-4] a 'let' alias nothing reassigns is followed; one that is reassigned is not", () => {
  // Core's `bindingNeverReassigned` decides the half of this that is decidable
  // for one module. The failure mode is safe in both directions: a missed
  // follow costs an earlier report, never a wrong one, and the runtime backstop
  // is what actually refuses the write.
  assert.equal(undeclared(`
state t = 0
state x = 1

def bump():
    x = x + 1

let chosen = bump

watch t:
    chosen()
`).length, 1);
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

let chosen = bump
chosen = scale

watch t:
    chosen()

watch t writes x:
    x = 2
`), []);
});

test("[R16] two watches declaring one state is the contention, one error on each target", () => {
  const source = `
state t = 0
state x = 1

watch t writes x:
    x = x + 1

watch t writes x:
    x = x * 10
`;
  const reported = compile(source).diagnostics.filter((item) => item.code === "VEL5069");
  assert.equal(reported.length, 2, JSON.stringify(messages(source)));
  // Each diagnostic sits on that watch's own declared target -- the token the
  // author would edit -- and the two spans are different.
  const spans = reported.map((item) => item.span);
  assert.notEqual(spans[0]!.start, spans[1]!.start);
  for (const span of spans) assert.equal(source.trimStart().slice(span.start, span.end), "x");
});

test("[R16] the emitted watch carries the declared cells and the subject, and nothing infers them", () => {
  const result = compile(`
state t = 0
state x = 1
state y = 2

watch t writes x, y:
    x = 1
    y = 2

watch t:
    print(f"{x}")
`);
  assert.deepEqual(result.diagnostics, []);
  const tails = (result.code ?? "").split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("}, __velarGlobalScope,"));
  assert.deepEqual(tails, [
    // D90 R1-a-scope: the third argument is the declaration's site. Only a
    // watch with a clause gets one -- a pure observer can never contend.
    `}, __velarGlobalScope, [x, y], "t", __velarWatchSite0);`,
    `}, __velarGlobalScope, [], "t");`,
  ]);
  assert.match(result.code ?? "", /^const __velarWatchSite0 = \{ owner: null \};$/mu);
  // Only an author `state` declaration hands the runtime a name, which is what
  // keeps a resource's and an action's own cells invisible to the backstop.
  assert.match(result.code ?? "", /const x = __velarState\(1, "x"\);/u);
  assert.match(result.code ?? "", /const pending = __velarState\(false\);/u);
  assert.match(result.code ?? "", /const value = __velarState\(null\);\n/u);
});

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
// The runtime backstop. The finding's evidence was execution-level, so these
// run the emitted module: the three-way disagreement was only observable by
// running the program.
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

/** Two writing watches and one observer, in the two possible orders. */
function swapApplication(writerFirst: boolean): string {
  const first = `watch a writes b:\n    b = a * 2`;
  const second = `watch a writes c:\n    c = a * 3`;
  return `
state a = 0
state b = 0
state c = 0

computed sum = b + c

watch sum as current, _:
    print(f"sum={current}")

${writerFirst ? first : second}

${writerFirst ? second : first}

action main():
    a = 1
    await tick()
    print(f"b={b} c={c}")

async main()
`;
}

test("[R16] swapping two writing watches leaves the output identical", { timeout: 60_000 }, async () => {
  const outputs = [await runEmitted(swapApplication(true)), await runEmitted(swapApplication(false))];
  assert.equal(outputs[0], outputs[1], JSON.stringify(outputs));
  assert.equal(outputs[0], "sum=5\nb=2 c=3\n");
});

test("[R16] an undeclared write compile time cannot see fails loudly at runtime", { timeout: 60_000 }, async () => {
  // The dispatch here is exactly the boundary the compile leaves alone: the
  // writer arrives as a parameter, so this module's call graph reaches nothing.
  // That silence is no longer a hole -- it is the other referee's turn.
  const output = await runEmitted(`
state t = 0
state x = 1

def bump():
    x = x + 1

def indirect(run: () -> null):
    run()

watch t:
    indirect(bump)

action main():
    t = 1
    await tick()
    print(f"x={x}")

async main()
`);
  assert.match(output, /The watch on 't' wrote state 'x', which its header does not declare/u);
  assert.match(output, /'watch t writes x:'/u);
});

test("[R16] a deep write reached the same way names the state that owns it", { timeout: 60_000 }, async () => {
  const output = await runEmitted(`
state t = 0
state box = { n: 0 }

def bumpBox():
    box.n = box.n + 1

def indirect(run: () -> null):
    run()

watch t:
    indirect(bumpBox)

action main():
    t = 1
    await tick()
    print(f"n={box.n}")

async main()
`);
  assert.match(output, /The watch on 't' wrote state 'box', which its header does not declare/u);
});

test("[R16] a declared write, a computed that writes, and a body-local state do not trip it", { timeout: 60_000 }, async () => {
  // Three exemptions, each one a promise the charter or the tour already makes.
  // A `computed` callback may write state and the write publishes normally, so
  // evaluating a lazy derived value inside a watch body must not charge the
  // watch with it; a state declared during the watch's own run has no header it
  // could ever have been named in; and a declared write is simply legal.
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

watch t writes declared:
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

test("[R16] a declared member-path write and a declared mutating method both land", { timeout: 60_000 }, async () => {
  // Shapes A and C of the finding, now legal because the header says so. The
  // backstop compares cell identities, so a path rooted in a declared state and
  // a mutating method on one both resolve to the cell the clause named.
  const output = await runEmitted(`
state t = 0
state box = { n: 0 }
state log: List<string> = []

watch t writes box, log:
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
// D90 R16-a: a `writes` clause may name an imported reactive binding.
//
// R16 left one program with no legal spelling: a watch may already write
// another module's state by calling an action that module exports, and if the
// clause only accepted local bindings that program became a runtime error the
// author could not declare their way out of. R16-a widens the clause and
// nothing else -- matching is by cell identity, so an alias and a re-export
// name the same cell, and assigning *through* the import stays VEL3002.
//
// These need more than one module, so they compile through the CLI's project
// resolver rather than the single-module `compile` above.
// ---------------------------------------------------------------------------

const counterModule = `
export state hits = 0

export def bump():
    hits = hits + 1
`;

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
 * made shape C (a mutating method on an imported collection state) reach
 * neither referee here while the real `velar dev` and the real bundle both
 * refuse it: a harness that disagrees with the product cannot notice a
 * regression in the shape R16 exists for.
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

test("[R16-a] a 'writes' clause names an imported state, plain, aliased, and through a re-export", { timeout: 60_000 }, async () => {
  // AGENTS.md's third shape: the sink is "a declarable cell", not one spelling
  // of its name, so the alias and both re-export shapes are asked too.
  assert.deepEqual(await projectMessages({
    "counter.vel": counterModule,
    "main.vel": `
import {hits, bump} from "./counter.vel"

state t = 0

watch t writes hits:
    bump()
`,
  }), [], "the plain spelling");
  assert.deepEqual(await projectMessages({
    "counter.vel": counterModule,
    "main.vel": `
import {hits as h, bump} from "./counter.vel"

state t = 0

watch t writes h:
    bump()
`,
  }), [], "an aliased import names the same cell");
  assert.deepEqual(await projectMessages({
    "counter.vel": counterModule,
    "hub.vel": `
export {hits, bump} from "./counter.vel"
`,
    "main.vel": `
import {hits, bump} from "./hub.vel"

state t = 0

watch t writes hits:
    bump()
`,
  }), [], "a re-export is the same cell one module further away");
  assert.deepEqual(await projectMessages({
    "counter.vel": counterModule,
    "hub.vel": `
export {hits as clicks, bump} from "./counter.vel"
`,
    "main.vel": `
import {clicks as c, bump} from "./hub.vel"

state t = 0

watch t writes c:
    bump()
`,
  }), [], "renamed twice, still the same cell");
});

test("[R16-a] 'writes' still refuses an imported computed and an imported const", { timeout: 60_000 }, async () => {
  const module = `
export state hits = 0
export computed doubled = hits * 2
export const label = "a"

export def bump():
    hits = hits + 1
`;
  for (const name of ["doubled", "label"]) {
    const reported = await projectMessages({
      "counter.vel": module,
      "main.vel": `
import {${name}, bump} from "./counter.vel"

state t = 0

watch t writes ${name}:
    bump()
`,
    });
    assert.equal(reported.length, 1, `${name}: ${JSON.stringify(reported)}`);
    assert.match(reported[0]!, /^VEL5073 /u);
    // R16-a widened what the clause may point at, so the refusal has to say
    // which module owns the name and how a write to that module travels.
    assert.match(reported[0]!, new RegExp(`'${name}' is imported from "\\./counter\\.vel" and is not a 'state' there`, "u"));
    assert.match(reported[0]!, /a 'state' of this scope or a 'state' another module exports/u);
    assert.match(reported[0]!, /calling an action its owning module exports, because assigning through an import stays read-only/u);
  }
});

test("[R16-a] assigning through the import is still VEL3002", { timeout: 60_000 }, async () => {
  // R16-a widened the clause, not the import. The write still has to travel
  // through the action the owning module exports.
  const reported = await projectMessages({
    "counter.vel": counterModule,
    "main.vel": `
import {hits} from "./counter.vel"

state t = 0

watch t:
    hits = hits + 1
`,
  });
  assert.deepEqual(reported.map((item) => item.slice(0, 7)), ["VEL3002", "VEL5072"]);
  assert.match(reported[0]!, /Cannot assign to imported reactive binding 'hits'/u);
  assert.match(reported[1]!, /This watch writes state 'hits', which its header does not declare/u);
});

/** Two watches, one declaring the imported cell and one a local state, in the two possible orders. */
function crossModuleApplication(importedFirst: boolean): Readonly<Record<string, string>> {
  const first = `watch t writes hits:\n    bump()`;
  const second = `watch t writes other:\n    other = other + 1`;
  return {
    "counter.vel": counterModule,
    "main.vel": `
import {hits, bump} from "./counter.vel"

state t = 0
state other = 0

${importedFirst ? first : second}

${importedFirst ? second : first}

action main():
    t = 1
    await tick()
    print(f"hits={hits} other={other}")

async main()
`,
  };
}

test("[R16-a] a declared cross-module write lands, and swapping the two watches leaves the output identical", { timeout: 60_000 }, async () => {
  const outputs = [await runProject(crossModuleApplication(true)), await runProject(crossModuleApplication(false))];
  assert.equal(outputs[0], outputs[1], JSON.stringify(outputs));
  assert.equal(outputs[0], "hits=1 other=1\n");
});

test("[R16-a] an undeclared write through an imported action is named by the runtime backstop", { timeout: 60_000 }, async () => {
  // The cross-module silence the R1-a revision recorded: this module's call
  // graph reaches nothing inside counter.vel, so compile time says nothing and
  // the backstop is the referee. It lives on a global slot precisely so the
  // owning module's copy of the runtime can raise it.
  const output = await runProject({
    "counter.vel": counterModule,
    "main.vel": `
import {hits, bump} from "./counter.vel"

state t = 0

watch t:
    bump()

action main():
    t = 1
    await tick()
    print(f"hits={hits}")

async main()
`,
  });
  assert.match(output, /The watch on 't' wrote state 'hits', which its header does not declare/u);
  assert.match(output, /'watch t writes hits:'/u);
});

// ---------------------------------------------------------------------------
// D90 R16-a, the compile side: the key is the cell, not the spelling.
//
// An alias had defeated a rule keyed on a name four times by now -- a helper
// call, a `const` alias, a `let`, and finally an import specifier's own span.
// Every import specifier creates its own binding at its own span, so `hits` and
// `hits as h` were two cells to the analyzer and one cell at runtime, and all
// three questions the `writes` clause asks fell through the gap: two watches
// writing one imported cell reported nothing, a write spelled with the other
// name was called undeclared, and one cell could be declared twice. The key is
// now the owning module plus the name it exports -- the identity the runtime
// already matches on.
// ---------------------------------------------------------------------------

/** Two watches of one module, both writing the imported cell, under the two given spellings. */
function aliasContention(first: string, second: string, specifiers: string): Readonly<Record<string, string>> {
  return {
    "counter.vel": `
export state hits = 0

export def bump():
    hits = hits + 1

export def bumpTwice():
    hits = hits + 2
`,
    "main.vel": `
import {${specifiers}} from "./counter.vel"

state t = 0

watch t writes ${first}:
    bump()

watch t writes ${second}:
    bumpTwice()
`,
  };
}

test("[R16-a] two watches writing one imported cell contend under an alias exactly as under one spelling", { timeout: 60_000 }, async () => {
  const aliased = await projectMessages(aliasContention("hits", "h", "hits, hits as h, bump, bumpTwice"));
  const control = await projectMessages(aliasContention("hits", "hits", "hits, bump, bumpTwice"));
  assert.deepEqual(aliased, control, "the alias is the same cell, so it is the same two diagnostics");
  assert.equal(control.length, 2);
  for (const message of control) {
    assert.match(message, /^VEL5069 State 'hits' is assigned by 2 watch blocks in this scope, and one flush settles every watch in a single pass that states no order between them, so which write lands last is undefined; put every update to 'hits' in one watch, or give each watch a state of its own$/u);
  }
});

test("[R16-a] a 'writes' clause covers a write spelled with the cell's other name", { timeout: 60_000 }, async () => {
  const logModule = `
export state log: List<string> = []

export def note(item: string):
    log.append(item)
`;
  // The false positive the span key produced, and the nonsense remedy it
  // taught: VEL5072 told the author to write `writes l, log` -- one cell
  // declared twice -- and the analyzer accepted it.
  assert.deepEqual(await projectMessages({
    "logs.vel": logModule,
    "main.vel": `
import {log, log as l, note} from "./logs.vel"

state t = 0

watch t writes l:
    note("a")
`,
  }), []);
  // Silence is only half the answer: the write still has to land.
  assert.equal(await runProject({
    "logs.vel": logModule,
    "main.vel": `
import {log, log as l, note} from "./logs.vel"

state t = 0

watch t writes l:
    note("a")

action main():
    t = 1
    await tick()
    print(f"size={log.size} first={log[0]}")

async main()
`,
  }), "size=1 first=a\n");
});

test("[R16-a] declaring one cell under two names is the duplicate refusal, naming both", { timeout: 60_000 }, async () => {
  const counterWithAlias = (clause: string, specifiers: string): Readonly<Record<string, string>> => ({
    "counter.vel": counterModule,
    "main.vel": `
import {${specifiers}} from "./counter.vel"

state t = 0

watch t writes ${clause}:
    bump()
`,
  });
  const aliased = await projectMessages(counterWithAlias("hits, h", "hits, hits as h, bump"));
  assert.deepEqual(aliased, [
    "VEL5073 This watch already declares that it writes 'hits', and 'h' is a second name for that same state; a 'writes' clause names cells, not spellings, so declare it once",
  ]);
  // The same-spelling wording is unchanged: there is no second name to name.
  assert.deepEqual(await projectMessages(counterWithAlias("hits, hits", "hits, bump")), [
    "VEL5073 This watch already declares that it writes 'hits'",
  ]);
});

// ---------------------------------------------------------------------------
// D90 R1-a-scope: the runtime referee for the contention compile time cannot
// see. R1-a is scoped per analyzed scope on purpose -- two components that each
// write one module state are two instances that need not even be co-resident --
// so two watches in two modules, or two import paths to one cell, both pass
// compile time. R19's layering hands that to the runtime, which refuses at the
// moment two distinct watch observers settle one cell in a single flush.
// ---------------------------------------------------------------------------

/** The two watch subjects a contention error names, in the order it named them. */
function contendingSubjects(output: string, state: string): readonly string[] {
  const matched = new RegExp(`The watch on '([^']*)' and the watch on '([^']*)' both wrote state '${state}' in one flush, `
    + `and one flush settles every watch in a single pass that states no order between them, so which write lands last `
    + `is undefined; put every update to '${state}' in one watch, or give each watch a state of its own`, "u").exec(output);
  assert.ok(matched !== null, output);
  return [matched[1]!, matched[2]!];
}

test("[R16-a] two import paths to one cell are refused by the runtime, not by compile time", { timeout: 60_000 }, async () => {
  // R19's layering, stated as a test: a barrel re-export gives the two watches
  // two different module specifiers for one cell, and the Web analyzer has no
  // project module graph to fold them with -- AnalysisContext carries no origin
  // for values and belongs to Core. So compile time is silent here on purpose
  // and the second referee is the one that answers.
  const project = {
    "counter.vel": counterModule,
    "hub.vel": `
export {hits} from "./counter.vel"
`,
    "main.vel": `
import {hits, bump} from "./counter.vel"
import {hits as h} from "./hub.vel"

state t = 0
state u = 0

watch t writes hits:
    bump()

watch u writes h:
    bump()

action main():
    t = 1
    u = 1
    await tick()
    print(f"hits={hits}")

async main()
`,
  };
  assert.deepEqual(await projectMessages(project), []);
  assert.deepEqual([...contendingSubjects(await runProject(project), "hits")].sort(), ["t", "u"]);
});

/** counter.vel, a clock two modules both observe, and a second module that writes the imported cell. */
function crossModuleContention(): Readonly<Record<string, string>> {
  return {
    "counter.vel": `
export state hits = 0

export def bump():
    hits = hits + 1

export def bumpTwice():
    hits = hits + 2
`,
    "clock.vel": `
export state tick_count = 0
export state beat = 0

export def advance():
    tick_count = tick_count + 1
    beat = beat + 1
`,
    "left.vel": `
import {hits, bump} from "./counter.vel"
import {beat} from "./clock.vel"

export const loaded = true

watch beat writes hits:
    bump()
`,
    "main.vel": `
import {hits, bumpTwice} from "./counter.vel"
import {tick_count, advance} from "./clock.vel"
import {loaded} from "./left.vel"

watch tick_count writes hits:
    bumpTwice()

action main():
    print(f"loaded={loaded}")
    advance()
    await tick()
    print(f"hits={hits}")

async main()
`,
  };
}

test("[R1-a-scope] two modules that both declare one imported cell are refused when the flush settles them", { timeout: 60_000 }, async () => {
  const project = crossModuleContention();
  // Each module compiles alone and neither analyzer can see the other's watch,
  // so both referees at compile time pass.
  assert.deepEqual(await projectMessages(project), []);
  assert.deepEqual([...contendingSubjects(await runProject(project), "hits")].sort(), ["beat", "tick_count"]);
});

test("[R1-a-scope] single-module contention stays exactly the two VEL5069 the compile refuses", { timeout: 60_000 }, async () => {
  // The runtime must not double-report what compile time already refuses: a
  // refused module emits no code, so the second referee never sees this one.
  const reported = await projectMessages(aliasContention("hits", "hits", "hits, bump, bumpTwice"));
  assert.deepEqual(reported.map((item) => item.slice(0, 7)), ["VEL5069", "VEL5069"]);
});

test("[R1-a-scope] a watch that only reads the cell another watch settles is not a contender", { timeout: 60_000 }, async () => {
  const application = (writerFirst: boolean): Readonly<Record<string, string>> => {
    const writer = `watch t writes hits:\n    bump()`;
    const reader = `watch t:\n    print(f"seen={hits}")`;
    return {
      "counter.vel": counterModule,
      "main.vel": `
import {hits, bump} from "./counter.vel"

state t = 0

${writerFirst ? writer : reader}

${writerFirst ? reader : writer}

action main():
    t = 1
    await tick()
    print(f"hits={hits}")

async main()
`,
    };
  };
  const outputs = [await runProject(application(true)), await runProject(application(false))];
  assert.equal(outputs[0], outputs[1], JSON.stringify(outputs));
  assert.equal(outputs[0], "seen=1\nhits=1\n");
});

test("[R1-a-scope] a watch that declares a cell but does not write it this round is not a contender", { timeout: 60_000 }, async () => {
  // The same two modules as the contention above, with the second module's
  // write guarded off: a declaration is not a write, and nothing is recorded
  // until one lands.
  const project = { ...crossModuleContention() };
  const guarded = project["left.vel"]!.replace("watch beat writes hits:\n    bump()", "watch beat writes hits:\n    if beat > 5:\n        bump()");
  assert.notEqual(guarded, project["left.vel"]);
  assert.deepEqual(await projectMessages({ ...project, "left.vel": guarded }), []);
  assert.equal(await runProject({ ...project, "left.vel": guarded }), "loaded=true\nhits=2\n");
});

test("[R1-a-scope] a watch is never its own contender, writing twice or running twice in one flush", { timeout: 60_000 }, async () => {
  // The token is created once per `__velarWatch` invocation rather than per
  // frame, so the second write of one body and the second run of one watch
  // inside a single flush both carry the identity the first did.
  assert.equal(await runProject({
    "counter.vel": `
export state hits = 0

export def bump():
    hits = hits + 1

export def bumpTwice():
    hits = hits + 2
`,
    "main.vel": `
import {hits, bump, bumpTwice} from "./counter.vel"

state t = 0

watch t writes hits:
    bump()
    bumpTwice()

action main():
    t = 1
    await tick()
    print(f"hits={hits}")

async main()
`,
  }), "hits=3\n");
  assert.equal(await runProject({
    "counter.vel": counterModule,
    "main.vel": `
import {hits, bump} from "./counter.vel"

state t = 0
state u = 0

watch t writes hits:
    bump()

watch u writes t:
    t = t + 1

action main():
    t = 1
    u = 1
    await tick()
    print(f"hits={hits} t={t}")

async main()
`,
  }), "hits=2 t=2\n");
});

/** counter.vel, owning a collection state its own exported `def` mutates. */
const collectionModule = `
export state log: List<string> = []

export def note(item: string):
    log.append(item)
`;

test("[R16] shape C reaches both referees across a module boundary too", { timeout: 60_000 }, async () => {
  // The blessed accumulating idiom writes through a mutating method, and a
  // mutating method is the shape R16 exists for. Across modules it lands on the
  // ownership bubble rather than on the cell's own `set`, so it is asked here
  // at both referees: undeclared, and declared by two modules at once.
  const undeclared = await runProject({
    "counter.vel": collectionModule,
    "main.vel": `
import {log, note} from "./counter.vel"

state t = 0

watch t:
    note("a")

action main():
    t = 1
    await tick()
    print(f"size={log.size}")

async main()
`,
  });
  assert.match(undeclared, /The watch on 't' wrote state 'log', which its header does not declare/u);
  const contending = await runProject({
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

watch beat writes log:
    note("left")
`,
    "main.vel": `
import {log, note} from "./counter.vel"
import {tick_count, advance} from "./clock.vel"
import {loaded} from "./left.vel"

watch tick_count writes log:
    note("main")

action main():
    print(f"loaded={loaded}")
    advance()
    await tick()
    print(f"size={log.size}")

async main()
`,
  });
  assert.deepEqual([...contendingSubjects(contending, "log")].sort(), ["beat", "tick_count"]);
});

test("[R16-a] one cell declared under two import paths is refused when the watch is built", { timeout: 60_000 }, async () => {
  // The other half of the re-export residual. Compile time folds two spellings
  // of one import specifier (VEL5073 above) but not two specifiers for one
  // cell, and a duplicated declaration is not a write, so the contention
  // referee never sees it. The declared targets are the cells themselves, so
  // the duplicate is exact at the moment the watch is constructed -- before any
  // flush, and without a module graph.
  const project = {
    "counter.vel": counterModule,
    "hub.vel": `
export {hits} from "./counter.vel"
`,
    "main.vel": `
import {hits, bump} from "./counter.vel"
import {hits as h} from "./hub.vel"

state t = 0

watch t writes hits, h:
    bump()

action main():
    t = 1
    await tick()
    print(f"hits={hits}")

async main()
`,
  };
  assert.deepEqual(await projectMessages(project), []);
  assert.match(await runProject(project), new RegExp("The watch on 't' declares that it writes state 'hits' twice, "
    + "under two names for one cell; a 'writes' clause names cells, not spellings, so declare it once", "u"));
  // Two different cells in one clause stay legal: the key is the cell, and
  // these are two.
  assert.equal(await runProject({
    "counter.vel": `
export state hits = 0
export state misses = 0

export def bump():
    hits = hits + 1
    misses = misses + 2
`,
    "main.vel": `
import {hits, misses, bump} from "./counter.vel"

state t = 0

watch t writes hits, misses:
    bump()

action main():
    t = 1
    await tick()
    print(f"hits={hits} misses={misses}")

async main()
`,
  }), "hits=1 misses=2\n");
});

/**
 * Mounts one application and clicks `[data-advance]`, answering with the text
 * of `[data-hits]` and every error the page reported. A component instance
 * needs a document, so the multi-instance shape is browser-level.
 */
async function mountApplication(source: string): Promise<{ readonly hits: string; readonly failures: readonly string[] }> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => { failures.push(String(error)); });
    await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: result.code ?? "", type: "module" });
    await page.waitForFunction("document.querySelector('[data-hits]') !== null");
    await page.click("[data-advance]");
    await page.waitForFunction("document.querySelector('[data-advance]').dataset.clicked === '1'");
    return { hits: (await page.textContent("[data-hits]")) ?? "", failures };
  } finally {
    await browser.close();
  }
}

/** Two instances of `Row`, whose watch writes whichever state `sink` names. */
function multiInstanceApplication(sink: "module" | "instance"): string {
  return `
state hits = 0

component Row(seed: string):
    state seen = 0

    watch seed writes ${sink === "module" ? "hits" : "seen"}:
        ${sink === "module" ? "hits = hits + 1" : "seen = seen + 1"}

    return <p data-row>{seed}{seen}</p>

component App:
    state a = "a"
    state b = "b"
    state clicked = 0

    def advance():
        a = "a2"
        b = "b2"
        clicked = 1

    return <main>
        <Row seed={a} />
        <Row seed={b} />
        <p data-hits>{hits}</p>
        <button data-advance data-clicked={clicked} on:click={advance}>go</button>
    </main>

mount(<App />, "#app")
`;
}

test("[R1-a-scope] two live instances of one watch are named as instances, not as two watches", { timeout: 120_000 }, async () => {
  // One `watch` declaration, mounted twice, writing one module state. Compile
  // time passes this on purpose -- R1-a is scoped per analyzed scope precisely
  // because a component can be mounted twice -- so the runtime message is the
  // only guidance the author gets, and the wording written for two declarations
  // is a falsehood here: there are not two watches to split the state between,
  // and every update is already in one watch.
  const contending = await mountApplication(multiInstanceApplication("module"));
  assert.deepEqual(contending.failures.map((item) => item.replace(/^TypeError: /u, "")), [
    "Two live instances of component 'Row' both ran the watch on 'seed' and wrote state 'hits' in one flush, "
    + "and one flush settles every watch in a single pass that states no order between them, so which write lands "
    + "last is undefined; 'hits' is one cell every instance shares, so declare it inside 'Row' to give each "
    + "instance its own, or move the update to a watch or an action that runs once",
  ]);
  // Neither half of the message is the VEL5069 remedy, which does not apply.
  for (const failure of contending.failures) {
    assert.doesNotMatch(failure, /put every update to '[^']*' in one watch/u);
    assert.doesNotMatch(failure, /give each watch a state of its own/u);
  }
  // The first remedy it does name: a state declared inside the component is one
  // cell per instance, and the same program is then legal.
  const perInstance = await mountApplication(multiInstanceApplication("instance"));
  assert.deepEqual(perInstance.failures, []);
  assert.equal(perInstance.hits, "0");
});

// A resource lives at component scope, so this one needs a document. It is the
// spelling four charter fences and examples/tour/web/04 teach -- a watch whose
// whole body is `async profile.reload()` -- and reload synchronously sets the
// resource's own loading and error cells. Those cells are the resource's, not
// state the author declared, so the watch stays a pure observer with no clause.
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

test("[R16] a resource reload inside a watch is not a write the author could declare", { timeout: 120_000 }, async () => {
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
