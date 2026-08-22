import assert from "node:assert/strict";
import test from "node:test";
import { compile, type CompileResult } from "@velarscript/compiler";

/**
 * D90's lexer half: the A1 trigger and message defects D89's own verification
 * turned up, the two layout rules that were promised and not enforced
 * (leading-dot continuation, unclosed brackets), the member positions the
 * reserved-spelling paragraph already allows, and the quadratic column scan.
 */
function codes(result: CompileResult): string[] {
  return result.diagnostics.map((item) => item.code);
}

function advisories(source: string): string[] {
  const result = compile(source);
  assert.deepEqual(codes(result), [], source);
  return result.advisories.map((item) => item.message);
}

function advisoryCodes(source: string): string[] {
  const result = compile(source);
  assert.deepEqual(codes(result), [], source);
  return result.advisories.map((item) => item.code);
}

/**
 * What a module prints when it is compiled and run. A1's whole promise is that
 * the line it suggests computes what the author's Python line computed, so the
 * only test that can hold it to that is one that runs the suggestion.
 */
function printed(source: string): number[] {
  const result = compile(source);
  assert.deepEqual(codes(result), [], source);
  assert.deepEqual(result.advisories.map((item) => item.code), [], source);
  const logged: number[] = [];
  const module_ = new Function("console", result.code ?? "") as (console: { readonly log: (value: number) => void }) => void;
  module_({ log: (value) => { logged.push(value); } });
  return logged;
}

/**
 * The dividends A1 reads back, each with a module that puts one expression
 * where the mistake stands and prints its value.
 */
interface DividendFixture {
  readonly label: string;
  readonly quoted: string;
  readonly value: number;
  readonly module: (expression: string) => string;
}

const dividends: readonly DividendFixture[] = [
  { label: "a name", quoted: "total", value: 10, module: (expression) => `const total = 10\nconst half = ${expression}\nprint(half)\n` },
  { label: "an index", quoted: "xs[0]", value: 10, module: (expression) => `const xs = [10, 4]\nconst half = ${expression}\nprint(half)\n` },
  { label: "a member chain", quoted: "p.a.b", value: 10, module: (expression) => `const p = {a: {b: 10}}\nconst half = ${expression}\nprint(half)\n` },
  {
    label: "a required-value unwrap",
    quoted: "total!",
    value: 10,
    module: (expression) => `def compute(total: number?) -> number:\n    return ${expression}\n\nprint(compute(10))\n`,
  },
  { label: "a negative literal", quoted: "-7", value: -7, module: (expression) => `const q = ${expression}\nprint(q)\n` },
];

/**
 * The comment bodies A1 can translate, with the rewrite each one must produce
 * and the answer Python's `//` gives for that body. `answer` is Python's
 * arithmetic written out, not the compiler's: `//` binds as tightly as `*`, so
 * the divisor is the leading primary and the tail runs after the floor.
 */
interface DivisorFixture {
  readonly body: string;
  readonly suggestion: (dividend: string) => string;
  readonly answer: (dividend: number) => number;
}

const divisors: readonly DivisorFixture[] = [
  { body: "2", suggestion: (dividend) => `(${dividend} / 2).floor()`, answer: (value) => Math.floor(value / 2) },
  { body: "2 + 3", suggestion: (dividend) => `(${dividend} / 2).floor() + 3`, answer: (value) => Math.floor(value / 2) + 3 },
  { body: "2 * 3", suggestion: (dividend) => `(${dividend} / 2).floor() * 3`, answer: (value) => Math.floor(value / 2) * 3 },
  { body: "2 - 1", suggestion: (dividend) => `(${dividend} / 2).floor() - 1`, answer: (value) => Math.floor(value / 2) - 1 },
  { body: "(2 + 3)", suggestion: (dividend) => `(${dividend} / (2 + 3)).floor()`, answer: (value) => Math.floor(value / 5) },
];

function suggestedRewrite(message: string): string {
  const quoted = /write '(.+)' for Python's floor division/u.exec(message);
  assert.ok(quoted, message);
  return quoted[1] ?? "";
}

