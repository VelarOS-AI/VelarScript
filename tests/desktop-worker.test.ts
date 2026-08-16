import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import test, { before } from "node:test";
import { pathToFileURL } from "node:url";
import { buildLanguageServerTool } from "../packages/cli/src/language-server-tool.ts";
import { buildProjectTaskTool } from "../packages/cli/src/project-task-tool.ts";
import { buildBuildEngineTool } from "../packages/cli/src/build-engine-tool.ts";
import { FileProjectChangeFeed } from "@velaros-ai/project/changes";
import { createProjectKernel } from "@velaros-ai/project/runtime";

const workerPath = resolve("packages/desktop/native/node/worker.js");
const temporaryPrefix = join(tmpdir(), "velar-desktop-");
const desktopWorkerTest = process.platform === "win32" ? test.skip : test;

// Every wait in this suite is bounded. The worker speaks over stdio pipes and
// drives real child processes, PTYs and OS file watchers, so a single reply
// that never arrives used to freeze the whole `npm test` run at 0% CPU
// indefinitely: node:test runs with --test-timeout=0, so nothing above these
// promises ever intervenes. Each bound below is far above the worker's own
// worst-case internal deadline so healthy-but-loaded runs never trip it, and
// each failure names what timed out and the states that explain it.
//
// The worker's longest internal confirmation deadline for filesystem, process,
// HTTP, language-server and terminal work is 5000 milliseconds, and the widest
// payload the suite pushes through the pipe is about 1.2 MiB.
const WORKER_CALL_TIMEOUT_MS = 30_000;
// A project task carries its own bounded timeout (120000 milliseconds below),
// so the transport deadline has to sit above the worker's own bound.
const PROJECT_TASK_CALL_TIMEOUT_MS = 150_000;
// macOS arms a recursive watch asynchronously, so a change written before the
// FSEvents stream starts is never reported at all. Re-trigger the change while
// the pull is outstanding instead of trusting one notification.
const WATCHED_CHANGE_TIMEOUT_MS = 30_000;
const WATCHED_CHANGE_RETRIGGER_MS = 250;
// Optimized Swift compilation of the terminal host normally takes seconds.
const TERMINAL_HOST_COMPILE_TIMEOUT_MS = 180_000;
// Bundling an official tool is sub-second, and esbuild's own service pipe has
// no deadline of its own, so name that wait rather than leave it to the
// per-test backstop.
const TOOL_BUILD_TIMEOUT_MS = 60_000;
const LOCAL_SERVER_TIMEOUT_MS = 10_000;
const STALE_STATE_TIMEOUT_MS = 30_000;
// The process tests let descendants escape on purpose, and those descendants
// are reparented to pid 1 for the few seconds before the test reaps them. Only
// an escapee that has outlived any such window is a leftover, so a suite
// running concurrently in another checkout keeps its own in-flight processes.
const STALE_ESCAPEE_MINIMUM_AGE_SECONDS = 120;

before(async () => { await releaseStaleWorkerState(); }, { timeout: 120_000 });

/**
 * A run that is killed mid-suite orphans its worker, the worker's bundled
 * children and the descendants the process tests deliberately let escape, and
 * leaves their temporary roots behind. Reclaim that state before the first
 * test so leftovers cannot collide with, or be mistaken for, this run's own
 * processes. Only orphans (reparented to pid 1) and temporary roots no live
 * process still names are reclaimed, so a concurrent suite is left alone: its
 * worker and bundled children always still have their live parent, and its
 * escaped descendants are younger than the age floor below.
 */
async function releaseStaleWorkerState(): Promise<void> {
  const orphans = (await processSnapshot()).filter((entry) => entry.ppid === 1 && entry.pid !== process.pid
    && (entry.command.includes(workerPath)
      || entry.command.includes(temporaryPrefix)
      || (entry.command.startsWith(`${process.execPath} -e `)
        && entry.command.includes("setInterval(() => {}, 1000)")
        && entry.elapsedSeconds >= STALE_ESCAPEE_MINIMUM_AGE_SECONDS)));
  for (const orphan of orphans) terminateProcessGroup(orphan.pid);
  const deadline = Date.now() + STALE_STATE_TIMEOUT_MS;
  const remaining = new Set(orphans.map((orphan) => orphan.pid));
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of remaining) {
      try { process.kill(pid, 0); }
      catch { remaining.delete(pid); }
    }
    if (remaining.size > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const live = await processSnapshot();
  const released: string[] = [];
  const idleBefore = Date.now() - STALE_ESCAPEE_MINIMUM_AGE_SECONDS * 1000;
  for (const name of await readdir(tmpdir())) {
    const path = join(tmpdir(), name);
    if (!path.startsWith(temporaryPrefix)) continue;
    if (live.some((entry) => entry.command.includes(path))) continue;
    // Some roots are only ever named through a child's environment, so age is
    // the reliable second signal that nothing is still using this one.
    const metadata = await stat(path).catch(() => null);
    if (metadata === null || metadata.mtimeMs > idleBefore) continue;
    await rm(path, { recursive: true, force: true });
    released.push(name);
  }
  if (orphans.length > 0 || released.length > 0) {
    console.log(`[desktop-worker] released stale state: ${orphans.length} orphaned process(es)${
      remaining.size > 0 ? ` (${[...remaining].join(", ")} survived SIGKILL)` : ""
    }, ${released.length} temporary root(s)`);
  }
  assert.deepEqual([...remaining], [], "stale Desktop worker processes survived SIGKILL, so this run cannot start clean");
}

type ProcessEntry = { pid: number; ppid: number; elapsedSeconds: number; command: string };

