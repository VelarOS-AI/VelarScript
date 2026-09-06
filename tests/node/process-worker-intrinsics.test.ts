import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MessagePort, Worker } from "node:worker_threads";
import { nodeModuleSources, VELAR_NODE_HOST_MODULE } from "../../packages/node/src/compiler.ts";
import { materializeNodeRuntimeDependencies, runtime } from "../support/node-runtime.ts";

/**
 * D114 F7-node-c — the Worker reference accounting reaches its handles through
 * references captured at module initialisation, and when it cannot reach one it
 * names a failure instead of hanging.
 *
 * The regression this file pins: `…UpdateReference()` reffed the Worker on
 * every request, and Node's own `Worker.prototype.ref` re-reads
 * `MessagePort.prototype.ref` off the worker's public port each time it runs
 * (`node:internal/worker`). Capturing `Worker.prototype.ref` therefore protects
 * nothing — a program that replaced the MessagePort method saw the replacement
 * called, with a stack that reads `at Worker.ref`. The throw landed inside the
 * promise executor in `invoke()`, which left the pending entry registered, the
 * port ref'd and the worker's handle ref'd, with nothing left to settle any of
 * them: the failing call rejected in 60 ms and the process then never exited.
 */

const POISONED = "poisoned worker reference intrinsic";

type ProcessRuntime = {
  run(command: string, args?: readonly string[], options?: Record<string, unknown>): Promise<{
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }>;
  start(command: string, args?: readonly string[], options?: Record<string, unknown>): Promise<{
    next(): Promise<Readonly<{ readonly channel: "stdout" | "stderr"; readonly text: string }> | null>;
    wait(): Promise<{ readonly code: number | null; readonly stdout: string }>;
  }>;
};

/** The four operations a Worker proxy needs and a program can replace. */
function referenceIntrinsics(): ReadonlyArray<{ readonly target: object; readonly operation: string; readonly descriptor: PropertyDescriptor }> {
  const named: ReadonlyArray<readonly [object, string]> = [
    [Worker.prototype, "ref"],
    [Worker.prototype, "unref"],
    [MessagePort.prototype, "ref"],
    [MessagePort.prototype, "unref"],
  ];
  return named.map(([target, operation]) => ({
    target,
    operation,
    descriptor: Object.getOwnPropertyDescriptor(target, operation)!,
  }));
}

test("velar/process reference accounting survives replaced Worker and MessagePort operations", async () => {
  const processRuntime = await runtime<ProcessRuntime>("velar/process");
  const intrinsics = referenceIntrinsics();
  let poisonCalls = 0;
  const poison = (): never => { poisonCalls += 1; throw new Error(POISONED); };
  let ran: { readonly code: number | null; readonly stdout: string; readonly stderr: string } | null = null;
  const streamed: string[] = [];
  let waited: { readonly code: number | null; readonly stdout: string } | null = null;
  try {
    for (const { target, operation, descriptor } of intrinsics) {
      Object.defineProperty(target, operation, { ...descriptor, value: poison });
    }
    // Two requests each side of an idle moment: the accounting refs the port on
    // the way in and unrefs it on the way out, so both edges run poisoned.
    ran = await processRuntime.run(process.execPath, ["-e", "process.stdout.write('captured')"]);
    const started = await processRuntime.start(process.execPath, ["-e", "process.stdout.write('streamed')"], { timeout: 5000 });
    while (true) {
      const chunk = await started.next();
      if (chunk === null) break;
      streamed.push(chunk.text);
    }
    waited = await started.wait();
  } finally {
    for (const { target, operation, descriptor } of intrinsics) Object.defineProperty(target, operation, descriptor);
  }
  assert.equal(poisonCalls, 0, "the accounting called a replaced host operation");
  assert.deepEqual(
    ran === null ? null : { code: ran.code, stdout: ran.stdout, stderr: ran.stderr },
    { code: 0, stdout: "captured", stderr: "" },
  );
  assert.equal(streamed.join(""), "streamed");
  assert.equal(waited?.code, 0);
});

const ACCOUNTING_FAILURE = "Node process worker reference accounting is unavailable";

/**
 * The other half of the contract: a captured reference that fails halfway. Both
 * drivers run in their own child, because what is asserted is that the process
 * *ends* — and a process that never ends has no other witness.
 *
 * This is the regression's own shape, reproduced where it can be observed.
 * Node's `Worker.prototype.ref` refs the worker's handle and *then* reads
 * `MessagePort.prototype.ref` off the public port, so a replaced port method
 * threw with the handle already ref'd; the throw escaped the promise executor
 * in `invoke()`, and the stranded pending entry, the ref'd port and the ref'd
 * handle were left with nothing that could ever settle them. The module's own
 * `ref` is rewritten here to ref and then throw — the way D114's readiness test
 * rewrites the deadline constant — because a program cannot reach this state
 * through the prototypes: Node reads `MessagePort.prototype.ref` itself when
 * the module assigns `port.onmessage`, so replacing it beforehand fails the
 * module before any of this code runs. That is the second driver.
 *
 * Green means the accounting reported the failure by name, released what it had
 * taken, and let the program exit. A red here is the hang.
 */
