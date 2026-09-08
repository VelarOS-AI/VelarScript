/**
 * The worker process: it builds the project, serves it, and drives one engine
 * at a time through every declared test. The run is one `try`/`finally` — the
 * phases below are its prepare, launch, per-file and teardown halves — because
 * a browser server, a preview server and a temporary tree are owned from the
 * moment they are opened until this process is done with them.
 */
import { spawn } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { FrameworkBrowserTestContract } from "@velarscript/compiler/framework-host";
import type { Browser, BrowserServer } from "playwright";
import {
  boundedBrowserOperation,
  launchOwnedBrowserServer,
  terminateBrowserServer,
  type BrowserWorkerReport,
} from "../browser-process-owner.ts";
import { requiredCompilerRuntimeModules } from "../compiler-runtime-modules.ts";
import type { VelarProjectConfig } from "../config.ts";
import { registerNodeCompilerRuntimeResolver } from "../node-compiler-runtime-resolver.ts";
import { startProductionPreview, type ProductionPreviewHandle } from "../preview-server.ts";
import { verifyProductionBuild, type VerifiedProductionBuild } from "../production-verifier.ts";
import {
  createCompiledSandboxDirectory,
  portablePath,
  quoteReportedText,
  removeCompiledSandbox,
  type CompiledTestProjectPlan,
} from "../test-output.ts";
import type { UnownedErrorChannel } from "../unowned-errors.ts";
import { discoverBrowserTestFiles } from "./discovery.ts";
import {
  compileBrowserTest,
  installBrowserCompilerRuntime,
  writeBrowserTestEntry,
  type BrowserTestEntry,
} from "./entry.ts";
import {
  browserTestHostGuidance,
  browserTestLimits,
  browserTypes,
  BrowserTestInterrupted,
  BrowserTestRunTimedOut,
  stackOf,
  type BrowserEngine,
  type BrowserEngineSelection,
  type BrowserTestLimits,
  type BrowserTestRunnerOptions,
} from "./run.ts";
import {
  installBrowserPerformanceRuntime,
  installBrowserRuntime,
  removeBrowserRuntime,
} from "./runtime-api.ts";

/**
 * The one run this process is performing: what it is testing, the bounds it
 * obeys, the three handles it owns, and the counts its verdict is taken from.
 */
interface BrowserRun {
  readonly config: VelarProjectConfig;
  readonly framework: NonNullable<VelarProjectConfig["framework"]>;
  readonly contract: FrameworkBrowserTestContract;
  readonly limits: BrowserTestLimits;
  readonly runtimeKey: symbol;
  readonly channel: UnownedErrorChannel;
  /**
   * A body that outlived its bound cannot be cancelled in this process, so
   * what it reports afterwards lands on whichever test is running then. Naming
   * the tests it could have come from is what this process can offer instead
   * of the thread termination the Node runner uses.
   */
  readonly abandonedBodies: string[];
  server: ProductionPreviewHandle | null;
  browser: Browser | null;
  browserServer: BrowserServer | null;
  passed: number;
  failed: number;
}

/** What the prepared run hands the engines: the served application and its tests. */
interface BrowserRunPlan {
  readonly entries: readonly BrowserTestEntry[];
  readonly runtimeModules: ReadonlySet<string>;
  readonly compiled: string;
  readonly origin: string;
  readonly base: string;
}

/** How the run is stopped from outside a test body: a signal, or the deadline. */
interface BrowserRunLifecycle {
  failure: BrowserTestInterrupted | BrowserTestRunTimedOut | null;
  readonly cancellation: Promise<never>;
}

/** Whether an engine may still be used, or was retired by a cleanup failure. */
interface BrowserEngineRun {
  usable: boolean;
}