async function processSnapshot(): Promise<readonly ProcessEntry[]> {
  if (process.platform === "win32") return [];
  // Reclaiming leftovers is hygiene, not a contract: the bounded waits below
  // are what keep a hang loud. An unreadable process table reports itself and
  // leaves the tests to run.
  let table: string;
  try { table = await runBoundedCommand("/bin/ps", ["-Aww", "-o", "pid=,ppid=,etime=,command="], STALE_STATE_TIMEOUT_MS); }
  catch (error) {
    console.log(`[desktop-worker] could not read the process table, skipping stale-process cleanup: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const entries: ProcessEntry[] = [];
  for (const line of table.split("\n")) {
    const fields = /^\s*(\d+)\s+(\d+)\s+((?:\d+-)?(?:\d+:)?\d+:\d+)\s+(.*)$/u.exec(line);
    if (!fields) continue;
    entries.push({
      pid: Number(fields[1]),
      ppid: Number(fields[2]),
      elapsedSeconds: elapsedSeconds(fields[3] ?? ""),
      command: fields[4] ?? "",
    });
  }
  return entries;
}

/** Reads `ps` elapsed time, formatted `[[dd-]hh:]mm:ss`, as whole seconds. */
function elapsedSeconds(value: string): number {
  const [days, clock] = value.includes("-") ? value.split("-") : ["0", value];
  let seconds = 0;
  for (const part of (clock ?? "").split(":")) seconds = seconds * 60 + Number(part);
  return Number(days) * 86_400 + seconds;
}

async function runBoundedCommand(executable: string, args: readonly string[], timeout: number): Promise<string> {
  const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", () => {});
  const completion = new Promise<void>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", () => resolveExit());
  });
  try { await withDeadline(completion, `${basename(executable)} ${args.join(" ")}`, timeout); }
  catch (error) { child.kill("SIGKILL"); throw error; }
  return output;
}

desktopWorkerTest("Desktop owns one packaged official language-server lifecycle without process grants", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-language-server-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  const host = join(directory, "host");
  await Promise.all([mkdir(project), mkdir(appData), mkdir(host)]);
  await writeFile(join(project, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  const mainPath = join(project, "main.vel");
  await writeFile(mainPath, "const value = 1\n", "utf8");
  const readmePath = join(project, "README.md");
  await writeFile(readmePath, "Packaged workspace search needle\n", "utf8");
  const outsidePath = join(directory, "outside.vel");
  await writeFile(outsidePath, "const privateOutsideProject = 1\n", "utf8");
  const escapedLinkPath = join(project, "escaped-link.vel");
  await symlink(outsidePath, escapedLinkPath);
  await withDeadline(buildLanguageServerTool(join(host, "language-server.js")), "the bundled language-server tool build", TOOL_BUILD_TIMEOUT_MS);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: ["project"], processes: [], network: [], secrets: [] },
    languageServer: { path: "host/language-server.js" },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(worker);
  let serverPid: number | null = null;
  try {
    const rejectedHandle = await client.call("language-server", "start", []) as number;
    await client.call("language-server", "send", [rejectedHandle, JSON.stringify({
      jsonrpc: "2.0",
      id: 90,
      method: "initialize",
      params: { rootUri: pathToFileURL(directory).href },
    })]);
    const rejectedInitialize = JSON.parse(await client.call("language-server", "next", [rejectedHandle]) as string) as { id: number; error: { code: number; message: string } };
    assert.equal(rejectedInitialize.id, 90);
    assert.equal(rejectedInitialize.error.code, -32602);
    assert.match(rejectedInitialize.error.message, /Desktop project grant/u);
    await client.call("language-server", "close", [rejectedHandle]);

    const handle = await client.call("language-server", "start", []) as number;
    assert.ok(handle >= 1_000_000_000);
    const ownership = client.lifecycle().find((event) => event.hostEvent === "language-server-owned" && event.handle === handle);
    assert.ok(ownership?.pid);
    serverPid = ownership.pid as number;

    assert.equal(await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { rootUri: pathToFileURL(project).href, capabilities: { general: { positionEncodings: ["utf-32"] } } },
    })]), null);
    const initialized = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { id: number; result: { serverInfo: { name: string } } };
    assert.equal(initialized.id, 1);
    assert.equal(initialized.result?.serverInfo.name, "VelarScript Language Server", JSON.stringify(initialized));
    await client.call("language-server", "send", [handle, JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })]);

    const outsideUri = pathToFileURL(outsidePath).href;
    await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: outsideUri, languageId: "velar", version: 1, text: "const privateOutsideProject =\n" } },
    })]);
    const outsideLog = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { method: string; params: { message: string } };
    assert.equal(outsideLog.method, "window/logMessage");
    assert.match(outsideLog.params.message, /outside the Desktop project grant/u);
    await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "textDocument/definition",
      params: { textDocument: { uri: outsideUri }, position: { line: 0, character: 6 } },
    })]);
    const outsideDefinition = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { id: number; result: unknown };
    assert.equal(outsideDefinition.id, 9);
    assert.equal(outsideDefinition.result, null);
    await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: pathToFileURL(escapedLinkPath).href, languageId: "velar", version: 1, text: "const privateOutsideProject =\n" } },
    })]);
    const escapedLinkLog = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { method: string; params: { message: string } };
    assert.equal(escapedLinkLog.method, "window/logMessage");
    assert.match(escapedLinkLog.params.message, /outside the Desktop project grant/u);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const cancelledPull = client.beginCall("language-server", "next", [handle]);
      client.cancelRequest(cancelledPull.id);
      await assert.rejects(
        withDeadline(cancelledPull.result, "cancelled language-server pull", 5_000),
        /pull was cancelled|request was cancelled/u,
      );
    }
    assert.equal(await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: new URL(`file://${mainPath}`).href, languageId: "velar", version: 1, text: "const value =\n" } },
    })]), null);
    const diagnostics = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { method: string; params: { diagnostics: unknown[] } };
    assert.equal(diagnostics.method, "textDocument/publishDiagnostics");
    assert.ok(diagnostics.params.diagnostics.length > 0);

    const scriptPath = join(project, "probe.ts");
    const scriptUri = new URL(`file://${scriptPath}`).href;
    assert.equal(await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: scriptUri, languageId: "typescript", version: 1, text: "const value = 1\nconst next = value + 1\n" } },
    })]), null);
    const scriptDiagnostics = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { method: string; params: { diagnostics: unknown[] } };
    assert.equal(scriptDiagnostics.method, "textDocument/publishDiagnostics");
    assert.deepEqual(scriptDiagnostics.params.diagnostics, []);
    await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/definition",
      params: { textDocument: { uri: scriptUri }, position: { line: 1, character: 13 } },
    })]);
    const scriptDefinition = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { id: number; result: { range: { start: { line: number } } } };
    assert.equal(scriptDefinition.id, 2);
    assert.equal(scriptDefinition.result.range.start.line, 0);

    await client.call("language-server", "send", [handle, JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "velar/workspaceSearch",
      params: { query: "workspace search needle", maximumResults: 10 },
    })]);
    const workspaceSearch = JSON.parse(await client.call("language-server", "next", [handle]) as string) as {
      id: number;
      result: { items: Array<{ uri: string; preview: string }>; indexedFiles: number };
    };
    assert.equal(workspaceSearch.id, 4);
    assert.deepEqual(workspaceSearch.result.items.map((item) => item.uri), [pathToFileURL(readmePath).href]);
    assert.match(workspaceSearch.result.items[0]?.preview ?? "", /Packaged workspace search needle/u);
    assert.ok(workspaceSearch.result.indexedFiles >= 2);

    await client.call("language-server", "send", [handle, JSON.stringify({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null })]);
    const shutdown = JSON.parse(await client.call("language-server", "next", [handle]) as string) as { id: number };
    assert.equal(shutdown.id, 3);
    await client.call("language-server", "send", [handle, JSON.stringify({ jsonrpc: "2.0", method: "exit", params: null })]);
    assert.equal(await client.call("language-server", "close", [handle]), null);
    await assert.rejects(client.call("language-server", "next", [handle]), /unknown or already released/u);
    assert.ok(client.lifecycle().some((event) => event.hostEvent === "language-server-settled" && event.handle === handle));
    for (let attempt = 0; attempt < 100 && serverPid !== null; attempt += 1) {
      try { process.kill(serverPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { serverPid = null; }
    }
    assert.equal(serverPid, null, "closing the Desktop language server must reap its process group");
  } finally {
    if (serverPid !== null) terminateProcessGroup(serverPid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

desktopWorkerTest("Desktop owns permission-scoped PTY terminals with resize and crash reaping", {
  timeout: 240_000,
  skip: process.platform !== "darwin" ? "the 0.10 PTY host is the macOS Swift host" : false,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-terminal-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  const host = join(directory, "host");
  await Promise.all([mkdir(project), mkdir(appData), mkdir(host)]);
  const terminalHost = join(host, "terminal-host");
  await compileTerminalHost(terminalHost);
  const deniedConfig = join(directory, "desktop-denied.json");
  await writeFile(deniedConfig, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: ["project"], processes: [], terminal: false, network: [], secrets: [] },
    terminalHost: { path: "host/terminal-host" },
  }), "utf8");
  const deniedWorker = spawn(process.execPath, [workerPath, deniedConfig, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const deniedClient = new WorkerClient(deniedWorker);
  try {
    await assert.rejects(withDeadline(deniedClient.call("terminal", "open", [{columns: 80, rows: 24}]), "denied terminal open"), /desktop\.permissions\.terminal/u);
  } finally {
    await deniedClient.close();
  }

  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: ["project"], processes: [], terminal: true, network: [], secrets: [] },
    terminalHost: { path: "host/terminal-host" },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(worker);
  const terminalCall = (operation: string, args: readonly unknown[]): Promise<unknown> => withDeadline(client.call("terminal", operation, args), `terminal ${operation}`);
  const ownedPids = new Set<number>();
  try {
    const started = await terminalCall("open", [{columns: 80, rows: 24}]) as {handle: number; pid: number};
    assert.ok(started.handle >= 2_000_000_000);
    const ownership = client.lifecycle().find(event => event.hostEvent === "terminal-owned" && event.handle === started.handle);
    assert.deepEqual(ownership?.pids?.length, 2);
    assert.equal(ownership?.pids?.includes(started.pid), true);
    for (const pid of ownership?.pids ?? []) ownedPids.add(pid);

    assert.equal(await terminalCall("resize", [started.handle, 100, 30]), null);
    assert.equal(await terminalCall("write", [started.handle, "echo __VELAR_PTY__:$COLUMNS:$LINES; exit 7\n"]), null);
    let output = "";
    let outputEnded = false;
    for (let pulls = 0; pulls < 100; pulls += 1) {
      const chunk = await terminalCall("next", [started.handle]) as string | null;
      if (chunk === null) { outputEnded = true; break; }
      output += chunk;
    }
    assert.match(output, /__VELAR_PTY__:100:30/u);
    assert.equal(outputEnded, true, "the terminal output stream must reach its final null");
    assert.deepEqual(await terminalCall("wait", [started.handle]).catch(error => { throw new Error(`first terminal wait failed: ${String(error)}`); }), {code: 7});
    assert.ok(client.lifecycle().some(event => event.hostEvent === "terminal-settled" && event.handle === started.handle));
    await waitForPidsToExit(ownedPids, 5_000);
    ownedPids.clear();

    const cancelled = await terminalCall("open", [{columns: 80, rows: 24}]) as {handle: number; pid: number};
    const cancelledOwnership = client.lifecycle().find(event => event.hostEvent === "terminal-owned" && event.handle === cancelled.handle);
    for (const pid of cancelledOwnership?.pids ?? []) ownedPids.add(pid);
    const cancelledRead = client.beginCall("terminal", "next", [cancelled.handle]);
    client.cancelRequest(cancelledRead.id);
    await assert.rejects(withDeadline(cancelledRead.result, "cancelled terminal read"), /terminal pull was cancelled|request was cancelled/u);
    await assert.rejects(terminalCall("wait", [cancelled.handle]), /output must be consumed/u);
    assert.equal(await terminalCall("write", [cancelled.handle, "exit 0\n"]), null);
    while (await terminalCall("next", [cancelled.handle]) !== null) {}
    assert.deepEqual(await terminalCall("wait", [cancelled.handle]).catch(error => { throw new Error(`cancelled-read terminal wait failed: ${String(error)}`); }), {code: 0});
    await waitForPidsToExit(ownedPids, 5_000);
    ownedPids.clear();

    const retired = await terminalCall("open", [{columns: 80, rows: 24}]) as {handle: number; pid: number};
    const retiredOwnership = client.lifecycle().find(event => event.hostEvent === "terminal-owned" && event.handle === retired.handle);
    for (const pid of retiredOwnership?.pids ?? []) ownedPids.add(pid);
    assert.equal(ownedPids.size, 2);
    client.retireOwner();
    await waitForPidsToExit(ownedPids, 5_000);
    ownedPids.clear();
  } finally {
    for (const pid of ownedPids) terminateProcessGroup(pid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

desktopWorkerTest("Desktop owns bounded packaged project tasks without executable grants", { timeout: 240_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-project-task-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  const host = join(directory, "host");
  await Promise.all([mkdir(project), mkdir(appData), mkdir(host)]);
  await writeFile(join(project, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] }), "utf8");
  await writeFile(join(project, "main.vel"), "print(\"project-task-run\")\n", "utf8");
  await writeFile(join(project, "main.test.vel"), "test \"the project task runs\":\n    if 2 + 2 != 4:\n        throw Error(\"math failed\")\n", "utf8");
  await withDeadline(Promise.all([
    buildProjectTaskTool(join(host, "project-task.js")),
    buildBuildEngineTool(join(host, "build-engine")),
  ]), "the bundled project-task and build-engine tool builds", TOOL_BUILD_TIMEOUT_MS);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: ["project"], processes: [], network: [], secrets: [] },
    projectTask: { path: "host/project-task.js", buildEnginePath: "host/build-engine" },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(worker);
  let runningPid: number | null = null;
  try {
    await assert.rejects(client.call("project-task", "start", ["dev", [], { timeout: 1000, maxOutputBytes: 65536 }]), /command is invalid/u);
    await assert.rejects(client.call("project-task", "start", ["check", ["--out", "escape"], { timeout: 1000, maxOutputBytes: 65536 }]), /Only a run project task accepts/u);
    await assert.rejects(client.call("project-task", "start", ["check", [], { cwd: "/tmp", timeout: 1000, maxOutputBytes: 65536 }]), /options are invalid/u);

    for (const [command, expected] of [
      ["check", /Checked 2 modules/u],
      ["test", /1 passed, 0 failed/u],
      ["build", /Built 1 module/u],
      ["fix", /applied 0 mechanical fixes; 0 diagnostics remain/u],
      ["run", /project-task-run/u],
    ] as const) {
      const started = await client.call("project-task", "start", [command, [], { timeout: 120000, maxOutputBytes: 1024 * 1024 }]) as { handle: number; pid: number };
      assert.ok(started.handle > 0 && started.pid > 0);
      await assert.rejects(client.call("process", "read", [started.handle]), /process handle is unknown/u);
      let output = "";
      while (true) {
        const chunk = await client.call("project-task", "read", [started.handle]) as { channel: string; text: string } | null;
        if (chunk === null) break;
        output += chunk.text;
      }
      const outcome = await client.call("project-task", "wait", [started.handle]) as {
        result: { code: number | null; signal: string | null; stdout: string; stderr: string };
        error: null;
        retained: false;
      };
      assert.equal(outcome.result.code, 0, outcome.result.stderr);
      assert.match(output, expected);
      assert.equal(output, `${outcome.result.stdout}${outcome.result.stderr}`);
      await assert.rejects(client.call("project-task", "read", [started.handle]), /project task handle is unknown/u);
    }
    assert.equal((await readFile(join(project, "dist", "main.js"), "utf8")).includes("project-task-run"), true);

    await writeFile(join(project, "main.vel"), "print(\"started\")\nawait Promise.sleep(60000ms)\n", "utf8");
    const running = await client.call("project-task", "start", ["run", [], { timeout: 0, maxOutputBytes: 65536 }]) as { handle: number; pid: number };
    runningPid = running.pid;
    const first = await client.call("project-task", "read", [running.handle]) as { channel: string; text: string };
    assert.match(first.text, /started/u);
    const stopStarted = Date.now();
    const stopped = await client.call("project-task", "stop", [running.handle]) as { result: { code: number | null; signal: string | null } | null; error: unknown };
    assert.equal(stopped.error, null);
    assert.ok((stopped.result?.code ?? 0) !== 0 || stopped.result?.signal !== null, JSON.stringify(stopped));
    assert.ok(Date.now() - stopStarted < 5000, "ProjectTask.stop must confirm package-owned process-group cleanup within 5 seconds");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(runningPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { runningPid = null; break; }
    }
    assert.equal(runningPid, null, "ProjectTask.stop must reap the package-owned launcher PID");
  } finally {
    if (runningPid !== null) terminateProcessGroup(runningPid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

desktopWorkerTest("Desktop owns durable finite project changes across Worker restarts", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-project-changes-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await Promise.all([mkdir(project), mkdir(appData)]);
  const notePath = join(project, "note.txt");
  await writeFile(notePath, "before\n", "utf8");
  const canonicalProject = await realpath(project);
  const privateDirectory = join(appData, "project-transactions", createHash("sha256").update(canonicalProject).digest("hex"));
  const statePath = join(privateDirectory, "transactions.json");
  const feedPath = join(privateDirectory, "changes.jsonl");
  const feed = new FileProjectChangeFeed({path: feedPath});
  let transactionId = "";
  try {
    const owner = await createProjectKernel({root: canonicalProject, changeFeed: feed, transactionStatePath: statePath});
    const prepared = await owner.prepareEdit({
      operations: [{
        reason: "Desktop finite project change transport",
        operation: {type: "replace_text", path: "note.txt", oldText: "before", newText: "after"},
      }],
    });
    transactionId = prepared.transactionId;
    const validation = await owner.validate({transactionId});
    assert.equal(validation.ok, true);
  } finally {
    feed.close();
  }

  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: {files: ["project"], processes: [], terminal: false, network: [], environment: [], secrets: []},
  }), "utf8");
  const open = (): WorkerClient => new WorkerClient(spawn(process.execPath, [workerPath, configPath, appData, project], {stdio: ["pipe", "pipe", "pipe"]}));
  let client = open();
  try {
    let handle = await client.call("project-changes", "start", []) as number;
    assert.ok(handle >= 3_000_000_000 && handle <= 3_000_000_015);
    const page = await client.call("project-changes", "list", [handle, 50]) as {
      changes: Array<{transactionId: string; lifecycle: string; diff: string; changedFiles: string[]}>;
      truncated: boolean;
    };
    assert.equal(page.truncated, false);
    assert.equal(page.changes[0]?.transactionId, transactionId);
    assert.equal(page.changes[0]?.lifecycle, "validated");
    assert.deepEqual(page.changes[0]?.changedFiles, ["note.txt"]);
    assert.match(page.changes[0]?.diff ?? "", /after/u);
    assert.equal("root" in (page.changes[0] ?? {}), false);
    assert.equal("transactionStatePath" in (page.changes[0] ?? {}), false);

    const appliedUpdate = client.call("project-changes", "subscribe", [handle]) as Promise<{changes: Array<{lifecycle: string}>; rescan: boolean}>;
    const applied = await client.call("project-changes", "apply", [handle, transactionId]) as {lifecycle: string};
    assert.equal(applied.lifecycle, "applied");
    let observedApplied = await appliedUpdate;
    if (observedApplied.changes[0]?.lifecycle !== "applied") {
      observedApplied = await client.call("project-changes", "subscribe", [handle]) as typeof observedApplied;
    }
    assert.equal(observedApplied.changes[0]?.lifecycle, "applied");
    assert.equal(await readFile(notePath, "utf8"), "after\n");
    assert.equal(await client.call("project-changes", "close", [handle]), null);
    await client.close();

    client = open();
    handle = await client.call("project-changes", "start", []) as number;
    const restored = await client.call("project-changes", "get", [handle, transactionId]) as {lifecycle: string};
    assert.equal(restored.lifecycle, "applied");
    const rolledBackUpdate = client.call("project-changes", "subscribe", [handle]) as Promise<{changes: Array<{lifecycle: string}>; rescan: boolean}>;
    const rolledBack = await client.call("project-changes", "rollback", [handle, transactionId]) as {lifecycle: string};
    assert.equal(rolledBack.lifecycle, "rolled_back");
    assert.equal((await rolledBackUpdate).changes[0]?.lifecycle, "rolled_back");
    assert.equal(await readFile(notePath, "utf8"), "before\n");
    assert.equal(await client.call("project-changes", "close", [handle]), null);
    assert.equal((await readdir(project)).some((name) => name.includes("transaction") || name.includes("change")), false);
    assert.equal((await readdir(privateDirectory)).sort().join(","), "changes.jsonl,transactions.json");
  } finally {
    await client.close();
    await rm(directory, {recursive: true, force: true});
  }
});

desktopWorkerTest("Desktop Node capability host enforces filesystem, process, and network grants", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-worker-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const redirectCapture: { providerKey?: string } = {};
  const redirectServer = await localServer(undefined, redirectCapture);
  const ungrantedServer = await localServer();
  const unavailableServer = await localServer();
  const unavailableOrigin = `http://127.0.0.1:${addressPort(unavailableServer)}`;
  await closeServer(unavailableServer);
  const redirectOrigin = `http://127.0.0.1:${addressPort(redirectServer)}`;
  const ungrantedOrigin = `http://127.0.0.1:${addressPort(ungrantedServer)}`;
  const server = await localServer({ redirectOrigin, ungrantedOrigin });
  const origin = `http://127.0.0.1:${addressPort(server)}`;
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: {
      files: ["project", "app-data"],
      processes: [basename(process.execPath)],
      network: [origin, redirectOrigin, unavailableOrigin],
      secrets: ["VELAR_DESKTOP_TEST_SECRET", "VELAR_DESKTOP_MISSING_SECRET"],
    },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, VELAR_DESKTOP_TEST_SECRET: "worker-only-token" },
  });
  const client = new WorkerClient(worker);
  try {
    const competingCreates = await Promise.allSettled([
      client.call("fs", "createText", ["exclusive.txt", "first"]),
      client.call("fs", "createText", ["exclusive.txt", "second"]),
    ]);
    assert.equal(competingCreates.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(competingCreates.filter((item) => item.status === "rejected").length, 1);
    assert.match(String((competingCreates.find((item) => item.status === "rejected") as PromiseRejectedResult).reason), /createText target already exists/u);
    assert.ok(["first", "second"].includes(await client.call("fs", "readText", ["exclusive.txt", 1024]) as string));
    assert.equal(await client.call("fs", "writeText", ["optimistic.txt", "base"]), null);
    const competingReplacements = await Promise.all([
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "first"]),
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "second"]),
    ]);
    assert.deepEqual([...competingReplacements].sort(), [false, true]);
    assert.ok(["first", "second"].includes(await client.call("fs", "readText", ["optimistic.txt", 1024]) as string));
    assert.equal(await client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "stale", "lost"]), false);
    for (let iteration = 0; iteration < 16; iteration += 1) {
      await client.call("fs", "writeText", ["optimistic.txt", "base"]);
      await Promise.all([
        client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "replacement"]),
        client.call("fs", "writeText", ["optimistic.txt", "writer"]),
      ]);
      assert.equal(await client.call("fs", "readText", ["optimistic.txt", 1024]), "writer");
    }
    await client.call("fs", "writeText", ["optimistic.txt", "base"]);
    const [replaceBeforeAppend] = await Promise.all([
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "replacement"]),
      client.call("fs", "appendText", ["optimistic.txt", "!"]),
    ]);
    assert.equal(await client.call("fs", "readText", ["optimistic.txt", 1024]), replaceBeforeAppend ? "replacement!" : "base!");
    await client.call("fs", "writeText", ["optimistic.txt", "base"]);
    await Promise.allSettled([
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "replacement"]),
      client.call("fs", "removeFile", ["optimistic.txt"]),
    ]);
    assert.equal(await client.call("fs", "info", ["optimistic.txt"]), null);
    assert.equal(await client.call("fs", "writeText", ["note.txt", "Velar"]), null);
    assert.equal(await client.call("fs", "readText", ["note.txt", 1024]), "Velar");
    assert.deepEqual(await client.call("fs", "list", [".", 10]), ["exclusive.txt", "note.txt"]);
    assert.equal(await client.call("fs", "makeDirectory", ["nested/one/two"]), null);
    assert.equal(await client.call("fs", "writeText", ["nested/one/two/value.txt", "nested"]), null);
    assert.equal(await client.call("fs", "readText", ["nested/one/two/value.txt", 1024]), "nested");
    await assert.rejects(client.call("fs", "writeText", ["nested", "not-a-file"]), /requires a file path/u);
    await assert.rejects(client.call("fs", "appendText", ["nested", "not-a-file"]), /requires a file path/u);
    await assert.rejects(client.call("fs", "copyFile", ["nested", "nested-copy", false]), /regular file source/u);

    const outsideDirectory = join(directory, "outside");
    await mkdir(outsideDirectory);
    const insideTarget = join(project, "inside-target.txt");
    await writeFile(insideTarget, "inside", "utf8");
    const insideLink = join(project, "inside-link.txt");
    await symlink(insideTarget, insideLink);
    assert.equal((await client.call("fs", "info", [insideLink]) as { kind: string }).kind, "symlink");
    assert.equal(await client.call("fs", "removeFile", [insideLink]), null);
    assert.equal(await readFile(insideTarget, "utf8"), "inside");
    await symlink(insideTarget, insideLink);
    const movedLink = join(project, "moved-link.txt");
    assert.equal(await client.call("fs", "move", [insideLink, movedLink, false]), null);
    assert.equal((await client.call("fs", "info", [movedLink]) as { kind: string }).kind, "symlink");
    assert.equal(await readFile(insideTarget, "utf8"), "inside");

    const outsideMissing = join(outsideDirectory, "created-through-link.txt");
    const danglingLink = join(project, "dangling.txt");
    await symlink(outsideMissing, danglingLink);
    assert.equal((await client.call("fs", "info", [danglingLink]) as { kind: string }).kind, "symlink");
    await assert.rejects(client.call("fs", "writeText", [danglingLink, "escape"]), /dangling symbolic link/u);
    await assert.rejects(client.call("fs", "appendText", [danglingLink, "escape"]), /dangling symbolic link/u);
    await assert.rejects(readFile(outsideMissing, "utf8"), (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT");
    assert.equal(await client.call("fs", "removeFile", [danglingLink]), null);

    const insideDirectoryLink = join(project, "inside-directory-link");
    await symlink(join(project, "nested"), insideDirectoryLink);
    await assert.rejects(client.call("fs", "makeDirectory", [insideDirectoryLink]), /refuses a symbolic-link target/u);
    assert.equal(await client.call("fs", "makeDirectory", [join(insideDirectoryLink, "through-link")]), null);
    assert.equal((await client.call("fs", "info", [join(project, "nested", "through-link")]) as { kind: string }).kind, "directory");
    const outsideDirectoryLink = join(project, "outside-directory-link");
    await symlink(outsideDirectory, outsideDirectoryLink);
    await assert.rejects(client.call("fs", "makeDirectory", [join(outsideDirectoryLink, "escape")]), /outside granted Desktop file roots/u);
    await assert.rejects(client.call("fs", "move", [project, join(appData, "data", "project"), false]), /refuses a granted Desktop file root/u);
    const appDataFile = join(appData, "data", "audit.ndjson");
    assert.equal(await client.call("fs", "writeText", [appDataFile, "{}\n"]), null);
    assert.equal(await client.call("fs", "readText", [appDataFile, 1024]), "{}\n");
    const watcherHandle = await client.call("fs", "watchStart", [project, true]) as number;
    const externalChange = client.call("fs", "watchNext", [watcherHandle]) as Promise<{ paths: string[]; rescan: boolean }>;
    const externalPath = join(project, "external.vel");
    const externalBatch = await reportedChange(externalChange, externalPath, "the recursive Desktop project watch");
    assert.equal(externalBatch.rescan, false);
    assert.ok(externalBatch.paths.includes(await realpath(externalPath)));
    const pendingWatcherPull = client.call("fs", "watchNext", [watcherHandle]);
    const replacementProject = join(directory, "replacement-project");
    await mkdir(replacementProject);
    await writeFile(join(replacementProject, "replacement.txt"), "replacement", "utf8");
    const replacedProjectProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 0, maxOutputBytes: 65536 },
    ]) as { handle: number; pid: number };
    const projectReplacement = client.setProjectRoot(replacementProject);
    await assert.rejects(pendingWatcherPull, /project grant changed|cancelled|no longer active/u);
    await projectReplacement;
    assert.equal(await client.call("fs", "watchClose", [watcherHandle]), false);
    let replacedProjectProcessExists = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(replacedProjectProcess.pid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { replacedProjectProcessExists = false; break; }
    }
    assert.equal(replacedProjectProcessExists, false, "replacing a project grant must release project-owned processes");
    await assert.rejects(client.call("process", "wait", [replacedProjectProcess.handle]), /unknown or already released/u);
    assert.equal(await client.call("fs", "readText", ["replacement.txt", 1024]), "replacement");
    await assert.rejects(client.call("fs", "readText", [join(project, "note.txt"), 1024]), /outside granted Desktop file roots/u);
    assert.equal(await client.call("fs", "readText", [appDataFile, 1024]), "{}\n");
    const replacementCwd = await client.call("process", "run", [
      basename(process.execPath),
      ["-e", "process.stdout.write(process.cwd())"],
      { timeout: 5000, maxOutputBytes: 65536 },
    ]) as { stdout: string };
    assert.equal(replacementCwd.stdout, await realpath(replacementProject));
    const largeText = `large:${"界".repeat(400_000)}`;
    assert.equal(await client.call("fs", "writeText", ["large.txt", largeText]), null);
    assert.equal(await client.call("fs", "readText", ["large.txt", 2 * 1024 * 1024]), largeText);
    await assert.rejects(client.call("fs", "readText", [configPath, 1024]), /outside granted Desktop file roots/u);
    await assert.rejects(client.call("fs", "exists", [join(directory, "outside-missing.txt")]), /outside granted Desktop file roots/u);
    await assert.rejects(client.call("fs", "info", [join(directory, "outside-missing.txt")]), /outside granted Desktop file roots/u);

    const execution = await client.call("process", "run", [basename(process.execPath), ["--version"], { timeout: 5000, maxOutputBytes: 65536 }]) as {
      code: number;
      stdout: string;
    };
    assert.equal(execution.code, 0);
    assert.equal(execution.stdout.trim(), process.version);
    const started = await client.call("process", "start", [basename(process.execPath), ["--version"], { timeout: 5000, maxOutputBytes: 65536 }]) as {
      handle: number;
      pid: number;
    };
    assert.ok(started.handle > 0);
    assert.ok(started.pid > 0);
    const waitedOutcome = await client.call("process", "wait", [started.handle]) as {
      result: { code: number; stdout: string };
      error: null;
      retained: false;
    };
    const waited = waitedOutcome.result;
    assert.equal(waited.code, 0);
    assert.equal(waited.stdout.trim(), process.version);

    const streamedProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "const b=Buffer.from('界');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),25);setTimeout(()=>process.stderr.write('two'),50)"],
      { timeout: 1000, maxOutputBytes: 65536 },
    ]) as { handle: number; pid: number };
    const processOutput: Array<{ channel: string; text: string }> = [];
    while (true) {
      const chunk = await client.call("process", "read", [streamedProcess.handle]) as { channel: string; text: string } | null;
      if (chunk === null) break;
      processOutput.push(chunk);
    }
    assert.deepEqual(processOutput, [
      { channel: "stdout", text: "界" },
      { channel: "stderr", text: "two" },
    ]);
    assert.deepEqual(await client.call("process", "wait", [streamedProcess.handle]), {
      result: { code: 0, signal: null, stdout: "界", stderr: "two" },
      error: null,
      retained: false,
    });
    await assert.rejects(client.call("process", "read", [streamedProcess.handle]), /unknown or already released/u);

    const delayedProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "setTimeout(()=>process.stdout.write('ready'),100)"],
      { timeout: 1000, maxOutputBytes: 65536 },
    ]) as { handle: number };
    const firstProcessRead = client.call("process", "read", [delayedProcess.handle]);
    await assert.rejects(client.call("process", "read", [delayedProcess.handle]), /only one active pull/u);
    await assert.rejects(client.call("process", "wait", [delayedProcess.handle]), /while next\(\) is pending/u);
    assert.deepEqual(await firstProcessRead, { channel: "stdout", text: "ready" });
    assert.equal(await client.call("process", "read", [delayedProcess.handle]), null);
    await client.call("process", "wait", [delayedProcess.handle]);

    const longRunning = await client.call("process", "start", [basename(process.execPath), ["-e", "setTimeout(() => {}, 10000)"], { timeout: 0 }]) as {
      handle: number;
      pid: number;
    };
    assert.deepEqual(await client.call("process", "stop", [longRunning.handle]), {
      result: { code: null, signal: "SIGTERM", stdout: "", stderr: "" },
      error: null,
    });
    assert.deepEqual(await client.call("process", "stop", [longRunning.handle]), { result: null, error: null });
    await assert.rejects(client.call("process", "run", ["sh", ["-c", "echo unsafe"], {}]), /not granted/u);
    await assert.rejects(client.call("process", "run", [basename(process.execPath), ["--version"], { env: [["PATH", project]] }]), /cannot replace PATH/u);
    const largeStdin = "x".repeat(1200 * 1024);
    const stdinResult = await client.call("process", "run", [basename(process.execPath), ["-e", "let n=0;process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>console.log(n))"], {
      stdin: largeStdin,
      maxOutputBytes: 1024,
    }]) as { stdout: string };
    assert.equal(stdinResult.stdout.trim(), String(largeStdin.length));

    await assert.rejects(client.call("http", "request", [90, "POST", `${origin}/echo-size`, { body: { unsafe: true } }]), /validated text/u);
    await assert.rejects(client.call("http", "request", [91, "GET", `${origin}/stream`, { surprise: true }]), /unknown field 'surprise'/u);
    await assert.rejects(client.call("http", "request", [92, "BAD METHOD", `${origin}/stream`, {}]), /invalid or forbidden/u);
    await assert.rejects(client.call("http", "request", [93, "GET", "file:///tmp/value", {}]), /must use http or https/u);

    const response = await client.call("http", "request", [1, "GET", `${origin}/stream`, { maxBytes: 1024 }]) as {
      ok: boolean;
      status: number;
    };
    assert.deepEqual({ ok: response.ok, status: response.status }, { ok: true, status: 200 });
    const chunks: string[] = [];
    while (true) {
      const chunk = await client.call("http", "read", [1]) as { done: boolean; text: string };
      chunks.push(chunk.text);
      if (chunk.done) break;
    }
    assert.equal(chunks.join(""), "desktop-ready");
    assert.ok(chunks.filter(Boolean).length >= 2, JSON.stringify(chunks));

    await client.call("http", "request", [2, "GET", `${origin}/slow`, { maxBytes: 1024, timeout: 0 }]);
    assert.deepEqual(await client.call("http", "cancel", [2]), null);
    await assert.rejects(client.call("http", "read", [2]), /unknown or already released/u);
    await assert.rejects(client.call("http", "request", [3, "GET", "https://example.com/", {}]), /not granted/u);

    const redirected = await client.call("http", "request", [4, "GET", `${origin}/redirect-allowed`, { maxBytes: 1024 }]) as {
      status: number;
      url: string;
    };
    assert.equal(redirected.status, 200);
    assert.equal(redirected.url, `${redirectOrigin}/destination`);
    assert.deepEqual(await client.call("http", "read", [4]), { done: false, text: "desktop-ready" });
    assert.deepEqual(await client.call("http", "read", [4]), { done: true, text: "" });
    await assert.rejects(
      client.call("http", "request", [5, "GET", `${origin}/redirect-ungranted`, { maxBytes: 1024 }]),
      new RegExp(`Network origin '${ungrantedOrigin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}' is not granted`, "u"),
    );
    await assert.rejects(
      client.call("http", "request", [6, "GET", `${origin}/redirect-loop`, { maxBytes: 1024 }]),
      /redirect limit of 20 was exceeded/u,
    );
    const redirectedError = await client.call("http", "request", [15, "GET", `${origin}/redirect-error`, { maxBytes: 1024 }]) as {
      body: boolean;
      ok: boolean;
      status: number;
      url: string;
    };
    assert.deepEqual({
      body: redirectedError.body,
      ok: redirectedError.ok,
      status: redirectedError.status,
      url: redirectedError.url,
    }, {
      body: true,
      ok: false,
      status: 502,
      url: `${redirectOrigin}/error-target`,
    });
    assert.deepEqual(await client.call("http", "read", [15]), { done: false, text: '{"failed":true}' });
    assert.deepEqual(await client.call("http", "read", [15]), { done: true, text: "" });
    const posted = await client.call("http", "request", [7, "POST", `${origin}/echo-size`, { body: largeStdin, maxBytes: 1024 }]) as { status: number };
    assert.equal(posted.status, 200);
    assert.deepEqual(await client.call("http", "read", [7]), { done: false, text: String(largeStdin.length) });
    assert.deepEqual(await client.call("http", "read", [7]), { done: true, text: "" });
    await client.call("http", "request", [8, "GET", `${origin}/secret-authorized`, {
      secretHeaders: [{ name: "authorization", environment: "VELAR_DESKTOP_TEST_SECRET", prefix: "Bearer " }],
      maxBytes: 1024,
    }]);
    assert.deepEqual(await client.call("http", "read", [8]), { done: false, text: "authorized" });
    assert.deepEqual(await client.call("http", "read", [8]), { done: true, text: "" });
    await client.call("http", "request", [9, "GET", `${origin}/redirect-secret`, {
      secretHeaders: [{ name: "x-provider-key", environment: "VELAR_DESKTOP_TEST_SECRET", prefix: "" }],
      maxBytes: 1024,
    }]);
    assert.deepEqual(await client.call("http", "read", [9]), { done: false, text: "desktop-ready" });
    assert.deepEqual(await client.call("http", "read", [9]), { done: true, text: "" });
    assert.equal(redirectCapture.providerKey, undefined);
    await assert.rejects(client.call("http", "request", [10, "GET", `${origin}/stream`, {
      secretHeaders: [{ name: "authorization", environment: "UNGRANTED_SECRET", prefix: "" }],
    }]), /not granted by desktop\.permissions\.secrets/u);
    await assert.rejects(client.call("http", "request", [11, "GET", `${origin}/stream`, {
      secretHeaders: [{ name: "authorization", environment: "VELAR_DESKTOP_MISSING_SECRET", prefix: "" }],
    }]), /is unavailable/u);
    const empty = await client.call("http", "request", [12, "GET", `${origin}/empty`, { timeout: 10 }]) as { body: boolean; status: number };
    assert.deepEqual({ body: empty.body, status: empty.status }, { body: false, status: 204 });
    await assert.rejects(client.call("http", "read", [12]), /unknown or already released/u);
    const declared = await client.call("http", "request", [13, "GET", `${origin}/declared-large`, { maxBytes: 4 }]) as { body: boolean; status: number };
    assert.deepEqual({ body: declared.body, status: declared.status }, { body: true, status: 200 });
    await assert.rejects(client.call("http", "read", [13]), /exceeds maxBytes/u);
    const declaredHead = await client.call("http", "request", [14, "HEAD", `${origin}/declared-large`, { maxBytes: 4 }]) as { body: boolean; status: number };
    assert.deepEqual({ body: declaredHead.body, status: declaredHead.status }, { body: false, status: 200 });
    await assert.rejects(
      client.call("http", "request", [16, "GET", `${unavailableOrigin}/unavailable`, { timeout: 0 }]),
      (error: unknown) => error instanceof Error
        && (error as Error & { kind?: unknown }).kind === "http-transport"
        && (error as Error & { phase?: unknown }).phase === "request",
    );
    await client.call("http", "request", [17, "GET", `${origin}/transport-response`, { timeout: 0 }]);
    assert.deepEqual(await client.call("http", "read", [17]), { done: false, text: "partial" });
    await assert.rejects(
      client.call("http", "read", [17]),
      (error: unknown) => error instanceof Error
        && (error as Error & { kind?: unknown }).kind === "http-transport"
        && (error as Error & { phase?: unknown }).phase === "response",
    );

    const retiredOwner = "00000000000000000000000000000001";
    const replacementOwner = "00000000000000000000000000000002";
    const retiredProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 0, maxOutputBytes: 65536 },
    ]) as { handle: number; pid: number };
    await client.call("http", "request", [18, "GET", `${origin}/slow`, { maxBytes: 1024, timeout: 0 }]);
    client.useOwner(replacementOwner);
    await client.call("http", "request", [18, "GET", `${origin}/stream`, { maxBytes: 1024, timeout: 1000 }]);
    let replacementText = "";
    while (true) {
      const chunk = await client.call("http", "read", [18]) as { done: boolean; text: string };
      replacementText += chunk.text;
      if (chunk.done) break;
    }
    assert.equal(replacementText, "desktop-ready");
    await assert.rejects(
      client.call("process", "wait", [retiredProcess.handle]),
      /belongs to another document generation|unknown or already released/u,
    );
    let retiredProcessExists = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(retiredProcess.pid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { retiredProcessExists = false; break; }
    }
    assert.equal(retiredProcessExists, false, "activating a new document generation must reap the old document process");
    assert.ok(client.lifecycle().some((event) => event.hostEvent === "process-owned" && event.owner === retiredOwner && event.handle === retiredProcess.handle));

    const cancelledHttp = client.beginCall("http", "request", [19, "GET", `${origin}/slow-headers`, { maxBytes: 1024, timeout: 0 }]);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    client.cancelRequest(cancelledHttp.id);
    await assert.rejects(cancelledHttp.result, /request was cancelled/u);
    await client.call("http", "request", [19, "GET", `${origin}/stream`, { maxBytes: 1024, timeout: 1000 }]);
    assert.deepEqual(await client.call("http", "cancel", [19]), null);

    const cancellationEvents = client.lifecycle().length;
    const cancelledRun = client.beginCall("process", "run", [
      basename(process.execPath),
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 0, maxOutputBytes: 1024 },
    ]);
    let cancelledRunPid: number | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const event = client.lifecycle().slice(cancellationEvents).find((item) => item.hostEvent === "process-owned");
      if (event?.pid) { cancelledRunPid = event.pid; break; }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(cancelledRunPid !== null);
    client.cancelRequest(cancelledRun.id);
    await assert.rejects(cancelledRun.result, /request was cancelled/u);
    let cancelledRunExists = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(cancelledRunPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { cancelledRunExists = false; break; }
    }
    assert.equal(cancelledRunExists, false, "cancelling an in-flight process run must reap its hidden process owner");
  } finally {
    await client.close();
    await Promise.all([server, redirectServer, ungrantedServer].map(closeServer));
    await rm(directory, { recursive: true, force: true });
  }
});

