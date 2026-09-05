import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 W B: a watch whose body writes its own subject, at the top level and
// with no condition, is a compile error.
//
// It is the one shape in this family that needs no analysis to see: the watch
// runs because the subject changed, the first thing it does is change the
// subject, and the runtime answers by stopping it after 100 self-invalidations.
// The owner's ruling names it "a provable dead loop" and puts it where a
// provable bug belongs -- at compile time, as an error, not as an advisory,
// because it is not a spelling that means something else.
//
// The boundary is as important as the rule. D90 R21 revoked the compile-time
// analysis of who writes what, and nothing here restores it: a write under
// `if`, `match`, a loop, `try`, a nested `def` or an arrow may converge and is
// the author's own correction to make; a write to a different state is two
// watches taking effect in source order, which R21 ruled is an ordinary
// program; and a write reached through an ordinary helper is out of reach on
// purpose. Only the top-level, unconditional write of the watched place itself.

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

/** Every diagnostic of the compile, `CODE message`, so a "stays legal" case cannot pass by being broken. */
function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The refusal, spelled once, so every case reads the message the author gets. */
function selfWrite(path: string, remedy: string): string {
  return `VEL5077 This watch writes its own subject '${path}' at the top of its body, so every run re-triggers it and`
    + ` the runtime stops the loop after 100 rounds; write the condition that ends it, or watch the input this value`
    + ` follows and ${remedy}`;
}

/**
 * The same refusal for a write below the subject. Only the opening clause
 * differs — it has two places to name rather than one — so the tail is shared
 * with `selfWrite` in the source exactly as it is in the analyzer.
 */
function partSelfWrite(written: string, subject: string, remedy: string): string {
  return `VEL5077 This watch writes '${written}', a part of its subject '${subject}', at the top of its body, so`
    + ` every run re-triggers it and the runtime stops the loop after 100 rounds; write the condition that ends it,`
    + ` or watch the input this value follows and ${remedy}`;
}

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

test("[W-B] a watch that assigns its own subject is refused", () => {
  assert.deepEqual(messages(`
state count = 0

watch count:
    count = count + 1
`), [selfWrite("count", "declare 'computed count = ...' instead")]);
});

test("[W-B] a compound assignment is the same write", () => {
  // `+=` is the spelling the loop is usually written in, and it reaches the
  // same cell through the same publication path.
  assert.deepEqual(messages(`
state count = 0

watch count:
    count += 1
`), [selfWrite("count", "declare 'computed count = ...' instead")]);
});

test("[W-B] a member path subject is refused where it is written", () => {
  // `form.name` is a place, and the watch is on that place. The remedy differs:
  // a field has no `computed` declaration of its own, so offering one would
  // hand the author a line that does not compile.
  assert.deepEqual(messages(`
state form = {name: ""}

watch form.name:
    form.name = form.name + "!"
`), [selfWrite("form.name", "write this value where it is produced instead")]);
});

test("[W-B] an index path subject is refused where it is written", () => {
  assert.deepEqual(messages(`
state rows: List<number> = [1, 2]

watch rows[0]:
    rows[0] = rows[0] + 1
`), [selfWrite("rows[0]", "write this value where it is produced instead")]);
});

test("[W-B] a mutating collection call on the watched collection is a write of it", () => {
  // A watch on a collection fires on its deep mutation, so `append` re-triggers
  // it exactly as an assignment does. The roster is the compiler's own -- the
  // one `readonly` refuses through a read-only view -- rather than a second
  // list written for this rule.
  assert.deepEqual(messages(`
state log: List<string> = []

watch log:
    log.append("a")
`), [selfWrite("log", "declare 'computed log = ...' instead")]);
  assert.deepEqual(messages(`
state log: List<string> = []

watch log:
    log.clear()
`), [selfWrite("log", "declare 'computed log = ...' instead")]);
  assert.deepEqual(messages(`
state seen: Set<string> = Set()

watch seen:
    seen.add("a")
`), [selfWrite("seen", "declare 'computed seen = ...' instead")]);
  assert.deepEqual(messages(`
state totals: Map<string, number> = Map()

watch totals:
    totals.set("a", 1)
`), [selfWrite("totals", "declare 'computed totals = ...' instead")]);
});

test("[W-B] a non-mutating call on the watched collection is not a write", () => {
  // The same roster read the other way: `copy` and `has` answer a fresh value
  // and change nothing, so the watch that calls one is an ordinary observer.
  assert.deepEqual(messages(`
state log: List<string> = []

watch log:
    print(str(log.copy().size))
`), []);
});