export async function runBrowserTestsInWorker(
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

  const temporary = await createCompiledSandboxDirectory(config.root, "test");
  const site = join(temporary, "site");
  const compiled = join(temporary, "tests");
  const run: BrowserRun = {
    config,
    framework: config.framework,
    contract,
    limits,
    runtimeKey,
    channel,
    abandonedBodies: [],
    server: null,
    browser: null,
    browserServer: null,
    passed: 0,
    failed: 0,
  };
  try {
    const prepared = await prepareBrowserTestRun(run, files, site, options.executable);
    if (!prepared) return 1;
    run.server = await startProductionPreview(prepared.verified, 0);
    const engines: readonly BrowserEngine[] = selection === "all"
      ? ["chromium", "firefox", "webkit"]
      : [selection];
    const interrupted = await runBrowserTestEngines(run, engines, {
      entries: prepared.entries,
      runtimeModules: prepared.runtimeModules,
      compiled,
      origin: run.server.origin,
      base: prepared.verified.deployment.base,
    });
    if (interrupted !== null) return interrupted;
  } finally {
    await teardownBrowserTestRun(run, temporary);
  }
  // The cleanup above released everything this runner owns, so whatever still
  // holds the loop is work a test started. Waiting for it before the verdict is
  // what keeps a late failure from being dropped — and keeps the printed count
  // honest about it.
  if (!await settleWorkerWork(channel, limits.cleanupTimeoutMs)) {
    run.failed += 1;
    process.stderr.write("✗ work a browser test started was still running when the run ended; a test owns the work it starts, and a failure from work that never finishes can never be reported\n");
  }
  const trailing = await channel.drain();
  if (trailing.length > 0) {
    run.failed += 1;
    process.stderr.write(`✗ an unowned error was reported after the last browser test\n${trailing.join("\n")}\n${browserTestHostGuidance}\n`);
  }
  process.stdout.write(`\n${run.passed} passed, ${run.failed} failed\n`);
  return run.failed === 0 ? 0 : 1;
}

/**
 * Builds the project, verifies the build, and compiles every test file once.
 * Answers null when the run has nothing left to do, having said why.
 */
async function prepareBrowserTestRun(
  run: BrowserRun,
  files: readonly string[],
  site: string,
  executable: string | undefined,
): Promise<{
  readonly verified: VerifiedProductionBuild;
  readonly entries: readonly BrowserTestEntry[];
  readonly runtimeModules: ReadonlySet<string>;
} | null> {
  const build = await buildProject(run.config, site, executable);
  if (!build.ok) {
    process.stderr.write(build.output);
    return null;
  }
  const verified = await verifyProductionBuild(site);
  const entries: BrowserTestEntry[] = [];
  for (const file of files) {
    const entry = await compileBrowserTest(file, run.config);
    if (!entry) {
      run.failed += 1;
      continue;
    }
    entries.push(entry);
  }
  if (entries.length === 0) {
    process.stdout.write(`\n${run.passed} passed, ${run.failed} failed\n`);
    return null;
  }
  const runtimeModules = new Set(entries.flatMap((entry) => [...requiredCompilerRuntimeModules(entry.project)]));
  return { verified, entries, runtimeModules };
}

/**
 * Every selected engine in turn, under the run's own deadline and the three
 * signals that end it. Answers an exit code when the run was interrupted.
 */
