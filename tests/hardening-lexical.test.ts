import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code });
}

function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function messages(source: string): string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

const tick = String.fromCharCode(0x60);

test("[D46 80] backtick strings share plain, interpolated, raw, and raw-interpolated semantics", () => {
  const source = [
    'const name = "Nova"',
    `const json = ${tick}{"name":"Nova","role":"admin"}${tick}`,
    `const escaped = ${tick}literal \\${tick} and \\"quote\\"${tick}`,
    `const templateSource = ${tick}const label = \${name}${tick}`,
    `const rich = f${tick}{name}: {1 + 2}${tick}`,
    `const raw = r${tick}C:\\dir\\{"x"}${tick}`,
    `const rawRich = rf${tick}C:\\{name}${tick}`,
    "print(json)",
    "print(escaped)",
    "print(templateSource)",
    "print(rich)",
    "print(raw)",
    "print(rawRich)",
    `print(str(${tick}same${tick} == "same"))`,
    `print(${tick}left${tick} + "right")`,
    "",
  ].join("\n");
  assert.equal(run(source), [
    '{"name":"Nova","role":"admin"}',
    'literal ` and "quote"',
    "const label = ${name}",
    "Nova: 3",
    'C:\\dir\\{"x"}',
    "C:\\Nova",
    "true",
    "leftright",
    "",
  ].join("\n"));
});

test("[D46 80] f-backticks keep JavaScript template syntax literal while Velar interpolation stays explicit", () => {
  const source = [
    'const name = "Ada"',
    `print(f${tick}\${name}: {name}${tick})`,
    "",
  ].join("\n");
  assert.equal(run(source), "${name}: Ada\n");
  assert.equal(
    formatSource(`const name="Ada"\nconst value=f${tick}\${name+raw} {name+"!"}${tick}\n`),
    `const name = "Ada"\nconst value = f"\${name+raw} {name + \"!\"}"\n`,
  );
});

test("[D46 80] inline newline and single-quote reflexes retain directed diagnostics", () => {
  assert.deepEqual(messages(`const value = ${tick}first\n`), [
    "Inline strings cannot contain a line break; use a double-quoted layout string with the opening quote at the end of its line",
  ]);
  assert.deepEqual(messages("print('value')\n"), [
    "Use double quotes or backticks for strings; single-quoted strings are not part of VelarScript",
  ]);
});

test("[D46 80] formatter chooses the delimiter with fewer escapes and is idempotent", () => {
  const source = [
    'const plain="value"',
    'const quoted="He said \\"hello\\""',
    `const tied=${tick}a " and \\${tick}${tick}`,
    `const fewer=${tick}"one" and "two" plus \\${tick}${tick}`,
    "",
  ].join("\n");
  const formatted = formatSource(source);
  assert.equal(formatted, [
    'const plain = "value"',
    `const quoted = ${tick}He said "hello"${tick}`,
    'const tied = "a \\" and `"',
    `const fewer = ${tick}"one" and "two" plus \\${tick}${tick}`,
    "",
  ].join("\n"));
  assert.equal(formatSource(formatted), formatted);
  assert.equal(run(`${formatted}print(plain + quoted + tied + fewer)\n`), 'valueHe said "hello"a " and `"one" and "two" plus `\n');
  assert.equal(
    formatSource('const escaped="He said \\"hi\\" \\u{1F525}\\n"\n'),
    `const escaped = ${tick}He said "hi" \\u{1F525}\\n${tick}\n`,
  );
});

test("[D47 82/TXT-I3] Unicode escapes execute across delimiters and apostrophe escapes are accepted", () => {
  const source = [
    'print("\\u{1F525}")',
    `print(${tick}\\u{1F525}${tick})`,
    'print(f"fire=\\u{1F525} {1}")',
    'print(r"\\u{1F525}")',
    'print("don\\\'t")',
    "",
  ].join("\n");
  assert.equal(run(source), "🔥\n🔥\nfire=🔥 1\n\\u{1F525}\ndon't\n");
});

