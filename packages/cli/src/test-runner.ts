import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Readable } from "node:stream";
import { Worker } from "node:worker_threads";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { compiledTestModulePath, createCompiledSandbox, portablePath, quoteReportedText, removeCompiledSandbox, writeCompiledTestProject } from "./test-output.ts";
import type { TestWorkerInput, TestWorkerReport } from "./test-worker.ts";
import { hostErrorStack } from "./host-error.ts";
import { captureUnownedErrors, flushOutput, mapCompiledStacksToSources, unsettledWorkFailure } from "./unowned-errors.ts";

export interface TestRunnerOptions {
  readonly testTimeoutMs?: number;
  readonly settleTimeoutMs?: number;
  /**
   * Ends a run whose leftover work holds the event loop open. A CLI run must
   * end; an in-process caller owns its own process and disables this.
   */
  readonly exitWhenStuck?: boolean;
}

interface TestLimits {
  readonly testTimeoutMs: number;
  readonly settleTimeoutMs: number;
  readonly exitWhenStuck: boolean;
}

const defaultTestTimeoutMs = 120_000;
const defaultTestSettleTimeoutMs = 10_000;

/**
 * Room a report needs to cross the thread boundary. The thread owns the bound
 * it can honour — an asynchronous hang, reported in order next to the test that
 * caused it — and this process steps in only for the synchronous one, which no
 * timer inside that thread will ever see.
 */
const workerReportGraceMs = 1_000;

/** Upper bound on waiting for a terminated thread's piped output to arrive. */
const workerOutputFlushMs = 1_000;

/*
 * `tsc` rewrites a relative import specifier, but not a URL built at run time,
 * so the worker entry is named with the extension this module itself has.
 */
const testWorkerEntry = new URL(
  import.meta.url.endsWith(".ts") ? "./test-worker.ts" : "./test-worker.js",
  import.meta.url,
);

function testLimits(options: TestRunnerOptions): TestLimits {
  const bounded = (value: number | undefined, fallback: number, name: string): number => {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 600_000) {
      throw new RangeError(`${name} must be an integer from 1 through 600000`);
    }
    return resolved;
  };
  return {
    testTimeoutMs: bounded(options.testTimeoutMs, defaultTestTimeoutMs, "Test timeout"),
    settleTimeoutMs: bounded(options.settleTimeoutMs, defaultTestSettleTimeoutMs, "Test settle timeout"),
    exitWhenStuck: options.exitWhenStuck !== false,
  };
}

