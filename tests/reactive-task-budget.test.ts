import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 W A1: the runaway budget is spent per task, not per flush.
//
// Two gates already stood against a reactive cycle, and both of them see one
// synchronous settle: the per-observer self-invalidation cap of 100 rounds, and
// the flush budget of 100,000 observer runs that D90 R21 left as the only gate
// against two watches writing each other's state. A cycle that crosses a
// microtask boundary -- a watch that detaches an `async def` which awaits an
// already-resolved Promise and then writes the watched state -- was a *new
// flush every round*, so it met a fresh 100,000 budget every time and never
// reached either gate. It ran forever, reported nothing, and the page it froze
// had no error to show for it.
//
// So the token a flush stamps its run counts with, the counts themselves and
// the budget they spend now belong to one host task. Flushes chained through
// microtasks share them; a macrotask sentinel armed at the end of every flush
// closes the window, so work resumed by a timer, an event or network I/O starts
// a fresh one. That second half is the point of the sentinel and is asserted
// here as hard as the first: an animation that writes state on every frame must
// never be stopped.
//
// D114 W2 narrowed which flushes a window spans, because "one task" alone was
// wider than the cycle it was written for: a program that runs past 100,000
// observers in one uninterrupted task without an observer starting anything --
// a bulk import loop, or the reactive benchmark -- has no ring to break and was
// being stopped anyway. A window now carries into the next flush only once an
// observer run inside it has started asynchronous work: a `detach` statement or
// an `action` call made while an observer was running, which are the two ways a
// synchronous observer body reaches a later microtask. Both shapes are proved
// below, and so is the loop that must survive.
//
// Everything here runs the emitted runtime under Node rather than in a browser.
// The property is the scheduler's, not the document's -- R21's own cross-module
// case makes the same choice, and for the same reason, "the scheduler it
// exercises is the same one, byte for byte". These programs also need
// `Promise.sleep` to reach a real macrotask boundary and `velar/app`'s `onError`
// to read a report whole, and both arrive as module imports, which one inlined
// script tag cannot resolve.

const standardModuleFlavour = { base: "/" } as const;

/**
 * Materializes a whole project beside the standard modules its code imports and
 * runs `main.js`, answering everything it printed. Copied in shape from the R21
 * project harness: the emitter already writes a neighbour's specifier as the
 * emitted `.js` name, so only the `velar/*` specifiers need linking, and the
 * standard modules are asked for with this project's own extensions so the Web
 * flavour of the reactive runtime is what runs.
 */