test("[D90] A1 fires on a line whose text before '//' is complete, even inside a bracket that closes later", () => {
  // The trigger was `nesting === 0`, which is not the question D89 asks. A
  // bracket opened on an earlier line and closed on a later one leaves this
  // line's text complete, so the mistake is exactly the one A1 exists for.
  const argument = advisories("const total = 10\nprint(\n    total // 2\n)\n");
  assert.equal(argument.length, 1);
  assert.match(argument[0] ?? "", /nothing divides 'total'; write '\(total \/ 2\)\.floor\(\)'/u);

  const element = advisories("const total = 10\nconst xs = [\n    total // 2\n]\n");
  assert.equal(element.length, 1);

  // A bracket opened on *this* line is still open at the comment, so the text
  // before '//' is not a complete expression and A1 stays silent.
  assert.deepEqual(advisoryCodes("print(  // 2\n    1\n)\n"), []);
  assert.deepEqual(advisoryCodes("const xs = [  // 2\n    1,\n]\nprint(xs.size)\n"), []);
});

test("[D90] A1's tail-token gate admits only what a floor division could have divided", () => {
  const firing: readonly (readonly [string, string])[] = [
    ["a name", "const total = 10\nconst half = total // 2\nprint(half)"],
    ["an index", "const xs = [1, 2]\nconst half = xs[0] // 2\nprint(half)"],
    ["a closed group", "const a = 1\nconst b = 4\nconst half = (a + b) // 2\nprint(half)"],
    ["a member read", "const point = {y: 8}\nconst half = point.y // 2\nprint(half)"],
  ];
  for (const [label, source] of firing) assert.deepEqual(advisoryCodes(source), ["A1"], label);

  // None of these can be divided, so an advisory on one names an arithmetic the
  // author never wrote — a false positive D89's admission bar disqualifies.
  //
  // The unit literal moved here from the firing list above: `500ms` is a
  // Duration, `(500ms / 2).floor()` is VEL4001 "Type 'Duration' has no field
  // 'floor'", and nobody reaches for Python's floor division on a duration
  // literal. An advisory that names a rewrite the author cannot compile is the
  // defect the tail-token gate was narrowed to remove, not a case it should
  // keep.
  const silent: readonly (readonly [string, string])[] = [
    ["a string", 'const s = "x" // 2\nprint(s)'],
    ["an f-string", 'const name = "a"\nconst s = f"{name}" // 2\nprint(s)'],
    ["a boolean", "const s = true // 2\nprint(s)"],
    ["null", "const s: number? = null // 2\nprint(s ?? 0)"],
    ["a record", "const s = {a: 1} // 2\nprint(s.a)"],
    ["a unit literal", "const half = 500ms // 2\nprint(half)"],
  ];
  for (const [label, source] of silent) assert.deepEqual(advisoryCodes(source), [], label);

  // The rewrite the unit literal used to draw does not compile, which is why it
  // is not admissible as an advisory.
  const unusable = compile("const half = (500ms / 2).floor()\nprint(half)\n");
  assert.ok(unusable.diagnostics.length > 0, "a Duration has no 'floor', so the old suggestion was unusable");
});

test("[D90] A1 does not read a dividend off a leading-dot continuation line", () => {
  // A chain continuation carries only the tail of its dividend: the backward
  // walk is bounded by the physical line, so it stopped at the line's own
  // leading '.', quoted '.size', and suggested '(.size / 2).floor()' — text
  // that does not parse. The head is on a line this advisory does not read, so
  // there is no rewrite to name and D89's admission bar withholds it.
  assert.deepEqual(advisoryCodes("const xs = [1, 2]\nconst c = xs\n    .size // 2\nprint(c)\n"), []);
  assert.deepEqual(advisoryCodes("const xs: List<number>? = [1, 2]\nconst c = xs\n    ?.size // 2\nprint(str(c))\n"), []);

  // The suggestion it used to produce is not source at all.
  const broken = compile("const c = (.size / 2).floor()\nprint(c)\n");
  assert.ok(broken.diagnostics.length > 0, "'(.size / 2).floor()' does not parse");

  // The same chain written on one line still reports, dividend and all.
  const inline = advisories("const xs = [1, 2]\nconst c = xs.size // 2\nprint(c)\n");
  assert.match(inline[0] ?? "", /'c' receives 'xs\.size'/u);
});

