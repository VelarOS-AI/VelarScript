import assert from "node:assert/strict";
import test from "node:test";
import {
  advisory,
  applyMechanicalFixes,
  compile,
  formatSource,
  resolveAdvisorySuppressions,
  scanAdvisorySuppressions,
  SourceText,
  type Advisory,
} from "@velarscript/compiler";

function codes(source: string): string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

function scan(source: string): ReturnType<typeof scanAdvisorySuppressions> {
  const commentStart = source.indexOf("//");
  return scanAdvisorySuppressions(source, commentStart, commentStart + 2, source.length);
}

/** The suppression side without a producer: a hand-built advisory on one line. */
function resolve(source: string, advisories: readonly Advisory[]): ReturnType<typeof resolveAdvisorySuppressions> {
  return resolveAdvisorySuppressions(new SourceText("suppression.vel", source), advisories, scan(source).suppressions, { reportStale: true });
}

function advisoryOn(source: string, text: string, code = "A1"): Advisory {
  const start = source.indexOf(text);
  return advisory(code, "probe advisory", { start, end: start + text.length });
}

test("[D89] a reasoned suppression removes its advisory and leaves the build passing", () => {
  const source = "const step = total // 2   // velar-allow A1: 2 is a step number, not a divisor";
  const resolved = resolve(source, [advisoryOn(source, "total")]);
  assert.deepEqual(resolved.advisories, []);
  assert.deepEqual(resolved.diagnostics, []);

  const [suppression] = scan(source).suppressions;
  assert.equal(suppression?.code, "A1");
  assert.equal(suppression?.reason, "2 is a step number, not a divisor");
});

test("[D89] a suppression covers one advisory on one line and nothing else", () => {
  const source = [
    "const first = 1   // velar-allow A1: the reason",
    "const second = 2",
  ].join("\n");
  const other = resolve(source, [advisoryOn(source, "first"), advisoryOn(source, "second")]);
  assert.deepEqual(other.advisories.map((item) => item.span.start), [source.indexOf("second")]);

  const wrongCode = resolve(source, [advisoryOn(source, "first", "A2")]);
  assert.equal(wrongCode.advisories.length, 1, "A1 does not answer for A2");
  assert.deepEqual(wrongCode.diagnostics.map((item) => item.code), ["VEL1012"]);
});

test("[D89] the comment's own text stops at the suppression clause, so A1 can still read it", () => {
  const separate = "const step = total // 2   // velar-allow A1: a step number";
  assert.equal(separate.slice(separate.indexOf("//") + 2, scan(separate).contentEnd), " 2");

  const inline = "const step = total // 2 velar-allow A1: a step number";
  assert.equal(inline.slice(inline.indexOf("//") + 2, scan(inline).contentEnd), " 2");

  const plain = "const step = total // 2";
  assert.equal(plain.slice(plain.indexOf("//") + 2, scan(plain).contentEnd), " 2");
});

test("[D89] A5 walks the same three suppression states as the rest of the roster", () => {
  // Reasoned: the advisory is consumed and the build stays clean.
  const reasoned = compile('const s = "run ${HOME}/bin" // velar-allow A5: a shell template, so the text is the point\nprint(s)');
  assert.deepEqual(reasoned.advisories, []);
  assert.deepEqual(reasoned.diagnostics, []);

  // Unreasoned: VEL1011, and the advisory it tried to silence still stands.
  const unreasoned = compile('const s = "run ${HOME}/bin" // velar-allow A5\nprint(s)');
  assert.deepEqual(unreasoned.diagnostics.map((item) => item.code), ["VEL1011"]);
  assert.deepEqual(unreasoned.advisories.map((item) => item.code), ["A5"]);

  // Stale: no A5 fires on the line, so the suppression is VEL1012.
  const stale = compile('const s = "no template here" // velar-allow A5: claimed and false\nprint(s)');
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});