desktopWorkerTest("Desktop process grants work independently from filesystem grants and keep wire bounds", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-process-only-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: {
      files: [],
      processes: [basename(process.execPath)],
      network: [],
    },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(worker);
  let escapedPid: number | null = null;
  try {
    const execution = await client.call("process", "run", [
      basename(process.execPath),
      ["-e", "process.stdout.write(process.cwd())"],
      { timeout: 5000, maxOutputBytes: 65536 },
    ]) as { code: number; stdout: string };
    assert.equal(execution.code, 0);
    assert.equal(execution.stdout, await realpath(project));
    assert.deepEqual(client.lifecycle().map((event) => event.hostEvent), ["process-owned", "process-settled"]);
    assert.equal(client.lifecycle()[0]?.handle, client.lifecycle()[1]?.handle);
    await assert.rejects(client.call("fs", "exists", ["."]), /no granted filesystem scope/u);
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["--version"], { cwd: project }]),
      /no granted filesystem scope/u,
    );
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["--version"], { unexpected: true }]),
      /unknown field 'unexpected'/u,
    );
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["x".repeat(600_000), "y".repeat(600_000)], {}]),
      /arguments cannot exceed 1 MiB/u,
    );
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["--version"], { env: [["FIRST", "x".repeat(600_000)], ["SECOND", "y".repeat(600_000)]] }]),
      /env cannot exceed 1 MiB/u,
    );
    if (process.platform !== "win32") {
      const timeoutDirectory = await mkdtemp(join(tmpdir(), "velar-desktop-timeout-"));
      try {
        const pidFile = join(timeoutDirectory, "descendant.pid");
        const timeoutStartedAt = Date.now();
        await assert.rejects(client.call("process", "run", [
          basename(process.execPath),
          ["-e", `
const {spawn} = require("node:child_process");
const {writeFileSync} = require("node:fs");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
writeFileSync(process.env.PID_FILE, String(descendant.pid));
setInterval(() => {}, 1000);
          `],
          { env: [["PID_FILE", pidFile]], timeout: 200, maxOutputBytes: 65536 },
        ]), /timed out after 200 milliseconds/u);
        assert.ok(Date.now() - timeoutStartedAt < 8_000, "Desktop process.run timeout must converge through post-exit pipes");
        escapedPid = Number(await readFile(pidFile, "utf8"));
        assert.equal(Number.isSafeInteger(escapedPid), true);
        assert.doesNotThrow(() => process.kill(escapedPid as number, 0));
        terminateProcessGroup(escapedPid);
        escapedPid = null;
      } finally {
        await rm(timeoutDirectory, { recursive: true, force: true });
      }

      const abandonedOutput = await client.call("process", "start", [
        basename(process.execPath),
        ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
process.stdout.write(String(descendant.pid) + "\\n");
        `],
        { timeout: 0, maxOutputBytes: 65536 },
      ]) as { handle: number };
      let abandonedPidText = "";
      while (!abandonedPidText.includes("\n")) {
        const output = await client.call("process", "read", [abandonedOutput.handle]) as { text: string } | null;
        assert.ok(output);
        abandonedPidText += output.text;
      }
      const abandonedPid = Number(abandonedPidText.trim());
      assert.equal(Number.isSafeInteger(abandonedPid), true);
      escapedPid = abandonedPid;
      const outputDeadlineStartedAt = Date.now();
      await assert.rejects(
        client.call("process", "read", [abandonedOutput.handle]),
        /output streams did not close within 5000 milliseconds after process exit/u,
      );
      assert.ok(Date.now() - outputDeadlineStartedAt < 8_000, "Desktop process output must reject within its post-exit pipe deadline");
      assert.deepEqual(await client.call("process", "wait", [abandonedOutput.handle]), {
        result: null,
        error: { name: "Error", message: "Process output streams did not close within 5000 milliseconds after process exit" },
        retained: false,
      });
      assert.doesNotThrow(() => process.kill(abandonedPid, 0));
      terminateProcessGroup(abandonedPid);
      escapedPid = null;

      const escaped = await client.call("process", "start", [
        basename(process.execPath),
        ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
process.stdout.write(String(descendant.pid) + "\\n");
setInterval(() => {}, 1000);
        `],
        { timeout: 0, maxOutputBytes: 65536 },
      ]) as { handle: number };
      let escapedPidText = "";
      while (!escapedPidText.includes("\n")) {
        const output = await client.call("process", "read", [escaped.handle]) as { text: string } | null;
        assert.ok(output);
        escapedPidText += output.text;
      }
      escapedPid = Number(escapedPidText.trim());
      assert.equal(Number.isSafeInteger(escapedPid), true);
      const escapedWait = client.call("process", "wait", [escaped.handle]) as Promise<{
        result: { signal: string | null } | null;
        error: { name: string; message: string } | null;
        retained: boolean;
      }>;
      const stopStartedAt = Date.now();
      await assert.rejects(
        client.call("process", "stop", [escaped.handle]),
        /termination could not be confirmed within 5000 milliseconds/u,
      );
      assert.deepEqual(await escapedWait, {
        result: null,
        error: { name: "Error", message: "Process termination could not be confirmed within 5000 milliseconds" },
        retained: true,
      });
      assert.ok(Date.now() - stopStartedAt < 8_000, "Desktop Process.stop must reject within its owned confirmation deadline");
      assert.doesNotThrow(() => process.kill(escapedPid as number, 0));
      terminateProcessGroup(escapedPid);
      const waited = await client.call("process", "wait", [escaped.handle]) as { result: { signal: string | null } | null };
      assert.notEqual(waited.result?.signal ?? null, null);
      escapedPid = null;
    }
  } finally {
    if (escapedPid !== null) terminateProcessGroup(escapedPid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

desktopWorkerTest("Desktop capability host drains transferred process ownership before a fatal exit", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-worker-crash-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: [], processes: [basename(process.execPath)], network: [] },
  }), "utf8");
  const source = (await readFile(workerPath, "utf8")).replace(
    'from "./project-transactions.js"',
    `from ${JSON.stringify(pathToFileURL(resolve("packages/desktop/native/node/project-transactions.js")).href)}`,
  );
  const crashingSource = source.replace(
    'task.kind = "process";\n  processHandles.set(handle, task);\n  // The native shell becomes the crash-recovery owner before the renderer\n  // receives the public start/run result.\n  respond({ protocolVersion: 1, hostEvent: "process-owned", owner, handle, pid: task.pid });',
    'task.kind = "process";\n  processHandles.set(handle, task);\n  // The native shell becomes the crash-recovery owner before the renderer\n  // receives the public start/run result.\n  respond({ protocolVersion: 1, hostEvent: "process-owned", owner, handle, pid: task.pid }); setTimeout(() => { throw new Error("injected Desktop worker crash"); }, 100); await new Promise(() => {});',
  );
  assert.notEqual(crashingSource, source);
  const crashingWorker = join(directory, "worker.mjs");
  await writeFile(crashingWorker, crashingSource, "utf8");
  const child = spawn(process.execPath, [crashingWorker, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(child);
  let ownedPid: number | null = null;
  try {
    await assert.rejects(
      client.call("process", "start", [basename(process.execPath), ["-e", "setInterval(() => {}, 1000)"], {timeout: 0, maxOutputBytes: 65536}]),
      /Desktop worker exited/u,
    );
    const ownership = client.lifecycle().find((event) => event.hostEvent === "process-owned");
    assert.ok(ownership && Number.isSafeInteger(ownership.pid));
    ownedPid = ownership.pid as number;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(ownedPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { ownedPid = null; break; }
    }
    assert.equal(ownedPid, null, "the Desktop worker must reap its child before fatal exit");
  } finally {
    if (ownedPid !== null) terminateProcessGroup(ownedPid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function terminateProcessGroup(pid: number): void {
  try { process.kill(-pid, "SIGKILL"); }
  catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}

async function waitForPidsToExit(pids: ReadonlySet<number>, timeout: number): Promise<void> {
  const remaining = new Set(pids);
  const deadline = Date.now() + timeout;
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of remaining) {
      try { process.kill(pid, 0); }
      catch { remaining.delete(pid); }
    }
    if (remaining.size > 0) await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  assert.deepEqual([...remaining], [], `Desktop left terminal processes alive: ${[...remaining].join(", ")}`);
}

async function compileTerminalHost(output: string): Promise<void> {
  const child = spawn("/usr/bin/swiftc", [
    "-Osize", "-whole-module-optimization", "-swift-version", "5",
    resolve("packages/desktop/native/macos/VelarTerminalHost.swift"), "-o", output,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", chunk => { diagnostics += chunk.toString("utf8"); });
  child.stderr.on("data", chunk => { diagnostics += chunk.toString("utf8"); });
  const exited = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", resolveExit);
  });
  let code: number | null;
  try { code = await withDeadline(exited, "the bundled terminal-host Swift compilation", TERMINAL_HOST_COMPILE_TIMEOUT_MS); }
  catch (error) {
    // A compiler that never exits (a module-cache lock left behind by a killed
    // run is the usual reason) must fail this test, not park the whole suite.
    child.kill("SIGKILL");
    throw new Error(`${error instanceof Error ? error.message : String(error)}; swiftc pid ${child.pid ?? 0} was killed. Diagnostics so far: ${diagnostics || "(none)"}`);
  }
  assert.equal(code, 0, diagnostics);
}

/**
 * Awaits one reported filesystem change, re-triggering it while the pull is
 * outstanding. `fs.watch` with `recursive: true` arms its macOS FSEvents
 * stream asynchronously on another thread, so a write that lands before the
 * stream starts is never reported — under concurrent load that happens for
 * roughly one pull in ten, and the pull then never settles.
 */
async function reportedChange<T>(pull: Promise<T>, path: string, label: string): Promise<T> {
  let settled = false;
  const outcome = pull.finally(() => { settled = true; });
  const deadline = Date.now() + WATCHED_CHANGE_TIMEOUT_MS;
  while (!settled) {
    await writeFile(path, "const external = true\n", "utf8");
    if (Date.now() >= deadline) {
      throw new Error(`${label} never reported ${path} within ${WATCHED_CHANGE_TIMEOUT_MS} milliseconds of repeated changes; the operating-system watch is not delivering notifications for this root.`);
    }
    await Promise.race([outcome.catch(() => {}), new Promise((resolveWait) => setTimeout(resolveWait, WATCHED_CHANGE_RETRIGGER_MS))]);
  }
  return outcome;
}

function withDeadline<T>(value: Promise<T>, label: string, timeout = 5_000): Promise<T> {
  return new Promise<T>((resolveValue, rejectValue) => {
    const timer = setTimeout(() => rejectValue(new Error(`${label} did not settle within ${timeout} milliseconds`)), timeout);
    void value.then(
      result => { clearTimeout(timer); resolveValue(result); },
      error => { clearTimeout(timer); rejectValue(error); },
    );
  });
}

class WorkerClient {
  private nextId = 1;
  private nextProjectRootCommandID = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly projectRootUpdates = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private readonly lifecycleEvents: Array<{ hostEvent: string; owner: string; handle: number; pid?: number; pids?: number[] }> = [];
  private readonly child: ChildProcessWithoutNullStreams;
  private owner = "00000000000000000000000000000001";

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    // A worker that never spawns (EAGAIN under concurrent load) emits 'error'
    // and never 'exit', and a broken pipe reports on the stream, so both have
    // to fail the outstanding calls instead of leaving them outstanding.
    child.once("error", (error) => this.failOutstanding(new Error(`Desktop worker could not be spawned or signalled: ${error.message}`)));
    child.stdin.on("error", (error) => this.failOutstanding(new Error(`Desktop worker request pipe failed: ${error.message}`)));
    child.stdout.on("error", (error) => this.failOutstanding(new Error(`Desktop worker response pipe failed: ${error.message}`)));
    this.writeHostCommand("owner-activate", this.owner);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const message = JSON.parse(line) as { id: number; ok: boolean; value?: unknown; error?: string | { kind?: unknown; message?: unknown; phase?: unknown }; hostEvent?: string; owner?: string; handle?: number; pid?: number; pids?: number[]; commandID?: number };
      if (message.hostEvent === "project-root-settled" && Number.isSafeInteger(message.commandID)) {
        const update = this.projectRootUpdates.get(message.commandID as number);
        if (!update) return;
        this.projectRootUpdates.delete(message.commandID as number);
        if (message.ok) update.resolve();
        else update.reject(new Error(typeof message.error === "string" ? message.error : "Desktop project-root update failed"));
        return;
      }
      if ((message.hostEvent === "process-owned" || message.hostEvent === "process-settled"
        || message.hostEvent === "language-server-owned" || message.hostEvent === "language-server-settled"
        || message.hostEvent === "terminal-owned" || message.hostEvent === "terminal-settled")
        && Number.isSafeInteger(message.handle) && typeof message.owner === "string") {
        this.lifecycleEvents.push({ hostEvent: message.hostEvent, owner: message.owner, handle: message.handle as number,
          ...(Number.isSafeInteger(message.pid) ? {pid: message.pid} : {}),
          ...(Array.isArray(message.pids) && message.pids.every(Number.isSafeInteger) ? {pids: message.pids} : {}) });
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else if (message.error && typeof message.error === "object"
        && message.error.kind === "http-transport"
        && typeof message.error.message === "string"
        && (message.error.phase === "request" || message.error.phase === "response")) {
        const error = new Error(message.error.message) as Error & { kind?: string; phase?: string };
        error.kind = message.error.kind;
        error.phase = message.error.phase;
        request.reject(error);
      } else request.reject(new Error(typeof message.error === "string" ? message.error : "Desktop worker failed"));
    });
    child.once("exit", () => this.failOutstanding(new Error("Desktop worker exited")));
  }

  private failOutstanding(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    for (const update of this.projectRootUpdates.values()) update.reject(error);
    this.projectRootUpdates.clear();
  }

  /**
   * Every reply is bounded. Without this a reply the worker never sends — a
   * lost handshake, a wedged child, an OS notification that never armed —
   * parks the suite forever at 0% CPU with no output at all.
   */
  private deadline<T>(value: Promise<T>, label: string, timeout: number): Promise<T> {
    return withDeadline(value, label, timeout).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("did not settle within")) throw error;
      const state = this.child.exitCode !== null ? `exited with code ${this.child.exitCode}`
        : this.child.signalCode !== null ? `was killed by ${this.child.signalCode}`
        : "is still running and idle";
      throw new Error(`${error.message}; the Desktop worker (pid ${this.child.pid ?? 0}) ${state}. Likely causes: a stale worker or descendant orphaned by a killed run, a wedged bundled child holding the reply, or an operating-system notification that never arrived.`);
    });
  }

  call(capability: string, operation: string, args: readonly unknown[]): Promise<unknown> {
    return this.beginCall(capability, operation, args).result;
  }

  beginCall(capability: string, operation: string, args: readonly unknown[]): { id: number; result: Promise<unknown> } {
    const id = this.nextId++;
    const reply = new Promise<unknown>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall }));
    const timeout = capability === "project-task" ? PROJECT_TASK_CALL_TIMEOUT_MS : WORKER_CALL_TIMEOUT_MS;
    const result = this.deadline(reply, `Desktop worker call #${id} ${capability}.${operation}`, timeout)
      .finally(() => this.pending.delete(id));
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, id, owner: this.owner, capability, operation, args })}\n`);
    return { id, result };
  }

  cancelRequest(requestID: number): void {
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, hostCommand: "request-cancel", owner: this.owner, requestID })}\n`);
  }

  setProjectRoot(path: string): Promise<void> {
    const commandID = this.nextProjectRootCommandID++;
    const settled = new Promise<void>((resolveUpdate, rejectUpdate) => this.projectRootUpdates.set(commandID, { resolve: resolveUpdate, reject: rejectUpdate }));
    const result = this.deadline(settled, `Desktop project-root command #${commandID}`, WORKER_CALL_TIMEOUT_MS)
      .finally(() => this.projectRootUpdates.delete(commandID));
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, hostCommand: "project-root-set", owner: this.owner, commandID, path })}\n`);
    return result;
  }

  useOwner(owner: string): void {
    this.writeHostCommand("owner-activate", owner);
    this.owner = owner;
  }

  retireOwner(): void {
    this.writeHostCommand("owner-retire", this.owner);
  }

  lifecycle(): readonly { hostEvent: string; owner: string; handle: number; pid?: number; pids?: number[] }[] {
    return this.lifecycleEvents;
  }

  private writeHostCommand(hostCommand: string, owner: string): void {
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, hostCommand, owner })}\n`);
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    if (await this.waitForExit(2_000)) return;
    this.child.kill("SIGKILL");
    if (!await this.waitForExit(2_000)) throw new Error("Desktop worker did not exit after SIGKILL");
  }

  private waitForExit(timeout: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolveExit) => {
      const onExit = (): void => {
        clearTimeout(timer);
        resolveExit(true);
      };
      const timer = setTimeout(() => {
        this.child.off("exit", onExit);
        resolveExit(false);
      }, timeout);
      this.child.once("exit", onExit);
    });
  }
}

