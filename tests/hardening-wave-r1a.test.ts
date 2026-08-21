import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import type { ValueType } from "../packages/compiler/src/types.ts";

// Wave r1a: D90 R1-a. R1 made a flush settle every watch in a single pass and
// promised that a watch's declaration order is not observable; the verification
// found the promise held on the write-observe axis only. Two watches that both
// assign one state still ran in declaration order, and no scheduling rule can
// fix that -- between two independent writes there is no correct order to pick.
// The owner ruled the shape a compile error, on the reasoning R3(c) already
// applies to two independent Looks setting one property (VEL5068).
//
// The false-positive rate is what decides whether this rule is worth having, so
// the "stays legal" half below is the hard requirement, not the courtesy half.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

function contentions(source: string): readonly string[] {
  return compile(source).diagnostics
    .filter((item) => item.code === "VEL5069")
    .map((item) => item.message);
}

/** Every diagnostic of the compile, so a "stays legal" case cannot pass by being broken. */
function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The same, for the one boundary case that needs a resolved cross-module import. */
function importingMessages(source: string, imports: ReadonlyMap<string, ValueType>): readonly string[] {
  return compileCore(source.trimStart(), { extensions: [velarCompilerExtension], analysis: { imports } })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

const voidFunction: ValueType = { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } };

// ---------------------------------------------------------------------------
// The shape the ruling names
// ---------------------------------------------------------------------------

test("[R1-a] two watches that assign one state are refused, each on its own write", () => {
  // The ruling's program, in the block spelling module-scope `watch` accepts.
  const source = `
state t = 0
state x = 1

watch t:
    x = x + 1

watch t:
    x = x * 10
`;
  const reported = contentions(source);
  assert.equal(reported.length, 2, JSON.stringify(messages(source)));
  for (const message of reported) {
    assert.match(message, /State 'x' is assigned by 2 watch blocks in this scope/u);
    assert.match(message, /which write lands last is undefined/u);
    assert.match(message, /put every update to 'x' in one watch, or give each watch a state of its own/u);
  }

  // One error per contender, anchored on that watch's own first write: the two
  // watches have no meeting point the way VEL5068's two Looks meet at one
  // `look=` attribute, so each watch's position is named by the error on it.
  const spans = compile(source).diagnostics.filter((item) => item.code === "VEL5069").map((item) => item.span.start);
  assert.equal(new Set(spans).size, 2, JSON.stringify(spans));
  for (const start of spans) assert.equal(source.trimStart().slice(start, start + 1), "x");
});

test("[R1-a] a conditional write is still a write", () => {
  assert.equal(contentions(`
state a = 0
state b = 0
state c = true
state x = 1

watch a:
    if c:
        x = 1

watch b:
    x = 2
`).length, 2);
});

test("[R1-a] three contenders produce three errors, not a pair", () => {
  assert.equal(contentions(`
state t = 0
state x = 1

watch t:
    x = 1

watch t:
    x = 2

watch t:
    x = 3
`).length, 3);
});

test("[R1-a] a compound assignment contends exactly as a plain one does", () => {
  assert.equal(contentions(`
state t = 0
state x = 1

watch t:
    x += 1

watch t:
    x = 2
`).length, 2);
  assert.equal(contentions(`
state t = 0
state x = 1

watch t:
    x += 1

watch t:
    x *= 10
`).length, 2);
});

test("[R1-a] a component's own watches contend over the component's own state", () => {
  const reported = contentions(`
component App:
    state t = 0
    state x = 1

    watch t:
        x = x + 1

    watch t:
        x = x * 10

    return <p>{x}</p>
`);
  assert.equal(reported.length, 2, JSON.stringify(reported));
  assert.match(reported[0]!, /State 'x' is assigned by 2 watch blocks/u);
});

// ---------------------------------------------------------------------------
// What must stay legal. A false positive blocks a correct program from
// building, and this rule's whole value is that it is never wrong.
// ---------------------------------------------------------------------------

