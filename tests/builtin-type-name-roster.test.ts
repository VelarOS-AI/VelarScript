import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * RE-I1 through RE-I7 and RE-C1/RE-C2: the 0.29.0 roster's missing cells.
 *
 * One rule runs through all of them — a name a type position cannot spell as
 * itself is refused where it is declared, once, in the author's own words.
 * The cells that leaked were: a bare Core generic in a type position (which
 * answered "Unknown type 'List'", a sentence the same compiler contradicts one
 * line later), a guided spelling whose target is generic (which earned that
 * false sentence on top of its guidance), the spellings the lexer rewrites
 * (which reported the rule against a token nobody wrote), the type-parameter
 * list, and the two `extern class` spellings.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[RE-I3] a bare Core generic in a type position earns the arity sentence a user generic earns", () => {
  assert.deepEqual(messages(`
type Rec<T>:
    value: T

@main:
    const a: Rec = {value: 1}
    const c: List = []
    const d: Map = Map()
    const e: Set = Set()
    const g: Record = {}
    const h: Type = 1
    print("x")
`), [
    "VEL4001 Generic type 'Rec' needs a type argument; write 'Rec<T>' with concrete types",
    "VEL4001 Generic type 'List' needs a type argument; write 'List<T>' with concrete types",
    "VEL4001 Generic type 'Map' needs 2 type arguments; write 'Map<K, V>' with concrete types",
    "VEL4001 Generic type 'Set' needs a type argument; write 'Set<T>' with concrete types",
    "VEL4001 Generic type 'Record' needs a type argument; write 'Record<T>' with concrete types",
    "VEL4001 Generic type 'Type' needs a type argument; write 'Type<T>' with concrete types",
  ]);
});

test("[RE-I3] a written type argument is what the sentence asks for", () => {
  assert.deepEqual(messages(`
@main:
    const c: List<number> = []
    const d: Map<string, number> = Map()
    print(f"{c.size + d.size}")
`), []);
});

test("[RE-I4] a guided spelling whose target is generic reports the guidance and nothing else", () => {
  assert.deepEqual(messages(`
@main:
    const a: Array = []
    const b: dict = Map()
    const c: list = []
    print("x")
`), [
    "VEL2012 Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type",
    "VEL2012 Use 'Map<K, V>' for keyed collections",
    "VEL2012 Use 'List<T>' for ordered collections",
  ]);
});

const rewritten: readonly (readonly [string, string])[] = [
  ["int", "'int' is guided to 'number' in every position, so it cannot name %; every use of it would read as 'number'"],
  ["float", "'float' is guided to 'number' in every position, so it cannot name %; every use of it would read as 'number'"],
  ["undefined", "'undefined' is guided to 'null' in every position, so it cannot name %; every use of it would read as 'null'"],
  ["NaN", "'NaN' is not a literal in VelarScript, so it cannot name %; produce the value with arithmetic such as 0 / 0"],
  ["Infinity", "'Infinity' is not a literal in VelarScript, so it cannot name %; produce the value with arithmetic such as 1 / 0"],
];

const declarationForms: readonly (readonly [string, string, (name: string) => string])[] = [
  ["type", "a type", (name) => `type ${name}:\n    a: number\n`],
  ["class", "a class", (name) => `class ${name}:\n    pass\n`],
  ["enum", "an enum", (name) => `enum ${name}:\n    a\n`],
  ["def", "a function", (name) => `def ${name}() -> number:\n    return 1\n`],
  ["const", "a binding", (name) => `const ${name} = 1\n`],
];

test("[RE-I1/RE-I2] a lexer-rewritten spelling in a declaring position reports once, in the author's word", () => {
  for (const [name, template] of rewritten) {
    for (const [, noun, source] of declarationForms) {
      assert.deepEqual(messages(source(name)), [`VEL3007 ${template.replace("%", noun)}`], `${name} as ${noun}`);
    }
  }
});

