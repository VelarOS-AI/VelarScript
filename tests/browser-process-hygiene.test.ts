import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { browserStopGraceMs, superviseBrowserWorker } from "../packages/cli/src/browser-process-owner.ts";
import { parentDeathPollIntervalMs } from "../packages/cli/src/process-lifetime.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

/**
 * Nothing this repository starts outlives whoever started it.
 *
 * A browser gate leaves a supervisor, a worker, a preview server and a
 * Chromium with four helpers running at once, in three process groups, and it
 * is killed by hand often — a Ctrl-C, a closed terminal, an editor that ends
 * its task. Every one of those is a launcher going away without saying so, and
 * the answer used to be the IPC `disconnect` event alone: exactly right when
 * there was a channel, and blind when `scripts/run-project-gate.mjs` spawned
 * `velar test` through `spawnSync`, which has none. A gate killed mid-run left
 * a supervisor and a worker holding a browser for as long as the machine
 * stayed up.
 *
 * Asserting that requires naming the processes a launch produced, and the
 * names are not in the command lines: three of them are the same `node
 * packages/cli/dist/cli.js test …`. So each launch gets a marker in its
 * environment, which every descendant inherits and neither `ps` nor `/proc`
 * can lose — `ps -E` reads the environment of the caller's own processes on
 * macOS, `/proc/<pid>/environ` does on Linux — and the assertion is simply
 * that no process carries the marker any more.
 */
const markerVariable = "VELAR_PROCESS_HYGIENE_MARKER";
const execFileAsync = promisify(execFile);
const root = resolve(".");
const cli = resolve("packages/cli/dist/cli.js");
const issuedMarkers: string[] = [];

/**
 * How long a killed tree is given to be gone.
 *
 * This was fifteen seconds written down three times, and fifteen seconds was
 * under the ladder it was asserting: a hosted four-core runner took nineteen —
 * up to a second for the reparenting poll to notice the launcher, the
 * supervisor's stop grace for the group to answer, and a second or two more for
 * the browser Playwright holds on a pipe to see that pipe close. The suite was
 * green on a developer's machine and red on Linux for no reason but that.
 *
 * So the window is the ladder itself, imported from the two files that own its
 * rungs, times three — the machine that has to pass this is running the rest of
 * the Node suite beside it. A number that cannot say which bound it is derived
 * from is a number that will be wrong again on the next machine.
 */
const markedTreeEndsWithinMs = 3 * (parentDeathPollIntervalMs + browserStopGraceMs + 2_000);

after(removeTemporaryDirectories);
// A failing assertion must not be the reason a machine keeps a browser: the
// suite reclaims every tree it started, whatever the verdict was.
after(async () => {
  for (const marker of issuedMarkers.splice(0)) {
    for (const pid of await markedProcesses(marker)) {
      try { process.kill(pid, "SIGKILL"); }
      catch {}
    }
  }
});

test("a browser gate whose launcher is killed leaves nothing behind", {
  skip: process.platform === "win32",
}, async () => {
  const marker = issueMarker();
  const launcher = launch(marker, "node scripts/run-project-gate.mjs browser; echo gate-done");
  try {
    await waitForBrowser(marker, launcher, 60_000);
    launcher.child.kill("SIGKILL");
    // The gate script is the supervisor of whichever project it is running, so
    // it inherits the watch: its own launcher going away ends the project's
    // process group and then the gate. Killed between two projects it instead
    // finishes the ones it was given, which is why the bound here covers a
    // whole gate rather than one teardown. Either way what is asserted is the
    // same — three process groups, one of them Playwright's and unreachable
    // from the others by any group signal, and none of them left.
    await assertMarkedTreeEnds(marker, 60_000, launcher);
  } finally {
    endLaunch(launcher);
  }
});

test("a browser acceptance whose launcher is killed ends on its own", {
  skip: process.platform === "win32",
}, async () => {
  const marker = issueMarker();
  const launcher = launch(marker, "node tests/browser.acceptance.ts; echo acceptance-done");
  try {
    await waitForBrowser(marker, launcher, 60_000);
    launcher.child.kill("SIGKILL");
    await assertMarkedTreeEnds(marker, markedTreeEndsWithinMs, launcher);
  } finally {
    endLaunch(launcher);
  }
});

