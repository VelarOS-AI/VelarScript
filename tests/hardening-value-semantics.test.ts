import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { join, resolve } from "node:path";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

// Batch A' — the value-semantics family (docs/decisions/D42-EQUALITY-AND-ORDER.md
// items 64 and 65, docs/decisions/D41-BOUNDS-AND-POP.md item 62). One principle
// covers all three: a comparison between types no single value inhabits is
// constant, and an operation with two spellings has one too many.

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function accepts(source: string): void {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, [], source);
}

function rejects(source: string, pattern: RegExp): void {
  const result = compile(source.trimStart());
  assert.equal(result.code, null, source);
  const matched = result.diagnostics.find((item) => pattern.test(item.message));
  assert.ok(matched, `${source}\nexpected ${String(pattern)}, received ${JSON.stringify(result.diagnostics.map((item) => item.message))}`);
}

const projectRoot = "/velar-value-semantics-tests";

function projectSources(modules: Readonly<Record<string, string>>): Map<string, string> {
  return new Map(Object.entries(modules).map(([name, text]) => [join(projectRoot, name), text]));
}

const STATUS = "enum Status:\n    pending\n    done\n    failed\n";
const PRIORITY = "enum Priority:\n    high\n    low\n    normal\n";

// ---------------------------------------------------------------------------
// D42 item 64: `==`/`!=` require the operand types to intersect.
// ---------------------------------------------------------------------------

test("[D42 64] the case table's rejections: comparisons that are constant by construction", () => {
  const noOverlap = /have no values in common/u;
  rejects("const a = 1\nconst b = \"1\"\nprint(str(a == b))\n", noOverlap);
  rejects("const a = true\nconst b = 1\nprint(str(a == b))\n", noOverlap);
  rejects("type User:\n    name: string\nconst u: User = {name: \"a\"}\nprint(str(u == \"a\"))\n", noOverlap);
  rejects("const a: List<number> = [1]\nconst b: List<string> = [\"1\"]\nprint(str(a == b))\n", noOverlap);
  rejects(`${STATUS}enum Other:\n    pending\nprint(str(Status.pending == Other.pending))\n`, noOverlap);

  // `!=` carries the identical rule and reports the inverted constant.
  rejects("const a = 1\nconst b = \"1\"\nprint(str(a != b))\n", /'!=' is always true/u);
  rejects("const a = 1\nconst b = \"1\"\nprint(str(a == b))\n", /'==' is always false/u);
});

test("[D42 64] a non-optional operand against null is rejected and teaches the declaration fix", () => {
  rejects(
    "const name: string = \"x\"\nprint(str(name == null))\n",
    /string is never null — drop the check, or declare the value string\? if absence is real/u,
  );
  rejects(
    "type User:\n    name: string\nconst u: User = {name: \"a\"}\nprint(str(u != null))\n",
    /User is never null/u,
  );
});

test("[D42 64] anti-false-positive: `T? == null` and `user == null` stay legal", () => {
  // This is the language's only null-test spelling (D30 item 22), so the
  // tightening must never reach it.
  accepts("const value: string? = \"x\"\nprint(str(value == null))\nprint(str(value != null))\n");
  accepts("type User:\n    name: string\nconst user: User? = null\nif user == null:\n    print(\"absent\")\n");
  accepts("const values = [1]\nprint(str(values.get(9) == null))\n");
  accepts("const table: Map<string, number> = Map()\nprint(str(table.get(\"a\") == null))\n");
  accepts(`${STATUS}const s: Status? = null\nprint(str(s == null))\nprint(str(s == Status.done))\n`);
});

test("[D42 64] anti-false-positive: an else branch narrows to a union that still intersects", () => {
  // The else branch of an enum-singleton check narrows to the remaining
  // members, so a second member test there is a real question, not a constant.
  accepts(`${STATUS}const s: Status = Status.pending
if s == Status.pending:
    print("pending")
else:
    if s == Status.done:
        print("done")
    else:
        print("failed")
`);
  accepts(`${STATUS}const s: Status = Status.pending
if s == Status.pending:
    print("pending")
else if s == Status.done:
    print("done")
else if s == Status.failed:
    print("failed")
`);

  // Only a genuinely narrowed-to-one-singleton comparison is constant.
  rejects(`${STATUS}const s: Status = Status.pending
if s == Status.pending:
    print(str(s == Status.done))
`, /Status\.pending and Status\.done have no values in common/u);
});

