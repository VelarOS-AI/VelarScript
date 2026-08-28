import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { applyProjectMechanicalFixes } from "../packages/cli/src/mechanical-fixer.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import { webModuleSources } from "../packages/web/src/runtime.ts";
import {
  LOOK_BUILDER_SIGNATURES,
  LOOK_PROPERTY_VALUE_KINDS,
  isLookTokenName,
  lookVarReferenceName,
  type LookPropertyValueKind,
} from "../packages/web/src/look.ts";

// ---------------------------------------------------------------------------
// D103 — Look's checked design-token references.
//
// The evidence is P1-2 of the shell-skeleton wave: a platform design system
// whose whole contract is CSS custom properties met a checked Look that could
// read one only through `color(string)`, which read nothing. Every metric
// property, `boxShadow` and `transition` refused with VEL5038 and named
// `import css unsafe` as the way out — so a product's shell chrome, and by the
// same reasoning its whole 70–90k-line visual layer, would live outside Look.
//
// The ruling adds one spelling, `token("--name")`, legal in every Look property
// kind. What is checked is the *reference*: a literal CSS custom property
// identifier, and nothing else in the call. The value behind the name belongs
// to the design system, which the compiler cannot see — the theme swaps it
// under the same name, which is the entire point of the contract.
//
// ── One finding this file pins that the ruling's premise had backwards ──────
//
// P1-2's side observation said `color("var(--x)")` "drops a foldable
// module-level Look into the runtime custom-property path". There is no path it
// could drop out of. Every checked Look property — a keyword, a unit literal, a
// builder result, a token reference alike — compiles to one static rule of the
// form `[data-velar-look~="token"]{property:var(--velar-look-token)}`, and the
// value reaches the element as that custom property. That indirection is the
// Look mechanism, not a fallback from a faster one: it is what lets one rule
// serve every element, `look={a ? b : c}` swap a whole value, and composition
// override per property. `staticLookMechanismIsUniform` below states it as an
// assertion so the claim cannot rot.
//
// What D103 rule 2 does deliver, and what is asserted here, is that a token
// reference is *compile-time text*: the call is folded to `"var(--name)"` while
// the module compiles, so the emitted module contains no call and the browser
// does no work for it. `keyframes:`, which really does concatenate stylesheet
// text, folds it into the `@keyframes` rule itself.
// ---------------------------------------------------------------------------

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

/** Compiles one Web module with the `velar/look` exports in scope, as the project driver resolves them. */
function compileWeb(text: string) {
  const imports = new Map<string, unknown>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      if (!imported) continue;
      const type = lookExports?.get(imported);
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text, {
    analysis: { imports: imports as never },
    extensions: [velarCompilerExtension],
  });
}

function messages(source: string): readonly string[] {
  return compileWeb(source).diagnostics.map((item) => `${item.code}: ${item.message}`);
}

function look(...entries: readonly string[]): string {
  return ["export const probe = look:", ...entries.map((entry) => `    ${entry}`), ""].join("\n");
}

const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

