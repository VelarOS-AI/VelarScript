import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";

/**
 * D89 §同批的文案修正: four spellings that were already errors and stayed
 * errors — only the message was pointing somewhere else. Every assertion here
 * is about the sentence the author reads, so the successor each one names is
 * pinned to the spelling that actually exists.
 */
function reported(source: string): string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function first(source: string, code: string): { readonly message: string; readonly fixed: string } {
  const result = compile(source);
  const item = result.diagnostics.find((candidate) => candidate.code === code);
  assert.ok(item, `${code} was not reported for ${JSON.stringify(source)}: ${reported(source).join(" | ")}`);
  return { message: item.message, fixed: applyMechanicalFixes(source, [item]).text };
}

test("[D89] 'enumerate' names the two-slot loop instead of going unknown with no successor", () => {
  const messages = reported("const values = [1, 2]\nfor pair in enumerate(values):\n    print(str(pair.value))\n");
  assert.ok(
    messages.some((item) => item.startsWith("VEL3008") && item.includes("for value, index in values:")),
    messages.join(" | "),
  );
  assert.ok(messages.every((item) => !item.startsWith("VEL3001")), "the bare unknown-name report is gone");

  // The other half of D89 A2: the loop the message names binds the value
  // first, so the spelling it teaches has to compile.
  assert.deepEqual(compile("const values = [1, 2]\nfor value, index in values:\n    print(str(index) + str(value))\n").diagnostics, []);
});

test("[D89] 'zip' names the List member it became, not a nearest-name guess", () => {
  const messages = reported("const xs = [1, 2]\nconst ys = [3, 4]\nfor pair in zip(xs, ys):\n    print(str(pair.first))\n");
  assert.ok(
    messages.some((item) => item.startsWith("VEL3008") && item.includes("Use 'left.zip(right)'")),
    messages.join(" | "),
  );
  assert.ok(messages.every((item) => !item.includes("did you mean")), "'Map' was never a successor for 'zip'");
  // D114 S3: the spelling the message teaches has to compile.
  assert.deepEqual(compile("const xs = [1, 2]\nfor pair in xs.zip([3, 4]):\n    print(str(pair.first))\n").diagnostics, []);
});

test("[D89] 'range' needs no guidance, so it keeps resolving from the prelude", () => {
  assert.deepEqual(compile("for index in range(3):\n    print(str(index))\n").diagnostics, []);
  assert.deepEqual(compile("const counted = range(1, 4)\nprint(str(counted.size))\n").diagnostics, []);
});

test("[D89] the guidance answers an unresolved name only, so a bound one is untouched", () => {
  assert.deepEqual(compile("const enumerate = 1\nprint(str(enumerate))\n").diagnostics, []);
  assert.deepEqual(compile("def zip(left: number) -> number:\n    return left\n\nprint(str(zip(1)))\n").diagnostics, []);
});

test("[D89] 'with' names 'using', the binding that owns and releases a value", () => {
  const messages = reported("def main():\n    with open() as handle:\n        print(\"x\")\n");
  assert.ok(
    messages.some((item) => item.startsWith("VEL1005") && item.includes("using name = expression")),
    messages.join(" | "),
  );
  assert.ok(messages.every((item) => !item.includes("record spread")), "a context manager is not a record update");
});

test("[D89] 'raise' names 'throw' and carries the one-word rewrite", () => {
  const source = "def main():\n    raise ValidationError(\"bad\")\n";
  const { message, fixed } = first(source, "VEL2026");
  assert.ok(message.includes("'throw'"), message);
  assert.ok(!message.includes("Unknown declaration keyword"), message);
  assert.equal(fixed, "def main():\n    throw ValidationError(\"bad\")\n");
  assert.deepEqual(compile(fixed).diagnostics, []);

  // Recovering as the throw it meant is what lets the thrown value be checked
  // in the same compile rather than behind a skipped declaration.
  assert.ok(
    reported("def main():\n    raise ValidationError\n").some((item) => item.startsWith("VEL4001")),
    "the recovered throw still checks its value",
  );
});

test("[D89] 'raise' stays an ordinary name in every shape that is not the Python statement", () => {
  assert.deepEqual(compile("def raise(value: number) -> number:\n    return value\n\nprint(str(raise(1)))\n").diagnostics, []);
  assert.deepEqual(compile("let raise = 1\nraise = 2\nprint(str(raise))\n").diagnostics, []);
});

test("[D89] a 'self' parameter is reported once, and the report deletes it", () => {
  const only = "class Counter:\n    let count: number = 0\n\n    def bump(self):\n        self.count += 1\n";
  assert.deepEqual(reported(only).length, 1, reported(only).join(" | "));
  const single = first(only, "VEL3007");
  assert.ok(single.message.includes("delete it from the parameter list"), single.message);
  assert.ok(single.message.includes("not a parameter"), single.message);
  assert.equal(single.fixed, "class Counter:\n    let count: number = 0\n\n    def bump():\n        self.count += 1\n");
  assert.deepEqual(compile(single.fixed).diagnostics, []);

  // The deletion reaches the separator, so the remaining list is still legal.
  const trailing = "class Counter:\n    let count: number = 0\n\n    def bump(self, step: number):\n        self.count += step\n";
  const pair = first(trailing, "VEL3007");
  assert.equal(pair.fixed, "class Counter:\n    let count: number = 0\n\n    def bump(step: number):\n        self.count += step\n");
  assert.deepEqual(compile(pair.fixed).diagnostics, []);
});

test("[D89] a constructor's 'self' parameter reads the same report as a method's", () => {
  // `constructor(self, ...)` is the same Python receiver reflex, and it used
  // to land on the bare reserved-binding refusal, which names no fix.
  const source = "class Counter:\n    let count: number\n\n    constructor(self, start: number):\n        self.count = start\n";
  assert.deepEqual(reported(source).length, 1, reported(source).join(" | "));
  const single = first(source, "VEL3007");
  assert.ok(single.message.includes("delete it from the parameter list"), single.message);
  assert.ok(single.message.includes("not a parameter"), single.message);
  assert.equal(single.fixed, "class Counter:\n    let count: number\n\n    constructor(start: number):\n        self.count = start\n");
  assert.deepEqual(compile(single.fixed).diagnostics, []);

  // `self` alone leaves an empty list behind, not a stranded separator.
  const only = "class Counter:\n    let count: number\n\n    constructor(self):\n        self.count = 1\n";
  const bare = first(only, "VEL3007");
  assert.equal(bare.fixed, "class Counter:\n    let count: number\n\n    constructor():\n        self.count = 1\n");
  assert.deepEqual(compile(bare.fixed).diagnostics, []);
});

test("[D89] only a declaration with an implicit receiver claims the 'self' parameter", () => {
  // A plain function and a static method have no instance, so "delete the
  // implicit receiver" would be a lie; the reserved-binding refusal is the
  // truth there and stays.
  for (const source of [
    "def helper(self):\n    print(\"x\")\n",
    "class Counter:\n    static def make(self):\n        print(\"x\")\n",
  ]) {
    assert.ok(reported(source).includes("VEL3007 'self' is a reserved Core binding"), reported(source).join(" | "));
  }
});
