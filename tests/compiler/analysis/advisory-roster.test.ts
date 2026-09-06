import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMechanicalFixes,
  compile,
  formatAdvisory,
  formatSource,
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

test("[D89] A5 reports JavaScript '${...}' in a plain string and spells the author's own f-string", () => {
  const double = ['const name = "x"', 'const s = "Hello ${name}"', "print(s)"].join("\n");
  assert.deepEqual(codes(double), ["A5"]);
  const reported = message(double);
  assert.match(reported, /stays the characters '\$\{name\}'/u);
  assert.match(reported, /write 'f"Hello \{name\}"'/u);

  // The backtick delimiter keeps its own spelling in the rewrite.
  const backtick = ['const name = "x"', "const s = `Hello ${name}`", "print(s)"].join("\n");
  assert.deepEqual(codes(backtick), ["A5"]);
  assert.match(message(backtick), /write 'f`Hello \{name\}`'/u);

  // A member path is quoted as the author wrote it.
  const dotted = ['const user = {name: "x"}', 'const s = "hi ${user.name}"', "print(s)"].join("\n");
  assert.match(message(dotted), /'\$\{user\.name\}'/u);

  // A body that is not a plain name path keeps the advisory and the spelled
  // interpolation, without claiming a whole-literal rewrite it has not checked.
  const arithmetic = ['const s = "n=${1 + 2}"', "print(s)"].join("\n");
  assert.deepEqual(codes(arithmetic), ["A5"]);
  assert.match(message(arithmetic), /write '\{1 \+ 2\}' under an 'f' prefix/u);
});

test("[D89] A5 stays silent where the literal reading is the asked-for one", () => {
  const silent: readonly (readonly [string, string])[] = [
    ["an empty '${}' carries no expression", 'const s = "cash ${}"\nprint(s)'],
    ["an unclosed '${' carries no expression", 'const s = "open ${name"\nprint(s)'],
    ["a raw string asks for literal text by name", 'const s = r"raw ${name}"\nprint(s)'],
    ["a bare '$' is not the reflex", 'const s = "cost $5"\nprint(s)'],
    ["braces without a '$' are not the reflex", 'const s = "{\\"a\\": 1}"\nprint(s)'],
  ];
  for (const [label, source] of silent) assert.deepEqual(codes(source), [], label);
});

test("[D89] A5's rewrite adds the 'f' prefix and drops each '$', and the fixed source interpolates", () => {
  const source = ['const a = "1"', 'const b = "2"', 'const s = "${a}-${b}"', "print(s)"].join("\n");
  const result = compiled(source);
  assert.equal(result.advisories.length, 1, "one advisory speaks per literal");
  const fixed = applyMechanicalFixes(source, result.advisories);
  assert.equal(fixed.text.split("\n")[2], 'const s = f"{a}-{b}"');
  assert.deepEqual(codes(fixed.text), [], "the fixed spelling has nothing left to advise");
  // The fixed spelling is already the formatter's own: the rewrite survives a
  // format pass untouched, so applying the fix and formatting commute.
  assert.equal(formatSource(`${fixed.text}\n`), `${fixed.text}\n`);

  // D38 §48: the rewrite is withheld where it would involve a judgment — a
  // body that is not a plain name path might not compile as an interpolation,
  // and a bare brace outside the occurrences would change meaning under 'f'.
  const arithmetic = compiled('const s = "n=${1 + 2}"\nprint(s)');
  assert.equal(arithmetic.advisories[0]?.fix, undefined);
  const bareBrace = compiled('const name = "x"\nconst s = "{\\"k\\": 1} ${name}"\nprint(s)');
  assert.deepEqual(bareBrace.advisories.map((item) => item.code), ["A5"]);
  assert.equal(bareBrace.advisories[0]?.fix, undefined);

  // JavaScript's `$${x}` spells a literal '$' ahead of an interpolation, and
  // deleting the occurrence's '$' leaves '${x}', whose surviving '$' holds
  // the brace literal all over again — the rewrite 'f`${x}`' would not
  // interpolate, and following A6's subsequent fix would then drop the
  // author's intended literal '$'. Message-only, with no whole-literal quote.
  const guarded = compiled('const x = "v"\nconst s = `$${x}`\nprint(s)');
  assert.deepEqual(guarded.advisories.map((item) => item.code), ["A5"]);
  assert.equal(guarded.advisories[0]?.fix, undefined);
  assert.match(guarded.advisories[0]?.message ?? "", /write '\{x\}' under an 'f' prefix/u);

  // A '$' that does not touch the occurrence's own '$' holds nothing back,
  // so the fix stays registered and its rewrite tells the truth.
  const apart = compiled("const x = \"v\"\nconst s = `cost $5 ${x}`\nprint(s)");
  assert.match(apart.advisories[0]?.message ?? "", /write 'f`cost \$5 \{x\}`'/u);
  const fixedApart = applyMechanicalFixes("const x = \"v\"\nconst s = `cost $5 ${x}`\nprint(s)", apart.advisories);
  assert.deepEqual(codes(fixedApart.text), [], "the fixed spelling has nothing left to advise");
});

