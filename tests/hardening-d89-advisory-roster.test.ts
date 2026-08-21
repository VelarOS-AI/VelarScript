import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMechanicalFixes,
  compile,
  formatAdvisory,
  SourceText,
  type CompileResult,
} from "@velarscript/compiler";

/**
 * D89's first roster. Every case here compiles — that is the premise of the
 * tier: these are spellings VelarScript accepts and runs, with a meaning the
 * Python or JavaScript reflex behind them did not intend. So each fixture
 * asserts an empty diagnostic channel and emitted code as well as the advisory,
 * and the non-firing half of each rule is a hard requirement, not a courtesy.
 */
function compiled(source: string): CompileResult {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => item.code), [], source);
  assert.notEqual(result.code, null, "an advisory never blocks code generation");
  return result;
}

function codes(source: string): string[] {
  return compiled(source).advisories.map((item) => item.code);
}

function message(source: string): string {
  const [advisory] = compiled(source).advisories;
  assert.ok(advisory, source);
  return advisory.message;
}

test("[D89] A1 reports a comment that is only a divisor and names the floor-division spelling", () => {
  const source = ["const total = 10", "const half = total // 2", "print(half)"].join("\n");
  assert.deepEqual(codes(source), ["A1"]);
  const reported = message(source);
  assert.match(reported, /'half' receives 'total'/u);
  assert.match(reported, /\(total \/ 2\)\.floor\(\)/u);
});

test("[D89] A1 stays silent on every comment that is not a bare divisor", () => {
  const silent: readonly (readonly [string, string])[] = [
    ["a comment with letters in it", "const total = 10\nconst half = total // 2. then handle X\nprint(half)"],
    ["a word", "const total = 10\nconst half = total // TODO\nprint(half)"],
    ["an empty comment", "const total = 10\nconst half = total //\nprint(half)"],
    ["a whole-line comment", "// 2\nconst total = 10\nprint(total)"],
    ["an indented whole-line comment", "def half(total: number) -> number:\n    // 2\n    return total\n"],
    ["a rule made of dashes", "const total = 10\nconst half = total // ----\nprint(half)"],
    ["a line whose own bracket is still open", "const xs = [  // 2\n    1,\n]\nprint(xs)"],
  ];
  for (const [label, source] of silent) assert.deepEqual(codes(source), [], label);
});

test("[D89] A1 asks whether the text before '//' is complete, not whether a bracket is open somewhere", () => {
  // D90: this case was filed the other way — `const xs = [\n    1 // 2\n]` was
  // asserted silent because `nesting > 0` stood in for D89's 'syntactically
  // complete expression'. A bracket that closes on a later line leaves this
  // line's text complete, so the case belongs on the firing side; only a
  // bracket opened on the line itself leaves it unfinished.
  assert.deepEqual(codes("const xs = [\n    1 // 2\n]\nprint(xs)"), ["A1"]);
  assert.deepEqual(codes("const total = 10\nprint(\n    total // 2\n)"), ["A1"]);
});

test("[D89] A1's dividend stops where '//' would have bound, so its rewrite keeps the result", () => {
  // Python's `//` binds as tightly as `*`, so `a + b // 2` divides `b` alone.
  // Naming `a + b` would hand back a rewrite that answers a different sum.
  const additive = ["const a = 1", "const b = 4", "const c = a + b // 2", "print(c)"].join("\n");
  assert.match(message(additive), /nothing divides 'b'; write '\(b \/ 2\)\.floor\(\)'/u);

  const member = ["const point = {y: 8}", "const half = point.y // 2", "print(half)"].join("\n");
  assert.match(message(member), /'half' receives 'point\.y'/u);

  // A compound assignment reads its target as well as writing it, so the
  // advisory does not claim the name receives the dividend.
  const compound = ["let total = 10", "total += total // 2", "print(total)"].join("\n");
  assert.match(message(compound), /nothing divides 'total'/u);
});