/** A real Web project on disk, so the CLI drives the same pipeline a product does. */
async function webProject(prefix: string, main: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
  await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(repositoryRoot, "packages", "web"), join(root, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D103 look tokens", base: "/" },
  })}\n`, "utf8");
  await writeFile(join(root, "main.vel"), main, "utf8");
  return root;
}

// ---------------------------------------------------------------------------
// Rule 1 — one spelling, legal in every Look property kind.
// ---------------------------------------------------------------------------

// The consumer's own refusal matrix, in the properties it wrote it with.
const SHELL_CHROME = look(
  'width = token("--shell-sidebar-expanded-width")',
  'borderRadius = token("--ui-radius-panel")',
  'boxShadow = token("--shell-sidebar-shadow")',
  'transition = token("--ui-transition-fast")',
  'color = token("--foreground")',
  'fontFamily = token("--ui-font-family")',
  'backdropFilter = token("--shell-sidebar-backdrop-filter")',
);
const SHELL_CHROME_MODULE = `import {token} from "velar/look"\n\n${SHELL_CHROME}`;

test("[D103-1] the whole P1-2 refusal matrix compiles, in one spelling", () => {
  assert.deepEqual(messages(SHELL_CHROME_MODULE), []);
});

test("[D103-1] every Look property value kind answers token() the same way, or says why it cannot", () => {
  // One property per kind, read out of the compiler's own table rather than
  // listed here, so a kind added later cannot slip past this invariant.
  const representative = new Map<LookPropertyValueKind, string>();
  for (const [property, kind] of LOOK_PROPERTY_VALUE_KINDS) {
    if (!representative.has(kind)) representative.set(kind, property);
  }
  const refused: string[] = [];
  for (const [kind, property] of representative) {
    const reported = messages(`import {token} from "velar/look"\n\n${look(`${property} = token("--probe")`)}`);
    if (reported.length > 0) refused.push(`${kind}/${property}: ${reported.join(" | ")}`);
  }
  // `animation` is the one property whose value names another rule rather than
  // describing one: Look generates `@keyframes` names from the `keyframes:`
  // value that defines the motion, so a shorthand arriving from outside this
  // compile names a rule the compile never emitted. It refuses by name and
  // teaches the two spellings that do work.
  assert.equal(refused.length, 1, `unexpected refusals:\n${refused.join("\n")}`);
  assert.match(refused[0]!, /^animation\/animation: VEL5038/u);
  assert.match(refused[0]!, /keyframes/u);
  assert.match(refused[0]!, /token\(\) is legal in every other Look property/u);
  assert.match(refused[0]!, /import css unsafe/u);
});

test("[D103-1] token() is a published builder, with the shape every other builder has", () => {
  const signature = LOOK_BUILDER_SIGNATURES.get("token");
  assert.deepEqual(signature, { parameters: ["name"], required: 1 });
  const exported = webModuleInterfaces.get("velar/look")?.exports.get("token");
  assert.ok(exported && exported.kind === "function");
  assert.deepEqual(exported.parameterNames, ["name"]);
  assert.equal(exported.requiredParameters, 1);
  assert.equal(exported.rest, undefined);
});

test("[D103-1] the named-argument spelling writes the same one argument", () => {
  assert.deepEqual(messages(`import {token} from "velar/look"\n\n${look('width = token(name="--w")')}`), []);
});

test("[D103-1] an aliased import is still the checked builder", () => {
  assert.deepEqual(messages(`import {token as ref} from "velar/look"\n\n${look('width = ref("--w")')}`), []);
  assert.deepEqual(
    messages(`import {token as ref} from "velar/look"\n\n${look('width = ref("w")')}`),
    ['VEL5042: Design token name \'w\' is not a CSS custom property identifier; a design token name is a literal string holding a CSS custom property identifier: \'--\' followed by one or more letters, digits, hyphens, or underscores'],
  );
});

// ---------------------------------------------------------------------------
// Rule 1 — the refusal matrix.
// ---------------------------------------------------------------------------

test("[D103-1] a name that is not a CSS custom property identifier is refused at the declaration", () => {
  const refusal = /VEL5042: Design token name '.*' is not a CSS custom property identifier; a design token name is a literal string/u;
  for (const written of ['"shell-width"', '"--"', '""', '"--a;b"', '"--a b"', '"--a)b"', '"var(--a)"', '"--å"']) {
    const reported = messages(`import {token} from "velar/look"\n\n${look(`width = token(${written})`)}`);
    assert.equal(reported.length, 1, `${written} reported ${reported.length}: ${reported.join(" | ")}`);
    assert.match(reported[0]!, refusal);
  }
});

test("[D103-1] a name written without its leading dashes is migrated, and a name with illegal characters is not", () => {
  const named = compileWeb(`import {token} from "velar/look"\n\n${look('width = token("shell-width")')}`).diagnostics[0];
  assert.deepEqual(named?.fix?.edits.map((edit) => edit.text), ['"--shell-width"']);
  const illegal = compileWeb(`import {token} from "velar/look"\n\n${look('width = token("--a;b")')}`).diagnostics[0];
  assert.equal(illegal?.fix, undefined);
});

test("[D103-1] a name the compile cannot read is refused, whatever produces it", () => {
  const refusal = /VEL5042: A design token reference names its custom property in the call/u;
  const dynamic = [
    ['const name = "--w"', 'width = token(name)'],
    ['const names = {sidebar: "--w"}', "width = token(names.sidebar)"],
    ['const stem = "sidebar"', 'width = token(f"--{stem}-width")'],
    ['const stem = "sidebar"', 'width = token("--" + stem)'],
    ["", "width = token(readName())"],
  ] as const;
  for (const [preamble, entry] of dynamic) {
    const source = [
      'import {token} from "velar/look"',
      "",
      'def readName() -> string: return "--w"',
      preamble,
      "",
      look(entry),
    ].join("\n");
    const reported = messages(source).filter((item) => item.startsWith("VEL5042"));
    assert.equal(reported.length, 1, `${entry} reported: ${reported.join(" | ")}`);
    assert.match(reported[0]!, refusal);
    assert.match(reported[0]!, /the name is the whole of what it can check/u);
  }
});

// ---------------------------------------------------------------------------
// Rule 5 — no fallback argument.
// ---------------------------------------------------------------------------

test("[D103-5] a second argument is refused, and the refusal gives the closed-contract reason", () => {
  const reported = messages(`import {token} from "velar/look"\n\n${look('width = token("--w", "10px")')}`);
  const rationale = reported.filter((item) => item.startsWith("VEL5042"));
  assert.equal(rationale.length, 1);
  assert.match(rationale[0]!, /takes the token name and nothing else/u);
  assert.match(rationale[0]!, /closed contract/u);
  assert.match(rationale[0]!, /defect to fix where the token is defined rather than a fallback decided again at every use site/u);
  // The published signature carries one parameter, so the arity is stated by
  // the type as it is for every other builder; the rule above is why.
  assert.ok(reported.some((item) => /Expected 1 argument but received 2/u.test(item)));
});

test("[D103-5] a var() reference carrying a CSS fallback has no migration, and says why", () => {
  const reported = compileWeb(`import {color} from "velar/look"\n\n${look('color = color("var(--fg, red)")')}`).diagnostics
    .filter((item) => item.code === "VEL5042");
  assert.equal(reported.length, 1);
  assert.match(reported[0]!.message, /it carries no fallback/u);
  assert.equal(reported[0]!.fix, undefined);
});

// ---------------------------------------------------------------------------
// Rule 2 — compile-time text, and the static sheet.
// ---------------------------------------------------------------------------

test("[D103-2] a module-level Look with token() lands in the emitted stylesheet, one rule per property", () => {
  const result = compileWeb(SHELL_CHROME_MODULE);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.css, [
    '[data-velar-look~="base:width"]{width:var(--velar-look-base-width)}',
    '[data-velar-look~="base:border-radius"]{border-radius:var(--velar-look-base-border-radius)}',
    '[data-velar-look~="base:box-shadow"]{box-shadow:var(--velar-look-base-box-shadow)}',
    '[data-velar-look~="base:transition"]{transition:var(--velar-look-base-transition)}',
    '[data-velar-look~="base:color"]{color:var(--velar-look-base-color)}',
    '[data-velar-look~="base:font-family"]{font-family:var(--velar-look-base-font-family)}',
    '[data-velar-look~="base:backdrop-filter"]{backdrop-filter:var(--velar-look-base-backdrop-filter)}',
  ].join("\n\n") + "\n");
});

test("[D103-2] the static Look mechanism is uniform: a token reference is emitted exactly as a keyword is", () => {
  // The claim P1-2 made — that the colour path "drops" a foldable module-level
  // Look into a runtime custom-property path — has no path to drop out of.
  // Three values of three different kinds produce byte-identical rules, and one
  // of them is the keyword spelling nothing has ever folded.
  const rule = (entry: string): string => {
    const result = compileWeb(`import {token} from "velar/look"\n\n${look(entry)}`);
    assert.deepEqual(result.diagnostics, []);
    return result.css ?? "";
  };
  const keyword = rule('display = "grid"').replace(/display|base:display/gu, "P");
  const unit = rule("width = 240px").replace(/width|base:width/gu, "P");
  const reference = rule('width = token("--w")').replace(/width|base:width/gu, "P");
  assert.equal(unit, keyword);
  assert.equal(reference, keyword);
});

test("[D103-2] the reference is folded while the module compiles, so no call survives into the output", () => {
  const result = compileWeb(SHELL_CHROME_MODULE);
  const emitted = result.code ?? "";
  const declaration = /export const probe = (.*)/u.exec(emitted)?.[1] ?? "";
  assert.ok(declaration.includes('"base:width": "var(--shell-sidebar-expanded-width)"'), declaration);
  assert.ok(declaration.includes('"base:box-shadow": "var(--shell-sidebar-shadow)"'), declaration);
  assert.ok(declaration.includes('"base:font-family": "var(--ui-font-family)"'), declaration);
  // Nothing is left to run: the module never names the builder it imported.
  assert.doesNotMatch(declaration, /\btoken\(/u);
});

test("[D103-2] a builder passed around as a value keeps its runtime implementation", () => {
  // The charter's promise about builders is that they are ordinary values. The
  // fold is stamped on a call the analyzer proved, so an aliased binding is not
  // folded away — it calls the module, which checks the same name.
  const result = compileWeb([
    'import {token} from "velar/look"',
    "",
    "const make = token",
    'export const width = make("--w")',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /export const width = make\("--w"\)/u);
});

test("[D103-2] the velar/look module checks the same name at run time", () => {
  const source = webModuleSources.get("velar/look");
  assert.ok(source);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const probe = [
    `import {token} from ${JSON.stringify(url)};`,
    'console.log(token("--ui-radius-panel"));',
    'for (const bad of ["radius", "--a;b", "", 4]) {',
    "  try { token(bad); console.log('accepted ' + String(bad)); }",
    "  catch (error) { console.log('refused ' + String(bad)); }",
    "}",
  ].join("\n");
  const run = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: probe });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split("\n"), [
    "var(--ui-radius-panel)",
    "refused radius",
    "refused --a;b",
    "refused ",
    "refused 4",
  ]);
});

test("[D103-2] a reactive Look context keeps its own mechanism, and a token in it is still compile-time text", () => {
  const result = compileWeb([
    'import {token} from "velar/look"',
    "",
    "component Panel:",
    "    state wide = false",
    '    return <div look:width={wide ? token("--wide") : token("--narrow")}></div>',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /wide\.get\(\) \? "var\(--wide\)" : "var\(--narrow\)"/u);
});

// ---------------------------------------------------------------------------
// keyframes: the one place a Look value really does become stylesheet text.
// ---------------------------------------------------------------------------

test("[D103-2] a keyframes stop lowers a token reference into the @keyframes rule itself", () => {
  const result = compileWeb([
    'import {token} from "velar/look"',
    "",
    "export const grow = keyframes:",
    "    from:",
    '        width = token("--shell-sidebar-collapsed-width")',
    '        color = token("--foreground")',
    "    to:",
    '        width = token("--shell-sidebar-expanded-width")',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.match(
    result.css ?? "",
    /@keyframes velar-kf-[0-9a-f]+\{from\{width:var\(--shell-sidebar-collapsed-width\);color:var\(--foreground\)\}to\{width:var\(--shell-sidebar-expanded-width\)\}\}/u,
  );
});

test("[D103-2] a keyframes stop refuses a token name the declaration check would refuse", () => {
  // `keyframes:` concatenates into compiler-owned stylesheet text, so its
  // lowering reads the written literal rather than any folded value — the same
  // discipline LOK-U9 applies to the rest of a stop.
  const reported = messages([
    'import {token} from "velar/look"',
    "",
    "export const grow = keyframes:",
    "    from:",
    '        width = token("--a;b")',
    "    to:",
    '        width = token("--w")',
    "",
  ].join("\n"));
  assert.ok(reported.some((item) => item.startsWith("VEL5042: Design token name")), reported.join("\n"));
  assert.ok(reported.some((item) => item.startsWith("VEL5060: A keyframe value must resolve to static CSS")), reported.join("\n"));
});

// ---------------------------------------------------------------------------
// Rule 3 — the checked boundary, and D37's tables untouched.
// ---------------------------------------------------------------------------

test("[D103-3] a non-token value keeps every check D37 gave it", () => {
  assert.deepEqual(messages(look('display = "gride"')), [
    "VEL5038: Look property 'display' does not accept 'gride'; did you mean 'grid'?",
  ]);
  assert.deepEqual(messages(look('strokeLinecap = "none"')), [
    "VEL5038: Look property 'strokeLinecap' does not accept 'none'; write one of butt, round, square, inherit, initial, revert, revert-layer, unset",
  ]);
  assert.deepEqual(messages(look("width = 100")), [
    "VEL5038: Look property 'width' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%",
  ]);
  assert.deepEqual(messages(look('width = "16px"')), [
    "VEL5038: Use the unit literal 16px; quoted unit values are not part of Look",
  ]);
});

test("[D103-3] the compiler checks the reference, never the value behind it", () => {
  // Two names no design system defines. Nothing here can be checked further,
  // and the ruling says so rather than pretending otherwise: the compiler never
  // reads a token stylesheet, so an undefined token is a defect in the design
  // system, found where that system is defined.
  assert.deepEqual(messages(`import {token} from "velar/look"\n\n${look(
    'width = token("--no-such-token")',
    'color = token("--also-missing")',
  )}`), []);
});

// ---------------------------------------------------------------------------
// Rule 4 — one spelling: the migration off `color("var(--x)")`.
// ---------------------------------------------------------------------------

test("[D103-4] color(\"var(--x)\") is refused and points at the checked spelling", () => {
  const reported = compileWeb(`import {color} from "velar/look"\n\n${look('color = color("var(--foreground)")')}`).diagnostics;
  assert.equal(reported.length, 1);
  assert.equal(reported[0]!.code, "VEL5042");
  assert.match(reported[0]!.message, /Write a design token reference as token\("--foreground"\)/u);
  assert.match(reported[0]!.message, /legal in every Look property, not only the colour ones/u);
});

test("[D103-4] the migration carries the import when the module has none, and honours an alias when it has one", () => {
  const fresh = compileWeb(`import {color} from "velar/look"\n\n${look('color = color("var(--fg)")')}`).diagnostics[0];
  assert.deepEqual(fresh?.fix?.edits.map((edit) => edit.text), [
    'import {color, token} from "velar/look"',
    'token("--fg")',
  ]);
  const aliased = compileWeb(`import {color, token as ref} from "velar/look"\n\n${look('color = color("var(--fg)")')}`).diagnostics[0];
  assert.deepEqual(aliased?.fix?.edits.map((edit) => edit.text), ['ref("--fg")']);
});

test("[D103-4] a color string that is not a var() reference keeps working exactly as it did", () => {
  assert.deepEqual(messages(`import {alpha, color} from "velar/look"\n\n${look(
    'color = color("#7c5cff")',
    'backgroundColor = color("rebeccapurple")',
    'borderColor = alpha(color("black"), 0.4)',
  )}`), []);
});

test("[D103-4] a checked kind that refused a var() reference now names the spelling that works", () => {
  const reported = compileWeb(look('width = "var(--shell-sidebar-expanded-width)"')).diagnostics;
  assert.equal(reported.length, 1);
  assert.equal(reported[0]!.code, "VEL5038");
  assert.match(reported[0]!.message, /write the design token reference as token\("--shell-sidebar-expanded-width"\)/u);
  // The refusal that used to send this author to `import css unsafe` now
  // rewrites to the checked spelling instead.
  assert.doesNotMatch(reported[0]!.message, /import css unsafe/u);
  assert.deepEqual(reported[0]!.fix?.edits.map((edit) => edit.text), [
    'import {token} from "velar/look"\n\n',
    'token("--shell-sidebar-expanded-width")',
  ]);
});

test("[D103-4] free text keeps accepting free text; only a whole reference is advised", () => {
  const advised = compileWeb(look('fontFamily = "var(--ui-font-family)"'));
  assert.deepEqual(advised.diagnostics, []);
  assert.deepEqual(advised.advisories.map((item) => item.code), ["A12"]);
  assert.match(advised.advisories[0]!.message, /accepts free text/u);
  assert.match(advised.advisories[0]!.message, /token\("--ui-font-family"\) is the checked spelling/u);

  // A var() inside a larger value has no single token to stand for it. A font
  // stack and a filter list are the two shapes that really do embed one.
  for (const entry of [
    'fontFamily = "var(--ui-font-family), system-ui, sans-serif"',
    'backdropFilter = "blur(4px) var(--shell-extra-filter)"',
    'transform = "translateX(var(--shell-offset))"',
  ]) {
    const quiet = compileWeb(look(entry));
    assert.deepEqual(quiet.diagnostics, []);
    assert.deepEqual(quiet.advisories, [], entry);
  }
});

test("[D103-4] the advisory never blocks a build, and can be answered in place", () => {
  const advised = compileWeb(look('fontFamily = "var(--ui-font-family)"'));
  assert.ok(advised.code);
  assert.deepEqual(advised.diagnostics, []);
  const suppressed = compileWeb(look(
    'fontFamily = "var(--ui-font-family)"   // velar-allow A12: the theme owns this stack wholesale',
  ));
  assert.deepEqual(suppressed.diagnostics, []);
  assert.deepEqual(suppressed.advisories, []);
});

test("[D103] a velar-allow inside a look: block is read, and a stale one is reported", () => {
  // A `look:` block is claimed whole by an extension scanner and lexed again by
  // the parser, and that second lexer's suppressions used to be dropped: a
  // reasoned `velar-allow` on a Look entry silenced nothing, and a stale one was
  // never reported — so it could rot in place, which is precisely what the
  // third suppression rule exists to prevent. A12 is the first advisory that can
  // land inside one of these blocks, so the promise had to become true.
  const stale = compileWeb(look('display = "grid"   // velar-allow A1: nothing here raises A1'));
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
  const reasoned = compileWeb(look('fontFamily = "var(--f)"   // velar-allow A12: the theme owns this stack wholesale'));
  assert.deepEqual(reasoned.diagnostics, []);
  assert.deepEqual(reasoned.advisories, []);
});

test("[D103] a style: compatibility override reads a token the same way a look: directive does", () => {
  const result = compileWeb([
    'import {token} from "velar/look"',
    "",
    "component A:",
    '    return <div style:width={token("--w")} style:color={token("--fg")}></div>',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories, []);
  assert.match(result.code ?? "", /"var\(--w\)"/u);
  const refused = compileWeb([
    "component A:",
    '    return <div style:width="var(--w)"></div>',
    "",
  ].join("\n")).diagnostics;
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0]!.fix?.edits.map((edit) => edit.text), [
    'import {token} from "velar/look"\n\n',
    'style:width={token("--w")}',
  ]);
});

test("[D103-4] a look: directive is rewritten as a directive, not spliced inside its quotes", () => {
  // The inline spelling is analyzed through a synthetic literal standing for
  // the whole attribute, so a rewrite of the value's span would replace the
  // attribute name too. A fix that produces a parse error is not a fix.
  const source = [
    'import {token} from "velar/look"',
    "",
    "component A:",
    '    return <div look:width={token("--w")} look:fontFamily="var(--f)"></div>',
    "",
  ].join("\n");
  const advisory = compileWeb(source).advisories[0];
  assert.equal(advisory?.code, "A12");
  const edits = advisory.fix?.edits ?? [];
  assert.deepEqual(edits.map((edit) => edit.text), ['look:fontFamily={token("--f")}']);
  const rewritten = `${source.slice(0, edits[0]!.span.start)}${edits[0]!.text}${source.slice(edits[0]!.span.end)}`;
  assert.deepEqual(compileWeb(rewritten).diagnostics, []);
  assert.deepEqual(compileWeb(rewritten).advisories, []);
});

test("[D103-4] velar fix migrates the refused literal form, byte for byte, and is idempotent", async () => {
  // The two refusals migrate; the free-text line does not. `velar fix` applies
  // the rewrites a *diagnostic* named, and an advisory never blocks a build —
  // its rewrite is offered where the author is reading, as a code action, and
  // answered or waived there. A12 keeps standing on the last line for exactly
  // that reason.
  const before = [
    'import {alpha, color} from "velar/look"',
    "",
    "export const chrome = look:",
    '    color = color("var(--foreground)")',
    '    backgroundColor = color("var(--surface)")',
    '    borderColor = alpha(color("black"), 0.4)',
    '    width = "var(--shell-sidebar-expanded-width)"',
    '    fontFamily = "var(--ui-font-family)"',
    "",
    '@main: mount(<div look={chrome} />, "#app")',
    "",
  ].join("\n");
  const after = [
    'import {alpha, color, token} from "velar/look"',
    "",
    "export const chrome = look:",
    '    color = token("--foreground")',
    '    backgroundColor = token("--surface")',
    '    borderColor = alpha(color("black"), 0.4)',
    '    width = token("--shell-sidebar-expanded-width")',
    '    fontFamily = "var(--ui-font-family)"',
    "",
    '@main: mount(<div look={chrome} />, "#app")',
    "",
  ].join("\n");
  const root = await webProject("velar-d103-fix", before);
  try {
    const config = await resolveVelarProject(root);
    const report = await applyProjectMechanicalFixes(config, null, (path) => path);
    assert.deepEqual(report.remainingDiagnostics, []);
    assert.deepEqual(report.writeFailures, []);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), after);

    // A second run finds nothing: `velar fix` is a fixed point, and one import
    // edit shared by two rewrites converges rather than being written twice.
    const second = await applyProjectMechanicalFixes(await resolveVelarProject(root), null, (path) => path);
    assert.deepEqual(second.changes, []);
    assert.deepEqual(second.changedFiles, []);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), after);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The surfaces around the spelling: formatter, editor, and the shared helpers.
// ---------------------------------------------------------------------------

test("[D103] the formatter round-trips a token reference and reaches a fixed point", () => {
  const source = [
    'import {token} from "velar/look"',
    "",
    "export const chrome = look:",
    '    width = token("--shell-sidebar-expanded-width")',
    '    boxShadow = token("--shell-sidebar-shadow")',
    "",
    "    if scheme.dark:",
    '        color = token("--foreground-dark")',
    "",
    "export const grow = keyframes:",
    "    from:",
    '        width = token("--a")',
    "    to:",
    '        width = token("--b")',
    "",
  ].join("\n");
  const once = formatSource(source, { extensions: [velarCompilerExtension] });
  assert.equal(once, source);
  assert.equal(formatSource(once, { extensions: [velarCompilerExtension] }), once);
  // Formatting is meaning-preserving, so the formatted source still compiles to
  // the same stylesheet the written source did.
  assert.equal(compileWeb(once).css, compileWeb(source).css);
});

test("[D103] the language server presents token the way it presents every other Look builder", async (context: TestContext) => {
  const source = [
    'import {color, token} from "velar/look"',
    "",
    "export const chrome = look:",
    '    color = color("#7c5cff")',
    '    width = token("--w")',
    "",
    '@main: mount(<div look={chrome} />, "#app")',
    "",
  ].join("\n");
  const root = await webProject("velar-d103-lsp", source);

  const child = spawn(process.execPath, [cliPath, "lsp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  context.after(async () => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  });
  let buffered = Buffer.alloc(0);
  const received: Array<Record<string, unknown>> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const size = Number(/Content-Length:\s*(\d+)/iu.exec(buffered.subarray(0, boundary).toString("ascii"))?.[1]);
      if (!Number.isFinite(size)) break;
      const end = boundary + 4 + size;
      if (buffered.length < end) break;
      received.push(JSON.parse(buffered.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      buffered = buffered.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const awaitReply = async (id: number): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const found = received.find((message) => message.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No language-server reply for request ${id}`);
  };
  const uri = `file://${join(root, "main.vel")}`;
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: `file://${root}`, capabilities: {} } });
  await awaitReply(1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "velar", version: 1, text: source } },
  });

  // Line 3 is `    color = color("#7c5cff")` and line 4 is `    width = token("--w")`;
  // both hovers land on the builder name in the value position.
  const hoverAt = async (id: number, line: number, character: number): Promise<string> => {
    send({ jsonrpc: "2.0", id, method: "textDocument/hover", params: { textDocument: { uri }, position: { line, character } } });
    const reply = await awaitReply(id);
    const result = reply.result as { contents?: { value?: string } } | null;
    return result?.contents?.value ?? "";
  };
  const colorHover = await hoverAt(2, 3, 14);
  const tokenHover = await hoverAt(3, 4, 14);
  assert.match(colorHover, /color/u);
  assert.ok(tokenHover.length > 0, "token has no hover where color has one");
  assert.match(tokenHover, /token/u);
  // The two are presented by the same machinery, so their hovers have the same
  // shape: a signature line naming the parameter the module interface declares.
  assert.match(tokenHover, /name/u);

  send({
    jsonrpc: "2.0",
    id: 4,
    method: "textDocument/completion",
    params: { textDocument: { uri }, position: { line: 4, character: 17 } },
  });
  const completion = await awaitReply(4);
  type CompletionItem = { readonly label: string };
  const result = completion.result as { items?: readonly CompletionItem[] } | readonly CompletionItem[] | null;
  const items: readonly CompletionItem[] = Array.isArray(result) ? result : (result as { items?: readonly CompletionItem[] } | null)?.items ?? [];
  const labels = new Set(items.map((item) => item.label));
  assert.ok(labels.has("token"), "the imported token builder is not offered where color is");
  assert.ok(labels.has("color"));
});

test("[D103] the token-name rule and the var() reader are one table, read by everything that needs them", () => {
  for (const name of ["--a", "--shell-sidebar-expanded-width", "--A_9", "----"]) assert.ok(isLookTokenName(name), name);
  for (const name of ["-a", "--", "a", "", "--a b", "--a;b", "--å", "var(--a)"]) assert.ok(!isLookTokenName(name), name);
  assert.equal(lookVarReferenceName("var(--a)"), "--a");
  assert.equal(lookVarReferenceName("  var( --a )  "), "--a");
  assert.equal(lookVarReferenceName("var(--a, red)"), null);
  assert.equal(lookVarReferenceName("1px var(--a)"), null);
  assert.equal(lookVarReferenceName("var(--a) var(--b)"), null);
});
