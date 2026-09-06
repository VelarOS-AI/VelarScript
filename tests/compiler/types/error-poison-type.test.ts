import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * AS-I7: an `unknown` born from a diagnostic used to flow downstream and earn a
 * second report — on a line that was already correct. `types/model.ts` already
 * had the answer (`invalidType`, which assignability, member access, f-string
 * rendering, `await` and the operators all pass over in silence); the sites
 * that reported and then handed back `unknownType` are what leaked.
 *
 * The distinction that has to survive is the one this file exists to hold: a
 * *genuine* `unknown` — a value a program annotated, or a boundary handed over
 * — still earns every report it earned before.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[AS-I7] an unresolved name is reported once, not again at its first use", () => {
  assert.deepEqual(messages(`
@main:
    const v = nosuchname
    print(f"{v}")
`), ["VEL3001 Unknown name 'nosuchname'"]);
});

test("[AS-I7] a refused await, index, member and namespace member each report once", () => {
  assert.deepEqual(messages(`
@main:
    const v = await 5
    print(f"{v}")
`), ["VEL4001 Cannot await number"]);

  assert.deepEqual(messages(`
@main:
    const s = "abc"
    print(f"{s[0]}")
`), ["VEL4001 Use '.char(index)'; strings are not indexable and string positions count Unicode code points"]);

  assert.deepEqual(messages(`
@main:
    try:
        throw Error("x")
    catch error:
        print(f"{error.path}")
`), ["VEL4001 Class 'Error' has no member 'path'"]);

  assert.deepEqual(messages(`
@main:
    const v = await Promise.allSettled([])
    print(f"{v}")
`), [
    "VEL4001 Promise has no member 'allSettled'; Promise.all is the whole-list wait, and 'try await' turns one failure"
    + " into null — map each task through it and every result is a value",
  ]);
});

test("[AS-I7] a retired namespace import reports at its specifier and nowhere else", () => {
  assert.deepEqual(messages(`
import * as collections from "velar/collections"

@main:
    const v = collections.groupBy([1], x => x)
    print(f"{v}")
`), [
    "VEL3008 velar/collections retired into checked List members; drop the namespace import and call the member on the List"
    + " — values.groupBy(key)",
  ]);
});

test("[AS-I7] a real unknown value still earns the f-string refusal", () => {
  assert.deepEqual(messages(`
def go(value: unknown):
    print(f"{value}")

@main:
    go(1)
`).map((message) => message.slice(0, 30)), ["VEL4026 An f-string renders st"]);
});

test("[AS-I7] a real unknown value still earns the member and await refusals", () => {
  assert.deepEqual(messages(`
def go(value: unknown):
    print(f"{value.size}")

@main:
    go(1)
`).map((message) => message.slice(0, 45)), ["VEL4001 Cannot access 'size' on unknown witho"]);

  assert.deepEqual(messages(`
async def go(value: unknown):
    await value

@main:
    print("x")
`).map((message) => message.slice(0, 30)), ["VEL4001 Cannot await unknown; "]);
});

test("[CO-I5] the loop was the last slot the error type still leaked through", () => {
  // Nine other shapes were already clean; `for … in` was not, so one misspelt
  // name earned three reports — "Cannot iterate over unknown", and then one at
  // every read of the slot it bound.
  assert.deepEqual(messages(`
@main:
    const v = nosuchname
    for item in v:
        print(str(item))
`), ["VEL3001 Unknown name 'nosuchname'"]);
  assert.deepEqual(messages(`
@main:
    const v = nosuchname
    for value, index in v:
        print(f"{index}")
        print(str(value))
`), ["VEL3001 Unknown name 'nosuchname'"]);
});

test("[CO-I5] a value that genuinely cannot be iterated still says so", () => {
  assert.deepEqual(
    messages(`
@main:
    const n = 5
    for item in n:
        print("x")
`),
    ["VEL4001 Cannot iterate over number"],
  );
});