test("[R1-a] a watch that owns its state is untouched while others read it", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1

watch t:
    x = x + 1

watch x:
    print(f"{x}")
`), []);
});

test("[R1-a] one watch writing its state many times is one contender", () => {
  assert.deepEqual(messages(`
state t = 0
state c = true
state x = 1

watch t:
    x = 1
    if c:
        x = 2
    let i = 0
    while i < 3:
        x = x + i
        i = i + 1
`), []);
});

test("[R1-a] an action and a handler are not watches and never contend", () => {
  assert.deepEqual(messages(`
component App:
    state t = 0
    state x = 1

    action bump():
        x = x + 1

    def reset():
        x = 0

    watch t:
        x = x * 2

    return <button on:click={reset}>{x}</button>
`), []);
});

// The two tests below asserted the opposite until D90's R1-a revision. The
// original boundary ("a call is never followed") was written to hold the false
// positive rate at zero, but it was not a guess the analyzer had to make: the
// runtime already promotes a watch that writes through a helper to a writer, so
// the compile was asking a weaker question about the same program. Extracting a
// helper defeated the rule outright. The revision follows the calls this module
// can resolve; the cases below that stay legal are the boundary that remains.
test("[R1-a revision] a write reached through a called function is the calling watch's write", () => {
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

test("[R1-a revision] a function declared inside a watch body contends only once the watch calls it", () => {
  // Declaring it is not running it: the body runs when it is called, so a `def`
  // nobody calls carries its writes and hands them to nobody.
  assert.deepEqual(messages(`
state t = 0
state x = 1

watch t:
    def bump():
        x = x + 1

watch t:
    x = 2
`), []);
  assert.equal(contentions(`
state t = 0
state x = 1

watch t:
    def bump():
        x = x + 1
    bump()

watch t:
    x = 2
`).length, 2);
});

test("[R1-a] a local that shadows the state takes the write with it", () => {
  assert.deepEqual(messages(`
state t = 0
state u = 0
state c = true
state x = 1

watch t:
    if c:
        let x = 1
        x = 2

watch u:
    x = 5
`), []);
});

test("[R1-a] watches in two different components do not contend", () => {
  assert.deepEqual(messages(`
state x = 1

component A:
    state t = 0
    watch t:
        x = 1
    return <p>a</p>

component B:
    state u = 0
    watch u:
        x = 2
    return <p>b</p>
`), []);
});

test("[R1-a] two watches writing different states stay legal, cycle included", () => {
  // The mutual-cycle shape of tests/hardening-reactivity.test.ts's
  // `overflowApplication`: each watch writes the state the other watches.
  assert.deepEqual(messages(`
state stormA = 0
state stormB = 0

watch stormA:
    stormB = stormB + 1

watch stormB:
    stormA = stormA + 1
`), []);
});

test("[R1-a] two watches appending to a plain module 'let' are out of reach", () => {
  // The `watchLog` of tests/hardening-reactivity.test.ts's
  // `settlingApplication` (its declaration is `let watchLog = ""`). Only a
  // writable reactive `state` settles in a flush, so only a `state` can be
  // contended for -- widening this rule to ordinary bindings would redden R1's
  // own fixture.
  assert.deepEqual(messages(`
state t = 0
state u = 0
let watchLog = ""

watch t:
    watchLog = watchLog + "t"

watch u:
    watchLog = watchLog + "u"
`), []);
});

test("[R1-a] '@mounted' and '@cleanup' do not settle in the flush and never contend", () => {
  assert.deepEqual(messages(`
component App:
    state t = 0
    state x = 1

    @mounted:
        x = 1

    @cleanup:
        x = 2

    watch t:
        x = 3

    return <p>{x}</p>
`), []);
});

test("[R1-a] only a bare-identifier target is recorded", () => {
  // Two member writes collide only when their paths are the same, and a path
  // runs through dynamic indices and aliases this analysis cannot decide, so
  // the rule stops at the shape the ruling names.
  assert.deepEqual(messages(`
state t = 0
state user = { name: "a" }
state items = [1, 2]

watch t:
    user.name = "b"
    items[0] = 3

watch t:
    user.name = "c"
    items.append(4)
`), []);
});

// ---------------------------------------------------------------------------
// codex-review cr-3: the alias spelling of the same call.
//
// The revision above followed the call and left the alias of the call open, so
// `const chosenBump = bump` then `chosenBump()` reported nothing and the order
// dependence R1-a exists to end came back whole. A `const` bound to a bare name
// this module declares is that declaration under a second name -- it is not
// dynamic dispatch, and nothing about it is undecided. The boundary the ruling
// draws is unchanged: an import, a parameter, a reassignable binding, a member
// path, and a JavaScript value typed `any` are all still let through, and the
// battery below is that half.
// ---------------------------------------------------------------------------

test("[cr-3] a const alias of a helper is the helper, and reports the direct spelling's pair", () => {
  const direct = `
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
`;
  const aliased = `
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

const chosenBump = bump
const chosenScale = scale

watch t:
    chosenBump()

watch t:
    chosenScale()
`;
  assert.equal(contentions(direct).length, 2, JSON.stringify(messages(direct)));
  assert.deepEqual(contentions(aliased), contentions(direct));
  // The alias call is still the anchor, so each watch is named by the error on
  // its own line exactly as a direct write is.
  const spans = compile(aliased).diagnostics.filter((item) => item.code === "VEL5069").map((item) => item.span.start);
  assert.equal(new Set(spans).size, 2, JSON.stringify(spans));
  for (const start of spans) assert.match(aliased.trimStart().slice(start, start + 11), /^chosen(Bump|Scal)/u);
});

test("[cr-3] swapping the two aliased watches changes nothing", () => {
  // The whole point of R1-a: the result may not depend on which watch is written
  // first. Before this fix both orders were silent and the emitted value moved.
  assert.equal(contentions(`
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

const chosenBump = bump
const chosenScale = scale

watch t:
    chosenScale()

watch t:
    chosenBump()
`).length, 2);
});

test("[cr-3] an alias chain is followed to the declaration at its end", () => {
  assert.equal(contentions(`
state t = 0
state x = 1

def bump():
    x = x + 1

const first = bump
const second = first
const third = second

watch t:
    third()

watch t:
    x = 2
`).length, 2);
});

test("[cr-3] an alias called inside a helper is followed as well as one called in the watch", () => {
  // Both callers of the call-graph recorder read through the same map: the
  // watch->callee edge and the def->def edge resolve at the same place.
  assert.equal(contentions(`
state t = 0
state x = 1

def bump():
    x = x + 1

const chosen = bump

def outer():
    chosen()

watch t:
    outer()

watch t:
    x = 2
`).length, 2);
});

test("[cr-3] an alias of a recursive helper terminates", () => {
  // A cycle of aliases is not constructible -- VEL3017 refuses `const a = a` --
  // so recursion through the aliased declaration is the shape that has to
  // terminate, and the visited set is what makes it.
  assert.equal(contentions(`
state t = 0
state x = 1

def bump():
    x = x + 1
    bump()

const first = bump
const second = first

watch t:
    second()

watch t:
    x = 2
`).length, 2);
});

test("[cr-3] one watch calling one helper under two aliases is one contender", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

const first = bump
const second = bump

watch t:
    first()
    second()
`), []);
});

