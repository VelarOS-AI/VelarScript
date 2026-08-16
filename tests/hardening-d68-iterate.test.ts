import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

// D68 rule 177 — `@iterate:`, the contract a class answers "what does
// iterating you mean?" with. The ruling's whole load-bearing claim is that a
// class either participates in *every* consumer of an iterable or in none, so
// these tests run all eight consumption points against one class and compare
// each against the collection the block returns, written out by hand.

const bag = `
class Bag:
    let items: List<string> = ["alpha", "beta"]

    @iterate:
        return self.items
`.trimStart();

function execute(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code, timeout: 10_000 });
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function diagnostics(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[D68 177] all eight consumers of an iterable read the '@iterate:' contract", () => {
  // One program, eight sites, one class. If any site refused, this compile
  // would fail rather than the assertion — which is the point of the ruling:
  // `for item in bag` working while `item in bag` does not is the trap.
  const output = run(`${bag}
const bag = Bag()

for item in bag:
    print(f"1 {item}")

for item, index in bag:
    print(f"2 {index}={item}")

class Rows:
    let pairs: List<List<string>> = [["a", "1"], ["b", "2"]]

    @iterate:
        return self.pairs

for [left, right] in Rows():
    print(f"3 {left}->{right}")

class Prices:
    let byName: Map<string, number> = Map([["apple", 2], ["pear", 3]])

    @iterate:
        return self.byName

for name, price in Prices():
    print(f"4 {name}={price}")

class Bounds:
    let limits: Record<number> = {small: 1, large: 9}

    @iterate:
        return self.limits

for field, bound in Bounds():
    print(f"4r {field}={bound}")

print(f"5 {"alpha" in bag} {"omega" not in bag}")

const spread: List<string> = [...bag, "gamma"]
print(f"6 {spread.join(",")}")

def joinWith(separator: string, ...parts: string) -> string:
    return parts.join(separator)

print(f"7 {joinWith("-", ...bag)}")

print(f"8 {Set(bag).size} {Map(Prices()).size}")
`);

  assert.equal(output, [
    "1 alpha",
    "1 beta",
    "2 0=alpha",
    "2 1=beta",
    "3 a->1",
    "3 b->2",
    "4 apple=2",
    "4 pear=3",
    "4r small=1",
    "4r large=9",
    "5 true true",
    "6 alpha,beta,gamma",
    "7 alpha-beta",
    "8 2 2",
  ].join("\n") + "\n");
});

test("[D68 177] every consumer means exactly what the collection spelling means", () => {
  // "语义与直接写 bag.items 逐字相同" is checkable: run both programs and
  // compare their whole output. A difference anywhere — order, index base,
  // key/value slot, spread copy — shows up as a failed equality.
  const throughContract = run(`${bag}
const bag = Bag()
for item in bag:
    print(item)
for item, index in bag:
    print(f"{index}:{item}")
print(f"{"alpha" in bag}")
print(f"{[...bag].size}")
print(f"{Set(bag).size}")
`);

  const throughTheField = run(`${bag}
const bag = Bag()
for item in bag.items:
    print(item)
for item, index in bag.items:
    print(f"{index}:{item}")
print(f"{"alpha" in bag.items}")
print(f"{[...bag.items].size}")
print(f"{Set(bag.items).size}")
`);

  assert.equal(throughContract, throughTheField);
  assert.equal(throughContract, "alpha\nbeta\n0:alpha\n1:beta\ntrue\n2\n2\n");
});

test("[D68 177] the contract is evaluated once per consumption, like the field read it stands for", () => {
  const output = run(`
class Counted:
    let reads: number = 0
    let items: List<string> = ["a", "b", "c"]

    def source() -> List<string>:
        self.reads += 1
        return self.items

    @iterate:
        return self.source()

const counted = Counted()
for item in counted:
    print(item)
print(f"reads {counted.reads}")
`);
  assert.equal(output, "a\nb\nc\nreads 1\n");
});

test("[D68 177] the element type flows through the contract into every binding", () => {
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<number> = [1, 2]

    @iterate:
        return self.items

for item in Bag():
    print(item.upper())
`), ["VEL4001 number has no member 'upper'"]);

  // A Map answer gives key/value; a List answer gives value/index. Both are
  // the collection's own meaning, so the second slot's type comes from it.
  assert.deepEqual(diagnostics(`
class Prices:
    let byName: Map<string, number> = Map()

    @iterate:
        return self.byName

for name, price in Prices():
    print(price.upper())
`), ["VEL4001 number has no member 'upper'"]);

  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

    @iterate:
        return self.items

for item, index in Bag():
    print(index.upper())
`), ["VEL4001 number has no member 'upper'"]);
});

