import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic, type ModuleTest } from "@velarscript/compiler";
import type { FrameworkBrowserTestController } from "@velarscript/compiler/framework-host";
import {
  chromium, firefox, webkit,
  type Browser, type BrowserServer, type BrowserType, type Locator, type Page,
} from "playwright";
import { browserPerformanceRuntimeKey } from "./browser-performance-abi.ts";
import { VELAR_BROWSER_PERFORMANCE_RUNTIME } from "./runtime-sources.generated.ts";
import type { VelarProjectConfig } from "./config.ts";
import { formatProjectFailures } from "./project-failure.ts";
import { requiredCompilerRuntimeModules } from "./compiler-runtime-modules.ts";
import { registerNodeCompilerRuntimeResolver } from "./node-compiler-runtime-resolver.ts";
import type { ProjectModule, ProjectResult } from "./project.ts";
import { createProjectExecutionCompilation } from "./project-execution-compilation.ts";
import { writeStandardModuleSandbox } from "./standard-module-sandbox.ts";
import { compiledTestModulePath, portablePath, quoteReportedText, writeCompiledTestProject } from "./test-output.ts";
import { verifyProductionBuild } from "./production-verifier.ts";
import { startProductionPreview, type ProductionPreviewHandle } from "./preview-server.ts";
import { hostErrorStack } from "./host-error.ts";
import { captureUnownedErrors, mapCompiledStacksToSources, type UnownedErrorChannel } from "./unowned-errors.ts";
import {
  boundedBrowserOperation, browserCleanupTimeoutMs, browserRunDeadlineMs,
  exitBrowserWorker,
  launchOwnedBrowserServer,
  observeBrowserWorkerParent,
  superviseBrowserWorker,
  terminateBrowserServer,
  type BrowserWorkerReport,
} from "./browser-process-owner.ts";
/**
 * The one thing an author who reached this failure did not know. A
 * `.browser.test.vel` body runs in the test process and drives a page that is
 * already running the built application, so a page API called from the test
 * body fails on a host that has no DOM and no storage. The compile-time
 * guidance for `document` says the same thing at the other end.
 */
const browserTestHostGuidance = [
  "A .browser.test.vel body runs in the test process, not in the page — the page already runs the built application.",
  'Drive it through `import {browser} from "velar/web-test"`: browser.open("/"), browser.fill(selector, text),',
  "browser.click(selector), browser.waitForText(selector, text), browser.text(selector).",
  "mount, JSX, document, and velar/storage are page APIs and are unavailable in the test process.",
].join("\n");

export type BrowserEngine = "chromium" | "firefox" | "webkit";
export type BrowserEngineSelection = BrowserEngine | "all";

const browserTypes: Readonly<Record<BrowserEngine, BrowserType>> = { chromium, firefox, webkit };
const defaultBrowserTestTimeoutMs = 120_000;
const browserTestWorkerEnvironment = "VELAR_BROWSER_TEST_WORKER_V1";

export interface BrowserTestRunnerOptions {
  readonly testTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly executable?: string;
}

interface BrowserTestLimits {
  readonly testTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
}

class BrowserTestInterrupted extends Error {
  readonly exitCode: number;

  constructor(signal: "SIGHUP" | "SIGINT" | "SIGTERM", exitCode: number) {
    super(`Browser test run interrupted by ${signal}`);
    this.name = "BrowserTestInterrupted";
    this.exitCode = exitCode;
  }
}

class BrowserTestRunTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`Browser test run exceeded its ${timeoutMs} millisecond aggregate deadline`);
    this.name = "BrowserTestRunTimedOut";
  }
}

function browserTestLimits(options: BrowserTestRunnerOptions): BrowserTestLimits {
  const bounded = (value: number | undefined, fallback: number, name: string, maximum: number): number => {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
      throw new RangeError(`${name} must be an integer from 1 through ${maximum}`);
    }
    return resolved;
  };
  return {
    testTimeoutMs: bounded(options.testTimeoutMs, defaultBrowserTestTimeoutMs, "Browser test timeout", 10 * 60_000),
    runTimeoutMs: bounded(options.runTimeoutMs, browserRunDeadlineMs, "Browser test run timeout", 60 * 60_000),
    cleanupTimeoutMs: bounded(options.cleanupTimeoutMs, browserCleanupTimeoutMs, "Browser cleanup timeout", 60_000),
  };
}

export async function runBrowserTests(
  config: VelarProjectConfig,
  explicitInput: string | null,
  selection: BrowserEngineSelection,
  options: BrowserTestRunnerOptions = {},
): Promise<number> {
  const workerOptions = process.env[browserTestWorkerEnvironment];
  if (workerOptions !== undefined && typeof process.send === "function") {
    const resolvedOptions = browserTestWorkerOptions(workerOptions);
    const stopObservingParent = observeBrowserWorkerParent();
    // The worker owns its process and ends it with process.exit, so the exit
    // net is this runner's last guarantee that a report arriving after the
    // verdict cannot leave the run green.
    const channel = captureUnownedErrors({ exitNet: true });
    mapCompiledStacksToSources();
    let code = 1;
    try {
      code = await runBrowserTestsInWorker(config, explicitInput, selection, resolvedOptions, channel);
    } catch (error) {
      process.stderr.write(`${stackOf(error)}\n`);
    }
    const trailing = await channel.drain();
    if (trailing.length > 0) {
      process.stderr.write(`✗ an unowned error was reported after the last browser test\n${trailing.join("\n")}\n${browserTestHostGuidance}\n`);
      code = code === 0 ? 1 : code;
    }
    stopObservingParent();
    await exitBrowserWorker(code);
  }
  return superviseBrowserTests(config, explicitInput, selection, options);
}

