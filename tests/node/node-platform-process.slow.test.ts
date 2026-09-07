import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { VELAR_NODE_PROCESS_WORKER_SOURCE } from "../../packages/node/src/runtime-sources.generated.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is `velar/process`: what the process Worker keeps alive, what it
 * releases when nobody is watching, and the handle it must retain until a
 * termination it asked for is confirmed.
 */

test("Node process worker keeps an unobserved active child alive and releases the idle module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-process-worker-lifecycle-"));
  try {
    const source = nodeModuleSources.get("velar/process");
    assert.ok(source);
    const marker = join(directory, "finished.txt");
    const childSource = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "done"), 150)`;
    await writeFile(join(directory, "process.mjs"), source, "utf8");
    await writeFile(join(directory, "runner.mjs"), `
import {start} from "./process.mjs"
await start(process.execPath, ["-e", ${JSON.stringify(childSource)}], {timeout: 1000})
`.trimStart(), "utf8");
    const startedAt = Date.now();
    const runner = spawn(process.execPath, [join(directory, "runner.mjs")], {cwd: directory, env: process.env, stdio: ["ignore", "pipe", "pipe"]});
    let stderr = "";
    runner.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        runner.kill("SIGKILL");
        rejectExit(new Error("Node process worker did not release its idle module"));
      }, 5000);
      runner.once("error", (error) => { clearTimeout(timer); rejectExit(error); });
      runner.once("exit", (value) => { clearTimeout(timer); resolveExit(value); });
    });
    assert.equal(code, 0, stderr);
    assert.ok(Date.now() - startedAt >= 100, "the runner exited before its unobserved child settled");
    assert.equal(await readFile(marker, "utf8"), "done");
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("Node process wait retains a timed-out handle until termination is confirmed", async () => {
  if (process.platform === "win32") return;
  const delayedSignalSource = VELAR_NODE_PROCESS_WORKER_SOURCE.replace(
    "function signalTree(child, signal) {\n  if (!child.pid) return;",
    "let suppressedProcessSignals = 1;\nfunction signalTree(child, signal) {\n  if (suppressedProcessSignals > 0) { suppressedProcessSignals -= 1; return; }\n  if (!child.pid) return;",
  );
  assert.notEqual(delayedSignalSource, VELAR_NODE_PROCESS_WORKER_SOURCE);
  const channel = new MessageChannel();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 1;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const worker = new Worker(delayedSignalSource, {
    eval: true,
    workerData: channel.port2,
    transferList: [channel.port2],
  });
  channel.port1.on("message", (message: {
    kind?: unknown;
    id?: unknown;
    ok?: unknown;
    value?: unknown;
    error?: { message?: unknown };
  }) => {
    if (message.kind === "ready") {
      readyResolve?.();
      return;
    }
    if (message.kind !== "response" || !Number.isSafeInteger(message.id)) return;
    const request = pending.get(message.id as number);
    if (!request) return;
    pending.delete(message.id as number);
    if (message.ok === true) request.resolve(message.value);
    else request.reject(new Error(typeof message.error?.message === "string" ? message.error.message : "Process worker request failed"));
  });
  worker.once("error", (error) => {
    const failure = error instanceof Error ? error : new Error("Process worker failed");
    readyReject?.(failure);
    for (const request of pending.values()) request.reject(failure);
    pending.clear();
  });
  const call = (operation: string, args: readonly unknown[]): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolveCall, rejectCall) => {
      pending.set(id, { resolve: resolveCall, reject: rejectCall });
      channel.port1.postMessage({ id, operation, args });
    });
  };
  let childPid: number | null = null;
  try {
    await ready;
    const started = await call("start", [process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: undefined,
      env: {},
      stdin: "",
      timeout: 10,
      maxOutputBytes: 65536,
    }]) as { handle: number; pid: number };
    childPid = started.pid;
    const waitStartedAt = Date.now();
    assert.deepEqual(await call("wait", [started.handle]), {
      result: null,
      error: { name: "Error", message: "Process termination could not be confirmed within 5000 milliseconds" },
      retained: true,
    });
    assert.ok(Date.now() - waitStartedAt < 8_000, "Process.wait must bound an unconfirmed execution timeout");
    assert.doesNotThrow(() => process.kill(childPid as number, 0));
    const terminal = await call("wait", [started.handle]) as {
      result: unknown;
      error: { name: string; message: string } | null;
      retained: boolean;
    };
    assert.equal(terminal.result, null);
    assert.equal(terminal.error?.message, "Process timed out after 10 milliseconds");
    assert.equal(terminal.retained, false);
    assert.throws(() => process.kill(childPid as number, 0), (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH");
    childPid = null;
  } finally {
    if (childPid !== null) {
      try { process.kill(-childPid, "SIGKILL"); }
      catch { try { process.kill(childPid, "SIGKILL"); } catch {} }
    }
    channel.port1.close();
    await worker.terminate();
  }
});