test("[D68 177] the contract answers with one of the four collections, and says so where it is written", () => {
  assert.deepEqual(diagnostics(`
class Bag:
    let label: string = "x"

    @iterate:
        return self.label
`), [
    "VEL4038 '@iterate' says which collection iterating 'Bag' means, so it returns a List, Set, Map, or Record"
      + " — those are the shapes the language already knows how to iterate; this block returns string",
  ]);

  // A block that returns nothing answers `null`, which is not a collection
  // either — and the message names what it did answer.
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

    @iterate:
        print("nothing")
`), [
    "VEL4038 '@iterate' says which collection iterating 'Bag' means, so it returns a List, Set, Map, or Record"
      + " — those are the shapes the language already knows how to iterate; this block returns null",
  ]);
});

test("[D68 177] the contract is not a method: it cannot be called and cannot be declared twice", () => {
  assert.deepEqual(diagnostics(`${bag}
const bag = Bag()
bag.iterate()
`), ["VEL4001 Class 'Bag' has no member 'iterate'"]);

  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

    @iterate:
        return self.items

    @iterate:
        return self.items
`), ["VEL2022 Class 'Bag' has more than one '@iterate' block"]);

  // The `@name` vocabulary stays closed, and names both members it has.
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

    @walk:
        return self.items
`), ["VEL2022 Unknown language member '@walk'; a class declares '@dispose:' and '@iterate:', and no other '@' member"]);

  // A class may still declare an ordinary method spelled `iterate`; `@` is a
  // separate namespace, exactly as it is for `dispose`.
  assert.equal(run(`
class Bag:
    let items: List<string> = ["a"]

    def iterate() -> string:
        return "an ordinary method"

    @iterate:
        return self.items

const bag = Bag()
print(bag.iterate())
for item in bag:
    print(item)
`), "an ordinary method\na\n");
});

test("[D68 177] iterating is a synchronous question, so the block may not await", () => {
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

    async def load() -> List<string>:
        return self.items

    @iterate:
        return await self.load()
`), [
    "VEL4007 'await' cannot be used in an '@iterate' block; iterating is a synchronous question"
      + " — await the work before construction and hold the finished collection",
  ]);

  // A nested arrow inside the block is an ordinary callable and keeps the
  // ordinary advice; the contract's message is for the contract's own body.
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

    @iterate:
        const read = () => await self.items
        return self.items
`), [
    "VEL4001 Cannot await List<string>",
    "VEL4007 'await' can only be used in an async function or at module scope",
  ]);
});

test("[D68 177] 'async for' still refuses a user type, and says why the contract does not apply", () => {
  assert.deepEqual(diagnostics(`${bag}
async for item in Bag():
    print(item)
`), [
    "VEL4001 async for requires next() -> Promise<T?>; Bag does not expose that pull contract"
      + "; '@iterate' answers the plain 'for', not 'async for' — an async stream is a resource,"
      + " so pull it from the capability handle that owns the lifetime",
  ]);

  // Without the contract the refusal is the plain one: the note exists to stop
  // an author who declared `@iterate:` from reading this as a missing block.
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

async for item in Bag():
    print(item)
`), ["VEL4001 async for requires next() -> Promise<T?>; Bag does not expose that pull contract"]);
});

test("[D68 177] the two contract members coexist on one class without interfering", () => {
  // `@dispose:` chains through the hierarchy and `@iterate:` replaces; both
  // land as prototype members under keys no source name can spell, so a class
  // that owns a resource and iterates is one class, not a collision.
  assert.equal(run(`
class Batch:
    let items: List<string> = ["a", "b"]
    let released: bool = false

    def close():
        self.released = true

    @dispose:
        self.close()

    @iterate:
        return self.items

let escaped = false

def drain() -> string:
    using batch = Batch()
    let seen = ""
    for item in batch:
        seen += item
    escaped = batch.released
    return seen

print(drain())
print(f"{escaped}")
`), "ab\nfalse\n");
});