function localServer(
  redirects?: { redirectOrigin: string; ungrantedOrigin: string },
  capture?: { providerKey?: string },
): Promise<Server> {
  const server = createServer((request, response) => {
    if (typeof request.headers["x-provider-key"] === "string" && capture) capture.providerKey = request.headers["x-provider-key"];
    if (request.url === "/secret-authorized") {
      const authorized = request.headers.authorization === "Bearer worker-only-token";
      response.writeHead(authorized ? 200 : 401, { "content-type": "text/plain" });
      response.end(authorized ? "authorized" : "denied");
      return;
    }
    if (request.url === "/echo-size") {
      let bytes = 0;
      request.on("data", (chunk) => { bytes += chunk.byteLength; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(String(bytes));
      });
      return;
    }
    if (redirects && request.url === "/redirect-allowed") {
      response.writeHead(302, { location: `${redirects.redirectOrigin}/destination` });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-ungranted") {
      response.writeHead(302, { location: `${redirects.ungrantedOrigin}/destination` });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-loop") {
      response.writeHead(302, { location: "/redirect-loop" });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-secret") {
      response.writeHead(302, { location: `${redirects.redirectOrigin}/secret-target` });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-error") {
      response.writeHead(302, { location: `${redirects.redirectOrigin}/error-target` });
      response.end();
      return;
    }
    if (request.url === "/error-target") {
      response.writeHead(502, { "content-type": "application/json" });
      response.end('{"failed":true}');
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/declared-large") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.end("x");
      return;
    }
    if (request.url === "/transport-response") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 10);
      return;
    }
    if (request.url === "/slow-headers") {
      setTimeout(() => { response.writeHead(200, { "content-type": "text/plain" }); response.end("late"); }, 10000).unref();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    if (request.url === "/stream") {
      response.write("desktop-");
      setTimeout(() => response.end("ready"), 25);
    } else if (request.url === "/slow") {
      response.write("pending");
      setTimeout(() => response.end("late"), 10000).unref();
    } else {
      response.end("desktop-ready");
    }
  });
  return withDeadline(new Promise<Server>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  }), "the local Desktop worker test server listen", LOCAL_SERVER_TIMEOUT_MS);
}

function closeServer(server: Server): Promise<void> {
  // close() alone waits for every open connection, and these handlers keep
  // deliberately slow responses in flight, so drop the sockets first.
  server.closeAllConnections();
  return withDeadline(
    new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
    "the local Desktop worker test server close",
    LOCAL_SERVER_TIMEOUT_MS,
  );
}

function addressPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop worker test server has no TCP port");
  return address.port;
}
