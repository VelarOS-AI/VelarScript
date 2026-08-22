import assert from "node:assert/strict";
import test from "node:test";
import { compile, type CompileResult } from "@velarscript/compiler";

/**
 * D89 立了四条准入门槛却从未整体跑过；这次普查跑了（D90 根因 6,
 * roots-compiler-node 波）。The four gates: a real Python or JavaScript
 * reflex as the source; Vel silently accepting the spelling as *another*
 * meaning; a trigger that narrows to near-zero false positives; a zero-cost
 * rewrite. Two candidates passed all four — A5 (`${...}` in a plain string)
 * and A6 (`${...}` surviving inside an interpolated string) — and this file
 * locks the verdict for every candidate the census walked, so the next
 * census starts from a table instead of from silence.
 *
 * Three verdict classes, each with its own promise:
 *
 * - "already an error": gate 2 fails because Vel refuses the spelling. The
 *   lock is that the refusal stays a refusal — if one of these ever starts
 *   compiling silently, it must come back through the gates.
 * - "same meaning": gate 2 fails because Vel accepts the spelling *as the
 *   reflex meant it* (Vel absorbed much of Python on purpose: chained
 *   comparison, `in`, `range`, negative indexing, `append`, `assert`,
 *   `pass`, `not`, and JavaScript's ternary, `**`, `??`). The lock asserts
 *   silence, and for the two where the meaning was the open question the
 *   emitted module is run to pin it.
 * - "admitted": A5/A6 fire.
 */
function result(source: string): CompileResult {
  return compile(source);
}

function run(source: string): string[] {
  const compiled = result(source);
  assert.deepEqual(compiled.diagnostics.map((item) => item.code), [], source);
  const logged: string[] = [];
  (new Function("console", compiled.code ?? "") as (console: { readonly log: (value: unknown) => void }) => void)({
    log: (value) => { logged.push(String(value)); },
  });
  return logged;
}

test("[D89-census] every already-an-error candidate is still refused", () => {
  const refused: readonly (readonly [string, string])[] = [
    ["Python conditional expression", "const c = true\nconst r = 2 if c else 1\nprint(r)"],
    ["lambda", "const f = lambda x: x + 1\nprint(f(1))"],
    ["list comprehension", "const xs = [1, 2]\nconst ys = [x * 2 for x in xs]\nprint(ys)"],
    ["augmented assignment to an undeclared name", "total += 1\nprint(total)"],
    ["JavaScript .length", "const xs = [1, 2]\nprint(xs.length)"],
    ["f-string !r conversion", 'const x = 1\nprint(f"{x!r}")'],
    ["f-string format spec", 'const x = 3.14\nprint(f"{x:.2f}")'],
    ["percent formatting", 'const r = "hi %s" % "a"\nprint(r)'],
    ["triple-quoted string", 'const s = """hello"""\nprint(s)'],
    ["'is not' null test", "const x: number? = null\nif x is not null:\n    print(\"set\")"],
    ["'is null' identity spelling", "const x: number? = null\nif x is null:\n    print(\"unset\")"],
    ["'== None'", "const x: number? = null\nif x == None:\n    print(\"unset\")"],
    ["floor-division assignment", "let total = 10\ntotal //= 2\nprint(total)"],
    ["increment", "let x = 1\nx++\nprint(x)"],
    ["len()", "const xs = [1]\nprint(len(xs))"],
    ["string repetition", 'const r = "ab" * 3\nprint(r)'],
    ["string + number coercion", 'const r = "a" + 1\nprint(r)'],
    ["===", "const a = 1\nif a === 1:\n    print(\"y\")"],
    ["! negation", "const a = true\nprint(!a)"],
    ["&&", "const a = true\nprint(a && a)"],
    ["value-operand 'is'", "const a = 1\nprint(a is 1)"],
    ["slice syntax", "const xs = [1, 2, 3]\nprint(xs[1:3])"],
    ["elif", "const a = 1\nif a == 1:\n    print(\"1\")\nelif a == 2:\n    print(\"2\")"],
    ["True literal", "const a = True\nprint(a)"],
    ["None literal", "const a = None\nprint(a)"],
    ["del", "let x = 1\ndel x"],
    ["explicit self parameter", "class A:\n    def m(self):\n        print(\"m\")"],
    ["this.", "class A:\n    count = 0\n    def m():\n        print(this.count)"],
    ["JavaScript .push", "let xs = [1]\nxs.push(2)\nprint(xs)"],
    ["in-place .sort()", "let xs = [3, 1]\nxs.sort()\nprint(xs)"],
    ["list + list", "const r = [1] + [2]\nprint(r)"],
    ["list * int", "const r = [0] * 3\nprint(r)"],
    ["str.format", 'print("{}".format(1))'],
    ["dict .get/.keys/.items", 'const m = {"a": 1}\nprint(m.get("a"))'],
    ["','.join", 'print(",".join(["a", "b"]))'],
    [".startswith/.strip", 'print("ab".startswith("a"))'],
    ["comparison against a fresh collection literal", "const xs = [1, 2]\nprint(xs == [1, 2])"],
    ["missing map key as plain index", 'const m = {"a": 1}\nprint(m["b"])'],
    ["chained assignment", "let a = 0\nlet b = 0\na = b = 1\nprint(a)"],
    ["tuple unpacking", "const a, b = 1, 2\nprint(a)"],
    ["walrus", "if (n := 5) > 3:\n    print(n)"],
    ["set literal", "const s = {1, 2}\nprint(s)"],
    ["decorator", "@cached\ndef f() -> number:\n    answer 1"],
    ["semicolon", "const a = 1;\nprint(a)"],
    ["var", "var a = 1\nprint(a)"],
    ["function declaration", "function f() {\n    print(\"x\")\n}"],
    ["typeof", "const x = 1\nprint(typeof x)"],
    ["instanceof", "class A:\n    count = 0\nprint(A() instanceof A)"],
    ["JavaScript delete", 'let m = {"a": 1}\ndelete m["a"]'],
    ["arrow function", "const f = (x) => x + 1\nprint(f(1))"],
    ["spread call", "def f(a: number, b: number) -> number:\n    answer a + b\nprint(f(...[1, 2]))"],
    ["throw of a bare string", 'throw "boom"'],
    ["global", "let x = 1\ndef f():\n    global x\n    x = 2"],
    ["try/except", "try:\n    print(\"a\")\nexcept:\n    print(\"b\")"],
    ["parseInt/JSON.stringify free globals", 'print(parseInt("5"))'],
  ];
  for (const [label, source] of refused) {
    const compiled = result(source);
    assert.notEqual(compiled.diagnostics.length, 0, `${label} must stay an error`);
    assert.deepEqual(compiled.advisories.map((item) => item.code), [], `${label} needs no advisory beside its error`);
  }
});

