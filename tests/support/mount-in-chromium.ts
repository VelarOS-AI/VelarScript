import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { compileWeb } from "./compile.ts";

/**
 * D115 P5 — the one copy of "mount this Web source in Chromium and ask the
 * document what happened".
 *
 * `tests/web/runtime.slow.test.ts` and `tests/web/reactivity.slow.test.ts` each
 * carried it, differing in nothing that ran: one wrote the extension list out
 * and the other took it from `compileWeb`, which is the same list. The source
 * must compile clean, because a probe that mounts a program with a diagnostic
 * in it is measuring the diagnostic; the `pageerror` listener is installed
 * before the module is added, so the visit is handed every failure the page
 * threw and not only the ones it survived; and the wait is for the first child
 * of `#app`, which is the point at which a mount has produced something to
 * read.
 */
export async function mountInChromium(
  source: string,
  visit: (page: Page, failures: readonly string[]) => Promise<void>,
): Promise<void> {
  const result = compileWeb(source);
  assert.deepEqual(result.diagnostics, []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => {
      failures.push(String(error));
    });
    await page.setContent(
      '<!doctype html><html><body><div id="app"></div></body></html>',
    );
    await page.addScriptTag({ content: result.code ?? "", type: "module" });
    await page.waitForFunction(
      "document.querySelector('#app').childNodes.length > 0",
    );
    await visit(page, failures);
  } finally {
    await browser.close();
  }
}
