import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile as compileCore, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// ---------------------------------------------------------------------------
// D90 R15 — one ruling, two halves.
//
// (a) A `watch` subject is the name of a `state` or a `computed`, or a read
// path out of one. No operators, no calls. The measured net change is exactly
// two shapes: `watch a + b as sum, _:` and `watch f():` go from accepted to
// refused. `watch items[0].done:` stays legal at any depth and with a reactive
// index, because it names a place rather than computing a value.
//
// (b) `cached` is deleted. Its intrinsic was literally named
// `reactive.computed`; its type `() -> T` was indistinguishable from any
// zero-argument function, which is why the compiler could not see that it held
// a derived value — and D69's dead watch came from exactly that. `computed`
// already caches, so nothing but the second spelling goes away.
//
// Both halves refuse something an author may reasonably have written, so the
// diagnostics are the deliverable: every refusal below is asserted verbatim,
// including the echo of the author's own expression and the `computed` line
// that replaces it. A refusal that does not teach the replacement would be a
// worse defect than the thing it refuses.
// ---------------------------------------------------------------------------

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

function messages(text: string): readonly string[] {
  return compile(text).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The record and list shapes every path probe below reads through. */
const shapes = `
type Cell:
    value: number

type Row:
    cells: List<Cell>

type Item:
    done: bool

type Profile:
    name: string

type User:
    profile: Profile

async def load(n: number) -> number:
    return n
`;

// ---------------------------------------------------------------------------
// (a) What a subject may be: a name, or a read path out of one.
// ---------------------------------------------------------------------------

test("[D90-R15a] a module-scope subject may be a reactive name or any read path out of one", () => {
  // `resource` is component-scope only (VEL3012), so the resource field is
  // probed in the component case below rather than duplicated here.
  assert.deepEqual(messages(`${shapes}
state n = 1
state i = 0
state j = 0
state items: List<Item> = [{done: false}]
state rows: List<Row> = [{cells: [{value: 1}]}]
state user: User = {profile: {name: "a"}}
computed doubled = n * 2
const plain = [1, 2]

watch n:
    print("state")
watch doubled:
    print("computed")
watch items[0].done:
    print("constant index")
watch rows[i].cells[j]:
    print("reactive index, twice over")
watch user.profile.name:
    print("member path")
watch plain[0]:
    print("a plain root is the frozen rule's question, not this one")
watch n as current, previous:
    print(f"{current} {previous}")
watch doubled as current, _:
    print(f"{current}")
watch items[0].done as current, previous:
    print(f"{current} {previous}")
watch rows[i].cells[j] as current, _:
    print(f"{current.value}")
watch user.profile.name as current, previous:
    print(f"{current} {previous}")
watch plain[0] as current, _:
    print(f"{current}")
`), []);
});

test("[D90-R15a] a component-scope subject accepts the same shapes, plus a prop and a resource field", () => {
  assert.deepEqual(messages(`${shapes}
export component Panel(title: string):
    state n = 1
    state i = 0
    state j = 0
    state items: List<Item> = [{done: false}]
    state rows: List<Row> = [{cells: [{value: 1}]}]
    state user: User = {profile: {name: "a"}}
    computed doubled = n * 2
    resource data: number = load(n)
    const plain = [1, 2]

    watch n:
        print("state")
    watch doubled:
        print("computed")
    watch title:
        print("prop")
    watch data.value:
        print("resource field")
    watch items[0].done:
        print("constant index")
    watch rows[i].cells[j]:
        print("reactive index, twice over")
    watch user.profile.name:
        print("member path")
    watch plain[0]:
        print("a plain root is the frozen rule's question, not this one")
    watch title as current, previous:
        print(f"{current} {previous}")
    watch data.value as current, _:
        print(f"{current}")
    watch items[0].done as current, previous:
        print(f"{current} {previous}")
    watch rows[i].cells[j] as current, _:
        print(f"{current.value}")
    watch user.profile.name as current, previous:
        print(f"{current} {previous}")
    watch plain[0] as current, _:
        print(f"{current}")

    return <p>{n} {doubled} {title}</p>
`), []);
});

// ---------------------------------------------------------------------------
// (a) What a subject may not be: an operator, or a call. The message names the
// author's own expression and the `computed` line that replaces it.
// ---------------------------------------------------------------------------

const refusedSubjects = [
  "VEL5071 A watch subject names what to watch, not what to compute: 'a + b' computes a value. Declare it — 'computed sum = a + b' — then 'watch sum as current, _:'",
  "VEL5071 A watch subject names what to watch, not what to compute: 'f()' computes a value. Declare it — 'computed value = f()' — then 'watch value:'",
  "VEL5071 A watch subject names what to watch, not what to compute: 'use ? a : b' computes a value. Declare it — 'computed value = use ? a : b' — then 'watch value:'",
  "VEL5071 A watch subject names what to watch, not what to compute: 'not flag' computes a value. Declare it — 'computed value = not flag' — then 'watch value:'",
  "VEL5071 A watch subject names what to watch, not what to compute: 'a < b < c' computes a value. Declare it — 'computed value = a < b < c' — then 'watch value:'",
  "VEL5071 A watch subject names what to watch, not what to compute: 'f\"{a}\"' computes a value. Declare it — 'computed value = f\"{a}\"' — then 'watch value:'",
  // The `await` subject was already refused as asynchronous work; R15(a) adds
  // the shape refusal beside it, and both name a different repair.
  "VEL4007 Computed callbacks and watch blocks are synchronous; use resource, action, or mounted for async work",
  "VEL5071 A watch subject names what to watch, not what to compute: 'await later()' computes a value. Declare it — 'computed value = await later()' — then 'watch value:'",
];

test("[D90-R15a] a module-scope operator or call subject is refused and told which computed to declare", () => {
  assert.deepEqual(messages(`
async def later() -> number:
    return 1

def f() -> number:
    return 1

state a = 1
state b = 2
state c = 3
state flag = true
const use = true

watch a + b as sum, _:
    print("operator")
watch f():
    print("call")
watch use ? a : b:
    print("the conditional is an operator by the charter's own vocabulary")
watch not flag:
    print("unary")
watch a < b < c:
    print("comparison chain")
watch f"{a}":
    print("an f-string builds a value rather than naming a place")
watch await later():
    print("await")
`), refusedSubjects);
});

test("[D90-R15a] a component-scope subject is refused by the same rule and the same message", () => {
  assert.deepEqual(messages(`
async def later() -> number:
    return 1

def f() -> number:
    return 1

export component App:
    state a = 1
    state b = 2
    state c = 3
    state flag = true
    const use = true

    watch a + b as sum, _:
        print("operator")
    watch f():
        print("call")
    watch use ? a : b:
        print("the conditional is an operator by the charter's own vocabulary")
    watch not flag:
        print("unary")
    watch a < b < c:
        print("comparison chain")
    watch f"{a}":
        print("an f-string builds a value rather than naming a place")
    watch await later():
        print("await")

    return <p>{a}</p>
`), refusedSubjects);
});

test("[D90-R15a] the refusal carries no fix, because a span edit cannot move the subject text", () => {
  const module = `
state a = 1
state b = 2

watch a + b as sum, _:
    print("operator")
`;
  const refusals = compile(module).diagnostics.filter((item) => item.code === "VEL5071");
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]?.fix, undefined);
  assert.equal(applyMechanicalFixes(module.trimStart(), compile(module).diagnostics).text, module.trimStart());
});