test("[D90] A1 divides by the leading primary and re-emits the tail after '.floor()'", () => {
  // Python's `//` binds as tightly as `*`, so `total // 2 + 3` divides by 2 and
  // *then* adds 3. Both earlier readings were wrong: quoting the body verbatim
  // gave '(total / 2 + 3).floor()', and wrapping all of it gave
  // '(total / (2 + 3)).floor()', which for total = 10 answers 2 where Python
  // answers 8. A bare number needs no parentheses and an already-parenthesised
  // group needs no second pair.
  for (const dividend of dividends) {
    for (const divisor of divisors) {
      const reported = advisories(dividend.module(`${dividend.quoted} // ${divisor.body}`));
      assert.equal(reported.length, 1, `${dividend.label} // ${divisor.body}`);
      assert.equal(suggestedRewrite(reported[0] ?? ""), divisor.suggestion(dividend.quoted), `${dividend.label} // ${divisor.body}`);
    }
  }
});

test("[D90] every A1 rewrite compiles clean and answers what Python's floor division answers", () => {
  // The guard that makes a wrong suggestion impossible to ship again: the
  // module compiled here *is* the text A1 told the author to write, and the
  // value it prints is compared against Python's arithmetic computed in the
  // test rather than against the compiler's own reading of the line.
  for (const dividend of dividends) {
    for (const divisor of divisors) {
      const reported = advisories(dividend.module(`${dividend.quoted} // ${divisor.body}`));
      const rewrite = suggestedRewrite(reported[0] ?? "");
      assert.deepEqual(
        printed(dividend.module(rewrite)),
        [divisor.answer(dividend.value)],
        `${rewrite} must answer Python's ${dividend.quoted} // ${divisor.body}`,
      );
    }
  }
});

test("[D90] A1 is withheld when no single rewrite says what the author's line said", () => {
  // D89's admission bar (line 96) requires the advisory to name the one
  // unambiguous spelling. A second floor division or a modulo in the tail
  // cannot be reached by one substitution, `2 3` does not parse either way, and
  // an unbalanced parenthesis is as likely a stray keystroke as a divisor — so
  // each of these reports nothing at all rather than a suggestion that is
  // wrong, or that opens a comment in the line it is proposing.
  const withheld = ["2 // 3", "2 % 3", "2 / 3", "2 3", "2)", "(2"];
  for (const body of withheld) {
    const source = `const total = 10\nconst half = total // ${body}\nprint(half)\n`;
    const result = compile(source);
    assert.deepEqual(codes(result), [], body);
    assert.deepEqual(result.advisories.map((item) => item.code), [], body);
  }
});

test("[D90] A1 reads a unary sign into its dividend and leaves a binary one alone", () => {
  // Python's `-7 // 2` is -4, so quoting `7` and suggesting '(7 / 2).floor()',
  // which answers 3, is the same class of wrong rewrite as the divisor side's.
  const unary = advisories("const q = -7 // 2\nprint(q)\n");
  assert.match(unary[0] ?? "", /'q' receives '-7'/u, "the sign belongs to the dividend, and so does the name it lands in");

  const binary = advisories("const a = 10\nconst q = a - 7 // 2\nprint(q)\n");
  assert.match(binary[0] ?? "", /nothing divides '7'/u, "a binary minus still ends the dividend at 7");

  const inCall = advisories("def f(n: number) -> number:\n    return n\n\nconst q = f(-7) // 2\nprint(q)\n");
  assert.match(inCall[0] ?? "", /'q' receives 'f\(-7\)'/u, "a sign inside brackets is read through the bracket walk");
});

test("[D90] D89's canonical suppression example fires, is consumed, and is not judged stale", () => {
  // The whole tail is one comment token, so the `velar-allow` clause has to be
  // stripped before A1's 'contains no letters' test runs. Without that order A1
  // does not fire on D89's own example and rule 3 then reports the suppression
  // as stale, which is a compile error.
  const source = "const total = 10\nconst step = total // 2   // velar-allow A1: 2 is a step number\nprint(step)\n";
  const result = compile(source);
  assert.deepEqual(codes(result), [], "the suppression is used, so it is not stale");
  assert.deepEqual(result.advisories.map((item) => item.code), []);

  // Without the clause the same line reports, which is what the suppression is
  // answering for.
  assert.deepEqual(advisoryCodes("const total = 10\nconst step = total // 2\nprint(step)\n"), ["A1"]);
});

