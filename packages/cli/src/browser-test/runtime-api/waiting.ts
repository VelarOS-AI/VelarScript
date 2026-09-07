/**
 * The two web-first waits. Readiness is established by asserting on what the
 * page shows, not by waiting for network quiescence a product need never reach.
 */
import type { RuntimeApiContext } from "./context.ts";

export function browserWaitingApi(context: RuntimeApiContext) {
  const { locator } = context;
  return {
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
  };
}
