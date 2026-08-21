import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";

after(removeTemporaryDirectories);

/*
 * The Node test runner's isolation and its bounds.
 *
 * The runner used to run every test file in the process that reported them, so
 * three promises it makes were false at once: a per-test bound implemented as
 * `Promise.race` could not preempt a synchronous loop and wedged the whole run
 * with no output; a timed-out body was never cancelled and went on mutating
 * state the next test asserted against, while its own later failure was
 * swallowed by the race's own rejection handler; and only the entry module was
 * cache-busted, so every shared dependency's state was global for the run and a
 * self-contained file's verdict depended on its neighbours' filenames.
 *
 * Each test file now runs in its own thread, which is the only bound
 * synchronous work obeys and the only reset a module graph gets.
 *
 * A bound that lives outside the work it bounds has to cover every wait, not
 * only the named one: the parent's wait for a thread to end, the run's own
 * last settle, and — in the browser runner, whose bodies run in a process no
 * thread can be terminated out of — the supervisor's wait for the worker.
 */

const cli = join(repositoryRoot, "packages", "cli", "src", "cli.ts");
const configModule = join(repositoryRoot, "packages", "cli", "src", "config.ts");
const testRunner = join(repositoryRoot, "packages", "cli", "src", "test-runner.ts");
const browserTestRunner = join(repositoryRoot, "packages", "cli", "src", "browser-test-runner.ts");

interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

function runCommand(command: string, arguments_: readonly string[]): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr, output: `${stdout}${stderr}` }));
  });
}

async function coreProject(prefix: string, modules: Readonly<Record<string, string>>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export def hello() -> string:\n    return \"hello\"\n", "utf8");
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(directory, "src", name), source.trimStart(), "utf8");
  }
  return directory;
}

/**
 * The per-test and settle bounds are not a CLI surface, so a regression that
 * needs a short one drives the runner from a spawned script — which is also the
 * only honest place to watch the process end, since the node:test harness keeps
 * its own work on the loop forever.
 */
async function runTestsWithLimits(
  directory: string,
  testTimeoutMs: number,
  settleTimeoutMs: number,
): Promise<CommandResult> {
  const script = join(directory, "run-tests.mjs");
  await writeFile(script, [
    `const { resolveVelarProject } = await import(${JSON.stringify(`file://${configModule}`)});`,
    `const { runTests } = await import(${JSON.stringify(`file://${testRunner}`)});`,
    `const config = await resolveVelarProject(${JSON.stringify(directory)});`,
    `process.exitCode = await runTests(config, null, {`,
    `  testTimeoutMs: ${testTimeoutMs},`,
    `  settleTimeoutMs: ${settleTimeoutMs},`,
    "});",
  ].join("\n"), "utf8");
  return runCommand(process.execPath, [script]);
}

/**
 * The browser bounds are not a CLI surface either, and the bound a wedged
 * worker cannot honour lives in the supervisor that spawns it, so the script
 * names the CLI as that worker's executable exactly as `velar test` does.
 */
async function runBrowserTestsWithLimits(
  directory: string,
  testTimeoutMs: number,
  runTimeoutMs: number,
): Promise<CommandResult> {
  const script = join(directory, "run-browser-tests.mjs");
  await writeFile(script, [
    `const { resolveVelarProject } = await import(${JSON.stringify(`file://${configModule}`)});`,
    `const { runBrowserTests } = await import(${JSON.stringify(`file://${browserTestRunner}`)});`,
    `const config = await resolveVelarProject(${JSON.stringify(directory)});`,
    'process.exitCode = await runBrowserTests(config, null, "chromium", {',
    `  testTimeoutMs: ${testTimeoutMs},`,
    `  runTimeoutMs: ${runTimeoutMs},`,
    "  cleanupTimeoutMs: 10000,",
    `  executable: ${JSON.stringify(cli)},`,
    "});",
  ].join("\n"), "utf8");
  return runCommand(process.execPath, [script]);
}

