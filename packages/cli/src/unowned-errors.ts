import { hostErrorStack } from "./host-error.ts";

/**
 * ASY-D2 + WEB-N5 + BLD-D1, one stance owned in one place: any unowned error
 * during a test fails that test. Unowned means anything that reaches the host
 * error channel instead of the test's own await chain — a detached-task
 * report, an uncaught exception or unhandled rejection (a module whose
 * initialization touches the DOM in a headless run lands here), or any other
 * console.error the program never owned.
 *
 * Both test runners share this channel because the stance is not a property of
 * one runner: the Node runner adopted it first, the browser runner ran without
 * it long enough for a page that threw on every mount to report `1 passed, 0
 * failed` twice in a blind test, and a third channel (work still running after
 * the last test) escaped both. A single owner makes the three reachable
 * failure paths — during a test, while loading a test module, and after the
 * run — one mechanism instead of three partial copies.
 */
export interface UnownedErrorChannel {
  /**
   * Reports captured since the last drain. Two macrotask turns let reports
   * that were already scheduled during the awaited work (a settled detached
   * rejection observes on a microtask, its chained observer one turn later)
   * land before the verdict is read.
   */
  drain(): Promise<readonly string[]>;
  /**
   * Waits until the process has no work left to do, so a failure that lands
   * late is still attributed to the work that started it. Resolves true on
   * quiescence and false when the owned upper bound expires — an expiry is
   * itself a failure, because work that never finishes is work whose failure
   * can never be reported.
   */
  settle(timeoutMs: number): Promise<boolean>;
  /** Restores the host channels and disarms the exit net. */
  release(): void;
}

export interface UnownedErrorChannelOptions {
  /**
   * Arms a process-exit net: a report still undrained when the process exits
   * is written to stderr and forces a non-zero exit code. Only a runner that
   * owns its whole process may arm it, and only a runner whose exit path is
   * `process.exit` needs it — quiescence cannot be observed through a live IPC
   * channel, so the browser-test worker cannot use `settle` as its last net.
   */
  readonly exitNet?: boolean;
}

export function captureUnownedErrors(options: UnownedErrorChannelOptions = {}): UnownedErrorChannel {
  const reports: string[] = [];
  const hostConsole = console;
  const originalConsoleError = hostConsole.error;
  const captureConsoleError = (...values: unknown[]): void => {
    reports.push(values.map((value) => (typeof value === "string" ? value : hostErrorStack(value))).join(" "));
    Reflect.apply(originalConsoleError, hostConsole, values);
  };
  const captureHostError = (error: unknown): void => {
    reports.push(hostErrorStack(error));
  };
  const exitNet = options.exitNet === true
    ? (): void => {
      if (reports.length === 0) return;
      const trailing = reports.splice(0).join("\n");
      try { process.stderr.write(`✗ an unowned error was reported as the run exited\n${trailing}\n`); } catch {}
      const code = process.exitCode;
      if (code === undefined || code === 0) process.exitCode = 1;
    }
    : null;

  hostConsole.error = captureConsoleError;
  process.on("uncaughtException", captureHostError);
  process.on("unhandledRejection", captureHostError);
  if (exitNet !== null) process.on("exit", exitNet);

  return {
    async drain(): Promise<readonly string[]> {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      return reports.splice(0);
    },
    settle(timeoutMs: number): Promise<boolean> {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
        throw new RangeError("A settle bound must be an integer from 1 through 600000");
      }
      return new Promise<boolean>((resolve) => {
        // The bound is unreferenced so that it cannot itself be the work that
        // keeps the loop alive; `beforeExit` is Node's own report that nothing
        // is left to run, which is exactly the question being asked.
        const onIdle = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        const timer = setTimeout(() => {
          process.off("beforeExit", onIdle);
          resolve(false);
        }, timeoutMs);
        timer.unref();
        process.once("beforeExit", onIdle);
      });
    },
    release(): void {
      hostConsole.error = originalConsoleError;
      process.off("uncaughtException", captureHostError);
      process.off("unhandledRejection", captureHostError);
      if (exitNet !== null) process.off("exit", exitNet);
    },
  };
}

/**
 * A compiled test module reports its failures with JavaScript stacks. Without
 * source-map support those stacks name the runner's own sandbox
 * (`.velar/test-XXXX/src/a.test.js?run=...`), which is not a place the author
 * can edit; with it they name `src/a.test.vel:6:15`.
 */
export function mapCompiledStacksToSources(): void {
  process.setSourceMapsEnabled(true);
}

/** Waits for buffered output to reach the operating system. */
export async function flushOutput(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write("", (error) => error ? reject(error) : resolve());
  });
}
