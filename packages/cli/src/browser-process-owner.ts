import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import type { Browser, BrowserServer, BrowserType, LaunchOptions } from "playwright";
import { hostErrorStack } from "./host-error.ts";
import { guardChildOnExit, watchParentDeath } from "./process-lifetime.ts";

/**
 * The one ceiling every browser run answers to, and the one allowance every
 * teardown gets. They were written down three times — the runner's own default
 * and both acceptances — and not at all in `scripts/run-project-gate.mjs`,
 * which is how a wedged run outlived every bound the repository believed it
 * had. A launch path that cannot name its ceiling has none, so these are
 * imported rather than repeated.
 */
export const browserRunDeadlineMs = 20 * 60_000;
export const browserCleanupTimeoutMs = 10_000;

/**
 * How long a signalled group has to answer before it is ended outright.
 *
 * This used to be the cleanup allowance with five seconds on top, and the
 * number was paid once per supervisor rather than once per stop. A browser gate
 * is three of them — `scripts/run-project-gate.mjs`, the `velar test`
 * supervisor it starts, and the worker underneath — so a gate whose launcher
 * was killed took a second to notice, fifteen more before anything was ended by
 * force, and another second or two for the browser to see the pipe close:
 * nineteen seconds to end a run nobody was waiting for any more. On a hosted
 * four-core runner that was over the fifteen-second bound the hygiene gate
 * asserted, which is how a suite that was green on a developer's machine was
 * red on Linux.
 *
 * The fifteen seconds bought nothing. A worker that is at an await it can
 * abandon releases its browser in well under a second; one that is inside a
 * page call it cannot abandon does not answer until that call returns, however
 * long the allowance is. And the browser goes either way — Playwright holds it
 * on a pipe, and a launcher that is gone closes that pipe. So the allowance
 * buys the answer, not the hygiene, and a stop that has already been decided
 * is not a negotiation. Five seconds, once, at every level.
 */
export const browserStopGraceMs = 5_000;

/**
 * How long an exiting worker waits for its own output to reach the operating
 * system. A reader that stopped reading without closing never drains the pipe
 * at all, and an exit must not be held for one.
 */
const browserExitFlushTimeoutMs = 5_000;

export interface BrowserWorkerProcessOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly deadlineMs: number;
  readonly cleanupTimeoutMs: number;
  /**
   * An IPC channel, which the browser-test worker reports its progress over
   * and which every supervisor here opens unless it says otherwise. A
   * supervisor of anything else leaves it off: Node publishes the channel to
   * the child as `NODE_CHANNEL_FD`, and a child that passes its environment on
   * hands grandchildren a descriptor that is not theirs.
   */
  readonly ipc?: boolean;
  /**
   * Collects the child's output instead of inheriting this process's streams.
   * A gate that summarizes what it ran needs the text; one that only relays it
   * does not, and inheriting keeps the child's own ordering.
   */
  readonly onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

/**
 * What the worker tells its supervisor while it runs.
 *
 * A `.browser.test.vel` body runs in the worker process rather than in the
 * page, so the bound on it cannot live there: a synchronously spinning body
 * never yields to the timer that would report it and never runs the signal
 * handler that would end it, which left a wedged browser test stalling the run
 * silently until the aggregate deadline killed it with no verdict, no test
 * name and no summary. The supervisor owns that bound, which is why the worker
 * announces each test before it starts it and reports its counts so far — a
 * killed worker cannot write its own summary.
 */
export type BrowserWorkerReport =
  | {
    readonly kind: "begin";
    readonly label: string;
    readonly timeoutMs: number;
    readonly passed: number;
    readonly failed: number;
  }
  /** The worker is between tests: what follows is bounded by the run deadline. */
  | { readonly kind: "idle" };

/** Room a report needs to cross the process boundary before the bound expires. */
const browserWorkerReportGraceMs = 1_000;

function browserWorkerReport(message: unknown): BrowserWorkerReport | null {
  if (!message || typeof message !== "object") return null;
  const report = message as Record<string, unknown>;
  if (report.kind === "idle") return { kind: "idle" };
  if (report.kind !== "begin" || typeof report.label !== "string"
    || typeof report.timeoutMs !== "number" || typeof report.passed !== "number"
    || typeof report.failed !== "number") {
    return null;
  }
  return { kind: "begin", label: report.label, timeoutMs: report.timeoutMs, passed: report.passed, failed: report.failed };
}

