/**
 * The one place the browser-test boundary is written down.
 *
 * Three consumers need the same two facts — the analyzer rejects a
 * `velar/web-test` import outside a browser test, the compiler extension swaps
 * in browser-test guidance for the DOM globals by path suffix, and the
 * framework host tells the CLI which files the browser runner discovers. D57
 * rule 134 rules that a name with an authority is derived from it rather than
 * hand-copied, so the suffix and the module specifier live here and the three
 * import them.
 */

/** The file name a browser test is declared in; the CLI runner discovers exactly these. */
export const BROWSER_TEST_SOURCE_SUFFIX = ".browser.test.vel";

/** The module that reaches from a browser test body into the running page. */
export const BROWSER_TEST_MODULE = "velar/web-test";

/**
 * The one sentence an author standing in a `.browser.test.vel` needs: the body
 * runs in the test process, not in the page, and the only surface from there
 * that reaches across is `velar/web-test`.
 */
export function browserTestDrivingGuidance(name: string): string {
  return `A browser test drives the running page, so '${name}' is not available in its body; import {browser} from "${BROWSER_TEST_MODULE}" and use browser.open("/"), browser.fill(selector, text), browser.click(selector), browser.waitForText(selector, text), and browser.text(selector) — the same module exports localStorage and sessionStorage for the page's storage`;
}

/**
 * D57 rule 138: `velar/web-test` only has a runtime under `velar test
 * --browser`, so importing it anywhere else compiles a call that is certain to
 * fail. Following D51 rule 109, the refusal lands on the import rather than on
 * the eventual call, and it names the file the import belongs in.
 */
export function browserTestImportGuidance(): string {
  return `'${BROWSER_TEST_MODULE}' drives the running page from the test process, so it only has a runtime under 'velar test --browser'; import it from a '*${BROWSER_TEST_SOURCE_SUFFIX}' module — rename this module, or move the browser test into one of its own — while application code reaches the page through velar/browser`;
}
