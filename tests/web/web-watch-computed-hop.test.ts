import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

// D114 P6 item 6 (0.29.0 Web ledger ST-U2): VEL5077 walks one hop through a
// same-module `computed`.
//
// `watch doubled:` whose body writes `count`, where `doubled` is
// `computed doubled = count * 2`, is a ring: the write invalidates `doubled`,
// which re-triggers the watch, which writes again. The charter's exclusion — "a
// write of a *different* state leaves the watch untouched" — read it as
// untouched, and it is not; the only thing that stopped it was the per-task
// observer budget, after 50,000 rounds, with nothing to point the author at.
//
// The hop is exactly one and every part of it is proved rather than assumed.
// Three shapes stay with the runtime budget, and each is here so the boundary
// is a test rather than a sentence: a source reached through a second computed
// (two hops), a source read only inside a branch (conditional), and a source
// this module cannot read the derivation of (cross-module).

function messages(source: string, imports = new Map<string, ValueType>()): readonly string[] {
  return compileCore(source, { analysis: { imports }, extensions: [velarCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[ST-U2] a watch on a computed that writes the computed's own source is refused", () => {
  assert.deepEqual(messages(`state count = 0
computed doubled = count * 2

watch doubled:
    count = count + 1

export component App():
    return <p>{str(doubled)}</p>
`), [
    "VEL5077 This watch writes 'count' at the top of its body, and 'doubled' is computed from 'count',"
    + " so writing 'count' re-triggers this watch and the runtime stops the task when it runs out of observer budget;"
    + " write the condition that ends it, or watch 'count' and derive what this body needs from it",
  ]);
});

test("[ST-U2] a compound assignment to the source is the same write", () => {
  assert.deepEqual(messages(`state count = 0
computed doubled = count * 2

watch doubled:
    count += 1

export component App():
    return <p>{str(doubled)}</p>
`).map((item) => item.slice(0, 41)), ["VEL5077 This watch writes 'count' at the "]);
});

test("[ST-U2] two hops keep the runtime budget", () => {
  assert.deepEqual(messages(`state count = 0
computed doubled = count * 2
computed quadrupled = doubled * 2

watch quadrupled:
    count = count + 1

export component App():
    return <p>{str(quadrupled)}</p>
`), []);
});

test("[ST-U2] a source read only inside a branch keeps the runtime budget", () => {
  assert.deepEqual(messages(`state count = 0
state live = false
computed doubled = live ? count * 2 : 0

watch doubled:
    count = count + 1

export component App():
    return <p>{str(doubled)}</p>
`), []);
  assert.deepEqual(messages(`state count = 0
state live = false
computed doubled = live and count > 2

watch doubled:
    count = count + 1

export component App():
    return <p>{str(doubled)}</p>
`), []);
});

test("[ST-U2] a cross-module source keeps the runtime budget", () => {
  // The computed is this module's; its source is not, so this module cannot
  // read what `remote` is derived from and does not guess.
  assert.deepEqual(messages(`import {remote} from "./other.vel"

state count = 0
computed doubled = remote * 2

watch doubled:
    count = count + 1

export component App():
    return <p>{str(doubled)}</p>
`, new Map<string, ValueType>([["remote", { kind: "number" }]])), []);
});

test("[ST-U2] writing a different state, and writing a plain binding, stay legal", () => {
  assert.deepEqual(messages(`state count = 0
state other = 0
computed doubled = count * 2

watch doubled:
    other = other + 1

export component App():
    return <p>{str(doubled)}{str(other)}</p>
`), []);
  assert.deepEqual(messages(`state count = 0
let seen = 0
computed doubled = count * 2

watch doubled:
    seen = seen + 1

export component App():
    return <p>{str(doubled)}</p>
`), []);
});

test("[ST-U2] a name is not a binding: a shadow of either kind keeps the runtime budget", () => {
  // An ordinary `let` of the same spelling in front of the watch: the write is
  // not a write of reactive state at all, which the lexical resolution answers.
  assert.deepEqual(messages(`state count = 0
computed doubled = count * 2

component App():
    let count = 0
    watch doubled:
        count = count + 1
    return <p>{str(doubled) + str(count)}</p>
`), []);
  // A component `state` of the same spelling: the write really is a write of
  // reactive state, but not of the one `doubled` was computed from, and the
  // module-wide roster cannot tell the two apart — so nothing is reported.
  assert.deepEqual(messages(`state count = 0
computed doubled = count * 2

component App():
    state count = 0
    watch doubled:
        count = count + 1
    return <p>{str(doubled) + str(count)}</p>
`), []);
});

test("[ST-U2] a conditional write inside the body is still the runtime's, as the charter says", () => {
  assert.deepEqual(messages(`state count = 0
computed doubled = count * 2

watch doubled:
    if count < 3:
        count = count + 1

export component App():
    return <p>{str(doubled)}</p>
`), []);
});

test("[ST-U2] the existing self-write refusal is unchanged", () => {
  assert.deepEqual(messages(`state count = 0

watch count:
    count = count + 1

export component App():
    return <p>{str(count)}</p>
`).map((item) => item.slice(0, 47)), ["VEL5077 This watch writes its own subject 'coun"]);
});
