import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import {
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

const root = resolve(new URL("..", import.meta.url).pathname);
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
  // empty, and the count only ever grows with the published vocabulary.
  const keywordProperties = [...LOOK_PROPERTY_VALUE_KINDS].filter(([, kind]) => kind === "keyword");
  assert.ok(keywordProperties.length >= 78, String(keywordProperties.length));
});

test("[D65-168] the table refuses to load when a keyword property has no closed set", async () => {
  const directory = await makeTemporaryDirectory("velar-d65-168-invariant-");
  const source = await readFile(lookTable, "utf8");
  // The whole table is loaded once as a control, so a throw below cannot be a
  // copy that failed to load for some unrelated reason.
  const control = join(directory, "control.mts");
  await writeFile(control, source, "utf8");
  const loaded = await import(control) as { readonly LOOK_PROPERTY_KEYWORDS: ReadonlyMap<string, ReadonlySet<string>> };
  assert.ok(loaded.LOOK_PROPERTY_KEYWORDS.get("strokeLinecap")?.has("butt"));

  const removed = source.replace(/^ {2}\["strokeLinecap".*\n/mu, "");
  assert.notEqual(removed, source);
  const broken = join(directory, "broken.mts");
  await writeFile(broken, removed, "utf8");
  await assert.rejects(
    () => import(broken),
    /Look property 'strokeLinecap' is a keyword property with no closed keyword set/u,
  );
});

test("[D65-169] a recorded partial exclusion names a property that publishes a set", () => {
  for (const [property, note] of LOOK_PARTIAL_KEYWORD_PROPERTIES) {
    assert.ok(LOOK_PROPERTY_KEYWORDS.has(property), property);
    assert.equal(LOOK_PROPERTY_VALUE_KINDS.get(property), "keyword", property);
    assert.ok(note.length > 0, property);
  }
  assert.ok(LOOK_PARTIAL_KEYWORD_PROPERTIES.size >= 9, String(LOOK_PARTIAL_KEYWORD_PROPERTIES.size));
});

// ---------------------------------------------------------------------------
// Rule 168 side A — a published property can hold the values it really has.
// ---------------------------------------------------------------------------

test("[D65-168] every newly closed property accepts a value its CSS grammar has", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d65-168-accept-", `${lookOf("reachable", closedProperties.map(([property, right]) => [property, right]))}
mount(<div look={reachable} />, "#app")
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
mount(<div />, "#app")
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
  const directory = await webProject("velar-d65-169-multi-", `${lookOf("whole", [
    ["scrollSnapType", "both proximity"],
    ["scrollSnapAlign", "center start"],
    ["colorScheme", "only light"],
    ["gridAutoFlow", "dense column"],
    ["objectPosition", "bottom right"],
    ["textDecorationLine", "overline line-through"],
    ["textDecoration", "underline overline"],
    ["textUnderlinePosition", "right under"],
    ["overscrollBehavior", "none contain"],
  ])}
mount(<div look={whole} />, "#app")
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
    ["objectPosition", "12px"],
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