test("[D89] A2 reports the swapped two-slot 'for' over a List, Set, or string", () => {
  const list = ["const nums = [1, 2, 3]", "for i, v in nums:", "    print(i)"].join("\n");
  assert.deepEqual(codes(list), ["A2"]);
  assert.match(message(list), /binds 'value, index'/u);
  assert.match(message(list), /'i' receives the element and 'v' receives the position/u);

  const set = ["const bag = Set([1, 2])", "for index, item in bag:", "    print(index)"].join("\n");
  assert.deepEqual(codes(set), ["A2"]);

  const text = ['const word = "abc"', "for pos, element in word:", "    print(pos)"].join("\n");
  assert.deepEqual(codes(text), ["A2"]);

  // The value slot also answers to the singular of the collection's own name.
  const singular = ['const users = ["a", "b"]', "for i, user in users:", "    print(user)"].join("\n");
  assert.deepEqual(codes(singular), ["A2"]);
  const plural = ['const entries = ["a"]', "for idx, entry in entries:", "    print(entry)"].join("\n");
  assert.deepEqual(codes(plural), ["A2"]);
});

test("[D89] A2 needs a positional collection and both name rosters", () => {
  const silent: readonly (readonly [string, string])[] = [
    ["the order the language actually binds", "const nums = [1, 2, 3]\nfor value, index in nums:\n    print(value)"],
    ["a Map, where the pair names itself", 'const m = Map([["a", 1]])\nfor i, v in m:\n    print(i)'],
    ["a single-slot 'for'", "const nums = [1, 2, 3]\nfor i in nums:\n    print(i)"],
    ["a second name off the value roster", "const nums = [1, 2, 3]\nfor i, total in nums:\n    print(total)"],
    ["a first name off the index roster", "const nums = [1, 2, 3]\nfor row, v in nums:\n    print(v)"],
  ];
  for (const [label, source] of silent) assert.deepEqual(codes(source), [], label);
});

test("[D89] A2's mechanical rewrite swaps the two names and the swapped source is clean", () => {
  const source = ["const nums = [1, 2, 3]", "for i, v in nums:", "    print(v)"].join("\n");
  const [advisory] = compiled(source).advisories;
  assert.equal(advisory?.fix?.edits.length, 2);
  assert.equal(advisory?.fix?.title, "Swap 'i' and 'v'");

  const fixed = applyMechanicalFixes(source, compiled(source).advisories);
  assert.equal(fixed.text, ["const nums = [1, 2, 3]", "for v, i in nums:", "    print(v)"].join("\n"));
  assert.deepEqual(codes(fixed.text), [], "the swapped spelling has nothing left to advise");
});

