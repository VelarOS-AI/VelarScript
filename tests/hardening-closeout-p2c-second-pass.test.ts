import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile as compileCore } from "@velarscript/compiler";
import { standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import { LOOK_EXCLUDED_PROPERTIES, LOOK_PROPERTIES, LOOK_SHORTHAND_LONGHANDS, lookShorthandOverlap } from "../packages/web/src/look.ts";

/**
 * The P2c second pass, at the level each finding's evidence reached.
 *
 * **The headline is that a Look block reads like a CSS rule and is not one.**
 * Every entry lowers to its own single-declaration rule, and the stylesheet
 * orders those rules by where each property first appears *in the module*
 * rather than by the block that wrote them. Between a shorthand and a longhand
 * it writes, that means the winner is decided by unrelated code — the first
 * test below builds the exact arrangement and reads the emitted sheet, because
 * this is the fact the two refusals rest on and it is not one a reader would
 * assume.
 *
 * `font` was the property that turned the arrangement into a silent outage. It
 * was a free-text kind, so `font = token("--ui-font-body")` type-checked; the
 * emitted `font: var(--x)` was invalid at computed-value time whenever the
 * token held a size and no family; and an invalid shorthand resets *every*
 * longhand it owns, so the font-weight, font-family and line-height written
 * three lines above went with it. A consumer shipped thirty-six such
 * declarations, none of them live and none of them diagnosed, with `velar
 * check` green and three engines agreeing. Its whole value space was already
 * published as checked longhands, so it is not in the table any more.
 *
 * The rest of the batch is smaller and each entry says what it closes.
 */

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runCli(cwd: string, ...arguments_: readonly string[]): Execution {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

/** One Web module with the `velar/look` exports in scope, as the project driver resolves them. */
function compileWeb(source: string): ReturnType<typeof compileCore> {
  const imports = new Map<string, unknown>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const imported = raw.trim();
      const type = lookExports?.get(imported);
      if (type) imports.set(imported, type);
    }
  }
  return compileCore(source.trimStart(), { analysis: { imports: imports as never }, extensions: [velarCompilerExtension] });
}

