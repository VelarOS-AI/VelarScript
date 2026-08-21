import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { compile, inspectModule } from "../packages/compiler/src/index.ts";
import { compileProject } from "../packages/cli/src/project.ts";

after(removeTemporaryDirectories);

function checkedBlock(bodyLine: string): string {
  return [
    "const factor = 2",
    "",
    "extern js(factor: number)`",
    bodyLine,
    "    export function get() { return 1 }",
    "`:",
    "    export def get() -> number",
    "",
    "print(get())",
    "",
  ].join("\n");
}

function collisions(source: string): readonly string[] {
  return compile(source, { path: "main.vel" }).diagnostics
    .filter((item) => item.message.includes("conflicts with a top-level JavaScript binding"))
    .map((item) => `${item.code} ${item.message}`);
}

// A `var` is function-scoped, so wherever below the block's top level it is
// written it becomes module state once the checked body is wrapped in
// `function factory(capture) {…}` — and it silently swallowed the captured
// value while the collision guard saw only the immediate statements.
test("[D90] a capture collides with a 'var' hoisted out of any nested statement", () => {
  const hoisted: Record<string, string> = {
    block: "    { var factor = 99 }",
    if: "    if (true) { var factor = 99 }",
    else: "    if (false) {} else { var factor = 99 }",
    for: "    for (var factor = 99; false; ) {}",
    forOf: "    for (var factor of []) {}",
    forIn: "    for (var factor in {}) {}",
    while: "    while (false) { var factor = 1 }",
    try: "    try { var factor = 99 } catch { }",
    catch: "    try { } catch (error) { var factor = 99 }",
    finally: "    try { } finally { var factor = 99 }",
    switch: "    switch (1) { case 1: var factor = 99 }",
    label: "    outer: { var factor = 99 }",
    objectPattern: "    { var {factor, rest} = {factor: 1, rest: 2} }",
    arrayPattern: "    { var [factor] = [1] }",
  };
  for (const [shape, line] of Object.entries(hoisted)) {
    const reported = collisions(checkedBlock(line));
    assert.equal(reported.length, 1, `${shape}: ${JSON.stringify(reported)}`);
    assert.match(reported[0]!, /^VEL2037 Capture 'factor' conflicts with a top-level JavaScript binding of the same name/u);
  }

  // The top-level spelling is the one the guard already caught; it must not
  // start reporting twice now that the hoisted walk covers it as well.
  assert.equal(collisions(checkedBlock("    var factor = 99")).length, 1);

  // A `var` inside a nested function, arrow, or class static block opens its
  // own scope and is a genuine non-conflict, as are `let` and `const`.
  const separate: Record<string, string> = {
    function: "    function helper() { var factor = 99; return factor }",
    arrow: "    const helper = () => { var factor = 99; return factor }",
    staticBlock: "    class Holder { static { var factor = 99 } }",
    let: "    { let factor = 99 }",
    const: "    { const factor = 99 }",
  };
  for (const [shape, line] of Object.entries(separate)) {
    assert.deepEqual(compile(checkedBlock(line), { path: "main.vel" }).diagnostics.map((item) => item.message), [], shape);
  }
});

test("[D90] the capture the collision guard refuses reaches the JavaScript when it is accepted", () => {
  const accepted = compile(checkedBlock("    { var other = 99 }"), { path: "main.vel" });
  assert.deepEqual(accepted.diagnostics, []);
  assert.equal(accepted.embeddedModules.length, 1);
  assert.match(accepted.embeddedModules[0]!.code, /function __velarEmbeddedFactory_0\(factor\)/u);
});

const blockWithMissingPackage = [
  "unsafe js`",
  '    import {join} from "node:path"',
  '    import {missing} from "definitely-not-installed"',
  '    export function go() { return join("a", "b") + String(missing) }',
  "`",
  "",
  "print(go())",
  "",
].join("\n");

test("[D90] an inline block's own imports carry their specifier spans into the semantic index", () => {
  const inspected = inspectModule(blockWithMissingPackage, { path: "main.vel" });
  const reference = inspected.semanticIndex.moduleReferences.find((item) => item.source === "definitely-not-installed");
  assert.ok(reference, JSON.stringify(inspected.semanticIndex.moduleReferences));
  assert.equal(blockWithMissingPackage.slice(reference.span.start, reference.span.end), "definitely-not-installed");
  const builtin = inspected.semanticIndex.moduleReferences.find((item) => item.source === "node:path");
  assert.ok(builtin);
  assert.equal(blockWithMissingPackage.slice(builtin.span.start, builtin.span.end), "node:path");
});