test("[D47 82] invalid Unicode escape forms receive one exact teaching message", () => {
  const cases = new Map([
    ['print("\\uD83D")\n', "Use a braced Unicode escape such as '\\u{E9}'; '\\uXXXX' escapes are not part of VelarScript"],
    ['print("\\x41")\n', "Use a braced Unicode escape such as '\\u{E9}'; '\\xNN' escapes are not part of VelarScript"],
    ['print("\\u{}")\n', "A Unicode escape must be '\\u{' followed by 1 to 6 hexadecimal digits and '}'"],
    ['print("\\u{110000}")\n', "A Unicode escape cannot exceed U+10FFFF"],
    ['print("\\u{D800}")\n', "A Unicode escape cannot encode a surrogate from U+D800 through U+DFFF"],
  ]);
  for (const [source, expected] of cases) assert.deepEqual(messages(source), [expected]);
});

test("[D47 82] bidi controls are forbidden everywhere and escaped bidi text remains available", () => {
  const rlo = String.fromCodePoint(0x202e);
  for (const source of [`// hidden ${rlo}\nprint(1)\n`, `print("hidden ${rlo}")\n`, `/* hidden ${rlo} */\nprint(1)\n`]) {
    assert.deepEqual(messages(source), [
      "Bidirectional control U+202E cannot appear directly in VelarScript source; write it inside a string as '\\u{202E}' so the source remains reviewable",
    ]);
  }
  assert.deepEqual(messages(`print(f"{1${rlo} + 1}")\n`), [
    "Bidirectional control U+202E cannot appear directly in VelarScript source; write it inside a string as '\\u{202E}' so the source remains reviewable",
  ]);
  assert.equal(run('print("left\\u{202E}right")\n'), `left${rlo}right\n`);
});

test("[D47 82] literal controls are visible escapes while emoji joiners and selectors stay legal", () => {
  for (const codePoint of [0, 0x09, 0x1f, 0x7f, 0x80, 0x9f]) {
    assert.deepEqual(messages(`print("a${String.fromCodePoint(codePoint)}b")\n`), [
      `Control character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} must be written with a '\\u{...}' escape inside a string literal`,
    ]);
  }
  assert.equal(run('print("👨‍👩‍👧 ❤️")\n'), "👨‍👩‍👧 ❤️\n");
});

test("[D30 18/T-6/D83] separated and radix literals execute while invalid literal reflexes are directed", () => {
  assert.equal(run("print(1_000.5)\nprint(1e1_0)\n"), "1000.5\n10000000000\n");
  assert.equal(run("print(0xFF)\nprint(0b101)\nprint(0o17)\n"), "255\n5\n15\n");
  assert.equal(formatSource("const value=1_000.5+1e1_0\n"), "const value = 1_000.5 + 1e1_0\n");
  for (const source of ["print(1__000)\n", "print(1_)\n", "print(1_.0)\n", "print(1._0)\n", "print(1e_2)\n"]) {
    assert.ok(messages(source).includes("Numeric separators must appear only between digits"), source);
  }
  const exact = new Map([
    ["print(007)\n", "Remove the leading zeros; octal literals are not part of VelarScript"],
    ["print(0x1G)\n", "Invalid digit in hexadecimal integer literal"],
    ["print(0b102)\n", "Invalid digit in binary integer literal"],
    ["print(0o178)\n", "Invalid digit in octal integer literal"],
    ["print(.5)\n", "Write '0.5'; decimal literals require a digit before the point"],
    ["print(5.)\n", "Write '5.0'; decimal literals require a digit after the point"],
    ["print(Infinity)\n", "Infinity is not a literal in VelarScript; produce it with arithmetic such as 1 / 0"],
    ["print(NaN)\n", "NaN is not a literal in VelarScript; produce it with arithmetic such as 0 / 0 and detect it with value.isNaN()"],
  ]);
  for (const [source, expected] of exact) assert.deepEqual(messages(source), [expected]);
});

