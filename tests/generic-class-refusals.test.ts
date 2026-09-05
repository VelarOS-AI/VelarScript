import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * What a generic class refuses, and how it says so. `tests/generic-classes.test.ts`
 * owns the declaration and inference rules; this file holds the three places
 * the 0.28.0 audit found the refusals disagreeing with each other:
 *
 *  - B-D1: `case Round:` against a `Shape<number>` subject was "can never
 *    match" while `is Round` on the same value was accepted;
 *  - B-I1: the missing-fallback advice named `case Shape<number>:`, the one
 *    pattern spelling VEL4022 refuses;
 *  - B-I2: the unsolved-parameter report said "annotate the binding" at two
 *    heads that have no annotation slot.
 */

const shapes = `
class Shape<T>:
    let tag: T? = null

class Round<T> extends Shape<T>:
    let radius: number = 1

class Other<T>:
    let n: T? = null
`.trimStart();

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

// ---------------------------------------------------------------------------
// B-D1: the bare subclass pattern
// ---------------------------------------------------------------------------

test("[B-D1] a bare generic subclass pattern matches an applied base subject", () => {
  // Charter §10: "Bare `is Stack` and `case Stack:` are accepted". The check is
  // an `instanceof`, which says nothing about the arguments, so the pattern
  // stands for every instantiation of `Round` — and a `Round<number>` is a
  // `Shape<number>`. Assignability compares the *applications*, and a bare
  // `Round` has none, so `case` refused code that runs.
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Round:
            return "round"
        case _:
            return "other"
`), []);
});

test("[B-D1] the pattern narrows and the branch runs, exactly as 'is' does", () => {
  assert.equal(run(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Round as round:
            return f"round {round.radius}"
        case _:
            return "other"

def viaIs(value: Shape<number>) -> string:
    if value is Round:
        return "round"
    return "other"

const round: Round<number> = Round()
const shape: Shape<number> = Shape()
print(name(round))
print(name(shape))
print(viaIs(round))
print(viaIs(shape))
`), "round 1\nother\nround\nother\n");
});

test("[B-D1] an unrelated family is still refused, and an applied pattern is still VEL4022", () => {
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Other:
            return "other"
        case _:
            return "shape"
`), ["VEL4001 Type pattern Other can never match Shape<number>"]);
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Round<number>:
            return "round"
        case _:
            return "other"
`), ["VEL4022 Type arguments are erased at runtime, so 'Round<number>' cannot be checked; check 'Round' itself"]);
});

test("[B-D1] the bare base pattern still closes the match, and the subclass pattern still does not", () => {
  // Exhaustiveness counts the pattern exactly as `is` narrowing would: a base
  // pattern proves every subject of that family, a subclass pattern proves
  // only the subjects that are of that subclass.
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Shape:
            return "shape"
`), []);
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Round:
            return "round"
`), [
    "VEL4006 Function 'name' can finish without returning string",
    "VEL4015 Match on Shape<number> is missing a fallback; class hierarchies are open — end with 'case Shape:' or 'case _:'",
  ]);
});

// ---------------------------------------------------------------------------
// B-I1: the fallback advice names a spelling that parses
// ---------------------------------------------------------------------------

test("[B-I1] the missing-fallback advice names the bare class, whatever the subject applies", () => {
  const advice = (subject: string): readonly string[] => messages(`${shapes}
def name(value: ${subject}) -> string:
    match value:
        case Round:
            return "round"
`).filter((message) => message.startsWith("VEL4015"));
  assert.deepEqual(advice("Shape<number>"), [
    "VEL4015 Match on Shape<number> is missing a fallback; class hierarchies are open — end with 'case Shape:' or 'case _:'",
  ]);
  // The monomorphic twin already read this way, and still does.
  assert.deepEqual(messages(`
class Plain:
    let tag: number = 0

class Small extends Plain:
    let size: number = 1

def name(value: Plain) -> string:
    match value:
        case Small:
            return "small"
`).filter((message) => message.startsWith("VEL4015")), [
    "VEL4015 Match on Plain is missing a fallback; class hierarchies are open — end with 'case Plain:' or 'case _:'",
  ]);
});

