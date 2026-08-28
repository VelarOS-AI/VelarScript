import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { compile as compileCore } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import {
  LOOK_KEYWORD_DECIDED_KINDS,
  LOOK_PARTIAL_KEYWORD_PROPERTIES,
  LOOK_PROPERTY_KEYWORDS,
  LOOK_PROPERTY_VALUE_KINDS,
} from "../packages/web/src/look.ts";

// ---------------------------------------------------------------------------
// D65 rules 168 and 169 — a `keyword` Look property carries its own closed set,
// or the module refuses to load.
//
// The family this closes had two sides, and the second was the worse one. A
// keyword property with no vocabulary of its own fell through to a shared list
// of common CSS words, which (A) refused values the property really has —
// `borderStyle = "groove"`, `listStyleType = "upper-roman"` — and (B) accepted
// values it does not — `strokeLinecap = "none"`, `colorScheme = "none"`,
// `scrollSnapType = "mandatory"`. Side B compiled clean and reached the browser
// as a real declaration the browser silently drops, and the usage tour itself
// shipped twelve of them: D56 rule 129's coverage gate proves a property *name*
// is used, never that its *value* is a value.
//
// Rule 168's evidence was `Checked 1 module` from the toolchain, so the value
// probes below run the real CLI over a real project. Rule 168's mechanism is a
// load-time fact, so its probe loads a copy of the table with one entry removed
// and asserts the module itself refuses to come up.
// ---------------------------------------------------------------------------

const root = repositoryRoot;
const cli = join(root, "packages", "cli", "src", "cli.ts");
const lookTable = join(root, "packages", "web", "src", "look.ts");

after(removeTemporaryDirectories);

function run(arguments_: readonly string[]): Promise<{ readonly output: string; readonly code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli, ...arguments_], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("close", (code) => resolvePromise({ output, code }));
  });
}

async function webProject(prefix: string, main: string): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D65 look keywords", base: "/" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), main, "utf8");
  return directory;
}

/** A Look block whose entries are `property = "value"`, one per line. */
function lookOf(name: string, entries: readonly (readonly [string, string])[]): string {
  return `export const ${name} = look:\n${entries.map(([property, value]) => `    ${property} = "${value}"`).join("\n")}\n`;
}

function webMessages(source: string): readonly string[] {
  const imports = new Map<string, unknown>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const name = raw.trim();
      const type = name ? lookExports?.get(name) : undefined;
      if (type) imports.set(name, type);
    }
  }
  const result = compileCore(source, { analysis: { imports: imports as never }, extensions: [velarCompilerExtension] });
  return result.diagnostics.map((item) => `${item.code} ${item.message}`);
}

// D65 item 3 makes a `const` string a design token, so the same value written
// as a token and as a record field has to meet the same closed set the literal
// meets. The probes below were literal-only, which is exactly the shape the
// checker could see: a token spelling compiled clean and reached the browser as
// a declaration it discards, which is the failure rule 168 exists to stop.
const lookValueSpellings: readonly (readonly [label: string, spell: (property: string, value: string) => string])[] = [
  ["literal", (property, value) => `export const probe = look:\n    ${property} = "${value}"\n`],
  ["const token", (property, value) => `const token = "${value}"\nexport const probe = look:\n    ${property} = token\n`],
  ["record field", (property, value) => `const tokens = {shade: "${value}"}\nexport const probe = look:\n    ${property} = tokens.shade\n`],
];

// Every property this ruling closed, with a value its CSS grammar really has
// and a value only the shared fallback list ever had. Each `wrong` below is a
// word taken from that fallback list, so every one of them compiled clean
// before rule 168 and emitted a declaration the browser discards.
const closedProperties: readonly (readonly [property: string, right: string, wrong: string])[] = [
  ["objectPosition", "top left", "none"],
  ["gridAutoFlow", "row dense", "none"],
  ["backgroundBlendMode", "multiply", "none"],
  ["borderStyle", "groove", "smooth"],
  ["borderTopStyle", "ridge", "smooth"],
  ["borderRightStyle", "inset", "smooth"],
  ["borderBottomStyle", "outset", "smooth"],
  ["borderLeftStyle", "double", "smooth"],
  ["outlineStyle", "auto", "smooth"],
  ["fontStretch", "semi-condensed", "circle"],
  ["fontVariant", "tabular-nums", "circle"],
  ["textDecorationLine", "underline line-through", "dotted"],
  ["textDecorationStyle", "wavy", "none"],
  ["textUnderlinePosition", "under left", "none"],
  ["textRendering", "optimizeLegibility", "square"],
  ["listStyleType", "upper-roman", "start"],
  ["listStylePosition", "inside", "none"],
  ["strokeLinecap", "round", "none"],
  ["strokeLinejoin", "bevel", "none"],
  ["colorScheme", "light dark", "none"],
  ["scrollSnapAlign", "start end", "dark"],
  ["scrollSnapStop", "always", "dark"],
  ["scrollSnapType", "y mandatory", "mandatory"],
  ["overscrollBehavior", "contain none", "smooth"],
  ["overscrollBehaviorX", "contain", "smooth"],
  ["overscrollBehaviorY", "auto", "smooth"],
];