test("velar/process names the failure and releases its handles when a captured reference fails halfway", async () => {
  const source = nodeModuleSources.get("velar/process")!;
  const halfway = source.replace(
    'const __velarNodeProcessMessagePortRef = __velarProcessDataOperation(MessagePort.prototype, "ref");',
    'const __velarNodeProcessMessagePortRealRef = __velarProcessDataOperation(MessagePort.prototype, "ref");\n'
      + "const __velarNodeProcessMessagePortRef = function () {\n"
      + "  __velarProcessCall(__velarNodeProcessMessagePortRealRef, this, []);\n"
      + `  throw new Error(${JSON.stringify(POISONED)});\n`
      + "};",
  );
  assert.equal(source.split(POISONED).length, 1);
  assert.equal(halfway.split(POISONED).length, 2, "velar/process no longer captures the reference this test rewrites");
  const outcome = await driveProcessRuntime(halfway, []);
  assert.equal(outcome.timedOut, false, `the driver never exited; it printed ${JSON.stringify(outcome.stdout)}`);
  assert.equal(outcome.stdout.trim(), ACCOUNTING_FAILURE, outcome.stderr);
  assert.equal(outcome.code, 0, outcome.stderr);
});

/**
 * And the program that replaces all four before the module loads: Node itself
 * refuses first — `port.onmessage = …` refs the port through the prototype — so
 * the import carries the program's own error. What matters is the shape of the
 * ending, not whose error it is: something is reported, nothing succeeds
 * quietly, and the process exits.
 */
test("velar/process fails to load rather than hang when a program replaces the reference operations first", async () => {
  const outcome = await driveProcessRuntime(nodeModuleSources.get("velar/process")!, [
    "Worker.ref", "Worker.unref", "MessagePort.ref", "MessagePort.unref",
  ]);
  assert.equal(outcome.timedOut, false, `the driver never exited; it printed ${JSON.stringify(outcome.stdout)}`);
  assert.ok(
    [POISONED, ACCOUNTING_FAILURE].includes(outcome.stdout.trim()),
    `the driver reported ${JSON.stringify(outcome.stdout.trim())}${outcome.stderr}`,
  );
  assert.equal(outcome.code, 0, outcome.stderr);
});

/** Loads one velar/process module in a child that must end on its own. */
async function driveProcessRuntime(source: string, replaced: readonly string[]): Promise<BoundedRun> {
  const directory = await mkdtemp(join(tmpdir(), "velar-process-intrinsics-"));
  try {
    await materializeNodeRuntimeDependencies(directory, "velar/process");
    await writeFile(join(directory, "process.mjs"), source, "utf8");
    await writeFile(join(directory, "driver.mjs"), `
import { MessagePort, Worker } from "node:worker_threads";
const prototypes = {Worker: Worker.prototype, MessagePort: MessagePort.prototype};
const poison = () => { throw new Error(${JSON.stringify(POISONED)}); };
for (const target of ${JSON.stringify(replaced)}) {
  const [owner, operation] = target.split(".");
  Object.defineProperty(prototypes[owner], operation, {
    ...Object.getOwnPropertyDescriptor(prototypes[owner], operation),
    value: poison,
  });
}
let reported = "the module reported nothing";
try {
  const module = await import("./process.mjs");
  await module.run(process.execPath, ["--version"]);
  reported = "the call succeeded";
} catch (error) {
  reported = error instanceof Error ? error.message : String(error);
}
process.stdout.write(reported + "\\n");
`.trimStart(), "utf8");
    return await runBounded(process.execPath, [join(directory, "driver.mjs")], directory, 30_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

type BoundedRun = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
};

/** Runs a child to completion, or kills it and says so. */
function runBounded(command: string, args: readonly string[], cwd: string, limitMs: number): Promise<BoundedRun> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, limitMs);
    // `close`, not `exit`: what the child printed on its way out is the report,
    // and it is only all here once both pipes have ended.
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * D114 F9-node-cli, audit NO-D2 / NO-I3: the one operation that decides whether
 * the process can ever exit, and the one failure this module used to swallow.
 *
 * Capturing an operation at load defeats a *later* replacement, which is what
 * the tests above pin; it does not defeat a preload — an APM or OpenTelemetry
 * probe patching `worker_threads` before anything imports this module is
 * captured along with everything real. `…ReleaseWorker()` answered `false` and
 * the boot dropped it, so the Worker stayed referenced with nothing
 * outstanding: the program printed its output, ran to the end, and the process
 * never exited. Two lines away, the port accounting names exactly this kind of
 * failure. This one is named too.
 */
test("velar/process names the failure when a preloaded Worker.prototype.unref refuses to release", async () => {
  const outcome = await driveProcessRuntime(nodeModuleSources.get("velar/process")!, ["Worker.unref"]);
  assert.equal(outcome.timedOut, false, `the driver never exited; it printed ${JSON.stringify(outcome.stdout)}`);
  assert.equal(
    outcome.stdout.trim(),
    "Node process worker could not be released; Worker.prototype.unref did not answer",
    outcome.stderr,
  );
  assert.equal(outcome.code, 0, outcome.stderr);
});

/** The same rule in all three Worker families, read off the modules themselves. */
test("all three Node Worker families read the release's answer rather than dropping it", () => {
  for (const [module, prefix, worker] of [
    ["velar/process", "__velarNodeProcess", "Node process worker"],
    [VELAR_NODE_HOST_MODULE, "__velarNodeHost", "Node host worker"],
    ["velar/terminal", "__velarTerminal", "Node terminal worker"],
  ] as const) {
    const source = nodeModuleSources.get(module);
    assert.ok(source, `${module} must have a Node runtime source`);
    assert.match(
      source,
      new RegExp(`if \\(!${prefix}ReleaseWorker\\(\\)\\) ${prefix}Fail\\(new \\w+\\("${worker} could not be released; Worker\\.prototype\\.unref did not answer"\\)\\);`, "u"),
      `${module} fails closed when the release refuses`,
    );
    assert.equal(
      new RegExp(`^${prefix}ReleaseWorker\\(\\);$`, "mu").test(source),
      false,
      `${module} has no call site that drops the release's answer`,
    );
  }
});
