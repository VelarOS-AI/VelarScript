import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { compiledTestModulePath, createCompiledSandbox, portablePath, quoteReportedText, removeCompiledSandbox, writeCompiledTestProject } from "./test-output.ts";
import { hostErrorStack } from "./host-error.ts";
import { captureUnownedErrors, flushOutput, mapCompiledStacksToSources } from "./unowned-errors.ts";

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
  // the process. The channel is shared with the browser runner so that the one
  // stance has one implementation.
  const channel = captureUnownedErrors();
  const drainUnowned = (): Promise<readonly string[]> => channel.drain();
  // Work a test started is work the test owns. Waiting for the process to run
  // out of work before reading the verdict is what makes a late failure belong
  // to the test that started it instead of whichever later test happens to be
  // running when it lands — and what stops it from being dropped entirely.
  // A fixed sleep cannot do this job: a failure one millisecond past the sleep
  // is a failure nobody counts.
  let stuck = false;
  const settleWork = async (subject: string): Promise<string | null> => {
    if (stuck) return null;
    if (await channel.settle(limits.settleTimeoutMs)) return null;
    stuck = true;
    return `work started ${subject} was still running ${limits.settleTimeoutMs} milliseconds later; a test owns the work it starts, and a failure from work that never finishes can never be reported`;
  };
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
      let namespace: Record<string, unknown>;
      try {
        namespace = await import(`${pathToFileURL(outputEntry).href}?run=${Date.now()}`) as Record<string, unknown>;
      } catch (error) {
        failed += tests.length;
        process.stderr.write(`✗ ${portablePath(relative(config.root, file))} failed to load\n${stackOf(error)}\n`);
        await drainUnowned();
        continue;
      }
      // A module initialization error that surfaced on the host channel
      // instead of the import's own await (BLD-D1's exact shape) fails the
      // file's tests before any of them can run green.
      const loadTimeErrors = await drainUnowned();
      if (loadTimeErrors.length > 0) {
        failed += tests.length;
        process.stderr.write(`✗ ${portablePath(relative(config.root, file))} reported an unowned error while loading\n${loadTimeErrors.join("\n")}\n`);
        continue;
      }
      for (const declared of tests) {
        // D39 item 53 + D51 rule 105: the reporter quotes the author's name for
        // the test, escaped, because a verdict line must say what it means on
        // every terminal.
        const name = quoteReportedText(declared.title);
        const test = namespace[declared.name];
        try {
          if (typeof test !== "function") throw new Error(`Test ${name} was not emitted`);
          if (test.length !== 0) throw new Error(`Test ${name} cannot declare parameters`);
          await boundedTest(test as () => unknown, limits.testTimeoutMs);
          const leftover = await settleWork("by this test");
          const testErrors = await drainUnowned();
          if (testErrors.length > 0) {
            throw new Error(`an unowned error was reported while this test ran\n${testErrors.join("\n")}`);
          }
          if (leftover !== null) throw new Error(leftover);
          passed += 1;
          process.stdout.write(`✓ ${quoteReportedText(portablePath(relative(config.root, file)))} :: ${name}\n`);
        } catch (error) {
          failed += 1;
          await drainUnowned();
          process.stderr.write(`✗ ${quoteReportedText(portablePath(relative(config.root, file)))} :: ${name}\n${stackOf(error)}\n`);
        }
      }
    }
    // Work a test left behind (a straggling timer, a task that outlived its
    // test) still fails the run instead of crashing it after the guards come
    // down.
    const leftover = await settleWork("during this run");
    const trailing = await drainUnowned();
    if (trailing.length > 0) {
      failed += 1;
      process.stderr.write(`✗ an unowned error was reported after the last test\n${trailing.join("\n")}\n`);
    }
    if (leftover !== null) {
      failed += 1;
      process.stderr.write(`✗ ${leftover}\n`);
    }
  } finally {
    channel.release();
    await removeCompiledSandbox(temporary);
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  const code = failed === 0 ? 0 : 1;
  if (stuck && limits.exitWhenStuck) {
    // The process cannot end on its own — work a test started still holds the
    // event loop. The verdict is already written; ending the run beats hanging
    // a gate forever on a failure that has already been reported.
    await flushOutput(process.stdout);
    await flushOutput(process.stderr);
    process.exit(code);
  }
  return code;
}

/**
 * A test that never settles is a failure that never reaches a human. The bound
 * makes the hang a reported failure; the work itself keeps whatever handles it
 * holds, which the run-level settle then reports in its own right.
 */
async function boundedTest(test: () => unknown, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`this test did not finish within its ${timeoutMs} millisecond bound`)),
      timeoutMs,
    );
  });
  void deadline.catch(() => {});
  try {
    await Promise.race([Promise.resolve().then(() => test()), deadline]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
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

function stackOf(error: unknown): string {
  return hostErrorStack(error);
}
