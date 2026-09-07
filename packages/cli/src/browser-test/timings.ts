/**
 * What the page's performance runtime measured, checked before a test can read
 * it: a timing this side did not bound is a number a product can fake.
 */
import type { Locator, Page } from "playwright";
import { browserPerformanceRuntimeKey } from "../browser-performance-abi.ts";

export interface BrowserInteractionTiming {
  readonly inputDelayMs: number;
  readonly processingDurationMs: number;
  readonly nextFrameMs: number;
}

export async function measureBrowserInteraction(
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

export function navigationTiming(value: unknown): Readonly<{
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
