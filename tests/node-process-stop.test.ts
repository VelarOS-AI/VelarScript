import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import { VELAR_NODE_PROCESS_WORKER_SOURCE } from "../packages/node/src/process-worker-runtime.ts";

type ProcessOutcome = {
  readonly result: { readonly code: number | null; readonly signal: string | null; readonly stdout: string; readonly stderr: string } | null;
  readonly error: { readonly name: string; readonly message: string } | null;
  readonly retained?: boolean;
};

type ProcessWorkerHarness = {
  call(operation: string, args: readonly unknown[]): Promise<unknown>;
  close(): Promise<void>;
};

/**
 * Drives one compiler-owned process Worker over its private request protocol,
 * the same way the emitted `velar/process` proxy does. Tests that need a host
 * condition the application surface cannot produce patch the Worker source and
 * speak the protocol directly.
 */
async function processWorker(source: string = VELAR_NODE_PROCESS_WORKER_SOURCE): Promise<ProcessWorkerHarness> {
  const channel = new MessageChannel();
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 1;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const worker = new Worker(source, { eval: true, workerData: channel.port2, transferList: [channel.port2] });
  channel.port1.on("message", (message: { kind?: unknown; id?: unknown; ok?: unknown; value?: unknown; error?: { message?: unknown } }) => {
    if (message.kind === "ready") { readyResolve?.(); return; }
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
  await ready;
  return {
    call(operation, args) {
      const id = nextId++;
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
        channel.port1.postMessage({ id, operation, args });
      });
    },
    async close() {
      channel.port1.close();
      await worker.terminate();
    },
  };
}

function startArguments(script: string, timeout = 0): readonly unknown[] {
  return [process.execPath, ["-e", script], { cwd: undefined, env: {}, stdin: "", timeout, maxOutputBytes: 65536 }];
}

/**
 * Replaces the group-exit poll with a permission failure, the answer macOS
 * gives when the freed process group id has already been recycled to a process
 * this Realm may not signal.
 */
const PERMISSION_DENIED_GROUP_POLL = VELAR_NODE_PROCESS_WORKER_SOURCE.replace(
  "    try { process.kill(-child.pid, 0); }",
  "    try { const denied = new Error(\"kill EPERM\"); denied.code = \"EPERM\"; throw denied; }",
);

test("stopping a child that already exited resolves cleanly", async () => {
  if (process.platform === "win32") return;
  const host = await processWorker();
  try {
    const started = await host.call("start", startArguments("process.stdout.write('done')")) as { handle: number; pid: number };
    // Drain to end of output: the child is gone before stop() is ever issued.
    while (await host.call("read", [started.handle]) !== null) continue;
    const stopped = await host.call("stop", [started.handle]) as ProcessOutcome;
    assert.equal(stopped.error, null, "a child that exited on its own must not make stop() report a failure");
    assert.equal(stopped.result?.stdout, "done");
    assert.throws(
      () => process.kill(started.pid, 0),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
    );
  } finally {
    await host.close();
  }
});

test("a stop racing natural exit resolves once", async () => {
  if (process.platform === "win32") return;
  const host = await processWorker();
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const started = await host.call("start", startArguments("setTimeout(() => process.stdout.write('late'), 30)")) as { handle: number; pid: number };
      await new Promise((resolve) => setTimeout(resolve, 30));
      const stopped = await host.call("stop", [started.handle]) as ProcessOutcome;
      assert.equal(stopped.error, null, `stop racing natural exit must not report a failure (attempt ${attempt})`);
      assert.ok(stopped.result, "a resolved stop reports the process outcome");
      // The handle is released exactly once: the second stop finds no task and
      // answers with the same empty terminal record instead of a second result.
      assert.deepEqual(await host.call("stop", [started.handle]), { result: null, error: null });
      assert.throws(
        () => process.kill(started.pid, 0),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
      );
    }
  } finally {
    await host.close();
  }
});

test("an unsignalable process group after the child exits confirms the stop", async () => {
  if (process.platform === "win32") return;
  assert.notEqual(PERMISSION_DENIED_GROUP_POLL, VELAR_NODE_PROCESS_WORKER_SOURCE);
  const host = await processWorker(PERMISSION_DENIED_GROUP_POLL);
  try {
    const started = await host.call("start", startArguments("setTimeout(() => {}, 10000)")) as { handle: number; pid: number };
    const stoppedAt = Date.now();
    const stopped = await host.call("stop", [started.handle]) as ProcessOutcome;
    assert.equal(stopped.error, null, "a recycled group id the Realm may not signal is proof the owned group is gone");
    assert.equal(stopped.result?.signal, "SIGTERM");
    assert.ok(Date.now() - stoppedAt < 5_000, "the confirmation must not spend the bounded stop window");
  } finally {
    await host.close();
  }
});

test("a permission failure while the child is still live still fails the stop", async () => {
  if (process.platform === "win32") return;
  const liveChildSource = PERMISSION_DENIED_GROUP_POLL.replace(
    "      if (processGroupExitConfirmed(child, error)) return;",
    "      if (processGroupExitConfirmed({exitCode: null, signalCode: null}, error)) return;",
  );
  assert.notEqual(liveChildSource, PERMISSION_DENIED_GROUP_POLL);
  const host = await processWorker(liveChildSource);
  try {
    const started = await host.call("start", startArguments("setTimeout(() => {}, 10000)")) as { handle: number; pid: number };
    const stopped = await host.call("stop", [started.handle]) as ProcessOutcome;
    assert.equal(stopped.result, null);
    assert.equal(stopped.error?.message, "kill EPERM", "a live child this Realm cannot signal is a real permission failure");
  } finally {
    await host.close();
  }
});
