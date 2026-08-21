import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

// D90 rule R5: `parse` returns a copy, not an alias. "Validated" now means "and
// it stays valid" rather than "it was correct at the instant of the check", so
// a write through the source after the fact cannot falsify a field the caller
// was handed, a value reached through a `readonly` view does not widen by
// passing through `parse`, and a frozen source no longer poisons a later write.

function emit(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.ok(result.code !== null);
  return result.code;
}

function execute(code: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code, timeout: 20_000 });
}

/** Runs a compiled program with a JavaScript epilogue appended to the same module. */
function run(source: string, epilogue = ""): string {
  const result = execute(`${emit(source)}\n${epilogue}`);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
}

test("parse through a readonly view does not hand back mutable authority over the caller's data", () => {
  // compiler-back-7: `def audit(view: readonly Profile)` used to write into the
  // caller's list through the alias `parse` returned.
  const output = run(`
type Check:
    id: string

type Profile:
    tags: List<Check>

def audit(view: readonly Profile) -> number:
    const back = Profile.parse(view)
    back.tags.append({ id: "written through a readonly parameter" })
    return back.tags.size

def main():
    const p: Profile = { tags: [] }
    print(audit(p))
    print(p.tags.size)
main()
`);
  assert.equal(output, "1\n0\n");
});

test("mutating the source after parse cannot falsify a validated field's type", () => {
  // compiler-back-21: `raw["retries"] = "oops"` made a statically-`number`
  // field hold a string, so the emitter's numeric `+` string-concatenated.
  const output = run(`
type Config:
    retries: number

def main():
    let raw: Record<unknown> = {retries: 1}
    const cfg = Config.parse(raw)
    raw["retries"] = "oops"
    print(f"{cfg.retries * 2}")
    print(f"{cfg.retries + 1}")
    print(f"{cfg.retries.isInteger()}")
main()
`);
  assert.equal(output, "2\n2\ntrue\n");
});

test("a frozen source parses and the following field write works instead of dying with a host TypeError", () => {
  // compiler-back-25: the record predicate accepts a frozen object per charter
  // 2752-2755, and the copy is what makes that harmless — the value the
  // program holds is a fresh object whose fields are ordinary mutable data.
  const output = run(`
type Config:
    retries: number

export def apply(input: unknown) -> number:
    let config = Config.parse(input)
    config.retries = 5
    return config.retries

export def take(input: unknown) -> Config:
    return Config.parse(input)
`, `
const source = Object.freeze({ retries: 1 });
console.log(apply(source));
console.log(source.retries);
console.log(Object.getOwnPropertyDescriptor(take(source), "retries").writable);
`);
  assert.equal(output, "5\n1\ntrue\n");
});

test("a nested record and a List of records are deeply independent after parse", () => {
  const output = run(`
type Check:
    id: string

type Profile:
    owner: Check
    tags: List<Check>
    meta: Map<string, Check>
    bag: Record<Check>
    tally: Set<string>

export def take(input: unknown) -> Profile:
    return Profile.parse(input)
`, `
const owner = { id: "owner" };
const tag = { id: "tag" };
const source = { owner, tags: [tag], meta: new Map([["k", tag]]), bag: { b: tag }, tally: new Set(["s"]) };
const copy = take(source);
console.log(copy.owner === owner, copy.tags === source.tags, copy.tags[0] === tag);
console.log(copy.meta === source.meta, copy.meta.get("k") === tag, copy.bag.b === tag, copy.tally === source.tally);
owner.id = "changed";
tag.id = "changed";
source.tags.push({ id: "late" });
source.tally.add("late");
console.log(copy.owner.id, copy.tags.length, copy.tags[0].id, copy.meta.get("k").id, copy.bag.b.id, copy.tally.size);
`);
  assert.equal(output, "false false false\nfalse false false false\nowner 1 tag tag tag 1\n");
});

test("a shared subgraph is copied once, so the copy preserves the sharing the source had", () => {
  const output = run(`
type Check:
    id: string

type Pair:
    left: Check
    right: Check

export def take(input: unknown) -> Pair:
    return Pair.parse(input)
`, `
const shared = { id: "shared" };
const copy = take({ left: shared, right: shared });
console.log(copy.left === copy.right, copy.left === shared);
`);
  assert.equal(output, "true false\n");
});

test("a cyclic input does not hang the copy and keeps its cycle", () => {
  // A type parameter is erased, so its position falls back to the structural
  // copy — the one place a cycle can reach the copier, because a declared
  // record's own validator refuses a cyclic value before parse ever copies it.
  const output = run(`
type Box<T>:
    inner: T

type Bag = Box<Record<unknown>>

export def take(input: unknown) -> Bag:
    return Bag.parse(input)
`, `
const cyclic = { name: "self" };
cyclic.self = cyclic;
const copy = take({ inner: cyclic });
console.log(copy.inner === cyclic, copy.inner.self === copy.inner, copy.inner.name);
`);
  assert.equal(output, "false true self\n");
});