async function runBrowserTestEngines(
  run: BrowserRun,
  engines: readonly BrowserEngine[],
  plan: BrowserRunPlan,
): Promise<number | null> {
  const { limits } = run;
  let rejectLifecycle!: (error: BrowserTestInterrupted | BrowserTestRunTimedOut) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectLifecycle = reject; });
  void cancellation.catch(() => {});
  const lifecycle: BrowserRunLifecycle = { failure: null, cancellation };
  const stop = (error: BrowserTestInterrupted | BrowserTestRunTimedOut): void => {
    if (lifecycle.failure !== null) return;
    lifecycle.failure = error;
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
      if (lifecycle.failure !== null) throw lifecycle.failure;
      await runBrowserTestEngine(run, plan, lifecycle, engine);
    }
  } catch (error) {
    if (error instanceof BrowserTestInterrupted) {
      process.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    if (error instanceof BrowserTestRunTimedOut) {
      run.failed += 1;
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
  return null;
}

/** One engine: launched, driven through every test file, and released. */
async function runBrowserTestEngine(
  run: BrowserRun,
  plan: BrowserRunPlan,
  lifecycle: BrowserRunLifecycle,
  engine: BrowserEngine,
): Promise<void> {
  const { config, limits } = run;
  let engineStarted = false;
  const engineRun: BrowserEngineRun = { usable: true };
  let runtimeResolver: ReturnType<typeof registerNodeCompilerRuntimeResolver> | undefined;
  try {
    run.browserServer = await launchOwnedBrowserServer(browserTypes[engine], { headless: true, timeout: 30_000 });
    engineStarted = true;
    if (lifecycle.failure !== null) throw lifecycle.failure;
    run.browser = await browserTypes[engine].connect(run.browserServer.wsEndpoint(), { timeout: 30_000 });
    const browser = run.browser;
    // A distinct tree gives every module in an engine's graph, including
    // compiler extension source and runtime package members, a fresh URL.
    const engineRoot = join(plan.compiled, engine);
    const installed = await installBrowserCompilerRuntime(engineRoot, config, plan.runtimeModules, plan.entries);
    runtimeResolver = installed.resolver;
    const pass: BrowserEnginePass = { browser, engine, engineRoot, engineRun, plans: installed.plans };
    for (const entry of plan.entries) {
      if (await runBrowserTestFile(run, plan, lifecycle, pass, entry) === "retire") break;
    }
  } catch (error) {
    if (lifecycle.failure !== null) throw lifecycle.failure;
    if (error instanceof BrowserTestInterrupted || error instanceof BrowserTestRunTimedOut) throw error;
    if (!engineStarted) {
      run.failed += plan.entries.reduce((count, entry) => count + entry.tests.length, 0);
      process.stderr.write(`✗ ${engine} could not start\n${stackOf(error)}\nInstall it with: npx playwright install ${engine}\n`);
    } else {
      run.failed += 1;
      process.stderr.write(`✗ ${engine} browser-test owner failed\n${stackOf(error)}\n`);
    }
  } finally {
    runtimeResolver?.deregister();
    if (run.browserServer !== null) {
      const owned = run.browserServer;
      const connection = run.browser;
      run.browser = null;
      run.browserServer = null;
      await terminateBrowserServer(connection, owned, limits.cleanupTimeoutMs);
    }
  }
}

/** The engine's connection and tree, as one file's pass reads them. */
interface BrowserEnginePass {
  readonly plans: ReadonlyMap<BrowserTestEntry, CompiledTestProjectPlan>;
  readonly browser: Browser;
  readonly engine: BrowserEngine;
  readonly engineRoot: string;
  readonly engineRun: BrowserEngineRun;
}

/**
 * One compiled test file on one engine: written, imported, and run test by
 * test. Answers "retire" when a cleanup failure has made the engine unusable.
 */
async function runBrowserTestFile(
  run: BrowserRun,
  plan: BrowserRunPlan,
  lifecycle: BrowserRunLifecycle,
  pass: BrowserEnginePass,
  entry: BrowserTestEntry,
): Promise<"continue" | "retire"> {
  const { channel, config, limits } = run;
  const { engine, engineRun } = pass;
  const output = await writeBrowserTestEntry(entry, pass.engineRoot, config, plan.runtimeModules, pass.plans.get(entry));
  let namespace: Record<string, unknown>;
  try {
    namespace = await import(pathToFileURL(output).href) as Record<string, unknown>;
  } catch (error) {
    if (lifecycle.failure !== null) throw lifecycle.failure;
    run.failed += entry.tests.length;
    process.stderr.write(`✗ ${engine} :: ${portablePath(relative(config.root, entry.file))} failed to load\n${stackOf(error)}\n${browserTestHostGuidance}\n`);
    await channel.drain();
    return "continue";
  }
  // A module initialization error that surfaced on the host channel
  // instead of the import's own await — the shape a mounted entry
  // takes when a browser test imports it — fails the file's tests
  // before any of them can run green.
  const loadTimeErrors = await channel.drain();
  if (loadTimeErrors.length > 0) {
    run.failed += entry.tests.length;
    process.stderr.write(`✗ ${engine} :: ${portablePath(relative(config.root, entry.file))} reported an unowned error while loading\n${loadTimeErrors.join("\n")}\n${browserTestHostGuidance}\n`);
    return "continue";
  }
  for (const declared of entry.tests) {
    if (lifecycle.failure !== null) throw lifecycle.failure;
    // D39 item 53: the reporter quotes the author's name for the
    // test, which is the specification a person reads.
    // D51 rule 105: the browser verdict line escapes author text too.
    const name = quoteReportedText(declared.title);
    const verdictLabel = `${engine} :: ${quoteReportedText(portablePath(relative(config.root, entry.file)))} :: ${name}`;
    // The bound a synchronously spinning body obeys cannot live in
    // the process that body wedged, so the supervisor is told which
    // test is running, and with what counts behind it, before it
    // starts.
    announceToSupervisor({ kind: "begin", label: verdictLabel, timeoutMs: limits.testTimeoutMs, passed: run.passed, failed: run.failed });
    const test = namespace[declared.name];
    await runBrowserTest(run, plan, lifecycle, pass, entry, { test, name, verdictLabel });
    if (!engineRun.usable) {
      process.stderr.write(`✗ ${engine} was retired after context cleanup failed\n`);
      return "retire";
    }
  }
  return "continue";
}

/** One declared test, as the file's pass names it. */
interface DeclaredBrowserTest {
  readonly test: unknown;
  readonly name: string;
  readonly verdictLabel: string;
}

/** One test in its own page and context, from installed runtime to verdict. */
async function runBrowserTest(
  run: BrowserRun,
  plan: BrowserRunPlan,
  lifecycle: BrowserRunLifecycle,
  pass: BrowserEnginePass,
  entry: BrowserTestEntry,
  declared: DeclaredBrowserTest,
): Promise<void> {
  const { channel, config, contract, limits, runtimeKey } = run;
  const { name, test } = declared;
  const context = await pass.browser.newContext();
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
    const frameworkConfig = run.framework.config;
    const frameworkController = contract.createController?.(frameworkConfig);
    if (frameworkController !== undefined
      && (typeof frameworkController !== "object" || frameworkController === null
        || typeof frameworkController.initScript !== "function"
        || typeof frameworkController.invoke !== "function")) {
      throw new Error("Framework browser-test controller is invalid");
    }
    installBrowserRuntime(
      page,
      plan.origin,
      plan.base,
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
      lifecycle.cancellation,
      channel,
      run.abandonedBodies,
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
      pass.engineRun.usable = false;
      testFailure = new Error(`${testFailure === null ? "Browser test completed but its context leaked" : stackOf(testFailure)}\n${stackOf(cleanupError)}`);
    }
  }
  await takeBrowserTestVerdict(run, declared.verdictLabel, testFailure, runtimeFailures, reportedRuntimeFailures);
}

/**
 * The verdict, taken once the test's own window is over: what the page
 * reported, what the host channel reported, and what the body itself threw.
 */
async function takeBrowserTestVerdict(
  run: BrowserRun,
  verdictLabel: string,
  failure: unknown,
  runtimeFailures: readonly string[],
  reportedRuntimeFailures: number,
): Promise<void> {
  let testFailure = failure;
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
  const hostReports = await run.channel.drain();
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
    const source = run.abandonedBodies.length === 0
      ? ""
      : `\nA body that outlived its bound is still running in this process and may be the source: ${run.abandonedBodies.join(", ")}.`;
    const text = hostReports.length > 0
      ? `Browser runtime failures:\n${reported}\n${browserTestHostGuidance}${source}`
      : `Browser runtime failures:\n${reported}${source}`;
    testFailure = testFailure === null ? new Error(text) : new Error(`${stackOf(testFailure)}\n${text}`);
  }
  if (testFailure instanceof BrowserTestInterrupted || testFailure instanceof BrowserTestRunTimedOut) throw testFailure;
  if (testFailure === null) {
    run.passed += 1;
    process.stdout.write(`✓ ${verdictLabel}\n`);
  } else {
    run.failed += 1;
    process.stderr.write(`✗ ${verdictLabel}\n${stackOf(testFailure)}\n`);
  }
}

/**
 * Releases everything the run owns, wherever it stopped: the page runtime, the
 * browser server, the preview server, and the temporary tree.
 */
async function teardownBrowserTestRun(run: BrowserRun, temporary: string): Promise<void> {
  const { limits } = run;
  removeBrowserRuntime(run.runtimeKey);
  let cleanupFailure: unknown = null;
  if (run.browserServer !== null) {
    try { await terminateBrowserServer(run.browser, run.browserServer, limits.cleanupTimeoutMs); }
    catch (error) { cleanupFailure = error; }
    run.browser = null;
    run.browserServer = null;
  }
  if (run.server) {
    try { await boundedBrowserOperation(run.server.close(), limits.cleanupTimeoutMs, "Browser preview cleanup"); }
    catch (error) { cleanupFailure ??= error; }
  }
  try { await removeCompiledSandbox(temporary); }
  catch (error) { cleanupFailure ??= error; }
  if (cleanupFailure !== null) throw cleanupFailure;
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