async function runProject(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-d114-w-"));
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

/** The report chain, recorded as one line each, so a case reads what the runtime said. */
const reportRecorder = `
import {onError} from "velar/app"

type AppErrorReport:
    error: Error
    phase: string
    detail: string
    component: string
    timestamp: number

let reports = ""
let reportCount = 0

def record(report: AppErrorReport):
    reportCount = reportCount + 1
    reports = reports + f"{report.phase}|{report.error.message}|{report.detail}|{report.component}\\n"
`;

// ---------------------------------------------------------------------------
// The cycle a per-flush budget could not see
// ---------------------------------------------------------------------------

test("[W-A1] a cycle that crosses a microtask boundary is stopped and names the watch", { timeout: 120_000 }, async () => {
  // The write reaches `x` through an ordinary helper, one hop past the `async
  // def` the watch starts. D90 R21 deleted the compile-time analysis of who
  // writes what through a call, and D114 W A2(b) restored exactly one hop of it,
  // so this shape is deliberately one hop further out: compile time is silent
  // about it by design, and the runtime is the only thing that can stop it.
  const output = await runProject({
    "main.vel": `${reportRecorder}
state x = 0

async def settled():
    return null

def bump():
    x = x + 1

async def step():
    await settled()
    bump()
    return null

watch x:
    detach step()

@main:
    onError(record)
    x = 1
    // The cycle never yields to the event loop, so this timer cannot fire until
    // the budget has stopped the ring -- which is also why the macrotask
    // sentinel cannot close the window underneath it.
    await Promise.sleep(1ms)
    print(f"count={str(reportCount)}")
    print(reports)
`,
  });
  assert.match(output, /count=1\n/u, output);
  assert.match(output, /^update\|Reactive updates cannot run more than 100000 observers in one task\|/mu, output);
  assert.match(output, /Ran most in this task: the watch on 'x' \(\d+ runs\)/u, output);
});

// ---------------------------------------------------------------------------
// The animation the sentinel exists to protect
// ---------------------------------------------------------------------------

test("[W-A1] state written from 2,000 separate tasks is never stopped", { timeout: 180_000 }, async () => {
  // Every write is its own task, so every write meets a window the sentinel has
  // closed: the run counts start again and no chain accumulates. Before the
  // sentinel existed there was nothing to prove here, because the budget could
  // not span two flushes at all; with a window that spans a task and no way to
  // end it, this is the program that would be stopped at frame 50,000.
  const output = await runProject({
    "main.vel": `${reportRecorder}
state frames = 0
state painted = 0

watch frames:
    painted = painted + 1

@main:
    onError(record)
    let index = 0
    while index < 2000:
        frames = frames + 1
        await Promise.sleep(0ms)
        index = index + 1
    await tick()
    print(f"painted={str(painted)} reports={str(reportCount)}")
`,
  });
  assert.match(output, /painted=2000 reports=0\n/u, output);
});

// ---------------------------------------------------------------------------
// The synchronous ring is unchanged
// ---------------------------------------------------------------------------

test("[W-A1] a mutual write cycle still reports once and names both watches", { timeout: 120_000 }, async () => {
  // D90 R21's own fixture. One settle, one report, both halves of the ring
  // named: the task window is a superset of the flush the budget used to be
  // spent in, so a cycle that never leaves one flush must read exactly as it
  // did before.
  const output = await runProject({
    "main.vel": `${reportRecorder}
state alpha = 0
state beta = 0

watch alpha:
    beta = beta + 1

watch beta:
    alpha = alpha + 1

@main:
    onError(record)
    alpha = 1
    await tick()
    print(f"count={str(reportCount)}")
    print(reports)
`,
  });
  assert.match(output, /count=1\n/u, output);
  assert.match(output, /update\|Reactive updates cannot run more than 100000 observers in one task\|/u, output);
  assert.match(output, /the watch on 'alpha' \(\d+ runs\)/u, output);
  assert.match(output, /the watch on 'beta' \(\d+ runs\)/u, output);
});

// ---------------------------------------------------------------------------
// The window closes behind the overrun
// ---------------------------------------------------------------------------

test("[W-A1] an unrelated write in a later task flushes normally after an overrun", { timeout: 120_000 }, async () => {
  // The budget that stopped the ring is spent, and the window that spent it
  // belongs to the task the storm ran in. A write one macrotask later opens a
  // new window with its own budget, so the watch it queues runs and nothing is
  // reported a second time -- which is the whole difference between a page that
  // survives a runaway and one that is dead after it.
  const output = await runProject({
    "main.vel": `${reportRecorder}
state alpha = 0
state beta = 0
state unrelated = 0
state unrelatedRuns = 0

watch alpha:
    beta = beta + 1

watch beta:
    alpha = alpha + 1

watch unrelated:
    unrelatedRuns = unrelatedRuns + 1

@main:
    onError(record)
    alpha = 1
    await tick()
    await Promise.sleep(0ms)
    unrelated = 1
    await tick()
    print(f"count={str(reportCount)} runs={str(unrelatedRuns)}")
`,
  });
  assert.match(output, /count=1 runs=1\n/u, output);
});

// ---------------------------------------------------------------------------
// The bulk loop that started nothing
// ---------------------------------------------------------------------------

test("[W2] a bulk microtask loop with no observer-started work is never stopped", { timeout: 300_000 }, async () => {
  // 150,000 rows imported in one uninterrupted task: every row writes the
  // progress counter and awaits promise-only work, so nothing here ever reaches
  // a macrotask and the sentinel never fires. Three observer runs settle each
  // row -- the derived banner, the watch on it, and the watch on the counter --
  // which is 450,000 runs against a budget of 100,000. None of them starts
  // asynchronous work, so there is no ring for the budget to break, and every
  // flush gets the fresh budget it had before the window existed.
  //
  // `computed` stands in for the render observer of the ruling's wording: a
  // computed observer sits in the same DOM queue a render observer does and is
  // budgeted through the same counter, and these programs run headlessly under
  // Node, where no document exists to render into.
  const output = await runProject({
    "main.vel": `${reportRecorder}
state progress = 0
computed banner = progress * 2
let painted = 0
let observed = 0

async def settled():
    return null

watch banner:
    painted = painted + 1

watch progress:
    observed = observed + 1

@main:
    onError(record)
    let index = 0
    while index < 150000:
        progress = index + 1
        await settled()
        index = index + 1
    await tick()
    print(f"painted={str(painted)} observed={str(observed)} reports={str(reportCount)}")
`,
  });
  assert.match(output, /painted=150000 observed=150000 reports=0\n/u, output);
});

// ---------------------------------------------------------------------------
// The other way an observer starts asynchronous work
// ---------------------------------------------------------------------------

test("[W2] a cycle through an action started by a watch is stopped and names the watch", { timeout: 180_000 }, async () => {
  // The same ring as the first case with the other lowering point in it: no
  // `detach` anywhere, so the only thing that can tell the window an observer
  // started asynchronous work is the action call path. The action's promise is
  // kept in an ordinary binding rather than detached, which is what makes this
  // program reach that path and nothing else.
  //
  // The write lands through a plain `def`, one hop past the action's own body,
  // for the reason the first case gives: W A2(b) refuses an action whose own
  // top level writes the watched binding, so a cycle that compiles has to be
  // one the static rule cannot see.
  const output = await runProject({
    "main.vel": `${reportRecorder}
state x = 0

async def settled():
    return null

let inflight = settled()

def bump():
    x = x + 1

action step():
    await settled()
    bump()

watch x:
    inflight = step()

@main:
    onError(record)
    x = 1
    await Promise.sleep(1ms)
    print(f"count={str(reportCount)}")
    print(reports)
`,
  });
  assert.match(output, /count=1\n/u, output);
  assert.match(output, /^update\|Reactive updates cannot run more than 100000 observers in one task\|/mu, output);
  assert.match(output, /Ran most in this task: the watch on 'x' \(\d+ runs\)/u, output);
});
