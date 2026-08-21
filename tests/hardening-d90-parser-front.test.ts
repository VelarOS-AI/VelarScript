import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile, diagnostic, formatSource, mechanicalFix } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// The other two nested-expression fragments — a markup '{...}' hole and a Look
// condition — only exist behind the web extension, and the extension supplies
// its own `createNestedParser`, so nothing in core reaches them.
const web = { extensions: [velarCompilerExtension] };

function codes(source: string): string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

function reports(source: string): string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function firstMessage(source: string): string {
  return reports(source)[0] ?? "";
}

const interpolationEquality = [
  "const banner = \"hello world\"",
  "",
  "export def report(missing: string?) -> string:",
  "    return f\"{missing === null}{banner}\"",
  "",
].join("\n");

test("[D90] a fix raised inside an interpolation names the module offsets it rewrites", () => {
  const result = compile(interpolationEquality);
  const [report] = result.diagnostics;
  assert.equal(report?.code, "VEL1005");
  const edit = report?.fix?.edits[0];
  assert.ok(edit, JSON.stringify(result.diagnostics));
  // The fix is applied to the module text, so its span has to slice the
  // module's own '===' rather than an offset inside the interpolation.
  assert.equal(interpolationEquality.slice(edit.span.start, edit.span.end), "===");

  const applied = applyMechanicalFixes(interpolationEquality, result.diagnostics);
  assert.equal(applied.applied.length, 1);
  assert.equal(applied.text, interpolationEquality.replace("===", "=="));
  assert.equal(applied.text.split("\n")[0], "const banner = \"hello world\"");
  assert.deepEqual(compile(applied.text).diagnostics, []);
});

const markupHole = [
  "component App:",
  "    state count = 1",
  "    return <div>{str(count === 1)}</div>",
  "",
].join("\n");

const lookCondition = [
  "const active = true",
  "const card = look:",
  "    color = \"red\"",
  "    if active === true:",
  "        color = \"blue\"",
  "",
].join("\n");

test("[D90] a fix raised inside a markup hole or a Look condition names module offsets too", () => {
  for (const source of [markupHole, lookCondition]) {
    const result = compile(source, web);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1005"], source);
    const edits = result.diagnostics[0]?.fix?.edits ?? [];
    assert.equal(edits.length, 1, source);
    // Every edit selects exactly the text the report named, in module
    // coordinates — a fragment-local offset would slice the module's opening
    // line instead.
    for (const edit of edits) assert.equal(source.slice(edit.span.start, edit.span.end), "===", source);

    const applied = applyMechanicalFixes(source, result.diagnostics);
    assert.equal(applied.applied.length, 1, source);
    assert.equal(applied.text, source.replace("===", "=="), source);
    assert.deepEqual(compile(applied.text, web).diagnostics, [], source);
  }
});

test("[D90] a fix whose edits sit away from its own report is never spliced", () => {
  const source = "const banner = \"hello world\"\nprint(banner)\n";
  const strayed = diagnostic(
    "VEL1005",
    "probe",
    { start: source.lastIndexOf("banner"), end: source.lastIndexOf("banner") + 6 },
    mechanicalFix({ start: 6, end: 12 }, "other", "Rename the binding"),
  );
  const refused = applyMechanicalFixes(source, [strayed]);
  assert.deepEqual(refused.applied, []);
  assert.equal(refused.text, source);

  const anchored = diagnostic("VEL1005", "probe", { start: 6, end: 12 }, mechanicalFix({ start: 6, end: 12 }, "other", "Rename the binding"));
  assert.equal(applyMechanicalFixes(source, [anchored]).text, "const other = \"hello world\"\nprint(banner)\n");

  // The one legitimate rewrite that happens away from the report: the import a
  // diagnostic asks for, which rewrites whole lines.
  const importing = diagnostic(
    "VEL3008",
    "probe",
    { start: source.lastIndexOf("banner"), end: source.lastIndexOf("banner") + 6 },
    mechanicalFix({ start: 0, end: 0 }, "import {banner} from \"./a.vel\"\n\n", "Import banner"),
  );
  assert.equal(applyMechanicalFixes(source, [importing]).applied.length, 1);
});