async function superviseBrowserTests(
  config: VelarProjectConfig,
  explicitInput: string | null,
  selection: BrowserEngineSelection,
  options: BrowserTestRunnerOptions,
): Promise<number> {
  const limits = browserTestLimits(options);
  const executable = resolve(options.executable ?? process.argv[1]!);
  const input = explicitInput === null ? config.root : resolve(explicitInput);
  return superviseBrowserWorker({
    executable: process.execPath,
    arguments: [executable, "test", input, `--browser=${selection}`],
    cwd: config.root,
    environment: { ...process.env, [browserTestWorkerEnvironment]: JSON.stringify(limits) },
    deadlineMs: limits.runTimeoutMs,
    cleanupTimeoutMs: limits.cleanupTimeoutMs,
  });
}

function browserTestWorkerOptions(value: string): BrowserTestRunnerOptions {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new TypeError("Browser test worker options are invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.keys(parsed).some((name) => name !== "testTimeoutMs" && name !== "runTimeoutMs" && name !== "cleanupTimeoutMs")) {
    throw new TypeError("Browser test worker options are invalid");
  }
  const record = parsed as Record<string, unknown>;
  for (const name of ["testTimeoutMs", "runTimeoutMs", "cleanupTimeoutMs"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(record, name);
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "number") {
      throw new TypeError("Browser test worker options are invalid");
    }
  }
  return browserTestLimits(record as unknown as BrowserTestRunnerOptions);
}