export async function superviseBrowserWorker(options: BrowserWorkerProcessOptions): Promise<number> {
  const ownsProcessGroup = process.platform !== "win32";
  const child = spawn(options.executable, options.arguments, {
    cwd: options.cwd,
    detached: ownsProcessGroup,
    env: options.environment,
    stdio: supervisedStdio(options),
  });
  // The worker is a process group of its own, so nothing that kills this
  // supervisor reaches it on the way out. The exit net does, and it runs for
  // the signals no handler below ever sees as well as for an orderly return.
  guardChildOnExit(child);
  collectSupervisedOutput(child, options.onOutput);
  return new Promise<number>((resolveExit, reject) => {
    let settled = false;
    let forwarded: "SIGHUP" | "SIGINT" | "SIGTERM" | null = null;
    let forcedTimer: ReturnType<typeof setTimeout> | null = null;
    let testTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      process.off("SIGHUP", onHangup);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      stopWatchingParent();
      clearTimeout(deadlineTimer);
      if (forcedTimer !== null) clearTimeout(forcedTimer);
      if (testTimer !== null) clearTimeout(testTimer);
    };
    const finish = (value: number): void => {
      if (settled) return;
      settled = true;
      signalOwnedWorker(child, "SIGKILL", ownsProcessGroup, true);
      cleanup();
      resolveExit(value);
    };
    const forward = (signal: "SIGHUP" | "SIGINT" | "SIGTERM", deadline = false): void => {
      if (settled || forwarded !== null) return;
      forwarded = signal;
      signalOwnedWorker(child, signal, ownsProcessGroup, false);
      forcedTimer = setTimeout(() => {
        // A worker that answered the signal wrote its own account of the
        // deadline and is already gone; one that had to be killed wrote
        // nothing, and a run that ends with no line at all is the failure this
        // reports.
        if (deadline) process.stderr.write(`✗ the browser test run did not answer its ${options.deadlineMs} millisecond deadline and was ended\n`);
        signalOwnedWorker(child, "SIGKILL", ownsProcessGroup, true);
      }, browserStopGraceMs);
    };
    const onHangup = (): void => forward("SIGHUP");
    const onInterrupt = (): void => forward("SIGINT");
    const onTerminate = (): void => forward("SIGTERM");
    process.once("SIGHUP", onHangup);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    // A supervisor whose own launcher is gone has nobody left to report to, and
    // the run it is holding open costs a machine a core and a browser until
    // somebody notices. It ends the same way an interrupt ends it.
    const stopWatchingParent = watchParentDeath({
      stop: (reason: string): void => {
        process.stderr.write(`✗ the browser test run was ended because ${reason}\n`);
        forward("SIGTERM");
      },
    });
    // A worker a test wedged cannot report its own verdict, so the supervisor
    // writes the one line the author needs — which test, and which bound it
    // outlived — and then ends the run rather than holding a gate open until
    // the aggregate deadline. The cleanup allowance is added because the
    // announced window covers the test's own page teardown as well as its body.
    child.on("message", (message: unknown) => {
      const report = browserWorkerReport(message);
      if (report === null || settled) return;
      if (testTimer !== null) clearTimeout(testTimer);
      testTimer = null;
      if (report.kind !== "begin") return;
      testTimer = setTimeout(() => {
        process.stderr.write(`✗ ${report.label}\nthis browser test did not finish within its ${report.timeoutMs} millisecond bound\n`);
        process.stdout.write(`\n${report.passed} passed, ${report.failed + 1} failed\n`);
        finish(1);
      }, report.timeoutMs + options.cleanupTimeoutMs + browserWorkerReportGraceMs);
    });
    const deadlineTimer = setTimeout(() => forward("SIGTERM", true), options.deadlineMs);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      signalOwnedWorker(child, "SIGKILL", ownsProcessGroup, true);
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (code !== null) finish(code);
      else if (forwarded === "SIGHUP") finish(129);
      else if (forwarded === "SIGINT") finish(130);
      else if (forwarded === "SIGTERM") finish(143);
      else finish(signal === null ? 1 : 128);
    });
  });
}

function supervisedStdio(options: BrowserWorkerProcessOptions): StdioOptions {
  const output = options.onOutput === undefined ? "inherit" : "pipe";
  return options.ipc === false
    ? ["ignore", output, output]
    : ["ignore", output, output, "ipc"];
}