test("[D90] a real diagnostic's fix still applies through the coordinate gate", () => {
  const fixtures: readonly (readonly [string, string])[] = [
    ["const a = 1\nconst b = a === 1\nprint(str(b))\n", "const a = 1\nconst b = a == 1\nprint(str(b))\n"],
    ["const a = 1;\nprint(str(a))\n", "const a = 1\nprint(str(a))\n"],
    ["# note\nconst a = 1\nprint(str(a))\n", "// note\nconst a = 1\nprint(str(a))\n"],
    ["const a = true\nconst b = !a\nprint(str(b))\n", "const a = true\nconst b = not a\nprint(str(b))\n"],
  ];
  for (const [wrong, right] of fixtures) {
    const applied = applyMechanicalFixes(wrong, compile(wrong).diagnostics);
    assert.equal(applied.text, right, wrong);
  }
});

test("[D90] a nested interpolation spends the parser's one depth budget", () => {
  const depth = 400;
  const nested = `const x = ${"f\"{".repeat(depth)}1${"}\"".repeat(depth)}\n`;
  const started = Date.now();
  const result = compile(nested);
  const elapsed = Date.now() - started;
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2008"]);
  assert.match(result.diagnostics[0]!.message, /too complex to parse safely/u);
  // The budget, not a JavaScript stack overflow, is what ends the parse, so the
  // answer arrives without paying the whole superlinear cost first.
  assert.ok(elapsed < 2000, `${elapsed}ms`);
});

test("[D90] an extension's own nested parser spends the same budget", () => {
  const depth = 1600;
  const nested = `const x = ${"f\"{".repeat(depth)}1${"}\"".repeat(depth)}\n`;
  const started = Date.now();
  const result = compile(nested, web);
  const elapsed = Date.now() - started;
  // The budget is inherited through a method rather than a constructor
  // argument exactly because packages/web and packages/node override
  // `createNestedParser`; an override that drops it reopens the superlinear
  // parse for every module those targets compile.
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2008"]);
  assert.ok(elapsed < 1000, `${elapsed}ms`);
});

test("[D90] an ordinary nested interpolation still compiles and emits", () => {
  const source = "const name = \"world\"\nconst greeting = f\"hello {f`{name}`}\"\nprint(greeting)\n";
  const { code, diagnostics } = compile(source);
  assert.deepEqual(diagnostics, []);
  assert.ok(code);
  assert.match(code, /`hello \$\{`\$\{name\}`\}`/u);
});

test("[D90] a generic annotation closes even where '>' runs into '='", () => {
  const fixtures: readonly (readonly [string, string])[] = [
    ["def f(xs: List<number>=[1]) -> number:\n    return xs.size\n", "def f(xs: List<number> = [1]) -> number:\n    return xs.size\n"],
    ["const m: List<number>=[1]\nprint(str(m.size))\n", "const m: List<number> = [1]\nprint(str(m.size))\n"],
    ["const m: List<List<number>>=[[1]]\nprint(str(m.size))\n", "const m: List<List<number>> = [[1]]\nprint(str(m.size))\n"],
    ["const m: List<List<List<number>>>=[[[1]]]\nprint(str(m.size))\n", "const m: List<List<List<number>>> = [[[1]]]\nprint(str(m.size))\n"],
  ];
  for (const [tight, spaced] of fixtures) {
    assert.deepEqual(compile(tight).diagnostics, [], tight);
    assert.equal(compile(tight).code, compile(spaced).code, tight);
  }
});

test("[D90] '>=', '>>=' and '>>>=' stay operators in expression position", () => {
  const source = "let x = 8\nx >>= 2\nlet y = 8\ny >>>= 2\nconst ok = x >= 1\nprint(str(x) + str(y) + str(ok))\n";
  const { code, diagnostics } = compile(source);
  assert.deepEqual(diagnostics, []);
  assert.equal(formatSource(source), source);
  assert.ok(code);
  assert.match(code, /x = __velarBitwiseBinary\(x, ">>", 2\)/u);
  assert.match(code, /y = __velarBitwiseBinary\(y, ">>>", 2\)/u);
  assert.match(code, /const ok = \(x >= 1\)/u);
});

