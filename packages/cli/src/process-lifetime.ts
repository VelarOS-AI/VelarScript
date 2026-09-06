import type { ChildProcess } from "node:child_process";

/**
 * How a long-lived process learns that the process which started it is gone.
 *
 * Every process this toolchain leaves running for minutes — a browser-test
 * supervisor, the worker it forks, a development server, a preview server —
 * used to learn that only one way: the IPC `disconnect` event. That works
 * exactly when there is an IPC channel, and `scripts/run-project-gate.mjs`
 * gave `velar test` none, so a gate script killed mid-run left its supervisor
 * and its worker running with nothing left to report to. They were still there
 * hours later, holding a Chromium each.
 *
 * So parent death is observed three ways at once, because each of the three is
 * blind to a case the others see:
 *
 *  - **`process.ppid`**, polled once a second by an unreferenced timer. When a
 *    parent dies its children are reparented — to `launchd` on macOS, to the
 *    nearest subreaper or to `init` on Linux — and `process.ppid` changes. It
 *    is the only one of the three that needs nothing to have been set up in
 *    advance, so it is the one that covers a plain `spawnSync` launcher.
 *  - **`EPIPE` / `ERR_STREAM_DESTROYED` on stdout or stderr.** The reader of a
 *    piped stdout disappearing is the same news arriving through a different
 *    door, and it arrives even when the process was reparented to something
 *    that is still alive. Listening for it is also what keeps that failure from
 *    becoming an uncaught exception: `process.stdout` is never destroyed by an
 *    error, so without a listener every later line writes, fails, and throws
 *    again.
 *  - **IPC `disconnect`**, which is immediate and exact when a channel exists.
 *
 * The watch reports once. What it reports to is the caller's own stop path —
 * the same one its SIGTERM handler runs — because a process that ends two
 * different ways depending on how it learned the news is a process with two
 * teardown paths to keep correct.
 */
export interface ParentDeathWatch {
  /** Runs at most once, naming which of the three observations fired. */
  readonly stop: (reason: string) => void;
  /** Poll period for the reparenting check. One second unless a test shortens it. */
  readonly pollIntervalMs?: number;
}

/** How often a process asks whether the parent that started it is still there. */
const parentPollIntervalMs = 1_000;

export function watchParentDeath(watch: ParentDeathWatch): () => void {
  const startingParent = process.ppid;
  let reported = false;
  const stop = (reason: string): void => {
    if (reported) return;
    reported = true;
    watch.stop(reason);
  };
  const onDisconnect = (): void => stop("the process that started it closed their channel");
  const onWriteFailure = (error: NodeJS.ErrnoException): void => {
    if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") return;
    stop("nothing is reading its output");
  };
  const timer = setInterval(() => {
    if (process.ppid !== startingParent) stop("the process that started it exited");
  }, watch.pollIntervalMs ?? parentPollIntervalMs);
  // The watch must never be the reason the process stays up: a run that ends
  // on its own has to end whether or not anyone is still watching for a parent.
  timer.unref();
  process.on("disconnect", onDisconnect);
  process.stdout.on("error", onWriteFailure);
  process.stderr.on("error", onWriteFailure);
  return (): void => {
    clearInterval(timer);
    process.off("disconnect", onDisconnect);
    process.stdout.off("error", onWriteFailure);
    process.stderr.off("error", onWriteFailure);
  };
}

/**
 * The last resort, for the processes an orderly teardown can still miss.
 *
 * Playwright starts its browser in a process group of its own, so the group
 * kill a supervisor sends to `-worker.pid` cannot reach it: the browser lives
 * or dies with the pipe held by the process that launched it. That is enough
 * while the launcher exits, and not enough when it is killed outright or when
 * it wedges before its cleanup runs — which is how four Chromium helpers
 * outlived a gate by hours.
 *
 * A `process.on("exit")` handler cannot await anything, so this is a signal
 * rather than a graceful close: the group first, so the browser's own helpers
 * go with it, then the process alone if it was never a group leader. Anything
 * already reaped is skipped, which is what keeps a recycled pid safe.
 */
const guardedChildren = new Set<ChildProcess>();
let exitNetArmed = false;

export function guardChildOnExit(child: ChildProcess): void {
  guardedChildren.add(child);
  child.once("exit", () => guardedChildren.delete(child));
  if (exitNetArmed) return;
  exitNetArmed = true;
  process.on("exit", killGuardedChildren);
}

export function releaseChildOnExit(child: ChildProcess): void {
  guardedChildren.delete(child);
}

/** Every process this one owns and did not manage to close, ended the blunt way. */
function killGuardedChildren(): void {
  for (const child of guardedChildren) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) continue;
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, "SIGKILL");
        continue;
      } catch {}
    }
    try { child.kill("SIGKILL"); }
    catch {}
  }
  guardedChildren.clear();
}
