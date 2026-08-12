import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "@velarscript/compiler";

// Batch N-1 (audit fix wave, core correctness): regressions for the class
// audit's confirmed defects (CLS-D1..D9), the flow audit's blocker (FLW-U1,
// with the first multi-module narrowing coverage), and the D44 rulings 70
// (records accept only plain data objects), 71 (assignment establishes a
// fact), and 73 (member writes invalidate only aliasable roots).

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

/** Compiles cleanly and runs to completion; returns stdout. */
function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], source);
  assert.ok(result.code, source);
  const execution = executeModule(result.code);
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

/** Compiles cleanly but fails at runtime; returns stdout and stderr. */
function runFailing(source: string): { readonly stdout: string; readonly stderr: string } {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], source);
  assert.ok(result.code, source);
  const execution = executeModule(result.code);
  assert.notEqual(execution.status, 0, `expected a runtime failure\n${String(execution.stdout)}`);
  return { stdout: String(execution.stdout), stderr: String(execution.stderr) };
}

function rejects(source: string, code: string, pattern: RegExp): void {
  const result = compile(source.trimStart());
  assert.equal(result.code, null, source);
  const matched = result.diagnostics.find((item) => item.code === code && pattern.test(item.message));
  assert.ok(
    matched,
    `${source}\nexpected ${code} ${String(pattern)}, received ${JSON.stringify(result.diagnostics.map((item) => `${item.code}: ${item.message}`))}`,
  );
}