test("[D90] an unresolvable package inside an inline block underlines the specifier, not the block header", async () => {
  const root = await makeTemporaryDirectory("velar-d90-embedded-resolution-");
  const entry = join(root, "main.vel");
  await writeFile(entry, blockWithMissingPackage, "utf8");
  const project = await compileProject(entry);
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(diagnostics.length, 1, JSON.stringify(diagnostics));
  const reported = diagnostics[0]!;
  assert.equal(reported.code, "VEL6006");
  assert.match(reported.message, /"definitely-not-installed" does not resolve to an installed package/u);
  assert.ok(reported.span.end > reported.span.start, JSON.stringify(reported.span));
  assert.equal(blockWithMissingPackage.slice(reported.span.start, reported.span.end), "definitely-not-installed");
});

test("[D90] a bare backtick line that ends a block early names the structural terminator", () => {
  const source = [
    "unsafe js`",
    "export const fence = `",
    "`",
    "export function x() { return fence }",
    "`",
    "",
    'print("after")',
    "",
  ].join("\n");
  const result = compile(source, { path: "main.vel" });
  const first = result.diagnostics[0]!;
  assert.equal(first.code, "VEL2037");
  assert.match(first.message, /^JavaScript syntax error: Unterminated template — a line holding nothing but a backtick at the declaration's indentation is this block's terminator/u);
  assert.match(first.message, /if this literal was meant to continue past such a line, the block ended there instead, so indent that backtick or write it at the end of a content line$/u);
  // The line the caret sits on is the block's own last line: the line that
  // actually closed the block is outside the payload this diagnostic is
  // derived from, so the message names the rule instead of pointing at it.
  assert.equal(source.slice(0, first.span.start).split("\n").length, 2);

  // A closing backtick that is not at the declaration's indentation is
  // ordinary source text, and the same block compiles clean.
  const indented = [
    "unsafe js`",
    "    export const fence = `",
    "    `",
    "    export function x() { return fence }",
    "`",
    "",
    'print(x())',
    "",
  ].join("\n");
  assert.deepEqual(compile(indented, { path: "main.vel" }).diagnostics, []);
});

// The eaten backtick may be the literal's *opening* one, and then the payload
// stops before the literal starts: Acorn has no unterminated construct to name
// and reports a bare "Unexpected token". Keying the hint off the message text
// alone therefore covered only half the defect. The hint is now offered when a
// template literal written where the payload stops would have completed it,
// which is exactly the question the author is asking.
test("[D90] a bare backtick line that ate a literal's opening backtick names the terminator too", () => {
  const rule = /if a template literal was meant to open on such a line, the block ended there instead, so indent that backtick or write it at the end of the line before it$/u;
  const messages = (lines: readonly string[]): readonly string[] =>
    compile(lines.join("\n"), { path: "main.vel" }).diagnostics.map((item) => `${item.code} ${item.message}`);

  const eatenOpening = messages(["unsafe js`", "export const t =", "`", "hello", "`", "export const q = 1", "`", "", 'print("after")', ""]);
  assert.match(eatenOpening[0]!, /^VEL2037 JavaScript syntax error: Unexpected token — a line holding nothing but a backtick at the declaration's indentation is this block's terminator/u);
  assert.match(eatenOpening[0]!, rule);

  // Both remedies the hint names produce a clean compile.
  assert.deepEqual(messages(["unsafe js`", "export const t =", "    `", "hello", "    `", "export const q = 1", "`", "", 'print("after")', ""]), []);
  assert.deepEqual(messages(["unsafe js`", "export const t = `", "hello`", "export const q = 1", "`", "", 'print("after")', ""]), []);

  // A truncation no template could have completed keeps its bare message: the
  // terminator removes whole lines, so it is not a plausible cause of a missing
  // brace, a missing parenthesis, a dangling member access, or an open call.
  const unexplained: Record<string, string> = {
    brace: "    export function f() {",
    paren: "    export function f( {",
    member: "    export const t = obj.",
    call: "    export const t = f(",
  };
  for (const [shape, line] of Object.entries(unexplained)) {
    const reported = messages(["unsafe js`", line, "`", "", 'print("x")', ""]);
    assert.equal(reported.length, 1, `${shape}: ${JSON.stringify(reported)}`);
    assert.equal(reported[0], "VEL2037 JavaScript syntax error: Unexpected token", shape);
  }
});

