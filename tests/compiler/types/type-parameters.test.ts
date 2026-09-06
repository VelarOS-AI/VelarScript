import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "@velarscript/compiler";
import { compile } from "../../support/compiler-suite.ts";

test("type parameter declarations fail closed", () => {
  for (const [source, code, message] of [
    ["def repeat<T, T>(value: T) -> T:\n    return value\n", "VEL4021", /declared more than once/u],
    ["type User:\n    name: string\n\ndef load<User>(value: User) -> User:\n    return value\n", "VEL4021", /shadows an existing type name/u],
    ["def outer<T>(value: T) -> T:\n    def inner(other: T) -> T:\n        return other\n    return value\n", "VEL4021", /belongs to the enclosing function; declare '<T>' on this def/u],
    ["def broken<>():\n    return null\n", "VEL2025", /requires at least one name/u],
    // D55 rule 120 admits `type Box<T>` and, at layer two, `class Stack<T>`;
    // the two forms that still refuse one name the roster rather than the
    // single form that used to be the answer.
    ["type Sides<T> = List<T>\n", "VEL2025", /an alias names one instantiation/u],
    ["enum Color<T>:\n    red\n", "VEL2025", /'def' functions, 'type' records and 'class' declarations take '<T>'/u],
    ["class Panel:\n    get title<T>() -> string:\n        return \"top\"\n", "VEL2023", /cannot declare type parameters/u],
  ] as const) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === code && message.test(item.message)), JSON.stringify(result.diagnostics));
  }

  const unused = compile(`
def tagged<T, U>(value: T) -> T:
    return value

print(tagged("kept"))
`.trimStart());
  assert.deepEqual(unused.diagnostics, []);
});

test("component headers cannot declare type parameters", () => {
  const result = compile("component Card<T>(title: string):\n    return <p>{title}</p>\n");
  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2025"], JSON.stringify(result.diagnostics));
  assert.match(result.diagnostics[0]?.message ?? "", /Component 'Card' cannot declare type parameters; 'def' functions, 'type' records and 'class' declarations take '<T>'/u);
});

test("type parameters are erased and fenced out of runtime checks before emission", () => {
  // Without the analyzer fence these programs would emit 'T.is(value)' and
  // crash at runtime; the fence must keep the emitter from ever seeing T.
  const isFence = compile("def check<T>(value: T) -> bool:\n    return value is T\n");
  assert.equal(isFence.code, null);
  assert.deepEqual(isFence.diagnostics.map((item) => item.code), ["VEL4022"]);
  assert.match(isFence.diagnostics[0]?.message ?? "", /Type parameter 'T' is erased at runtime and cannot be checked/u);

  const containedFence = compile("def check<T>(value: T) -> bool:\n    return value is List<T>\n");
  assert.equal(containedFence.code, null);
  assert.deepEqual(containedFence.diagnostics.map((item) => item.code), ["VEL4022"]);

  const caseFence = compile(`
def check<T>(value: T) -> bool:
    match value:
        case T:
            return true
        case _:
            return false
`.trimStart());
  assert.equal(caseFence.code, null);
  assert.deepEqual(caseFence.diagnostics.map((item) => item.code), ["VEL4022"]);
});

test("generic declarations format idiomatically without touching comparisons", () => {
  const canonical = "def first<T>(items: List<T>) -> T?: return items.get(0)\n";
  assert.equal(formatSource(canonical), canonical);
  assert.equal(formatSource("def first < T > (items: List<T>) -> T?:\n    return items.get(0)\n"), canonical);
  const multiple = "def swap<T, U>(a: T, b: U): return null\n";
  assert.equal(formatSource(multiple), multiple);
  const runtimeType = "def decode<T>(value: unknown, target: Type<T>) -> T: return target.parse(value)\n";
  assert.equal(formatSource("def decode < T > (value: unknown, target: Type < T >) -> T:\n    return target.parse(value)\n"), runtimeType);
  assert.equal(formatSource("const smaller = a < b\n"), "const smaller = a < b\n");
  assert.equal(formatSource("const chained = a < b > c\n"), "const chained = a < b > c\n");
});

test("[CO-U5] a refused type-parameter name is reported once, not once per use", () => {
  // The refusal declares nothing, so the annotations that then read the word
  // are reading the mistake it already explained. `def f<str>(x: str) -> str`
  // earned three reports for one word, `type Box<Callable>` two, and
  // `<null>` one — the count followed how often the body happened to mention
  // it, which is not a fact about the mistake.
  const parameter = compile("def f<str>(x: str) -> str:\n    return x\n");
  assert.deepEqual(parameter.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4021 'str' is guided to 'string' in every type position, so it cannot name a type parameter;"
    + " every use of it would read as 'string'",
  ]);
  const record = compile("type Box<Callable>:\n    item: Callable\n");
  assert.deepEqual(record.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4021 'Callable' is a guided spelling no type position accepts, so it cannot name a type parameter;"
    + " write an explicit function type such as '(value: string) -> bool'",
  ]);
  // A guided spelling that no declaration refused is still reported wherever
  // it is written: this rule silences the echo, not the mistake.
  const ordinary = compile("def h(x: str) -> str:\n    return x\n");
  assert.deepEqual(ordinary.diagnostics.map((item) => item.code), ["VEL2012", "VEL2012"]);
});
