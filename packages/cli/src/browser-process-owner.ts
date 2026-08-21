import { spawn, type ChildProcess } from "node:child_process";
import type { Browser, BrowserServer } from "playwright";
import { hostErrorStack } from "./host-error.ts";

export interface BrowserWorkerProcessOptions {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly deadlineMs: number;
  readonly cleanupTimeoutMs: number;
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
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  return new Promise<number>((resolveExit, reject) => {
    let settled = false;
    let forwarded: "SIGHUP" | "SIGINT" | "SIGTERM" | null = null;
    let forcedTimer: ReturnType<typeof setTimeout> | null = null;
    let testTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      process.off("SIGHUP", onHangup);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
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
      if (forwarded !== null) return;
      forwarded = signal;
      signalOwnedWorker(child, signal, ownsProcessGroup, false);
      forcedTimer = setTimeout(() => {
        // A worker that answered the signal wrote its own account of the
        // deadline and is already gone; one that had to be killed wrote
        // nothing, and a run that ends with no line at all is the failure this
        // reports.
        if (deadline) process.stderr.write(`✗ the browser test run did not answer its ${options.deadlineMs} millisecond deadline and was ended\n`);
        signalOwnedWorker(child, "SIGKILL", ownsProcessGroup, true);
      }, options.cleanupTimeoutMs + 5_000);
    };
    const onHangup = (): void => forward("SIGHUP");
    const onInterrupt = (): void => forward("SIGINT");
    const onTerminate = (): void => forward("SIGTERM");
    process.once("SIGHUP", onHangup);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
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

function signalOwnedWorker(
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

export function observeBrowserWorkerParent(): () => void {
  const parentDisconnected = (): void => { process.kill(process.pid, "SIGTERM"); };
  process.once("disconnect", parentDisconnected);
  return () => process.off("disconnect", parentDisconnected);
}

export async function exitBrowserWorker(code: number): Promise<never> {
  await flushWritable(process.stdout);
  await flushWritable(process.stderr);
  if (process.connected && typeof process.disconnect === "function") process.disconnect();
  process.exit(code);
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

async function flushWritable(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolveFlush, reject) => {
    stream.write("", (error) => error ? reject(error) : resolveFlush());
  });
}