test("[RE-I1/RE-I2] the same words outside a declaring position keep their own reports", () => {
  // `NaN` is refused wherever it is written; the point is that the report is
  // the lexical one and carries no declaration sentence.
  assert.deepEqual(messages(`
@main:
    const x = NaN
    print(f"{x}")
`), ["VEL1007 NaN is not a literal in VelarScript; produce it with arithmetic such as 0 / 0 and detect it with value.isNaN()"]);
  assert.deepEqual(messages(`
@main:
    print(f"{1 / 0}")
`), []);
});

test("[RE-C2/RE-I6] a type parameter refuses the spellings no annotation can reach", () => {
  assert.deepEqual(messages(`
def identity<str>(value: number) -> number:
    return value
`), ["VEL4021 'str' is guided to 'string' in every type position, so it cannot name a type parameter; every use of it would read as 'string'"]);
  assert.deepEqual(messages(`
def identity<Array>(value: number) -> number:
    return value
`), ["VEL4021 'Array' is guided to 'List' in every type position, so it cannot name a type parameter; every use of it would read as 'List'"]);
  assert.deepEqual(messages(`
type Box<readonly>:
    value: number
`), ["VEL4021 'readonly' is the read-only view modifier, so it cannot name a type parameter; every use of it would read as the modifier"]);
  assert.deepEqual(messages(`
def identity<null>(value: number) -> number:
    return value
`), ["VEL4021 'null' is a reserved word, so it cannot name a type parameter; every use of it would read as the literal"]);
});

test("[RE-C2] an ordinary type parameter is unchanged", () => {
  assert.deepEqual(messages(`
def identity<T>(value: T) -> T:
    return value

@main:
    print(f"{identity(1)}")
`), []);
});

test("[RE-I7] both extern spellings refuse a Core type name as an extern class", () => {
  assert.deepEqual(messages(`
extern module "some-lib":
    export class List:
        constructor()
    export class Promise:
        constructor()
    export class Text:
        constructor()

@main:
    print("x")
`), [
    "VEL3007 'List' is a Core type name, so it cannot also name an extern class; every use of it resolves to the built-in. Rename this declaration",
    "VEL3007 'Promise' is a Core type name, so it cannot also name an extern class; every use of it resolves to the built-in. Rename this declaration",
    "VEL4021 'Text' is a reserved type-parameter bound — the bounds are Comparable, Text, Data — so it cannot also name an extern class; rename this declaration",
  ]);
  assert.deepEqual(messages(`
extern js \`
export class List {}
\`:
    export class List:
        constructor()

@main:
    print("x")
`), ["VEL3007 'List' is a Core type name, so it cannot also name an extern class; every use of it resolves to the built-in. Rename this declaration"]);
});

test("[RE-I7] an extern class with an ordinary name is unchanged", () => {
  assert.deepEqual(messages(`
extern module "some-lib":
    export class Formatter:
        constructor()

@main:
    print("x")
`), []);
});

test("[RE-I5/RE-C1] 'any' names no type in any declaring position", () => {
  assert.deepEqual(messages("type any:\n    a: number\n"), [
    "VEL3007 'any' is not a VelarScript type, so it cannot name a type; an unchecked boundary value is 'unknown', which is what you annotate",
  ]);
  assert.deepEqual(messages("class any:\n    pass\n"), [
    "VEL3007 'any' is not a VelarScript type, so it cannot name a class; an unchecked boundary value is 'unknown', which is what you annotate",
  ]);
  assert.deepEqual(messages("def identity<any>(value: number) -> number:\n    return value\n"), [
    "VEL4021 'any' is not a VelarScript type, so it cannot name a type parameter; an unchecked boundary value is 'unknown', which is what you annotate",
  ]);
  // The annotation position keeps its own longer sentence, which teaches the
  // whole entrance; both say the same thing about the same word.
  assert.deepEqual(messages(`
@main:
    const v: any = 1
    print(f"{v}")
`).map((message) => message.slice(0, 52)), ["VEL4001 'any' is not a VelarScript type; a foreign v"]);
});
