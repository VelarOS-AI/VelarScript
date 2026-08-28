import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";

// Wave closeout, Web analyzer. Two items land here:
//
//   co-3  D89's A4: the React immutable-update idiom against a keyed list,
//         raised on the advisory channel -- no diagnostic, no semantic change,
//         and `__velarKeyed`'s identity check untouched (D90 R2 stands).
//   co-5  Look builder checks read the position from the builder signature, so
//         a named argument no longer skips every check in the loop.
//
// co-2 was the third, and D90 R21 deleted it. It held D90's R1-a revision --
// VEL5069 defeated by extracting a helper, then repointed by R16 to report the
// undeclared write (VEL5072) instead of deciding the schedule. R21 revoked the
// promise both diagnostics served: execution order is now the order the watches
// are written, compile time no longer analyzes who writes what, and every case
// co-2 held was a case about an analysis that no longer exists. The one claim
// worth keeping from that family -- that swapping two watches now changes the
// result -- is asserted at execution level in tests/hardening-wave-r1a.test.ts
// and tests/hardening-d90-r21-source-order.test.ts.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

// ---------------------------------------------------------------------------
// co-3 -- A4, the React immutable update against a keyed list
// ---------------------------------------------------------------------------

const keyedList = (update: string) => `
component App:
    state items = [{ id: "a", done: false }]

    action toggle():
        ${update}

    return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
`;

function advisories(source: string): readonly { readonly code: string; readonly message: string }[] {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  return result.advisories ?? [];
}

test("[co-3] rebuilding the rows of a keyed list is advised, not refused", () => {
  const source = keyedList(`items = items.map(item => { ...item, done: true })`);
  const reported = advisories(source);
  assert.deepEqual(reported.map((item) => item.code), ["A4"]);
  assert.match(reported[0]!.message, /rebuilds every row of 'items'/u);
  // The keys do not move -- `__velarKeyed` finds the entry under the same key
  // and drops it because the row it holds is no longer the same value. An
  // author who reads "every key changes" checks `id`, finds it unchanged, and
  // concludes the advisory is wrong, so the message must name the row.
  assert.match(reported[0]!.message, /every row is a new value/u);
  assert.doesNotMatch(reported[0]!.message, /key changes identity/u);
  assert.match(reported[0]!.message, /no longer recognises any of them/u);
  assert.match(reported[0]!.message, /destroys and rebuilds all of its children/u);
  assert.match(reported[0]!.message, /an input being typed into loses focus/u);
  assert.match(reported[0]!.message, /'items\[index\]\.done = \.\.\.'/u);
  // An advisory never fails a build and never moves a byte of output: the
  // in-place spelling and the mapped one differ only in what they emit for the
  // update itself, and D90 R2's identity check is untouched by either.
  const result = compile(source);
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.code ?? "", /__velarKeyed/u);
});

test("[co-3] a field-by-field rewrite and a conditional rewrite both trigger", () => {
  const byField = advisories(keyedList(`items = items.map(item => { id: item.id, done: true })`));
  assert.deepEqual(byField.map((item) => item.code), ["A4"]);
  // The suggestion has to name the field the callback rewrites. `id` only
  // carries the row's own value over, and assigning the key in place is the one
  // rewrite that really would change the key.
  assert.match(byField[0]!.message, /'items\[index\]\.done = \.\.\.'/u);
  assert.doesNotMatch(byField[0]!.message, /items\[index\]\.id/u);
  // The React spelling nearly always carries the conditional, and its `else`
  // branch returning the row unchanged is not a second shape.
  assert.deepEqual(advisories(keyedList(`items = items.map(item => item.done ? { ...item, done: false } : item)`)).map((item) => item.code), ["A4"]);
  // A field that reads something other than its own name is a rewrite, so the
  // passthrough skip is not wide enough to swallow one.
  const crossed = advisories(`
component App:
    state items = [{ id: "a", label: "b" }]

    action toggle():
        items = items.map(item => { id: item.label, label: "x" })

    return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
`);
  assert.match(crossed[0]!.message, /'items\[index\]\.id = \.\.\.'/u);
});

test("[co-3] a copy that rewrites no field names no field", () => {
  // A bare copy rewrites nothing; the copy itself is what moves the identity,
  // and so does a record that spells every field back out unchanged. There is
  // no field to name, so the message carries a placeholder that reads as one
  // rather than the word `field`, which reads as a member the row really has.
  for (const update of [`items = items.map(item => { ...item })`, `items = items.map(item => { id: item.id, done: item.done })`]) {
    const reported = advisories(keyedList(update));
    assert.deepEqual(reported.map((item) => item.code), ["A4"]);
    assert.match(reported[0]!.message, /'items\[index\]\.<field> = \.\.\.'/u);
  }
});