/** A web project that mounts something, so its browser tests have a page to drive. */
async function browserProject(prefix: string, modules: Readonly<Record<string, string>>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "public"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(repositoryRoot, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "engine isolation" },
  }), "utf8");
  await writeFile(join(directory, "src", "app.vel"), `
export component App():
    state count = 0
    return <button id="go">Count: {count}</button>
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {App} from "./app.vel"

mount(<App />, "#app")
`.trimStart(), "utf8");
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(directory, "src", name), source.trimStart(), "utf8");
  }
  return directory;
}

const sharedCounter = `
const cell: Map<string, number> = Map()

export def bump():
    cell.set("n", value() + 1)

export def value() -> number:
    return cell.get("n") ?? 0
`;

test("[CLI-3] a synchronously spinning test is bounded, and the file's next test still runs", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-spin-", {
    "spin.test.vel": `
import {expect} from "velar/test"

test "A a synchronous loop that never ends":
    let total = 0
    while total >= 0:
        total += 1
    expect(total).toBe(0)

test "B a later test that never gets to run":
    expect(1).toBe(1)
`,
  });
  const started = Date.now();
  const result = await runTestsWithLimits(directory, 1_000, 2_000);
  assert.equal(result.code, 1, result.output);
  assert.ok(Date.now() - started < 60_000, "a spinning test must not hold the run open");
  assert.match(result.output, /✗ "src\/spin\.test\.vel" :: "A a synchronous loop that never ends"/u);
  assert.match(result.output, /this test did not finish within its 1000 millisecond bound/u);
  // The bound is only worth having if the run goes on: a replacement thread
  // resumes the file past the test that wedged its predecessor.
  assert.match(result.output, /✓ "src\/spin\.test\.vel" :: "B a later test that never gets to run"/u);
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

test("[CLI-4] a timed-out body stops before the next test, and its own later failure is reported", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-abandoned-", {
    "shared.vel": sharedCounter,
    "abandoned.test.vel": `
import {expect} from "velar/test"
import {bump, value} from "./shared.vel"

test "A slow test that outlives its bound":
    await Promise.sleep(300ms)
    bump()
    expect(value()).toBe(9999)

test "B later test sees a pristine counter":
    await Promise.sleep(150ms)
    expect(value()).toBe(0)
`,
  });
  const result = await runTestsWithLimits(directory, 250, 2_000);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /✗ "src\/abandoned\.test\.vel" :: "A slow test that outlives its bound"/u);
  assert.match(result.output, /this test did not finish within its 250 millisecond bound/u);
  // The race's own rejection handler used to swallow this entirely.
  assert.match(result.output, /the body of this test failed after its bound expired/u);
  assert.match(result.output, /Expected 1 to be 9999/u);
  // B is judged on its own state, not on a mutation A made after it was
  // abandoned.
  assert.match(result.output, /✓ "src\/abandoned\.test\.vel" :: "B later test sees a pristine counter"/u);
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

test("[CLI-16] a test file's verdict does not depend on which files ran before it", { timeout: 120_000 }, async () => {
  const modules = {
    "shared.vel": `
import {bump as middleBump, value as middleValue} from "./deep/middle.vel"

export def bump():
    middleBump()

export def value() -> number:
    return middleValue()
`,
    "a.test.vel": `
import {expect} from "velar/test"
import {bump, value} from "./shared.vel"

test "A mutates the shared module":
    bump()
    expect(value()).toBe(1)
`,
    "b.test.vel": `
import {expect} from "velar/test"
import {value} from "./shared.vel"

test "B expects a fresh shared module":
    expect(value()).toBe(0)
`,
  };
  const directory = await coreProject("velar-runner-isolation-", modules);
  // The mutated state is three levels down the import graph, where a
  // cache-buster on the entry cannot reach it at all.
  await mkdir(join(directory, "src", "deep"), { recursive: true });
  await writeFile(join(directory, "src", "deep", "cell.vel"), sharedCounter.trimStart(), "utf8");
  await writeFile(join(directory, "src", "deep", "middle.vel"), `
import {bump as innerBump, value as innerValue} from "./cell.vel"

export def bump():
    innerBump()

export def value() -> number:
    return innerValue()
`.trimStart(), "utf8");

  const together = await runTestsWithLimits(directory, 30_000, 5_000);
  assert.equal(together.code, 0, together.output);
  assert.match(together.stdout, /\n2 passed, 0 failed\n/u);

  // Discovery sorts, so renaming reverses the order the two files run in. A
  // self-contained file's verdict has to survive that.
  await rename(join(directory, "src", "a.test.vel"), join(directory, "src", "z.test.vel"));
  const reversed = await runTestsWithLimits(directory, 30_000, 5_000);
  assert.equal(reversed.code, 0, reversed.output);
  assert.match(reversed.stdout, /\n2 passed, 0 failed\n/u);
});