test("a killed gate script takes its browser-test supervisor, worker and browser with it", {
  skip: process.platform === "win32",
}, async () => {
  const marker = issueMarker();
  const launcher = launch(marker, "node scripts/run-project-gate.mjs browser; echo gate-done");
  try {
    const running = await waitForBrowser(marker, launcher, 60_000);
    // The shell carries the whole command as its own argument, so the gate
    // script's name is in two command lines and the first of them is the
    // launcher this test is not about: matching on the name alone killed the
    // shell and quietly made this a second copy of the test above. The gate
    // script is the shell's own child, and that is what tells the two apart.
    const gate = running.find((record) =>
      record.parent === launcher.child.pid && record.command.includes("run-project-gate.mjs"));
    assert.ok(gate, `the gate script was not among the marked processes\n${describe(running)}`);
    process.kill(gate.pid, "SIGKILL");
    await assertMarkedTreeEnds(marker, markedTreeEndsWithinMs, launcher);
  } finally {
    endLaunch(launcher);
  }
});

test("a browser test run whose output nobody reads any more ends as an interrupted run", {
  skip: process.platform === "win32",
}, async () => {
  const steps = Array.from({ length: 12 }, (_unused, index) => `test "step ${index + 1}":\n    await Promise.sleep(400ms)\n`);
  const project = await browserFixture("Unread output probe", steps.join("\n"));
  const child = spawn(process.execPath, [cli, "test", project, "--browser=chromium"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  try {
    // Destroying the readable end is a reader leaving without closing the run
    // down: the next line the worker writes fails with EPIPE, and a process
    // whose output reaches nobody has no reason to hold a browser open.
    await new Promise<void>((resolveFirstLine, reject) => {
      child.stdout?.once("data", () => resolveFirstLine());
      child.once("error", reject);
      child.once("exit", () => reject(new Error(`the run ended before it wrote anything\n${stderr}`)));
    });
    child.stdout?.destroy();
    const exit = await waitForExit(child, 30_000);
    assert.equal(exit.signal, null, stderr);
    assert.equal(exit.code, 143, `a run nobody is reading must end as an interrupted run\n${stderr}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

test("a browser test run with no channel and no reader still ends with its launcher", {
  skip: process.platform === "win32",
}, async () => {
  const project = await browserFixture("never settles", 'test "never settles":\n    await Promise.sleep(60000ms)\n');
  const marker = issueMarker();
  // Discarded output and a plain shell between: no IPC channel to disconnect,
  // no reader to fail a write to, and a test body that would hold the run for a
  // minute. Reparenting is the only news left, and it is the news a `spawnSync`
  // launcher gives — the shape `scripts/run-project-gate.mjs` used to have.
  const launcher = launch(marker, `node ${JSON.stringify(cli)} test ${JSON.stringify(project)} --browser=chromium > /dev/null 2>&1; echo run-done`);
  try {
    await waitForBrowser(marker, launcher, 60_000);
    launcher.child.kill("SIGKILL");
    await assertMarkedTreeEnds(marker, markedTreeEndsWithinMs, launcher);
  } finally {
    endLaunch(launcher);
  }
});

test("a supervisor ends a worker that ignores every signal it is sent", {
  skip: process.platform === "win32",
}, async () => {
  const marker = issueMarker();
  const stubborn = [
    'for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {});',
    "setInterval(() => {}, 1000);",
  ].join(" ");
  const startedAt = Date.now();
  const code = await superviseBrowserWorker({
    executable: process.execPath,
    arguments: ["-e", stubborn],
    cwd: root,
    environment: { ...process.env, [markerVariable]: marker },
    deadlineMs: 2_000,
    cleanupTimeoutMs: 1_000,
  });
  assert.equal(code, 143, "a worker ended by the deadline reports the signal that ended it");
  assert.ok(Date.now() - startedAt < 30_000, "the forced cleanup must not wait for the aggregate deadline");
  await assertMarkedTreeEnds(marker, markedTreeEndsWithinMs);
});

/**
 * What each probe reads back about one marked process.
 *
 * The pid alone was what this suite reported when it failed, and a list of four
 * pids is not a diagnosis: it does not say which of them is the launcher's own
 * child, whether the tree was draining or standing still, or whether a survivor
 * is a live process at all. The parent, the group and the state are what turn
 * the failure into the answer, and they cost one more `ps` column and one more
 * `/proc` file.
 */
interface MarkedProcess {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  /** The first letter of the kernel's state — `Z` for a process already dead. */
  readonly state: string;
  readonly command: string;
}

interface Launch {
  readonly child: ChildProcess;
  output: string;
}

function issueMarker(): string {
  const marker = `velar-hygiene-${process.pid}-${randomUUID()}`;
  issuedMarkers.push(marker);
  return marker;
}

/**
 * Starts a command under a throwaway shell that can be killed on its own. The
 * trailing `echo` matters: `sh -c` with a single command replaces itself with
 * that command, and then there is no launcher to kill.
 */
function launch(marker: string, command: string): Launch {
  const child = spawn("/bin/sh", ["-c", command], {
    cwd: root,
    env: { ...process.env, [markerVariable]: marker },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const launched: Launch = { child, output: "" };
  child.stdout?.on("data", (chunk: Buffer) => { launched.output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { launched.output += chunk.toString("utf8"); });
  return launched;
}

function endLaunch(launched: Launch): void {
  if (launched.child.exitCode === null && launched.child.signalCode === null) launched.child.kill("SIGKILL");
}

/**
 * Waits until a real browser binary is running under the marker, so that a
 * launch which never got that far cannot pass this suite by leaving nothing
 * behind for the reason that it started nothing.
 */
async function waitForBrowser(marker: string, launched: Launch, timeoutMs: number): Promise<readonly MarkedProcess[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = await markedProcessRecords(marker);
    if (running.some((record) => isPlaywrightBrowser(record.command))) return running;
    if (launched.child.exitCode !== null || launched.child.signalCode !== null) break;
    await delay(200);
  }
  assert.fail(`no browser started under ${marker} within ${timeoutMs} milliseconds\n${launched.output}`);
}

/**
 * Waits for every marked process to be gone, and says how the wait went when
 * they are not.
 *
 * A tree comes down a rung at a time — the launcher's child notices it was
 * reparented, signals the group it owns, ends that group by force when the stop
 * grace is up — so what a failure has to show is the shape of the tree at each
 * poll, not just the last one. The digest is one line per poll while the set of
 * survivors changes, which makes a tree that drained too slowly look nothing
 * like a tree that never moved at all; the launcher's own output goes with it,
 * because that is where the stop path says out loud which of the three
 * observations fired and when.
 */
async function assertMarkedTreeEnds(marker: string, timeoutMs: number, launched: Launch | null = null): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const timeline: string[] = [];
  let live = await markedProcessRecords(marker);
  let previous = "";
  const record = (): void => {
    const digest = live.map((process_) => `${process_.pid}${process_.state}`).join(" ");
    if (digest === previous) return;
    previous = digest;
    timeline.push(`  +${String(Date.now() - startedAt).padStart(5)}ms  ${digest || "(none)"}`);
  };
  record();
  while (live.length > 0 && Date.now() < deadline) {
    await delay(250);
    live = await markedProcessRecords(marker);
    record();
  }
  const report = [
    `processes outlived the launcher that started them, ${timeoutMs} milliseconds after it was killed:`,
    describe(live),
    "how the marked tree drained, one line per change:",
    ...timeline,
    ...launched === null ? [] : ["what the launcher wrote:", indent(launched.output)],
  ].join("\n");
  assert.deepEqual(live.map((process_) => process_.pid), [], report);
}

function describe(records: readonly MarkedProcess[]): string {
  return records
    .map((record) => `  pid ${record.pid} parent ${record.parent} group ${record.group} ${record.state} ${record.command}`)
    .join("\n");
}

function indent(text: string): string {
  return text.split("\n").map((line) => `  ${line}`).join("\n");
}

async function markedProcesses(marker: string): Promise<readonly number[]> {
  return (await markedProcessRecords(marker)).map((record) => record.pid);
}

/**
 * Every marked process that is still a process.
 *
 * A process the kernel is still holding an exit status for owns nothing — no
 * memory, no descriptors, no browser — and goes the moment its parent reaps it
 * or is itself reaped. Counting one as a survivor would fail this suite for the
 * scheduling of a `wait` call, so a zombie is dead here. It is also the one
 * state the two probes disagree about by construction: Linux answers an empty
 * environment for a zombie and would never have matched the marker in the first
 * place, while `ps -E` on macOS still prints the row. Reading the state on both
 * is what makes the two probes mean the same thing.
 */
async function markedProcessRecords(marker: string): Promise<readonly MarkedProcess[]> {
  const found = process.platform === "linux" ? await markedLinuxProcesses(marker) : await markedBsdProcesses(marker);
  return found.filter((record) => record.state !== "Z");
}

/** macOS and the BSDs publish a process's environment through `ps -E`. */
async function markedBsdProcesses(marker: string): Promise<readonly MarkedProcess[]> {
  const { stdout } = await execFileAsync("ps", ["-axww", "-E", "-o", "pid=,ppid=,pgid=,state=,command="], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const found: MarkedProcess[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes(`${markerVariable}=${marker}`)) continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    // `ps` reports the environment after the command line, so the marker this
    // probe was asked about appears in the probe's own row too.
    if (pid === process.pid) continue;
    found.push({
      pid,
      parent: Number(match[2]),
      group: Number(match[3]),
      state: match[4]![0]!,
      command: match[5]!.split(` ${markerVariable}=`)[0]!.slice(0, 160),
    });
  }
  return found;
}

async function markedLinuxProcesses(marker: string): Promise<readonly MarkedProcess[]> {
  const found: MarkedProcess[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/u.test(name) || Number(name) === process.pid) continue;
    let environment: string;
    try { environment = await readFile(`/proc/${name}/environ`, "utf8"); }
    catch { continue; }
    if (!environment.split("\0").includes(`${markerVariable}=${marker}`)) continue;
    let command = "";
    try { command = (await readFile(`/proc/${name}/cmdline`, "utf8")).split("\0").join(" ").trim(); }
    catch {}
    found.push({ ...await linuxProcessState(name), pid: Number(name), command: command.slice(0, 160) });
  }
  return found;
}

/**
 * The parent, the group and the state, read from `/proc/<pid>/stat`.
 *
 * The command name sits in that line inside parentheses and may contain spaces
 * and parentheses of its own, so the fields after it are found from the last
 * `)` rather than by splitting the whole line. A process that exits between the
 * directory listing and this read reports nothing rather than failing the poll.
 */
async function linuxProcessState(name: string): Promise<{ parent: number; group: number; state: string }> {
  const unknown = { parent: 0, group: 0, state: "?" };
  let line: string;
  try { line = await readFile(`/proc/${name}/stat`, "utf8"); }
  catch { return unknown; }
  const fields = line.slice(line.lastIndexOf(")") + 1).trim().split(/\s+/u);
  if (fields.length < 4) return unknown;
  return { parent: Number(fields[1]), group: Number(fields[2]), state: fields[0]! };
}

function isPlaywrightBrowser(command: string): boolean {
  return /(?:ms-playwright|playwright).*(?:Chromium|chrome-headless-shell|firefox|MiniBrowser)/iu.test(command);
}

/**
 * A project whose browser tests are quick and plural: the run has to keep
 * writing after its reader is gone for the EPIPE path to be the thing under
 * test rather than the run simply finishing first.
 */
async function browserFixture(title: string, source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-process-hygiene-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: {
      title: title,
      security: { contentSecurityPolicy: true, connectSources: [], imageSources: [] },
      deployment: { spaFallback: true },
    },
  }, null, 2), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
component App:
    return <main>Process hygiene probe</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "app.browser.test.vel"), source, "utf8");
  return directory;
}

async function waitForExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`the run did not end within ${timeoutMs} milliseconds`)), timeoutMs);
  });
  try { return await Promise.race([exit, timeout]); }
  finally { if (timer !== null) clearTimeout(timer); }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
