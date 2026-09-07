/** Timings and animation, measured by the page runtime and checked on this side. */
import { browserPerformanceRuntimeKey } from "../../browser-performance-abi.ts";
import { measureBrowserInteraction, navigationTiming } from "../timings.ts";
import type { RuntimeApiContext } from "./context.ts";

export function browserTimingsApi(context: RuntimeApiContext) {
  const { locator, page } = context;
  return {
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
  };
}