test("[D89-census] every same-meaning candidate stays silent, with no advisory to pay", () => {
  const absorbed: readonly (readonly [string, string])[] = [
    ["exponentiation", "print(str(2 ** 3))"],
    ["JavaScript ternary", "const c = true\nprint(str(c ? 1 : 2))"],
    ["range()", "for i in range(3):\n    print(str(i))"],
    ["membership 'in'", "const xs = [1, 2]\nif 1 in xs:\n    print(\"has\")"],
    ["'else if'", "const a = 1\nif a == 1:\n    print(\"1\")\nelse if a == 2:\n    print(\"2\")"],
    ["pass", "def f():\n    pass\nf()"],
    ["'not'", "const a = true\nprint(str(not a))"],
    ["assert", "assert 1 == 1"],
    [".append", "let xs = [1]\nxs.append(2)\nprint(str(xs.size))"],
    [".extend", "let xs = [1]\nxs.extend([2, 3])\nprint(str(xs.size))"],
    [".upper()", 'print("a".upper())'],
    ["??", "const x: number? = null\nprint(str(x ?? 5))"],
  ];
  for (const [label, source] of absorbed) {
    const compiled = result(source);
    assert.deepEqual(compiled.diagnostics.map((item) => item.code), [], label);
    assert.deepEqual(compiled.advisories.map((item) => item.code), [], label);
  }
});

test("[D89-census] chained comparison and negative indexing carry Python's meaning, not JavaScript's accident", () => {
  // `3 < 2 < 4` in JavaScript is `(3 < 2) < 4` — `false < 4` — which is true.
  // Vel compiles the chain as the pairwise conjunction Python means, so the
  // spelling is absorbed rather than trapped, and no advisory may fire on it.
  assert.deepEqual(run("print(str(1 < 2 < 3))\nprint(str(3 < 2 < 4))"), ["true", "false"]);

  // `xs[-1]` is the last element, as in Python. In JavaScript the spelling
  // answers undefined, which nobody writes on purpose, so there is no
  // JavaScript reflex to warn and gate 1 fails.
  assert.deepEqual(run("const xs = [1, 2, 3]\nprint(str(xs[-1]))"), ["3"]);
});

test("[D89-census] collection '==' between two bindings is identity, and stays below gate 3", () => {
  // The Python reflex reads `a == b` on two lists as structural. Vel answers
  // identity (D42 keeps SameValueZero), so gate 2 passes — but gate 3 fails:
  // an identity test between two collection bindings is a legitimate
  // JavaScript pattern, and no static trigger separates the two intents. The
  // half that *can* be narrowed — a fresh literal operand, always false — is
  // already an error whose message teaches `equals(a, b)`, so the runtime
  // meaning below is the deliberate remainder, not an oversight.
  const source = "const a = [1, 2]\nconst b = [1, 2]\nprint(str(a == b))\nprint(str(a == a))";
  assert.deepEqual(run(source), ["false", "true"]);
  assert.deepEqual(result(source).advisories, []);
});

test("[D89-census] the two admitted candidates fire, and the braces-only reflex stays out", () => {
  const a5 = result('const name = "x"\nconst s = "Hello ${name}"\nprint(s)');
  assert.deepEqual(a5.advisories.map((item) => item.code), ["A5"]);
  const a6 = result('const name = "x"\nprint(f"Hi ${name}")');
  assert.deepEqual(a6.advisories.map((item) => item.code), ["A6"]);

  // `"Hello {name}"` without any prefix is Python's own missing-f trap: the
  // reflex language keeps it literal too, so Vel's reading is not *another*
  // meaning (gate 2), and JSON-in-a-string makes bare braces hopeless to
  // narrow (gate 3). It stays out of the roster on both counts.
  const braces = result('const s = "Hello {name}"\nprint(s)');
  assert.deepEqual(braces.diagnostics, []);
  assert.deepEqual(braces.advisories, []);
});