// ---------------------------------------------------------------------------
// D114 0.28.0 H-D1: the same ring, written one level down
// ---------------------------------------------------------------------------
//
// A watch fires on a deep change of its subject -- section 15 says so, and the
// runtime proves it by stopping `watch form: form.name = ...` after 100 rounds.
// Until this item the compile saw only the three spellings that name the subject
// exactly, so the shape that loops most naturally in an application (edit a
// field of the record you are watching) compiled clean and was answered by the
// runtime cap instead. The rule is stated on the path: the subject, or any
// place below it.

test("[W-D1] a field of the watched record is a write of the subject", () => {
  assert.deepEqual(messages(`
state form = {name: ""}

watch form:
    form.name = "typed"
`), [partSelfWrite("form.name", "form", "declare 'computed form = ...' instead")]);
});

test("[W-D1] an element's field under the watched list is a write of the subject", () => {
  assert.deepEqual(messages(`
type Row:
    done: bool

state items: List<Row> = [{done: false}]

watch items:
    items[0].done = true
`), [partSelfWrite("items[0].done", "items", "declare 'computed items = ...' instead")]);
});

test("[W-D1] a compound assignment below the subject is the same write", () => {
  assert.deepEqual(messages(`
state totals = {count: 0}

watch totals:
    totals.count += 1
`), [partSelfWrite("totals.count", "totals", "declare 'computed totals = ...' instead")]);
});

test("[W-D1] a mutating collection call on a place inside the subject is a write of it", () => {
  // The roster is read at the place the call lands on, not at the subject: the
  // subject here is a record and has no mutating calls of its own, while
  // `form.tags` is a List and `append` is on the compiler's own list.
  assert.deepEqual(messages(`
state form = {tags: ["a"]}

watch form:
    form.tags.append("b")
`), [partSelfWrite("form.tags", "form", "declare 'computed form = ...' instead")]);
  // And the same roster read the other way, one level down.
  assert.deepEqual(messages(`
state form = {tags: ["a"]}

watch form:
    print(str(form.tags.copy().size))
`), []);
});

test("[W-D1] a sibling of the watched place is not the watched place", () => {
  // `watch form.name:` is a watch on one field. Writing another field of the
  // same record is a write of a different place, and R21's ruling that two
  // watches writing one record are an ordinary program covers it.
  assert.deepEqual(messages(`
state form = {name: "", email: ""}

watch form.name:
    form.email = "a@example.com"
`), []);
  assert.deepEqual(messages(`
type Row:
    done: bool

state items: List<Row> = [{done: false}, {done: false}]

watch items[0]:
    items[1].done = true
`), []);
});

test("[W-D1] a deep write of a different root is untouched", () => {
  assert.deepEqual(messages(`
state form = {name: ""}
state draft = {name: ""}

watch form:
    draft.name = form.name
`), []);
  // A name that merely starts with the subject's is a different binding, and
  // the comparison is by path step rather than by text prefix.
  assert.deepEqual(messages(`
state form = {name: ""}
state formDraft = {name: ""}

watch form:
    formDraft.name = "a"
`), []);
});

test("[W-D1] a deep write that leaves what the compile can prove stays silent", () => {
  // The walk follows record fields and collection elements, because those are
  // the writes a watch on the containing value is woken by. A class instance is
  // not one of them, so the refusal does not guess at it.
  assert.deepEqual(messages(`
class Cursor:
    let position: number = 0

state cursor = Cursor()

watch cursor:
    cursor.position = 1
`), []);
});

test("[W-D1] the deep write is refused only at the top level, unconditionally", () => {
  assert.deepEqual(messages(`
state form = {name: ""}

watch form:
    if form.name == "":
        form.name = "unnamed"
`), []);
  assert.deepEqual(messages(`
state form = {name: ""}

watch form:
    def rename():
        form.name = "unnamed"
    print(form.name)
`), []);
  assert.deepEqual(messages(`
state form = {name: ""}

watch form:
    let form = {name: "other"}
    form.name = "unnamed"
    print(form.name)
`), []);
});

test("[W-D1] a deep write is an error and blocks emission, like the direct one", () => {
  const result = compile(`
state form = {name: ""}

watch form:
    form.name = "typed"
`);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5077"]);
  assert.equal(result.code, null);
});

