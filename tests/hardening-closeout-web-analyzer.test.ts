import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import type { ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";

// Wave closeout, Web analyzer. Three items land here:
//
//   co-2  D90's R1-a revision: VEL5069 was defeated by extracting a helper,
//         while the runtime already classified the same watch as a writer.
//   co-3  D89's A4: the React immutable-update idiom against a keyed list,
//         raised on the advisory channel -- no diagnostic, no semantic change,
//         and `__velarKeyed`'s identity check untouched (D90 R2 stands).
//   co-5  Look builder checks read the position from the builder signature, so
//         a named argument no longer skips every check in the loop.

function compile(text: string, imports?: ReadonlyMap<string, ValueType>) {
  return compileCore(text.trimStart(), {
    extensions: [velarCompilerExtension],
    ...(imports ? { analysis: { imports } } : {}),
  });
}

function contentions(source: string): readonly string[] {
  return compile(source).diagnostics.filter((item) => item.code === "VEL5069").map((item) => item.message);
}

/** Every diagnostic of the compile, so a "stays legal" case cannot pass by being broken. */
function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

// ---------------------------------------------------------------------------
// co-2 -- VEL5069 follows the calls this module can resolve
// ---------------------------------------------------------------------------

test("[co-2] the direct spelling and the extracted spelling report the same pair", () => {
  const direct = contentions(`
state t = 0
state x = 1

watch t:
    x = x + 1

watch t:
    x = x * 10
`);
  const extracted = contentions(`
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

watch t:
    bump()

watch t:
    scale()
`);
  assert.equal(direct.length, 2);
  // The whole defect was that these two programs mean the same thing and were
  // answered differently, so the messages have to match, not merely the count.
  assert.deepEqual(extracted, direct);
});

test("[co-2] one direct write and one write through a helper contend", () => {
  assert.equal(contentions(`
state t = 0
state x = 1

def bump():
    x = x + 1

watch t:
    bump()

watch t:
    x = 2
`).length, 2);
});

test("[co-2] a helper declared after the watch that calls it is still followed", () => {
  // Module functions are hoisted for analysis, and the contention report waits
  // for the whole module, so declaration order changes nothing here.
  assert.equal(contentions(`
state t = 0
state x = 1

watch t:
    bump()

watch t:
    x = 2

def bump():
    x = x + 1
`).length, 2);
});

test("[co-2] a helper reached through another helper is followed transitively", () => {
  assert.equal(contentions(`
state t = 0
state x = 1

def outer():
    inner()

def inner():
    x = x + 1

watch t:
    outer()

watch t:
    x = 2
`).length, 2);
});

test("[co-2] recursion and mutual recursion terminate", () => {
  // A self-call and a cycle are the two shapes a naive walk never returns from.
  assert.deepEqual(messages(`
state t = 0
state x = 1

def loops():
    loops()

watch t:
    loops()

watch t:
    x = 2
`), []);
  assert.equal(contentions(`
state t = 0
state x = 1

def ping():
    pong()

def pong():
    x = x + 1
    ping()

watch t:
    ping()

watch t:
    x = 2
`).length, 2);
});

test("[co-2] one watch reaching one state through two helpers is one contender", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1

def first():
    x = 1

def second():
    x = 2

watch t:
    first()
    second()
`), []);
});

test("[co-2] a watch anchors on its own write, not on a later call", () => {
  const source = `
state t = 0
state x = 1

def bump():
    x = x + 1

watch t:
    x = 5
    bump()

watch t:
    x = 2
`;
  const spans = compile(source).diagnostics.filter((item) => item.code === "VEL5069").map((item) => item.span.start);
  assert.equal(spans.length, 2);
  for (const start of spans) assert.equal(source.trimStart().slice(start, start + 1), "x");
});

// ---------------------------------------------------------------------------
// co-2 -- the boundary. A false positive blocks a correct program, and this
// rule's whole value is that it is never wrong.
// ---------------------------------------------------------------------------

test("[co-2] helpers writing different states never contend", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1
state y = 1

def first():
    x = 1

def second():
    y = 2

watch t:
    first()

watch t:
    second()
`), []);
});

test("[co-2] a helper whose own binding shadows the state carries no write", () => {
  // The write is resolved in the helper's own lexical scope, which is what lets
  // a local of the same name take the write with it.
  assert.deepEqual(messages(`
state t = 0
state x = 1

def scoped(seed: number):
    let x = seed
    x = x + 1

watch t:
    scoped(5)

watch t:
    x = 2
`), []);
});

test("[co-2] an imported helper is never followed", () => {
  const imports = new Map<string, ValueType>([
    ["bump", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]);
  const result = compile(`
import { bump } from "./helpers"

state t = 0
state x = 1

watch t:
    bump()

watch t:
    x = 2
`, imports);
  assert.deepEqual(result.diagnostics.map((item) => item.code), []);
});

test("[co-2] a write through 'any' stays conservatively silent", () => {
  const result = compile(`
import { bump } from "./helpers"

state t = 0
state x = 1

watch t:
    bump()

watch t:
    x = 2
`, new Map<string, ValueType>([["bump", { kind: "any" }]]));
  assert.deepEqual(result.diagnostics.map((item) => item.code), []);
});

test("[co-2] a call through a value is dynamic dispatch and stays silent", () => {
  // codex-review cr-3 overturned the `const chosen = bump` half of this case.
  // A `const` bound to a bare name this module declares is that declaration
  // under a second name: nothing about it is undecided, and calling it silent
  // let `const chosenBump = bump` defeat the rule outright. What stays silent is
  // dispatch this module really cannot decide -- a parameter holding a callable,
  // a binding that may be reassigned -- alongside the member call and the value
  // typed `any` the cases below and above already cover. The alias half now
  // lives in tests/hardening-wave-r1a.test.ts under `[cr-3]`.
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

def run(action: () -> null):
    action()

watch t:
    run(bump)

watch t:
    x = 2
`), []);
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

let chosen = bump
chosen = scale

watch t:
    chosen()

watch t:
    x = 2
`), []);
});

test("[co-2] a method call on a value is not a module call", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1

class Box:
    def run():
        x = 1

const box = Box()

watch t:
    box.run()

watch t:
    x = 2
`), []);
});

test("[co-2] the write shape is not widened by the revision", () => {
  // A member write and a mutating method stay out of reach, through a helper
  // exactly as they are directly: their paths run through dynamic indices and
  // aliases this analysis cannot decide.
  assert.deepEqual(messages(`
state t = 0
state user = { name: "a" }
state items = [1, 2]

def rename():
    user.name = "b"

def append():
    items.append(4)

watch t:
    rename()
    append()

watch t:
    rename()
`), []);
});

test("[co-2] a component watch reaches a module helper, and two components still do not contend", () => {
  assert.equal(contentions(`
state x = 1

def bump():
    x = x + 1

component App:
    state t = 0

    watch t:
        bump()

    watch t:
        x = 2

    return <p>{x}</p>
`).length, 2);
  assert.deepEqual(messages(`
state x = 1

def bump():
    x = x + 1

component A:
    state t = 0
    watch t:
        bump()
    return <p>a</p>

component B:
    state u = 0
    watch u:
        x = 2
    return <p>b</p>
`), []);
});

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
