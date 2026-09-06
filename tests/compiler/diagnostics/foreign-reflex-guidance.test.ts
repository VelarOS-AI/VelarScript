import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";

/**
 * D90 (coherence): the positioning claims a model can write VelarScript on its
 * JavaScript and Python priors, and that every rejection names the spelling
 * that replaces it. The foreign-builtin surface was where that claim broke in
 * the worst possible way — not by staying silent but by guessing: `sum` earned
 * "did you mean 'str'?", `max` and `map` earned "did you mean 'Map'?". A model
 * told to do exactly what the diagnostic says would write `Map(scores)`.
 *
 * Every successor named below is compiled here as well as quoted, so a message
 * can never drift onto a spelling that does not exist.
 */
function reported(source: string): string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function guidanceFor(name: string): string {
  const messages = reported(`print(str(${name}(1)))\n`);
  const guidance = messages.find((item) => item.startsWith("VEL3008"));
  assert.ok(guidance, `${name} earned no guidance: ${messages.join(" | ")}`);
  assert.ok(messages.every((item) => !item.includes("did you mean")), messages.join(" | "));
  assert.ok(messages.every((item) => !item.startsWith("VEL3001")), messages.join(" | "));
  return guidance;
}

test("[D90] the Python builtins a model reaches for each name their VelarScript spelling", () => {
  for (const [name, successor] of [
    ["sum", "values.sum()"],
    ["min", "values.min()"],
    ["max", "values.max()"],
    ["sorted", "values.sorted()"],
    ["reversed", "values.reversed()"],
    ["any", "values.some(test)"],
    ["all", "values.every(test)"],
    ["isinstance", "value is Type"],
    ["filter", "values.filter(test)"],
    ["map", "values.map(transform)"],
    ["pow", "Math.pow(base, exponent)"],
  ] as const) {
    assert.ok(guidanceFor(name).includes(successor), `${name} -> ${guidanceFor(name)}`);
  }
});

test("[D90] the two guesses that sent a model somewhere else are gone by name", () => {
  assert.ok(!guidanceFor("sum").includes("str"), guidanceFor("sum"));
  for (const name of ["max", "min", "map"]) {
    assert.ok(!/did you mean/u.test(guidanceFor(name)), guidanceFor(name));
  }
  // `Map` is still named for `map`, but as the thing it is *not*, which is the
  // whole correction.
  assert.ok(guidanceFor("map").includes("not the transform"), guidanceFor("map"));
});

test("[D90] every spelling those messages teach compiles", () => {
  for (const example of [
    "const values: List<number> = [1, 2]\nprint(str(values.sum()))\n",
    "const values: List<number> = [1, 2]\nprint(str(values.min()) + str(values.max()))\n",
    "print(str(Math.min(1, 2)) + str(Math.max(1, 2)))\n",
    "const values: List<number> = [2, 1]\nprint(str(values.sorted().size) + str(values.reversed().size))\n",
    "const values: List<number> = [2, 1]\nprint(str(values.some(value => value > 1)) + str(values.every(value => value > 1)))\n",
    "const values: List<number> = [2, 1]\nprint(str(values.filter(value => value > 1).size) + str(values.map(value => value + 1).size))\n",
    "type Point:\n    x: number\n\ndef check(value: Point | string) -> string:\n    if value is Point:\n        return str(value.x)\n    return value\n",
    "print(str(Math.pow(2, 3)))\n",
    "const a = 7\nconst b = 2\nprint(str((a / b).floor()) + str(a % b))\n",
    "const value = 1\nprint(value)\nprint(str(value))\nprint(Json.stringify(value))\n",
    "const value = 1.234\nconst size = 5\nprint(f\"{value.toFixed(2)}\")\nprint(f\"{str(value).padStart(size)}\")\n",
    "const values: List<number> = [1]\nfor value in values:\n    print(str(value))\n",
    "const pair: List<number> = [1, 2]\nconst named = {first: 1, second: 2}\nprint(str(pair.size) + str(named.first))\n",
    "async def wait():\n    await Promise.sleep(250ms)\n",
    "async def poll():\n    await Promise.sleep(1s)\n",
    "type Point:\n    x: number\n\nconst p: Point = {x: 1}\nprint(str(Json.clone(p, Point).x))\n",
    "print(str(Text.matches(\"abc\", \"a\")) + str(Text.findMatch(\"abc\", \"a\") != null))\n",
    "print(str(Text.findMatches(\"abc\", \"a\").size) + Text.replaceMatches(\"abc\", \"a\", \"b\"))\n",
    "print(str(Text.utf8Size(\"abc\")))\n",
  ]) assert.deepEqual(compile(example).diagnostics, [], example);
});

