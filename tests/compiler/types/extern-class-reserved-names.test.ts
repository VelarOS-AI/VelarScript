import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * D114 F6b(d) / RE-I7: an extern class names a *type*, so the words a type
 * position cannot spell as themselves cannot name one. `export class null:`
 * met `expect("identifier")` and unravelled into a run of parse errors, none
 * of which named the rule — the same mistake `class null:` answers with one
 * sentence in an ordinary module. The word is consumed here and reported once,
 * with this position's own word.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[RE-I7] a reserved word naming an extern class in a contract reports once", () => {
  assert.deepEqual(messages(`
extern module "pkg":
    export class null:
        pass
`), ["VEL3007 'null' is a reserved word, so it cannot name an extern class; every use of it would read as the literal"]);
});

test("[RE-I7] the same word in an inline JavaScript contract answers the same way", () => {
  assert.deepEqual(messages(`
extern js \`
export class Q {}
\`:
    export class null:
        pass
`).filter((item) => item.startsWith("VEL3007")), [
    "VEL3007 'null' is a reserved word, so it cannot name an extern class; every use of it would read as the literal",
  ]);
});

test("[RE-I7] a keyword that is not a Core type name is refused the same way", () => {
  assert.deepEqual(messages(`
extern module "pkg":
    export class if:
        pass
`), ["VEL3007 'if' is a reserved word, so it cannot name an extern class; every use of it would read as the keyword"]);
});

test("[RE-I7] a built-in type name naming an extern class keeps the roster sentence", () => {
  assert.deepEqual(messages(`
extern module "pkg":
    export class List:
        pass
`), [
    "VEL3007 'List' is a Core type name, so it cannot also name an extern class;"
    + " every use of it resolves to the built-in. Rename this declaration",
  ]);
});

test("[RE-I7] an ordinary extern class name is unaffected", () => {
  assert.deepEqual(messages(`
extern module "pkg":
    export class Client:
        def send(value: string) -> string
`), []);
});

test("[CO-D2] a guided spelling with a replacement cannot name an extern class either", () => {
  // The head token was asked about only when it was *not* an identifier, so
  // the eleven spellings a type position rewrites — `str`, `Array`, `void`,
  // `boolean` and the rest — declared an extern class that no annotation could
  // then reach: `export class Array:` was accepted and every `-> Array` after
  // it was refused, which is the shape this rule exists to remove.
  for (const [written, guided] of [
    ["str", "string"], ["Array", "List"], ["array", "List"], ["list", "List"], ["dict", "Map"],
    ["set", "Set"], ["String", "string"], ["Number", "number"], ["boolean", "bool"], ["Boolean", "bool"], ["void", "null"],
  ] as const) {
    assert.deepEqual(messages(`
extern module "pkg":
    export class ${written}:
        pass
`), [
      `VEL3007 '${written}' is guided to '${guided}' in every type position, so it cannot name an extern class;`
      + ` every use of it would read as '${guided}'`,
    ], written);
  }
});

test("[CO-D2] the read-only view modifier cannot name one either", () => {
  assert.deepEqual(messages(`
extern module "pkg":
    export class readonly:
        pass
`), [
    "VEL3007 'readonly' is the read-only view modifier, so it cannot name an extern class;"
    + " every use of it would read as the modifier",
  ]);
});

test("[CO-I3] the lexer's own roster names this position 'an extern class' too", () => {
  // `int` and `NaN` are rewritten by the scanner, so the scanner is what states
  // the rule about the word the author wrote — and it read the preceding
  // `class` token without knowing which kind of class body it opened, so an
  // author writing an extern contract was told they could not name "a class".
  assert.deepEqual(messages(`
extern module "pkg":
    export class int:
        pass
`), [
    "VEL3007 'int' is guided to 'number' in every position, so it cannot name an extern class;"
    + " every use of it would read as 'number'",
  ]);
  assert.deepEqual(messages(`
extern module "pkg":
    export class NaN:
        pass
`), [
    "VEL3007 'NaN' is not a literal in VelarScript, so it cannot name an extern class;"
    + " produce the value with arithmetic such as 0 / 0",
  ]);
  // An ordinary class outside a contract still says "a class".
  assert.deepEqual(messages(`
class int:
    const a: string = "x"
`), [
    "VEL3007 'int' is guided to 'number' in every position, so it cannot name a class;"
    + " every use of it would read as 'number'",
  ]);
});

/** Code, message and the exact source the caret underlines. */
function underlined(source: string): readonly string[] {
  const text = source.trimStart();
  return compile(text).diagnostics.map((item) => `${item.code} ${JSON.stringify(text.slice(item.span.start, item.span.end))}`);
}

test("[CO-D2] 'any' is refused here with the sentence the other four positions give", () => {
  // The one name the roster still took. `extern class any:` was accepted, every
  // annotation naming it was refused, and every report landed at those uses —
  // the shape charter §5 refuses a name at its declaration to prevent.
  const sentence = "VEL3007 'any' is not a VelarScript type, so it cannot name an extern class;"
    + " an unchecked boundary value is 'unknown', which is what you annotate";
  assert.deepEqual(messages(`
extern module "pkg":
    export class any:
        get label() -> string
`), [sentence]);
  // The other four positions, for the same sentence with their own word.
  for (const [noun, source] of [
    ["class", "class any:\n    let x: number = 1\n"],
    ["type", "type any:\n    x: number\n"],
    ["enum", "enum any:\n    one\n"],
  ] as const) {
    assert.deepEqual(messages(source), [sentence.replace("an extern class", `${/^[aeiou]/iu.test(noun) ? "an" : "a"} ${noun}`)], noun);
  }
  assert.deepEqual(messages("type Box<any>:\n    x: number\n"), [
    "VEL4021 'any' is not a VelarScript type, so it cannot name a type parameter;"
    + " an unchecked boundary value is 'unknown', which is what you annotate",
  ]);
});

test("[CO-D2] the block's other exports stay known after a refused class name", () => {
  // The refusal is one report about one declaration; the contract around it is
  // still a contract, so a sibling export is callable and its result is typed.
  for (const name of ["any", "bool"]) {
    assert.deepEqual(messages(`
extern js \`
export class ${name} {}
export function helper() { return "y" }
\`:
    export class ${name}:
        get label() -> string
    export def helper() -> string

@main:
    print(helper())
`).length, 1, name);
  }
});

test("[CO-I13] both paths underline the name, and nothing else", () => {
  // The analyzer's half was given the declaration's span, so `export class
  // bool:` and the whole body under it was underlined to say one word in it is
  // wrong; the parser's half has always underlined the word.
  for (const name of ["bool", "number", "string", "object", "Object", "Callable", "any", "List", "Duration"]) {
    assert.deepEqual(underlined(`
extern module "pkg":
    export class ${name}:
        get label() -> string
`).map((item) => item.slice(item.indexOf(" ") + 1)), [JSON.stringify(name)], name);
  }
  for (const name of ["str", "Array", "void", "readonly", "null", "if", "int", "NaN"]) {
    assert.deepEqual(underlined(`
extern module "pkg":
    export class ${name}:
        get label() -> string
`).map((item) => item.slice(item.indexOf(" ") + 1)), [JSON.stringify(name)], name);
  }
});