test("[CLI-18] a run that lost quiescence keeps judging the tests after it", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-quiescence-", {
    "helpers.vel": `
export async def neverEnds():
    await Promise.sleep(60s)

export async def failsLate():
    await Promise.sleep(400ms)
    throw Error("late failure owned by test B")
`,
    "a.test.vel": `
import {expect} from "velar/test"
import {neverEnds} from "./helpers.vel"

test "A leaves work that never ends":
    async neverEnds()
    expect(1).toBe(1)
`,
    "b.test.vel": `
import {expect} from "velar/test"
import {failsLate} from "./helpers.vel"

test "B starts work that fails after it returns":
    async failsLate()
    expect(1).toBe(1)
`,
  });
  const result = await runTestsWithLimits(directory, 30_000, 1_000);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /✗ "src\/a\.test\.vel" :: "A leaves work that never ends"/u);
  assert.match(result.output, /work started by this test was still running 1000 milliseconds later/u);
  // B's detached failure is real and reproducible. A latched `stuck` flag used
  // to short-circuit B's settle and print ✓ over it.
  assert.doesNotMatch(result.output, /✓ "src\/b\.test\.vel"/u);
  assert.match(result.output, /✗ "src\/b\.test\.vel" :: "B starts work that fails after it returns"/u);
  assert.match(result.output, /late failure owned by test B/u);
  assert.match(result.stdout, /\n0 passed, 2 failed\n/u);
});

test("[CLI-30] a failing test still reports the second failure it leaked", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-second-failure-", {
    "helpers.vel": `
export async def failsSoon():
    await Promise.sleep(10ms)
    throw Error("detached failure the author also needs to see")
`,
    "both.test.vel": `
import {expect} from "velar/test"
import {failsSoon} from "./helpers.vel"

test "A fails an assertion and leaks a detached failure":
    async failsSoon()
    await Promise.sleep(50ms)
    expect(1).toBe(0)
`,
  });
  const result = await runTestsWithLimits(directory, 30_000, 5_000);
  assert.equal(result.code, 1, result.output);
  const verdict = result.stderr.slice(result.stderr.indexOf("✗ \"src/both.test.vel\""));
  assert.match(verdict, /Expected 1 to be 0/u);
  // The drained reports used to be thrown away whenever the test had already
  // failed, so the author fixed the assertion and met the second failure on the
  // next run.
  assert.match(verdict, /an unowned error was reported while this test ran/u);
  assert.match(verdict, /detached failure the author also needs to see/u);
});

test("[CLI-29] every browser engine runs against its own module graph", { timeout: 600_000 }, async () => {
  const directory = await browserProject("velar-runner-engines-", {
    "store.vel": sharedCounter,
    "engine.browser.test.vel": `
import {expect} from "velar/test"
import {bump, value} from "./store.vel"

test "each engine starts from a pristine shared module":
    expect(value()).toBe(0)
    bump()
    expect(value()).toBe(1)
`,
  });

  const result = await runCommand(process.execPath, [cli, "test", directory, "--browser=all"]);
  assert.equal(result.code, 0, result.output);
  // Compiling into one shared directory left firefox and webkit importing the
  // modules chromium had already mutated, which an author reads as an engine
  // difference.
  for (const engine of ["chromium", "firefox", "webkit"]) {
    assert.match(result.output, new RegExp(`✓ ${engine} :: "src/engine\\.browser\\.test\\.vel"`, "u"));
  }
  assert.match(result.stdout, /\n3 passed, 0 failed\n/u);
});