/** Writes a multi-module fixture to disk and runs its entry through the CLI. */
async function runProject(
  modules: Readonly<Record<string, string>>,
  entry: string,
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  const directory = await mkdtemp(join(tmpdir(), "velar-audit-core-"));
  try {
    for (const [name, text] of Object.entries(modules)) {
      await writeFile(join(directory, name), text, "utf8");
    }
    const execution = spawnSync(process.execPath, [cliPath, "run", join(directory, entry)], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: execution.status, stdout: String(execution.stdout), stderr: String(execution.stderr) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLS-D1/D2: class and type declarations are module-scope only.
// ---------------------------------------------------------------------------

test("[CLS-D1] a class in a block is rejected instead of silently using the module-level shape", () => {
  // Worst audited form: the nested shadow returned a string from a
  // `-> number` function with zero diagnostics.
  rejects(`
class Point:
    const x: number = 1

def make() -> number:
    class Point:
        const x: string = "not a number"
    const p = Point()
    return p.x

print(str(make()) + "1")
`, "VEL3011", /Classes can only be declared at module scope/u);

  // A block-scoped type alias silently delivered the wrong shape the same way.
  rejects(`
type Wrap:
    value: number

def pick() -> number:
    type Wrap:
        value: string
    const raw: unknown = {value: "oops"}
    if raw is Wrap:
        return raw.value
    return 0

print(str(pick()) + "1")
`, "VEL3011", /Types can only be declared at module scope/u);

  rejects(`
def pick() -> number:
    type Local = string
    return 0

print(pick())
`, "VEL3011", /Types can only be declared at module scope/u);
});

test("[CLS-D2] export class in a block no longer reaches emission as invalid JavaScript", () => {
  // This emitted `export class` inside a function body, which Node refuses
  // to parse. The module-scope rule now rejects it before emission.
  rejects(`
def install() -> null:
    export class Widget:
        const id: number = 1
    return null

print("ok")
`, "VEL3011", /Classes can only be declared at module scope/u);
});

// ---------------------------------------------------------------------------
// CLS-D3: source constructors reject rest parameters; extern classes keep them.
// ---------------------------------------------------------------------------

test("[CLS-D3] both rest spellings are rejected with the parser's constructor-rest diagnostic", () => {
  // `...values: number` made the constructor uncallable.
  rejects(`
class Bag:
    const total: number

    constructor(...values: number):
        self.total = values.size

const bag = Bag(1, 2, 3)
print(bag.total)
`, "VEL2016", /Class constructors do not support rest parameters/u);

  // `...values: List<number>` type-checked and then was silently wrong at
  // runtime (total 1 instead of 3, because it emitted `constructor(...values)`).
  rejects(`
class Bag:
    const total: number

    constructor(...values: List<number>):
        self.total = values.size

const bag = Bag([1, 2, 3])
print(bag.total)
`, "VEL2016", /Class constructors do not support rest parameters/u);
});

test("[CLS-D3] extern class rest constructors keep working end to end", () => {
  const output = run(`
extern module "data:text/javascript,export class Bag { constructor(...values) { this.total = values.length; } }":
    export class Bag:
        const total: number
        constructor(...values: number)

import js {Bag} from "data:text/javascript,export class Bag { constructor(...values) { this.total = values.length; } }"

const bag = Bag(1, 2, 3)
print(bag.total)
`);
  assert.equal(output, "3\n");
});

// ---------------------------------------------------------------------------
// CLS-D4: super(...) only as the first top-level statement of a derived
// constructor.
// ---------------------------------------------------------------------------

test("[CLS-D4] a nested or repeated super call is a compile error instead of a runtime crash", () => {
  const firstStatement = /'super\(\.\.\.\)' is only available as the first statement of a derived constructor/u;
  rejects(`
class Base:
    const tag: string

    constructor(tag: string):
        self.tag = tag

class Derived extends Base:
    constructor(flag: bool):
        super("a")
        if flag:
            super("b")

const d = Derived(true)
print(d.tag)
`, "VEL4001", firstStatement);

  rejects(`
class Base:
    const tag: string

    constructor(tag: string):
        self.tag = tag

class Derived extends Base:
    constructor():
        super("a")
        for index in [1, 2]:
            super("b")

print(Derived().tag)
`, "VEL4001", firstStatement);

  rejects(`
class Base:
    const tag: string

    constructor(tag: string):
        self.tag = tag

class Derived extends Base:
    constructor():
        super("a")
        super("b")

print(Derived().tag)
`, "VEL4001", firstStatement);
});

test("[CLS-D4] the legal first-statement super keeps working end to end", () => {
  const output = run(`
class Base:
    const tag: string

    constructor(tag: string):
        self.tag = tag

class Derived extends Base:
    constructor():
        super("d")

print(Derived().tag)
`);
  assert.equal(output, "d\n");
});

// ---------------------------------------------------------------------------
// CLS-D5: `new` binds around a wrapped (recheck-guarded) callee.
// ---------------------------------------------------------------------------

test("[CLS-D5] a narrowed constructor value constructs through the recheck wrapper", () => {
  // The callee read is wrapped in a narrowing recheck IIFE after the opaque
  // call; `new (arrow)(x)()` used to construct the arrow and throw
  // "(intermediate value) is not a constructor".
  const output = run(`
class P:
    const n: number = 1

def touch() -> null:
    return null

const registry = Map()
registry.set("p", P)
const factory = registry.get("p")
if factory != null:
    touch()
    const made = factory()
    print(made.n)
`);
  assert.equal(output, "1\n");
});

test("[CLS-D5] plain constructions keep the readable unparenthesized form", () => {
  const result = compile('class P:\n    const n: number = 1\n\nconst p = P()\nprint(p.n)\n');
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /new P\(\)/u);
});

// ---------------------------------------------------------------------------
// CLS-D7: self-referential instance field initializers.
// ---------------------------------------------------------------------------

test("[CLS-D7] a field initializer constructing its own class is rejected instead of overflowing the stack", () => {
  rejects(`
class A:
    let child: A? = A()

const a = A()
print("built")
`, "VEL4001", /Field initializer constructs 'A' on every 'A' construction and can never finish/u);

  // Constructing a subclass runs the base initializers again: same overflow.
  rejects(`
class Base:
    let child: Base? = Derived()

class Derived extends Base:
    let extra: number = 1

print("built")
`, "VEL4001", /Field initializer constructs 'Derived' on every 'Base' construction and can never finish/u);
});

test("[CLS-D7] deferring the construction behind an arrow stays legal", () => {
  const output = run(`
class Node:
    const make: () -> Node = () => Node()
    let label: string = "root"

const n = Node()
const child = n.make()
print(child.label)
`);
  assert.equal(output, "root\n");
});

// ---------------------------------------------------------------------------
// CLS-D8: class names used before their declaration evaluates.
// ---------------------------------------------------------------------------

test("[CLS-D8] value use, static access, and extends before the declaration are compile errors", () => {
  rejects(`
const early = Later()
print(early.n)

class Later:
    const n: number = 5
`, "VEL3001", /Class 'Later' is used before its declaration/u);

  rejects(`
print(Later.family)

class Later:
    static const family: string = "later"
`, "VEL3001", /Class 'Later' is used before its declaration/u);

  // The worst audited form: extends before the base class exists.
  rejects(`
class Derived extends Base:
    constructor():
        super("x")

class Base:
    const tag: string

    constructor(tag: string):
        self.tag = tag

print("loaded")
`, "VEL3001", /Class 'Derived' extends 'Base' before it is declared; move 'Base' above this class/u);
});

test("[CLS-D8] deferred references to later classes stay legal", () => {
  const output = run(`
def spawn() -> Helper:
    return Helper()

class Helper:
    const tag: string = "h"

print(spawn().tag)
`);
  assert.equal(output, "h\n");
});

// ---------------------------------------------------------------------------
// CLS-D9: a constructor may only observe members its class fully owns.
// ---------------------------------------------------------------------------

test("[CLS-D9] a base constructor using an abstract member is rejected instead of always crashing", () => {
  rejects(`
abstract class Base:
    const initial: number

    constructor():
        self.initial = self.score()

    abstract def score() -> number

class Derived extends Base:
    const bonus: number = 10

    override def score() -> number:
        return self.bonus

const d = Derived()
print(d.initial)
`, "VEL4001", /Constructor of 'Base' cannot use abstract member 'score'.*Move this use into the derived constructor/u);
});

test("[CLS-D9] a base constructor using a member a visible subclass overrides is rejected", () => {
  rejects(`
class Base:
    const initial: number

    constructor():
        self.initial = self.score()

    def score() -> number:
        return 1

class Derived extends Base:
    const bonus: number = 10

    override def score() -> number:
        return self.bonus

const d = Derived()
print(d.initial)
`, "VEL4001", /Constructor of 'Base' cannot use 'score': 'Derived' overrides it/u);
});

test("[CLS-D9] using an own override, an inherited concrete member, or a method-position call stays legal", () => {
  const ownOverride = run(`
class Base:
    let start: number

    constructor():
        self.start = 1

    def seed() -> number:
        return 1

class Mid extends Base:
    let boosted: number

    constructor():
        super()
        self.boosted = self.seed()

    override def seed() -> number:
        return 5

print(Mid().boosted)
`);
  assert.equal(ownOverride, "5\n");

  // Method bodies run after construction, so overridable members stay legal
  // there.
  const methodPosition = run(`
class Base:
    def describe() -> string:
        return self.label()

    def label() -> string:
        return "base"

class Derived extends Base:
    override def label() -> string:
        return "derived"

print(Derived().describe())
`);
  assert.equal(methodPosition, "derived\n");
});

// ---------------------------------------------------------------------------
// FLW-U1: the first multi-module narrowing coverage. Every existing narrowing
// test compiles a single module, which is why the imported-record recheck
// could degrade to a presence-only check without any test noticing.
// ---------------------------------------------------------------------------

const NARROWING_ERROR = /NarrowingError: Flow narrowing for '\.\w+' no longer holds: expected /u;

test("[FLW-U1] an imported record inside a union throws NarrowingError instead of delivering wrong data", async () => {
  // The audit's mod3 repro printed `Error` where a `User` was promised and
  // exited 0. The recheck now routes through the imported validator.
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Slot:
    value: User | Error

export def replace(slot: Slot) -> null:
    slot.value = Error("boom")
    return null
`.trimStart(),
    "main.vel": `
import {User, Slot, replace} from "./shared.vel"

const s: Slot = {value: {name: "Ada"}}
if s.value is User:
    replace(s)
    print(s.value.name)
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, NARROWING_ERROR);
  assert.match(execution.stderr, /expected User/u);
  assert.doesNotMatch(execution.stdout, /Error/u);
});

test("[FLW-U1] an imported record narrowed from unknown rechecks deeply instead of presence-only", async () => {
  // The other audited leak: a bare host TypeError from
  // `h.payload.name.upper()` after the payload was swapped for a number.
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Holder:
    payload: unknown

export def swap(h: Holder) -> null:
    h.payload = 5
    return null
`.trimStart(),
    "main.vel": `
import {User, Holder, swap} from "./shared.vel"

const h: Holder = {payload: {name: "Ada"}}
if h.payload is User:
    swap(h)
    print(h.payload.name.upper())
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, NARROWING_ERROR);
  assert.doesNotMatch(execution.stderr, /String methods require a string receiver/u);
});