test("[D89] A6 reports '${...}' surviving inside an interpolated string, and its fix drops the '$'", () => {
  // The author wrote the 'f' prefix *and* the JavaScript spelling, and the
  // '$' still keeps the brace literal — the same reflex one level deeper.
  const source = ['const name = "x"', 'print(f"Hi ${name}")'].join("\n");
  assert.deepEqual(codes(source), ["A6"]);
  const reported = message(source);
  assert.match(reported, /'\$' keeps the brace after it literal even under the 'f' prefix/u);
  assert.match(reported, /drop the '\$' and write 'f"Hi \{name\}"'/u);

  const fixed = applyMechanicalFixes(source, compiled(source).advisories);
  assert.equal(fixed.text.split("\n")[1], 'print(f"Hi {name}")');
  assert.deepEqual(codes(fixed.text), []);

  // 'rf' still answers to A6: its rawness is about backslashes, not about
  // interpolation, so the deliberate-literal reading that exempts r"..." from
  // A5 does not apply here.
  assert.deepEqual(codes(['const name = "x"', 'print(rf"Hi ${name}")'].join("\n")), ["A6"]);

  // The '$$' guard holds on this side of the prefix too: dropping the
  // occurrence's '$' from 'f"$${name}"' leaves '${name}', which is again the
  // literal spelling, so the fix is withheld and the message quotes only the
  // interpolating body.
  const guarded = compiled('const name = "x"\nprint(f"$${name}")');
  assert.deepEqual(guarded.advisories.map((item) => item.code), ["A6"]);
  assert.equal(guarded.advisories[0]?.fix, undefined);
  assert.match(guarded.advisories[0]?.message ?? "", /drop the '\$' and write '\{name\}'/u);
});

test("[D89] A6 leaves the f-string spellings that already mean what they say", () => {
  const silent: readonly (readonly [string, string])[] = [
    ["a real interpolation", 'const name = "x"\nprint(f"Hi {name}")'],
    ["an empty '${}'", 'print(f"cash ${}")'],
    ["a '$' that does not touch the brace", 'const x = 1\nprint(f"cost $ {x}")'],
  ];
  for (const [label, source] of silent) assert.deepEqual(codes(source), [], label);
});

test("[D89] every advisory in the roster answers to a reasoned 'velar-allow' on its line", () => {
  const suppressed = [
    "const total = 10\nconst step = total // 2   // velar-allow A1: 2 is a step number, not a divisor\nprint(step)",
    "const nums = [1, 2, 3]\nfor i, v in nums: // velar-allow A2: this List holds indices, so 'i' is the value\n    print(i)",
    "const r = -7 % 3 // velar-allow A3: the negative remainder is the answer this wants\nprint(r)",
    'const s = "envsubst ${HOME}" // velar-allow A5: this is a shell template, so the text is the point\nprint(s)',
    'const brace = "x"\nprint(f"${brace}") // velar-allow A6: this line generates a JavaScript template on purpose',
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