test("[D42 64] anti-false-positive: unknown, any, and unresolved type parameters stay legal", () => {
  accepts(`def check(value: unknown) -> bool:
    return value == 1 or value == "1" or 1 == value
print(str(check(1)))
`);
  // `any` only exists behind an explicit unsafe JavaScript boundary, and that
  // boundary keeps its freedom too.
  accepts(`import js unsafe {legacyValue} from "legacy-package"
print(str(legacyValue == 1))
print(str(legacyValue == "1"))
print(str("1" == legacyValue))
`);
  accepts("def compare<T>(value: T) -> bool:\n    return value == null\nprint(str(compare(1)))\n");
});

test("[D42 64] intersection is decided by assignability, not by name", () => {
  // Structurally identical records intersect even with different names.
  accepts(`type User:
    name: string
type Order:
    name: string
const u: User = {name: "a"}
const o: Order = {name: "a"}
print(str(u == o))
`);
  // A partial union overlap is enough.
  accepts("const mixed: string | number = \"x\"\nconst text: string = \"x\"\nprint(str(mixed == text))\n");
  // Structurally different records do not.
  rejects(`type User:
    name: string
type Point:
    x: number
const u: User = {name: "a"}
const p: Point = {x: 1}
print(str(u == p))
`, /have no values in common/u);
});

test("[D42 64] structurally identical records from different modules intersect", async () => {
  const project = await compileProject(join(projectRoot, "main.vel"), projectSources({
    "left.vel": "export type Left:\n    name: string\n",
    "right.vel": "export type Right:\n    name: string\n",
    "main.vel": `import {Left} from "./left.vel"
import {Right} from "./right.vel"
const left: Left = {name: "a"}
const right: Right = {name: "a"}
print(str(left == right))
`,
  }), {});
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.deepEqual(diagnostics.map((item) => item.message), []);
  assert.deepEqual(project.failures, []);
});

test("[D42 65] enum versus string is the one documented exception and its diagnostic teaches parse", () => {
  // `const s: string = Kind.a` stays legal: assignability is a one-way wire
  // exit. Equality is symmetric, so honoring it here would open a read path
  // around Kind.parse.
  accepts("enum Kind:\n    textDelta\nconst wire: string = str(Kind.textDelta)\nprint(wire)\n");
  // MIG-1: both spellings appear with the rule for choosing between them,
  // including the fact that decides it — parse throws on an unknown value, so
  // a forward-compatible protocol handler must use the str form.
  const guidance = /an enum member converts to string only as a one-way wire exit, so choose by what an unknown value means here: write Kind\.parse\(text\) == Kind\.textDelta when the text must name a member — Kind\.parse throws on anything else — or str\(Kind\.textDelta\) == text when unknown values are expected and must be ignored, as on an open wire protocol/u;
  rejects("enum Kind:\n    textDelta\nconst raw: string = \"text-delta\"\nprint(str(raw == Kind.textDelta))\n", guidance);
  rejects("enum Kind:\n    textDelta\nconst raw: string = \"text-delta\"\nprint(str(Kind.textDelta == raw))\n", guidance);
  rejects("enum Kind:\n    textDelta\nconst raw: string = \"text-delta\"\nconst k: Kind = Kind.textDelta\nprint(str(raw != k))\n", /Kind\.parse\(text\) == Kind\.member/u);
  rejects("enum Kind:\n    textDelta\nconst raw: string = \"text-delta\"\nconst k: Kind = Kind.textDelta\nprint(str(raw != k))\n", /Kind\.parse throws on anything else/u);

  // Both taught spellings compile.
  accepts("enum Kind:\n    textDelta\nconst raw: string = \"textDelta\"\nprint(str(Kind.parse(raw) == Kind.textDelta))\n");
  accepts("enum Kind:\n    textDelta\nconst raw: string = \"textDelta\"\nprint(str(raw == str(Kind.textDelta)))\n");
});

test("[MIG-1] the enum-wire guidance states the fact that decides between its two forms", () => {
  // The referee migration followed 'parse first' into a runtime break: an
  // unknown future wire tag threw where the handler had to ignore it. Both
  // taught forms compile, so the difference is only visible at execution —
  // that is exactly why the message now carries it.
  const source = `enum Kind:
    textDelta = "response.output_text.delta"

def parsed(raw: string) -> string:
    try:
        return str(Kind.parse(raw) == Kind.textDelta)
    catch error:
        return "threw"

def compared(raw: string) -> string:
    return str(str(Kind.textDelta) == raw)

print(parsed("response.output_text.delta"))
print(parsed("response.future.event"))
print(compared("response.output_text.delta"))
print(compared("response.future.event"))
`;
  assert.equal(run(source), "true\nthrew\ntrue\nfalse\n");
});

test("[D42 64] runtime lowering is unchanged: SameValueZero survives the static tightening", () => {
  const numeric = compile("const a = 0 / 0\nconst b = 0 / 0\nprint(a == b)\nprint(a != b)\n");
  assert.deepEqual(numeric.diagnostics, []);
  assert.match(numeric.code ?? "", /__velarSameValueZero\(a, b\)/u);
  assert.equal(run("const a = 0 / 0\nprint(a == a)\nprint(-0 == 0)\n"), "true\ntrue\n");
});

