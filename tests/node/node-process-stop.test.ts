import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel, Worker } from "node:worker_threads";
import { VELAR_NODE_PROCESS_WORKER_SOURCE } from "../../packages/node/src/runtime-sources.generated.ts";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";

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

// ---------------------------------------------------------------------------
// D114 F4: the same predicate on the post-Worker-crash reaper
// ---------------------------------------------------------------------------

/**
 * The reaper lives in the owner Realm, inside the emitted `velar/process`
 * prelude, so there is no module to import it from. These tests slice the three
 * functions it is made of out of that emitted source and run them against
 * injected `kill` answers: the text under test is the text that ships.
 */
function reaperSource(): string {
  const source = nodeModuleSources.get("velar/process");
  assert.ok(source, "the Node target publishes a velar/process runtime");
  const slice = (name: string): string => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `the emitted runtime declares ${name}`);
    const end = source.indexOf("\n}\n", start);
    assert.notEqual(end, -1, `${name} closes at column zero`);
    return source.slice(start, end + 3);
  };
  return [
    slice("__velarNodeProcessSignal"),
    slice("__velarNodeProcessOwnerAlive"),
    slice("__velarNodeProcessReapOwners"),
  ].join("\n");
}

type ReaperHarness = {
  /** Runs one reaping attempt and answers the signals it delivered. */
  reap(): readonly { readonly target: number; readonly signal: string }[];
  readonly owners: Record<string, number>;
  /** How many attempts the reaper has scheduled but not yet run. */
  scheduled(): number;
};

/**
 * One reaper over one owned pid, with `process.kill` answering whatever the
 * scenario says. `poll` answers a `kill(target, 0)` and `signal` answers a real
 * signal delivery; either may throw the host error the scenario is about.
 */
function reaper(pid: number, kill: (target: number, signal: number | string) => void): ReaperHarness {
  const delivered: { target: number; signal: string }[] = [];
  const timers: (() => void)[] = [];
  const build = new Function("kill", "delivered", "timers", `
    "use strict";
    const __velarProcessCreate = Object.create;
    const __velarProcessKeys = Object.keys;
    const __velarProcessOwnDescriptor = Object.getOwnPropertyDescriptor;
    const __velarProcessCall = (operation, self, args) => Reflect.apply(operation, self, args);
    const __velarProcessSetTimeout = (callback) => { timers.push(callback); return timers.length; };
    const __velarNodeProcessPlatform = "darwin";
    const __velarNodeProcessNativeProcess = {};
    const __velarNodeProcessKill = (target, signal) => {
      if (signal !== 0) delivered.push({ target, signal });
      kill(target, signal);
    };
    const __velarNodeProcessOwners = Object.create(null);
    let __velarNodeProcessReaper = null;
    let __velarNodeProcessReaperAttempts = 0;
    ${reaperSource()}
    return { reap: __velarNodeProcessReapOwners, owners: __velarNodeProcessOwners };
  `) as (
    killer: typeof kill,
    log: typeof delivered,
    schedule: typeof timers,
  ) => { reap(): void; owners: Record<string, number> };
  const built = build(kill, delivered, timers);
  built.owners["1"] = pid;
  return {
    reap() {
      delivered.length = 0;
      built.reap();
      return [...delivered];
    },
    owners: built.owners,
    scheduled: () => timers.length,
  };
}

function hostError(code: string): Error {
  const error = new Error(`kill ${code}`) as Error & { code?: string };
  error.code = code;
  return error;
}

test("[F4] the reaper releases a group that answers ESRCH without signalling it", () => {
  const harness = reaper(4242, () => { throw hostError("ESRCH"); });
  assert.deepEqual(harness.reap(), [], "a group already gone earns no signal");
  assert.deepEqual(Object.keys(harness.owners), []);
});

test("[F4] a group whose root child has exited and answers EPERM is never signalled", () => {
  // The reaper's own SIGKILL is the proof the root child exited, so the second
  // attempt has it and the first does not — exactly as the worker's predicate
  // reads a live child's EPERM as a real permission failure.
  const denied = reaper(4243, () => { throw hostError("EPERM"); });
  const first = denied.reap();
  // One delivery to the group and, when that is refused, the runtime's existing
  // fallback to the root pid: the whole of what one attempt sends.
  assert.deepEqual(first, [
    { target: -4243, signal: "SIGKILL" },
    { target: 4243, signal: "SIGKILL" },
  ], "the first attempt has no proof of exit, so it still tries to kill the group");
  // …and the EPERM answered *after* that SIGKILL is the proof: the owner is
  // released in the same attempt rather than retried a hundred times.
  assert.deepEqual(Object.keys(denied.owners), []);
  assert.equal(denied.scheduled(), 0, "a released owner leaves nothing to reap");

  // With the proof already established, the group is not signalled at all.
  const afterExit = reaper(4244, () => { throw hostError("EPERM"); });
  afterExit.owners["2"] = 4245;
  afterExit.reap();
  afterExit.owners["3"] = 4246;
  assert.deepEqual(afterExit.reap(), [], "no SIGKILL reaches a group already proved gone");
  assert.deepEqual(Object.keys(afterExit.owners), []);
});

test("[F4] a live group that answers EPERM is still killed within the bounded wait", () => {
  let live = true;
  const harness = reaper(4247, (target, signal) => {
    if (signal !== 0) { live = false; return; }
    if (live) return;
    throw hostError("EPERM");
  });
  // The poll succeeds while the group is live, so EPERM never enters the
  // question: the reaper signals it exactly as it always did.
  const delivered = harness.reap();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.target, -4247, "a group is signalled through its negative pid");
  assert.deepEqual(Object.keys(harness.owners), [], "the kill is confirmed in the same attempt");
});

test("[F4] a group answering an unrelated host error is retried, not released", () => {
  const harness = reaper(4248, () => { throw hostError("EINVAL"); });
  assert.equal(harness.reap().length, 2, "the group signal and its fallback to the root pid");
  assert.deepEqual(Object.keys(harness.owners), ["1"], "only ESRCH and a proved-exited EPERM release an owner");
  assert.equal(harness.scheduled(), 1, "an owner still held schedules another attempt");
});