test("[FLW-U1] a List of an imported record rechecks its elements", async () => {
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Bag:
    items: unknown

export def corrupt(b: Bag) -> null:
    b.items = [5]
    return null
`.trimStart(),
    "main.vel": `
import {User, Bag, corrupt} from "./shared.vel"

const b: Bag = {items: [{name: "Ada"}]}
if b.items is List<User>:
    corrupt(b)
    for item in b.items:
        print(item.name)
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, /expected List<User>/u);
});

test("[FLW-U1] a local alias of an imported record rechecks with the imported validator", async () => {
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Holder:
    payload: unknown

export def swap(h: Holder) -> null:
    h.payload = 5
    return null
`.trimStart(),
    "main.vel": `
import {User, Holder, swap} from "./shared.vel"

type U2 = User

const h: Holder = {payload: {name: "Ada"}}
if h.payload is U2:
    swap(h)
    print(h.payload.name.upper())
`.trimStart(),
  }, "main.vel");
  assert.notEqual(execution.status, 0, execution.stdout);
  assert.match(execution.stderr, NARROWING_ERROR);
});

test("[FLW-U1] imported class and enum rechecks stay correct (pinned)", async () => {
  const shared = `
export class Robot:
    const name: string

    constructor(name: string):
        self.name = name

export enum Mode:
    fast
    slow

export type Cell:
    value: unknown

export def wipe(c: Cell) -> null:
    c.value = "gone"
    return null
`.trimStart();
  const importedClass = await runProject({
    "shared.vel": shared,
    "main.vel": `
import {Robot, Mode, Cell, wipe} from "./shared.vel"

const c: Cell = {value: Robot("r2")}
if c.value is Robot:
    wipe(c)
    print(c.value.name)
`.trimStart(),
  }, "main.vel");
  assert.notEqual(importedClass.status, 0, importedClass.stdout);
  assert.match(importedClass.stderr, /expected Robot/u);

  const importedEnum = await runProject({
    "shared.vel": shared,
    "main.vel": `
import {Robot, Mode, Cell, wipe} from "./shared.vel"

const c: Cell = {value: Mode.fast}
if c.value is Mode:
    wipe(c)
    print(str(c.value == Mode.fast))
`.trimStart(),
  }, "main.vel");
  assert.notEqual(importedEnum.status, 0, importedEnum.stdout);
  assert.match(importedEnum.stderr, /expected Mode/u);
});

test("[FLW-U1] a still-valid imported-record fact reads normally", async () => {
  const execution = await runProject({
    "shared.vel": `
export type User:
    name: string

export type Holder:
    payload: unknown

export def leave(h: Holder) -> null:
    return null
`.trimStart(),
    "main.vel": `
import {User, Holder, leave} from "./shared.vel"

const h: Holder = {payload: {name: "Ada"}}
if h.payload is User:
    leave(h)
    print(h.payload.name.upper())
`.trimStart(),
  }, "main.vel");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "ADA\n");
});

// ---------------------------------------------------------------------------
// D44 rule 70: record validation accepts only plain data objects.
// ---------------------------------------------------------------------------

test("[D44 70] a class instance no longer satisfies a record contract, so const fields cannot be written through", () => {
  // Before: Point.is(instance) was true, Point.parse returned a record view
  // aliasing the live instance, and `point.x = 99` wrote through the class's
  // const field. Now `is` answers false and `parse` throws with the
  // projection teaching.
  const failing = runFailing(`
type Point:
    x: number

class P:
    const x: number = 1

    def read() -> number:
        return self.x

const instance = P()
const raw: unknown = instance
print(str(Point.is(raw)))
const point = Point.parse(raw)
point.x = 99
print(str(instance.read()))
`);
  assert.equal(failing.stdout, "false\n");
  assert.match(failing.stderr, /Value does not match Point; a record accepts only plain data objects — project the fields into a record first, for example \{x: instance\.x\}/u);
  assert.doesNotMatch(failing.stdout, /99/u);
});

test("[D44 70] Error instances and nested field positions are rejected; parsed JSON passes", () => {
  const output = run(`
import js unsafe {fromJson} from "data:text/javascript,export const fromJson = JSON.parse('{\\"x\\": 3}');"

type Point:
    x: number

type Wrap:
    inner: Point

class P:
    const x: number = 1

print(str(Point.is(fromJson)))
const errorValue: unknown = Error("boom")
print(str(Point.is(errorValue)))
const nested: unknown = {inner: errorValue}
print(str(Wrap.is(nested)))
const nestedInstance: unknown = {inner: P()}
print(str(Wrap.is(nestedInstance)))
`);
  assert.equal(output, "true\nfalse\nfalse\nfalse\n");
});

test("[D44 70] a plain object from another realm still validates", () => {
  // The check is structural (prototype null, or prototype whose own
  // prototype is null), never an identity comparison against this realm's
  // Object.prototype.
  const output = run(`
import js unsafe {foreign} from "data:text/javascript,import vm from 'node:vm'; export const foreign = vm.runInNewContext('({x: 3})');"

type Point:
    x: number

print(str(Point.is(foreign)))
const parsed = Point.parse(foreign)
print(str(parsed.x))
`);
  assert.equal(output, "true\n3\n");
});

// ---------------------------------------------------------------------------
// D44 rule 73: member writes invalidate only roots whose types could alias.
// ---------------------------------------------------------------------------

test("[D44 73] a member write on a type-disjoint root keeps the fact", () => {
  // The audit's original shape: writing a completely different variable's
  // member no longer kills the fact when the root types share no values.
  const recordRoots = run(`
type Box:
    value: string?
    label: string

type Counter:
    count: number

const box: Box = {value: "hi", label: "b"}
const other: Counter = {count: 1}
if box.value != null:
    other.count = 2
    print(box.value.upper())
`);
  assert.equal(recordRoots, "HI\n");

  // A class-typed root cannot alias a record root at all (rule 70 makes the
  // domains disjoint even at runtime).
  const classRoot = run(`
type Box:
    value: string?
    label: string

class Meter:
    let count: number = 0

const box: Box = {value: "hi", label: "b"}
const meter = Meter()
if box.value != null:
    meter.count = 2
    print(box.value.upper())
`);
  assert.equal(classRoot, "HI\n");
});

test("[D44 73] same-type roots and sibling fields still invalidate", () => {
  const optionalAccess = /Use optional access '\?\.'/u;
  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
const box2: Box = {value: null}
if box.value != null:
    box2.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  rejects(`
type Pair:
    left: string?
    right: string?

const pair: Pair = {left: "l", right: null}
if pair.left != null:
    pair.right = "r"
    print(pair.left.upper())
`, "VEL4001", optionalAccess);
});

test("[D44 73] every alias form keeps invalidating", () => {
  const optionalAccess = /Use optional access '\?\.'/u;
  // Alias declared before the check, written after it.
  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
const alias = box
if box.value != null:
    alias.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  // Alias declared after the check.
  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
if box.value != null:
    const alias = box
    alias.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  // Chained alias: the write goes through a nested receiver whose type
  // matches the fact root, even though the outermost roots are unrelated.
  rejects(`
type Inner:
    value: string?

type Outer:
    inner: Inner

const outer: Outer = {inner: {value: "hi"}}
const mid = outer.inner
if mid.value != null:
    outer.inner.value = null
    print(mid.value.upper())
`, "VEL4001", optionalAccess);

  // Reverse: fact on the nested path, write through the alias.
  rejects(`
type Inner:
    value: string?

type Outer:
    inner: Inner

const outer: Outer = {inner: {value: "hi"}}
const mid = outer.inner
if outer.inner.value != null:
    mid.value = null
    print(outer.inner.value.upper())
`, "VEL4001", optionalAccess);

  // Function-returned alias.
  rejects(`
type Box:
    value: string?

def pick(box: Box) -> Box:
    return box

const box: Box = {value: "hi"}
const ref = pick(box)
if box.value != null:
    ref.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  // List element alias.
  rejects(`
type Box:
    value: string?

const items: List<Box> = [{value: "hi"}]
const item = items[0]
if item.value != null:
    items[0].value = null
    print(item.value.upper())
`, "VEL4001", optionalAccess);

  // self.field against another instance of the same class.
  rejects(`
class Holder:
    let value: string? = "hi"

    def poke(other: Holder) -> string:
        if self.value != null:
            other.value = null
            return self.value.upper()
        return "none"

print(Holder().poke(Holder()))
`, "VEL4001", optionalAccess);
});

