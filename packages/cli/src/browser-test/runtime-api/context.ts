/**
 * What every `velar/web-test` method is given: the page it drives, where the
 * application is served, and the four pieces of state the families share.
 */
import type { Locator, Page } from "playwright";
import type { FrameworkBrowserTestController } from "@velarscript/compiler/framework-host";

export interface RuntimeApiContext {
  readonly page: Page;
  readonly origin: string;
  readonly base: string;
  /** The one locator spelling every selector-taking method uses. */
  readonly locator: (selector: unknown) => Locator;
  /** Refuses a storage area name the page has no storage for. */
  readonly storageArea: (area: unknown) => "local" | "session";
  /** The routes `network.respond` has taken over, so `networkClear` can free them. */
  readonly mockedRoutes: Set<string>;
  readonly frameworkController: FrameworkBrowserTestController | undefined;
  /** Installs the framework's page runtime once, before the first navigation. */
  readonly installFrameworkBeforeOpen: () => Promise<void>;
}
