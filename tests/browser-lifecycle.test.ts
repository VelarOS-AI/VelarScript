import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { runBrowserTests } from "../packages/cli/src/browser-test-runner.ts";
import { superviseBrowserWorker } from "../packages/cli/src/browser-process-owner.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);


const execFileAsync = promisify(execFile);
const cli = resolve("packages/cli/src/cli.ts");

interface ProcessRecord {
  readonly pid: number;
  readonly parent: number;
  readonly command: string;
}

test("a normally exiting browser worker reaps a stubborn process-group descendant", {
  skip: process.platform === "win32",
}, async () => {
  const marker = `velar-browser-owner-${process.pid}-${Date.now()}`;
  const seen = new Set<number>();
  let settled = false;
  const source = [
    'const { spawn } = require("node:child_process");',
    `spawn(process.execPath, ["-e", 'process.on("SIGHUP", () => {}); process.on("SIGINT", () => {}); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)', ${JSON.stringify(marker)}], { stdio: "ignore" });`,
    // Leave enough time for a loaded hosted runner to observe both processes;
    // the assertion is about process-group cleanup, not scheduler latency.
    "setTimeout(() => process.exit(0), 1000);",
  ].join(" ");
  const running = superviseBrowserWorker({
    executable: process.execPath,
    arguments: ["-e", source, marker],
    cwd: process.cwd(),
    environment: process.env,
    deadlineMs: 10_000,
    cleanupTimeoutMs: 1_000,
  }).finally(() => { settled = true; });
  while (!settled) {
    for (const record of await processRecords()) {
      if (record.command.includes(marker)) seen.add(record.pid);
    }
    await delay(10);
  }
  assert.equal(await running, 0);
  assert.ok(seen.size >= 2, "the process-group probe must observe the worker and its stubborn descendant");
  await assertProcessesExit(seen, 5_000);
});

test("browser tests bound a non-settling test and release every Playwright process", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await browserFixture();
  const seen = new Set<number>();
  let settled = false;
  try {
    const config = await resolveVelarProject(directory);
    const startedAt = Date.now();
    const running = runBrowserTests(config, null, "chromium", {
      testTimeoutMs: 250,
      runTimeoutMs: 15_000,
      cleanupTimeoutMs: 5_000,
      executable: cli,
    }).finally(() => { settled = true; });
    while (!settled) {
      await collectBrowserDescendants(process.pid, seen);
      await delay(25);
    }
    assert.equal(await running, 1);
    assert.ok(Date.now() - startedAt < 15_000, "the browser test timeout must converge promptly");
    assert.ok(seen.size > 0, "the lifecycle probe must observe a real Playwright browser process");
    await assertProcessesExit(seen, 10_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SIGTERM drains the CLI browser-test owner without orphaning renderer processes", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await browserFixture();
  const seen = new Set<number>();
  let child: ChildProcess | null = null;
  let stdout = "";
  let stderr = "";
  try {
    child = spawn(process.execPath, [cli, "test", directory, "--browser=chromium"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const browserDeadline = Date.now() + 30_000;
    while (seen.size === 0 && Date.now() < browserDeadline) {
      await collectBrowserDescendants(child.pid!, seen);
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(25);
    }
    assert.ok(seen.size > 0, `the signal probe did not reach a Playwright browser\n${stdout}\n${stderr}`);
    const exit = waitForExit(child);
    child.kill("SIGTERM");
    const result = await bounded(exit, 15_000, "browser-test CLI signal exit");
    assert.equal(result.signal, null, stderr);
    assert.equal(result.code, 143, stderr);
    await assertProcessesExit(seen, 10_000);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("a force-killed supervisor makes its browser-test worker drain through IPC disconnect", {
  skip: process.platform === "win32",
}, async () => {
  const directory = await browserFixture();
  const browsers = new Set<number>();
  const descendants = new Set<number>();
  let child: ChildProcess | null = null;
  let stdout = "";
  let stderr = "";
  try {
    child = spawn(process.execPath, [cli, "test", directory, "--browser=chromium"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const browserDeadline = Date.now() + 30_000;
    while (browsers.size === 0 && Date.now() < browserDeadline) {
      await collectBrowserDescendants(child.pid!, browsers, descendants);
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(25);
    }
    assert.ok(browsers.size > 0, `the disconnect probe did not reach a Playwright browser\n${stdout}\n${stderr}`);
    assert.ok(descendants.size > browsers.size, "the supervisor must own a dedicated browser-test worker");
    const exit = waitForExit(child);
    child.kill("SIGKILL");
    const result = await bounded(exit, 15_000, "force-killed browser-test supervisor exit");
    assert.equal(result.code, null);
    assert.equal(result.signal, "SIGKILL");
    await assertProcessesExit(descendants, 15_000);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("the direct browser acceptance matrix drains its server and renderer owners on SIGTERM", {
  skip: process.platform === "win32",
}, async () => {
  const browsers = new Set<number>();
  const descendants = new Set<number>();
  let child: ChildProcess | null = null;
  let stdout = "";
  let stderr = "";
  try {
    child = spawn(process.execPath, [resolve("tests/browser.acceptance.ts")], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const browserDeadline = Date.now() + 30_000;
    while (browsers.size === 0 && Date.now() < browserDeadline) {
      await collectBrowserDescendants(child.pid!, browsers, descendants);
      if (child.exitCode !== null || child.signalCode !== null) break;
      await delay(25);
    }
    assert.ok(browsers.size > 0, `the acceptance signal probe did not reach a Playwright browser\n${stdout}\n${stderr}`);
    const exit = waitForExit(child);
    child.kill("SIGTERM");
    const result = await bounded(exit, 20_000, "browser acceptance signal exit");
    assert.equal(result.signal, null, stderr);
    assert.equal(result.code, 143, stderr);
    await assertProcessesExit(descendants, 15_000);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

async function browserFixture(): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-browser-lifecycle-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: {
      title: "Browser lifecycle probe",
      security: { contentSecurityPolicy: true, connectSources: [], imageSources: [] },
      deployment: { spaFallback: true },
    },
  }, null, 2), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
component App:
    return <main>Browser lifecycle probe</main>

mount(<App />, "#app")
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "app.browser.test.vel"), `
test "never settles":
    await Promise.sleep(60000ms)
`.trimStart(), "utf8");
  return directory;
}

async function collectBrowserDescendants(root: number, output: Set<number>, all: Set<number> | null = null): Promise<void> {
  const records = await processRecords();
  const descendants = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records) {
      if (descendants.has(record.pid) || !descendants.has(record.parent)) continue;
      descendants.add(record.pid);
      changed = true;
    }
  }
  for (const record of records) {
    if (record.pid !== root && descendants.has(record.pid)) all?.add(record.pid);
    if (descendants.has(record.pid) && isPlaywrightBrowser(record.command)) output.add(record.pid);
  }
}

async function processRecords(): Promise<ProcessRecord[]> {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3]! }] : [];
  });
}

function isPlaywrightBrowser(command: string): boolean {
  return /(?:ms-playwright|playwright).*(?:Chromium|chrome-headless-shell|firefox|MiniBrowser)/iu.test(command);
}

async function assertProcessesExit(processes: ReadonlySet<number>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let active: number[] = [];
  do {
    active = [...processes].filter(processExists);
    if (active.length === 0) return;
    await delay(25);
  } while (Date.now() < deadline);
  assert.deepEqual(active, [], `Playwright processes remained alive after browser-test cleanup: ${active.join(", ")}`);
}

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function waitForExit(child: ChildProcess): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs} milliseconds`)), timeoutMs);
  });
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer !== null) clearTimeout(timer); }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
