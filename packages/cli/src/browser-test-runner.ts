/**
 * Running a project's `.browser.test.vel` files against the built application
 * in a real browser. The run lives in `browser-test/` — `supervisor.ts` owns
 * the worker process, `worker.ts` drives the engines, and `runtime-api.ts`
 * assembles the `velar/web-test` runtime a compiled test body reaches for.
 */
export type { BrowserEngine, BrowserEngineSelection, BrowserTestRunnerOptions } from "./browser-test/run.ts";
export { runBrowserTests } from "./browser-test/supervisor.ts";