test("[D89] the reflex message corrections name 'using' and 'throw'", () => {
  const context = compile("const file = 1\nwith file as f:\n    print(f)\n");
  assert.match(context.diagnostics[0]?.message ?? "", /Use 'using name = expression'/u);

  const raised = compile("def fail() -> number:\n    raise Error(\"no\")\n");
  assert.ok(
    raised.diagnostics.some((item) => /Use 'throw'/u.test(item.message)),
    JSON.stringify(raised.diagnostics),
  );
});

test("[D90] 'with' is a member name and a record key, and stays refused as a binding", () => {
  // An extern module describes an API it does not own, so a member spelled
  // `with` — `Array.prototype.with`, `Temporal.PlainDate.prototype.with`, a
  // Knex- or Kysely-style CTE builder — has to be declarable.
  const declared = compile([
    'extern module "pg":',
    "    export class Query:",
    "        def with(name: string) -> Query",
  ].join("\n"));
  assert.deepEqual(codes(declared), []);

  const method = compile([
    "class Box:",
    "    def with(n: number) -> number:",
    "        return n",
    "",
    "const b = Box()",
    "print(b.with(1))",
  ].join("\n"));
  assert.deepEqual(codes(method), []);
  assert.match(method.code ?? "", /\.with\(1\)/u);

  const key = compile("const c = {with: 1}\nprint(c.with)\n");
  assert.deepEqual(codes(key), []);
  assert.match(key.code ?? "", /with: 1/u);

  const laterKey = compile("const c = {a: 1, with: 2}\nprint(c.with)\n");
  assert.deepEqual(codes(laterKey), []);

  const optional = compile([
    "class Box:",
    "    def with(n: number) -> number:",
    "        return n",
    "",
    "const b: Box? = null",
    "print(b?.with(1) ?? 0)",
  ].join("\n"));
  assert.deepEqual(codes(optional), []);

  // The infix record update, the binding, and a module-scope declaration are
  // all still refused: a module that said `function with` would not be
  // JavaScript, and the infix spelling is the one D89 corrects to 'using'.
  const refused: readonly (readonly [string, string])[] = [
    ["a binding", "const with = 1\nprint(with)"],
    ["a module-scope declaration", "def with(n: number) -> number:\n    return n"],
    ["a nested declaration", "def outer() -> number:\n    def with(n: number) -> number:\n        return n\n    return 1"],
    ["the infix record update", "const value = {a: 1}\nconst n = value with {a: 2}\nprint(n.a)"],
  ];
  for (const [label, source] of refused) {
    const reported = compile(source).diagnostics.filter((item) => item.code === "VEL1005");
    assert.equal(reported.length >= 1, true, label);
    assert.match(reported[0]?.message ?? "", /does not expose 'with'/u, label);
  }
});

test("[D90] 'eval' stays unavailable through direct member syntax", () => {
  // The charter's reserved-spelling paragraph separates the two groups:
  // `delete`, `default` and `with` are ordinary member names, while the
  // execution-capability spellings are not. This half is deliberate.
  const reported = compile("const x = {a: 1}\nconst y = x.eval()\nprint(y)\n").diagnostics;
  assert.deepEqual(reported.map((item) => item.code), ["VEL1005"]);
  assert.match(reported[0]?.message ?? "", /does not expose 'eval'/u);

  assert.deepEqual(compile("const c = {eval: 1}\n").diagnostics.map((item) => item.code), ["VEL1005"]);
});