test("[D68 177] a derived class inherits the contract, and overriding replaces the one answer", () => {
  assert.equal(run(`${bag}
class Crate extends Bag:
    pass

class Sorted extends Bag:
    @iterate:
        return self.items.reversed()

for item in Crate():
    print(f"inherited {item}")
for item in Sorted():
    print(f"replaced {item}")

def each(value: Bag) -> string:
    let seen = ""
    for item in value:
        seen += item
    return seen

print(each(Sorted()))
`), "inherited alpha\ninherited beta\nreplaced beta\nreplaced alpha\nbetaalpha\n");
});

test("[D68 177] an override keeps the base answer, because a base-typed binding was promised it", () => {
  assert.deepEqual(diagnostics(`${bag}
class Crate extends Bag:
    let counts: List<number> = [1]

    @iterate:
        return self.counts
`), [
    "VEL4038 '@iterate' override in 'Crate' must keep the base answer List<string>; 'Bag' already promised"
      + " every caller that iterating one of these walks List<string>, and a derived value is still one of those",
  ]);
});

test("[D68 177] readonly projects through the contract exactly as it does through the collection", () => {
  // A read-only answer hands out read-only elements.
  assert.deepEqual(diagnostics(`
class Sheet:
    let rows: List<List<string>> = [["a"]]

    get view() -> readonly List<List<string>>:
        return self.rows

    @iterate:
        return self.view

for row in Sheet():
    row.append("x")
`), ["VEL4001 Cannot call mutating method 'append' through readonly List<string>; it is a read-only view"]);

  // And a readonly field inside the element type keeps its own projection.
  assert.deepEqual(diagnostics(`
type Row:
    readonly tags: List<string>

class Sheet:
    let rows: List<Row> = []

    @iterate:
        return self.rows

for row in Sheet():
    row.tags.append("x")
`), ["VEL4001 Cannot call mutating method 'append' through readonly List<string>; it is a read-only view"]);
});

test("[D68 177] the answer converges through a method whose own result is inferred", () => {
  // The block carries no annotation, so its answer rides the same seeded
  // convergence passes an omitted function result does. A method with an
  // omitted result read from inside the block is the case that needs more
  // than one pass; getting it wrong would leave the class un-iterable.
  assert.equal(run(`
class Bag:
    let items: List<string> = ["a", "b"]

    def source():
        return self.items

    @iterate:
        return self.source()

for item in Bag():
    print(item)
`), "a\nb\n");
});

test("[D68 177] a class the contract is written below is still iterable above it", () => {
  assert.equal(run(`
def each(value: Bag) -> string:
    let seen = ""
    for item in value:
        seen += item.upper()
    return seen

class Bag:
    let items: List<string> = ["a", "b"]

    @iterate:
        return self.items

print(each(Bag()))
`), "AB\n");
});

test("[D68 177] every consumer that refuses a class teaches the same one contract", () => {
  assert.deepEqual(diagnostics(`
class Bag:
    let items: List<string> = []

const bag = Bag()
for item in bag:
    print(item)
print(f"{"a" in bag}")
const copy: List<string> = [...bag]
def take(...values: string):
    pass
take(...bag)
const seen = Set(bag)
const paired = Map(bag)
`), [
    "VEL4001 Cannot iterate over Bag; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means",
    "VEL4001 Membership requires a List, Set, Map, Record, or string, received Bag"
      + "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means",
    "VEL4001 Cannot spread Bag into a list"
      + "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means",
    "VEL4001 Call spread requires a List, received Bag"
      + "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means",
    "VEL4001 Set construction requires a List or Set, received Bag"
      + "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means",
    "VEL4001 Map construction requires a Map, a List of [key, value] Lists, or a record, received Bag"
      + "; declare an '@iterate:' block on the class to say which List, Set, Map, or Record iterating it means",
  ]);

  // A class that already declares the block gets no such advice — its own
  // block carries the precise message.
  assert.deepEqual(diagnostics(`
class Bag:
    let byName: Map<string, number> = Map()

    @iterate:
        return self.byName

const copy: List<string> = [...Bag()]
`), ["VEL4001 Cannot spread Map<string, number> into a list"]);

  // Nor does a class whose block is refused: the refusal is written at the
  // block, and repeating "declare one" at the use site would name a move the
  // author already made.
  assert.deepEqual(diagnostics(`
class Bag:
    let label: string = "x"

    @iterate:
        return self.label

for item in Bag():
    print(item)
`), [
    "VEL4038 '@iterate' says which collection iterating 'Bag' means, so it returns a List, Set, Map, or Record"
      + " — those are the shapes the language already knows how to iterate; this block returns string",
    "VEL4001 Cannot iterate over Bag",
  ]);

  // An extern class has no body to declare a block in, so it gets the move
  // that works instead of advice it cannot follow (the D45 rule 78 shape).
  assert.deepEqual(diagnostics(`
extern module "handle-sdk":
    export class Handle:
        def close() -> null

import js {Handle} from "handle-sdk"

def each(source: Handle):
    for item in source:
        print(item)
`), [
    "VEL4001 Cannot iterate over Handle; an extern class declares the foreign shape and cannot declare '@iterate:'"
      + " — read the collection out of it and iterate that",
  ]);
});