test("[CLI-3] a test module whose failure left work behind does not hold the run open", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-load-hang-", {
    "boom.test.vel": `
import {expect} from "velar/test"
import js unsafe {value} from "boom-pkg"

test "a test that never gets to run":
    expect(value).toBe(1)
`,
    "healthy.test.vel": `
import {expect} from "velar/test"

test "a later file that still has to run":
    expect(1).toBe(1)
`,
  });
  // The thread reports the load failure and then never ends, because the module
  // armed a timer before it threw. The parent used to wait for that thread's
  // `exit` with no bound at all, which turned a terminating run into an
  // infinite one through a door the per-test bound does not cover.
  await mkdir(join(directory, "node_modules", "boom-pkg"), { recursive: true });
  await writeFile(join(directory, "node_modules", "boom-pkg", "package.json"), JSON.stringify({
    name: "boom-pkg",
    version: "1.0.0",
    type: "module",
    main: "index.js",
  }), "utf8");
  await writeFile(join(directory, "node_modules", "boom-pkg", "index.js"), [
    "export const value = 1;",
    "setInterval(() => {}, 100000);",
    'throw new Error("module initialization failed after arming a timer");',
  ].join("\n"), "utf8");

  const started = Date.now();
  const result = await runTestsWithLimits(directory, 2_000, 2_000);
  assert.equal(result.code, 1, result.output);
  assert.ok(Date.now() - started < 60_000, "a thread that cannot end must not hold the run open");
  assert.match(result.output, /✗ src\/boom\.test\.vel failed to load/u);
  assert.match(result.output, /module initialization failed after arming a timer/u);
  // The file after it is the whole point of bounding the wait.
  assert.match(result.output, /✓ "src\/healthy\.test\.vel" :: "a later file that still has to run"/u);
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

test("[CLI-3] a module error on the host channel does not hold the run open either", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-load-noisy-", {
    "noisy.test.vel": `
import {expect} from "velar/test"
import js unsafe {value} from "noisy-pkg"

test "a test that never gets to run":
    expect(value).toBe(1)
`,
    "healthy.test.vel": `
import {expect} from "velar/test"

test "a later file that still has to run":
    expect(1).toBe(1)
`,
  });
  // The neighbour one step sideways from the throwing module: the same wedged
  // thread, reached through the load path that reports on the host channel
  // instead of raising.
  await mkdir(join(directory, "node_modules", "noisy-pkg"), { recursive: true });
  await writeFile(join(directory, "node_modules", "noisy-pkg", "package.json"), JSON.stringify({
    name: "noisy-pkg",
    version: "1.0.0",
    type: "module",
    main: "index.js",
  }), "utf8");
  await writeFile(join(directory, "node_modules", "noisy-pkg", "index.js"), [
    "export const value = 1;",
    "setInterval(() => {}, 100000);",
    'console.error("a module initialization error on the host channel");',
  ].join("\n"), "utf8");

  const started = Date.now();
  const result = await runTestsWithLimits(directory, 2_000, 2_000);
  assert.equal(result.code, 1, result.output);
  assert.ok(Date.now() - started < 60_000, "a thread that cannot end must not hold the run open");
  assert.match(result.output, /✗ src\/noisy\.test\.vel reported an unowned error while loading/u);
  assert.match(result.output, /✓ "src\/healthy\.test\.vel" :: "a later file that still has to run"/u);
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

test("[CLI-18] work that outlives the whole run is reported and ends it", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-runner-run-settle-", {
    "quiet.test.vel": `
import {expect} from "velar/test"

test "a test that owns everything it starts":
    expect(1).toBe(1)
`,
  });
  // The run-level net is the last one: whatever holds this process open when
  // the last file is done is reported, and the run ends instead of hanging a
  // gate on a failure that has already been written.
  const script = join(directory, "run-tests-with-leftover.mjs");
  await writeFile(script, [
    `const { resolveVelarProject } = await import(${JSON.stringify(`file://${configModule}`)});`,
    `const { runTests } = await import(${JSON.stringify(`file://${testRunner}`)});`,
    `const config = await resolveVelarProject(${JSON.stringify(directory)});`,
    "setInterval(() => {}, 100000);",
    "await runTests(config, null, { testTimeoutMs: 30000, settleTimeoutMs: 1000 });",
  ].join("\n"), "utf8");

  const started = Date.now();
  const result = await runCommand(process.execPath, [script]);
  assert.equal(result.code, 1, result.output);
  assert.ok(Date.now() - started < 60_000, "the run-level net has to end the run");
  assert.match(result.output, /✓ "src\/quiet\.test\.vel" :: "a test that owns everything it starts"/u);
  assert.match(result.output, /work started during this run was still running 1000 milliseconds later/u);
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