test("[D90] the two capability answers name the module and say which extension carries it", () => {
  assert.ok(guidanceFor("input").includes("velar/terminal"), guidanceFor("input"));
  assert.ok(guidanceFor("input").includes("terminal.readLine(prompt)"), guidanceFor("input"));
  assert.ok(guidanceFor("open").includes("velar/fs"), guidanceFor("open"));
  assert.ok(guidanceFor("open").includes("using name = ..."), guidanceFor("open"));
  for (const name of ["input", "open"]) {
    assert.ok(guidanceFor(name).includes("@velarscript/node"), guidanceFor(name));
  }
});

test("[D90] the target-neutral host globals name the Core answer, not a target's", () => {
  for (const [name, successor] of [
    ["setTimeout", "Promise.sleep(250ms)"],
    ["setInterval", "Promise.sleep(1s)"],
    ["clearTimeout", "Promise.sleep(250ms)"],
    ["clearInterval", "velar/task"],
    ["structuredClone", "Json.clone(value, Target)"],
    ["RegExp", "Text.findMatches"],
    ["TextEncoder", "Text.utf8Size(value)"],
    ["TextDecoder", "velar/binary"],
    ["URL", "velar/url"],
    ["AbortController", "velar/task"],
    ["Symbol", "no symbol type"],
  ] as const) {
    assert.ok(guidanceFor(name).includes(successor), `${name} -> ${guidanceFor(name)}`);
  }
});

test("[D90] the target-specific globals stay with the extensions that own their successors", () => {
  // `process`, `Buffer`, `require` and the browser storage pair are answered by
  // modules a bare Core module cannot import, so Core says only that the name
  // is unknown — and, since they are foreign builtins, says nothing more.
  for (const name of ["process", "Buffer", "require", "localStorage", "sessionStorage"]) {
    const messages = reported(`print(str(${name}))\n`);
    assert.ok(messages.some((item) => item === `VEL3001 Unknown name '${name}'`), messages.join(" | "));
  }
});

test("[D90] a foreign builtin with no VelarScript answer stops at the bare report", () => {
  // The floor under the curated table: a wrong 'did you mean' is worse than
  // none, so the guess is suppressed for the whole foreign roster.
  for (const name of ["dir", "id", "frozenset", "globals", "locals", "vars", "getattr"]) {
    const messages = reported(`print(str(${name}(1)))\n`);
    assert.ok(messages.some((item) => item === `VEL3001 Unknown name '${name}'`), messages.join(" | "));
    assert.ok(messages.every((item) => !item.includes("did you mean")), messages.join(" | "));
  }
});

test("[D90] an unknown name that is not a foreign builtin keeps its nearest-name hint", () => {
  // The suppression is a roster, not a threshold change: `uniqueNearestName`
  // still answers an ordinary typo, and the closed-record-literal hint reads
  // the same helper.
  const messages = reported("const counter = 1\nprint(str(countr))\n");
  assert.ok(messages.some((item) => item.includes("did you mean 'counter'?")), messages.join(" | "));
});

test("[D90] a foreign builtin the author actually declares is an ordinary name", () => {
  assert.deepEqual(compile("def sum(values: List<number>) -> number:\n    return values.sum()\n\nprint(str(sum([1, 2])))\n").diagnostics, []);
  assert.deepEqual(compile("const filter = 1\nprint(str(filter))\n").diagnostics, []);
});