test("[D68 177] the contract crosses the module boundary with the class", async () => {
  const root = join(tmpdir(), "velar-iterate-cross-module");
  const modules = new Map(Object.entries({
    "bag.vel": [
      "export class Bag:",
      '    let items: List<string> = ["alpha", "beta"]',
      "",
      "    @iterate:",
      "        return self.items",
      "",
    ].join("\n"),
    "main.vel": [
      'import {Bag} from "./bag.vel"',
      "const bag = Bag()",
      "for item in bag:",
      "    print(item)",
      'print(f"{"alpha" in bag}")',
      "const copy: List<string> = [...bag]",
      'print(f"{copy.size} {Set(bag).size}")',
      "",
    ].join("\n"),
  }).map(([name, text]) => [join(root, name), text] as const));

  const project = await compileProject(join(root, "main.vel"), modules, {});
  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics.map((item) => `${item.code} ${item.message}`), [], module.inputPath);
  }
});

test("[D68 177] the tour chapter's own spellings produce the output it claims", () => {
  // The bodies here are `examples/tour/core/10-classes-and-ownership.vel`'s
  // iteration section, verbatim. The tour is gated for compiling and running;
  // this pins what those lines actually print, which is the part a reader
  // takes away from them.
  const output = run(`
class Basket:
    let items: List<string> = ["apple", "pear", "fig"]

    @iterate:
        return self.items

class Prices:
    let byName: Map<string, number> = Map([["apple", 2], ["pear", 3]])

    @iterate:
        return self.byName

class Limits:
    let bounds: Record<number> = {small: 1, large: 9}

    @iterate:
        return self.bounds

class Pairs:
    let rows: List<List<string>> = [["apple", "2"], ["pear", "3"]]

    @iterate:
        return self.rows

class SortedBasket extends Basket:
    @iterate:
        return self.items.sorted()

const basket = Basket()

def joinWith(separator: string, ...parts: string) -> string:
    return parts.join(separator)

def iterateOneSlot() -> string:
    let seen = ""
    for item in basket:
        seen += item
    return seen

def iterateTwoSlots() -> string:
    let seen = ""
    for item, index in basket:
        seen += f"{index}:{item} "
    return seen.trim()

def iterateDestructured() -> string:
    let seen = ""
    for [name, price] in Pairs():
        seen += f"{name}={price} "
    return seen.trim()

def iterateKeyAndValue() -> string:
    let seen = ""
    for name, price in Prices():
        seen += f"{name}={price} "
    for name, bound in Limits():
        seen += f"{name}={bound} "
    return seen.trim()

def membership() -> bool:
    return ("apple" in basket) and ("durian" not in basket)

def listSpread() -> List<string>:
    return [...basket, "quince"]

def callSpread() -> string:
    return joinWith("-", ...basket)

def setAndMapConstruction() -> number:
    return Set(basket).size + Map(Prices()).size

print(iterateOneSlot())
print(iterateTwoSlots())
print(iterateDestructured())
print(iterateKeyAndValue())
print(f"{membership()} {listSpread().size} {callSpread()} {setAndMapConstruction()}")
for item in SortedBasket():
    print(item)
`);

  assert.equal(output, [
    "applepearfig",
    "0:apple 1:pear 2:fig",
    "apple=2 pear=3",
    "apple=2 pear=3 small=1 large=9",
    "true 4 apple-pear-fig 5",
    "apple",
    "fig",
    "pear",
  ].join("\n") + "\n");
});