test("[D30 18] numeric separators compose with extension-owned unit suffixes", async () => {
  const { velarCompilerExtension } = await import("../packages/web/src/compiler.ts");
  const result = compile("const width = 1_000px\n", { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /1000/u);
});

test("[D30 17/GRM-D2] pure expression statements are rejected while effect shapes retain their owners", () => {
  const result = compile(`
let x = 1
let optional: number? = 1
const values = [1, 2]
x == 5
42
x
x + 1
optional ?? 5
true ? 1 : 2
values[0]
[1, 2]
-x
not true
"docstring"
`.trimStart());
  assert.equal(result.diagnostics.filter((item) => item.code === "VEL4030").length, 11);
  assert.ok(result.diagnostics.some((item) => item.message === "This comparison result is discarded; use '=' to assign, or use the result"));
  assert.ok(result.diagnostics.some((item) => item.message === "A bare string is not a docstring; use '//' for a comment, or use the string value"));

  const effects = compile(`
let x = 1
def touch():
    x += 1
touch()
x = 3
`.trimStart());
  assert.deepEqual(effects.diagnostics, []);

  const increment = messages("let i = 1\n++i\n");
  assert.ok(increment.includes("VelarScript has no '++'; write 'i += 1'"));
  const pureMethod = compile('const text = " value "\ntext.trim()\n');
  assert.deepEqual(pureMethod.diagnostics.map((item) => item.code), ["VEL4029"]);
});

test("[D30 20/GRM-A1] only one-way ordered comparison chains survive", () => {
  assert.equal(run("print(1 < 2 <= 3)\nprint(3 >= 2 > 1)\n"), "true\ntrue\n");
  assert.deepEqual(messages("print(1 < 2 > 1)\n"), [
    "Comparison chains must point one way; split the comparisons with 'and'",
  ]);
  // Before this gate the Python-style pairwise reading made three false
  // operands report true. The spelling now has no executable output at all.
  assert.deepEqual(messages("print(false == false == false)\n"), [
    "Equality comparisons do not chain; split the comparisons with 'and'",
  ]);
  assert.equal(executeModule("console.log(false === false === false)\n").stdout, "false\n");
});

test("[D30 20/GRM-A2] membership and type tests require grouping inside comparisons", () => {
  const directed = "Parenthesize an 'in' or 'is' test used inside another comparison, or split the tests with 'and'";
  assert.deepEqual(messages("print(1 < 2 in [true])\n"), [directed]);
  assert.deepEqual(messages("print(1 in [1] == true)\n"), [directed]);
  assert.deepEqual(messages("const value: unknown = 1\nprint(value is number == true)\n"), [directed]);
  assert.equal(run("print((1 < 2) in [true])\n"), "true\n");
});

test("[D30 19] prefix-not membership teaches the natural negative operator", () => {
  assert.deepEqual(messages("print(not 1 in [1])\n"), [
    "Use 'x not in y'; 'not x in y' puts 'not' on the wrong operand",
  ]);
});

test("[D36 40.1] block comments nest, preserve layout, and enforce multiline line discipline", () => {
  const source = [
    "/*",
    "outer",
    "/* nested */",
    "*/",
    "const value = /* inline */ 7",
    "print(value)",
    "",
  ].join("\n");
  assert.equal(run(source), "7\n");
  const formatted = formatSource(`if true:\n  /*\n  outer\n  /* nested */\n  */\n  print(1)\n`);
  assert.equal(formatSource(formatted), formatted);
  assert.match(formatted, /^ {4}\/\*/mu);
  assert.deepEqual(messages("const value = /* note\n*/ 1\n"), [
    "A multiline block comment must occupy whole lines: write only '/*' on its opening line and only '*/' on its closing line",
  ]);
  assert.deepEqual(messages("/* missing\n"), ["Unterminated block comment; close it with '*/'"]);
});

test("[D46 80] backtick strings are accepted in JSX attribute and Look expression positions", async () => {
  const { velarCompilerExtension } = await import("../packages/web/src/compiler.ts");
  const source = [
    `const card = look:`,
    `    content = ${tick}hello "reader"${tick}`,
    "",
    "component Probe:",
    `    return <p data-json={${tick}{"name":"Nova"}${tick}} look={card}>ok</p>`,
    "",
  ].join("\n");
  const result = compile(source, { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /Nova/u);
});
