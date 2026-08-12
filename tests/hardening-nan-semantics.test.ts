import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

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

test("[D36 41] equality is SameValueZero: NaN == NaN is true and x == x always holds", () => {
  const output = run(`
const a = 0 / 0
const b = 0 / 0
print(a == b)
print(a != b)
print(a == a)
def same(value: number) -> bool:
    return value == value
print(same(0 / 0))
print(same(1))
`);
  assert.equal(output, "true\nfalse\ntrue\ntrue\ntrue\n");
});

test("[D36 41] the ±0 family keeps its === behavior", () => {
  const output = run(`
const negative = -0
const positive = 0
print(negative == positive)
print(negative != positive)
print(0 == 0)
print(1 / negative == 1 / positive)
`);
  // -0 == 0 stays true (SameValueZero agrees with ===); the infinities from
  // dividing by signed zero stay distinguishable.
  assert.equal(output, "true\nfalse\ntrue\nfalse\n");
});

test("[D36 41] type-driven elision: only number-capable comparisons carry the NaN repair", () => {
  // Numbers whose values the compiler cannot prove non-NaN take the
  // SameValueZero helper, whose body is the short-circuit repair shape.
  const numeric = compile(`
const a = 0 / 0
const b = 0 / 0
print(a == b)
print(a != b)
`.trimStart());
  assert.deepEqual(numeric.diagnostics, []);
  assert.match(numeric.code ?? "", /__velarSameValueZero\(a, b\)/u);
  assert.match(numeric.code ?? "", /!__velarSameValueZero\(a, b\)/u);
  assert.match(
    numeric.code ?? "",
    /left === right \|\| \(left !== left && right !== right\)/u,
    "the SameValueZero helper must keep the short-circuit repair shape",
  );

  // Operands whose static types exclude number emit plain strict equality.
  const elided = compile(`
enum Status:
    active
    done

type User:
    name: string

const s1 = "x"
const s2 = "y"
print(s1 == s2)
const first: Status = Status.active
const second: Status = Status.done
print(first == second)
const u1: User = {name: "Ada"}
const u2: User = {name: "Ada"}
print(u1 == u2)
const f1 = true
const f2 = false
print(f1 != f2)
`.trimStart());
  assert.deepEqual(elided.diagnostics, []);
  assert.doesNotMatch(elided.code ?? "", /__velarSameValueZero/u);
  assert.match(elided.code ?? "", /s1 === s2/u);
  assert.match(elided.code ?? "", /first === second/u);
  assert.match(elided.code ?? "", /u1 === u2/u);
  assert.match(elided.code ?? "", /f1 !== f2/u);

  // A numeric literal can never be NaN, so literal comparisons elide too.
  const literal = compile(`
const count = 4
if count == 5:
    print("five")
print(count == -1)
`.trimStart());
  assert.deepEqual(literal.diagnostics, []);
  assert.doesNotMatch(literal.code ?? "", /__velarSameValueZero/u);
  assert.match(literal.code ?? "", /count === 5/u);

  // Unchecked kinds could hide a number, so they keep the repair.
  const unchecked = compile(`
def same(left: unknown, right: unknown) -> bool:
    return left == right
print(same("a", "a"))
`.trimStart());
  assert.deepEqual(unchecked.diagnostics, []);
  assert.match(unchecked.code ?? "", /return __velarSameValueZero\(/u);
});

test("[D36 41] comparison chains inline the SameValueZero repair per numeric link", () => {
  const result = compile(`
const a = 0 / 0
const b = 0 / 0
const c = 0 / 0
print(a == b == c)
const s = "x"
print("x" == s == "x")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(
    result.code ?? "",
    /\$velarCompare\d+_0 === \$velarCompare\d+_1 \|\| \(\$velarCompare\d+_0 !== \$velarCompare\d+_0 && \$velarCompare\d+_1 !== \$velarCompare\d+_1\)/u,
  );
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n");
});

test("[D36 41] List membership agrees with Set/Map on NaN through SameValueZero", () => {
  const output = run(`
const nan = 0 / 0
const values = [nan, 1]
print(values.has(nan))
print(values.index(nan))
print(values.count(nan))
print(nan in values)
const bag = Set([nan])
print(bag.has(nan))
const table: Map<number, string> = Map()
table.set(nan, "missing")
print(table.get(nan))
let removable = [nan]
print(removable.remove(nan))
print(removable.size)
`);
  assert.equal(output, "true\n0\n1\ntrue\ntrue\nmissing\ntrue\n0\n");
});

test("[D36 41] sum, min, max, and sorted fence NaN with a targeted way out", () => {
  const output = run(`
const bad = [1, 0 / 0, 3]
try:
    const total = bad.sum()
    print(total)
catch error:
    print(error.message)
try:
    const low = bad.min()
    print(low)
catch error:
    print(error.message)
try:
    const high = bad.max()
    print(high)
catch error:
    print(error.message)
try:
    const ordered = bad.sorted()
    print(ordered.size)
catch error:
    print(error.message)

type Row:
    score: number

const rows: List<Row> = [{score: 0 / 0}]
try:
    const ranked = rows.sorted(by=row => row.score)
    print(ranked.size)
catch error:
    print(error.message)

const single = [0 / 0]
try:
    const alone = single.sorted()
    print(alone.size)
catch error:
    print(error.message)

const strings = ["b", "a"]
print(strings.sorted().join(","))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 7);
  assert.match(lines[0]!, /^List\.sum found NaN/u);
  assert.match(lines[1]!, /^List\.min found NaN/u);
  assert.match(lines[2]!, /^List\.max found NaN/u);
  assert.match(lines[3]!, /^List\.sorted\(\) found NaN/u);
  assert.match(lines[4]!, /^List\.sorted by found NaN/u);
  assert.match(lines[5]!, /^List\.sorted\(\) found NaN/u);
  for (const line of lines.slice(0, 6)) {
    assert.ok(line.includes("filter(x => not x.isNaN())"), line);
  }
  assert.equal(lines[6], "a,b");
});

test("[D36 41] isNaN() and isFinite() answer the six audit inputs", () => {
  const output = run(`
const nan = 0 / 0
const overflow = 1e308 * 10
print(nan.isNaN())
print(overflow.isNaN())
print((-overflow).isNaN())
print((0).isNaN())
print((3.5).isNaN())
print((-7).isNaN())
print(nan.isFinite())
print(overflow.isFinite())
print((-overflow).isFinite())
print((0).isFinite())
print((3.5).isFinite())
print((-7).isFinite())
`);
  assert.equal(output, [
    "true", "false", "false", "false", "false", "false",
    "false", "false", "false", "true", "true", "true",
  ].join("\n") + "\n");
});

test("[D36 41] ordered comparisons keep IEEE NaN behavior", () => {
  // The fences live in equality and the aggregations; < and > stay the
  // mother language's IEEE semantics, where NaN compares false.
  const output = run(`
const nan = 0 / 0
print(nan < 5)
print(nan > 5)
print(nan <= nan)
print(1 < 2)
`);
  assert.equal(output, "false\nfalse\nfalse\ntrue\n");
});
