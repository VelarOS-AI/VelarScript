import assert from "node:assert/strict";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { uncaughtProgramEntrySource } from "../../packages/cli/src/uncaught-program-error.ts";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * D114 P6 item A: `velar run` cannot exit 0 with `@main` unfinished.
 *
 * Under CPU contention a program that awaited `run(...)` printed its first line
 * and then exited cleanly with status 0, empty stderr, and the rest of `@main`
 * never run — a success that had not happened. The accounting behind it: the
 * `velar/process` Worker was unref'd the moment it reported ready and never
 * ref'd again, so an in-flight call was held only by the MessagePort, the
 * readiness handshake was held by nothing that function knew about, and a loop
 * with nothing of this module's in it drains. `velar run` enters the program
 * through a launcher that does not await the entry
 * (`packages/cli/src/uncaught-program-error.ts`), so a drained loop is not the
 * exit-13 "unsettled top-level await" Node reports for a main module — it is
 * exit 0. That is why the failure was silent, and it is why this test drives
 * the program through that same launcher rather than through `node main.js`.
 */

const program = `
import {run} from "velar/process"

async def legal(label: string):
    const outcome = await run("/bin/echo", [label])
    print(f"{label}: {Json.stringify(outcome.stdout)}")

@main:
    print("entering main")
    await legal("first")
    try:
        const outcome = await run("/no/such/velar/binary", [])
        print(f"missing: ran code={outcome.code ?? -1}")
    catch failure:
        print(f"missing: {failure.message}")
    await legal("after-missing")
    print("main completed")
`;

/** Busy children that keep every core occupied for the duration of one test. */
function contention(): { stop(): void } {
  const spinners = Math.max(2, Math.min(8, availableParallelism()));
  const children = Array.from({ length: spinners }, () => spawn(
    process.execPath,
    ["-e", "const end = Date.now() + 120000; while (Date.now() < end) { Math.sqrt(Math.random()); }"],
    { stdio: "ignore" },
  ));
  return { stop: () => { for (const child of children) child.kill("SIGKILL"); } };
}

