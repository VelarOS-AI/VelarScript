import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 0.29.0 ST-D1 and ST-D2 / ST-U1: the two watch subjects the compile could
// have proved and did not.
//
// ST-D1: `watch profile:` on a `resource` compiled clean and its body never ran
// once. A resource publishes `value`, `loading`, `ready` and `error`; the handle
// carrying them is built once and never replaced, so the subject cannot change.
// VEL5064's own sentence already named the answer — "watch a 'state', a
// 'computed', a prop, or a resource field" — and only its criterion was missing
// this shape.
//
// ST-D2: a self-write in the `finally` of a `try` at the watch body's top level
// was silent too, and the runtime stopped it after 100 rounds. `finally` is the
// one nested block no path through the body can get out of, so the write is
// proved exactly the way a top-level write is. The neighbours are the point of
// the line: a `for` body may run zero times, a `try` body may be cut short by a
// throw, a `match` arm is chosen by data, and a `try` inside an `if` is
// conditional again — all four stay the runtime cap's (ST-U1), and all four are
// asserted here so the boundary cannot drift.

function diagnostics(source: string): readonly string[] {
  return compileCore(source, { extensions: [velarCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

function codes(source: string): readonly string[] {
  return compileCore(source, { extensions: [velarCompilerExtension] }).diagnostics.map((item) => item.code);
}

const RESOURCE = `
type User:
    name: string

async def loadUser(id: string) -> User:
    return {name: id}
`.trimStart();

const withResourceWatch = (subject: string, body: string): string => `${RESOURCE}
export component P(userId: string):
    resource profile: User = loadUser(userId)

    watch ${subject}:
        ${body}

    return <p>{profile.value?.name ?? ""}</p>
`;

test("[ST-D1] a watch on the resource surface earns exactly one VEL5064", () => {
  const reports = diagnostics(withResourceWatch("profile", "detach profile.reload()"));
  assert.deepEqual(reports, [
    "VEL5064 This watch subject never changes, so its body can never run — 'profile' is the resource itself rather"
    + " than one of the fields it publishes; watch a 'state', a 'computed', a prop, or a resource field, or move these"
    + " statements to where they should run: 'watch profile.value:' for the loaded value, 'watch profile.loading:' for"
    + " the load's progress, or the input the load reads",
  ]);
});

test("[ST-D1] watching a resource field keeps the behaviour it always had", () => {
  // `profile.loading` is one of the four published fields and is a legal subject.
  assert.deepEqual(codes(withResourceWatch("profile.loading", 'print("loading changed")')), []);
  // `profile.value` with a reload in the body is the VEL5078 case, unchanged: the
  // subject is fine and the *body* is the ring.
  assert.deepEqual(codes(withResourceWatch("profile.value", "detach profile.reload()")), ["VEL5078"]);
});

test("[ST-D1] a state that shadows a resource's name is not the resource", () => {
  assert.deepEqual(codes(`${RESOURCE}
export component P(userId: string):
    resource loaded: User = loadUser(userId)

    def inner() -> WebNode:
        return <p>{loaded.value?.name ?? ""}</p>

    return inner()
`), []);
});

const SELF_WRITE = (body: string): string => `state count = 0

watch count:
${body}
`;

test("[ST-D2] a self-write in a top-level finally is refused, and says why", () => {
  const reports = diagnostics(SELF_WRITE(`    try:
        print("x")
    finally:
        count = count + 1`));
  assert.deepEqual(reports, [
    "VEL5077 This watch writes its own subject 'count' in the 'finally' of a 'try' at the top of its body, which every"
    + " path through the body runs, so every run re-triggers it and the runtime stops the loop after 100 rounds; write"
    + " the condition that ends it, or watch the input this value follows and declare 'computed count = ...' instead",
  ]);
});

test("[ST-U1] a for body, a try body and a match arm stay the runtime cap's", () => {
  // A `for` body may run zero times.
  assert.deepEqual(codes(SELF_WRITE(`    for n in [1, 2]:
        count = count + n`)), []);
  // A `try` body may be cut short by a throw before it reaches the write.
  assert.deepEqual(codes(SELF_WRITE(`    try:
        count = count + 1
    catch e:
        print("x")`)), []);
  // A `match` arm is chosen by data.
  assert.deepEqual(codes(`enum Mode:
    One
    Two

state count = 0
state mode: Mode = Mode.One

watch count:
    match mode:
        case Mode.One:
            count = count + 1
        case Mode.Two:
            count = count + 2
`), []);
});

test("[ST-D2] a finally nested inside a conditional is conditional again", () => {
  assert.deepEqual(codes(`state count = 0
state ready = false

watch count:
    if ready:
        try:
            print("x")
        finally:
            count = count + 1
`), []);
});

test("[ST-D2] a top-level write still earns the sentence it always had", () => {
  const reports = diagnostics(SELF_WRITE("    count = count + 1"));
  assert.deepEqual(reports, [
    "VEL5077 This watch writes its own subject 'count' at the top of its body, so every run re-triggers it and the"
    + " runtime stops the loop after 100 rounds; write the condition that ends it, or watch the input this value"
    + " follows and declare 'computed count = ...' instead",
  ]);
});

test("[ST-D2] a finally that writes a different state is untouched", () => {
  assert.deepEqual(codes(`state count = 0
state other = 0

watch count:
    try:
        print("x")
    finally:
        other = other + 1
`), []);
});

test("[ST-D2] a finally that rebinds the subject's name stops the scan", () => {
  assert.deepEqual(codes(`state count = 0

watch count:
    try:
        print("x")
    finally:
        const count = 5
        print(str(count))
`), []);
});
