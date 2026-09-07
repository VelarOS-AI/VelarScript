/**
 * The registry key the browser-test performance runtime publishes itself under,
 * and the one every page-side measurement call reads it back from.
 *
 * It is declared here rather than beside its two consumers because the runtime
 * that carries it is `packages/cli/runtime/browser-performance.js`, which holds
 * the key *resolved* — the generated constant is that file's text, not a
 * template — and `scripts/generate-runtime-sources.mjs` re-renders the key from
 * this declaration to refuse a drift between the two. Generation runs before
 * any workspace package is built, so the module it reads the key from cannot be
 * one that imports a package's `dist`; `browser-test-runner.ts` does.
 */
export const browserPerformanceRuntimeKey = "velar.browser.test.performance.v1";