// ---------------------------------------------------------------------------
// Rule 168 — the invariant itself, proven by taking one entry away.
// ---------------------------------------------------------------------------

test("[D65-168] every keyword property carries its own closed set", () => {
  const missing = [...LOOK_PROPERTY_VALUE_KINDS]
    .filter(([property, kind]) => kind === "keyword" && !LOOK_PROPERTY_KEYWORDS.has(property))
    .map(([property]) => property);
  assert.deepEqual(missing, []);
  // A vacuity floor: this assertion is worthless if the kind table ever reads
  // empty. D67 rule 172 moved `objectPosition` to `metric`, so the floor is 77
  // rather than the 78 this test was written with; it only ever grows with the
  // published vocabulary from here.
  const keywordProperties = [...LOOK_PROPERTY_VALUE_KINDS].filter(([, kind]) => kind === "keyword");
  assert.ok(keywordProperties.length >= 77, String(keywordProperties.length));
});

test("[D65-168] the table refuses to load when a keyword property has no closed set", async () => {
  const directory = await makeTemporaryDirectory("velar-d65-168-invariant-");
  const source = await readFile(lookTable, "utf8");
  // The whole table is loaded once as a control, so a throw below cannot be a
  // copy that failed to load for some unrelated reason.
  const control = join(directory, "control.mts");
  await writeFile(control, source, "utf8");
  const loaded = await import(pathToFileURL(control).href) as { readonly LOOK_PROPERTY_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> };
  assert.ok(loaded.LOOK_PROPERTY_KEYWORDS.get("strokeLinecap")?.has("butt"));

  const removed = source.replace(/^ {2}\["strokeLinecap".*\n/mu, "");
  assert.notEqual(removed, source);
  const broken = join(directory, "broken.mts");
  await writeFile(broken, removed, "utf8");
  await assert.rejects(
    () => import(pathToFileURL(broken).href),
    /Look property 'strokeLinecap' accepts string keywords and has no closed keyword set/u,
  );
});

test("[D65-169] a recorded partial exclusion names a property that publishes a set", () => {
  for (const [property, note] of LOOK_PARTIAL_KEYWORD_PROPERTIES) {
    assert.ok(LOOK_PROPERTY_KEYWORDS.has(property), property);
    // D73 rule 187 took the record past the `keyword` kind: a property of any
    // kind that decides a string keyword publishes a set, so it can also have a
    // value space that set cannot hold.
    assert.ok(LOOK_KEYWORD_DECIDED_KINDS.has(LOOK_PROPERTY_VALUE_KINDS.get(property)!), property);
    assert.ok(note.length > 0, property);
  }
  assert.ok(LOOK_PARTIAL_KEYWORD_PROPERTIES.size >= 9, String(LOOK_PARTIAL_KEYWORD_PROPERTIES.size));
});

// ---------------------------------------------------------------------------
// Rule 168 side A — a published property can hold the values it really has.
// ---------------------------------------------------------------------------

test("[D65-168] every newly closed property accepts a value its CSS grammar has", { timeout: 300_000 }, async () => {
  // One Look per property. `borderStyle` writes the four side styles and
  // `overscrollBehavior` writes its two axes, and D104 rule 2 refuses a
  // shorthand beside a longhand it writes — one block holding all twenty-six
  // would be measuring that refusal rather than the vocabulary.
  const blocks = closedProperties.map(([property, right], index) => lookOf(`reachable${index}`, [[property, right]]));
  const directory = await webProject("velar-d65-168-accept-", `${blocks.join("\n")}
@main: mount(<div look={reachable0} />, "#app")
`);
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
});

// ---------------------------------------------------------------------------
// Rule 168 side B — the value the shared fallback used to wave through.
// ---------------------------------------------------------------------------

test("[D65-168] every newly closed property rejects the value only the fallback had", { timeout: 300_000 }, async () => {
  // One Look per property: a rejected entry stops that block's checking, so
  // twenty-six entries in one block would report one of them.
  const blocks = closedProperties.map(([property, , wrong], index) => lookOf(`wrong${index}`, [[property, wrong]]));
  const directory = await webProject("velar-d65-168-reject-", `${blocks.join("\n")}
@main: mount(<div />, "#app")
`);
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  for (const [property, , wrong] of closedProperties) {
    assert.match(
      checked.output,
      new RegExp(`VEL5038: Look property '${property}' does not accept '${wrong}'`, "u"),
      checked.output,
    );
  }
});

// ---------------------------------------------------------------------------
// Rule 169 — the set holds the whole CSS value, and says what it cannot hold.
// ---------------------------------------------------------------------------

test("[D65-169] a multi-token CSS value is written the way CSS writes it", { timeout: 300_000 }, async () => {
  // `textDecoration` writes `textDecorationLine`, and `overscrollBehavior`
  // writes the two axes it shares this list with, so the whole-value probes
  // split across two Looks rather than measuring D104 rule 2's refusal.
  const directory = await webProject("velar-d65-169-multi-", `${lookOf("whole", [
    ["scrollSnapType", "both proximity"],
    ["scrollSnapAlign", "center start"],
    ["colorScheme", "only light"],
    ["gridAutoFlow", "dense column"],
    ["objectPosition", "bottom right"],
    ["textDecorationLine", "overline line-through"],
    ["textUnderlinePosition", "right under"],
    ["overscrollBehavior", "none contain"],
  ])}
${lookOf("wholeShorthands", [["textDecoration", "underline overline"]])}
@main: mount(<div look={whole} />, "#app")
`);
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
  // And the whole value reaches the declaration unsplit: one Look rule per
  // property, holding the value the author wrote.
  const emitted = compileCore(lookOf("whole", [["scrollSnapType", "both proximity"], ["gridAutoFlow", "dense column"]]), {
    extensions: [velarCompilerExtension],
  });
  assert.deepEqual(emitted.diagnostics, []);
  assert.match(emitted.code ?? "", /"base:scroll-snap-type": "both proximity"/u);
  assert.match(emitted.code ?? "", /"base:grid-auto-flow": "dense column"/u);
  assert.match(emitted.css ?? "", /scroll-snap-type:var\(--velar-look-base-scroll-snap-type\)/u);
});

test("[D65-169] a partly closable property names the value space it left out", { timeout: 300_000 }, async () => {
  const probes: readonly (readonly [string, string])[] = [
    // D67 rule 172 revoked `objectPosition`'s record when it became `metric`,
    // so this probe stands in its place among rule 169's own records.
    ["strokeLinejoin", "arcs"],
    ["contain", "layout paint"],
    ["backgroundBlendMode", "multiply, screen"],
    ["borderStyle", "solid dashed"],
    ["fontStretch", "80%"],
    ["fontVariant", "small-caps tabular-nums"],
    ["textDecoration", "underline wavy"],
    ["listStyle", "disc inside"],
    ["listStyleType", "greek-letters"],
  ];
  const directory = await webProject("velar-d65-169-partial-", `${probes
    .map(([property, value], index) => lookOf(`partial${index}`, [[property, value]]))
    .join("\n")}
mount(<div />, "#app")
`);
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  for (const [property] of probes) {
    const note = LOOK_PARTIAL_KEYWORD_PROPERTIES.get(property);
    assert.ok(note !== undefined, property);
    assert.ok(checked.output.includes(note), `${property}: ${checked.output}`);
  }
  // The boundary is named next to the escape that reaches past it, the same
  // pairing a wholly excluded property already gets.
  assert.match(checked.output, /import css unsafe/u);
});

// ---------------------------------------------------------------------------
// Rule 168, the spelling half — the closed set is the property's, not the
// literal's. Wave web, web-10.
// ---------------------------------------------------------------------------

test("[D65-168] a const design token and a record field meet the same closed set the literal meets", () => {
  for (const [property, right, wrong] of closedProperties) {
    for (const [label, spell] of lookValueSpellings) {
      assert.deepEqual(webMessages(spell(property, right)), [], `${property} / ${label}`);
      const reported = webMessages(spell(property, wrong));
      assert.ok(
        reported.some((message) => message.startsWith("VEL5038") && message.includes(`does not accept '${wrong}'`)),
        `${property} / ${label}: ${JSON.stringify(reported)}`,
      );
    }
  }
});

test("[D65-168] a misspelled design token gets the suggestion its literal gets", () => {
  const literal = webMessages(`
export const probe = look:
    display = "grdi"
`.trimStart());
  const token = webMessages(`
const layout = "grdi"
export const probe = look:
    display = layout
`.trimStart());
  assert.deepEqual(token, literal);
  assert.deepEqual(token, ["VEL5038 Look property 'display' does not accept 'grdi'; did you mean 'grid'?"]);
  // A token that folds to composed CSS text rather than to a keyword is not a
  // keyword and keeps its builder's own checks instead of this one.
  assert.deepEqual(webMessages(`
import {rgb} from "velar/look"
const brand = rgb(120, 150, 255)
export const probe = look:
    color = brand
`.trimStart()), []);
});
