/** Driving the page: the five gestures a test can make. */
import { browserPerformanceRuntimeKey } from "../../browser-performance-abi.ts";
import type { RuntimeApiContext } from "./context.ts";

export function browserInteractionApi(context: RuntimeApiContext) {
  const { locator } = context;
  return {
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
  };
}
