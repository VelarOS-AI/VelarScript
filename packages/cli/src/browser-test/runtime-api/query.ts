/** Reading the page: text, attributes, geometry, computed style, presence. */
import { browserPerformanceRuntimeKey } from "../../browser-performance-abi.ts";
import type { RuntimeApiContext } from "./context.ts";

export function browserQueryApi(context: RuntimeApiContext) {
  const { locator } = context;
  return {
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
  };
}
