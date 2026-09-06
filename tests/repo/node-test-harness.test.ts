import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkoutTemporaryRoot, signalTerminationReport } from "../../scripts/run-node-tests.mjs";
import { repositoryRoot } from "../support/repository-root.ts";

/**
 * `scripts/run-node-tests.mjs` — the harness the two Node gates run through.
 *
 * Its own failure paths were the kind nothing exercised. A child killed by a
 * signal exits with no code at all, and mapping that to a bare `1` made the
 * gate print `fail 0` and exit 1: a suite reporting no failing test and failing
 * anyway, with nothing on screen to say why. And the fixed directory names
 * under `os.tmpdir()` that 98 test files carry are one path for the whole
 * machine, so two checkouts running their suites together deleted each other's
 * fixtures.
 *
 * Both are checked here by pointing the runner at a fixture suite, which is why
 * it takes a directory: a harness whose failure path cannot be run is a harness
 * whose failure path is a guess.
 */

const runner = join(repositoryRoot, "scripts", "run-node-tests.mjs");

async function fixtureSuite(files: Readonly<Record<string, string>>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-test-harness-"));
  for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source, "utf8");
  return directory;
}

/**
 * `NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID` are how a `node --test` child
 * knows it is one; a nested run that inherits them refuses to run any file at
 * all ("run() is being called recursively") and exits 0, which would make every
 * case below pass while proving nothing. So the fixture run is given the
 * environment of a plain shell.
 */
function outsideTheTestRunner(environment: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const outside: NodeJS.ProcessEnv = { ...process.env, ...environment };
  delete outside.NODE_TEST_CONTEXT;
  delete outside.NODE_TEST_WORKER_ID;
  return outside;
}

function runSuite(directory: string, environment: Readonly<Record<string, string>> = {}) {
  return spawnSync(process.execPath, [runner, "quick", directory], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: outsideTheTestRunner(environment),
  });
}

test("a test child killed by a signal is reported as killed rather than as a failing test", async (context) => {
  // SIGKILL, not SIGTERM: the Node test runner installs its own SIGTERM
  // handler, prints "Interrupted while running:" and exits 1 with a code — so a
  // catchable signal never reaches the state this report exists for. What the
  // harness saw in the wild was `code === null`, and only an uncatchable signal
  // produces it.
  const directory = await fixtureSuite({
    "a-passing.test.ts":
      'import test from "node:test";\n'
      + 'test("one", () => {});\n'
      + 'test("two", () => {});\n',
    "b-killer.test.ts":
      'import { setTimeout as delay } from "node:timers/promises";\n'
      + 'import test from "node:test";\n'
      + 'test("kills the runner it is running under", async () => {\n'
      + '  await delay(300);\n'
      + '  process.kill(process.ppid, "SIGKILL");\n'
      + '  await delay(30_000);\n'
      + '});\n',
  });
  context.after(() => rm(directory, { recursive: true, force: true }));

  const killed = runSuite(directory);
  assert.equal(killed.status, 1, killed.stdout);
  assert.match(
    killed.stderr,
    /the test child was terminated by signal SIGKILL after \d+ tests, while running /u,
    `${killed.stdout}\n${killed.stderr}`,
  );
  // The two tests of the first file finished before the kill, and the file the
  // run had reached is the one that killed it — the two things a reader needs
  // and neither of which `fail 0` carried.
  assert.match(killed.stderr, /after 2 tests/u, killed.stderr);
  assert.match(killed.stderr, /b-killer\.test\.ts$/mu, killed.stderr);
});

test("an ordinary failure still exits with the child's own code and says nothing about signals", async (context) => {
  const directory = await fixtureSuite({
    "a-failing.test.ts":
      'import assert from "node:assert/strict";\n'
      + 'import test from "node:test";\n'
      + 'test("fails", () => { assert.equal(1, 2); });\n',
  });
  context.after(() => rm(directory, { recursive: true, force: true }));

  const failed = runSuite(directory);
  assert.equal(failed.status, 1);
  assert.doesNotMatch(failed.stderr, /terminated by signal/u);
  assert.match(failed.stdout, /fail 1/u, failed.stdout);
});

test("the suite runs in a temporary area this checkout owns, and a Desktop app-data root of its own", async (context) => {
  const directory = await fixtureSuite({
    "a-environment.test.ts":
      'import assert from "node:assert/strict";\n'
      + 'import { tmpdir } from "node:os";\n'
      + 'import test from "node:test";\n'
      + 'test("the run was handed its own roots", () => {\n'
      + '  assert.equal(tmpdir(), process.env.VELAR_EXPECTED_TEMPORARY_ROOT);\n'
      + '  assert.equal(typeof process.env.VELAR_DESKTOP_APP_DATA_ROOT, "string");\n'
      + '  assert.notEqual(process.env.VELAR_DESKTOP_APP_DATA_ROOT, "");\n'
      + '});\n',
  });
  context.after(() => rm(directory, { recursive: true, force: true }));

  const run = runSuite(directory, { VELAR_EXPECTED_TEMPORARY_ROOT: checkoutTemporaryRoot(repositoryRoot) });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

  // Derived from the checkout, so a second worktree of this repository never
  // shares it — which is the whole point, since `gate-lock.mjs` serializes
  // gates inside one checkout and deliberately cannot see another.
  assert.equal(checkoutTemporaryRoot("/one/checkout"), checkoutTemporaryRoot("/one/checkout"));
  assert.notEqual(checkoutTemporaryRoot("/one/checkout"), checkoutTemporaryRoot("/another/checkout"));
  assert.ok(checkoutTemporaryRoot("/one/checkout").startsWith(join(tmpdir(), "velar-tests-")));
});

test("the signal report names the signal, the count, and the file, and degrades to what it knows", () => {
  assert.equal(
    signalTerminationReport("SIGKILL", { completed: 412, file: join(repositoryRoot, "tests", "compiler", "analysis", "collections.test.ts") }, repositoryRoot),
    "the test child was terminated by signal SIGKILL after 412 tests, while running tests/compiler/analysis/collections.test.ts",
  );
  // A run killed before its first result knows only the signal, and says so
  // rather than inventing a file or a count.
  assert.equal(
    signalTerminationReport("SIGABRT", { completed: 0, file: null }, repositoryRoot),
    "the test child was terminated by signal SIGABRT after 0 tests",
  );
  assert.equal(
    signalTerminationReport("SIGKILL", { completed: 1, file: null }, repositoryRoot),
    "the test child was terminated by signal SIGKILL after 1 test",
  );
});
