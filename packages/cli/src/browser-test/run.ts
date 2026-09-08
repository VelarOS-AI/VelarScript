/**
 * What a browser-test run is: the engines it can use, the bounds it obeys, the
 * two ways it can be stopped from outside a test body, and the one thing an
 * author who reached a host-API failure did not know.
 */
import { chromium, firefox, webkit, type BrowserType } from "playwright";
import { browserCleanupTimeoutMs, browserRunDeadlineMs } from "../browser-process-owner.ts";
import { formatProgramFailure } from "../program-failure-report.ts";

/**
 * The one thing an author who reached this failure did not know. A
 * `.browser.test.vel` body runs in the test process and drives a page that is
 * already running the built application, so a page API called from the test
 * body fails on a host that has no DOM and no storage. The compile-time
 * guidance for `document` says the same thing at the other end.
 */
export const browserTestHostGuidance = [
  "A .browser.test.vel body runs in the test process, not in the page — the page already runs the built application.",
  'Drive it through `import {browser} from "velar/web-test"`: browser.open("/"), browser.fill(selector, text),',
  "browser.click(selector), browser.waitForText(selector, text), browser.text(selector).",
  "mount, JSX, document, and velar/storage are page APIs and are unavailable in the test process.",
].join("\n");

export type BrowserEngine = "chromium" | "firefox" | "webkit";
export type BrowserEngineSelection = BrowserEngine | "all";

export const browserTypes: Readonly<Record<BrowserEngine, BrowserType>> = { chromium, firefox, webkit };
export const defaultBrowserTestTimeoutMs = 120_000;
export const browserTestWorkerEnvironment = "VELAR_BROWSER_TEST_WORKER_V1";

export interface BrowserTestRunnerOptions {
  readonly fullStack?: boolean;
  readonly testTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly executable?: string;
}

export interface BrowserTestLimits {
  readonly fullStack: boolean;
  readonly testTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly cleanupTimeoutMs: number;
}

export class BrowserTestInterrupted extends Error {
  readonly exitCode: number;

  constructor(signal: "SIGHUP" | "SIGINT" | "SIGTERM", exitCode: number) {
    super(`Browser test run interrupted by ${signal}`);
    this.name = "BrowserTestInterrupted";
    this.exitCode = exitCode;
  }
}

export class BrowserTestRunTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`Browser test run exceeded its ${timeoutMs} millisecond aggregate deadline`);
    this.name = "BrowserTestRunTimedOut";
  }
}

export function browserTestLimits(options: BrowserTestRunnerOptions): BrowserTestLimits {
  const bounded = (value: number | undefined, fallback: number, name: string, maximum: number): number => {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
      throw new RangeError(`${name} must be an integer from 1 through ${maximum}`);
    }
    return resolved;
  };
  return {
    fullStack: options.fullStack === true,
    testTimeoutMs: bounded(options.testTimeoutMs, defaultBrowserTestTimeoutMs, "Browser test timeout", 10 * 60_000),
    runTimeoutMs: bounded(options.runTimeoutMs, browserRunDeadlineMs, "Browser test run timeout", 60 * 60_000),
    cleanupTimeoutMs: bounded(options.cleanupTimeoutMs, browserCleanupTimeoutMs, "Browser cleanup timeout", 60_000),
  };
}

/** Every stack this runner reports goes through the host's own formatter. */
export function stackOf(error: unknown): string {
  return formatProgramFailure(error);
}
