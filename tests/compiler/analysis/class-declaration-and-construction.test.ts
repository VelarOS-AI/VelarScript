import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { rejects, run } from "../../support/core-program.ts";

/**
 * D115 P5 — the class audit's confirmed defects, one subject of the file that
 * was `class-and-core-correctness.test.ts` before it reached 1,167 lines.
 *
 * Batch N-1 (audit fix wave, core correctness): regressions for the class
 * audit's confirmed defects (CLS-D1..D9). What is held here is where a class
 * or type may be declared, what a constructor may take and may call, when a
 * class name is a value yet, and which members a constructor is allowed to
 * observe. The bodies below are the bodies that file had.
 */

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
def install():
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

test("[CLS-D5] a narrowed factory value constructs through the recheck wrapper", () => {
  // The callee read is wrapped in a narrowing recheck IIFE after the opaque
  // call; the misparenthesized form used to construct the wrapper and throw
  // "(intermediate value) is not a constructor". D45 rule 75 (N-2) made the
  // original spelling — storing the class name itself in the Map — illegal,
  // so the stored entry is the arrow factory the diagnostic teaches; the
  // recheck-wrapped callee still constructs correctly through it, and the
  // emitter keeps its callee-boundary parentheses as defense in depth.
  const output = run(`
class P:
    const n: number = 1

def touch():
    return null

const registry: Map<string, () -> P> = Map()
registry.set("p", () => P())
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
