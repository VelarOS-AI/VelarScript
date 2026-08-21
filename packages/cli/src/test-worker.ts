import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { hostErrorStack } from "./host-error.ts";
import { captureUnownedErrors, mapCompiledStacksToSources, unsettledWorkFailure, type UnownedErrorChannel } from "./unowned-errors.ts";

/**
 * `velar test` runs one test file per worker thread, and this module is the
 * thread.
 *
 * A bound that has to survive a wedged test cannot live in the test's own
 * thread: `Promise.race` never preempts a synchronous loop, because the timer
 * that would report the hang is a macrotask the spinning body never yields to.
 * Worker termination does interrupt synchronous JavaScript, so the hard bound
 * belongs to the parent and this thread owns only the running and the
 * reporting. Terminating also ends an abandoned body, which is what stops a
 * timed-out test from going on mutating state a later test asserts against;
 * and a thread per file gives every module in the import graph — not only the
 * entry, which is all a `?run=` cache-buster can freshen — its own evaluation.
 *
 * Verdict lines are written from here rather than posted to the parent so that
 * a test's own `print` output stays next to the verdict it belongs to. The
 * parent counts from the reports and prints only what this thread cannot: the
 * verdict of a test that wedged it.
 */

/** One test to run, with the author's title already escaped by the parent. */
export interface TestWorkerTest {
  readonly name: string;
  readonly title: string;
}

export interface TestWorkerInput {
  /** Absolute path of the compiled entry module in the run's sandbox. */
  readonly entry: string;
  /** The test file's reported path, escaped, as a verdict line names it. */
  readonly label: string;
  /** The same path unescaped, as the file-level lines name it. */
  readonly path: string;
  readonly tests: readonly TestWorkerTest[];
  /** The first test to run: a replacement thread resumes past the one that ended its predecessor. */
  readonly firstIndex: number;
  readonly testTimeoutMs: number;
  readonly settleTimeoutMs: number;
}

export type TestWorkerReport =
  /** Sent before the entry is imported, so the parent's bounds exclude thread startup. */
  | { readonly kind: "ready" }
  | { readonly kind: "load"; readonly ok: boolean }
  | { readonly kind: "begin"; readonly index: number }
  /** The test body is done with the thread; what follows is bounded by the settle bound. */
  | { readonly kind: "settling"; readonly index: number }
  | {
    readonly kind: "verdict";
    readonly index: number;
    readonly passed: boolean;
    /**
     * False when this thread can no longer be trusted with another test — its
     * timed-out body is still live, or work it started never stopped. The
     * parent terminates it and resumes the file in a fresh one.
     */
    readonly usable: boolean;
  };

/** Raised by the in-thread bound so the caller can tell a hang from a failure. */
class TestBoundExpired extends Error {}

/**
 * The in-thread bound reports an asynchronous hang in order, next to the test
 * that caused it. The synchronous case belongs to the parent.
 *
 * The body is observed before it is raced: a `Promise.race` loser keeps
 * running, and the handler the race itself attaches swallows its rejection, so
 * a timed-out test's own later failure used to reach nobody. Reporting it on
 * the unowned channel attributes it to the test that produced it.
 */
