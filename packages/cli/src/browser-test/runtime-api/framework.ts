/** The framework bridge a desktop or host framework exposes to a browser test. */
import type { RuntimeApiContext } from "./context.ts";

export function browserFrameworkApi(context: RuntimeApiContext) {
  const { frameworkController, page } = context;
  return {
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
  };
}
