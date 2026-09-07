/**
 * Navigation, and the page's own frame. `browserViewportApi` is separate only
 * because `currentPath` and `viewport` sit after the waiting methods in the
 * assembled object, and that order is the runtime's published shape.
 */
import type { RuntimeApiContext } from "./context.ts";

export function browserNavigationApi(context: RuntimeApiContext) {
  const { base, installFrameworkBeforeOpen, origin, page } = context;
  return {
    async open(path = "/") {
      const value = String(path);
      if (!value.startsWith("/")) throw new Error("browser.open requires an application-relative path starting with '/'");
      const target = base === "/" ? value : `${base.slice(0, -1)}${value}`;
      await installFrameworkBeforeOpen();
      // Navigation owns document loading, not application network quiescence.
      // A product may poll or stream forever; tests establish readiness with
      // the web-first waitFor/waitForText assertions exposed beside open().
      await page.goto(new URL(target, origin).href, { waitUntil: "load" });
      return null;
    },
    async reload() { await page.reload({ waitUntil: "load" }); return null; },
  };
}

export function browserViewportApi(context: RuntimeApiContext) {
  const { base, page } = context;
  return {
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
  };
}