test("[D90] a leading-dot line joins only the line directly above it, indented past its statement", () => {
  const canonical = compile([
    'const names = ["b", "a"]',
    "const sorted = names",
    "    .sorted((left, right) => left < right ? -1 : 1)",
    "    .map((value) => value.upper())",
    "print(sorted.size)",
  ].join("\n"));
  assert.deepEqual(codes(canonical), [], "the canonical chain still joins");

  const optional = compile([
    "def measure(values: List<string>?) -> number:",
    "    return values",
    "        ?.size ?? 0",
    "",
    "print(measure(null))",
  ].join("\n"));
  assert.deepEqual(codes(optional), []);

  const refused: readonly (readonly [string, string])[] = [
    ["a blank line between", "const xs = [3, 1, 2]\n\n    .sorted()\nprint(xs.size)"],
    ["a comment line between", "const xs = [3, 1, 2]\n// unrelated section\n    .sorted()\nprint(xs.size)"],
    ["column 0", "const xs = [3, 1, 2]\n.sorted()\nprint(xs.size)"],
    ["equal indentation", "def f() -> number:\n    const xs = [1, 2]\n    .sorted()\n    return 1"],
    ["dedented out of the body", "def f() -> List<number>:\n    const xs = [1, 2]\n    return xs\n.sorted()"],
  ];
  for (const [label, source] of refused) {
    const reported = compile(source).diagnostics;
    assert.equal(reported[0]?.code, "VEL1004", `${label}: ${JSON.stringify(reported)}`);
    assert.match(reported[0]?.message ?? "", /continues the line above it/u, label);
  }
});

test("[D90] an unclosed bracket costs one statement rather than every symbol below it", () => {
  const declarations = Array.from({ length: 10 }, (_, index) => `export def f${index}() -> number:\n    return ${index}\n`).join("");
  const broken = compile(`const broken = compute(\n${declarations}`);
  const unclosed = broken.diagnostics.filter((item) => item.code === "VEL1003");
  assert.equal(unclosed.length, 1, JSON.stringify(broken.diagnostics));
  assert.match(unclosed[0]?.message ?? "", /Unclosed '\('/u);
  assert.equal(unclosed[0]?.span.start, "const broken = compute".length, "the report sits on the opening bracket");
  for (let index = 0; index < 10; index += 1) {
    assert.ok(broken.semanticIndex.symbols.some((item) => item.name === `f${index}`), `f${index} survives`);
  }

  // Line breaks inside brackets are insignificant, so an argument list written
  // at column 0 is legal and must keep compiling — indentation alone decides
  // nothing here.
  const legal = compile([
    "def compute(a: number, b: number) -> number:",
    "    return a + b",
    "",
    "const x = compute(",
    "1,",
    "2,",
    ")",
    "print(x)",
  ].join("\n"));
  assert.deepEqual(codes(legal), []);

  // A record key may be spelled with a statement head, and a key is the one
  // shape that puts such a word at the head of a line inside a bracket.
  const keys = compile(['const config = {', 'type: "a",', 'const: 1,', "}", "print(config.type)"].join("\n"));
  assert.deepEqual(codes(keys), []);

  // `type` and `match` are contextual keywords that stay available as names
  // (charter section 3), so a read of one can head a line inside a bracket in
  // every position an argument takes. What follows the word is what tells a
  // read from a declaration.
  const reads: readonly (readonly [string, readonly string[]])[] = [
    ["an argument at column 0", ["def f(a: number) -> number:", "    return a", "const type = 1", "const x = f(", "type,", ")", "print(x)"]],
    ["a named argument at column 0", ["def f(type: number) -> number:", "    return type", "const x = f(", "type=1,", ")", "print(x)"]],
    ["a list item at column 0", ["const match = 1", "const xs = [", "match,", "]", "print(xs.size)"]],
    ["a member step at column 0", ["def f(a: number) -> number:", "    return a", "const type = \"a\"", "const n = f(", "type.size,", ")", "print(n)"]],
    ["an argument at the opening line's indentation", ["def f(a: number) -> number:", "    return a", "def g() -> number:", "    const type = 1", "    return f(", "    type,", "    )", "print(g())"]],
  ];
  for (const [label, lines] of reads) {
    const reported = compile(lines.join("\n")).diagnostics.filter((item) => item.code === "VEL1003");
    assert.deepEqual(reported, [], `${label} is a read, not an unclosed bracket`);
  }
});

