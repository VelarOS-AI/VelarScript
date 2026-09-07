import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { nodeModuleSources, VELAR_NODE_HOST_MODULE } from "../../packages/node/src/compiler.ts";
import { VELAR_NODE_HOST_WORKER_SOURCE, VELAR_NODE_PROCESS_WORKER_SOURCE, VELAR_NODE_TERMINAL_WORKER_SOURCE } from "../../packages/node/src/runtime-sources.generated.ts";
import { runProcess, runtime } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is the Worker host `velar/host` owns: what `onShutdown` may
 * register and how long a graceful exit may take, and — the one case that
 * poisons all three Workers in turn rather than one module's — what a crashed
 * host owes the calls that arrive after it.
 */

test("Node worker crashes fail closed and drain transferred process ownership", async () => {
  const crashingHostWorker = VELAR_NODE_HOST_WORKER_SOURCE.replace(
    'port.on("message", value => {',
    'port.on("message", value => { process.exit(71);',
  );
  assert.notEqual(crashingHostWorker, VELAR_NODE_HOST_WORKER_SOURCE);
  const filesystem = await runtime<{ exists(path: string): Promise<boolean> }>(
    "velar/fs",
    (source) => source,
    (name, source) => name === VELAR_NODE_HOST_MODULE
      ? source.replace(JSON.stringify(VELAR_NODE_HOST_WORKER_SOURCE), JSON.stringify(crashingHostWorker))
      : source,
  );
  let hostFailure: unknown = null;
  try { await filesystem.exists("."); } catch (error) { hostFailure = error; }
  assert.ok(hostFailure instanceof Error);
  const hostRetryStartedAt = Date.now();
  await assert.rejects(filesystem.exists("."), (error: unknown) => error === hostFailure);
  assert.ok(Date.now() - hostRetryStartedAt < 500, "a failed Node host must reject future work without posting to its dead port");

  const crashingTerminalWorker = VELAR_NODE_TERMINAL_WORKER_SOURCE.replace(
    'port.on("message", value => {',
    'port.on("message", value => { process.exit(72);',
  );
  assert.notEqual(crashingTerminalWorker, VELAR_NODE_TERMINAL_WORKER_SOURCE);
  const terminalRuntime = await runtime<{ terminal: { write(text: string): Promise<null> } }>(
    "velar/terminal",
    (source) => source.replace(JSON.stringify(VELAR_NODE_TERMINAL_WORKER_SOURCE), JSON.stringify(crashingTerminalWorker)),
  );
  let terminalFailure: unknown = null;
  try { await terminalRuntime.terminal.write("first"); } catch (error) { terminalFailure = error; }
  assert.ok(terminalFailure instanceof Error);
  const terminalRetryStartedAt = Date.now();
  await assert.rejects(terminalRuntime.terminal.write("second"), (error: unknown) => error === terminalFailure);
  assert.ok(Date.now() - terminalRetryStartedAt < 500, "a failed terminal host must not disguise its failure as normal closure");

  const directory = await mkdtemp(join(tmpdir(), "velar-node-process-worker-crash-"));
  const pidFile = join(directory, "pid.txt");
  let childPid: number | null = null;
  try {
    const withoutWorkerExitCleanup = VELAR_NODE_PROCESS_WORKER_SOURCE.replace(
      'process.once("exit", () => {\n  for (const task of processHandles.values()) signalTree(task.child, "SIGKILL");\n});\n',
      "",
    );
    assert.notEqual(withoutWorkerExitCleanup, VELAR_NODE_PROCESS_WORKER_SOURCE);
    const crashingProcessWorker = withoutWorkerExitCleanup.replace(
      'send({kind: "owned", handle, pid: task.pid});',
      'send({kind: "owned", handle, pid: task.pid}); setTimeout(() => { throw new Error("injected process Worker crash"); }, 100); await new Promise(() => {});',
    );
    assert.notEqual(crashingProcessWorker, withoutWorkerExitCleanup);
    const processRuntime = await runtime<{
      start(command: string, args: readonly string[], options: Record<string, unknown>): Promise<unknown>;
    }>(
      "velar/process",
      (source) => source.replace(JSON.stringify(VELAR_NODE_PROCESS_WORKER_SOURCE), JSON.stringify(crashingProcessWorker)),
    );
    const childSource = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    let processFailure: unknown = null;
    try {
      await processRuntime.start(process.execPath, ["-e", childSource], {timeout: 0, maxOutputBytes: 65536});
    } catch (error) { processFailure = error; }
    assert.ok(processFailure instanceof Error);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { childPid = Number(await readFile(pidFile, "utf8")); break; }
      catch { await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
    }
    assert.ok(childPid !== null && Number.isSafeInteger(childPid));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(childPid as number, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { childPid = null; break; }
    }
    assert.equal(childPid, null, "the process host crash path must reap a transferred child owner");
    const processRetryStartedAt = Date.now();
    await assert.rejects(
      processRuntime.start(process.execPath, ["-e", "process.exit(0)"], {timeout: 1000, maxOutputBytes: 65536}),
      (error: unknown) => error === processFailure,
    );
    assert.ok(Date.now() - processRetryStartedAt < 500, "a failed process host must reject future starts without posting to its dead port");
  } finally {
    if (childPid !== null) {
      try { process.kill(-childPid, "SIGKILL"); }
      catch { try { process.kill(childPid, "SIGKILL"); } catch {} }
    }
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node shutdown bounds cleanup registration and total graceful-exit time", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-host-lifecycle-"));
  try {
    const source = nodeModuleSources.get("velar/host");
    assert.ok(source);
    const focused = source
      .replace("const maxShutdownCleanups = 1024;", "const maxShutdownCleanups = 2;")
      .replace("const shutdownTimeoutMs = 30000;", "const shutdownTimeoutMs = 50;");
    await writeFile(join(directory, "host.mjs"), focused, "utf8");
    await writeFile(join(directory, "limit.mjs"), `
import {onShutdown} from "./host.mjs";
onShutdown(async () => null);
onShutdown(async () => null);
try { onShutdown(async () => null); }
catch (error) { console.log(error.message); }
process.exit(0);
`.trimStart(), "utf8");
    const limited = await runProcess(process.execPath, [join(directory, "limit.mjs")], directory, process.env);
    assert.equal(limited.code, 0, limited.stderr);
    assert.equal(limited.stdout, "onShutdown cannot register more than 1024 cleanups\n");

    await writeFile(join(directory, "timeout.mjs"), `
import {onShutdown} from "./host.mjs";
onShutdown(async () => new Promise(() => {}));
setInterval(() => {}, 1000);
console.log("READY");
`.trimStart(), "utf8");
    const child = spawn(process.execPath, [join(directory, "timeout.mjs")], { cwd: directory, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => rejectReady(new Error(`host runtime did not become ready: ${stdout}\n${stderr}`)), 2_000);
      const inspect = () => {
        if (!stdout.includes("READY\n")) return;
        clearTimeout(timer);
        child.stdout.off("data", inspect);
        resolveReady();
      };
      child.stdout.on("data", inspect);
      inspect();
    });
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); rejectExit(new Error(`host runtime did not enforce its shutdown deadline: ${stdout}\n${stderr}`)); }, 2_000);
      child.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 1, stderr);
    assert.match(stderr, /Shutdown cleanup timed out after 50 ms/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