test("[D90] an ordinary JavaScript syntax error keeps its unadorned message", () => {
  const source = [
    "unsafe js`",
    "    export function broken(@) {}",
    "`",
    "",
  ].join("\n");
  const first = compile(source, { path: "main.vel" }).diagnostics[0]!;
  assert.equal(first.code, "VEL2037");
  assert.match(first.message, /^JavaScript syntax error: Unexpected character/u);
  assert.doesNotMatch(first.message, /declaration's indentation/u);
});

// The hint names a rule the author may not know, but nothing reaching it can
// tell which mistake produced the truncated payload, so it must not assert one.
// Its first wording claimed "this block ends at the first line holding nothing
// but a backtick" and told the author to indent that backtick: false whenever
// no such line exists, and the exact opposite of the VEL1003 an unterminated
// block already reports, which correctly asks for a backtick alone at that
// indentation. A conditional is true in every shape below.
test("[D90] the structural terminator hint never asserts a backtick line that is not there", () => {
  const rule = /a line holding nothing but a backtick at the declaration's indentation is this block's terminator/u;
  const messages = (lines: readonly string[]): readonly string[] =>
    compile(lines.join("\n"), { path: "main.vel" }).diagnostics.map((item) => `${item.code} ${item.message}`);

  // A literal the author simply never closed, inside a block that closed
  // perfectly. There is no lone-backtick line anywhere in this module.
  const unclosedLiteral = messages(["unsafe js`", "    export const s = `abc", "`", "", "print(s)", ""]);
  assert.equal(unclosedLiteral.length, 1, JSON.stringify(unclosedLiteral));
  assert.match(unclosedLiteral[0]!, /^VEL2037 JavaScript syntax error: Unterminated template/u);
  assert.match(unclosedLiteral[0]!, rule);
  assert.doesNotMatch(unclosedLiteral[0]!, /this block ends at/u);

  const unclosedComment = messages(["unsafe js`", "    /* open comment", "`", "", 'print("x")', ""]);
  assert.equal(unclosedComment.length, 1, JSON.stringify(unclosedComment));
  assert.match(unclosedComment[0]!, /^VEL2037 JavaScript syntax error: Unterminated comment/u);
  assert.doesNotMatch(unclosedComment[0]!, /this block ends at/u);

  // A block that never closed at all: an `unsafe` block mistakenly given the
  // checked block's `:` tail. VEL1003 already states the correct remedy, and
  // the hint alongside it must agree with that remedy rather than contradict it.
  const neverClosed = messages(["unsafe js`", "    export function j() { return 1 }", "`:", "", "print(j())", ""]);
  const unterminated = neverClosed.find((item) => item.startsWith("VEL1003"));
  assert.ok(unterminated, JSON.stringify(neverClosed));
  assert.match(unterminated, /close it with '`' alone at the declaration's indentation/u);
  const hinted = neverClosed.find((item) => item.includes("Unterminated template"));
  assert.ok(hinted, JSON.stringify(neverClosed));
  assert.match(hinted, rule);
  assert.doesNotMatch(hinted, /this block ends at/u);

  // An unterminated string constant stays unadorned: a JavaScript string
  // cannot hold a raw line break, so the terminator cannot have caused it.
  const stringConstant = messages(["unsafe js`", '    export const s = "abc', "`", "", "print(s)", ""]);
  assert.match(stringConstant[0]!, /^VEL2037 JavaScript syntax error: Unterminated string constant$/u);
});

/**
 * A project rooted at `main.vel`, carrying one genuinely installed JavaScript
 * package so a block's resolvable import is exercised against real resolution
 * rather than against a builtin that resolution skips.
 */
async function stagedProject(files: Readonly<Record<string, string>>): Promise<{
  readonly modules: readonly string[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly span: { readonly start: number; readonly end: number } }[];
  readonly failures: readonly string[];
}> {
  const root = await makeTemporaryDirectory("velar-d90-embedded-graph-");
  await mkdir(join(root, "node_modules", "real-lib"), { recursive: true });
  await writeFile(
    join(root, "node_modules", "real-lib", "package.json"),
    JSON.stringify({ name: "real-lib", version: "1.0.0", type: "module", main: "index.mjs" }),
    "utf8",
  );
  await writeFile(join(root, "node_modules", "real-lib", "index.mjs"), 'export const tag = "real";\n', "utf8");
  for (const [name, text] of Object.entries(files)) await writeFile(join(root, name), text, "utf8");
  const project = await compileProject(join(root, "main.vel"));
  return {
    modules: project.modules.map((module) => module.relativePath),
    diagnostics: project.modules.flatMap((module) => module.result.diagnostics),
    failures: project.failures.map((failure) => failure.message),
  };
}

const entryImportingHelper = ['import {label} from "./helper.vel"', "", 'print(label("x", "y"))', ""].join("\n");

/**
 * The specifier spans that make VEL6006 land on the offending import come from
 * synthetic `ImportDeclaration`s injected into the program semantic analysis
 * sees. That program also feeds the module interface and the semantic index,
 * so the risk this pins is that a block's package imports become dependencies
 * of the enclosing `.vel` module and perturb the project graph.
 *
 * They cannot. `inspectModule` derives `dependencies` from the *original*
 * program, and the project's walk consumes exactly that list, so the synthetic
 * imports are visible only to the semantic index they exist for.
 */
test("[D90] a block's synthetic dependency imports stay out of the project module graph", async () => {
  const withBlock = await stagedProject({
    "main.vel": entryImportingHelper,
    "helper.vel": [
      "unsafe js`",
      '    import { join } from "node:path"',
      '    import { tag } from "real-lib"',
      "    export function decorate(a, b) { return join(a, b) + tag }",
      "`",
      "",
      "export def label(a: string, b: string) -> string:",
      "    return decorate(a, b)",
      "",
    ].join("\n"),
  });
  const withoutBlock = await stagedProject({
    "main.vel": entryImportingHelper,
    "helper.vel": ["export def label(a: string, b: string) -> string:", '    return a + "/" + b', ""].join("\n"),
  });

  // (a) The graph gains no node and no edge: the same modules in the same
  // dependency-first order, and a block importing a real package links clean.
  assert.deepEqual(withBlock.modules, withoutBlock.modules);
  assert.deepEqual(withBlock.modules, ["helper.vel", "main.vel"]);
  assert.deepEqual(withBlock.diagnostics, []);
  assert.deepEqual(withBlock.failures, []);

  // (b) The block's own imports reach the sibling module and nothing else: the
  // enclosing module must not gain a side-effect import of the block's package.
  const compiled = compile(
    ["unsafe js`", '    import { tag } from "real-lib"', "    export function go() { return tag }", "`", "", "print(go())", ""].join("\n"),
    { path: "main.vel" },
  );
  assert.deepEqual(compiled.diagnostics, []);
  assert.match(compiled.embeddedModules[0]!.code, /import \{ tag \} from "real-lib"/u);
  const emittedImports = (compiled.code ?? "").split("\n").filter((line) => line.startsWith("import "));
  assert.deepEqual(emittedImports, ['import { go } from "./main.1t30hzc.embedded-1.js";']);
});

test("[D90] a block cannot name a VelarScript module, so it can forge no cycle", async () => {
  // A relative target is refused outright by the D53 emission rule, so the
  // shape that could name a sibling `.vel` file never reaches resolution.
  const relative = await stagedProject({
    "main.vel": ["unsafe js`", '    import { z } from "./helper.vel"', "    export function go() { return z }", "`", "", "print(go())", ""].join("\n"),
    "helper.vel": ["export def label() -> string:", '    return "x"', ""].join("\n"),
  });
  assert.deepEqual(relative.modules, ["main.vel"]);
  assert.equal(relative.diagnostics.length, 1, JSON.stringify(relative.diagnostics));
  assert.equal(relative.diagnostics[0]!.code, "VEL2037");
  assert.match(relative.diagnostics[0]!.message, /Relative JavaScript import target '\.\/helper\.vel' cannot be emitted from an inline block/u);

  // A bare specifier that merely ends in `.vel` is a JavaScript package name
  // here, because every dependency a block contributes is `javascript: true`.
  // It is judged as one and enqueues no module, so `helper.vel` never joins
  // the graph twice and no initialization cycle can be manufactured.
  const bare = await stagedProject({
    "main.vel": ["unsafe js`", '    import { z } from "helper.vel"', "    export function go() { return z }", "`", "", "print(go())", ""].join("\n"),
    "helper.vel": ["export def label() -> string:", '    return "x"', ""].join("\n"),
  });
  assert.deepEqual(bare.modules, ["main.vel"]);
  assert.equal(bare.diagnostics.length, 1, JSON.stringify(bare.diagnostics));
  assert.equal(bare.diagnostics[0]!.code, "VEL6006");
});

test("[D90] one unresolvable package in a block reports exactly one VEL6006", async () => {
  const source = [
    "unsafe js`",
    '    import { m } from "definitely-not-installed"',
    '    import { n } from "definitely-not-installed"',
    "    export function go() { return m + n }",
    "`",
    "",
    "print(go())",
    "",
  ].join("\n");
  // The same missing package named twice in one block is still one verdict,
  // not one per synthetic import: the specifier is judged per importer.
  const twice = await stagedProject({ "main.vel": source });
  assert.equal(twice.diagnostics.length, 1, JSON.stringify(twice.diagnostics));
  assert.equal(twice.diagnostics[0]!.code, "VEL6006");
  const { span } = twice.diagnostics[0]!;
  assert.equal(source.slice(span.start, span.end), "definitely-not-installed");
});
