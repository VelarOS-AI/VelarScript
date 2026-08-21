import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// Wave "web-lexing", findings wl-1 and wl-2. A Look condition rewrites `@name`
// to `_name` so a state hook survives the ordinary expression parser, and the
// rewrite has to step over string literals so that ordinary text keeps its `@`.
// The hand-rolled skip knew only about `"` and `'`, so a backtick string —
// charter lines 398-403 make it the second of the two delimiters, and
// D46-BACKTICK-STRINGS item 6 makes it legal inside a Look — had its contents
// rewritten with no diagnostic at all.
//
//   wl-1  `` if tag == `x@y`: `` compiled to `tag === "x_y"`.
//   wl-2  the same defect reached through the formatter: a correct literal
//         containing `"` is re-spelled with backticks, which is canonical, and
//         the recompiled module then computed something else.
//
// Every case asserts zero diagnostics as well as the emitted text, because the
// whole class is wrong code that nothing reports.

function compile(source: string) {
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

/** The single emitted line carrying the Look's condition and its rules. */
function lookBody(code: string | undefined): string {
  const line = (code ?? "").split("\n").find((candidate) => candidate.includes("__velarLook([("));
  assert.ok(line, `no __velarLook call in\n${code}`);
  return line!.trim();
}

function compileCondition(condition: string) {
  const result = compile([
    "def make(tag: string) -> Look:",
    "    return look:",
    `        if ${condition}:`,
    '            color = "red"',
    "",
  ].join("\n"));
  return { diagnostics: result.diagnostics, body: result.code ? lookBody(result.code) : "" };
}

test("[wl-1] a backtick string in a Look condition keeps its `@`", () => {
  const result = compileCondition("tag == `x@y`");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.body.includes('tag === "x@y"'), result.body);
});

test("[wl-1] a scoped package name in a backtick string survives the hook rewrite", () => {
  const result = compileCondition("tag == `@velarscript/web`");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.body.includes('tag === "@velarscript/web"'), result.body);
});

test("[wl-1] the double-quoted twin still keeps its `@`", () => {
  const result = compileCondition('tag == "x@y"');
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.body.includes('tag === "x@y"'), result.body);
});

test("[wl-1] an escaped delimiter inside either string does not end it", () => {
  const backtick = compileCondition("tag == `a\\`b@c`");
  assert.deepEqual(backtick.diagnostics, []);
  assert.ok(backtick.body.includes('tag === "a`b@c"'), backtick.body);
  const double = compileCondition('tag == "a\\"b@c"');
  assert.deepEqual(double.diagnostics, []);
  assert.ok(double.body.includes('tag === "a\\"b@c"'), double.body);
});

test("[wl-1] one condition can carry an `@` inside a string and a hook outside it", () => {
  const result = compileCondition("tag == `x@y` and @hover");
  assert.deepEqual(result.diagnostics, []);
  // The literal is text and keeps its `@`; the bare `@hover` is still a state
  // hook and still lowers to a hover-scoped rule.
  assert.ok(result.body.includes('tag === "x@y"'), result.body);
  assert.ok(result.body.includes('"hover:color": "red"'), result.body);
});

test("[wl-1] prefixed strings keep their `@` through the delegated scan", () => {
  const interpolated = compileCondition('tag == f"{tag}@z"');
  assert.deepEqual(interpolated.diagnostics, []);
  assert.ok(interpolated.body.includes("@z"), interpolated.body);
  const raw = compileCondition('tag == r"x@y"');
  assert.deepEqual(raw.diagnostics, []);
  assert.ok(raw.body.includes('tag === "x@y"'), raw.body);
});

test("[wl-1] a single-quoted string still receives the VEL1005 teaching", () => {
  const result = compileCondition("tag == 'x@y'");
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["VEL1005"]);
  assert.equal(
    result.diagnostics[0]!.message,
    "Use double quotes or backticks for strings; single-quoted strings are not part of VelarScript",
  );
});

test("[wl-1] an unterminated string in a Look condition reports and terminates", () => {
  // Pins the `Math.max(literal.end, index + 1)` advance: an unclosed literal
  // must still move the cursor, or the rewrite loop never finishes.
  const result = compileCondition('tag == "abc');
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ["VEL1003"]);
});

test("[wl-2] formatting a Look condition does not change what the module computes", () => {
  const source = [
    "def make(label: string) -> Look:",
    "    return look:",
    '        if label == "he said \\"hi\\" @home":',
    '            color = "red"',
    "",
  ].join("\n");
  const first = compile(source);
  assert.deepEqual(first.diagnostics, []);
  assert.ok(lookBody(first.code ?? undefined).includes('label === "he said \\"hi\\" @home"'), lookBody(first.code ?? undefined));

  const formatted = formatSource(source, { extensions: [velarCompilerExtension] });
  // Asserted first so the round trip cannot pass vacuously: the canonical
  // spelling of a text containing `"` is the backtick form (D46), and it is
  // that re-spelling the round trip has to survive.
  assert.ok(formatted.includes("if label == `he said \"hi\" @home`:"), formatted);

  const second = compile(formatted);
  assert.deepEqual(second.diagnostics, []);
  assert.equal(second.code, first.code);
});

test("[wl-1] an 'else if' condition steps over its strings too", () => {
  // `parseIf` recurses for `else if`, so the branch reaches `parseLookCondition`
  // through a second call site; the fix has to hold on both.
  const result = compile([
    "def make(tag: string) -> Look:",
    "    return look:",
    "        if @hover:",
    '            color = "red"',
    "        else if tag == `p@q`:",
    '            color = "blue"',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.ok((result.code ?? "").includes('tag === "p@q"'), result.code ?? "");
});

test("[wl-1] two strings and a hook in one condition each keep their own text", () => {
  const result = compileCondition("tag == `a@b` and tag != \"c@d\" and @hover");
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.body.includes('tag === "a@b"'), result.body);
  assert.ok(result.body.includes('tag !== "c@d"'), result.body);
  assert.ok(result.body.includes('"hover:color": "red"'), result.body);
});

test("[wl-1] a string ending in an escaped backslash does not swallow the hook after it", () => {
  // The escape run has to end at the escaped backslash, or the scan reads on
  // past the closing delimiter and the following `@hover` stops being a hook.
  const result = compileCondition('tag == "a\\\\" and @hover');
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.body.includes('tag === "a\\\\"'), result.body);
  assert.ok(result.body.includes('"hover:color": "red"'), result.body);
});