test("an enum and an alias of a primitive still hand back the value they were given", () => {
  const output = run(`
enum Color:
    red = "red"
    blue = "blue"

type Name = string

export def take(color: unknown, name: unknown) -> string:
    return f"{Color.parse(color)} {Name.parse(name)}"
`, `
console.log(take("red", "ada"));
`);
  assert.equal(output, "red ada\n");

  // The emitted parse for a value with nothing to copy is still `return value;`
  // — no allocation, no behavioural change.
  const code = emit(`
enum Color:
    red = "red"
    blue = "blue"

type Name = string

export def take(color: unknown, name: unknown) -> string:
    return f"{Color.parse(color)} {Name.parse(name)}"
`);
  assert.match(code, /const Name = __velarRegisterRuntimeType[\s\S]*?parse\(value\) \{[\s\S]*?return value;/u);
  assert.match(code, /const Color = __velarRegisterRuntimeType[\s\S]*?parse\(value\) \{[\s\S]*?return value;/u);
});

test("parse failures still name the failing field with the same message and path", () => {
  const output = run(`
type Config:
    retries: number

export def take(input: unknown) -> number:
    return Config.parse(input).retries
`, `
try { take({ retries: "no" }); }
catch (error) { console.log(error.name, "|", error.message, "|", error.path, "|", error.field, "|", error.reason); }
try { take(7); }
catch (error) { console.log(error.name, "|", error.message, "|", error.path, "|", error.field); }
`);
  assert.equal(
    output,
    "ValidationError | Value does not match Config — field 'retries' does not match number | Config.retries | retries | field 'retries' does not match number\n"
    + "ValidationError | Value does not match Config — the value is not a record | Config | null\n",
  );
});

test("an inherited field is copied once onto the same object the derived copy fills", () => {
  const output = run(`
type Base:
    kind: string

type Derived extends Base:
    label: string

export def take(input: unknown) -> Derived:
    return Derived.parse(input)
`, `
const source = { kind: "base", label: "derived" };
const copy = take(source);
console.log(copy === source, copy.kind, copy.label, Object.keys(copy).join(","));
source.kind = "changed";
console.log(copy.kind);
`);
  assert.equal(output, "false base derived kind,label\nbase\n");
});

test("one source object projected at two declared types is two copies, each complete for its own type", () => {
  // codex-review cr-1: the copy memo was keyed on the source object alone, so
  // the second projection was handed the first projection's copy — a value
  // declared `b: string` arrived as `undefined` with zero diagnostics, which is
  // the one thing `parse` exists to make impossible.
  const output = run(`
type Left:
    a: string

type Right:
    b: string

type Pair:
    left: Left
    right: Right

export def take(input: unknown) -> Pair:
    return Pair.parse(input)
`, `
const shared = { a: "A", b: "B" };
const copy = take({ left: shared, right: shared });
console.log(copy.left.a, copy.right.b, copy.left === copy.right, copy.left === shared);
`);
  assert.equal(output, "A B false false\n");
});

test("two container positions over one source differ by element plan, and one element plan still shares", () => {
  const output = run(`
type Left:
    a: string

type Right:
    b: string

type Holder:
    listLeft: List<Left>
    listRight: List<Right>
    mapLeft: Map<string, Left>
    mapRight: Map<string, Right>
    bagLeft: Record<Left>
    bagRight: Record<Right>
    alsoListLeft: List<Left>

export def take(input: unknown) -> Holder:
    return Holder.parse(input)
`, `
const shared = { a: "A", b: "B" };
const list = [shared];
const map = new Map([["k", shared]]);
const bag = { k: shared };
const copy = take({
  listLeft: list, listRight: list, mapLeft: map, mapRight: map,
  bagLeft: bag, bagRight: bag, alsoListLeft: list,
});
console.log(copy.listLeft[0].a, copy.listRight[0].b, copy.listLeft === copy.listRight);
console.log(copy.mapLeft.get("k").a, copy.mapRight.get("k").b, copy.mapLeft === copy.mapRight);
console.log(copy.bagLeft.k.a, copy.bagRight.k.b, copy.bagLeft === copy.bagRight);
console.log(copy.alsoListLeft === copy.listLeft, copy.alsoListLeft[0] === copy.listLeft[0]);
`);
  assert.equal(output, "A B false\nA B false\nA B false\ntrue true\n");
});

test("a shared object deep inside nested containers is still copied once under one plan", () => {
  const output = run(`
type Check:
    id: string

type Deep:
    one: List<Map<string, Check>>
    two: List<Map<string, Check>>

export def take(input: unknown) -> Deep:
    return Deep.parse(input)
`, `
const shared = { id: "shared" };
const inner = new Map([["k", shared]]);
const outer = [inner];
const copy = take({ one: outer, two: outer });
console.log(copy.one === copy.two, copy.one[0] === copy.two[0], copy.one[0].get("k") === copy.two[0].get("k"));
console.log(copy.one === outer, copy.one[0].get("k") === shared, copy.one[0].get("k").id);
`);
  assert.equal(output, "true true true\nfalse false shared\n");
});

test("a base-position and a derived-position copy of one source do not write over each other", () => {
  // The memo is type-keyed, so a derived copy borrowing the base's memo entry
  // would leave the base position holding the derived fields. The base is
  // asked to file its work under the caller's plan for exactly that reason.
  const source = `
type Base:
    kind: string

type Derived extends Base:
    label: string
`;
  const epilogue = `
const shared = { kind: "base", label: "derived" };
const copy = take({ plain: shared, full: shared });
console.log(Object.keys(copy.plain).join(","), Object.keys(copy.full).join(","));
console.log(copy.plain === copy.full, copy.full.kind, copy.full.label);
`;
  const expected = "kind kind,label\nfalse base derived\n";
  assert.equal(run(`${source}
type Holder:
    plain: Base
    full: Derived

export def take(input: unknown) -> Holder:
    return Holder.parse(input)
`, epilogue), expected);
  // The other write order reaches the derived copy first, and the base copy
  // must still be the base's own object rather than the derived one.
  assert.equal(run(`${source}
type Holder:
    full: Derived
    plain: Base

export def take(input: unknown) -> Holder:
    return Holder.parse(input)
`, epilogue), expected);
});

test("an alias standing in for a base still files the inherited prefix under the derived plan", () => {
  const output = run(`
type Pair:
    a: string

type Named = Pair

type Derived extends Named:
    b: string

type Holder:
    one: Named
    two: Derived

export def take(input: unknown) -> Holder:
    return Holder.parse(input)
`, `
const shared = { a: "A", b: "B" };
const copy = take({ one: shared, two: shared });
console.log(Object.keys(copy.one).join(","), Object.keys(copy.two).join(","), copy.one === copy.two);
`);
  assert.equal(output, "a a,b false\n");
});

test("two instantiations of one generic over one source object are two copies", () => {
  // A generic record's copy plan is one function shared by every
  // instantiation, so the plan it files under is the instantiation's arguments
  // — the same identity the traversal guard already reads.
  const output = run(`
type Left:
    a: string

type Right:
    b: string

type Box<T>:
    inner: T

type Pair:
    left: Box<Left>
    right: Box<Right>

export def take(input: unknown) -> Pair:
    return Pair.parse(input)
`, `
const shared = { inner: { a: "A", b: "B" } };
const copy = take({ left: shared, right: shared });
console.log(copy.left.inner.a, copy.right.inner.b, copy.left === copy.right);
`);
  assert.equal(output, "A B false\n");
});

test("a generic body's parameter-dependent plans are one per instantiation, not one per call", () => {
  // A plan that reads `__velarArguments` cannot hoist to module level, so it is
  // built once beside the arguments object. Sharing one across instantiations
  // would be cr-1 again; rebuilding one per call would lose the memo entirely.
  const output = run(`
type Left:
    a: string

type Right:
    b: string

type Box<T>:
    inner: T

type Wrapper<T>:
    one: Box<T>
    many: List<Box<T>>

type Both:
    left: Wrapper<Left>
    right: Wrapper<Right>

export def take(input: unknown) -> Both:
    return Both.parse(input)
`, `
const boxed = { inner: { a: "A", b: "B" } };
const shared = { one: boxed, many: [boxed] };
const copy = take({ left: shared, right: shared });
console.log(copy.left.one.inner.a, copy.right.one.inner.b);
console.log(copy.left.many[0].inner.a, copy.right.many[0].inner.b);
console.log(copy.left === copy.right, copy.left.many === copy.right.many, copy.left.one === copy.left.many[0]);
`);
  assert.equal(output, "A B\nA B\nfalse false true\n");
});

test("a cyclic structural graph reached twice in one parse terminates under each plan", () => {
  // The structural copy is the one plan a cycle can reach, and it is a single
  // stable identity, so a second visit is a memo hit rather than a recursion.
  const output = run(`
type Box<T>:
    inner: T

type Twice:
    first: Box<Record<unknown>>
    second: Box<Record<unknown>>

export def take(input: unknown) -> Twice:
    return Twice.parse(input)
`, `
const cyclic = { name: "self" };
cyclic.self = cyclic;
const shared = { inner: cyclic };
const copy = take({ first: shared, second: shared });
console.log(copy.first === copy.second, copy.first.inner.self === copy.first.inner);
console.log(copy.first.inner === cyclic, copy.first.inner.name);
`);
  assert.equal(output, "true true\nfalse self\n");
});