export async function runTests(
  config: VelarProjectConfig,
  explicitInput: string | null,
  options: TestRunnerOptions = {},
): Promise<number> {
  const limits = testLimits(options);
  const files = explicitInput?.endsWith(".test.vel")
    ? [config.entryPath]
    : await discoverTestFiles(config.root, new Set([config.outDir, config.publicDir]));
  if (files.length === 0) {
    process.stderr.write("No .test.vel files were found\n");
    return 1;
  }

  mapCompiledStacksToSources();
  const temporary = await createCompiledSandbox(config.root, "test");
  let passed = 0;
  let failed = 0;
  // The runner keeps running: an unowned failure belongs to the test, never to
  // the process. Each test file runs in its own thread, which owns the channel
  // for its own tests; this one covers what happens in the runner itself, and
  // is what the run-level settle below reads.
  const channel = captureUnownedErrors();
  let stuck = false;
  try {
    await prepareStandardModules(temporary, config);
    for (const file of files) {
      const project = await compileProject(file, new Map(), {
        sourceRoot: config.root,
        projectRoot: config.root,
        publicRoot: config.publicDir,
        extensions: config.compilerExtensions,
        extensionConfig: config.extensionConfig,
        framework: config.framework,
        exportTestFunctions: true,
      });
      const errors = [
        ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
        ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
      ];
      if (errors.length > 0) {
        failed += 1;
        process.stderr.write(`✗ ${portablePath(relative(config.root, file))}\n${errors.join("\n\n")}\n`);
        continue;
      }

      await writeCompiledTestProject(project, temporary);

      const entry = project.modules.find((module) => module.inputPath === file);
      const tests = entry?.result.moduleInterface.tests ?? [];
      if (tests.length === 0) {
        failed += 1;
        process.stderr.write(`✗ ${portablePath(relative(config.root, file))} declares no tests\n`);
        continue;
      }
      const outputEntry = entry ? compiledTestModulePath(project, entry, temporary) : join(temporary, relative(config.root, file).replace(/\.vel$/u, ".js"));
      // D39 item 53 + D51 rule 105: author text — the file's path and each
      // test's name — is escaped here, once, and the thread reports what it is
      // given.
      const path = portablePath(relative(config.root, file));
      const input = {
        entry: outputEntry,
        label: quoteReportedText(path),
        path,
        tests: tests.map((declared) => ({ name: declared.name, title: quoteReportedText(declared.title) })),
        testTimeoutMs: limits.testTimeoutMs,
        settleTimeoutMs: limits.settleTimeoutMs,
      };
      // A thread that a test wedged cannot judge the tests after it, so the
      // file resumes past that test in a fresh thread. Every resume starts
      // beyond the test that ended its predecessor, so the file always
      // finishes.
      let firstIndex = 0;
      for (;;) {
        const outcome = await runTestFileInThread({ ...input, firstIndex });
        passed += outcome.passed;
        failed += outcome.failed;
        if (outcome.resumeAt === null) break;
        firstIndex = outcome.resumeAt;
      }
    }
    // Work the runner itself left behind still fails the run instead of
    // crashing it after the guards come down. A test's own leftover work is no
    // longer among it: the thread that started it was terminated with it. The
    // settle comes first so that a report landing during it is still drained
    // and printed rather than discarded when the channel is released.
    const settled = await channel.settle(limits.settleTimeoutMs);
    const trailing = await channel.drain();
    if (trailing.length > 0) {
      failed += 1;
      process.stderr.write(`✗ an unowned error was reported after the last test\n${trailing.join("\n")}\n`);
    }
    if (!settled) {
      stuck = true;
      failed += 1;
      process.stderr.write(`✗ ${unsettledWorkFailure("during this run", limits.settleTimeoutMs)}\n`);
    }
  } finally {
    channel.release();
    await removeCompiledSandbox(temporary);
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  const code = failed === 0 ? 0 : 1;
  if (stuck && limits.exitWhenStuck) {
    // The process cannot end on its own — work started during this run still
    // holds the event loop. The verdict is already written; ending the run
    // beats hanging a gate forever on a failure that has already been reported.
    await flushOutput(process.stdout);
    await flushOutput(process.stderr);
    process.exit(code);
  }
  return code;
}

interface TestFileOutcome {
  readonly passed: number;
  readonly failed: number;
  /** Where a replacement thread resumes the file, or null when the file is done. */
  readonly resumeAt: number | null;
}

/**
 * Runs one test file in its own thread.
 *
 * Two bounds a test cannot reach live here. The hard one is termination: a
 * synchronously spinning test never yields to the timer that would report it,
 * so the only bound it obeys is the end of its thread. The quieter one is
 * isolation: a fresh thread evaluates every module in the file's import graph
 * again, so a test file's verdict no longer depends on which files ran before
 * it.
 */
async function runTestFileInThread(input: TestWorkerInput): Promise<TestFileOutcome> {
  const worker = new Worker(testWorkerEntry, { workerData: input, stdout: true, stderr: true });
  worker.stdout.pipe(process.stdout, { end: false });
  worker.stderr.pipe(process.stderr, { end: false });
  let passed = 0;
  let failed = 0;
  let resumeAt: number | null = null;
  // Tests up to this index have a verdict. Anything left when the thread ends
  // is a test nobody judged.
  let judged = input.firstIndex;
  let bound: ReturnType<typeof setTimeout> | null = null;
  let failure: unknown = null;
  const disarm = (): void => {
    if (bound !== null) clearTimeout(bound);
    bound = null;
  };
  const arm = (timeoutMs: number, expire: () => void): void => {
    disarm();
    bound = setTimeout(expire, timeoutMs + workerReportGraceMs);
  };
  // Nothing this thread holds can be trusted and nothing more will be reported
  // from it. Termination is the only bound synchronous work obeys, and reports
  // already in flight are ignored so that a verdict cannot be counted twice.
  let ended = false;
  const abandon = (): void => {
    ended = true;
    disarm();
    void worker.terminate();
  };
  // The parent is never left waiting without a bound. Between the last report
  // it expects and the thread's own `exit` there is still a wait, and a module
  // whose initialization armed a timer before it failed holds that thread's
  // loop open forever — a hang through a different door than the one the
  // per-test bound closes. Every path that stops expecting reports arms this
  // instead of disarming into an unbounded wait.
  const expectExit = (): void => {
    arm(input.settleTimeoutMs, abandon);
  };
  const failTest = (index: number, text: string): void => {
    failed += 1;
    judged = index + 1;
    resumeAt = judged < input.tests.length ? judged : null;
    process.stderr.write(`✗ ${input.label} :: ${input.tests[index]!.title}\n${text}\n`);
    abandon();
  };
  const failFile = (text: string): void => {
    failed += input.tests.length - judged;
    judged = input.tests.length;
    process.stderr.write(`✗ ${input.path} ${text}\n`);
    abandon();
  };

  // A thread that never reports `ready` never armed a bound of its own.
  arm(input.testTimeoutMs, () => failFile(`did not start within its ${input.testTimeoutMs} millisecond bound`));

  await new Promise<void>((resolve) => {
    worker.on("message", (message: TestWorkerReport) => {
      if (ended) return;
      switch (message.kind) {
        case "ready":
          // The thread is up, so the bound from here measures the file's own
          // module initialization rather than thread startup. It stays armed
          // until the first test begins.
          arm(input.testTimeoutMs, () => failFile(`did not finish loading within its ${input.testTimeoutMs} millisecond bound`));
          break;
        case "load":
          // The thread reported the failure itself and is ending; only the
          // count is owed here — and a bound on the ending, because a module
          // that failed after arming a timer never lets the thread end.
          if (!message.ok) {
            failed += input.tests.length - judged;
            judged = input.tests.length;
            expectExit();
          }
          break;
        case "begin":
          arm(input.testTimeoutMs, () => failTest(message.index, `this test did not finish within its ${input.testTimeoutMs} millisecond bound`));
          break;
        case "settling":
          arm(input.settleTimeoutMs, () => failTest(message.index, unsettledWorkFailure("by this test", input.settleTimeoutMs)));
          break;
        case "verdict":
          judged = message.index + 1;
          if (message.passed) passed += 1;
          else failed += 1;
          if (message.usable) {
            // The next test's `begin` re-arms; after the last one this is the
            // wait for the thread to end, which is bounded like any other.
            expectExit();
            break;
          }
          resumeAt = judged < input.tests.length ? judged : null;
          abandon();
          break;
      }
    });
    worker.once("error", (error: unknown) => { failure = error; });
    worker.once("exit", () => {
      disarm();
      resolve();
    });
  });

  // Piped output has to reach this process before the runner writes anything of
  // its own, or a verdict overtakes the `print` output of the test it belongs
  // to. A terminated thread may never end its pipes, so the wait is bounded.
  await Promise.all([drainedOutput(worker.stdout), drainedOutput(worker.stderr)]);
  worker.stdout.unpipe(process.stdout);
  worker.stderr.unpipe(process.stderr);

  if (judged < input.tests.length && resumeAt === null) {
    failed += input.tests.length - judged;
    process.stderr.write(`✗ ${input.path} ended before its tests were judged${failure === null ? "" : `\n${hostErrorStack(failure)}`}\n`);
  }
  return { passed, failed, resumeAt };
}

function drainedOutput(stream: Readable): Promise<void> {
  return new Promise<void>((resolve) => {
    if (stream.readableEnded || stream.destroyed) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (): void => {
      if (timer !== null) clearTimeout(timer);
      stream.off("end", finish);
      stream.off("close", finish);
      resolve();
    };
    timer = setTimeout(finish, workerOutputFlushMs);
    stream.once("end", finish);
    stream.once("close", finish);
  });
}

async function discoverTestFiles(root: string, excluded: ReadonlySet<string>): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".velar" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".test.vel") && !entry.name.endsWith(".browser.test.vel")) {
        output.push(path);
      }
    }
  };
  await visit(root);
  return output.sort();
}

export async function prepareStandardModules(root: string, config: VelarProjectConfig): Promise<void> {
  const packageRoot = join(root, "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  for (const [source, code] of standardModuleSources(config.compilerExtensions)) {
    const name = source.slice("velar/".length);
    exports[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), standardModuleSource(source, config.extensionConfig, config.compilerExtensions) ?? code, "utf8");
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports }), "utf8");
}