test("[D90-R15a] the echoed subject is the author's own source, and the computed line it names compiles", () => {
  // The echo is the deliverable, so it is reconstructed faithfully or not at
  // all. A text literal keeps its quotes — `LiteralExpression.raw` holds the
  // decoded content, so echoing that would print `term + !` and hand the author
  // a `computed` line that does not compile. A call keeps its callee and its
  // argument list, which is the whole class the two named shapes sit in:
  // `term.trim()` and `scores.get(key)` are how a Map entry is read at all. And
  // the author's own parentheses survive, so the reconstruction parses back to
  // the tree it came from rather than re-associating.
  const bindings = `
type Item:
    done: bool

state term = "a"
state items: List<Item> = []
state scores: Map<string, number> = Map()
state a = 1
state b = 2
state c = 3
`;
  const subjects = [
    `term + "!"`,
    `term == "he said \\"hi\\"\\n"`,
    "term.trim()",
    "items.filter(row => not row.done).size",
    `scores.get("a")`,
    "(a + b) * c",
    "a + b * c",
  ];
  for (const subject of subjects) {
    const refused = compile(`${bindings}\nwatch ${subject}:\n    print("refused")\n`);
    assert.deepEqual(refused.diagnostics.map((item) => `${item.code} ${item.message}`), [
      `VEL5071 A watch subject names what to watch, not what to compute: '${subject}' computes a value.`
        + ` Declare it — 'computed value = ${subject}' — then 'watch value:'`,
    ]);
    // The exit the message names is the product; compile the line it wrote.
    const exit = compile(`${bindings}\ncomputed named = ${subject}\n\nwatch named:\n    print("kept")\n`);
    assert.deepEqual(exit.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  }
});

// ---------------------------------------------------------------------------
// (a) The frozen rule keeps its own shapes. A subject built only from frozen
// parts has no reactive source at all, so telling its author to declare a
// `computed` would only buy him a dead one — and one shape must not draw two
// messages.
// ---------------------------------------------------------------------------

test("[D90-R15a] a frozen subject still reports VEL5064, unchanged", () => {
  // The last two subjects are the ordering probe the ruling names: a frozen
  // subject is asked before the shape rule, so a computation built only out of
  // frozen parts draws VEL5064 alone. Telling its author to declare a
  // `computed` would only buy him a dead one, and one shape is never reported
  // by two rules — swap the two blocks in `rejectFrozenWatchSubject` and these
  // two rows turn into VEL5071.
  assert.deepEqual(messages(`
export component App:
    state count = 0
    const plain = 7
    const other = 8

    watch 5:
        print("dead")
    watch "x":
        print("dead")
    watch plain:
        print("dead")
    watch plain as now, before:
        print("dead")
    watch plain + 1:
        print("dead")
    watch plain + other:
        print("dead")

    return <p>{count}</p>
`), [
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run — 'plain' is not a reactive source; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run — 'plain' is not a reactive source; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
  ]);
});

test("[D90-R15a] a watched zero-argument reader is sent to the declaration, not to 'watch reader():'", () => {
  // The old exit taught `watch reader():`, which R15(a) now refuses — so the
  // message names the declaration instead. With `cached` gone this binding is
  // an ordinary function and nothing else.
  const reader = `
state count = 0

def read() -> number:
    return count

const reader = read

watch reader:
    print("dead")
`;
  assert.deepEqual(messages(reader), [
    "VEL5064 'reader' is the reader itself, so watching it watches a value that never changes; declare the derived value — 'computed name = reader()' — then 'watch name:'",
  ]);
  assert.ok(!messages(reader).some((item) => item.includes("watch reader():")));
});

test("[D90-R15a] a called computed subject — D69's own shape — draws VEL5063 alone, and its fix makes the subject legal", () => {
  // `watch total()` is the spelling D69 taught, and R15(a) refuses it. But
  // VEL5063 has already named it, and its edit — drop the parentheses — leaves
  // a subject the rule accepts. Adding the shape rule on top would report one
  // mistake twice and would hand the author `computed value = total()`, a line
  // that draws VEL5063 in its turn.
  const called = `
state count = 1
computed total = count * 2

watch total():
    print("dead")
`;
  assert.deepEqual(messages(called), [
    "VEL5063 'total' is a computed value, not a reader: it is read bare like state, so write 'total' rather than 'total()'",
  ]);
  assert.deepEqual(compile(applyMechanicalFixes(called.trimStart(), compile(called).diagnostics).text).diagnostics, []);

  // A call of anything that is not a bare computed keeps the shape rule.
  assert.deepEqual(messages(`
state count = 1

def total() -> number:
    return count
watch total():
    print("dead")
`), [
    "VEL5071 A watch subject names what to watch, not what to compute: 'total()' computes a value."
      + " Declare it — 'computed value = total()' — then 'watch value:'",
  ]);
});

// ---------------------------------------------------------------------------
// (b) `cached` is a removed spelling, and a removed spelling is taught, not
// left to degrade into an unknown name.
// ---------------------------------------------------------------------------

test("[D90-R15b] a module-scope cached declaration reports VEL5055 and rewrites to the computed declaration", () => {
  const module = `
state n = 1
const doubled = cached(() => n * 2)

export def total() -> number:
    return doubled()
`;
  const result = compile(module);
  const migration = result.diagnostics.filter((item) => item.code === "VEL5055");
  assert.deepEqual(migration.map((item) => item.message), [
    "A derived value is declared, not called: write 'computed doubled = ...' and read 'doubled' bare.",
  ]);
  assert.equal(migration[0]?.fix?.title, "Declare 'doubled' with computed");
  assert.equal(applyMechanicalFixes(module.trimStart(), result.diagnostics).text, `state n = 1
computed doubled = n * 2

export def total() -> number:
    return doubled
`);
});

test("[D90-R15b] a component-scope cached declaration reports the same migration", () => {
  const module = `
export component App:
    state n = 1
    const d = cached(() => n * 2)
    return <p>{d()}</p>
`;
  const result = compile(module);
  assert.deepEqual(result.diagnostics.filter((item) => item.code === "VEL5055").map((item) => item.message), [
    "A derived value is declared, not called: write 'computed d = ...' and read 'd' bare.",
  ]);
  assert.equal(applyMechanicalFixes(module.trimStart(), result.diagnostics).text, `export component App:
    state n = 1
    computed d = n * 2
    return <p>{d}</p>
`);
});

test("[D90-R15b] a cached argument that is a named function is told to write the call", () => {
  assert.ok(messages(`
state n = 1

def readA() -> number:
    return n

const one = cached(readA)

export def use() -> number:
    return one()
`).includes("VEL5055 A derived value is declared, not called: write 'computed one = ...' and read 'one' bare."
    + " Where the argument is a function rather than an expression, write the call — 'computed one = readA()'"));
});

test("[D90-R15b] an exported cached reader gets the migration, and no exported-contract rule of its own", () => {
  const reported = messages(`
state n = 1
export const one = cached(() => n * 2)
`);
  assert.deepEqual(reported, [
    "VEL5055 A derived value is declared, not called: write 'computed one = ...' and read 'one' bare.",
  ]);
  assert.ok(!reported.some((item) => item.startsWith("VEL4025")));
});

test("[D90-R15b] a bare cached reference is a removed spelling, not an unknown name", () => {
  const reported = messages(`
state n = 1
const holder = {cached}
`);
  assert.deepEqual(reported, [
    "VEL5055 'cached' is removed: 'computed' declares a derived value — 'computed name = expression'."
    + " There is no function form, and 'computed' already caches",
  ]);
  assert.ok(!reported.some((item) => item.startsWith("VEL3001")));
});

test("[D90-R15b] a user binding named cached is an ordinary Core name and shadows the diagnostic", () => {
  assert.deepEqual(messages(`
const cached = 1

export def read() -> number:
    return cached
`), []);
});

// ---------------------------------------------------------------------------
// Round trip. The formatter never had a `cached` case, so this is the guard
// that the surviving spelling stays stable through it.
// ---------------------------------------------------------------------------

test("[D90-R15] formatting a module that declares its derived values with computed is stable", () => {
  const module = `state n = 1
computed doubled = n * 2

export component App:
    state count = 0
    computed label = count * 2

    watch doubled as current, previous:
        print(f"{current} {previous}")

    return <p>{count} {label} {doubled}</p>
`;
  const formatted = formatSource(module, { extensions: [velarCompilerExtension] });
  assert.equal(formatted, module);
  assert.equal(formatSource(formatted, { extensions: [velarCompilerExtension] }), formatted);
  const result = compile(module);
  assert.deepEqual(result.diagnostics, []);
  // The declaration still lowers through the one derived-value helper: `cached`
  // took its identifier mapping with it and nothing else moved.
  assert.match(result.code ?? "", /const doubled = __velarComputed\(/u);
  assert.match(result.code ?? "", /const label = __velarComputed\(/u);
});