test("[D90] the lexer's column scan is linear, and one lex reports a bounded number of errors", () => {
  const elapsed = (text: string): number => {
    const started = process.hrtime.bigint();
    compile(text);
    return Number(process.hrtime.bigint() - started) / 1e6;
  };

  // Generous bounds: the point is the shape of the curve, not the constant.
  // Before the fix these were 673 ms and 1186 ms, growing fourfold per
  // doubling; a ';' produces no token, so MAX_TOKENS never bounded them.
  const semicolons = elapsed(";".repeat(20000));
  assert.ok(semicolons < 1500, `20000 semicolons took ${semicolons} ms`);
  const blocks = elapsed("/**/".repeat(20000));
  assert.ok(blocks < 1500, `20000 block comments took ${blocks} ms`);
  const half = elapsed(";".repeat(10000));
  assert.ok(semicolons < half * 8 + 200, `doubling the input multiplied the time by ${semicolons / half}`);

  const capped = compile(";".repeat(20000));
  assert.equal(capped.diagnostics.length, 1000);
  assert.equal(capped.diagnostics.at(-1)?.code, "VEL1013");
  assert.match(capped.diagnostics.at(-1)?.message ?? "", /fix these and compile again to see the rest/u);

  // An ordinary file with a few errors is untouched by the cap.
  const ordinary = compile("const a = 1;\nconst b = 2;\nconst c = 3;\nprint(a + b + c)\n");
  assert.equal(ordinary.diagnostics.length, 3);
  assert.ok(ordinary.diagnostics.every((item) => item.code === "VEL1005"));
});

// ---------------------------------------------------------------------------
// D89 A5/A6: the lexer front of the '${...}' advisories. The roster file
// carries the trigger and message matrix; this file holds the lexer to the
// two claims only it can break — the reported meaning is the module's real
// runtime meaning, and the one construct where '${...}' is documented literal
// JavaScript never reaches the advisory at all.
// ---------------------------------------------------------------------------

test("[D89] A5 tells the truth at runtime: the literal stays text, and the fixed spelling interpolates", async () => {
  const { applyMechanicalFixes } = await import("@velarscript/compiler");
  const source = 'const name = "vel"\nconst s = "Hello ${name}"\nprint(s)';
  const result = compile(source);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A5"]);
  const ranAsWritten: string[] = [];
  (new Function("console", result.code ?? "") as (console: { readonly log: (value: string) => void }) => void)({ log: (value) => { ranAsWritten.push(value); } });
  assert.deepEqual(ranAsWritten, ["Hello ${name}"], "the advisory's 'stays the characters' claim is the emitted meaning");

  const fixed = applyMechanicalFixes(source, result.advisories);
  const fixedResult = compile(fixed.text);
  assert.deepEqual(codes(fixedResult), []);
  assert.deepEqual(fixedResult.advisories, []);
  const ranFixed: string[] = [];
  (new Function("console", fixedResult.code ?? "") as (console: { readonly log: (value: string) => void }) => void)({ log: (value) => { ranFixed.push(value); } });
  assert.deepEqual(ranFixed, ["Hello vel"], "the rewrite the message names computes the interpolation");
});

test("[D89] an inline JavaScript block never draws A5 — '${...}' there is documented literal JavaScript", () => {
  const contracted = [
    "const seed = 1",
    "extern js(seed: number)`",
    '    export function shape() { return "wrap ${seed} here" }',
    "`:",
    "    export def shape() -> string",
    "print(shape())",
  ].join("\n");
  const contractedResult = compile(contracted);
  assert.deepEqual(codes(contractedResult), [], contracted);
  assert.deepEqual(contractedResult.advisories, []);

  const unsafe = [
    "unsafe js`",
    '    export const template = "port ${PORT}"',
    "`",
    'print("ready")',
  ].join("\n");
  const unsafeResult = compile(unsafe);
  assert.deepEqual(codes(unsafeResult), [], unsafe);
  assert.deepEqual(unsafeResult.advisories, []);
});

test("[D89] a string nested in an interpolation still answers in module coordinates", () => {
  // The interpolation body is lexed from the module's own text, so the
  // advisory's span lands on the physical line and a reasoned 'velar-allow'
  // on that line consumes it.
  const source = 'const y = "b"\nprint(f"{ "${y}" }")';
  const result = compile(source);
  assert.deepEqual(codes(result), []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A5"]);
  assert.equal(source.slice(result.advisories[0]!.span.start, result.advisories[0]!.span.end), "${y}");

  const suppressed = compile('const y = "b"\nprint(f"{ "${y}" }") // velar-allow A5: generating a JavaScript template on purpose');
  assert.deepEqual(suppressed.advisories, []);
  assert.deepEqual(suppressed.diagnostics, []);
});