// ---------------------------------------------------------------------------
// D42 item 65: enums leave Comparable and the ordering predicates merge.
// ---------------------------------------------------------------------------

test("[D42 65 / ORD-1] a mixed-category union is not ordered at any sort site", () => {
  const mixed = "const values: List<number | string> = [1, \"a\"]\n";
  rejects(`${mixed}print(str(values.sorted().size))\n`, /List<number \| string>\.sorted\(\) requires an explicit comparator/u);
  rejects(`${mixed}print(str(values.min() == null))\n`, /List\.min requires List<number> or List<string>/u);
  rejects(`${mixed}print(str(values.max() == null))\n`, /List\.max requires List<number> or List<string>/u);
  rejects(`type Row:
    key: number | string
const rows: List<Row> = [{key: 1}]
print(str(rows.sorted(by=row => row.key).size))
`, /sorted\(by=\) key must return only string or only number/u);

  // A single-category union stays ordered.
  accepts("type Score:\n    value: number\nconst v: List<number> = [1]\nprint(str(v.sorted().size))\n");
});

test("[D42 65 / ORD-2] List<Status>.min() stays rejected — it was the correct predicate", () => {
  rejects(`${STATUS}const values: List<Status> = [Status.done]
print(str(values.min() == null))
`, /List\.min requires List<number> or List<string>, received List<Status>/u);
});

test("[D42 65 / ORD-3] every sort path now agrees with direct `<`: enums are not ordered", () => {
  const enumOrdering = /an enum carries no runtime order, so state the order explicitly with sorted\(by=rank\) or a string-backed enum whose values encode it/u;
  // Direct ordered comparison was already correct; the message now teaches.
  rejects(`${STATUS}const a: Status = Status.pending
const b: Status = Status.done
print(str(a < b))
`, enumOrdering);
  // This is the silent-misorder case: it used to compile and return
  // [high, low, normal] — member-name alphabetical order.
  rejects(`${PRIORITY}const values: List<Priority> = [Priority.high, Priority.low, Priority.normal]
print(str(values.sorted().size))
`, enumOrdering);
  rejects(`${PRIORITY}type Row:
    priority: Priority
const rows: List<Row> = [{priority: Priority.high}]
print(str(rows.sorted(by=row => row.priority).size))
`, enumOrdering);
  rejects(`${PRIORITY}const values: List<Priority> = [Priority.high]
print(str(values.max() == null))
`, enumOrdering);
  // A List whose element mixes an enum with bare strings is not ordered either.
  rejects(`${PRIORITY}const values: List<Priority | string> = [Priority.high, "raw"]
print(str(values.sorted().size))
`, enumOrdering);
});

test("[D42 65 / ORD-3] the free-function key predicates agree with the method ones", async () => {
  const project = await compileProject(join(projectRoot, "main.vel"), projectSources({
    "main.vel": `import {sortBy, minBy, maxBy} from "velar/collections"
${PRIORITY}type Row:
    priority: Priority
const rows: List<Row> = [{priority: Priority.high}]
print(str(sortBy(rows, row => row.priority).size))
print(str(minBy(rows, row => row.priority) == null))
print(str(maxBy(rows, row => row.priority) == null))
`,
  }), {});
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message);
  assert.equal(messages.length, 3, JSON.stringify(messages));
  assert.ok(messages.some((message) => /sortBy key must return only string or only number, received Priority/u.test(message)));
  assert.ok(messages.some((message) => /minBy key must return only string or only number, received Priority/u.test(message)));
  assert.ok(messages.some((message) => /maxBy key must return only string or only number, received Priority/u.test(message)));
  assert.ok(messages.every((message) => /an enum carries no runtime order/u.test(message)));
});

test("[D42 65] the taught ways out compile and order correctly", () => {
  // A business order via an explicit rank key.
  assert.equal(run(`${PRIORITY}type Row:
    priority: Priority
    rank: number
const rows: List<Row> = [{priority: Priority.normal, rank: 2}, {priority: Priority.high, rank: 3}, {priority: Priority.low, rank: 1}]
print(rows.sorted(by=row => row.rank).map(row => str(row.rank)).join(","))
`), "1,2,3\n");

  // A string-backed enum whose runtime values encode the order.
  assert.equal(run(`enum Priority:
    low = "1-low"
    normal = "2-normal"
    high = "3-high"
const keys: List<string> = [str(Priority.high), str(Priority.low), str(Priority.normal)]
print(keys.sorted().join(","))
`), "1-low,2-normal,3-high\n");

  // An explicit comparator over enums also stays available.
  accepts(`${PRIORITY}const values: List<Priority> = [Priority.high]
print(str(values.sorted((a, b) => 0).size))
`);
});