test("[cr-3] a component's own aliases contend inside the component", () => {
  assert.equal(contentions(`
component App:
    state t = 0
    state x = 1

    def bump():
        x = x + 1

    def scale():
        x = x * 10

    const chosenBump = bump
    const chosenScale = scale

    watch t:
        chosenBump()

    watch t:
        chosenScale()

    return <p>{x}</p>
`).length, 2);
});

// The boundary. Every case below is a correct program, and a diagnostic on any
// of them is a false positive -- which is the one failure this rule cannot
// afford, because it blocks a build.

test("[cr-3] an alias bound to a parameter holding a callable stays silent", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

def run(action: () -> null):
    const chosen = action
    chosen()

watch t:
    run(bump)

watch t:
    x = 2
`), []);
});

test("[cr-3] an alias bound to an imported function stays silent", () => {
  // The write is in another module. R1-a's revision says a cross-module write is
  // let through, and an alias does not make it visible.
  assert.deepEqual(importingMessages(`
import { bump } from "./helpers"

state t = 0
state x = 1

const chosen = bump

watch t:
    chosen()

watch t:
    x = 2
`, new Map([["bump", voidFunction]])), []);
});

test("[cr-3] a 'let' alias that is reassigned stays silent", () => {
  // A reassignable binding is not statically determined: which declaration it
  // names depends on what ran, so no `let` is followed at all.
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

test("[cr-3] an alias whose initializer is not a bare name stays silent", () => {
  const conditional = `
state t = 0
state c = true
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

const chosen = c ? bump : scale

watch t:
    chosen()

watch t:
    x = 2
`;
  const member = `
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

const table = { bump: bump, scale: scale }
const chosen = table.bump

watch t:
    chosen()

watch t:
    table.scale()
`;
  const destructured = `
state t = 0
state x = 1

def bump():
    x = x + 1

const table = { bump: bump }
const { bump: chosen } = table

watch t:
    chosen()

watch t:
    x = 2
`;
  assert.deepEqual(messages(conditional), []);
  assert.deepEqual(messages(member), []);
  assert.deepEqual(messages(destructured), []);
});

test("[cr-3] a call on a member path is still not a call of this module", () => {
  assert.deepEqual(messages(`
state t = 0
state x = 1

def bump():
    x = x + 1

def scale():
    x = x * 10

const table = { bump: bump, scale: scale }

watch t:
    table.bump()

watch t:
    table.scale()
`), []);
});

test("[cr-3] an alias of a JavaScript value typed 'any' stays silent", () => {
  assert.deepEqual(messages(`
import js unsafe { bump } from "helpers"

state t = 0
state x = 1

const chosen = bump

watch t:
    chosen()

watch t:
    x = 2
`), []);
});

test("[cr-3] the alias widens the reach of the rule, never its write shape", () => {
  // A member write is not a contender directly, and reaching one through an
  // alias does not make it one.
  assert.deepEqual(messages(`
state t = 0
state user = { name: "a" }

def rename():
    user.name = "b"

def relabel():
    user.name = "c"

const first = rename
const second = relabel

watch t:
    first()

watch t:
    second()
`), []);
  // A plain module `let` is out of reach whichever way it is written to.
  assert.deepEqual(messages(`
state t = 0
state u = 0
let watchLog = ""

def logT():
    watchLog = watchLog + "t"

def logU():
    watchLog = watchLog + "u"

const first = logT
const second = logU

watch t:
    first()

watch u:
    second()
`), []);
});