test("[B-I1] the spelling the advice names compiles", () => {
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Round:
            return "round"
        case Shape:
            return "shape"
`), []);
});

// ---------------------------------------------------------------------------
// B-I2: the remedy at a head with no annotation slot
// ---------------------------------------------------------------------------

const resources = `
class Res<T>:
    let value: T? = null

    @dispose:
        pass

class Seq<T>:
    let items: List<T> = []

    @iterate: return self.items.copy()
`.trimStart();

test("[B-I2] a 'using' head and a 'for … in' head are told what they can actually do", () => {
  // VEL2036 refuses `using r: Res<number> = ...` — a `using` binding takes its
  // type from the initializer — and a `for … in` head has no annotation slot
  // at all, so "annotate the binding" named a line neither author can write.
  assert.deepEqual(messages(`${resources}
def go():
    using r = Res()
    print("used")
`), [
    "VEL4039 Constructing 'Res' leaves type parameter 'T' unsolved; nothing at this position says what it stands for"
    + " — pass an argument that solves it, or acquire it into an annotated 'const' first ('const value: Res<string> = Res(...)')",
  ]);
  assert.deepEqual(messages(`${resources}
def loop():
    for value in Seq():
        print(str(value))
`).filter((message) => message.startsWith("VEL4039")), [
    "VEL4039 Constructing 'Seq' leaves type parameter 'T' unsolved; nothing at this position says what it stands for"
    + " — pass an argument that solves it, or acquire it into an annotated 'const' first ('const value: Seq<string> = Seq(...)')",
  ]);
});

test("[B-I2] every other position keeps 'annotate the binding'", () => {
  assert.deepEqual(messages(`${resources}
def go():
    const r = Res()
    print("made")
`), [
    "VEL4039 Constructing 'Res' leaves type parameter 'T' unsolved; nothing at this position says what it stands for"
    + " — annotate the binding ('const value: Res<string> = Res(...)'), or pass an argument that solves it",
  ]);
});

test("[B-I2] both remedies name a spelling that compiles", () => {
  assert.deepEqual(messages(`${resources}
def go():
    const typed: Res<number> = Res()
    using r = typed
    print("used")

def loop():
    const values: Seq<number> = Seq()
    for value in values:
        print(str(value))
`), []);
});

// ---------------------------------------------------------------------------
// D114 follow-up: a refused pattern counts for nothing
// ---------------------------------------------------------------------------

test("[D114] a refused applied pattern reports once and does not cover the wildcard", () => {
  // The applied pattern is refused by VEL4022, so it may not also be credited
  // as coverage: crediting it made `case _:` look redundant and answered one
  // mistake with two reports.
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Shape<number>:
            return "shape"
        case _:
            return "other"
`), ["VEL4022 Type arguments are erased at runtime, so 'Shape<number>' cannot be checked; check 'Shape' itself"]);
});

test("[D114] a legal bare pattern that covers the subject still makes the wildcard redundant", () => {
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Shape:
            return "shape"
        case _:
            return "other"
`), ["VEL4014 This match branch is already covered"]);
});

test("[D114] exhaustiveness without a wildcard still asks for the bare pattern", () => {
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Shape:
            return "shape"
`), []);
  // Counting for nothing cuts both ways: the refused spelling closes no match
  // either, so the fallback report stands and names the spelling that works.
  assert.deepEqual(messages(`${shapes}
def name(value: Shape<number>) -> string:
    match value:
        case Shape<number>:
            return "shape"
`), [
    "VEL4006 Function 'name' can finish without returning string",
    "VEL4015 Match on Shape<number> is missing a fallback; class hierarchies are open — end with 'case Shape:' or 'case _:'",
    "VEL4022 Type arguments are erased at runtime, so 'Shape<number>' cannot be checked; check 'Shape' itself",
  ]);
});