test("[D42 65] number, string, and single-category unions remain ordered everywhere", () => {
  accepts(`const numbers: List<number> = [3, 1]
const words: List<string> = ["b", "a"]
print(str(numbers.sorted().size))
print(str(words.sorted().size))
print(str(numbers.min() == null))
print(str(words.max() == null))
print(str(1 < 2))
print(str("a" < "b"))
`);
  accepts(`type Row:
    name: string
    score: number
const rows: List<Row> = [{name: "a", score: 1}]
print(str(rows.sorted(by=row => row.score).size))
print(str(rows.sorted(by=row => row.name).size))
`);
});

test("[D42 65] exactly one predicate answers \"is this ordered\"", async () => {
  const analyzer = await import("node:fs/promises")
    .then((fs) => fs.readFile(resolve(new URL("..", import.meta.url).pathname, "packages/compiler/src/analyzer.ts"), "utf8"));
  // Four mechanisms giving three answers was the structural root of ORD-1/2/3.
  // The retired names must not come back.
  assert.ok(!/defaultSortableType/u.test(analyzer), "defaultSortableType came back");
  assert.ok(!/listAggregationOrderedType/u.test(analyzer), "listAggregationOrderedType came back");
  assert.ok(!/isCollectionOrderKey/u.test(analyzer), "isCollectionOrderKey came back");
  assert.equal(analyzer.match(/private orderedTypeCategory\(/gu)?.length, 1, "the single ordering decision point moved or multiplied");
});

// ---------------------------------------------------------------------------
// D41 item 62: pop is strict and removeLast is gone.
// ---------------------------------------------------------------------------

test("[D41 62] pop returns T, and an empty List or an out-of-range index throws IndexError", () => {
  const output = run(`
let values = [10, 20, 30]
const tail: number = values.pop()
const head: number = values.pop(0)
print(str(tail))
print(str(head))
print(str(values.size))

let negatives = [1, 2, 3]
print(str(negatives.pop(-1)))
print(str(negatives.pop(-2)))
print(str(negatives.size))

let emptied: List<string> = []
try:
    print(emptied.pop())
catch error:
    print(f"{error.name}: {error.message}")

let short = [1]
try:
    print(str(short.pop(9)))
catch error:
    print(f"{error.name}: {error.message}")

let alsoShort = [1]
try:
    print(str(alsoShort.pop(-9)))
catch error:
    print(f"{error.name}: {error.message}")

let fractional = [1]
try:
    print(str(fractional.pop(0.5)))
catch error:
    print(f"{error.name}: {error.message}")
`);
  assert.equal(output, [
    "30", "10", "1",
    "3", "1", "1",
    "IndexError: List.pop requires a non-empty List",
    "IndexError: List.pop index must be an in-range integer",
    "IndexError: List.pop index must be an in-range integer",
    "IndexError: List.pop index must be an integer",
  ].join("\n") + "\n");
});

test("[D41 62] removeLast is gone from the member table and from guidance", () => {
  const gone = compile("let values = [1]\nprint(str(values.removeLast()))\n");
  assert.equal(gone.code, null);
  assert.ok(gone.diagnostics.some((item) => /List has no member 'removeLast'/u.test(item.message)));
  const listMembers = gone.diagnostics.map((item) => item.message).join("\n");
  assert.ok(!/removeLast\(\)/u.test(listMembers.replace(/no member 'removeLast'/gu, "")), "guidance still advertises removeLast");
});

test("[D41 62] the drain idiom is a size guard, executed", () => {
  assert.equal(run(`
let chunks = ["stream", "ing", " works"]
let assembled = ""
while chunks.size > 0:
    assembled += chunks.pop(0)
print(assembled)
print(str(chunks.size))
`), "streaming works\n0\n");
});

test("[D41 62] the ?? fallback that only existed because pop was optional is now rejected", () => {
  // `blocks.pop() ?? ""` was noise: the left side can no longer be null.
  rejects("let blocks = [\"a\"]\nconst first = blocks.pop() ?? \"\"\nprint(first)\n", /Left side of '\?\?' is not optional: string/u);
});

test("[D41 62] remove(value) and the other List mutators are untouched", () => {
  assert.equal(run(`
let values = [1, 2, 3]
print(str(values.remove(2)))
print(str(values.remove(9)))
values.append(4)
values.extend([5])
values.insert(0, 0)
print(values.map(str).join(","))
values.clear()
print(str(values.size))
`), "true\nfalse\n0,1,3,4,5\n0\n");
});
