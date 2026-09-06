import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { superviseBrowserWorker } from "../../packages/cli/src/browser-process-owner.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

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
    await assertMarkedTreeEnds(marker, 60_000);
  } finally {
    endLaunch(launcher);
  }
});

test("a browser acceptance whose launcher is killed ends on its own", {
  skip: process.platform === "win32",
}, async () => {
  const marker = issueMarker();
  const launcher = launch(marker, "node tests/acceptance/browser.acceptance.ts; echo acceptance-done");
  try {
    await waitForBrowser(marker, launcher, 60_000);
    launcher.child.kill("SIGKILL");
    await assertMarkedTreeEnds(marker, 15_000);
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
    const gate = running.find((record) => record.command.includes("run-project-gate.mjs"));
    assert.ok(gate, `the gate script was not among the marked processes\n${describe(running)}`);
    process.kill(gate.pid, "SIGKILL");
    await assertMarkedTreeEnds(marker, 15_000);
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
    await assertMarkedTreeEnds(marker, 30_000);
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
  await assertMarkedTreeEnds(marker, 15_000);
});

interface MarkedProcess {
  readonly pid: number;
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

async function assertMarkedTreeEnds(marker: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let live = await markedProcessRecords(marker);
  while (live.length > 0 && Date.now() < deadline) {
    await delay(250);
    live = await markedProcessRecords(marker);
  }
  assert.deepEqual(live.map((record) => record.pid), [],
    `processes outlived the launcher that started them:\n${describe(live)}`);
}

function describe(records: readonly MarkedProcess[]): string {
  return records.map((record) => `  ${record.pid} ${record.command}`).join("\n");
}

async function markedProcesses(marker: string): Promise<readonly number[]> {
  return (await markedProcessRecords(marker)).map((record) => record.pid);
}

async function markedProcessRecords(marker: string): Promise<readonly MarkedProcess[]> {
  return process.platform === "linux" ? markedLinuxProcesses(marker) : markedBsdProcesses(marker);
}

/** macOS and the BSDs publish a process's environment through `ps -E`. */
async function markedBsdProcesses(marker: string): Promise<readonly MarkedProcess[]> {
  const { stdout } = await execFileAsync("ps", ["-axww", "-E", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const found: MarkedProcess[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes(`${markerVariable}=${marker}`)) continue;
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    // `ps` reports the environment after the command line, so the marker this
    // probe was asked about appears in the probe's own row too.
    if (pid === process.pid) continue;
    found.push({ pid, command: match[2]!.split(` ${markerVariable}=`)[0]!.slice(0, 160) });
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
    found.push({ pid: Number(name), command: command.slice(0, 160) });
  }
  return found;
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
