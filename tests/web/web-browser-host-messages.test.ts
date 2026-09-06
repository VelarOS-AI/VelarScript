import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { standardModuleSource } from "../../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

// D114 0.29.0 LC-I1. "There is no browser here" is one fact, and `velar/browser`
// used to say it in four ways, two of which never mentioned a host at all:
//
//   environment():      Browser online state must be bool
//   location():         Browser location URL must be a string
//   watchOnline:        The browser does not expose native global addEventListener
//   watchVisibility:    The browser does not expose native addEventListener
//   scrollTo:           The browser does not expose native scrollTo
//   frame():            The browser does not expose native requestAnimationFrame
//   clipboard:          Clipboard access requires a secure browser context
//
// The first two are *field validations*: an author who reads "Browser online
// state must be bool" goes to check his own data, and the fact is that the host
// has no browser in it. `velar/storage` already answers the same question in
// one sentence — "velar/storage requires a browser storage environment" — and
// the charter's standard-library membership boundary requires the failure to
// arrive at the call that needed the host, never at the import. Both halves are
// asserted here: the sentence, and that a present document leaves every entry
// exactly as it was.

const source = standardModuleSource("velar/browser", { base: "/" }, [velarCompilerExtension]) ?? "";

/** Runs `probe` after the module source, under whatever globals `host` installs first. */
function run(host: string, probe: string): string {
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${host}\n${source}\n${probe}\n`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

/** Every guarded entry, called with arguments that are themselves valid. */
const entries: readonly (readonly [string, string])[] = [
  ["environment()", "environment()"],
  ["location()", "location()"],
  ["watchOnline()", 'watchOnline(() => {})'],
  ["watchVisibility()", 'watchVisibility(() => {})'],
  ["scrollTo()", "scrollTo(0, 0)"],
  ["frame()", "frame()"],
  ["readClipboardText()", "readClipboardText()"],
  ["writeClipboardText()", 'writeClipboardText("x")'],
];

const probe = (call: string): string => `
try { await ${call}; console.log("accepted"); }
catch (error) { console.log(error.message); }
`;

for (const [entry, call] of entries) {
  test(`[LC-I1] ${entry} names the missing browser host in one sentence`, () => {
    assert.equal(
      run("", probe(call)),
      `velar/browser requires a browser host; ${entry} was called where no document exists\n`,
    );
  });
}

test("[LC-I1] the refusal is the same family velar/storage already used", () => {
  const storage = standardModuleSource("velar/storage", { base: "/" }, [velarCompilerExtension]) ?? "";
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${storage}\ntry { storage.set("k", 1); } catch (error) { console.log(error.message); }\n`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  // Same shape, same place: the module names itself, and the call is where it failed.
  assert.match(execution.stdout, /^velar\/storage requires a browser storage environment\n$/u);
});

// A document is the host's own evidence, so with one present nothing about
// these entries changes — the field validations, the secure-context rule and
// the native-operation checks are all still the answers they were.
const documentHost = `
globalThis.document = { visibilityState: "visible" };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "en", languages: ["en"], onLine: true, maxTouchPoints: 0 } });
globalThis.matchMedia = () => ({ matches: false });
`;

test("[LC-I1] with a document present, environment() answers rather than refusing", () => {
  assert.equal(run(documentHost, probe("environment()")), "accepted\n");
});

test("[LC-I1] with a document present, a missing host operation keeps its own message", () => {
  // No `requestAnimationFrame` on this host: that is a different fact from
  // "there is no browser", and it keeps the sentence it always had.
  assert.equal(
    run(documentHost, probe("frame()")),
    "The browser does not expose native requestAnimationFrame\n",
  );
});

test("[LC-I1] with a document present, the clipboard still names the secure context", () => {
  assert.equal(
    run(documentHost, probe('writeClipboardText("x")')),
    "Clipboard access requires a secure browser context\n",
  );
});

test("[LC-I1] an invalid argument is still refused before the host is asked for", () => {
  // The order the hardening tests pin: a value the call cannot use is answered
  // first, so a bad argument never reads as a missing browser.
  assert.equal(run("", probe("scrollTo(Number.NaN, 0)")), "Scroll x must be a finite number\n");
  assert.equal(run("", probe("writeClipboardText(42)")), "Clipboard text must be a string\n");
  assert.equal(run("", probe("watchOnline(42)")), "watchOnline requires a callback\n");
});

test("[LC-I1] the timers keep running with no host at all", () => {
  // The ledger's DECIDED-AND-CORRECT record: `after`/`every` are not browser
  // capabilities and the charter promises a hostless `velar test` still runs the
  // pure functions in such a module. Guarding them would have broken that.
  assert.equal(run("", `
const stop = after("1ms", () => {});
stop();
console.log("timers " + typeof stop);
`), "timers function\n");
});