test("[W-B] the refusal reaches a component watch as well as a module one", () => {
  assert.deepEqual(messages(`
component Counter:
    state count = 0

    watch count:
        count = count + 1

    return <p>{count}</p>
`), [selfWrite("count", "declare 'computed count = ...' instead")]);
});

test("[W-B] the 'as current, previous' header does not change the answer", () => {
  assert.deepEqual(messages(`
state count = 0

watch count as current, _:
    count = current + 1
`), [selfWrite("count", "declare 'computed count = ...' instead")]);
});

test("[W-B] one watch draws one diagnostic, at the first write", () => {
  // Two writes are one mistake with one place to start reading, and the second
  // is read after the first is fixed -- the same discipline the subject rules
  // follow, where one shape never draws two messages.
  assert.deepEqual(messages(`
state count = 0

watch count:
    count = count + 1
    count = count + 2
`), [selfWrite("count", "declare 'computed count = ...' instead")]);
});

test("[W-B] the refusal is an error and blocks emission", () => {
  // Not an advisory. An advisory reports and still emits; this one is a
  // provable dead loop, so there is no module to run.
  const result = compile(`
state count = 0

watch count:
    count = count + 1
`);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5077"]);
  assert.equal(result.code, null);
});

// ---------------------------------------------------------------------------
// The boundary: everything that may converge stays legal
// ---------------------------------------------------------------------------

test("[W-B] a write under a condition is the corrective watch and stays legal", () => {
  // R1's own fixture, and the idiom the charter blesses: the condition is what
  // ends the loop, and the compiler cannot and does not evaluate it.
  assert.deepEqual(messages(`
state n = 0

watch n:
    if n > 5:
        n = 5
`), []);
  assert.deepEqual(messages(`
state n = 0

watch n:
    match n:
        case 0: n = 1
        case _: print("done")
`), []);
  assert.deepEqual(messages(`
state n = 0

watch n:
    try:
        n = n + 1
    catch error:
        print(error.message)
`), []);
  assert.deepEqual(messages(`
state n = 0
state rows: List<number> = []

watch n:
    for row in rows:
        n = row
`), []);
});

test("[W-B] a write to a different state is two watches in source order, not an error", () => {
  // D90 R21: two watches writing one state both take effect, in the order they
  // were written. Nothing here may report on that shape.
  assert.deepEqual(messages(`
state t = 0
state x = 1

watch t:
    x = x + 1

watch t:
    x = x * 10
`), []);
  assert.deepEqual(messages(`
state t = 0
state x = 1

watch t as current, previous:
    x = current - previous
`), []);
});

test("[W-B] a write inside a nested def or an arrow is out of reach on purpose", () => {
  // R21 deleted the analysis that followed a write through a call, and the
  // shape that defeated it -- extracting the write into a helper -- is exactly
  // this one. It stays silent rather than being chased through a second
  // definition of the question.
  assert.deepEqual(messages(`
state count = 0

watch count:
    def bump():
        count = count + 1
    print(str(count))
`), []);
  assert.deepEqual(messages(`
state count = 0
state rows: List<number> = [1]

watch count:
    print(str(rows.map(row => row + count).size))
`), []);
  assert.deepEqual(messages(`
state count = 0

def bump():
    count = count + 1

watch count:
    bump()
`), []);
});

test("[W-B] a watch that only reads its subject is untouched", () => {
  assert.deepEqual(messages(`
state count = 0

watch count:
    print(str(count))
`), []);
  assert.deepEqual(messages(`
state count = 0
computed doubled = count * 2

watch doubled:
    print(str(doubled))
`), []);
});

test("[W-B] a body that rebinds the subject's name writes something else", () => {
  // From the declaration on, the spelling names the body's own binding. The
  // scan stops there rather than guessing which of the two the next line meant.
  assert.deepEqual(messages(`
state count = 0

watch count:
    let count = 1
    count = count + 1
    print(str(count))
`), []);
});

test("[W-B] a subject the compiler already refused draws no second message", () => {
  // The subject rules are asked first and answer completely: a frozen subject
  // and a computed subject each get their one message, and this rule does not
  // stack a second onto the same watch.
  assert.deepEqual(messages(`
const frozen = 1
state count = 0

watch frozen:
    count = count + 1
`).map((item) => item.slice(0, 7)), ["VEL5064"]);
  assert.deepEqual(messages(`
state a = 0
state b = 0

watch a + b as sum, _:
    print(str(sum))
`).map((item) => item.slice(0, 7)), ["VEL5071"]);
});
