import assert from "node:assert/strict";
import test from "node:test";
import { rejects, run } from "../../support/core-program.ts";

/**
 * D115 P5 — D44 rule 71, one subject of the file that was
 * `class-and-core-correctness.test.ts` before it reached 1,167 lines.
 *
 * Batch N-1 (audit fix wave, core correctness): the D44 ruling 71 (assignment
 * establishes a fact). What is held here is how far an assigned fact reaches:
 * declarations and later writes establish it, branches merge it, a loop back
 * edge strips it, and none of it ever makes a later test constant. The bodies
 * below are the bodies that file had.
 */

// ---------------------------------------------------------------------------
// D44 rule 71: assignment establishes a narrowing fact.
// ---------------------------------------------------------------------------

test("[D44 71] a declaration initializer establishes the assigned type", () => {
  assert.equal(run('const x: string? = "a"\nprint(x.upper())\n'), "A\n");
  assert.equal(run(`
const x: List<number>? = [1]
x.append(2)
print(str(x.size))
`), "2\n");
});

test("[D44 71] a later assignment establishes and a nullable right side establishes nothing", () => {
  assert.equal(run('let x: string? = null\nx = "a"\nprint(x.upper())\n'), "A\n");

  // The negative row: `x = maybeNull()` must not narrow.
  rejects(`
def maybe() -> string?:
    return "a"

let x: string? = null
x = maybe()
print(x.upper())
`, "VEL4001", /Use optional access '\?\.'/u);
});

test("[D44 71] a member assignment invalidates aliases first, then establishes for the written path", () => {
  // Both halves in one program: the write kills the sibling root's fact of
  // the same type, and the written path's new fact survives its own
  // invalidation.
  assert.equal(run(`
type Box:
    value: string?
    label: string

const box: Box = {value: null, label: "b"}
box.value = "fresh"
print(box.value.upper())
`), "FRESH\n");

  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
const twin: Box = {value: "hi"}
if twin.value != null:
    box.value = "fresh"
    print(box.value.upper() + twin.value.upper())
`, "VEL4001", /Use optional access '\?\.'/u);
});

test("[D44 71] union arms and unknown declarations refine", () => {
  assert.equal(run(`
let u: string | number = 5
u = "text"
print(u.upper())
u = 7
print(str(u + 1))
`), "TEXT\n8\n");

  assert.equal(run('const raw: unknown = "Ada"\nprint(raw.upper())\n'), "ADA\n");

  assert.equal(run(`
type User:
    name: string

type Slot:
    value: User | Error

const s: Slot = {value: Error("boom")}
s.value = {name: "Ada"}
print(s.value.name)
`), "Ada\n");
});

test("[D44 71] branches that each assign the refined type merge the fact", () => {
  assert.equal(run(`
def flag() -> bool:
    return true

let x: string? = null
if flag():
    x = "a"
else:
    x = "b"
print(x.upper())
`), "A\n");

  assert.equal(run(`
def risky() -> string:
    return "ok"

let x: string? = null
try:
    x = risky()
catch error:
    x = "fallback"
print(x.upper())
`), "OK\n");

  assert.equal(run(`
enum Mode:
    fast
    slow

def pick() -> Mode:
    return Mode.fast

let x: string? = null
match pick():
    case Mode.fast:
        x = "f"
    case Mode.slow:
        x = "s"
print(x.upper())
`), "F\n");
});

test("[D44 71] a branch that does not always assign leaves no fact", () => {
  rejects(`
def flag() -> bool:
    return true

let x: string? = null
if flag():
    x = "a"
print(x.upper())
`, "VEL4001", /Use optional access '\?\.'/u);
});

test("[D44 71] compound assignment keeps the fact", () => {
  assert.equal(run(`
let n: number? = null
n = 1
n += 1
print(n + 1)
`), "3\n");
});

test("[D44 71] an assigned fact refines reads but never makes a later test constant", () => {
  // D42 item 64 pinned these spellings as the language's null-test; the
  // assignment-established fact must not turn them into rejected constants.
  assert.equal(
    run('const value: string? = "x"\nprint(str(value == null))\nprint(str(value != null))\n'),
    "false\ntrue\n",
  );
  assert.equal(run(`
enum Status:
    pending
    done

const s: Status? = null
print(str(s == null))
print(str(s == Status.done))
`), "true\nfalse\n");

  // A fact established by a check keeps making a repeated check an error.
  rejects(`
def read() -> string?:
    return "a"

let x: string? = read()
if x != null:
    print(str(x != null))
`, "VEL4001", /have no values in common/u);
});

test("[D44 71] loop back edges strip assigned facts and their runtime guards", () => {
  // The audit-pinned reestablished-at-head loop stays diagnostic-free and
  // runs: the declaration fact is judged as the declared question at the
  // condition, and the body's invalidation reaches the second pass.
  assert.equal(run(`
let value: string? = "first"
while value != null:
    print(value.upper())
    value = null
`), "FIRST\n");

  // Regression for the stale-guard defect this rule amplified: a read whose
  // pass-one fact the back edge invalidates must not keep the pass-one
  // runtime guard, or iteration two throws NarrowingError on legal code.
  assert.equal(run(`
let round = 0

def next() -> bool:
    round += 1
    return round <= 2

let v: string? = "a"
while next():
    print(v)
    v = null
`), "a\nnull\n");

  // Same shape with the fact established by an outer check instead of the
  // declaration (this crashed on the pre-fix compiler).
  assert.equal(run(`
let round = 0

def next() -> bool:
    round += 1
    return round <= 2

let v: string? = "a"
if v != null:
    while next():
        print(v)
        v = null
`), "a\nnull\n");
});

test("[D44 71] enum singleton chains keep analyzing as the declared domain", () => {
  // Establishment is scoped to optional, union, and unknown storage, so a
  // non-optional enum declaration keeps its member-chain analysis exactly as
  // D42 pinned it.
  assert.equal(run(`
enum Status:
    pending
    done
    failed

const s: Status = Status.pending
if s == Status.pending:
    print("pending")
else if s == Status.done:
    print("done")
else if s == Status.failed:
    print("failed")
`), "pending\n");
});

test("[D44 71] an unannotated alias of an assigned fact declares the domain and keeps the fact", () => {
  // `pop()` returns a non-optional element, so the assignment establishes a
  // Row fact on the optional stash. The alias must not collapse to Row — its
  // declared domain stays Row?, the fact rides along, and both the defensive
  // check and the refined read stay legal.
  const output = run(`
type Row:
    id: string
    title: string

let rows: List<Row> = [{id: "a", title: "Alpha"}]
let held: Row? = null

def takeRow() -> string:
    held = rows.pop()
    const taken = held
    if taken != null:
        rows.append(taken)
    return taken.title

print(takeRow())
print(str(rows.size))
`);
  assert.equal(output, "Alpha\n1\n");
});

test("[D44 71] destructuring declarations keep their declared pieces sound", () => {
  // Each destructured binding types as its declared piece; a piece that the
  // initializer cannot refine establishes nothing.
  assert.equal(run(`
type Wide:
    a: string?
    b: number

const source: Wide = {a: "x", b: 1}
const {a, b} = source
print(str(b))
print(str(a == null))
`), "1\nfalse\n");
});
