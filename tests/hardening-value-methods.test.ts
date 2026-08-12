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

test("[D29 10b] isInteger() follows Number.isInteger across the six audit inputs", () => {
  // Infinity is the reason the x == x.floor() folk test was a trap: overflow
  // passes it. The member must reject Infinity and NaN outright.
  const output = run(`
const overflow = 1e308 * 10
print(overflow.isInteger())
print((0 / 0).isInteger())
print((3.0).isInteger())
print((3.5).isInteger())
print((-7).isInteger())
print((-0).isInteger())
`);
  assert.equal(output, "false\nfalse\ntrue\nfalse\ntrue\ntrue\n");
});

test("[D29 附议 E] isBlank() uses Kotlin/Java semantics across the five audit inputs", () => {
  // Identity: text.isBlank() == (text.trim().size == 0). Unlike Python's
  // isspace(), the empty string is blank.
  const output = run(`
print("".isBlank())
print("   ".isBlank())
print("\\t\\n".isBlank())
print("  a  ".isBlank())
print("velar".isBlank())
print("".trim().size == 0)
`);
  assert.equal(output, "true\ntrue\ntrue\nfalse\nfalse\ntrue\n");
});

test("[D29 附议 C] split(\"\") is the character-list spelling, per Unicode code point", () => {
  const output = run(`
const parts = "a😀b".split("")
print(parts.size)
print(parts[0])
print(parts[1])
print(parts[2])
print("".split("").size)
`);
  assert.equal(output, "3\na\n😀\nb\n0\n");
});

// D41 item 62 replaced this pair: `removeLast` was a second name for `pop`,
// so `pop` absorbed the strict contract and `removeLast` is gone. The
// regressions live in tests/hardening-value-semantics.test.ts.
test("[D41 62] pop is the only tail mutator and it is strict", () => {
  const output = run(`
let items = ["a", "b", "c"]
const last = items.pop()
print(last)
print(items.size)
print(items.has("c"))

let numbers = [1, 2, 3]
print(str(numbers.pop()))
print(str(numbers.pop(0)))
print(str(numbers.size))
`);
  assert.equal(output, ["c", "2", "false", "3", "1", "1"].join("\n") + "\n");

  const gone = compile("let items = [\"a\"]\nprint(items.removeLast())\n");
  assert.equal(gone.code, null);
  assert.ok(gone.diagnostics.some((item) => /List has no member 'removeLast'/u.test(item.message)));
});

test("[D41 62] pop is fenced off readonly views like the other mutators", () => {
  const result = compile(`
def steal(values: readonly List<string>) -> string:
    return values.pop()
`.trimStart());
  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) =>
    /mutating method 'pop' through readonly List<string>/u.test(item.message)));
});

test("[D29 附议 B] List.get, List.pop, and string.char throw on non-integer indexes", () => {
  const output = run(`
const items = [1, 2, 3]
try:
    const value = items.get(1.5)
    print(value)
catch error:
    print(f"{error.name}: {error.message}")

let poppable = [1, 2, 3]
try:
    const removed = poppable.pop(0.5)
    print(removed)
catch error:
    print(f"{error.name}: {error.message}")

try:
    const character = "hello".char(1.5)
    print(character)
catch error:
    print(f"{error.name}: {error.message}")
`);
  assert.equal(output, [
    "IndexError: List.get index must be an integer",
    "IndexError: List.pop index must be an integer",
    "TypeError: String.char index must be an integer",
  ].join("\n") + "\n");
});

test("[D29 附议 B] out-of-range integers still answer null and negatives count from the end", () => {
  // The tightening rejects only non-integers; the []-strict/.get-optional
  // division of labor is unchanged for every integer input. `pop` moved to the
  // strict side in D41 item 62, so its out-of-range behavior lives with the
  // other throwing reads.
  const output = run(`
const items = [10, 20, 30]
print(items.get(99))
print(items.get(-1))
print(items.get(-99))
let poppable = [10, 20, 30]
print(str(poppable.pop(-1)))
print(str(poppable.size))
print("hi".char(9))
print("hi".char(-1))
print("hi".char(-9))
`);
  assert.equal(output, "null\n30\nnull\n30\n2\nnull\ni\nnull\n");
});

test("[D29 附议 B] Map keys are identity values, so fractional keys stay legal", () => {
  // Map.get is deliberately outside the tightening: 1.5 is a legal key
  // identity, not a position.
  const output = run(`
const table: Map<number, string> = Map()
table.set(1.5, "half")
table.set(-0.25, "quarter")
print(table.get(1.5))
print(table.has(1.5))
print(table.get(-0.25))
print(table.remove(1.5))
print(table.size)
`);
  assert.equal(output, "half\ntrue\nquarter\ntrue\n1\n");
});

test("[D29 14] discarding a compiler-owned pure result is an error", () => {
  const cases: readonly [string, string][] = [
    ["const values = [3, 1, 2]\nvalues.sorted()\n", "sorted"],
    ["const values = [3, 1, 2]\nvalues.slice(0, 1)\n", "slice"],
    ["const values = [3, 1, 2]\nvalues.map(value => value + 1)\n", "map"],
    ["const values = [3, 1, 2]\nvalues.sum()\n", "sum"],
    ["const values = [3, 1, 2]\nvalues.get(0)\n", "get"],
    ["const text = \" vel \"\ntext.trim()\n", "trim"],
    ["const text = \" vel \"\ntext.isBlank()\n", "isBlank"],
    ["const text = \" vel \"\ntext.split(\"\")\n", "split"],
    ["const value = 1.5\nvalue.floor()\n", "floor"],
    ["const value = 1.5\nvalue.isNaN()\n", "isNaN"],
    ["const table: Map<string, number> = Map()\ntable.keys()\n", "keys"],
    ["const table: Map<string, number> = Map()\ntable.copy()\n", "copy"],
  ];
  for (const [source, member] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    const diagnostic = result.diagnostics.find((item) => item.code === "VEL4029");
    assert.ok(diagnostic, source);
    assert.match(diagnostic.message, /the result is discarded/u, source);
    assert.ok(diagnostic.message.includes(`'${member}'`), source);
  }
});

test("[D29 14] mutate-and-return, null-returning mutators, user calls, and async statements stay legal", () => {
  // The scope discipline: the compiler judges only its own operations, and
  // only the ones that do not modify their receiver.
  const legal = compile(`
let values = [3, 1, 2]
values.pop()
values.remove(3)
values.append(9)
values.extend([4])
values.insert(0, 8)
values.clear()

const tags: Set<string> = Set()
tags.add("web")
tags.clear()

const table: Map<string, number> = Map()
table.set("a", 1)
table.clear()

def sideEffect() -> number:
    print("called")
    return 41

sideEffect()

async def background() -> null:
    return

await background()
async background()
`.trimStart());
  assert.deepEqual(legal.diagnostics, []);
});