function collectSupervisedOutput(child: ChildProcess, onOutput: BrowserWorkerProcessOptions["onOutput"]): void {
  if (onOutput === undefined) return;
  child.stdout?.on("data", (chunk: Buffer) => onOutput(chunk.toString("utf8"), "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => onOutput(chunk.toString("utf8"), "stderr"));
}

/**
 * Signals a child and everything it started. A supervisor that owns a process
 * group signals the group, because the interesting descendants — a development
 * server the acceptance started, a compiler service that server started — are
 * not the child itself.
 */
export function signalOwnedWorker(
  child: ChildProcess,
  signal: NodeJS.Signals,
  ownsProcessGroup: boolean,
  includeExitedGroup: boolean,
): void {
  if (ownsProcessGroup && child.pid !== undefined
    && (includeExitedGroup || (child.exitCode === null && child.signalCode === null))) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill(signal); }
    catch {}
  }
}

/**
 * The worker's half of the same contract. It ends itself the way its
 * supervisor would have ended it, so a worker whose supervisor died runs the
 * one teardown path it already has rather than a second one written for this
 * case: a `.browser.test.vel` run releases its browser and its preview server
 * on the way out, and none of that happens if the process is simply killed.
 */
export function observeBrowserWorkerParent(): () => void {
  return watchParentDeath({ stop: () => { process.kill(process.pid, "SIGTERM"); } });
}

export async function exitBrowserWorker(code: number): Promise<never> {
  await flushWritable(process.stdout);
  await flushWritable(process.stderr);
  if (process.connected && typeof process.disconnect === "function") process.disconnect();
  process.exit(code);
}

/**
 * Launches a Playwright browser server this process is answerable for.
 *
 * Playwright puts the browser in a process group of its own and keeps it alive
 * through a pipe, which means the group kill a supervisor sends never reaches
 * it and only the launcher's own exit does. `terminateBrowserServer` is how
 * that exit is meant to happen; the exit net is what covers a launcher that
 * never got there.
 */
export async function launchOwnedBrowserServer(type: BrowserType, options: LaunchOptions): Promise<BrowserServer> {
  const server = await type.launchServer(options);
  guardChildOnExit(server.process());
  return server;
}

export async function terminateBrowserServer(
  browser: Browser | null,
  server: BrowserServer,
  timeoutMs: number,
): Promise<void> {
  const child = server.process();
  if (browser !== null && browser.isConnected()) {
    try { await boundedBrowserOperation(browser.close(), timeoutMs, "Browser connection cleanup"); }
    catch {}
  }
  try {
    await boundedBrowserOperation(server.close(), timeoutMs, "Browser graceful cleanup");
    await boundedBrowserOperation(waitForChildExit(child), timeoutMs, "Browser process exit");
    return;
  } catch (gracefulError) {
    try {
      await boundedBrowserOperation(server.kill(), timeoutMs, "Browser forced cleanup");
      await boundedBrowserOperation(waitForChildExit(child), timeoutMs, "Forced browser process exit");
      return;
    } catch (forcedError) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      try {
        await boundedBrowserOperation(waitForChildExit(child), timeoutMs, "Emergency browser process exit");
      } catch {
        throw new Error(`Browser cleanup failed after graceful and forced termination: ${hostErrorStack(gracefulError)}\n${hostErrorStack(forcedError)}`);
      }
    }
  }
}

export async function boundedBrowserOperation<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  cancellation: Promise<never> | null = null,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${timeoutMs} milliseconds`)), timeoutMs);
  });
  try {
    return await Promise.race(cancellation === null ? [operation, timeout] : [operation, timeout, cancellation]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()));
}

/**
 * Waits for buffered output to reach the operating system, and stops waiting
 * when it cannot get there.
 *
 * This used to reject on a write error, and rejecting is what kept an orphaned
 * browser worker alive for hours: writing to a pipe whose reader is gone fails
 * with EPIPE, the rejection travelled out past `process.exit`, and the IPC
 * channel to a supervisor that was itself gone then held the event loop open
 * for good. There is nothing to flush to a reader that left, and a reader that
 * stopped reading without closing never drains the pipe at all, so both are
 * the end of the wait rather than a failure of it.
 */
async function flushWritable(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolveFlush) => {
    const timer = setTimeout(resolveFlush, browserExitFlushTimeoutMs);
    timer.unref();
    stream.write("", () => {
      clearTimeout(timer);
      resolveFlush();
    });
  });
}