function webMessages(source: string): readonly string[] {
  return compileWeb(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function executeModule(code: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

// ── P2c-4 ───────────────────────────────────────────────────────────────────

test("[P2c-4] a Look shorthand and its longhand are ordered by the module, not by the block", async () => {
  // `paddingTop` is written *after* `padding` inside `card`, which in CSS means
  // it wins. It does not here: an unrelated Look earlier in the module already
  // mentioned `paddingTop`, so that rule was registered first and sorts first,
  // and `padding` overwrites the longhand the author put after it. This is the
  // whole justification for the refusal the next tests assert, so it is
  // measured rather than described.
  const root = await temporaryRoot("velar-p2c-look-order");
  try {
    await writeTree(root, {
      "velar.json": JSON.stringify({ formatVersion: 2, kind: "application", entry: "src/main.vel", outDir: "dist", extensions: ["@velarscript/web"], web: { title: "Order" } }),
      "src/main.vel": [
        'import {Look} from "velar/look"',
        "",
        "const earlier: Look = look:",
        "    paddingTop = 4px",
        "",
        "const card: Look = look:",
        "    padding = 8px",
        "",
        "export component Card:",
        "    return <div look={card}>card<p look={earlier}>earlier</p></div>",
        "",
        "@main:",
        '    mount(<Card />, "#app")',
        "",
      ].join("\n"),
    });
    assert.equal(runCli(root, "check", ".").status, 0);
    assert.equal(runCli(root, "build", ".").status, 0);
    const assets = join(root, "dist", "assets");
    const sheets = (await readdir(assets)).filter((name) => name.endsWith(".css"));
    const sheet = (await Promise.all(sheets.map((name) => readFile(join(assets, name), "utf8")))).join("\n");
    const longhand = sheet.indexOf('[data-velar-look~="base:padding-top"]');
    const shorthand = sheet.indexOf('[data-velar-look~="base:padding"]');
    assert.ok(longhand >= 0 && shorthand >= 0, sheet);
    assert.ok(longhand < shorthand,
      "the longhand's rule precedes the shorthand's even though the source writes it after — which is why the pair is refused");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[P2c-4] a shorthand beside a longhand it writes is refused, in a block and on an element", () => {
  const block = webMessages(`
import {Look, spacing} from "velar/look"

const card: Look = look:
    padding = spacing(8px, 12px)
    paddingTop = 0px
`);
  assert.equal(block.length, 1, block.join("\n"));
  assert.match(block[0]!, /^VEL5039 /u);
  assert.match(block[0]!, /sets 'padding' and 'paddingTop'/u);
  assert.match(block[0]!, /orders those rules by where each property first appears in the module/u);
  assert.match(block[0]!, /Write paddingTop, paddingRight, paddingBottom, paddingLeft in place of 'padding', or drop 'paddingTop'/u);

  // The `look:` directives lower to the very same rules, so the same pair on an
  // element is the same defect. `style:` directives are not: they compose one
  // inline style object, where the browser's own source order settles it.
  const element = webMessages(`
export component Card:
    return <div look:padding={8px} look:paddingTop={0px}>card</div>
`);
  assert.equal(element.length, 1, element.join("\n"));
  assert.match(element[0]!, /^VEL5039 Element '<div>' sets 'padding' and 'paddingTop'/u);
  assert.deepEqual(webMessages(`
export component Card:
    return <div style:padding={8px} style:paddingTop={0px}>card</div>
`), []);
});

test("[P2c-4] the refusal reaches through a nested shorthand and stops at an independent pair", () => {
  // `border` reaches `borderTopColor` through `borderColor`, so the closure is
  // what decides rather than the direct table.
  const nested = webMessages(`
import {Look, border, color} from "velar/look"

const framed: Look = look:
    border = border(1px, color("black"))
    borderTopColor = color("red")
`);
  assert.equal(nested.length, 1, nested.join("\n"));
  assert.match(nested[0]!, /sets 'border' and 'borderTopColor'/u);

  // Two shorthands that share a longhand but contain neither the other are not
  // a pair the browser needs help with, and neither is a pair in two scopes:
  // a condition raises the rank, so the cascade settles it.
  assert.deepEqual(webMessages(`
import {Look} from "velar/look"

const sides: Look = look:
    borderWidth = 2px
    borderTop = "none"

const stateful: Look = look:
    padding = 8px

    if @hover:
        paddingTop = 0px
`), []);
});

test("[P2c-4] font is not a Look property, and the refusal names the longhands that are", () => {
  const messages = webMessages(`
import {Look, token} from "velar/look"

const body: Look = look:
    fontWeight = 600
    font = token("--ui-font-body")
`);
  assert.equal(messages.length, 1, messages.join("\n"));
  assert.match(messages[0]!, /^VEL5038 CSS property 'font' is outside checked Look/u);
  assert.match(messages[0]!, /fontStyle, fontVariant, fontWeight, fontStretch, fontSize, lineHeight and fontFamily/u);
  assert.match(messages[0]!, /resets all seven, including the ones written beside it/u);
  assert.match(messages[0]!, /A design token carrying a size belongs in fontSize/u);
  assert.ok(!LOOK_PROPERTIES.has("font"));
  assert.ok(LOOK_EXCLUDED_PROPERTIES.has("font"));

  // The spelling the refusal names has to be the one that works.
  assert.deepEqual(webMessages(`
import {Look, token} from "velar/look"

const body: Look = look:
    fontWeight = 600
    fontFamily = "Inter, sans-serif"
    lineHeight = 1.4
    fontSize = token("--ui-font-size-body")
`), []);
});

test("[P2c-4] the shorthand table only names published properties, and answers both directions", () => {
  for (const [shorthand, longhands] of LOOK_SHORTHAND_LONGHANDS) {
    assert.ok(LOOK_PROPERTIES.has(shorthand), shorthand);
    for (const longhand of longhands) assert.ok(LOOK_PROPERTIES.has(longhand), `${shorthand} -> ${longhand}`);
    assert.ok(!longhands.has(shorthand), `${shorthand} contains itself`);
  }
  assert.deepEqual(lookShorthandOverlap("padding", "paddingTop"), { shorthand: "padding", longhand: "paddingTop" });
  assert.deepEqual(lookShorthandOverlap("paddingTop", "padding"), { shorthand: "padding", longhand: "paddingTop" });
  assert.equal(lookShorthandOverlap("padding", "margin"), null);
  // `inset` and the logical inset shorthands stay separate families: CSS
  // cascades `left` and `insetInlineStart` independently, and a refusal that
  // joined them would refuse a pair the writing mode resolves.
  assert.equal(lookShorthandOverlap("inset", "insetInlineStart"), null);
});

// ── P2c-5 ───────────────────────────────────────────────────────────────────

test("[P2c-5] verticalAlign is a checked Look property with its own vocabulary", () => {
  assert.deepEqual(webMessages(`
import {Look} from "velar/look"

const badge: Look = look:
    verticalAlign = "text-bottom"

const raised: Look = look:
    verticalAlign = 2px

const shared: Look = look:
    verticalAlign = 20%
`), []);
  const refused = webMessages(`
import {Look} from "velar/look"

const badge: Look = look:
    verticalAlign = "text-under"
`);
  assert.equal(refused.length, 1, refused.join("\n"));
  assert.match(refused[0]!, /^VEL5038 Look property 'verticalAlign' does not accept 'text-under'/u);
  assert.match(refused[0]!, /text-bottom/u);
});

// ── P2c-6 ───────────────────────────────────────────────────────────────────

test("[P2c-6] the system clipboard publishes a read and a write that read as a pair", () => {
  // The finding said `velar/browser` could not write the clipboard. It could,
  // under the name `copyText` — so what the consumer met was a table holding
  // `readClipboardText`, `clipboardText` and `setClipboardText`, a read and an
  // event pair, and no name that answered "how do I write it". They shipped the
  // product's copy button deliberately absent rather than write one that might
  // do nothing. A capability whose name does not answer the question being
  // asked is, from where the author is standing, a missing capability.
  //
  // What the write *does* is asserted where it already was, against a hostile
  // host: `tests/compiler.test.ts` proves the argument is refused before the
  // browser is reached and never coerced, and that a replaced instance method
  // cannot redirect an initialized module. That a click really puts text on a
  // real clipboard is asserted in `tests/browser.acceptance.ts`, which had
  // never pressed the fixture's copy button.
  const source = standardModuleSource("velar/browser", { base: "/" }, [velarCompilerExtension]);
  assert.ok(source);
  assert.match(source, /export async function readClipboardText\(\)/u);
  assert.match(source, /export async function writeClipboardText\(value\)/u);
  // The name the write used to carry is gone rather than kept beside the new
  // one: a second spelling for one capability is what sends the next reader
  // looking for a third.
  assert.doesNotMatch(source, /\bcopyText\b/u);
});

// ── P2c-7 ───────────────────────────────────────────────────────────────────

test("[P2c-7] velar/time formats a part of a time in the locale's own clock", () => {
  const source = standardModuleSource("velar/time", { base: "/" }, [velarCompilerExtension]);
  assert.ok(source);
  const probe = `
${source}
const when = utc(2026, 8, 29, 15, 45, 0);
console.log(format(when, "en-US", "UTC"));
console.log(format(when, "en-US", "UTC", "none", "short"));
console.log(format(when, "en-GB", "UTC", "none", "short"));
console.log(format(when, "ja-JP", "Asia/Tokyo", "none", "short"));
console.log(format(when, "en-US", "UTC", "full", "none"));
try { format(when, "en-US", "UTC", "none", "none"); console.log("accepted"); } catch (error) { console.log(error.message); }
try { format(when, "en-US", "UTC", "brief"); console.log("accepted"); } catch (error) { console.log(error.message); }
try { format(when, "en-US", "UTC", 3); console.log("accepted"); } catch (error) { console.log(error.name); }
`;
  const result = executeModule(probe);
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  // The default is what it always was: the whole date and time, medium.
  assert.match(lines[0]!, /^Aug 29, 2026/u);
  // The finding: a time of day the consumer had to hand-build out of `parts()`,
  // which gave every locale a twenty-four-hour clock. The locale decides here.
  assert.equal(lines[1], "3:45 PM");
  assert.equal(lines[2], "15:45");
  assert.equal(lines[3], "0:45");
  assert.equal(lines[4], "Saturday, August 29, 2026");
  assert.equal(lines[5], "velar/time format needs a date style or a time style; both cannot be none");
  assert.equal(lines[6], "Time date style must be one of full, long, medium, short, or none");
  assert.equal(lines[7], "TypeError");
});

// ── the sandbox `#` target ──────────────────────────────────────────────────

test("[P2c sandbox] a relative package.json#imports target reaches the test and run sandboxes", async () => {
  // `velar check` and `velar build` resolve a `#` specifier from the real
  // importer; `velar test` and `velar run` copied the `imports` map into a
  // sandbox manifest and left the file behind, so a target naming a path
  // resolved against a directory that did not hold it. A target naming a
  // package survived, because the sandbox lives inside the project and Node's
  // upward `node_modules` walk still reaches it — which is exactly why the gap
  // could sit under a passing suite.
  const root = await temporaryRoot("velar-p2c-hash-target");
  try {
    await writeTree(root, {
      "package.json": JSON.stringify({ name: "hash-target", private: true, type: "module", imports: { "#highlight": "./src/vendor/highlight.mjs" } }),
      // The neighbour proves the copy follows the target's own relative
      // imports: one file is a fixture, a file plus what it needs is the rule.
      "src/vendor/highlight.mjs": 'import {label} from "./label.mjs"\nexport function highlight(text) { return `${label}:${text}` }\n',
      "src/vendor/label.mjs": 'export const label = "hl"\n',
      "main.vel": 'extern module "#highlight":\n    export def highlight(text: string) -> string\nimport js {highlight} from "#highlight"\nprint(highlight("code"))\n',
      "main.test.vel": 'extern module "#highlight":\n    export def highlight(text: string) -> string\nimport js {highlight} from "#highlight"\nimport {expect} from "velar/test"\n\ntest "the bridged highlighter resolves inside the sandbox":\n    expect(highlight("x")).toBe("hl:x")\n',
    });
    assert.equal(runCli(root, "check", "main.vel").status, 0);
    const run = runCli(root, "run", "main.vel");
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.equal(run.stdout, "hl:code\n");
    const tested = runCli(root, "test", "main.test.vel");
    assert.equal(tested.status, 0, tested.stdout + tested.stderr);
    assert.match(tested.stdout, /the bridged highlighter resolves inside the sandbox/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