async function runBrowserTestsInWorker(
  config: VelarProjectConfig,
  explicitInput: string | null,
  selection: BrowserEngineSelection,
  options: BrowserTestRunnerOptions,
  channel: UnownedErrorChannel,
): Promise<number> {
  const limits = browserTestLimits(options);
  const contract = config.framework?.host.browserTests;
  if (!config.framework || !contract) {
    process.stderr.write("The project framework does not provide browser-test hosting\n");
    return 1;
  }
  const runtimeKey = Symbol.for(contract.runtimeKey);
  const files = explicitInput?.endsWith(contract.sourceSuffix)
    ? [resolve(explicitInput)]
    : await discoverBrowserTestFiles(config.root, new Set([config.outDir, config.publicDir]), contract.sourceSuffix);
  if (files.length === 0) {
    process.stderr.write("No .browser.test.vel files were found\n");
    return 1;
  }

  const temporary = await mkdtemp(join(tmpdir(), "velar-browser-tests-"));
  const site = join(temporary, "site");
  const compiled = join(temporary, "tests");
  let server: ProductionPreviewHandle | null = null;
  let activeBrowser: Browser | null = null;
  let activeBrowserServer: BrowserServer | null = null;
  let passed = 0;
  let failed = 0;
  // A body that outlived its bound cannot be cancelled in this process, so
  // what it reports afterwards lands on whichever test is running then. Naming
  // the tests it could have come from is what this process can offer instead
  // of the thread termination the Node runner uses.
  const abandonedBodies: string[] = [];
  try {
    const build = await buildProject(config, site, options.executable);
    if (!build.ok) {
      process.stderr.write(build.output);
      return 1;
    }
    const verified = await verifyProductionBuild(site);
    const entries: BrowserTestEntry[] = [];
    for (const file of files) {
      const entry = await compileBrowserTest(file, config);
      if (!entry) {
        failed += 1;
        continue;
      }
      entries.push(entry);
    }
    if (entries.length === 0) {
      process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
      return 1;
    }
    const runtimeModules = new Set(entries.flatMap((entry) => [...requiredCompilerRuntimeModules(entry.project)]));

    server = await startProductionPreview(verified, 0);
    const origin = server.origin;
    const engines: readonly BrowserEngine[] = selection === "all"
      ? ["chromium", "firefox", "webkit"]
      : [selection];
    let lifecycleFailure: BrowserTestInterrupted | BrowserTestRunTimedOut | null = null;
    let rejectLifecycle!: (error: BrowserTestInterrupted | BrowserTestRunTimedOut) => void;
    const lifecycle = new Promise<never>((_resolve, reject) => { rejectLifecycle = reject; });
    void lifecycle.catch(() => {});
    const stop = (error: BrowserTestInterrupted | BrowserTestRunTimedOut): void => {
      if (lifecycleFailure !== null) return;
      lifecycleFailure = error;
      rejectLifecycle(error);
    };
    const onHangup = (): void => stop(new BrowserTestInterrupted("SIGHUP", 129));
    const onInterrupt = (): void => stop(new BrowserTestInterrupted("SIGINT", 130));
    const onTerminate = (): void => stop(new BrowserTestInterrupted("SIGTERM", 143));
    process.once("SIGHUP", onHangup);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    const runTimer = setTimeout(() => stop(new BrowserTestRunTimedOut(limits.runTimeoutMs)), limits.runTimeoutMs);
    try {
      for (const engine of engines) {
        if (lifecycleFailure !== null) throw lifecycleFailure;
        let engineStarted = false;
        let engineUsable = true;
        let runtimeResolver: ReturnType<typeof registerNodeCompilerRuntimeResolver> | undefined;
        try {
          activeBrowserServer = await launchOwnedBrowserServer(browserTypes[engine], { headless: true, timeout: 30_000 });
          engineStarted = true;
          if (lifecycleFailure !== null) throw lifecycleFailure;
          activeBrowser = await browserTypes[engine].connect(activeBrowserServer.wsEndpoint(), { timeout: 30_000 });
          // A distinct tree gives every module in an engine's graph, including
          // compiler extension source and runtime package members, a fresh URL.
          const engineRoot = join(compiled, engine);
          runtimeResolver = await installBrowserCompilerRuntime(engineRoot, config, runtimeModules, entries);
          engineEntries:
          for (const entry of entries) {
            const output = await writeBrowserTestEntry(entry, engineRoot, config, runtimeModules);
            let namespace: Record<string, unknown>;
            try {
              namespace = await import(pathToFileURL(output).href) as Record<string, unknown>;
            } catch (error) {
              if (lifecycleFailure !== null) throw lifecycleFailure;
              failed += entry.tests.length;
              process.stderr.write(`✗ ${engine} :: ${portablePath(relative(config.root, entry.file))} failed to load\n${stackOf(error)}\n${browserTestHostGuidance}\n`);
              await channel.drain();
              continue;
            }
            // A module initialization error that surfaced on the host channel
            // instead of the import's own await — the shape a mounted entry
            // takes when a browser test imports it — fails the file's tests
            // before any of them can run green.
            const loadTimeErrors = await channel.drain();
            if (loadTimeErrors.length > 0) {
              failed += entry.tests.length;
              process.stderr.write(`✗ ${engine} :: ${portablePath(relative(config.root, entry.file))} reported an unowned error while loading\n${loadTimeErrors.join("\n")}\n${browserTestHostGuidance}\n`);
              continue;
            }
            for (const declared of entry.tests) {
              if (lifecycleFailure !== null) throw lifecycleFailure;
              // D39 item 53: the reporter quotes the author's name for the
              // test, which is the specification a person reads.
              // D51 rule 105: the browser verdict line escapes author text too.
              const name = quoteReportedText(declared.title);
              const verdictLabel = `${engine} :: ${quoteReportedText(portablePath(relative(config.root, entry.file)))} :: ${name}`;
              // The bound a synchronously spinning body obeys cannot live in
              // the process that body wedged, so the supervisor is told which
              // test is running, and with what counts behind it, before it
              // starts.
              announceToSupervisor({ kind: "begin", label: verdictLabel, timeoutMs: limits.testTimeoutMs, passed, failed });
              const test = namespace[declared.name];
              const context = await activeBrowser.newContext();
              const page = await context.newPage();
              page.setDefaultTimeout(30_000);
              page.setDefaultNavigationTimeout(30_000);
              const runtimeFailures: string[] = [];
              // How many of them the failure already carries, so that what
              // arrives while the context closes is added and not doubled.
              let reportedRuntimeFailures = 0;
              let testFailure: unknown = null;
              page.on("pageerror", (error) => runtimeFailures.push(error.stack ?? error.message));
              page.on("console", (message) => {
                if (message.type() === "error" || message.type() === "warning") {
                  runtimeFailures.push(`${message.type()}: ${message.text()}`);
                }
              });
              try {
                await installBrowserPerformanceRuntime(page);
                const frameworkConfig = config.framework.config;
                const frameworkController = contract.createController?.(frameworkConfig);
                if (frameworkController !== undefined
                  && (typeof frameworkController !== "object" || frameworkController === null
                    || typeof frameworkController.initScript !== "function"
                    || typeof frameworkController.invoke !== "function")) {
                  throw new Error("Framework browser-test controller is invalid");
                }
                installBrowserRuntime(
                  page,
                  origin,
                  verified.deployment.base,
                  runtimeKey,
                  frameworkController,
                  contract.initScript === undefined ? undefined : () => contract.initScript!(frameworkConfig),
                );
                if (typeof test !== "function") throw new Error(`Test ${name} was not emitted`);
                if (test.length !== 0) throw new Error(`Browser test ${name} cannot declare parameters`);
                await boundedBrowserTestBody(
                  test as () => unknown,
                  limits.testTimeoutMs,
                  `Browser test ${quoteReportedText(portablePath(relative(config.root, entry.file)))} :: ${name}`,
                  lifecycle,
                  channel,
                  abandonedBodies,
                );
                if (runtimeFailures.length > 0) {
                  reportedRuntimeFailures = runtimeFailures.length;
                  throw new Error(`Browser runtime failures:\n${runtimeFailures.join("\n")}`);
                }
              } catch (error) {
                testFailure = error;
              } finally {
                removeBrowserRuntime(runtimeKey);
                try {
                  await boundedBrowserOperation(context.close(), limits.cleanupTimeoutMs, "Browser context cleanup");
                } catch (cleanupError) {
                  engineUsable = false;
                  testFailure = new Error(`${testFailure === null ? "Browser test completed but its context leaked" : stackOf(testFailure)}\n${stackOf(cleanupError)}`);
                }
              }
              // The test's own window is over: what follows is the verdict,
              // and between tests only the run deadline applies.
              announceToSupervisor({ kind: "idle" });
              // The host error channel is the third way a failure reaches a
              // human here, and the one the runner used to ignore: the test
              // body runs in this process, so a page API it calls, a detached
              // task it starts, and a module it imports all report through
              // console.error, uncaughtException, or unhandledRejection rather
              // than through the page. Draining after the verdict also catches
              // page reports queued while the context closed.
              const hostReports = await channel.drain();
              // A test that has already failed still owns whatever else it
              // reported. Dropping these because a failure was in hand sends
              // the author back for a second run to meet the second failure —
              // the same discard the Node runner made on its failing path. The
              // two lifecycle errors stay unwrapped, because the run itself
              // ends on them and the check below reads their type.
              const pendingRuntimeFailures = runtimeFailures.slice(reportedRuntimeFailures);
              if ((hostReports.length > 0 || pendingRuntimeFailures.length > 0)
                && !(testFailure instanceof BrowserTestInterrupted)
                && !(testFailure instanceof BrowserTestRunTimedOut)) {
                const reported = [...pendingRuntimeFailures, ...hostReports].join("\n");
                const source = abandonedBodies.length === 0
                  ? ""
                  : `\nA body that outlived its bound is still running in this process and may be the source: ${abandonedBodies.join(", ")}.`;
                const text = hostReports.length > 0
                  ? `Browser runtime failures:\n${reported}\n${browserTestHostGuidance}${source}`
                  : `Browser runtime failures:\n${reported}${source}`;
                testFailure = testFailure === null ? new Error(text) : new Error(`${stackOf(testFailure)}\n${text}`);
              }
              if (testFailure instanceof BrowserTestInterrupted || testFailure instanceof BrowserTestRunTimedOut) throw testFailure;
              if (testFailure === null) {
                passed += 1;
                process.stdout.write(`✓ ${verdictLabel}\n`);
              } else {
                failed += 1;
                process.stderr.write(`✗ ${verdictLabel}\n${stackOf(testFailure)}\n`);
              }
              if (!engineUsable) {
                process.stderr.write(`✗ ${engine} was retired after context cleanup failed\n`);
                break engineEntries;
              }
            }
          }
        } catch (error) {
          if (lifecycleFailure !== null) throw lifecycleFailure;
          if (error instanceof BrowserTestInterrupted || error instanceof BrowserTestRunTimedOut) throw error;
          if (!engineStarted) {
            failed += entries.reduce((count, entry) => count + entry.tests.length, 0);
            process.stderr.write(`✗ ${engine} could not start\n${stackOf(error)}\nInstall it with: npx playwright install ${engine}\n`);
          } else {
            failed += 1;
            process.stderr.write(`✗ ${engine} browser-test owner failed\n${stackOf(error)}\n`);
          }
        } finally {
          runtimeResolver?.deregister();
          if (activeBrowserServer !== null) {
            const owned = activeBrowserServer;
            const connection = activeBrowser;
            activeBrowser = null;
            activeBrowserServer = null;
            await terminateBrowserServer(connection, owned, limits.cleanupTimeoutMs);
          }
        }
      }
    } catch (error) {
      if (error instanceof BrowserTestInterrupted) {
        process.stderr.write(`${error.message}\n`);
        return error.exitCode;
      }
      if (error instanceof BrowserTestRunTimedOut) {
        failed += 1;
        process.stderr.write(`✗ ${error.message}\n`);
      } else {
        throw error;
      }
    } finally {
      clearTimeout(runTimer);
      process.off("SIGHUP", onHangup);
      process.off("SIGINT", onInterrupt);
      process.off("SIGTERM", onTerminate);
    }
  } finally {
    removeBrowserRuntime(runtimeKey);
    let cleanupFailure: unknown = null;
    if (activeBrowserServer !== null) {
      try { await terminateBrowserServer(activeBrowser, activeBrowserServer, limits.cleanupTimeoutMs); }
      catch (error) { cleanupFailure = error; }
      activeBrowser = null;
      activeBrowserServer = null;
    }
    if (server) {
      try { await boundedBrowserOperation(server.close(), limits.cleanupTimeoutMs, "Browser preview cleanup"); }
      catch (error) { cleanupFailure ??= error; }
    }
    try { await rm(temporary, { recursive: true, force: true }); }
    catch (error) { cleanupFailure ??= error; }
    if (cleanupFailure !== null) throw cleanupFailure;
  }
  // The cleanup above released everything this runner owns, so whatever still
  // holds the loop is work a test started. Waiting for it before the verdict is
  // what keeps a late failure from being dropped — and keeps the printed count
  // honest about it.
  if (!await settleWorkerWork(channel, limits.cleanupTimeoutMs)) {
    failed += 1;
    process.stderr.write("✗ work a browser test started was still running when the run ended; a test owns the work it starts, and a failure from work that never finishes can never be reported\n");
  }
  const trailing = await channel.drain();
  if (trailing.length > 0) {
    failed += 1;
    process.stderr.write(`✗ an unowned error was reported after the last browser test\n${trailing.join("\n")}\n${browserTestHostGuidance}\n`);
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

/**
 * Tells the supervisor which test this process is running.
 *
 * The browser worker is a child process precisely so that one bound lives
 * outside the body that can wedge it. A run driven in-process by a harness has
 * no supervisor and simply has no such bound, which is why the report is sent
 * only when the channel is there.
 */
function announceToSupervisor(report: BrowserWorkerReport): void {
  if (typeof process.send !== "function" || !process.connected) return;
  process.send(report);
}

/**
 * The body is observed before it is raced. A `Promise.race` loser keeps
 * running — nothing in this process can cancel it — and the handler the race
 * itself attaches swallows its rejection, so a timed-out browser test's own
 * later failure used to reach nobody at all. Reporting it on the unowned
 * channel attributes it to the test that produced it, which is what the Node
 * runner does with the same shape.
 */
async function boundedBrowserTestBody(
  test: () => unknown,
  timeoutMs: number,
  label: string,
  cancellation: Promise<never>,
  channel: UnownedErrorChannel,
  abandonedBodies: string[],
): Promise<void> {
  let finished = false;
  let abandoned = false;
  const body = Promise.resolve().then(() => test());
  void body.then(() => { finished = true; }, (error: unknown) => {
    finished = true;
    if (!abandoned) return;
    // Nothing terminates this process between tests, so the report can land
    // after its own test's verdict was already taken; it names the test rather
    // than saying "this one".
    channel.report(`${label} failed after its bound expired\n${stackOf(error)}`);
  });
  try {
    await boundedBrowserOperation(body, timeoutMs, label, cancellation);
  } catch (error) {
    // A body that failed within its bound settled on the handler above, which
    // was attached before the race; only one still running when the bound
    // expired is abandoned, and nothing in this process can cancel it.
    if (!finished) {
      abandoned = true;
      abandonedBodies.push(label);
    }
    throw error;
  }
}

/**
 * Work a browser test started outlives the last test exactly as it does in the
 * Node runner, and the worker ends with process.exit, so the run must wait for
 * the process to run out of work before it takes its verdict. The one handle
 * that would make quiescence unobservable is the worker's own IPC channel to
 * its supervisor; unreferencing it for the settle window does not close it —
 * the disconnect that reports a dead parent still arrives.
 */
async function settleWorkerWork(channel: UnownedErrorChannel, timeoutMs: number): Promise<boolean> {
  const supervisorChannel = process.channel;
  supervisorChannel?.unref?.();
  try {
    return await channel.settle(timeoutMs);
  } finally {
    supervisorChannel?.ref?.();
  }
}

async function installFrameworkRuntime(page: Page, source: string | undefined): Promise<void> {
  if (source === undefined) return;
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source, "utf8") > 1024 * 1024) {
    throw new Error("Framework browser-test init script must contain 1 byte through 1 MiB of text");
  }
  await page.addInitScript({ content: source });
}

