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