async function boundedTest(test: () => unknown, timeoutMs: number, channel: UnownedErrorChannel): Promise<void> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const body = Promise.resolve().then(() => test());
  void body.catch((error: unknown) => {
    if (!expired) return;
    channel.report(`the body of this test failed after its bound expired\n${hostErrorStack(error)}`);
  });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new TestBoundExpired(`this test did not finish within its ${timeoutMs} millisecond bound`));
    }, timeoutMs);
  });
  void deadline.catch(() => {});
  try {
    await Promise.race([body, deadline]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Work a test started is work the test owns. Waiting for the thread to run out
 * of work before reading the verdict is what makes a late failure belong to the
 * test that started it instead of whichever later test happens to be running
 * when it lands — and what stops it from being dropped entirely. A fixed sleep
 * cannot do this job: a failure one millisecond past the sleep is a failure
 * nobody counts.
 */
async function settleWork(channel: UnownedErrorChannel, settleTimeoutMs: number): Promise<string | null> {
  if (await channel.settle(settleTimeoutMs)) return null;
  return unsettledWorkFailure("by this test", settleTimeoutMs);
}

async function runTestFile(input: TestWorkerInput, report: (message: TestWorkerReport) => void): Promise<void> {
  mapCompiledStacksToSources();
  const channel = captureUnownedErrors();
  // A file resumed past the test that wedged its predecessor evaluates every
  // module in it again, so a module initialization that only works once fails
  // here rather than where the author would look for it. Say which it was.
  const resumed = input.firstIndex === 0
    ? ""
    : `\nThis thread resumed the file at test ${input.firstIndex + 1}, so every module it imports was initialized again.`;
  try {
    report({ kind: "ready" });
    let namespace: Record<string, unknown>;
    try {
      namespace = await import(pathToFileURL(input.entry).href) as Record<string, unknown>;
    } catch (error) {
      process.stderr.write(`✗ ${input.path} failed to load\n${hostErrorStack(error)}${resumed}\n`);
      await channel.drain();
      report({ kind: "load", ok: false });
      return;
    }
    // A module initialization error that surfaced on the host channel instead
    // of the import's own await (BLD-D1's exact shape) fails the file's tests
    // before any of them can run green.
    const loadTimeErrors = await channel.drain();
    if (loadTimeErrors.length > 0) {
      process.stderr.write(`✗ ${input.path} reported an unowned error while loading\n${loadTimeErrors.join("\n")}${resumed}\n`);
      report({ kind: "load", ok: false });
      return;
    }
    report({ kind: "load", ok: true });

    for (let index = input.firstIndex; index < input.tests.length; index += 1) {
      const declared = input.tests[index]!;
      // D39 item 53 + D51 rule 105: the reporter quotes the author's name for
      // the test, escaped, because a verdict line must say what it means on
      // every terminal. The parent escaped both halves before spawning.
      const verdict = `${input.label} :: ${declared.title}`;
      report({ kind: "begin", index });
      let failure: unknown = null;
      let usable = true;
      try {
        const test = namespace[declared.name];
        if (typeof test !== "function") throw new Error(`Test ${declared.title} was not emitted`);
        if (test.length !== 0) throw new Error(`Test ${declared.title} cannot declare parameters`);
        await boundedTest(test as () => unknown, input.testTimeoutMs, channel);
      } catch (error) {
        failure = error;
        // The body of a timed-out test was never cancelled; it is still live on
        // this thread and would run on beside the next test.
        if (error instanceof TestBoundExpired) usable = false;
      }
      // The settle runs on the failing path too: waiting for quiescence is what
      // lets a timed-out body's own later failure be reported against it rather
      // than vanish, and what keeps an already-failing test from hiding a
      // second, independent failure.
      report({ kind: "settling", index });
      const leftover = await settleWork(channel, input.settleTimeoutMs);
      const reports = await channel.drain();
      const notes: string[] = [];
      if (reports.length > 0) notes.push(`an unowned error was reported while this test ran\n${reports.join("\n")}`);
      if (leftover !== null) {
        notes.push(leftover);
        // Work that never stopped still holds this thread's event loop, so it
        // can never reach quiescence again and no later verdict here could be
        // trusted.
        usable = false;
      }
      if (failure === null) {
        if (notes.length > 0) failure = new Error(notes.join("\n"));
      } else if (notes.length > 0) {
        failure = new Error(`${hostErrorStack(failure)}\n${notes.join("\n")}`);
      }
      if (failure === null) {
        process.stdout.write(`✓ ${verdict}\n`);
        report({ kind: "verdict", index, passed: true, usable: true });
      } else {
        process.stderr.write(`✗ ${verdict}\n${hostErrorStack(failure)}\n`);
        report({ kind: "verdict", index, passed: false, usable });
      }
      if (!usable) return;
    }
  } finally {
    channel.release();
  }
}

if (parentPort !== null) {
  const port = parentPort;
  await runTestFile(workerData as TestWorkerInput, (message) => port.postMessage(message));
}
