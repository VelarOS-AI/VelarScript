import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

function compile(source: string) {
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

// Wave "web-lexing", finding wl-3. `look:` and `keyframes:` are contextual
// words, and the lexer decided a Look block opened from the word, the colon and
// the indented body alone. It never looked at the token before the word, so
// every statement header that ends in a member access named `look` or
// `keyframes` — `case Mode.look:`, `if m == Mode.keyframes:` — was swallowed as
// the opening of a visual block and the module failed with VEL2002, or worse,
// compiled to something else. The opener now demands a value-start position,
// the same list charter §14 publishes for JSX, so the whole family of member
// spellings is refused by construction rather than one at a time.

const ENUM = [
  "enum Mode:",
  "    look",
  "    keyframes",
  "    peek",
  "",
].join("\n");

/**
 * A module that mentions no Look and no Keyframes must mean exactly what Core
 * says it means: Core has no visual-block concept, so any divergence in the
 * emitted JavaScript is the defect itself.
 */
function assertMemberAccess(source: string, member: string): void {
  const web = compile(source);
  const core = compileCore(source);
  assert.deepEqual(web.diagnostics, []);
  assert.deepEqual(core.diagnostics, []);
  assert.equal(web.code, core.code);
  assert.match(web.code ?? "", new RegExp(`Mode\\.${member}\\b`, "u"));
  assert.doesNotMatch(web.code ?? "", /__velarLook\(/u);
  assert.equal(web.css ?? "", "");
}

test("[wl-3] a match case on an enum member named look is a member access", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode) -> number:",
    "    match m:",
    "        case Mode.look:",
    "            return 1",
    "        case Mode.keyframes:",
    "            return 2",
    "        case Mode.peek:",
    "            return 3",
    "",
  ].join("\n")}`, "look");
});

test("[wl-3] a match case on an enum member named keyframes is a member access", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode) -> number:",
    "    match m:",
    "        case Mode.keyframes:",
    "            return 1",
    "        case Mode.look:",
    "            return 2",
    "        case Mode.peek:",
    "            return 3",
    "",
  ].join("\n")}`, "keyframes");
});

test("[wl-3] an if header ending in .look is a member access", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode) -> number:",
    "    if m == Mode.look:",
    "        return 1",
    "    return 2",
    "",
  ].join("\n")}`, "look");
});

test("[wl-3] an else-if header ending in .look is a member access", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode) -> number:",
    "    if m == Mode.peek:",
    "        return 0",
    "    else if m == Mode.look:",
    "        return 1",
    "    return 2",
    "",
  ].join("\n")}`, "look");
});

test("[wl-3] a while header ending in .look is a member access", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode) -> number:",
    "    while m == Mode.look:",
    "        return 1",
    "    return 2",
    "",
  ].join("\n")}`, "look");
});

test("[wl-3] an if header ending in .keyframes is a member access", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode) -> number:",
    "    if m == Mode.keyframes:",
    "        return 1",
    "    return 2",
    "",
  ].join("\n")}`, "keyframes");
});

test("[wl-3] a default parameter naming the member keeps compiling", () => {
  assertMemberAccess(`${ENUM}${[
    "def go(m: Mode = Mode.look) -> number:",
    "    return 1",
    "",
  ].join("\n")}`, "look");
});

test("[wl-3] record keys, reads, writes and nested reads named look are ordinary", () => {
  const source = [
    "const r = {look: 1}",
    "const k = {keyframes: 1}",
    "let b = {look: 1}",
    "b.look = 2",
    "const nested = {b: {look: 3}}",
    "const total = r.look + k.keyframes + b.look + nested.b.look",
    "",
  ].join("\n");
  const web = compile(source);
  const core = compileCore(source);
  assert.deepEqual(web.diagnostics, []);
  assert.deepEqual(core.diagnostics, []);
  assert.equal(web.code, core.code);
  assert.equal(web.css ?? "", "");
});

