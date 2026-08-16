import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic, type ModuleTest } from "@velarscript/compiler";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserServer,
  type BrowserType,
  type Locator,
  type Page,
} from "playwright";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { compiledTestModulePath, portablePath, quoteReportedText, writeCompiledTestProject } from "./test-output.ts";
import { verifyProductionBuild } from "./production-verifier.ts";
import { startProductionPreview, type ProductionPreviewHandle } from "./preview-server.ts";
import { hostErrorStack } from "./host-error.ts";
import { captureUnownedErrors, mapCompiledStacksToSources, type UnownedErrorChannel } from "./unowned-errors.ts";
import {
  boundedBrowserOperation,
  exitBrowserWorker,
  observeBrowserWorkerParent,
  superviseBrowserWorker,
  terminateBrowserServer,
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
const defaultBrowserRunTimeoutMs = 20 * 60_000;
const defaultBrowserCleanupTimeoutMs = 10_000;
const browserTestWorkerEnvironment = "VELAR_BROWSER_TEST_WORKER_V1";
const browserPerformanceRuntimeKey = "velar.browser.test.performance.v1";
const browserPerformanceInitScript = String.raw`
(() => {
  "use strict";
  const key = Symbol.for(${JSON.stringify(browserPerformanceRuntimeKey)});
  const existing = Object.getOwnPropertyDescriptor(globalThis, key);
  if (existing) {
    if (!("value" in existing) || !existing.value || typeof existing.value !== "object") {
      throw new TypeError("Browser performance test runtime identity is invalid");
    }
    return;
  }
  const nativeObject = globalThis.Object;
  const nativeNumber = globalThis.Number;
  const nativeArray = globalThis.Array;
  const nativeMath = globalThis.Math;
  const nativeMap = globalThis.Map;
  const nativePromise = globalThis.Promise;
  const nativeReflect = globalThis.Reflect;
  const nativePerformance = globalThis.performance;
  const nativeDocument = globalThis.document;
  const nativeEventTarget = globalThis.EventTarget;
  const nativeEvent = globalThis.Event;
  const nativeElement = globalThis.Element;
  const nativeDOMRectReadOnly = globalThis.DOMRectReadOnly;
  const nativeCSSStyleDeclaration = globalThis.CSSStyleDeclaration;
  const getComputedStyle_ = globalThis.getComputedStyle;
  const getOwnPropertyDescriptor = nativeObject.getOwnPropertyDescriptor;
  const defineProperty = nativeObject.defineProperty;
  const freeze = nativeObject.freeze;
  const getPrototypeOf = nativeObject.getPrototypeOf;
  const reflectApply = getOwnPropertyDescriptor(nativeReflect, "apply")?.value;
  const numberFinite = getOwnPropertyDescriptor(nativeNumber, "isFinite")?.value;
  const arrayIsArray = getOwnPropertyDescriptor(nativeArray, "isArray")?.value;
  const mathMax = getOwnPropertyDescriptor(nativeMath, "max")?.value;
  const mapPrototype = getOwnPropertyDescriptor(nativeMap, "prototype")?.value;
  const mapGet = getOwnPropertyDescriptor(mapPrototype, "get")?.value;
  const mapSet = getOwnPropertyDescriptor(mapPrototype, "set")?.value;
  const mapDelete = getOwnPropertyDescriptor(mapPrototype, "delete")?.value;
  const mapSize = getOwnPropertyDescriptor(mapPrototype, "size")?.get;
  const eventAdd = getOwnPropertyDescriptor(nativeEventTarget.prototype, "addEventListener")?.value;
  const eventRemove = getOwnPropertyDescriptor(nativeEventTarget.prototype, "removeEventListener")?.value;
  const eventTarget = getOwnPropertyDescriptor(nativeEvent.prototype, "target")?.get;
  const eventTimeStamp = getOwnPropertyDescriptor(nativeEvent.prototype, "timeStamp")?.get;
  const elementScrollTo = getOwnPropertyDescriptor(nativeElement.prototype, "scrollTo")?.value;
  const elementBoundingClientRect = getOwnPropertyDescriptor(nativeElement.prototype, "getBoundingClientRect")?.value;
  const domRectPrototype = getOwnPropertyDescriptor(nativeDOMRectReadOnly, "prototype")?.value;
  const rectX = getOwnPropertyDescriptor(domRectPrototype, "x")?.get;
  const rectY = getOwnPropertyDescriptor(domRectPrototype, "y")?.get;
  const rectWidth = getOwnPropertyDescriptor(domRectPrototype, "width")?.get;
  const rectHeight = getOwnPropertyDescriptor(domRectPrototype, "height")?.get;
  const rectTop = getOwnPropertyDescriptor(domRectPrototype, "top")?.get;
  const rectRight = getOwnPropertyDescriptor(domRectPrototype, "right")?.get;
  const rectBottom = getOwnPropertyDescriptor(domRectPrototype, "bottom")?.get;
  const rectLeft = getOwnPropertyDescriptor(domRectPrototype, "left")?.get;
  const cssStylePrototype = getOwnPropertyDescriptor(nativeCSSStyleDeclaration, "prototype")?.value;
  const cssGetPropertyValue = getOwnPropertyDescriptor(cssStylePrototype, "getPropertyValue")?.value;
  const performancePrototype = callPrototype(nativePerformance);
  const performanceNow = getOwnPropertyDescriptor(performancePrototype, "now")?.value;
  const performanceEntriesByType = getOwnPropertyDescriptor(performancePrototype, "getEntriesByType")?.value;
  const performanceEntriesByName = getOwnPropertyDescriptor(performancePrototype, "getEntriesByName")?.value;
  const performanceTimeOrigin = nativePerformance.timeOrigin;
  const queueMicrotask_ = getOwnPropertyDescriptor(globalThis, "queueMicrotask")?.value;
  const requestAnimationFrame_ = getOwnPropertyDescriptor(globalThis, "requestAnimationFrame")?.value;
  const setTimeout_ = getOwnPropertyDescriptor(globalThis, "setTimeout")?.value;
  const clearTimeout_ = getOwnPropertyDescriptor(globalThis, "clearTimeout")?.value;
  const measurements = new nativeMap();
  let nextMeasurement = 1;

  function callPrototype(value) {
    if (typeof getPrototypeOf !== "function") throw new TypeError("Object.getPrototypeOf is unavailable");
    return getPrototypeOf(value);
  }
  function call(operation, receiver, args, name) {
    if (typeof operation !== "function" || typeof reflectApply !== "function") throw new TypeError(name + " is unavailable");
    return reflectApply(operation, receiver, args);
  }
  function finite(value, name) {
    if (!call(numberFinite, nativeNumber, [value], "Number.isFinite") || value < 0 || value > 600000) {
      throw new RangeError(name + " is outside the browser performance test bound");
    }
    return value;
  }
  function now() { return finite(call(performanceNow, nativePerformance, [], "performance.now"), "Browser monotonic time"); }
  function entries(operation, value) {
    const result = call(operation, nativePerformance, [value], "Performance entry lookup");
    if (!call(arrayIsArray, nativeArray, [result], "Array.isArray") || result.length > 10000) throw new TypeError("Browser performance entries are invalid");
    return result;
  }
  function field(value, name) {
    const descriptor = value && getOwnPropertyDescriptor(value, name);
    if (descriptor && "value" in descriptor) return descriptor.value;
    let prototype = value && callPrototype(value);
    for (let depth = 0; prototype && depth < 8; depth += 1) {
      const getter = getOwnPropertyDescriptor(prototype, name)?.get;
      if (typeof getter === "function") return call(getter, value, [], "Performance entry " + name);
      prototype = callPrototype(prototype);
    }
    throw new TypeError("Performance entry " + name + " is unavailable");
  }
  function timings() {
    const navigation = entries(performanceEntriesByType, "navigation")[0];
    if (!navigation) throw new Error("The browser did not expose navigation timing");
    const paints = entries(performanceEntriesByName, "first-contentful-paint");
    const paint = paints.length === 0 ? null : finite(field(paints[0], "startTime"), "First contentful paint");
    return freeze({
      firstContentfulPaintMs: paint,
      domContentLoadedMs: finite(field(navigation, "domContentLoadedEventEnd"), "DOMContentLoaded timing"),
      loadMs: finite(field(navigation, "loadEventEnd"), "Load timing"),
    });
  }
  function scroll(element, x, y) {
    if (!(element instanceof nativeElement)) throw new TypeError("Browser test scroll target must be an Element");
    if (typeof x !== "number" || !call(numberFinite, nativeNumber, [x], "Number.isFinite")
      || typeof y !== "number" || !call(numberFinite, nativeNumber, [y], "Number.isFinite")
      || call(mathMax, nativeMath, [x, -x, y, -y], "Math.max") > 100000000) {
      throw new RangeError("Browser test scroll coordinates are outside the supported bound");
    }
    call(elementScrollTo, element, [{ left: x, top: y, behavior: "auto" }], "Element.scrollTo");
    return null;
  }
  function rectangleNumber(rectangle, getter, name) {
    const value = call(getter, rectangle, [], "DOMRect." + name);
    if (typeof value !== "number" || !call(numberFinite, nativeNumber, [value], "Number.isFinite")) {
      throw new TypeError("Browser test rectangle " + name + " is not finite");
    }
    return value;
  }
  function box(element) {
    if (!(element instanceof nativeElement)) throw new TypeError("browser.box target must be an Element");
    const rectangle = call(elementBoundingClientRect, element, [], "Element.getBoundingClientRect");
    return freeze({
      x: rectangleNumber(rectangle, rectX, "x"),
      y: rectangleNumber(rectangle, rectY, "y"),
      width: rectangleNumber(rectangle, rectWidth, "width"),
      height: rectangleNumber(rectangle, rectHeight, "height"),
      top: rectangleNumber(rectangle, rectTop, "top"),
      right: rectangleNumber(rectangle, rectRight, "right"),
      bottom: rectangleNumber(rectangle, rectBottom, "bottom"),
      left: rectangleNumber(rectangle, rectLeft, "left"),
    });
  }
  function style(element, property) {
    if (!(element instanceof nativeElement)) throw new TypeError("browser.style target must be an Element");
    if (typeof property !== "string") throw new TypeError("browser.style property must be text");
    const declaration = call(getComputedStyle_, globalThis, [element], "getComputedStyle");
    const value = call(cssGetPropertyValue, declaration, [property], "CSSStyleDeclaration.getPropertyValue");
    if (typeof value !== "string") throw new TypeError("browser.style result must be text");
    return value;
  }
  function prepare(element, eventName) {
    if (eventName !== "click" && eventName !== "input" && eventName !== "beforeinput-or-input") {
      throw new TypeError("Measured browser event must be click, input, or beforeinput-or-input");
    }
    if (!(element instanceof nativeEventTarget)) throw new TypeError("Measured browser target must be an EventTarget");
    if (call(mapSize, measurements, [], "Map.size") >= 32) throw new RangeError("Too many pending browser performance measurements");
    const eventNames = eventName === "beforeinput-or-input" ? ["beforeinput", "input"] : [eventName];
    const id = nextMeasurement++;
    let finish;
    let fail;
    const promise = new nativePromise((resolve, reject) => { finish = resolve; fail = reject; });
    let timer = null;
    let listening = true;
    const cleanup = () => {
      if (listening) {
        listening = false;
        for (const name of eventNames) call(eventRemove, nativeDocument, [name, listener, true], "Document.removeEventListener");
      }
      if (timer !== null) {
        call(clearTimeout_, globalThis, [timer], "clearTimeout");
        timer = null;
      }
    };
    const listener = (event) => {
      if (call(eventTarget, event, [], "Event.target") !== element) return;
      cleanup();
      try {
        const listenerStart = now();
        let eventTime = call(eventTimeStamp, event, [], "Event.timeStamp");
        if (typeof eventTime !== "number" || !call(numberFinite, nativeNumber, [eventTime], "Number.isFinite")) eventTime = listenerStart;
        if (eventTime > listenerStart + 1000 && typeof performanceTimeOrigin === "number") eventTime -= performanceTimeOrigin;
        if (eventTime < 0 || eventTime > listenerStart + 1000) eventTime = listenerStart;
        const inputDelayMs = finite(call(mathMax, nativeMath, [0, listenerStart - eventTime], "Math.max"), "Input delay");
        call(queueMicrotask_, globalThis, [() => {
          try {
            const processingDurationMs = finite(call(mathMax, nativeMath, [0, now() - listenerStart], "Math.max"), "Input processing duration");
            call(requestAnimationFrame_, globalThis, [(frameTime) => {
              try {
                const nextFrameMs = finite(call(mathMax, nativeMath, [inputDelayMs + processingDurationMs, frameTime - eventTime], "Math.max"), "Next frame timing");
                finish(freeze({ inputDelayMs, processingDurationMs, nextFrameMs }));
              } catch (error) { fail(error); }
            }], "requestAnimationFrame");
          } catch (error) { fail(error); }
        }], "queueMicrotask");
      } catch (error) { fail(error); }
    };
    for (const name of eventNames) call(eventAdd, nativeDocument, [name, listener, true], "Document.addEventListener");
    timer = call(setTimeout_, globalThis, [() => { cleanup(); fail(new Error("Measured browser interaction did not dispatch its expected event")); }, 5000], "setTimeout");
    call(mapSet, measurements, [id, freeze({ promise, cleanup })], "Map.set");
    return id;
  }
  async function finishMeasurement(id) {
    const measurement = call(mapGet, measurements, [id], "Map.get");
    if (!measurement) throw new Error("Browser performance measurement is unknown");
    try { return await measurement.promise; }
    finally { measurement.cleanup(); call(mapDelete, measurements, [id], "Map.delete"); }
  }
  function cancel(id) {
    const measurement = call(mapGet, measurements, [id], "Map.get");
    if (!measurement) return null;
    measurement.cleanup();
    call(mapDelete, measurements, [id], "Map.delete");
    return null;
  }
  defineProperty(globalThis, key, { value: freeze({ timings, scroll, box, style, prepare, finish: finishMeasurement, cancel }), enumerable: false, configurable: false, writable: false });
})();
`;

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
    runTimeoutMs: bounded(options.runTimeoutMs, defaultBrowserRunTimeoutMs, "Browser test run timeout", 60 * 60_000),
    cleanupTimeoutMs: bounded(options.cleanupTimeoutMs, defaultBrowserCleanupTimeoutMs, "Browser cleanup timeout", 60_000),
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
  try {
    const build = await buildProject(config, site, options.executable);
    if (!build.ok) {
      process.stderr.write(build.output);
      return 1;
    }
    const verified = await verifyProductionBuild(site);
    await prepareStandardModules(compiled, config);
    const entries: Array<{ readonly file: string; readonly output: string; readonly tests: readonly ModuleTest[] }> = [];
    for (const file of files) {
      const entry = await compileBrowserTest(file, compiled, config);
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
        try {
          activeBrowserServer = await browserTypes[engine].launchServer({ headless: true, timeout: 30_000 });
          engineStarted = true;
          if (lifecycleFailure !== null) throw lifecycleFailure;
          activeBrowser = await browserTypes[engine].connect(activeBrowserServer.wsEndpoint(), { timeout: 30_000 });
          engineEntries:
          for (const entry of entries) {
            let namespace: Record<string, unknown>;
            try {
              namespace = await import(`${pathToFileURL(entry.output).href}?engine=${engine}&run=${Date.now()}`) as Record<string, unknown>;
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
              const test = namespace[declared.name];
              const context = await activeBrowser.newContext();
              const page = await context.newPage();
              page.setDefaultTimeout(30_000);
              page.setDefaultNavigationTimeout(30_000);
              const runtimeFailures: string[] = [];
              let testFailure: unknown = null;
              page.on("pageerror", (error) => runtimeFailures.push(error.stack ?? error.message));
              page.on("console", (message) => {
                if (message.type() === "error" || message.type() === "warning") {
                  runtimeFailures.push(`${message.type()}: ${message.text()}`);
                }
              });
              try {
                await installBrowserPerformanceRuntime(page);
                await installFrameworkRuntime(page, contract.initScript?.(config.framework.config));
                installBrowserRuntime(page, origin, verified.deployment.base, runtimeKey);
                if (typeof test !== "function") throw new Error(`Test ${name} was not emitted`);
                if (test.length !== 0) throw new Error(`Browser test ${name} cannot declare parameters`);
                await boundedBrowserOperation(
                  Promise.resolve().then(() => test()),
                  limits.testTimeoutMs,
                  `Browser test ${quoteReportedText(portablePath(relative(config.root, entry.file)))} :: ${name}`,
                  lifecycle,
                );
                if (runtimeFailures.length > 0) throw new Error(`Browser runtime failures:\n${runtimeFailures.join("\n")}`);
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
              // The host error channel is the third way a failure reaches a
              // human here, and the one the runner used to ignore: the test
              // body runs in this process, so a page API it calls, a detached
              // task it starts, and a module it imports all report through
              // console.error, uncaughtException, or unhandledRejection rather
              // than through the page. Draining after the verdict also catches
              // page reports queued while the context closed.
              const hostReports = await channel.drain();
              if (testFailure === null && (hostReports.length > 0 || runtimeFailures.length > 0)) {
                const reported = [...runtimeFailures, ...hostReports].join("\n");
                testFailure = new Error(hostReports.length > 0
                  ? `Browser runtime failures:\n${reported}\n${browserTestHostGuidance}`
                  : `Browser runtime failures:\n${reported}`);
              }
              if (testFailure instanceof BrowserTestInterrupted || testFailure instanceof BrowserTestRunTimedOut) throw testFailure;
              if (testFailure === null) {
                passed += 1;
                process.stdout.write(`✓ ${engine} :: ${quoteReportedText(portablePath(relative(config.root, entry.file)))} :: ${name}\n`);
              } else {
                failed += 1;
                process.stderr.write(`✗ ${engine} :: ${quoteReportedText(portablePath(relative(config.root, entry.file)))} :: ${name}\n${stackOf(testFailure)}\n`);
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
  await page.addInitScript({ content: browserPerformanceInitScript });
}

async function compileBrowserTest(
  file: string,
  outputRoot: string,
  config: VelarProjectConfig,
): Promise<{ readonly file: string; readonly output: string; readonly tests: readonly ModuleTest[] } | null> {
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
    process.stderr.write(`✗ ${portablePath(relative(config.root, file))}\n${errors.join("\n\n")}\n`);
    return null;
  }
  await writeCompiledTestProject(project, outputRoot);
  const entry = project.modules.find((module) => module.inputPath === file);
  const tests = entry?.result.moduleInterface.tests ?? [];
  if (tests.length === 0) {
    process.stderr.write(`✗ ${portablePath(relative(config.root, file))} declares no tests\n`);
    return null;
  }
  return { file, output: entry ? compiledTestModulePath(project, entry, outputRoot) : join(outputRoot, relative(config.root, file).replace(/\.vel$/u, ".js")), tests };
}

function installBrowserRuntime(page: Page, origin: string, base: string, runtimeKey: symbol): void {
  const locator = (selector: unknown) => page.locator(String(selector));
  const storageArea = (area: unknown): "local" | "session" => {
    const value = String(area);
    if (value !== "local" && value !== "session") throw new Error("Browser test storage area must be local or session");
    return value;
  };
  const mockedRoutes = new Set<string>();
  const runtime = Object.freeze({
    async open(path = "/") {
      const value = String(path);
      if (!value.startsWith("/")) throw new Error("browser.open requires an application-relative path starting with '/'");
      const target = base === "/" ? value : `${base.slice(0, -1)}${value}`;
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
      return page.evaluate(async (request) => {
        const bridge = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.desktop.bridge.v1"))?.value as {
          invoke?: (capability: string, operation: string, args: unknown[], timeout: number) => Promise<unknown>;
        } | undefined;
        if (!bridge || typeof bridge.invoke !== "function") throw new Error("Desktop application test bridge is unavailable");
        return bridge.invoke(request.capability, request.operation, request.args as unknown[], request.timeout);
      }, input);
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
    const value = await page.evaluate(async (input) => {
      const runtime = Object.getOwnPropertyDescriptor(globalThis, Symbol.for(input.key))?.value as {
        finish?: (identity: number) => Promise<unknown>;
      } | undefined;
      if (!runtime || typeof runtime.finish !== "function") throw new Error("Browser performance test runtime is unavailable");
      return runtime.finish(input.identity);
    }, { key: browserPerformanceRuntimeKey, identity: measurement as number });
    return interactionTiming(value);
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

async function prepareStandardModules(root: string, config: VelarProjectConfig): Promise<void> {
  const packageRoot = join(root, "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  for (const [source, fallback] of standardModuleSources(config.compilerExtensions)) {
    const name = source.slice("velar/".length);
    exports[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), standardModuleSource(source, config.extensionConfig, config.compilerExtensions) ?? fallback, "utf8");
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports }), "utf8");
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
