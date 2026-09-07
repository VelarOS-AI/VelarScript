import assert from "node:assert/strict";
import test from "node:test";
import { velarCompilerExtension as webCompilerExtension } from "../../../packages/web/src/compiler.ts";
import { clean, messages } from "../../support/compiler-audit-suite.ts";

/**
 * D115 P5 — what a type position demands and supplies, one subject of the file
 * that was `bounded-generics-and-dispose.slow.test.ts` before it reached 916
 * lines.
 *
 * What is held here is the three rulings about a position that names a type:
 * `unknown` satisfies no bound (NEW-D3), a JSX attribute is a typed position
 * and infers the declared prop type (rule 108), and the bound vocabulary is
 * reserved against every user declaration (rule 109). The harness is in
 * `tests/support/compiler-audit-suite.ts`; the bodies below are the bodies
 * that file had.
 */

// ---------------------------------------------------------------------------
// NEW-D3 — `unknown` satisfies no bound
// ---------------------------------------------------------------------------

test("[NEW-D3] an unknown argument is rejected by a bounded type parameter at the call site", () => {
  const reported = messages(`
def show<T: Text>(value: T):
    print(str(value))
    return null

def probe(raw: unknown):
    show(raw)
    return null
`.trimStart());
  assert.deepEqual(reported, [
    "Type parameter 'T' is bound by Text, so this argument cannot be unknown; "
    + "a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  ]);
});

test("[NEW-D3] an unknown-typed contract is rejected where a bounded generic is used as a value", () => {
  const reported = messages(`
def show<T: Text>(value: T):
    print(str(value))
    return null

def apply(handler: (unknown) -> null, raw: unknown):
    handler(raw)
    return null

apply(show, 42)
`.trimStart());
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /Type parameter 'T' is bound by Text.*solves it to unknown/u);
});

test("[NEW-D3] a concrete argument still solves the parameter when another argument is unknown", () => {
  clean(`
def pick<T: Text>(first: T, second: T) -> string:
    return f"{first}{second}"

def probe(raw: number):
    print(pick(1, raw))
    return null
`.trimStart());
});

// ---------------------------------------------------------------------------
// Rule 108 — a JSX attribute is a typed position
// ---------------------------------------------------------------------------

test("[rule 108] an empty list literal in a JSX attribute infers the declared prop type", () => {
  const reported = messages(`
type Item:
    id: string

component ItemList(items: List<Item>):
    return <p>{str(items.size)}</p>

export component App():
    return <ItemList items={[]} />
`.trimStart(), [webCompilerExtension]);
  assert.deepEqual(reported, []);
});

// ---------------------------------------------------------------------------
// Rule 109 — the bound vocabulary is reserved
// ---------------------------------------------------------------------------

test("[rule 109] a user type, class, enum, alias, or type parameter cannot take a bound's name", () => {
  for (const [source, name, noun] of [
    ["type Data:\n    id: string\n", "Data", "type"],
    ["type Text = string\n", "Text", "type"],
    ["class Comparable:\n    pass\n", "Comparable", "class"],
    ["enum Data:\n    one\n", "Data", "enum"],
    ["def save<Data>(value: Data):\n    return null\n", "Data", "type parameter"],
  ] as const) {
    const reported = messages(source);
    const article = /^[aeiou]/iu.test(noun) ? "an" : "a";
    assert.ok(
      reported.some((message) => message
        === `'${name}' is a reserved type-parameter bound — the bounds are Comparable, Text, Data — so it cannot also name ${article} ${noun}; rename this declaration`
        || message
        === `'${name}' is a reserved type-parameter bound — the bounds are Comparable, Text, Data — so it cannot also name ${article} ${noun}; rename it`),
      `${source}: ${reported.join(" | ")}`,
    );
  }
});
