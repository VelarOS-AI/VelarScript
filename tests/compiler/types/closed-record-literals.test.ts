import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

// D90 R11: a record literal written at a type-annotated position is closed.
// Before this rule `const o: Options = {retry: 1, timeoutMs: 30}` produced zero
// diagnostics — `timeoutMs` was silently dropped and `timeout` stayed empty,
// which is the misspelling a model makes most often and the one the compiler
// used to say nothing about.
//
// The ruling's boundary is what most of this file defends: only a *literal* is
// closed, because only a literal has all of its keys in front of the compiler.
// Every value that is not a literal keeps today's structural openness, and a
// spread contributes names the author never spelled.

function diagnostics(source: string): string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("an unrecognised key in a literal at an annotated position is refused", () => {
  const required = diagnostics(`
type Options:
    retry: number

const o: Options = {retry: 1, extra: 2}
`);
  assert.deepEqual(required, ["VEL4001 Type 'Options' has no field 'extra'"]);

  // The optional-field variant was equally silent: nothing about `timeout`
  // being optional makes an unknown neighbour of it legal.
  const optional = diagnostics(`
type Options:
    retry: number
    timeout: number?

const o: Options = {retry: 1, extra: 2}
`);
  assert.deepEqual(optional, ["VEL4001 Type 'Options' has no field 'extra'"]);
});

test("a misspelled field names the field the author meant", () => {
  // The "did you mean" reads `uniqueNearestName`, the same roster the member
  // access diagnostic asks; a second edit-distance table for one idea is what
  // rule 3 forbids.
  const misspelled = diagnostics(`
type Options:
    retry: number
    timeout: number?

const o: Options = {retry: 1, timeoutMs: 30}
`);
  assert.deepEqual(misspelled, ["VEL4001 Type 'Options' has no field 'timeoutMs'; did you mean 'timeout'?"]);

  // A structural context reports as the structural member access does.
  const structural = diagnostics(`
let box = {retry: 1}
box = {retry: 2, retrys: 3}
`);
  assert.deepEqual(structural, ["VEL4001 Object has no field 'retrys'; did you mean 'retry'?"]);
});

test("every annotated position closes the literal it receives", () => {
  // A parameter type and a result type are annotations exactly as a `const`'s
  // is, so the rule has one spelling rather than one per position.
  const parameter = diagnostics(`
type Options:
    retry: number

def run(options: Options) -> number:
    return options.retry

const n = run({retry: 1, extra: 2})
`);
  assert.deepEqual(parameter, ["VEL4001 Type 'Options' has no field 'extra'"]);

  const result = diagnostics(`
type Options:
    retry: number

def make() -> Options:
    return {retry: 1, extra: 2}
`);
  assert.deepEqual(result, ["VEL4001 Type 'Options' has no field 'extra'"]);

  const element = diagnostics(`
type Options:
    retry: number

const all: List<Options> = [{retry: 1, extra: 2}]
`);
  assert.deepEqual(element, ["VEL4001 Type 'Options' has no field 'extra'"]);

  // An alias and an optional both unwrap to the same field table, so both
  // close the literal.
  const aliased = diagnostics(`
type Options:
    retry: number

type Alias = Options

const o: Alias? = {retry: 1, extra: 2}
`);
  assert.deepEqual(aliased, ["VEL4001 Type 'Options' has no field 'extra'"]);

  // A nested literal is a literal at an annotated position too — the field's
  // declared type is the annotation.
  const nested = diagnostics(`
type Inner:
    depth: number

type Outer:
    inner: Inner

const o: Outer = {inner: {depth: 1, deph: 2}}
`);
  assert.deepEqual(nested, ["VEL4001 Type 'Inner' has no field 'deph'; did you mean 'depth'?"]);
});

test("a value that is not a literal keeps its structural openness", () => {
  // The ruling's first boundary: a wider variable may still be assigned, because
  // the compiler cannot see that its author meant every key it happens to carry.
  const wider = diagnostics(`
type Options:
    retry: number

const wide = {retry: 1, extra: 2}
const o: Options = wide
`);
  assert.deepEqual(wider, []);

  // The second boundary: a spread's fields were never written here.
  const spread = diagnostics(`
type Options:
    retry: number

const other = {retry: 9, extra: 2}
const o: Options = {...other, retry: 1}
`);
  assert.deepEqual(spread, []);

  // No annotation, no expected field table, nothing to be unrecognised against.
  const unannotated = diagnostics(`
const o = {retry: 1, extra: 2}
`);
  assert.deepEqual(unannotated, []);
});

test("an inherited field is a field of the child", () => {
  // `fieldsOf` returns the merged table, so a literal may write what `Base`
  // declared. If that ever changed, R11 would start rejecting every inherited
  // field written in a literal — this case is here to say so loudly.
  const inherited = diagnostics(`
type Base:
    id: number

type Child extends Base:
    name: string

const c: Child = {id: 1, name: "a"}
`);
  assert.deepEqual(inherited, []);
});

test("a context the compiler cannot decide closes nothing", () => {
  // Two union members that no key discriminates: `contextualObjectType`
  // returns null, so no field table is expected and the check does not fire.
  // Failing open here is the point — the rule may not guess which member the
  // author meant and then report against the wrong one.
  const ambiguous = diagnostics(`
type A:
    value: number

type B:
    value: number

def take(input: A | B) -> number:
    return input.value

const n = take({value: 1, extra: 2})
`);
  assert.deepEqual(ambiguous, []);

  // A discriminant resolves the union to one member, and that member closes
  // the literal.
  const discriminated = diagnostics(`
enum Shape:
    circle
    square

type Circle:
    tag: Shape.circle
    radius: number

type Square:
    tag: Shape.square
    side: number

const s: Circle | Square = {tag: Shape.circle, radius: 1, radiuss: 2}
`);
  assert.deepEqual(discriminated, ["VEL4001 Type 'Circle' has no field 'radiuss'; did you mean 'radius'?"]);
});

test("a Record context declares every string key", () => {
  // `Record<T>` names no fields at all, so none of a literal's keys can be
  // unrecognised; the value contract is checked instead, as it already was.
  const record = diagnostics(`
const counts: Record<number> = {a: 1, b: 2}
`);
  assert.deepEqual(record, []);
});