async function installBrowserPerformanceRuntime(page: Page): Promise<void> {
  await page.addInitScript({ content: VELAR_BROWSER_PERFORMANCE_RUNTIME });
}

/**
 * One compiled test file, held so that every engine's pass can be written from
 * the same compilation instead of paying for — and re-reporting — its own.
 */
interface BrowserTestEntry {
  readonly file: string;
  readonly project: ProjectResult;
  readonly entry: ProjectModule | undefined;
  readonly tests: readonly ModuleTest[];
}

async function compileBrowserTest(
  file: string,
  config: VelarProjectConfig,
): Promise<BrowserTestEntry | null> {
  const compilation = await createProjectExecutionCompilation(config, null);
  const project = await compilation.compile(file, { projectWideSource: true, exportTestFunctions: true });
  const errors = [
    ...formatProjectFailures(project),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  if (errors.length > 0) {
    process.stderr.write(`✗ ${portablePath(relative(config.root, file))}\n${errors.join("\n\n")}\n`);
    return null;
  }
  const entry = project.modules.find((module) => module.inputPath === file);
  const tests = entry?.result.moduleInterface.tests ?? [];
  if (tests.length === 0) {
    process.stderr.write(`✗ ${portablePath(relative(config.root, file))} declares no tests\n`);
    return null;
  }
  return { file, project, entry, tests };
}

/** Writes one compiled test file into an engine's own tree and names its entry. */
async function writeBrowserTestEntry(
  entry: BrowserTestEntry,
  outputRoot: string,
  config: VelarProjectConfig,
  runtimeModules: ReadonlySet<string>,
): Promise<string> {
  await writeCompiledTestProject(entry.project, outputRoot, true, runtimeModules);
  return entry.entry
    ? compiledTestModulePath(entry.project, entry.entry, outputRoot)
    : join(outputRoot, relative(config.root, entry.file).replace(/\.vel$/u, ".js"));
}

async function installBrowserCompilerRuntime(
  outputRoot: string,
  config: VelarProjectConfig,
  runtimeModules: ReadonlySet<string>,
  entries: readonly BrowserTestEntry[],
): Promise<ReturnType<typeof registerNodeCompilerRuntimeResolver>> {
  await writeStandardModuleSandbox(outputRoot, config, runtimeModules);
  return registerNodeCompilerRuntimeResolver(
    outputRoot,
    runtimeModules,
    entries.flatMap((entry) => [...entry.project.velarArtifactImports.values()]),
  );
}

function installBrowserRuntime(
  page: Page,
  origin: string,
  base: string,
  runtimeKey: symbol,
  frameworkController: FrameworkBrowserTestController | undefined = undefined,
  frameworkInitScript: (() => string) | undefined = undefined,
): void {
  const locator = (selector: unknown) => page.locator(String(selector));
  const storageArea = (area: unknown): "local" | "session" => {
    const value = String(area);
    if (value !== "local" && value !== "session") throw new Error("Browser test storage area must be local or session");
    return value;
  };
  const mockedRoutes = new Set<string>();
  let frameworkRuntime: Promise<void> | null = null;
  const installFrameworkBeforeOpen = (): Promise<void> => {
    frameworkRuntime ??= installFrameworkRuntime(page, frameworkController?.initScript() ?? frameworkInitScript?.());
    return frameworkRuntime;
  };
  const runtime = Object.freeze({
    async open(path = "/") {
      const value = String(path);
      if (!value.startsWith("/")) throw new Error("browser.open requires an application-relative path starting with '/'");
      const target = base === "/" ? value : `${base.slice(0, -1)}${value}`;
      await installFrameworkBeforeOpen();
      // Navigation owns document loading, not application network quiescence.
      // A product may poll or stream forever; tests establish readiness with
      // the web-first waitFor/waitForText assertions exposed beside open().
      await page.goto(new URL(target, origin).href, { waitUntil: "load" });
      return null;
    },
    async reload() { await page.reload({ waitUntil: "load" }); return null; },
    async click(selector: unknown) { await locator(selector).click(); return null; },
    async fill(selector: unknown, value: unknown) { await locator(selector).fill(String(value)); return null; },
    async select(selector: unknown, value: unknown) { await locator(selector).selectOption(String(value)); return null; },
    async press(selector: unknown, key: unknown) { await locator(selector).press(String(key)); return null; },
    async scroll(selector: unknown, x: unknown, y: unknown) {
      if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)
        || Math.abs(x) > 100_000_000 || Math.abs(y) > 100_000_000) {
        throw new RangeError("browser.scroll requires finite coordinates within 100000000 pixels");
      }
      await locator(selector).evaluate((element, position) => {
        const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(position.key))?.value as {
          scroll?: (target: Element, left: number, top: number) => unknown;
        } | undefined;
        if (!runtime || typeof runtime.scroll !== "function") throw new Error("Browser test scroll runtime is unavailable");
        runtime.scroll(element, position.x, position.y);
      }, { key: browserPerformanceRuntimeKey, x, y });
      return null;
    },
    async text(selector: unknown) { return await locator(selector).textContent() ?? ""; },
    async attribute(selector: unknown, name: unknown) { return locator(selector).getAttribute(String(name)); },
    async box(selector: unknown) {
      return locator(selector).evaluate((element, key) => {
        const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(key))?.value as {
          box?: (target: Element) => unknown;
        } | undefined;
        if (!runtime || typeof runtime.box !== "function") throw new Error("Browser test geometry runtime is unavailable");
        return runtime.box(element);
      }, browserPerformanceRuntimeKey);
    },
    async style(selector: unknown, property: unknown) {
      return locator(selector).evaluate((element, input) => {
        const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(input.key))?.value as {
          style?: (target: Element, property: string) => unknown;
        } | undefined;
        if (!runtime || typeof runtime.style !== "function") throw new Error("Browser test computed-style runtime is unavailable");
        return runtime.style(element, input.property);
      }, { key: browserPerformanceRuntimeKey, property: String(property) });
    },
    async namespace(selector: unknown) {
      return locator(selector).evaluate((element) => element.namespaceURI ?? "");
    },
    async count(selector: unknown) { return locator(selector).count(); },
    async visible(selector: unknown) { return locator(selector).isVisible(); },
    async waitFor(selector: unknown, state = "visible") {
      const value = String(state);
      if (value !== "visible" && value !== "hidden" && value !== "attached" && value !== "detached") {
        throw new Error("browser.waitFor state must be visible, hidden, attached, or detached");
      }
      await locator(selector).waitFor({ state: value });
      return null;
    },
    async waitForText(selector: unknown, text: unknown) {
      await locator(selector).filter({ hasText: String(text) }).waitFor({ state: "visible" });
      return null;
    },
    async currentPath() {
      const url = new URL(page.url());
      const path = base === "/" ? url.pathname : `/${url.pathname.slice(base.length)}`;
      return `${path || "/"}${url.search}${url.hash}`;
    },
    async viewport(width: unknown, height: unknown) {
      const next = { width: Number(width), height: Number(height) };
      if (!Number.isInteger(next.width) || next.width < 1 || !Number.isInteger(next.height) || next.height < 1) {
        throw new Error("browser.viewport requires positive integer dimensions");
      }
      await page.setViewportSize(next);
      return null;
    },
    async timings() {
      const value = await page.evaluate((key) => {
        const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(key))?.value as { timings?: () => unknown } | undefined;
        if (!runtime || typeof runtime.timings !== "function") throw new Error("Browser performance test runtime is unavailable");
        return runtime.timings();
      }, browserPerformanceRuntimeKey);
      return navigationTiming(value);
    },
    async animation(selector: unknown) {
      return locator(selector).evaluate(async (element) => {
        const animations = element.getAnimations();
        const first = animations[0] as CSSAnimation | undefined;
        if (!first) return { count: animations.length, name: "", rotating: false };
        const beforeTime = Number(first.currentTime ?? 0);
        const before = getComputedStyle(element).rotate;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const afterTime = Number(first.currentTime ?? 0);
        const after = getComputedStyle(element).rotate;
        return {
          count: animations.length,
          name: typeof first.animationName === "string" ? first.animationName : "",
          rotating: afterTime > beforeTime && after !== before,
        };
      });
    },
    async measureClick(selector: unknown) {
      const target = locator(selector);
      return measureBrowserInteraction(page, target, "click", async () => { await target.click(); });
    },
    async measureFill(selector: unknown, value: unknown) {
      const target = locator(selector);
      const text = String(value);
      return measureBrowserInteraction(page, target, "beforeinput-or-input", async () => { await target.fill(text); });
    },
    async measurePress(selector: unknown, key: unknown) {
      const target = locator(selector);
      const value = String(key);
      return measureBrowserInteraction(page, target, "beforeinput-or-input", async () => { await target.press(value); });
    },
    async storageGet(area: unknown, key: unknown) {
      const input = { area: storageArea(area), key: String(key) };
      return page.evaluate(({ area: name, key: itemKey }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        return target.getItem(itemKey);
      }, input);
    },
    async storageSet(area: unknown, key: unknown, value: unknown) {
      const input = { area: storageArea(area), key: String(key), value: String(value) };
      await page.evaluate(({ area: name, key: itemKey, value: itemValue }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.setItem(itemKey, itemValue);
      }, input);
      return null;
    },
    async storageRemove(area: unknown, key: unknown) {
      const input = { area: storageArea(area), key: String(key) };
      await page.evaluate(({ area: name, key: itemKey }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.removeItem(itemKey);
      }, input);
      return null;
    },
    async storageClear(area: unknown) {
      const name = storageArea(area);
      await page.evaluate((storageName) => {
        const target = storageName === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.clear();
      }, name);
      return null;
    },
    async networkRespond(path: unknown, body: unknown, status: unknown, contentType: unknown, delayMs: unknown) {
      const pathname = String(path);
      const responseBody = String(body);
      const responseStatus = Number(status);
      const responseType = String(contentType);
      const delay = Number(delayMs);
      if (!pathname.startsWith("/") || pathname.includes("\0")) throw new Error("network.respond path must be application-relative and start with '/'");
      if (responseBody.length > 16 * 1024 * 1024) throw new Error("network.respond body cannot exceed 16 MiB");
      if (!Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599) throw new Error("network.respond status must be an HTTP status integer");
      if (!responseType || responseType.length > 1024 || /[\r\n]/u.test(responseType)) throw new Error("network.respond contentType must be bounded single-line text");
      if (!Number.isInteger(delay) || delay < 0 || delay > 30000) throw new Error("network.respond delayMs must be an integer from 0 through 30000");
      const target = new URL(base === "/" ? pathname : `${base.slice(0, -1)}${pathname}`, origin).href;
      if (mockedRoutes.has(target)) await page.unroute(target);
      mockedRoutes.add(target);
      await page.route(target, async (route) => {
        if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
        await route.fulfill({ status: responseStatus, contentType: responseType, body: responseBody });
      });
      return null;
    },
    async networkClear() {
      for (const target of mockedRoutes) await page.unroute(target);
      mockedRoutes.clear();
      return null;
    },
    async frameworkInvoke(capability: unknown, operation: unknown, args: unknown, timeout: unknown) {
      const input = { capability: String(capability), operation: String(operation), args, timeout: Number(timeout) };
      if (!input.capability || input.capability.length > 128 || !input.operation || input.operation.length > 128 || !Array.isArray(input.args)) {
        throw new TypeError("Framework test invoke requires bounded capability, operation, and argument values");
      }
      if (!Number.isSafeInteger(input.timeout) || input.timeout < 0 || input.timeout > 600000) {
        throw new RangeError("Framework test invoke timeout is outside its supported bounds");
      }
      if (frameworkController !== undefined) {
        const result = await frameworkController.invoke(input.capability, input.operation, input.args, input.timeout);
        if (typeof result !== "object" || result === null || typeof result.handled !== "boolean") {
          throw new TypeError("Framework browser-test controller returned an invalid result");
        }
        if (result.handled) return result.value;
      }
      // The callback answers with a verdict and never rejects, and the failure
      // is raised here instead. An asynchronous `page.evaluate` callback that
      // rejects is reported by Firefox as an error the *page* suffered — the
      // engine sees the intermediate rejection inside Playwright's own
      // evaluation wrapper before Playwright settles it — while Chromium and
      // WebKit report nothing. So a bridge call that fails the way a test
      // expects it to, such as one made before the first `browser.open()`,
      // arrived on the page-error channel on one engine only and failed the
      // test that had already handled it. The message is preserved exactly; the
      // only thing that changes is which process constructs the error.
      const verdict = await page.evaluate(async (request) => {
        const bridge = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.desktop.bridge.v1"))?.value as {
          invoke?: (capability: string, operation: string, args: unknown[], timeout: number) => Promise<unknown>;
        } | undefined;
        if (!bridge || typeof bridge.invoke !== "function") {
          return { failed: true as const, message: "Desktop application test bridge is unavailable" };
        }
        try {
          return { failed: false as const, value: await bridge.invoke(request.capability, request.operation, request.args as unknown[], request.timeout) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { failed: true as const, message: message.slice(0, 4096) };
        }
      }, input);
      if (verdict.failed) throw new Error(verdict.message);
      return verdict.value;
    },
  });
  (globalThis as unknown as { [key: symbol]: unknown })[runtimeKey] = runtime;
}