// ---------------------------------------------------------------------------
// D44 rule 71: assignment establishes a narrowing fact.
// ---------------------------------------------------------------------------

test("[D44 71] a declaration initializer establishes the assigned type", () => {
  assert.equal(run('const x: string? = "a"\nprint(x.upper())\n'), "A\n");
  assert.equal(run(`
const x: List<number>? = [1]
x.append(2)
print(str(x.size))
`), "2\n");
});

test("[D44 71] a later assignment establishes and a nullable right side establishes nothing", () => {
  assert.equal(run('let x: string? = null\nx = "a"\nprint(x.upper())\n'), "A\n");

  // The negative row: `x = maybeNull()` must not narrow.
  rejects(`
def maybe() -> string?:
    return "a"

let x: string? = null
x = maybe()
print(x.upper())
`, "VEL4001", /Use optional access '\?\.'/u);
});

test("[D44 71] a member assignment invalidates aliases first, then establishes for the written path", () => {
  // Both halves in one program: the write kills the sibling root's fact of
  // the same type, and the written path's new fact survives its own
  // invalidation.
  assert.equal(run(`
type Box:
    value: string?
    label: string

const box: Box = {value: null, label: "b"}
box.value = "fresh"
print(box.value.upper())
`), "FRESH\n");

  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
const twin: Box = {value: "hi"}
if twin.value != null:
    box.value = "fresh"
    print(box.value.upper() + twin.value.upper())
`, "VEL4001", /Use optional access '\?\.'/u);
});

test("[D44 71] union arms and unknown declarations refine", () => {
  assert.equal(run(`
let u: string | number = 5
u = "text"
print(u.upper())
u = 7
print(str(u + 1))
`), "TEXT\n8\n");

  assert.equal(run('const raw: unknown = "Ada"\nprint(raw.upper())\n'), "ADA\n");

  assert.equal(run(`
type User:
    name: string

type Slot:
    value: User | Error

const s: Slot = {value: Error("boom")}
s.value = {name: "Ada"}
print(s.value.name)
`), "Ada\n");
});

test("[D44 71] branches that each assign the refined type merge the fact", () => {
  assert.equal(run(`
def flag() -> bool:
    return true

let x: string? = null
if flag():
    x = "a"
else:
    x = "b"
print(x.upper())
`), "A\n");

  assert.equal(run(`
def risky() -> string:
    return "ok"

let x: string? = null
try:
    x = risky()
catch error:
    x = "fallback"
print(x.upper())
`), "OK\n");

  assert.equal(run(`
enum Mode:
    fast
    slow

def pick() -> Mode:
    return Mode.fast

let x: string? = null
match pick():
    case Mode.fast:
        x = "f"
    case Mode.slow:
        x = "s"
print(x.upper())
`), "F\n");
});

test("[D44 71] a branch that does not always assign leaves no fact", () => {
  rejects(`
def flag() -> bool:
    return true

let x: string? = null
if flag():
    x = "a"
print(x.upper())
`, "VEL4001", /Use optional access '\?\.'/u);
});

test("[D44 71] compound assignment keeps the fact", () => {
  assert.equal(run(`
let n: number? = null
n = 1
n += 1
print(n + 1)
`), "3\n");
});

test("[D44 71] an assigned fact refines reads but never makes a later test constant", () => {
  // D42 item 64 pinned these spellings as the language's null-test; the
  // assignment-established fact must not turn them into rejected constants.
  assert.equal(
    run('const value: string? = "x"\nprint(str(value == null))\nprint(str(value != null))\n'),
    "false\ntrue\n",
  );
  assert.equal(run(`
enum Status:
    pending
    done

const s: Status? = null
print(str(s == null))
print(str(s == Status.done))
`), "true\nfalse\n");

  // A fact established by a check keeps making a repeated check an error.
  rejects(`
def read() -> string?:
    return "a"

let x: string? = read()
if x != null:
    print(str(x != null))
`, "VEL4001", /have no values in common/u);
});

test("[D44 71] loop back edges strip assigned facts and their runtime guards", () => {
  // The audit-pinned reestablished-at-head loop stays diagnostic-free and
  // runs: the declaration fact is judged as the declared question at the
  // condition, and the body's invalidation reaches the second pass.
  assert.equal(run(`
let value: string? = "first"
while value != null:
    print(value.upper())
    value = null
`), "FIRST\n");

  // Regression for the stale-guard defect this rule amplified: a read whose
  // pass-one fact the back edge invalidates must not keep the pass-one
  // runtime guard, or iteration two throws NarrowingError on legal code.
  assert.equal(run(`
let round = 0

def next() -> bool:
    round += 1
    return round <= 2

let v: string? = "a"
while next():
    print(v)
    v = null
`), "a\nnull\n");

  // Same shape with the fact established by an outer check instead of the
  // declaration (this crashed on the pre-fix compiler).
  assert.equal(run(`
let round = 0

def next() -> bool:
    round += 1
    return round <= 2

let v: string? = "a"
if v != null:
    while next():
        print(v)
        v = null
`), "a\nnull\n");
});

test("[D44 71] enum singleton chains keep analyzing as the declared domain", () => {
  // Establishment is scoped to optional, union, and unknown storage, so a
  // non-optional enum declaration keeps its member-chain analysis exactly as
  // D42 pinned it.
  assert.equal(run(`
enum Status:
    pending
    done
    failed

const s: Status = Status.pending
if s == Status.pending:
    print("pending")
else if s == Status.done:
    print("done")
else if s == Status.failed:
    print("failed")
`), "pending\n");
});

test("[D44 71] an unannotated alias of an assigned fact declares the domain and keeps the fact", () => {
  // `pop()` returns a non-optional element, so the assignment establishes a
  // Row fact on the optional stash. The alias must not collapse to Row — its
  // declared domain stays Row?, the fact rides along, and both the defensive
  // check and the refined read stay legal.
  const output = run(`
type Row:
    id: string
    title: string

let rows: List<Row> = [{id: "a", title: "Alpha"}]
let held: Row? = null

def takeRow() -> string:
    held = rows.pop()
    const taken = held
    if taken != null:
        rows.append(taken)
    return taken.title

print(takeRow())
print(str(rows.size))
`);
  assert.equal(output, "Alpha\n1\n");
});

test("[D44 71] destructuring declarations keep their declared pieces sound", () => {
  // Each destructured binding types as its declared piece; a piece that the
  // initializer cannot refine establishes nothing.
  assert.equal(run(`
type Wide:
    a: string?
    b: number

const source: Wide = {a: "x", b: 1}
const {a, b} = source
print(str(b))
print(str(a == null))
`), "1\nfalse\n");
});