test("[co-3] the map result not feeding that keyed list does not trigger", () => {
  assert.deepEqual(advisories(`
component App:
    state items = [{ id: "a", done: false }]
    state other = [{ id: "b", done: false }]

    action toggle():
        other = other.map(item => { ...item, done: true })

    return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
`), []);
});

test("[co-3] a callback returning the original row does not trigger", () => {
  assert.deepEqual(advisories(keyedList(`items = items.map(item => item)`)), []);
});

test("[co-3] a newly constructed list rather than a mapping of itself does not trigger", () => {
  assert.deepEqual(advisories(`
component App:
    state items = [{ id: "a", done: false }]
    state source = [{ id: "b", done: false }]

    action toggle():
        items = source.map(item => { ...item, done: true })

    return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
`), []);
});

test("[co-3] the in-place update the advisory teaches does not trigger", () => {
  assert.deepEqual(advisories(`
component App:
    state items = [{ id: "a", done: false }]

    action toggle(index: number):
        items[index].done = true

    return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
`), []);
});

test("[co-3] a rebuilt list nothing renders by key does not trigger", () => {
  assert.deepEqual(advisories(`
component App:
    state items = [{ id: "a", done: false }]

    action toggle():
        items = items.map(item => { ...item, done: true })

    return <p>{items.size}</p>
`), []);
});

test("[co-3] the three suppression states go through the existing machinery", () => {
  // With a reason: the advisory is gone and the build still passes. This is the
  // case the ruling calls out -- a `readonly` list or one API response leaves
  // `map` plus a record literal as the only spelling.
  const allowed = compile(keyedList(
    `items = items.map(item => { ...item, done: true })  // velar-allow A4: the rows arrive from one API response`,
  ));
  assert.deepEqual(allowed.diagnostics.map((item) => item.code), []);
  assert.deepEqual((allowed.advisories ?? []).map((item) => item.code), []);

  // Without a reason: an error, because the reason is the whole mechanism.
  const bare = compile(keyedList(`items = items.map(item => { ...item, done: true })  // velar-allow A4`));
  assert.deepEqual(bare.diagnostics.map((item) => item.code), ["VEL1011"]);

  // Stale: an error, so a suppression cannot rot in the file.
  const stale = compile(`
component App:
    state items = [{ id: "a", done: false }]

    action toggle(index: number):
        items[index].done = true  // velar-allow A4: nothing here rebuilds

    return <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>
`);
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});

// ---------------------------------------------------------------------------
// co-3, wider proven shape -- the same churn spelled as a derived value.
//
// The P2b reconciliation wave compiled both spellings of one application and
// found only the assigned one named: `items = items.map(...)` was advised, and
// the `computed` over a `for`/`append` builder that rebuilds the very same rows
// was silent, though it is the more idiomatic of the two and is what the
// consumer actually wrote. Same advisory, same suppression, wider proof.
// ---------------------------------------------------------------------------

/** The consumer's spelling: a builder `def`, a `computed` over it, a keyed list. */
const derivedList = (declaration: string, initializer: string) => `
type Row:
    key: string
    text: string

state text = "a"
state rows: List<Row> = [{ key: "a", text: "a" }]

${declaration}
component Row_(row: Row):
    return <span>{row.text}</span>

component App:
    computed built = ${initializer}

    return <ul>{built.map(row => <Row_ key={row.key} row={row} />)}</ul>
`;

const straightLineBuilder = `
def build(value: string) -> List<Row>:
    const made: List<Row> = []
    made.append({ key: "r0", text: value })
    return made
`;

// The row is rewritten rather than mirrored field for field, which keeps A9 --
// the exact-projection advisory -- out of the reading; A4's question is the
// identity of the record, not how its fields were filled.
const loopBuilder = `
def build(source: List<Row>) -> List<Row>:
    const made: List<Row> = []
    for row in source:
        made.append({ key: row.key, text: row.text + "!" })
    return made
`;

