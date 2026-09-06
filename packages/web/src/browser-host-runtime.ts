/**
 * The one refusal `velar/browser` gives when there is no browser under it.
 *
 * D114 0.29.0 LC-I1: "there is no browser here" is one fact, and it used to
 * arrive in four sentences — two of them field validations ("Browser online
 * state must be bool") that sent the author to check his own data, and two
 * spellings of "The browser does not expose native …" that differed by a word.
 * `velar/storage` already answers this in one sentence at the call that needed
 * the host, and the charter's standard-library membership boundary requires the
 * failure to arrive there rather than at the import; this is that sentence for
 * `velar/browser`.
 *
 * The document is the host's own evidence: every guarded entry reads `window`,
 * `navigator`, `location` or the document itself, and none of the four exists
 * without it. With a document present, every entry behaves exactly as it did —
 * an argument is still checked before the host is touched, and a clipboard
 * outside a secure context still says so.
 *
 * D115 §三: it lives in its own module because `runtime.ts` is exempt from the
 * file budget and an exempt file may shrink and may not grow.
 */
export const WEB_BROWSER_HOST_RUNTIME = `
function __velarBrowserRequireHost(entry) {
  const value = __velarBrowserDocument;
  if (value === __velarBrowserMissingField || value === null || (typeof value !== "object" && typeof value !== "function")) {
    throw new Error("velar/browser requires a browser host; " + entry + " was called where no document exists");
  }
}`;
