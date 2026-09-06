import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * MD-I5: `is` discriminates an `unknown` value and `match` refused to. One
 * question about a boundary value had two answers, and the refusal was the one
 * that made the checked form unwritable — the neighbour of the 0.28.0 B-D1
 * pair, where `case` refused what `is` accepted for a generic subclass.
 *
 * Coverage over `unknown` is never complete without `case _:`, for the same
 * reason an extern subject accepts only the wildcard: the value is whatever the
 * boundary handed over, so no set of patterns proves it.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

const formatter = `
class Formatter:
    def format(value: number) -> string:
        return f"{value}"
`;

test("[MD-I5] 'match' discriminates a class on an unknown subject, as 'is' does", () => {
  assert.deepEqual(messages(`${formatter}
def go(value: unknown):
    if value is Formatter:
        print(value.format(1))

@main:
    go(Formatter())
`), []);

  assert.deepEqual(messages(`${formatter}
def go(value: unknown):
    match value:
        case Formatter:
            print(value.format(1))
        case _:
            print("other")

@main:
    go(Formatter())
`), []);
});

test("[MD-I5] exhaustiveness over unknown needs the wildcard", () => {
  assert.deepEqual(messages(`${formatter}
def go(value: unknown):
    match value:
        case Formatter:
            print(value.format(1))

@main:
    go(Formatter())
`), [
    "VEL4015 Match on unknown is missing a fallback; an unchecked value can be anything, so no set of patterns covers it"
    + " — end with 'case _:'",
  ]);
});

test("[MD-I5] the arm narrows: the matched value answers the class's members", () => {
  const result = compile(`${formatter}
def go(value: unknown) -> string:
    match value:
        case Formatter:
            return value.format(1)
        case _:
            return "other"

@main:
    print(go(Formatter()))
`.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
});

test("[MD-I5] a declared subject is unchanged", () => {
  assert.deepEqual(messages(`
enum Color:
    red
    green

def go(value: Color) -> string:
    match value:
        case Color.red:
            return "r"
`), [
    "VEL4006 Function 'go' can finish without returning string",
    "VEL4015 Match on Color is missing: green",
  ]);
});
