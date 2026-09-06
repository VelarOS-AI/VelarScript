import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * The members the editor is told a receiver has, against the members the type
 * checker resolves for it.
 *
 * These were two answers. `createSemanticMembersOf` walked the receiver a
 * second time with its own member lists, its own class-chain walk and its own
 * enum and `Type<T>` construction, and the two drifted: the editor's List
 * roster predated the D114 S3 pipeline members, a private field read through an
 * applied receiver kept its declaration's parameter instead of the argument,
 * and a `type` alias of an enum published `is`/`parse` where the checker
 * published the enum's members.
 *
 * So nothing below is asserted against a hand-written list. Every assertion
 * compares the roster to what the checker itself answers for the same read:
 * whether it accepts it at all, and the type it gives the binding that holds
 * it — both read back from the compiler's own public result.
 */

/** A program whose only job is to give `value` the declared type and use it. */
function receiverProbe(prelude: string, declaration: string): string {
  return `${prelude}def probe(value: ${declaration}):\n    print(str(value))\n`;
}

/** The roster the editor offers for one binding: name → the type it displays. */
function roster(source: string, binding: string): Map<string, string> {
  const result = compile(source.trimStart());
  const symbol = result.semanticIndex.symbols.find((item) => item.name === binding
    && (item.kind === "variable" || item.kind === "parameter"));
  assert.ok(symbol, `no semantic symbol for '${binding}'`);
  return new Map(symbol.members.map((member) => [member.name, member.type]));
}

/**
 * What the checker answers for `receiver.member`: `null` when it refuses the
 * read, and otherwise the type it gives the binding the read is stored in.
 */
function resolved(prelude: string, declaration: string, member: string, access = "."): string | null {
  const source = `${prelude}def probe(value: ${declaration}):\n    const read = value${access}${member}\n    print("read")\n`;
  const result = compile(source);
  if (result.diagnostics.length > 0) return null;
  const symbol = result.semanticIndex.symbols.find((item) => item.name === "read");
  assert.ok(symbol, `no semantic symbol for the read of '${member}'`);
  return symbol.type;
}

/**
 * The whole contract, for one receiver: every member the editor offers is one
 * the checker accepts, and it is described the way the checker describes it.
 */
function agrees(prelude: string, declaration: string, binding = "value", access = "."): number {
  const offered = roster(receiverProbe(prelude, declaration), binding);
  assert.ok(offered.size > 0, `the editor offers nothing for ${declaration}`);
  for (const [member, display] of offered) {
    const checker = resolved(prelude, declaration, member, access);
    assert.equal(checker, display, `the editor offers '${member}' as ${display}; the checker answers ${checker ?? "a refusal"}`);
  }
  return offered.size;
}

test("[F4] a record's roster is what the checker resolves", () => {
  const prelude = `type Point:
    x: number
    y: string

`;
  assert.equal(agrees(prelude, "Point"), 2);
  // …and a name the editor does not offer is a name the checker refuses.
  assert.equal(resolved(prelude, "Point", "z"), null);
});

test("[F4] a class publishes its inherited members and its getter", () => {
  const prelude = `class Base:
    let tag: string = "base"

    def describe() -> string:
        return self.tag

class Derived extends Base:
    let count: number = 0

    get doubled() -> number:
        return self.count * 2

`;
  const offered = roster(receiverProbe(prelude, "Derived"), "value");
  // The base's field and method, the derived field, and the getter — the class
  // chain `findField`/`findGetter`/`findMethod` walk, not a second walk of it.
  assert.deepEqual([...offered.keys()].sort(), ["count", "describe", "doubled", "tag"]);
  assert.equal(agrees(prelude, "Derived"), 4);
});

test("[F4] a generic record applied to an argument publishes the substituted field", () => {
  const prelude = `type Box<T>:
    item: T
    label: string

`;
  assert.equal(agrees(prelude, "Box<number>"), 2);
  // The application is what the checker substituted, so the roster carries it.
  assert.equal(roster(receiverProbe(prelude, "Box<number>"), "value").get("item"), "number");
  assert.equal(roster(receiverProbe(prelude, "Box<string>"), "value").get("item"), "string");
});

test("[F4] an optional receiver publishes what is inside it", () => {
  const prelude = `type Point:
    x: number
    y: string

`;
  // The roster is the members of the value the optional may hold; the read
  // itself needs `?.`, and the checker adds the optional to the result there.
  const offered = roster(receiverProbe(prelude, "Point?"), "value");
  assert.deepEqual([...offered.keys()].sort(), ["x", "y"]);
  assert.equal(offered.get("x"), "number");
  assert.equal(resolved(prelude, "Point?", "x", "?."), "number?");
  assert.equal(resolved(prelude, "Point?", "z", "?."), null);
});

test("[F4] a List publishes exactly the members the checker resolves", () => {
  const size = agrees("", "List<number>");
  // The roster is the compiler's own, so the D114 S3 pipeline members the
  // checker gained are offered rather than left out of a second copy of it.
  const offered = roster(receiverProbe("", "List<number>"), "value");
  for (const member of ["unique", "compact", "flatten", "chunk", "partition", "groupBy", "keyBy", "countBy", "zip", "repeat"]) {
    assert.ok(offered.has(member), `the editor does not offer List.${member}, which the checker resolves`);
  }
  assert.ok(size >= 36, `a List publishes ${size} members`);
  assert.equal(resolved("", "List<number>", "shuffle"), null);
});

test("[F4] a Map publishes exactly the members the checker resolves", () => {
  const size = agrees("", "Map<string, number>");
  assert.ok(size >= 14, `a Map publishes ${size} members`);
  assert.equal(resolved("", "Map<string, number>", "sorted"), null);
});

test("[F4] a private field is published as the receiver's application, not the declaration's", () => {
  // The checker substitutes a private member's type with the arguments the
  // receiver applies (D55 rule 120 layer two). The editor read the private
  // table directly and showed the declaration's `T` instead.
  const source = `class Box<T: Comparable>:
    private let item: T? = null

    def peek(other: NumberBox) -> number?:
        const read = other.item
        return read

class NumberBox extends Box<number>:
    def go():
        print("boxed")

const box: Box<number> = Box()
print(str(box.peek(NumberBox())))
`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  // What the checker gave the read, and what the editor offers for the same
  // receiver, are one answer: `T` solved to the argument `NumberBox` applies.
  const read = result.semanticIndex.symbols.find((item) => item.name === "read");
  assert.equal(read?.type, "number?");
  const other = result.semanticIndex.symbols.find((item) => item.name === "other");
  assert.equal(other?.members.find((member) => member.name === "item")?.type, "number?");
});

test("[F4] a type alias of an enum publishes the enum's members", () => {
  // ENM-I4: identities follow aliases, so `Shade.red` resolves. The editor
  // offered `is` and `parse` and nothing else, because it built the `Type<T>`
  // members itself instead of asking the resolution that accepts `Shade.red`.
  const source = `enum Color:
    red
    green

type Shade = Color

print(str(Shade.red))
`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const shade = result.semanticIndex.symbols.find((item) => item.name === "Shade" && item.kind === "type");
  assert.deepEqual([...(shade?.members ?? [])].map((member) => member.name).sort(), ["green", "is", "parse", "red", "values"]);
});