test("[D90] explicit type arguments read the same however they are spaced", () => {
  const generic = "def id<T>(v: T) -> T:\n    return v\n\n";
  const fixtures: readonly (readonly [string, string, RegExp])[] = [
    [
      "const m = Map<string, number>()\n",
      "const m = Map < string, number > ()\n",
      /an empty 'Map\(\)' takes its type from the binding/u,
    ],
    [
      `${generic}const v = id<string>("a")\n`,
      `${generic}const v = id < string > ("a")\n`,
      /write 'id\(\.\.\.\)' without '<\.\.\.>'/u,
    ],
    [
      "def g(a: number, b: number, cc: number) -> bool:\n    return a<b>(cc)\n",
      "def g(a: number, b: number, cc: number) -> bool:\n    return a < b > (cc)\n",
      /Comparison chains must point one way/u,
    ],
    [
      "const values = mapValues<string, bool>([1])\n",
      "const values = mapValues < string, bool > ([1])\n",
      /write 'mapValues\(\.\.\.\)' without '<\.\.\.>'/u,
    ],
  ];
  for (const [tight, spaced, message] of fixtures) {
    assert.ok(reports(tight).some((item) => message.test(item)), reports(tight).join(" | "));
    assert.deepEqual(reports(spaced), reports(tight), spaced);
    // The formatter respells the spacing around '<' and '>'; the grammar the
    // line reads as must survive that, or format-on-save destroys the very
    // diagnostic these spellings exist to teach.
    assert.deepEqual(reports(formatSource(tight)), reports(tight), tight);
    assert.deepEqual(reports(formatSource(spaced)), reports(spaced), spaced);
  }
});

test("[D90] a comparison pair that only looks like type arguments keeps its meaning", () => {
  const source = [
    "def two(p: number, q: number) -> number:",
    "    return p + q",
    "",
    "const Limit = 5",
    "const a = 1",
    "const g = 2",
    "const c = 3",
    "const near = a < Limit and g > (c)",
    "print(str(two(1, 2)) + str(near))",
    "",
  ].join("\n");
  assert.deepEqual(compile(source).diagnostics, []);
  assert.deepEqual(compile(source.replace("a < Limit and g > (c)", "a<Limit and g>(c)")).diagnostics, []);
});

test("[D90 R6] an integer literal that cannot be held exactly is rejected", () => {
  const unrepresentable = [
    "9007199254740993",
    "0x20000000000001",
    "0b100000000000000000000000000000000000000000000000000001",
    "123456789012345678901234567890",
  ];
  for (const literal of unrepresentable) {
    const result = compile(`const a = ${literal}\nprint(str(a))\n`);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2017"], literal);
    assert.match(result.diagnostics[0]!.message, /Numeric literals must be exactly representable/u, literal);
    // The message quotes the number the compiler would otherwise have produced.
    assert.ok(result.diagnostics[0]!.message.includes(literal), result.diagnostics[0]!.message);
  }
  // The finite rule is unchanged, and keeps its own message.
  assert.deepEqual(codes("const a = 1e400\n"), ["VEL2017"]);
  assert.match(firstMessage("const a = 1e400\n"), /Numeric literals must be finite/u);
});

test("[D90 R6] an exactly representable literal, and any decimal, still compiles", () => {
  const accepted = [
    "9007199254740992",
    "18014398509481984",
    "0x20000000000000",
    "0xff",
    "1_000_000",
    "0.1",
    "1e30",
    "1e-30",
    "-9007199254740992",
  ];
  for (const literal of accepted) {
    assert.deepEqual(compile(`const a = ${literal}\nprint(str(a))\n`).diagnostics, [], literal);
  }
});

test("[D90 R6] the report quotes the literal as the author wrote it", () => {
  // The token carries the value with its separators stripped and its radix
  // prefix lowered, so quoting the token sent the author looking for text that
  // is nowhere in their file.
  const separated = compile("const a = 1_000_000_000_000_000_000_1\nprint(str(a))\n");
  assert.deepEqual(separated.diagnostics.map((item) => item.code), ["VEL2017"]);
  assert.match(separated.diagnostics[0]!.message, /'1_000_000_000_000_000_000_1' becomes 10000000000000000000/u);

  const upper = compile("const a = 0X20000000000001\nprint(str(a))\n");
  assert.deepEqual(upper.diagnostics.map((item) => item.code), ["VEL2017"]);
  assert.match(upper.diagnostics[0]!.message, /'0X20000000000001' becomes 9007199254740992/u);

  const separatedHex = compile("const a = 0x20_00_00_00_00_00_01\nprint(str(a))\n");
  assert.match(separatedHex.diagnostics[0]?.message ?? "", /'0x20_00_00_00_00_00_01' becomes 9007199254740992/u);

  // A literal spelled exactly as its value keeps quoting itself.
  assert.match(firstMessage("const a = 9007199254740993\n"), /'9007199254740993' becomes 9007199254740992/u);
});

test("[D90 R6] a unit literal takes the same reading of its integer part", () => {
  assert.deepEqual(codes("const d = 9007199254740993ms\n"), ["VEL2017"]);
  assert.match(firstMessage("const d = 9007199254740993ms\n"), /Numeric literals must be exactly representable/u);
  assert.deepEqual(codes("const d = 250ms\nprint(d)\n"), []);
});
