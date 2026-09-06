import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  browserCleanupTimeoutMs,
  browserRunDeadlineMs,
  superviseBrowserWorker,
} from "../packages/cli/src/browser-process-owner.ts";
import { velarProjects, velarSources } from "./velar-projects.mjs";

/**
 * D61 rule 156 — `velar check` and `velar test` over every example project,
 * discovered rather than listed.
 *
 * `gate:test` and `gate:test:browser` used to name four projects each. That is
 * the D57 rule 134 family: a list with an authoritative source kept by hand. It
 * never fails, it just cannot see new members — `examples/app` was gated by
 * nothing at all while carrying twenty-one tests, because nobody edited those
 * two lines when it was written.
 *
 * So the list is gone rather than corrected. What runs is decided here:
 *
 *   unit     every project with a `*.test.vel` module that is not a browser
 *            test runs `velar test`. The separate source-quality gate checks
 *            every project once, so the release chain does not compile them
 *            again here before running their tests.
 *   browser  every project with a `*.browser.test.vel` module runs
 *            `velar test --browser chromium`.
 *
 * A project that genuinely must be skipped goes in `excluded` below with its
 * reason: an exclusion is visible in this file and in the gate's own output,
 * while a project missing from a list is visible nowhere.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages", "cli", "dist", "cli.js");

/** Projects deliberately not gated, each with the reason it is not. */
const excluded = new Map([
  // Empty on purpose. Add `["examples/<name>", "why"]`, never a silent removal.
]);

const mode = process.argv[2];
if (mode !== "unit" && mode !== "browser") {
  console.error("Usage: run-project-gate.mjs <unit|browser>");
  process.exit(2);
}

const discovered = await velarProjects(join(root, "examples"));
if (discovered.length === 0) {
  console.error("No VelarScript example projects were found; this gate cannot pass vacuously.");
  process.exit(1);
}

const failures = [];
const ran = [];
const skipped = [];
const executed = new Set();

/**
 * A project runs in a process group of its own, so a Ctrl-C at the terminal no
 * longer reaches it on the way past — the supervisor forwards it instead, and
 * then hands this loop an exit code. An interrupt has to end the gate rather
 * than move it on to the next project, and a code at or above 128 is a run
 * that ended on a signal: `velar test` itself answers with 0, 1 or 2.
 */
let interruptedBy = null;

for (const project of discovered) {
  const name = relative(root, project);
  const reason = excluded.get(name);
  if (reason !== undefined) {
    skipped.push(`${name}: excluded — ${reason}`);
    continue;
  }
  const sources = await velarSources(project);
  const browserTests = sources.filter((file) => basename(file).endsWith(".browser.test.vel"));
  const unitTests = sources.filter((file) => basename(file).endsWith(".test.vel") && !basename(file).endsWith(".browser.test.vel"));

  if (mode === "unit") {
    if (unitTests.length === 0) {
      skipped.push(`${name}: no unit tests to run`);
      continue;
    }
    executed.add(name);
    const tested = await velar(["test", project]);
    if (tested.status >= 128) interruptedBy = tested.status;
    if (tested.status !== 0) failures.push(`${name}: velar test failed\n${indent(tested.output)}`);
    else ran.push(`${name}: ${summarize(tested.output)}`);
    if (interruptedBy !== null) break;
    continue;
  }

  if (browserTests.length === 0) {
    skipped.push(`${name}: no browser tests to run`);
    continue;
  }
  executed.add(name);
  const tested = await velar(["test", project, "--browser", "chromium"]);
  if (tested.status >= 128) interruptedBy = tested.status;
  if (tested.status !== 0) failures.push(`${name}: velar test --browser chromium failed\n${indent(tested.output)}`);
  else ran.push(`${name}: ${summarize(tested.output)}`);
  if (interruptedBy !== null) break;
}

for (const line of ran) console.log(`  ${line}`);
for (const line of skipped) console.log(`  ${line}`);

if (interruptedBy !== null) {
  console.error(`The ${mode} gate was interrupted after ${executed.size} of ${discovered.length} discovered VelarScript example projects:\n\n${failures.join("\n\n")}`);
  process.exitCode = interruptedBy;
} else if (failures.length > 0) {
  console.error(`VelarScript example projects that failed the ${mode} gate:\n\n${failures.join("\n\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Ran the ${mode} gate over ${executed.size} of ${discovered.length} discovered VelarScript example projects`);
}

/**
 * Runs one project's `velar` command as a process group this gate owns.
 *
 * This used to be a `spawnSync`, which owns nothing: no process group, so a
 * `velar test --browser` that forks a worker and launches a Chromium leaves
 * both behind; no deadline, so a wedged run holds the gate open for as long as
 * the machine is up; and no IPC channel, which is the one way the child had of
 * learning that this script was killed. A gate killed mid-run left a
 * supervisor, a worker and a browser running with nothing left to report to.
 *
 * `superviseBrowserWorker` is the supervisor this repository already has, so
 * the gate borrows it rather than growing a second one: it spawns detached on
 * POSIX, forwards SIGHUP/SIGINT/SIGTERM to the whole group, kills the group
 * after the cleanup allowance if the group ignores the signal, ends the run on
 * the shared deadline, and kills the group from a `process.on("exit")` net for
 * the signals nothing handled. The channel is left off because `velar` passes
 * its environment to children of its own, and `NODE_CHANNEL_FD` names a
 * descriptor that is not theirs.
 */
async function velar(arguments_) {
  let output = "";
  const status = await superviseBrowserWorker({
    executable: process.execPath,
    arguments: [cli, ...arguments_],
    cwd: root,
    environment: process.env,
    deadlineMs: browserRunDeadlineMs,
    cleanupTimeoutMs: browserCleanupTimeoutMs,
    ipc: false,
    onOutput: (chunk) => { output += chunk; },
  });
  return { status, output: output.trimEnd() };
}

function summarize(output) {
  const totals = output.split("\n").filter((line) => /^\d+ passed, \d+ failed$/u.test(line.trim()));
  return totals.at(-1)?.trim() ?? "completed";
}

function indent(text) {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}
