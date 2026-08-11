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
    const cleanup = (): void => {
      process.off("SIGHUP", onHangup);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
      clearTimeout(deadlineTimer);
      if (forcedTimer !== null) clearTimeout(forcedTimer);
    };
    const finish = (value: number): void => {
      if (settled) return;
      settled = true;
      signalOwnedWorker(child, "SIGKILL", ownsProcessGroup, true);
      cleanup();
      resolveExit(value);
    };
    const forward = (signal: "SIGHUP" | "SIGINT" | "SIGTERM"): void => {
      if (forwarded !== null) return;
      forwarded = signal;
      signalOwnedWorker(child, signal, ownsProcessGroup, false);
      forcedTimer = setTimeout(() => {
        signalOwnedWorker(child, "SIGKILL", ownsProcessGroup, true);
      }, options.cleanupTimeoutMs + 5_000);
    };
    const onHangup = (): void => forward("SIGHUP");
    const onInterrupt = (): void => forward("SIGINT");
    const onTerminate = (): void => forward("SIGTERM");
    process.once("SIGHUP", onHangup);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    const deadlineTimer = setTimeout(() => forward("SIGTERM"), options.deadlineMs);
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