test("[CLI-3] a synchronously spinning browser test is reported instead of stalling the run", { timeout: 600_000 }, async () => {
  const directory = await browserProject("velar-runner-browser-spin-", {
    "spin.browser.test.vel": `
import {expect} from "velar/test"

test "a synchronous loop that never ends":
    let total = 0
    while total >= 0:
        total += 1
    expect(total).toBe(0)
`,
  });
  // A browser test body runs in the worker process, not in the page, so the
  // worker is the process the spin wedges: it answers no timer and no signal.
  // The supervisor owns the only bound that survives it, and a run that ends
  // with no test name, no verdict and no summary is the failure this closes.
  const started = Date.now();
  const result = await runBrowserTestsWithLimits(directory, 2_000, 120_000);
  assert.equal(result.code, 1, result.output);
  assert.ok(Date.now() - started < 120_000, "a spinning browser test must not stall the run");
  assert.match(result.output, /✗ chromium :: "src\/spin\.browser\.test\.vel" :: "a synchronous loop that never ends"/u);
  assert.match(result.output, /this browser test did not finish within its 2000 millisecond bound/u);
  assert.match(result.stdout, /\n0 passed, 1 failed\n/u);
});

test("[CLI-4] a browser test body that fails after its bound expired is still reported", { timeout: 600_000 }, async () => {
  const directory = await browserProject("velar-runner-browser-late-", {
    "late.browser.test.vel": `
import {expect} from "velar/test"

test "a body that outlives its bound and then fails":
    await Promise.sleep(1500ms)
    expect(1).toBe(9999)
`,
  });
  // Nothing in this process can cancel the abandoned body, and the race's own
  // rejection handler used to swallow the failure it produced afterwards.
  const result = await runBrowserTestsWithLimits(directory, 500, 120_000);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /✗ chromium :: "src\/late\.browser\.test\.vel" :: "a body that outlives its bound and then fails"/u);
  assert.match(result.output, /did not settle within 500 milliseconds/u);
  // Nothing can cancel the abandoned body, so its failure lands after the
  // verdict was taken — which is why the report names the test it belongs to.
  assert.match(result.output, /Browser test "src\/late\.browser\.test\.vel" :: "a body that outlives its bound and then fails" failed after its bound expired/u);
  assert.match(result.output, /Expected 1 to be 9999/u);
});

test("[CLI-30] a failing browser test still reports the second failure it leaked", { timeout: 600_000 }, async () => {
  const directory = await browserProject("velar-runner-browser-second-", {
    "helpers.vel": `
export async def failsSoon():
    await Promise.sleep(10ms)
    throw Error("detached failure the author also needs to see")
`,
    "both.browser.test.vel": `
import {expect} from "velar/test"
import {failsSoon} from "./helpers.vel"

test "fails an assertion and leaks a detached failure":
    async failsSoon()
    await Promise.sleep(50ms)
    expect(1).toBe(0)
`,
  });
  const result = await runBrowserTestsWithLimits(directory, 30_000, 120_000);
  assert.equal(result.code, 1, result.output);
  const verdict = result.stderr.slice(result.stderr.indexOf('✗ chromium :: "src/both.browser.test.vel"'));
  assert.match(verdict, /Expected 1 to be 0/u);
  // The browser runner kept the Node runner's discard: a test that had already
  // failed had its host reports drained into the void, so the author fixed the
  // assertion and met the second failure on the next run.
  assert.match(verdict, /detached failure the author also needs to see/u);
});