test("a program that awaits run() completes every time under CPU contention", async (t) => {
  if (process.platform === "win32") return;
  const built = await runVelarProject({ "src/main.vel": program.trimStart() }, {
    command: "build",
    extraArguments: ["--mode", "readable"],
    keep: true,
    prefix: "velar-run-completion-",
  });
  const elsewhere = await mkdtemp(join(tmpdir(), "velar-run-completion-cwd-"));
  const busy = contention();
  t.after(() => { busy.stop(); });
  try {
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    // The launcher `velar run` writes, byte for byte, so this exercises the
    // exact shape in which the missing reference was invisible.
    const launcher = join(built.root, "dist", ".velar-run-entry.mjs");
    await writeFile(launcher, uncaughtProgramEntrySource({
      entryUrl: pathToFileURL(join(built.root, "dist", "main.js")).href,
      sourcePath: join(built.root, "src", "main.vel"),
      fullStack: false,
    }), "utf8");

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const result = spawnSync(process.execPath, [launcher], { encoding: "utf8", cwd: elsewhere, timeout: 60_000 });
      const report = `attempt ${attempt}: status=${result.status} signal=${result.signal}\n${result.stdout}\n${result.stderr}`;
      assert.equal(result.status, 0, report);
      // "Exited 0" is not the claim; "ran to the end" is. A truncated stdout
      // with status 0 is exactly the failure this test exists for.
      assert.match(result.stdout, /^entering main$/mu, report);
      assert.match(result.stdout, /^first: "first\\n"$/mu, report);
      assert.match(result.stdout, /^missing: Process could not start '\/no\/such\/velar\/binary'/mu, report);
      assert.match(result.stdout, /^after-missing: "after-missing\\n"$/mu, report);
      assert.match(result.stdout, /^main completed$/mu, report);
    }
  } finally {
    await rm(built.root, { recursive: true, force: true });
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test("a @main that throws after an awaited call exits non-zero and names the failure", async () => {
  if (process.platform === "win32") return;
  const run = await runVelarProject({
    "src/main.vel": `
import {run} from "velar/process"

@main:
    print("entering main")
    const outcome = await run("/bin/echo", ["hello"])
    print(f"code={outcome.code ?? -1}")
    throw Error("the program failed after its awaited call")
`.trimStart(),
  }, { prefix: "velar-run-throws-" });
  assert.notEqual(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^entering main$/mu);
  assert.match(run.stdout, /^code=0$/mu);
  assert.match(run.stderr, /the program failed after its awaited call/u);
});

test("velar run reports the whole program, not only its first line", async () => {
  if (process.platform === "win32") return;
  const run = await runVelarProject({ "src/main.vel": program.trimStart() }, { prefix: "velar-run-whole-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^main completed$/mu);
});

/**
 * D114 F7-node-b item 1: the launcher half of the same failure.
 *
 * Fixing the reference accounting removed the reason the loop drained; it did
 * not remove the *silence*. Any future drain — a Worker that lets go of its
 * last reference, a promise nobody holds — would still reach the author as a
 * clean exit 0 with stdout stopping mid-program, because a dynamically
 * imported entry is outside Node's exit-13 rule for an unsettled top-level
 * await. So the launcher holds the entry's promise and reads it at
 * `beforeExit`, and this probe is that shape in its smallest honest form: the
 * settlement is deferred behind an unref'd timer, which is exactly what a
 * dropped reference does — the loop has nothing of the program's left in it and
 * drains before the value ever arrives.
 */
const deferredSettlement = [
  'process.stdout.write("entering main\\n");',
  // Unref'd: the loop stops counting this, drains, and the promise never settles.
  "await new Promise((settle) => { setTimeout(settle, 30_000).unref(); });",
  'process.stdout.write("main completed\\n");',
  "",
].join("\n");

/** Runs `body` as the entry of the launcher `velar run` writes, byte for byte. */
async function throughLauncher(body: string, fullStack = false): Promise<SpawnSyncReturns<string>> {
  const root = await mkdtemp(join(tmpdir(), "velar-run-launcher-"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n', "utf8");
  const entry = join(root, "entry.mjs");
  await writeFile(entry, body, "utf8");
  const launcher = join(root, ".velar-run-entry.mjs");
  await writeFile(launcher, uncaughtProgramEntrySource({
    entryUrl: pathToFileURL(entry).href,
    sourcePath: join(root, "src", "main.vel"),
    fullStack,
  }), "utf8");
  try {
    return spawnSync(process.execPath, [launcher], { encoding: "utf8", timeout: 60_000 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("an entry whose @main never finishes is named and exits non-zero", async () => {
  if (process.platform === "win32") return;
  const result = await throughLauncher(deferredSettlement);
  const report = `status=${result.status} signal=${result.signal}\n${result.stdout}\n${result.stderr}`;
  // 13 is Node's own code for an unsettled top-level await: the same program
  // run as a main module already ends this way, and now so does `velar run`.
  assert.equal(result.status, 13, report);
  assert.match(result.stdout, /^entering main$/mu, report);
  assert.equal(/^main completed$/mu.test(result.stdout), false, report);
  assert.match(
    result.stderr,
    /^velar run: the program's @main did not finish: the event loop drained while an awaited value never settled$/mu,
    report,
  );
  // The frames are hidden rather than absent, exactly as the uncaught report
  // hides them, so the flag that shows one shows the other.
  assert.match(result.stderr, /frames? outside your program hidden; rerun with 'velar run --stack'/u, report);
});

test("velar run --stack shows the frames of the drain that ended the program", async () => {
  if (process.platform === "win32") return;
  const result = await throughLauncher(deferredSettlement, true);
  const report = `status=${result.status}\n${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 13, report);
  assert.match(result.stderr, /^velar run: the program's @main did not finish: /mu, report);
  assert.match(result.stderr, /^\s+at .*node:/mu, report);
  assert.equal(/frames? hidden/u.test(result.stderr), false, report);
});

test("a program that finishes, one that throws, and one that exits are unchanged", async () => {
  if (process.platform === "win32") return;
  const finished = await throughLauncher('process.stdout.write("main completed\\n");\n');
  assert.equal(finished.status, 0, `${finished.stdout}\n${finished.stderr}`);
  assert.equal(finished.stderr, "");

  // An entry that rejects is still the uncaught report, with its own header.
  const threw = await throughLauncher('throw new Error("the entry failed");\n');
  assert.equal(threw.status, 1, `${threw.stdout}\n${threw.stderr}`);
  assert.match(threw.stderr, /^velar run: uncaught error while running .*main\.vel$/mu, threw.stderr);
  assert.match(threw.stderr, /^Error: the entry failed$/mu, threw.stderr);
  assert.equal(/did not finish/u.test(threw.stderr), false, threw.stderr);

  // A program that ends through its own exit never reaches `beforeExit`, so an
  // entry left unsettled by that exit is not a report and not a changed code.
  const exited = await throughLauncher('process.stdout.write("bye\\n"); process.exit(7); await new Promise(() => {});\n');
  assert.equal(exited.status, 7, `${exited.stdout}\n${exited.stderr}`);
  assert.equal(exited.stderr, "");
});
