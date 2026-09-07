/**
 * The `velar/web-test` runtime the test process exposes to a compiled browser
 * test: one frozen object of thirty methods, assembled from the families in
 * `runtime-api/` in the order the runtime publishes them, and reachable from a
 * compiled body through the framework's runtime key.
 */
import type { Page } from "playwright";
import type { FrameworkBrowserTestController } from "@velarscript/compiler/framework-host";
import { VELAR_BROWSER_PERFORMANCE_RUNTIME } from "../runtime-sources.generated.ts";
import type { RuntimeApiContext } from "./runtime-api/context.ts";
import { browserFrameworkApi } from "./runtime-api/framework.ts";
import { browserInteractionApi } from "./runtime-api/interaction.ts";
import { browserNavigationApi, browserViewportApi } from "./runtime-api/navigation.ts";
import { browserNetworkApi } from "./runtime-api/network.ts";
import { browserQueryApi } from "./runtime-api/query.ts";
import { browserStorageApi } from "./runtime-api/storage.ts";
import { browserTimingsApi } from "./runtime-api/timings.ts";
import { browserWaitingApi } from "./runtime-api/waiting.ts";

export function installBrowserRuntime(
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
  const context: RuntimeApiContext = {
    page, origin, base, locator, storageArea, mockedRoutes, frameworkController, installFrameworkBeforeOpen,
  };
  const runtime = Object.freeze({
    ...browserNavigationApi(context),
    ...browserInteractionApi(context),
    ...browserQueryApi(context),
    ...browserWaitingApi(context),
    ...browserViewportApi(context),
    ...browserTimingsApi(context),
    ...browserStorageApi(context),
    ...browserNetworkApi(context),
    ...browserFrameworkApi(context),
  });
  (globalThis as unknown as { [key: symbol]: unknown })[runtimeKey] = runtime;
}

export function removeBrowserRuntime(runtimeKey: symbol): void {
  delete (globalThis as unknown as { [key: symbol]: unknown })[runtimeKey];
}

async function installFrameworkRuntime(page: Page, source: string | undefined): Promise<void> {
  if (source === undefined) return;
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source, "utf8") > 1024 * 1024) {
    throw new Error("Framework browser-test init script must contain 1 byte through 1 MiB of text");
  }
  await page.addInitScript({ content: source });
}

export async function installBrowserPerformanceRuntime(page: Page): Promise<void> {
  await page.addInitScript({ content: VELAR_BROWSER_PERFORMANCE_RUNTIME });
}
