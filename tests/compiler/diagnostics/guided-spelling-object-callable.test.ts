import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * D114 item 9 / RE-C3 + RE-U1: `object`, `Object` and `Callable` are guided
 * spellings whose successor is a shape rather than a name. Two of them could be
 * *declared* — `class object:` compiled and ran — while every annotation that
 * tried to reach the declaration was refused, which is exactly the
 * "declaration writable, every use refused" shape charter §5's rule exists to
 * remove. `Object`'s refusal was the shortest sentence in the roster: it named
 * neither the rule nor a replacement.
 */

const GUIDED = [
  ["object", "declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary"],
  ["Object", "declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary"],
  ["Callable", "write an explicit function type such as '(value: string) -> bool'"],
] as const;

/** Every declaring position charter §5 names, as a program that puts one there. */
const POSITIONS: readonly (readonly [string, string, (name: string) => string])[] = [
  ["type", "VEL3007", (name) => `type ${name}:\n    a: string\n`],
  ["class", "VEL3007", (name) => `class ${name}:\n    def a() -> string:\n        return "a"\n`],
  ["enum", "VEL3007", (name) => `enum ${name}:\n    a\n`],
  ["function", "VEL3007", (name) => `def ${name}() -> string:\n    return "a"\n`],
  ["binding", "VEL3007", (name) => `const ${name} = 1\n\n@main:\n    print(str(${name}))\n`],
  ["type parameter", "VEL4021", (name) => `def identity<${name}>(value: string) -> string:\n    return value\n`],
  ["extern class", "VEL3007", (name) => `extern module "pkg":\n    export class ${name}:\n        pass\n`],
];

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

for (const [name, advice] of GUIDED) {
  for (const [position, code, program] of POSITIONS) {
    test(`[RE-U1] '${name}' naming ${position} is refused once`, () => {
      const article = /^[aeiou]/iu.test(position) ? "an" : "a";
      assert.deepEqual(messages(program(name)), [
        `${code} '${name}' is a guided spelling no type position accepts, so it cannot name ${article} ${position}; ${advice}`,
      ]);
    });
  }
}

test("[RE-U1] 'class object:' no longer compiles, so it no longer runs", () => {
  const result = compile(`class object:\n    def label() -> string:\n        return "a"\n\n@main:\n    print(object().label())\n`);
  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.code, null);
});

test("[RE-U1] an annotation keeps the guidance sentence it already had", () => {
  assert.deepEqual(messages(`def take(value: object) -> string:\n    return "a"\n`), [
    "VEL2012 Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary",
  ]);
  assert.deepEqual(messages(`def take(value: Callable) -> string:\n    return "a"\n`), [
    "VEL2012 Write an explicit function type such as '(value: string) -> bool'",
  ]);
});

test("[RE-U1] 'Object' earns the guidance instead of the bare reserved-binding sentence", () => {
  // It is a reserved Core binding too, and that sentence was the shortest in
  // the roster: it named neither the rule nor a replacement.
  assert.deepEqual(messages("const Object = 1\n"), [
    "VEL3007 'Object' is a guided spelling no type position accepts, so it cannot name a binding;"
    + " declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary",
  ]);
  // A position no declaring rule covers keeps the older sentence: a parameter
  // named `Object` would shadow the global the emitted runtime reaches for.
  assert.deepEqual(messages("def take(Object: string) -> string:\n    return Object\n"), [
    "VEL3007 'Object' is a reserved Core binding",
  ]);
});

test("[RE-U1] the three spellings stay ordinary member names and record keys", () => {
  assert.deepEqual(messages(`
type Shape:
    object: string

@main:
    const value: Shape = {object: "a"}
    print(value.object)
`.trimStart()), []);
});