function removeBrowserRuntime(runtimeKey: symbol): void {
  delete (globalThis as unknown as { [key: symbol]: unknown })[runtimeKey];
}

interface BrowserInteractionTiming {
  readonly inputDelayMs: number;
  readonly processingDurationMs: number;
  readonly nextFrameMs: number;
}

async function measureBrowserInteraction(
  page: Page,
  target: Locator,
  eventName: "click" | "input" | "beforeinput-or-input",
  action: () => Promise<void>,
): Promise<BrowserInteractionTiming> {
  const measurement = await target.evaluate((element, input) => {
    const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(input.key))?.value as {
      prepare?: (target: Element, event: string) => unknown;
    } | undefined;
    if (!runtime || typeof runtime.prepare !== "function") throw new Error("Browser performance test runtime is unavailable");
    return runtime.prepare(element, input.eventName);
  }, { key: browserPerformanceRuntimeKey, eventName });
  if (!Number.isSafeInteger(measurement) || (measurement as number) < 1) throw new TypeError("Browser performance runtime returned an invalid measurement identity");
  try {
    await action();
    // A verdict rather than a rejection, for the reason `frameworkInvoke`
    // gives: on Firefox an asynchronous callback that rejects is also reported
    // as an error the page suffered.
    const verdict = await page.evaluate(async (input) => {
      const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(input.key))?.value as {
        finish?: (identity: number) => Promise<unknown>;
      } | undefined;
      if (!runtime || typeof runtime.finish !== "function") {
        return { failed: true as const, message: "Browser performance test runtime is unavailable" };
      }
      try { return { failed: false as const, value: await runtime.finish(input.identity) }; }
      catch (error) { return { failed: true as const, message: (error instanceof Error ? error.message : String(error)).slice(0, 4096) }; }
    }, { key: browserPerformanceRuntimeKey, identity: measurement as number });
    if (verdict.failed) throw new Error(verdict.message);
    return interactionTiming(verdict.value);
  } catch (error) {
    await page.evaluate((input) => {
      const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(input.key))?.value as {
        cancel?: (identity: number) => unknown;
      } | undefined;
      if (runtime && typeof runtime.cancel === "function") runtime.cancel(input.identity);
    }, { key: browserPerformanceRuntimeKey, identity: measurement as number }).catch(() => {});
    throw error;
  }
}