test("[D89] a suppression without a reason is a diagnostic, and it fails the build", () => {
  for (const tail of ["// velar-allow A1", "// velar-allow A1:", "// velar-allow A1:   "]) {
    const source = `const total = 10 ${tail}`;
    const result = compile(source);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1011"], tail);
    assert.match(result.diagnostics[0]!.message, /must give a reason/u);
    assert.equal(result.code, null, tail);
    assert.equal(result.diagnostics[0]!.fix, undefined, "the reason is the author's judgment, so no rewrite is offered");
  }
});

test("[D89] there is no blanket suppression, and only an advisory can be named", () => {
  for (const tail of ["// velar-allow", "// velar-allow: the reason", "// velar-allow VEL3001: a diagnostic is not an advisory"]) {
    const result = compile(`const total = 10 ${tail}`);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1011"], tail);
    assert.match(result.diagnostics[0]!.message, /no blanket form/u);
    assert.equal(result.code, null, tail);
  }
});

test("[D89] a stale suppression is a diagnostic that carries the rewrite deleting it", () => {
  const source = [
    "const total = 10",
    "const half = total / 2   // velar-allow A1: nothing reports A1 here",
    "print(half)",
  ].join("\n");
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1012"]);
  assert.match(result.diagnostics[0]!.message, /suppresses nothing; delete it/u);
  assert.equal(result.code, null);

  const fixed = applyMechanicalFixes(source, result.diagnostics);
  assert.equal(fixed.text, ["const total = 10", "const half = total / 2", "print(half)"].join("\n"));
  const recompiled = compile(fixed.text);
  assert.deepEqual(recompiled.diagnostics, []);
  assert.notEqual(recompiled.code, null);
});

test("[D89] deleting a stale suppression takes the line it owns and leaves the comment it rides on", () => {
  const alone = ["const total = 10", "    // velar-allow A1: stale and alone", "print(total)"].join("\n");
  assert.equal(applyMechanicalFixes(alone, compile(alone).diagnostics).text, ["const total = 10", "print(total)"].join("\n"));

  // The comment this one rides on has to be one A1 does not fire on, or the
  // suppression would be live rather than stale: `// 2` is exactly A1's shape.
  const riding = "const total = 10 // a plain note   // velar-allow A1: stale tail";
  assert.equal(applyMechanicalFixes(riding, compile(riding).diagnostics).text, "const total = 10 // a plain note");
  assert.deepEqual(compile("const total = 10 // a plain note").diagnostics, []);
});

test("[D89] staleness is only reported once the module otherwise compiles", () => {
  const source = "const half = missing   // velar-allow A1: the module fails before analysis answers";
  const reported = compile(source).diagnostics.map((item) => item.code);
  assert.ok(reported.includes("VEL3001"), reported.join(","));
  assert.ok(!reported.includes("VEL1012"), "a stopped compile does not get to call a suppression stale");
});

test("[D89] only a line comment carries a suppression", () => {
  assert.deepEqual(codes('const note = "// velar-allow A1"'), [], "a string is text, not a comment");
  assert.deepEqual(codes("const total = 10 /* velar-allow A1 */"), [], "a block comment is not the suppression spelling");
  assert.deepEqual(codes("const total = 10 // velar-allowed A1 by review"), [], "the marker is a whole word");
});

test("[D89] the formatter preserves a suppression comment and its reason verbatim", () => {
  const sources = [
    "const total = 10 // velar-allow A1: a reason with  internal  spacing\nprint(total)\n",
    "// velar-allow A1: a standalone reason\nconst total = 10\nprint(total)\n",
    "const step = total // 2   // velar-allow A1: 2 is a step number\n",
    "def wrap(total: number) -> number:\n    const half = total // velar-allow A1: an indented reason\n    return half\n",
  ];
  for (const source of sources) {
    assert.equal(formatSource(source), source, source);
    assert.equal(formatSource(formatSource(source)), source, source);
  }
});
