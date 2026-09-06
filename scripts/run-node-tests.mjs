import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = join(root, "tests");
const nodeAcceptanceFiles = new Set(["ci.acceptance.ts", "release.acceptance.ts"]);
const progressReporter = pathToFileURL(join(root, "scripts", "test-progress-reporter.mjs")).href;

/**
 * The temporary area this checkout's suite owns.
 *
 * `gate-lock.mjs` runs one gate at a time *per checkout*, and deliberately
 * cannot see another checkout — separate worktrees are meant to run in
 * parallel. But 98 test files name a fixed directory under `os.tmpdir()`
 * (`velar-marathon-core-tests`, `velar-cli-project-graph-tests`, …) and delete
 * it on the way in, and `os.tmpdir()` is one path for the whole machine. So two
 * worktrees running their suites together were deleting each other's fixtures,
 * and the failures that produced were about nothing.
 *
 * Redirecting `TMPDIR` for the run moves every one of those names at once,
 * without 98 edits and without any file having to remember. The name is derived
 * from the checkout, so the same worktree reuses the same area and a different
 * one never collides. `TMP` and `TEMP` are set too because that is what
 * `os.tmpdir()` reads on Windows.
 */
export function checkoutTemporaryRoot(checkout = root) {
  // Resolved first, so a caller that spells the checkout with a trailing
  // separator names the same area as one that does not.
  const key = createHash("sha256").update(resolve(checkout)).digest("hex").slice(0, 12);
  return join(tmpdir(), `velar-tests-${key}`);
}

/**
 * The quick suite is every test that is not slow; the full suite is every test.
 *
 * D115 P5 retired the rule this used to carry — "a file whose name starts with
 * `hardening-` waits for `test:full`" — along with the names it read. History is
 * not a property of a test: those 147 files pinned live behaviour, and 60.7% of
 * the suite sat out every gate because of when it was written. What a gate may
 * defer is a test that is *slow*, and that is now written where it cannot drift
 * from the list: in the file's own name.
 */
export const SLOW_SUFFIX = ".slow.test.ts";

export async function nodeTestFiles(directory, mode) {
  if (mode !== "quick" && mode !== "full") throw new Error(`unknown Node test mode '${mode}'`);
  const found = [];
  await collectNodeTests(directory, directory, found);
  const names = found.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (mode === "full") return names.map((name) => join(directory, name));
  return names.filter((name) => !basename(name).endsWith(SLOW_SUFFIX)).map((name) => join(directory, name));
}

/**
 * Every runnable file under `tests/`, at any depth, as a path relative to it.
 *
 * D115 P5 put the tests in `tests/<owner>/`, so discovery walks rather than
 * lists. `fixtures/` and `corpus/` are inputs to tests, never tests — a `.vel`
 * corpus file is not a `.test.ts`, but a fixture project may carry TypeScript,
 * and reading one as a test would run somebody's example.
 */
async function collectNodeTests(base, directory, found) {
  for (const entry of (await readdir(directory, { withFileTypes: true }))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "fixtures" || entry.name === "corpus" || entry.name === "node_modules" || entry.name === ".velar") continue;
      await collectNodeTests(base, path, found);
    } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || nodeAcceptanceFiles.has(entry.name))) {
      found.push(relative(base, path).replaceAll("\\", "/"));
    }
  }
}

/**
 * How far the run had got, read back from what
 * `scripts/test-progress-reporter.mjs` appended. A run killed before its first
 * result leaves nothing, which is itself the answer: no tests finished.
 */
export async function nodeTestProgress(path) {
  const recorded = await readFile(path, "utf8").catch(() => "");
  const last = recorded.trimEnd().split("\n").at(-1) ?? "";
  const separator = last.indexOf(" ");
  if (separator === -1) return { completed: 0, file: null };
  const completed = Number.parseInt(last.slice(0, separator), 10);
  const file = last.slice(separator + 1);
  return { completed: Number.isInteger(completed) ? completed : 0, file: file === "" ? null : file };
}

/**
 * What to say about a child that never reached an exit code. A process killed
 * by a signal reports `code === null`, and mapping that to a bare 1 made a
 * killed run indistinguishable from a run with a failing test: the suite
 * printed `fail 0` and the gate exited 1, sending the reader to look for a
 * failure that does not exist.
 */
export function signalTerminationReport(signal, progress, from = root) {
  const tests = `${progress.completed} test${progress.completed === 1 ? "" : "s"}`;
  const where = progress.file === null ? "" : `, while running ${relative(from, progress.file)}`;
  return `the test child was terminated by signal ${signal} after ${tests}${where}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  // The directory is an argument so this runner can be pointed at a fixture
  // suite and watched: a harness whose own failure path cannot be exercised is
  // a harness whose failure path is a guess.
  const directory = process.argv[3] === undefined ? testDirectory : resolve(process.argv[3]);
  if (mode !== "quick" && mode !== "full") {
    process.stderr.write("Usage: run-node-tests.mjs <quick|full> [test-directory]\n");
    process.exit(2);
  }
  const files = await nodeTestFiles(directory, mode);
  if (files.length === 0) throw new Error(`the ${mode} Node test suite discovered no files`);
  const all = await nodeTestFiles(directory, "full");
  const deferred = all.length - files.length;
  process.stdout.write(
    `Running ${mode} Node suite: ${files.length} files${deferred > 0 ? `, ${deferred} ${SLOW_SUFFIX} files reserved for test:full` : ""}\n`,
  );
  const temporaryRoot = checkoutTemporaryRoot();
  // Beside the temporary area rather than inside it, because the Desktop host
  // creates and deletes whole trees under this root and a fixture directory
  // caught in one of them would vanish mid-test.
  const desktopAppData = `${temporaryRoot}-desktop`;
  await mkdir(temporaryRoot, { recursive: true });
  await mkdir(desktopAppData, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "velar-node-tests-"));
  const progressPath = join(scratch, "progress.txt");
  try {
    const child = spawn(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "--test-timeout=120000",
      // Naming a reporter replaces the default, so the default is named too:
      // `spec` is what this suite has always printed, to a terminal and to a
      // log alike. The progress reporter writes nothing to its destination.
      "--test-reporter=spec",
      "--test-reporter-destination=stdout",
      `--test-reporter=${progressReporter}`,
      "--test-reporter-destination=stdout",
      ...files,
    ], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        TMPDIR: temporaryRoot,
        TMP: temporaryRoot,
        TEMP: temporaryRoot,
        // The Desktop host's application-support root, which is otherwise the
        // machine's one Application Support directory — shared by every
        // checkout, and deleted and re-counted by the service-supervisor cases.
        VELAR_DESKTOP_APP_DATA_ROOT: desktopAppData,
        VELAR_TEST_PROGRESS: progressPath,
      },
    });
    const [code, signal] = await new Promise((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", (exitCode, exitSignal) => resolveExit([exitCode, exitSignal]));
    });
    if (signal !== null && signal !== undefined) {
      process.stderr.write(`${signalTerminationReport(signal, await nodeTestProgress(progressPath))}\n`);
      process.exitCode = 1;
    } else {
      process.exitCode = code ?? 1;
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