test("[D89] A2's swap is an editor quick fix and 'velar fix' never applies it", () => {
  // D38 §48 restricts a registered mechanical fix to a rewrite where no
  // judgment is involved, and swapping which name binds which value is a
  // judgment: a loop written correctly on purpose would be inverted by it. So
  // the swap is offered where a human accepts it one edit at a time — the
  // editor — and never by the batch rewriter. `velar fix` reaches the fixer
  // through `applyMechanicalFixes(source.text, module.result.diagnostics)`
  // (packages/cli/src/mechanical-fixer.ts), so an empty diagnostic channel is
  // what keeps the swap out of the author's tree.
  const source = ["const nums = [1, 2, 3]", "for i, v in nums:", "    print(v)"].join("\n");
  const result = compile(source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A2"], "A2 is the only report");
  assert.deepEqual(result.diagnostics, [], "and it never reaches the diagnostic channel");

  const batch = applyMechanicalFixes(source, result.diagnostics);
  assert.equal(batch.text, source, "'velar fix' leaves the loop exactly as written");
  assert.deepEqual(batch.applied, []);

  // The editor still gets the edit, because there a person accepts it.
  assert.ok(result.advisories[0]?.fix, "the quick fix is offered to the editor");
});

test("[D89] A3 reports a literal negative dividend and names both answers", () => {
  const source = ["const r = -7 % 3", "print(r)"].join("\n");
  assert.deepEqual(codes(source), ["A3"]);
  const reported = message(source);
  assert.match(reported, /'-7 % 3' is -1 where Python answers 2/u);
  assert.match(reported, /\(\(a % b\) \+ b\) % b/u);

  // Without a literal divisor there is no arithmetic to quote, only the rule.
  const opaque = ["const b = 3", "const r = -7 % b", "print(r)"].join("\n");
  assert.deepEqual(codes(opaque), ["A3"]);
  // A remainder can also be zero — `-6 % b` is `-0` — so the general sentence
  // says "negative or zero" rather than claiming a sign it cannot promise.
  assert.match(message(opaque), /a negative dividend leaves a remainder that is negative or zero/u);
});

test("[D89] A3 does not guess at a sign it cannot see", () => {
  const silent: readonly (readonly [string, string])[] = [
    ["a variable whose sign is not static", "const a = -7\nconst r = a % 3\nprint(r)"],
    ["a positive dividend", "const r = 7 % 3\nprint(r)"],
    ["a negative dividend on the right", "const r = 7 % -3\nprint(r)"],
    ["another operator entirely", "const r = -7 / 3\nprint(r)"],
  ];
  for (const [label, source] of silent) assert.deepEqual(codes(source), [], label);
});

test("[D89] every advisory in the roster answers to a reasoned 'velar-allow' on its line", () => {
  const suppressed = [
    "const total = 10\nconst step = total // 2   // velar-allow A1: 2 is a step number, not a divisor\nprint(step)",
    "const nums = [1, 2, 3]\nfor i, v in nums: // velar-allow A2: this List holds indices, so 'i' is the value\n    print(i)",
    "const r = -7 % 3 // velar-allow A3: the negative remainder is the answer this wants\nprint(r)",
  ];
  for (const source of suppressed) assert.deepEqual(codes(source), [], source);

  // D89's own canonical example, spelled exactly as the ruling writes it. The
  // whole tail is one comment token, so the `velar-allow` clause is stripped
  // before A1's 'contains no letters' test runs; in the other order A1 never
  // fires here and rule 3 reports the suppression as stale, which is an error.
  const canonical = compile("const total = 10\nconst step = total // 2   // velar-allow A1: 2 is a step number\nprint(step)");
  assert.deepEqual(canonical.advisories.map((item) => item.code), [], "A1 fired and the suppression consumed it");
  assert.deepEqual(canonical.diagnostics.map((item) => item.code), [], "so the suppression is not stale");

  // The suppression names one code, so it never covers the neighbour.
  const mismatched = "const r = -7 % 3 // velar-allow A1: the wrong code\nprint(r)";
  const result = compile(mismatched);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A3"], "A1 does not answer for A3");
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1012"], "and the unused suppression is stale");
});

test("[D89] an advisory renders its own report block, labelled 'advisory' rather than 'error'", () => {
  const text = ["const total = 10", "const half = total // 2", "print(half)"].join("\n");
  const [advisory] = compiled(text).advisories;
  const block = formatAdvisory(new SourceText("roster.vel", text), advisory!);
  assert.match(block, /^roster\.vel:2:20 advisory A1: /u);
  assert.equal(block.split("\n")[1], "const half = total // 2");
});

test("[D89] a loop body re-analyzed for its back edge still reports its advisory once", () => {
  // `reanalyzeLoopBackEdge` runs the body a second time whenever the back edge
  // invalidates a fact, and its answer for the diagnostic channel —
  // `deduplicateDiagnostics` — never touches the advisories. Raising each one
  // at most once per code and span is what keeps this tier from doubling.
  const source = [
    "const nums = [1, 2, 3]",
    "let acc: number? = 1",
    "for n in nums:",
    "    const r = -7 % 3",
    "    if acc != null:",
    "        print(acc + r + n)",
    "    acc = null",
  ].join("\n");
  assert.deepEqual(codes(source), ["A3"]);
});
