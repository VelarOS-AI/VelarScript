import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

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
