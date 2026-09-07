/** Bounded response mocking for application-relative paths. */
import type { RuntimeApiContext } from "./context.ts";

export function browserNetworkApi(context: RuntimeApiContext) {
  const { base, mockedRoutes, origin, page } = context;
  return {
    async networkRespond(path: unknown, body: unknown, status: unknown, contentType: unknown, delayMs: unknown) {
      const pathname = String(path);
      const responseBody = String(body);
      const responseStatus = Number(status);
      const responseType = String(contentType);
      const delay = Number(delayMs);
      if (!pathname.startsWith("/") || pathname.includes("\0")) throw new Error("network.respond path must be application-relative and start with '/'");
      if (responseBody.length > 16 * 1024 * 1024) throw new Error("network.respond body cannot exceed 16 MiB");
      if (!Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599) throw new Error("network.respond status must be an HTTP status integer");
      if (!responseType || responseType.length > 1024 || /[\r\n]/u.test(responseType)) throw new Error("network.respond contentType must be bounded single-line text");
      if (!Number.isInteger(delay) || delay < 0 || delay > 30000) throw new Error("network.respond delayMs must be an integer from 0 through 30000");
      const target = new URL(base === "/" ? pathname : `${base.slice(0, -1)}${pathname}`, origin).href;
      if (mockedRoutes.has(target)) await page.unroute(target);
      mockedRoutes.add(target);
      await page.route(target, async (route) => {
        if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
        await route.fulfill({ status: responseStatus, contentType: responseType, body: responseBody });
      });
      return null;
    },
    async networkClear() {
      for (const target of mockedRoutes) await page.unroute(target);
      mockedRoutes.clear();
      return null;
    },
  };
}