function navigationTiming(value: unknown): Readonly<{
  firstContentfulPaintMs: number | null;
  domContentLoadedMs: number;
  loadMs: number;
}> {
  const record = timingRecord(value, ["firstContentfulPaintMs", "domContentLoadedMs", "loadMs"]);
  const firstContentfulPaintMs = record.firstContentfulPaintMs;
  if (firstContentfulPaintMs !== null) boundedTiming(firstContentfulPaintMs, "firstContentfulPaintMs");
  return Object.freeze({
    firstContentfulPaintMs: firstContentfulPaintMs as number | null,
    domContentLoadedMs: boundedTiming(record.domContentLoadedMs, "domContentLoadedMs"),
    loadMs: boundedTiming(record.loadMs, "loadMs"),
  });
}

function interactionTiming(value: unknown): BrowserInteractionTiming {
  const record = timingRecord(value, ["inputDelayMs", "processingDurationMs", "nextFrameMs"]);
  const inputDelayMs = boundedTiming(record.inputDelayMs, "inputDelayMs");
  const processingDurationMs = boundedTiming(record.processingDurationMs, "processingDurationMs");
  const nextFrameMs = boundedTiming(record.nextFrameMs, "nextFrameMs");
  if (nextFrameMs + Number.EPSILON < inputDelayMs + processingDurationMs) {
    throw new TypeError("Browser interaction timing ends before processing completes");
  }
  return Object.freeze({ inputDelayMs, processingDurationMs, nextFrameMs });
}

function timingRecord(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Browser performance runtime returned an invalid record");
  }
  const names = Object.keys(value);
  if (names.length !== fields.length || names.some((name) => !fields.includes(name))) {
    throw new TypeError("Browser performance runtime returned unexpected fields");
  }
  for (const name of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("Browser performance runtime returned an accessor field");
  }
  return value as Record<string, unknown>;
}

function boundedTiming(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 600_000) {
    throw new RangeError(`Browser performance ${name} is outside its supported bound`);
  }
  return value;
}

async function buildProject(
  config: VelarProjectConfig,
  outputDirectory: string,
  executableOverride: string | undefined,
): Promise<{ readonly ok: boolean; readonly output: string }> {
  const executable = resolve(executableOverride ?? process.argv[1]!);
  const child = spawn(process.execPath, [executable, "build", config.root, "--out-dir", outputDirectory], {
    cwd: config.root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  return { ok: code === 0, output };
}

async function discoverBrowserTestFiles(root: string, excluded: ReadonlySet<string>, sourceSuffix: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(sourceSuffix)) output.push(path);
    }
  };
  await visit(root);
  return output.sort();
}

function stackOf(error: unknown): string {
  return hostErrorStack(error);
}