test("[D90] 'lambda' names the arrow instead of a sentence about newlines", () => {
  const messages = reported("const f = lambda x: x\n");
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(messages[0]!.startsWith("VEL1005"), messages[0]!);
  assert.ok(messages[0]!.includes("value => expression"), messages[0]!);
  assert.ok(!messages[0]!.includes("A statement ends at its newline"), messages[0]!);
  assert.deepEqual(compile("const f = (value: number) => value\nprint(str(f(1)))\n").diagnostics, []);

  // No mechanical fix: rewriting `lambda x: x` needs the parameter list read,
  // which is judgment rather than a substitution.
  assert.equal(compile("const f = lambda x: x\n").diagnostics[0]?.fix, undefined);

  // A record key spelled `lambda` is external data, never the statement.
  assert.deepEqual(compile("const options = {lambda: 1}\nprint(str(options.lambda))\n").diagnostics, []);
});

test("[D90] a 'this' parameter earns one report, and applying its fix reaches a clean module", () => {
  for (const source of [
    "class Session:\n    let active: bool = true\n\n    def close(this):\n        self.active = false\n",
    "class Session:\n    let active: bool = true\n\n    def close(this, force: bool):\n        self.active = force\n",
    "class Counter:\n    let count: number\n\n    constructor(this, start: number):\n        self.count = start\n",
    "class Box:\n    def wrap<T>(this, value: T) -> T:\n        return value\n",
  ]) {
    const result = compile(source);
    assert.equal(result.diagnostics.length, 1, reported(source).join(" | "));
    const only = result.diagnostics[0]!;
    assert.equal(only.code, "VEL3007", only.message);
    assert.ok(only.message.includes("delete it from the parameter list"), only.message);
    const fixed = applyMechanicalFixes(source, result.diagnostics).text;
    assert.ok(!fixed.includes("this"), fixed);
    assert.deepEqual(compile(fixed).diagnostics, [], fixed);
  }
});

test("[D90] 'this' keeps the rename everywhere it is a receiver read rather than a parameter", () => {
  for (const source of [
    "class Counter:\n    let count: number = 0\n\n    def bump():\n        self.count = this.count\n",
    "class Counter:\n    let count: number = 0\n\n    def bump(step: number = 1):\n        self.count = this.count + step\n",
  ]) {
    const messages = reported(source);
    assert.ok(messages.some((item) => item.includes("VelarScript does not expose dynamic 'this'")), messages.join(" | "));
    const fixed = applyMechanicalFixes(source, compile(source).diagnostics).text;
    assert.deepEqual(compile(fixed).diagnostics, [], fixed);
  }
  // A static method has no receiver to delete, so the rename is the honest
  // answer there and the delete report never claims the parameter.
  const staticMethod = "class Counter:\n    static def make(this):\n        print(\"x\")\n";
  assert.ok(reported(staticMethod).some((item) => item.includes("VelarScript does not expose dynamic 'this'")), reported(staticMethod).join(" | "));
  assert.ok(!reported(staticMethod).some((item) => item.includes("delete it from the parameter list")), reported(staticMethod).join(" | "));
});

test("[D90] D89's hybrid two-slot 'for' advisory still fires on all three shapes", () => {
  // The regression pin the D89 suite does not carry: A2 is the advisory that
  // covers `for i, v in nums`, a spelling neither parent language has. R8
  // keeps the slots as `value, index`, so this advisory is the whole answer.
  for (const source of [
    "const nums = [1, 2]\nfor i, v in nums:\n    print(str(i) + str(v))\n",
    "const nums = [1, 2]\nfor index, value in nums:\n    print(str(index) + str(value))\n",
    "const users = [\"a\"]\nfor i, user in users:\n    print(user)\n",
  ]) {
    const advisories = compile(source).advisories.map((item) => `${item.code} ${item.message}`);
    assert.ok(advisories.some((item) => item.startsWith("A2") && item.includes("binds 'value, index'")), `${source}: ${advisories.join(" | ")}`);
  }
  // The slots themselves are unchanged, so the spelling A2 teaches compiles.
  assert.deepEqual(compile("const nums = [1, 2]\nfor value, index in nums:\n    print(str(index) + str(value))\n").diagnostics, []);
});