test("[co-3] a 'for'/'append' builder behind a computed is the same advisory", () => {
  for (const [declaration, initializer] of [[straightLineBuilder, "build(text)"], [loopBuilder, "build(rows)"]] as const) {
    const reported = advisories(derivedList(declaration, initializer));
    assert.deepEqual(reported.map((item) => item.code), ["A4"]);
    const [message] = reported;
    // The opening is the assignment shape's word for word, because the defect
    // and its consequence are the same one; only when it happens and what to do
    // about it differ.
    assert.match(message!.message, /rebuilds every row of 'built' on every recompute/u);
    assert.match(message!.message, /every row is a new value/u);
    assert.match(message!.message, /no longer recognises any of them/u);
    assert.match(message!.message, /destroys and rebuilds all of its children/u);
    assert.match(message!.message, /an input being typed into loses focus/u);
    // A derived value has no row of its own to write, so the remedy names the
    // two that exist rather than an index write that would not compile.
    assert.match(message!.message, /render the source rows and change the field on them in place/u);
    assert.match(message!.message, /carry the source records through instead of constructing new ones/u);
    assert.doesNotMatch(message!.message, /built\[index\]/u);
  }
});

test("[co-3] a computed that maps straight to record literals is the same advisory", () => {
  const reported = advisories(derivedList("", `rows.map(row => { key: row.key, text: "x" })`));
  assert.deepEqual(reported.map((item) => item.code), ["A4"]);
  assert.match(reported[0]!.message, /rebuilds every row of 'built' on every recompute/u);
});

test("[co-3] the derived shape answers the same suppression machinery", () => {
  const source = derivedList(straightLineBuilder, "build(text)");
  const allowed = compile(source.replace(
    "computed built = build(text)",
    "computed built = build(text)  // velar-allow A4: the rows arrive from one API response",
  ));
  assert.deepEqual(allowed.diagnostics.map((item) => item.code), []);
  assert.deepEqual((allowed.advisories ?? []).map((item) => item.code), []);

  const bare = compile(source.replace(
    "computed built = build(text)",
    "computed built = build(text)  // velar-allow A4",
  ));
  assert.deepEqual(bare.diagnostics.map((item) => item.code), ["VEL1011"]);
});

test("[co-3] adjacent derived shapes that preserve identity stay silent", () => {
  // A builder that appends the rows it was handed carries the identity through:
  // that is the alternative the message teaches, so advising it would be
  // advising the fix. (`A7` names the copy loop, which is a different reading.)
  const reuse = advisories(derivedList(`
def build(source: List<Row>) -> List<Row>:
    const made: List<Row> = []
    for row in source:
        if row.text != "":
            made.append(row)
    return made
`, "build(rows)"));
  assert.deepEqual(reuse.filter((item) => item.code === "A4"), []);

  // A filter answers a shorter list of the same records.
  assert.deepEqual(advisories(derivedList("", `rows.filter(row => row.text != "")`)), []);
  // A map that answers its parameter builds nothing.
  assert.deepEqual(advisories(derivedList("", `rows.map(row => row)`)), []);

  // A builder whose records are constant answers the same content on every
  // call, so nothing it is derived from can move: there is no recompute to
  // advise, and proof-first means silence rather than a guess.
  assert.deepEqual(advisories(derivedList(`
def build() -> List<Row>:
    const made: List<Row> = []
    made.append({ key: "h", text: "Header" })
    return made
`, "build()")), []);

  // A `def` this module does not declare cannot be read through at all.
  assert.deepEqual(advisories(`
type Row:
    key: string
    text: string

state rows: List<Row> = [{ key: "a", text: "a" }]

component Row_(row: Row):
    return <span>{row.text}</span>

component App:
    computed built = rows.copy()

    return <ul>{built.map(row => <Row_ key={row.key} row={row} />)}</ul>
`), []);

  // And a derived value nothing renders by key is nobody's identity problem.
  assert.deepEqual(advisories(`
type Row:
    key: string
    text: string

state text = "a"
${straightLineBuilder}
component App:
    computed built = build(text)

    return <p>{built.size}</p>
`), []);
});

test("[co-3] a plain 'const' in a component body is constructed once and stays silent", () => {
  // The binding is built when the component is, not on every recompute, so its
  // records never move. Naming it would be a guess, and the ruling's discipline
  // is that an advisory fires only where the rebuild is proven.
  assert.deepEqual(advisories(`
type Row:
    key: string
    text: string

state text = "a"
${straightLineBuilder}
component App:
    const built = build(text)

    return <ul>{built.map(row => <li key={row.key}>{row.text}</li>)}</ul>
`), []);
});

// ---------------------------------------------------------------------------
// co-5 -- a named builder argument fills the slot its name declares
// ---------------------------------------------------------------------------