test("[wl-3] a Look block still opens after '=', after 'return' and behind an annotation", () => {
  const assigned = compile([
    "export const base = look:",
    "    if @hover:",
    '        color = "red"',
    "",
  ].join("\n"));
  assert.deepEqual(assigned.diagnostics, []);
  assert.match(assigned.css ?? "", /hover:color/u);

  const annotated = compile([
    "export const x: Look = look:",
    '    color = "red"',
    "",
  ].join("\n"));
  assert.deepEqual(annotated.diagnostics, []);
  assert.match(annotated.css ?? "", /base:color/u);

  const returned = compile([
    "def make() -> Look:",
    "    return look:",
    '        color = "red"',
    "",
  ].join("\n"));
  assert.deepEqual(returned.diagnostics, []);
  assert.match(returned.code ?? "", /__velarLook\(/u);
});

test("[wl-3] a Keyframes block still opens after '='", () => {
  const result = compile([
    "export const spin = keyframes:",
    "    from:",
    '        transform = "rotate(0deg)"',
    "    to:",
    '        transform = "rotate(360deg)"',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /@keyframes velar-kf-/u);
});

test("[wl-3] a Look block whose first line is a comment or a blank line still opens", () => {
  const commented = compile([
    "export const base = look:",
    "    // the first line inside the block carries no token of its own",
    "    if @hover:",
    '        color = "red"',
    "",
  ].join("\n"));
  assert.deepEqual(commented.diagnostics, []);
  assert.match(commented.css ?? "", /hover:color/u);

  const spaced = compile([
    "export const base = look:",
    "",
    "    if @hover:",
    '        color = "red"',
    "",
  ].join("\n"));
  assert.deepEqual(spaced.diagnostics, []);
  assert.equal(spaced.css, commented.css);
});

test("[wl-3] formatting a module holding both spellings does not move the decision", () => {
  const source = `${ENUM}${[
    "def go(m: Mode) -> number:",
    "    match m:",
    "        case Mode.look:",
    "            return 1",
    "        case Mode.keyframes:",
    "            return 2",
    "        case Mode.peek:",
    "            return 3",
    "",
    "export const base = look:",
    "    if @hover:",
    '        color = "red"',
    "",
  ].join("\n")}`;
  const before = compile(source);
  assert.deepEqual(before.diagnostics, []);

  const formatted = formatSource(source, { extensions: [velarCompilerExtension] });
  const after = compile(formatted);
  assert.deepEqual(after.diagnostics, []);
  assert.equal(after.css, before.css);
  assert.equal(formatSource(formatted, { extensions: [velarCompilerExtension] }), formatted);
});

// Repair packet "web-visual-block-position". Reusing the JSX list gave the Look
// opener the one hole that list already had: `dedent` was missing from it. The
// kind before a line's first token is whichever of `newline`, `indent` and
// `dedent` the indentation produced — Core's own line-boundary set — and only
// two of the three were listed, so a construct opening a line at a lower
// indentation than the line above it was judged not to be at a value start. It
// then unravelled into a six-diagnostic parse cascade in place of the one
// directed message the identical construct earns one line below a statement,
// which is the untargeted cascade this list exists to prevent. The third kind
// completes the family: the position now reads the same at every indentation.

/** The single directed message a discarded expression earns, at any indentation. */
const DISCARDED = "This expression result is discarded; call a function, assign the value, or use the result";

function codes(source: string): readonly string[] {
  return compile(source).diagnostics.map((entry) => entry.code);
}

const AFTER_BODY = ["def first() -> number:", "    return 1", "", ""].join("\n");

test("[wl-3] a Look block below a def body opens exactly as it does at the module head", () => {
  const block = [
    "export const base = look:",
    "    if @hover:",
    '        color = "red"',
    "",
  ].join("\n");
  const head = compile(block);
  const dedented = compile(`${AFTER_BODY}${block}`);
  assert.deepEqual(head.diagnostics, []);
  assert.deepEqual(dedented.diagnostics, []);
  assert.equal(dedented.css, head.css);
  assert.match(dedented.css ?? "", /hover:color/u);
});

test("[wl-3] a Keyframes block below a def body opens exactly as it does at the module head", () => {
  const block = [
    "export const spin = keyframes:",
    "    from:",
    '        transform = "rotate(0deg)"',
    "    to:",
    '        transform = "rotate(360deg)"',
    "",
  ].join("\n");
  const head = compile(block);
  const dedented = compile(`${AFTER_BODY}${block}`);
  assert.deepEqual(head.diagnostics, []);
  assert.deepEqual(dedented.diagnostics, []);
  assert.equal(dedented.css, head.css);
  assert.match(dedented.css ?? "", /@keyframes velar-kf-/u);
});

test("[wl-3] a bare visual block is one directed message after a dedent, not a parse cascade", () => {
  for (const block of [
    ['look:', '    color = "red"', ""].join("\n"),
    ["keyframes:", "    from:", '        transform = "rotate(0deg)"', ""].join("\n"),
  ]) {
    const dedented = compile(`${AFTER_BODY}${block}`);
    assert.deepEqual(dedented.diagnostics.map((entry) => entry.code), ["VEL4030"]);
    assert.equal(dedented.diagnostics[0]?.message, DISCARDED);
    // The same block one line below an ordinary statement, where the previous
    // token is a `newline`, has always said exactly this and nothing more.
    assert.deepEqual(compile(`const q = 1\n${block}`).diagnostics.map((entry) => entry.code), ["VEL4030"]);
  }
});

test("[wl-3] a statement-position JSX element is one directed message after a dedent too", () => {
  const dedented = compile(`${AFTER_BODY}<div />\n`);
  assert.deepEqual(dedented.diagnostics.map((entry) => entry.code), ["VEL4030"]);
  assert.equal(dedented.diagnostics[0]?.message, DISCARDED);
});

test("[wl-3] a member access named look stays one after a dedent", () => {
  assertMemberAccess(`${ENUM}${AFTER_BODY}${[
    "def go(m: Mode) -> number:",
    "    match m:",
    "        case Mode.look:",
    "            return 1",
    "        case Mode.keyframes:",
    "            return 2",
    "        case Mode.peek:",
    "            return 3",
    "",
  ].join("\n")}`, "look");
});

test("[wl-3] '<' after a dedent is still the less-than operator", () => {
  const source = `${AFTER_BODY}const small = first() < 3\n`;
  const web = compile(source);
  assert.deepEqual(web.diagnostics, []);
  assert.equal(web.code, compileCore(source).code);
});

test("[wl-3] the 'look Name:' teaching path reads the same at every indentation", () => {
  const named = ["look Card:", '    color = "red"', ""].join("\n");
  assert.deepEqual(codes(named), codes(`${AFTER_BODY}${named}`));
  assert.deepEqual(codes(named), ["VEL5038"]);
  assert.match(compile(named).diagnostics[0]?.message ?? "", /const Card = look:/u);
});
