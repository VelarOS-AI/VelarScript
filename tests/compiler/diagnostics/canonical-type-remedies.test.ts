import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * Canonical type remedies: every suggested spelling compiles at its site.
 *
 * Every item here is a message whose *fix* was the defect: a spelling that
 * `velar check` refuses on the next run (`type Map:`, `Type.parse`,
 * `import {shared as other}`), a hard-coded example that fits no site
 * (`() -> null`, `let items: List<string> = []`), or a caret on the one part of
 * the line that was already right. So each test asserts the sentence and then
 * pastes what it names back into the source and asks for a clean compile —
 * that second half is the whole point of the batch, and a message that cannot
 * pass it has not been fixed.
 */

function messages(source: string, options: Parameters<typeof compile>[1] = {}): readonly string[] {
  return compile(source.trimStart(), options).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The remedy, pasted back. */
function assertCompiles(source: string, options: Parameters<typeof compile>[1] = {}): void {
  assert.deepEqual(messages(source, options), []);
}

/** The source text a diagnostic underlines, so a caret claim is read rather than counted. */
function underlined(source: string, options: Parameters<typeof compile>[1] = {}): readonly string[] {
  const trimmed = source.trimStart();
  return compile(trimmed, options).diagnostics.map((item) => trimmed.slice(item.span.start, item.span.end));
}

// ── CO-I2: the four collection names in a value position ────────────────────

test("[CO-I2] Map, Set, Record and List answer a value position with one VEL3008 each", () => {
  assert.deepEqual(messages(`
@main:
    print(str(Map.get(Map({a: 1}), "a")))
`), [
    "VEL3008 Maps are created with a 'Map(...)' call — Map({key: value}) from a record, Map([[key, value]]) from"
    + " entries — and every operation is a member of the Map value; 'Map<K, V>' is a type name, not a constructor",
  ]);
  assert.deepEqual(messages(`
@main:
    print(str(Set.add(Set([1]), 2)))
`), [
    "VEL3008 Sets are created with a 'Set(...)' call — Set([value]) copies a List — and every operation is a member"
    + " of the Set value; 'Set<T>' is a type name, not a constructor",
  ]);
  assert.deepEqual(messages(`
@main:
    print(str(Record.keys({a: 1})))
`), [
    "VEL3008 A record is a '{field: value}' literal, and every operation is a member of that value;"
    + " 'Record<V>' is a type name, not a constructor",
  ]);
  assert.deepEqual(messages(`
@main:
    print(str(List.repeat(1, 2)))
`), [
    "VEL3008 Lists are created with a '[]' literal (or [...values] to copy); 'List<T>' is a type name,"
    + " not a constructor",
  ]);
});

test("[CO-I2] each of the four sentences names a spelling that compiles", () => {
  assertCompiles(`
@main:
    const m = Map({a: 1})
    print(str(m.get("a")))
    const entries = Map([["a", 1]])
    print(str(entries.get("a")))
    const s = Set([1])
    print(str(s.has(1)))
    const r: Record<number> = {a: 1}
    print(str(r.keys().size))
    const l = [1, 2]
    print(str(l.size))
`);
});

test("[CO-I2] the caret is the type name, as it already was for List", () => {
  assert.deepEqual(underlined(`
@main:
    print(str(Map.get(Map({a: 1}), "a")))
`), ["Map"]);
});

// ── CO-I3: a fresh Map()/Set() adopts the type its position names ───────────

test("[CO-I3] Map({...}) in a Map<string, unknown> position compiles, like [] in a List position", () => {
  assertCompiles(`
def record(scope: string, fields: Map<string, unknown>) -> number:
    return fields.size + scope.size

@main:
    print(str(record("build", Map({a: 1}))))
`);
  assertCompiles(`
@main:
    const fromRecord: Map<string, unknown> = Map({a: 1})
    const fromEntries: Map<string, unknown> = Map([["a", 1]])
    const fromMap: Map<string, unknown> = Map(Map({a: 1}))
    const tags: Set<unknown> = Set([1])
    print(str(fromRecord.size + fromEntries.size + fromMap.size + tags.size))
`);
});

test("[CO-I3] a source the position would refuse keeps the type it built", () => {
  assert.deepEqual(messages(`
@main:
    const scores: Map<string, number> = Map({a: "x"})
    print(str(scores.size))
`).filter((item) => item.includes("Map<")), [
    "VEL4001 Cannot assign Map<string, string> to Map<string, number>",
  ]);
});

// ── CO-I4: the retired Function shorthand ──────────────────────────────────

test("[CO-I4] a bare Function annotation is answered from the initializer's real signature", () => {
  assert.deepEqual(messages(`
@main:
    const g: Function = (a: number) => a + 1
    print(str(g(1)))
`), [
    "VEL2012 The 'Function' type shorthand is retired; a function type has one spelling, the arrow —"
    + " write '(a: number) -> number'",
  ]);
});

test("[CO-I4] a position with no initializer is told the shape, not a hard-coded arrow", () => {
  assert.deepEqual(messages(`
def take(cb: Function):
    cb()

@main:
    take(() => print("y"))
`), [
    "VEL2012 The 'Function' type shorthand is retired; a function type has one spelling, the arrow —"
    + " write the parameter types in parentheses, then '->', then the result type this position takes",
  ]);
});

test("[CO-I4] class field remedies use the initializer, including private and static fields", () => {
  for (const modifiers of ["", "private ", "static ", "private static "]) {
    const source = `class Holder:\n    ${modifiers}let callback: Function = (n: number) => n + 1\n`;
    const result = compile(source);
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    const report = result.diagnostics[0]!;
    assert.match(report.message, /write '\(n: number\) -> number'/);
    assert.equal(source.slice(report.span.start, report.span.end), "Function");
    assertCompiles(source.replace("Function", "(n: number) -> number"));
  }
});

test("[CO-I4] a parameter without signature evidence has no fabricated arity or assignment error", () => {
  const reports = messages(`
def take(cb: Function):
    cb(1, 2)

@main:
    take((n: number) => n + 1)
`);
  assert.equal(reports.length, 1, JSON.stringify(reports));
  assert.match(reports[0]!, /VEL2012.*parameter types in parentheses/);
});

test("[CO-I4] both spellings compile once written", () => {
  assertCompiles(`
def take(cb: () -> null):
    cb()

@main:
    take(() => print("y"))
    const g: (a: number) -> number = (a: number) => a + 1
    print(str(g(1)))
`);
});

// ── CO-I5: the validation ritual ───────────────────────────────────────────

test("[CO-I5] a projection names the author's type and their own spelling of the value", () => {
  assert.deepEqual(messages(`
type User:
    name: string

@main:
    const raw = Json.parse("{}")
    const u = User.from(raw)
    print(str(u.name))
`), [
    "VEL4001 Cannot build User from unknown; validate untrusted data with 'User.parse(raw)'"
    + " before projecting a typed record",
  ]);
});

test("[CO-I5] the remedy a projection names compiles", () => {
  assertCompiles(`
type User:
    name: string

@main:
    const raw = Json.parse("{}")
    const checked = User.parse(raw)
    const u = User.from(checked)
    print(str(u.name))
`);
});

test("[CO-I5] a site that names no type writes the placeholder as a placeholder", () => {
  assert.deepEqual(messages(`
@main:
    const raw = Json.parse("{}")
    const v = await raw
    print(str(v))
`), [
    "VEL4001 Cannot await unknown; an unchecked thenable runs foreign hooks and can leak raw undefined — declare the"
    + " source in an extern contract so the result is a checked Promise, or validate the resolved data at the edge"
    + " with '<YourType>.parse(value)'",
  ]);
  assert.deepEqual(messages(`
@main:
    const raw = Json.parse("{}")
    print(str(raw(1)))
`), [
    "VEL4001 Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an"
    + " 'extern module' contract or a contracted 'extern js' block gives 'raw' a checked type — or validate the data"
    + " it came from with '<YourType>.parse(value)' first",
  ]);
});

// ── CO-I6: the caret of an unknown named argument ──────────────────────────

test("[CO-I6] the unknown named argument underlines the name, not the value", () => {
  assert.deepEqual(underlined(`
@main:
    print(str(range(start=1, stop=4).size))
`), ["stop"]);
  assert.deepEqual(underlined(`
@main:
    print(str([1, 2].sorted(key=(v: number) => v).size))
`), ["key"]);
});

test("[CO-I6] the parameter names those calls do take still compile", () => {
  assertCompiles(`
@main:
    print(str(range(start=1, end=4).size))
    print(str([1, 2].sorted().size))
`);
});

test("[CO-I6] labels retain their exact token spans across comments and multiline values", () => {
  assert.deepEqual(underlined(`
@main:
    print(str(range(start=1, stop= // the end value
        4).size))
`), ["stop"]);
  assert.deepEqual(underlined(`
@main:
    print(str(range(start=1, stop=(
        4)).size))
`), ["stop"]);
});

// ── CO-I14: an empty record literal on the right of ?? against a class ─────

test("[CO-I14] the class arm takes the useful report instead of printing a union nobody wrote", () => {
  assert.deepEqual(messages(`
class Foo:
    let x: number = 1

@main:
    const f: Foo? = null
    const g: Foo = f ?? {}
    print(str(g.x))
`), [
    "VEL4001 A record literal cannot build Foo; a class instance comes from its constructor — write 'Foo(...)'",
  ]);
});

test("[CO-I14] the record arm keeps the report it already had, and the constructor compiles", () => {
  assert.deepEqual(messages(`
type Foo:
    name: string

@main:
    const f: Foo? = null
    const g: Foo = f ?? {}
    print(g.name)
`), ["VEL4001 Object is missing required field 'name'"]);
  assertCompiles(`
class Foo:
    let x: number = 1

@main:
    const f: Foo? = null
    const g: Foo = f ?? Foo()
    print(str(g.x))
`);
});

// ── CO-I15: the empty-collection annotation ────────────────────────────────

test("[CO-I15] VEL4039 names the binding and the word it was declared with", () => {
  assert.deepEqual(messages(`
@main:
    const names = []
    names.append("a")
    print(str(names.size))
`), [
    "VEL4039 Empty '[]' requires an explicit type; nothing at this position says what the List holds — write"
    + " 'const names: List<Element> = []', putting the type it holds in place of '<Element>'",
  ]);
  assert.deepEqual(messages(`
@main:
    let scores = Map()
    scores.set("a", 1)
    print(str(scores.size))
`), [
    "VEL4039 Empty 'Map()' requires an explicit type; nothing at this position says what the Map holds — write"
    + " 'let scores: Map<Key, Value> = Map()', putting the type it holds in place of '<Key>' and '<Value>'",
  ]);
  assert.deepEqual(messages(`
@main:
    let tags = Set()
    tags.add("a")
    print(str(tags.size))
`), [
    "VEL4039 Empty 'Set()' requires an explicit type; nothing at this position says what the Set holds — write"
    + " 'let tags: Set<Element> = Set()', putting the type it holds in place of '<Element>'",
  ]);
});

test("[CO-I15] a position with no binding to name is told to declare the type there", () => {
  assert.deepEqual(messages(`
def make():
    return []

@main:
    print(str(make().size))
`), [
    "VEL4039 Empty '[]' requires an explicit type; nothing at this position says what the List holds — declare the"
    + " type at this position — 'List<Element>' — putting the type it holds in place of '<Element>'",
  ]);
});

test("[CO-I15] each named binding compiles once annotated", () => {
  assertCompiles(`
@main:
    const names: List<string> = []
    names.append("a")
    let scores: Map<string, number> = Map()
    scores.set("a", 1)
    let tags: Set<string> = Set()
    tags.add("a")
    print(str(names.size + scores.size + tags.size))
`);
});

// ── CO-C1: the six receiver-shaped number operations ───────────────────────

test("[CO-C1] all six Math spellings are answered with the receiver rewrite", () => {
  assert.deepEqual(messages(`
@main:
    print(str(Math.abs(0 - 1)))
    print(str(Math.round(1.5)))
    print(str(Math.floor(1.5)))
    print(str(Math.ceil(1.5)))
    print(str(Math.sign(0 - 1)))
    print(str(Math.trunc(1.5)))
`), [
    "VEL3008 Use '(0 - 1).abs()'; 'abs' is a number method, not a Math namespace member",
    "VEL3008 Use '(1.5).round()'; 'round' is a number method, not a Math namespace member",
    "VEL3008 Use '(1.5).floor()'; 'floor' is a number method, not a Math namespace member",
    "VEL3008 Use '(1.5).ceil()'; 'ceil' is a number method, not a Math namespace member",
    "VEL3008 Use '(0 - 1).sign()'; 'sign' is a number method, not a Math namespace member",
    "VEL3008 Use '(1.5).trunc()'; 'trunc' is a number method, not a Math namespace member",
  ]);
});

test("[CO-C1] every one of the six rewrites compiles, and the namespace keeps its own members", () => {
  assertCompiles(`
@main:
    print(str((0 - 1).abs()))
    print(str((1.5).round()))
    print(str((1.5).floor()))
    print(str((1.5).ceil()))
    print(str((0 - 1).sign()))
    print(str((1.5).trunc()))
    print(str(Math.min(1, 2) + Math.max(1, 2) + Math.clamp(3, 1, 2)))
`);
});

// ── CO-U4: `readonly` as a value name ──────────────────────────────────────

test("[CO-U4] 'readonly' names a value, and the charter now says so", () => {
  // docs/language-charter.md §4: the contextual words are ordinary names
  // wherever a name can stand, and `readonly` is the one a *type* position owns
  // outright. The value positions were never written into that rule.
  assertCompiles(`
def readonly() -> number:
    return 1

@main:
    const value = readonly()
    print(str(value))
`);
  assertCompiles(`
@main:
    const readonly = 1
    print(str(readonly))
`);
});

test("[CO-U4] the five type positions the charter names still refuse it", () => {
  const refusal = "'readonly' is the read-only view modifier, so it cannot name";
  for (const [source, position] of [
    ["class readonly:\n    let x: number = 1\n\n@main:\n    print(\"x\")\n", "class"],
    ["type readonly:\n    a: number\n\n@main:\n    print(\"x\")\n", "type"],
    ["enum readonly:\n    a\n\n@main:\n    print(\"x\")\n", "enum"],
    ["def go<readonly>(value: readonly) -> readonly:\n    return value\n\n@main:\n    print(str(go(1)))\n", "type parameter"],
    [
      "extern module \"node:crypto\":\n    export class readonly:\n        def go() -> null\n\n@main:\n    print(\"x\")\n",
      "extern class",
    ],
  ] as const) {
    const reported = messages(source);
    assert.ok(
      reported.some((item) => item.endsWith(
        `${refusal} a${/^[aeiou]/u.test(position) ? "n" : ""} ${position}; every use of it would read as the modifier`,
      )),
      `${position}: ${JSON.stringify(reported)}`,
    );
  }
});