function look(text: string) {
  const imports = new Map<string, unknown>();
  const exports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const item of match[1]!.split(",")) {
      const name = item.trim();
      const type = exports?.get(name);
      if (type) imports.set(name, type);
    }
  }
  return compileCore(text.trimStart(), { analysis: { imports: imports as never }, extensions: [velarCompilerExtension] });
}

function builderRefusals(text: string): readonly string[] {
  return look(text).diagnostics.filter((item) => item.code === "VEL5042").map((item) => item.message);
}

test("[co-5] every builder with a numeric domain checks its named arguments", () => {
  // Positional spelling, named spelling: one range table, one message. Before
  // the fix the named column reported nothing at all.
  const pairs: readonly (readonly [string, string, string])[] = [
    ["rgb", "rgb(300, 0, 0)", "rgb(red=300, green=0, blue=0)"],
    ["rgba", "rgba(0, 0, 0, 2)", "rgba(red=0, green=0, blue=0, alpha=2)"],
    ["hsl", "hsl(0, 140, 50)", "hsl(hue=0, saturation=140, lightness=50)"],
    ["alpha", "alpha(rgb(0, 0, 0), 2)", "alpha(color=rgb(0, 0, 0), opacity=2)"],
    ["lighten", "lighten(rgb(0, 0, 0), 2)", "lighten(color=rgb(0, 0, 0), amount=2)"],
    ["darken", "darken(rgb(0, 0, 0), 2)", "darken(color=rgb(0, 0, 0), amount=2)"],
  ];
  for (const [builder, positional, named] of pairs) {
    const source = (call: string) => `
import {${builder}, rgb} from "velar/look"

const shade = ${call}
`;
    const expected = builderRefusals(source(positional));
    assert.equal(expected.length, 1, `${builder}: ${JSON.stringify(expected)}`);
    assert.deepEqual(builderRefusals(source(named)), expected, builder);
  }
});

test("[co-5] the slot comes from the signature, not from the written order", () => {
  const reported = builderRefusals(`
import {rgba} from "velar/look"

const shade = rgba(alpha=2, red=0, green=0, blue=0)
`);
  assert.deepEqual(reported, ["RGB alpha must be from 0 through 1; rgba received 2"]);
});

test("[co-5] a named argument inside its domain reports nothing", () => {
  assert.deepEqual(look(`
import {rgba} from "velar/look"

const shade = rgba(red=0, green=0, blue=0, alpha=0.5)
`).diagnostics.map((item) => `${item.code} ${item.message}`), []);
});

test("[co-5] the unitless-length, border-style and transition checks reach named arguments too", () => {
  assert.deepEqual(builderRefusals(`
import {minmax} from "velar/look"

const track = minmax(minimum=4, maximum=8px)
`), ["minmax composes CSS lengths, so 4 requires a unit; write a unit value such as 4px or 4rem (only 0 is unitless)"]);

  const border = builderRefusals(`
import {border, rgb} from "velar/look"

const edge = border(width=1px, color=rgb(0, 0, 0), style="dashd")
`);
  assert.equal(border.length, 1, JSON.stringify(border));
  assert.match(border[0]!, /Border style 'dashd' is not a CSS border style/u);

  const transition = look(`
import {transition} from "velar/look"

const move = transition(property="backgroundColor", duration=200ms)
`).diagnostics;
  assert.ok(transition.length > 0, "the transition property vocabulary answers the named spelling");
  assert.ok(transition.some((item) => item.message.includes("backgroundColor")), JSON.stringify(transition.map((item) => item.message)));
});

test("[co-5] the border builder's width slot is still the only length it checks", () => {
  // `border(width, color, style)`: only the first parameter is a length, and
  // resolving the name must not turn the colour or the style into one.
  assert.deepEqual(look(`
import {border, rgb} from "velar/look"

const edge = border(color=rgb(0, 0, 0), width=1px, style="solid")
`).diagnostics.map((item) => `${item.code} ${item.message}`), []);
});

test("[co-5] animate keeps the behaviour its own argument resolver already gave it", () => {
  const source = `
import {animate, keyframes} from "velar/look"

const spin = keyframes:
    from:
        opacity = 0
    to:
        opacity = 1

const motion = animate(spin, duration=0ms)
`;
  const reported = look(source).diagnostics.filter((item) => item.code === "VEL5060").map((item) => item.message);
  assert.deepEqual(reported, ["Animation duration must be greater than zero"]);
});
