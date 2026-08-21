import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// COL-P1 — the List element read path. Reading one element used to allocate
// two property descriptors (one for `length`, one for the index) on every
// read, including on the path the runtime already called "owned", so summing a
// 1,000,000-element List by index ran an order of magnitude slower than the
// identical plain-JavaScript loop.
//
// The fix records in the ownership memo *who wrote the elements*. A List this
// runtime wrote in full -- it allocated and filled the array itself, or started
// from the empty List literal the compiler adopted and took every element since
// through a List mutation -- is read with a plain load. Everything else is
// checked, and every element read re-proves the slot with a descriptor: every
// array that arrives from JavaScript, including one handed over empty, because
// at run time that array is indistinguishable from a literal and only the
// compiler knows which one it emitted.
//
// This file pins all of it: the owned half must stay fast and must keep
// reporting elements through the reactive bridge, the checked half must keep
// refusing every hostile array shape with the message it used to, and the
// residual the owned half accepts is written down here rather than assumed.

function compile(source: string, options?: Parameters<typeof compileCore>[1]) {
  return compileCore(source.trimStart(), options);
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code });
}

/** Compiles a module whose single `import js` line is replaced by a hostile host fixture. */
function runWithBoundary(source: string, boundary: string, imports: Map<string, unknown>): string {
  const result = compile(source, { analysis: { imports } } as Parameters<typeof compileCore>[1]);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule((result.code ?? "").replace(/^import .*?;\n/mu, boundary));
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

const numberList = { kind: "list", element: { kind: "number" } };
const listConsumer = { kind: "function", parameters: [numberList], requiredParameters: 1, result: { kind: "null" } };

test("[COL-P1] an owned List reads the same values by index and by iteration", () => {
  const result = compile(`
let values: List<number> = []
let index = 0
while index < 5:
    values.append(index * 2)
    index += 1

let byIndex = 0
let cursor = 0
while cursor < values.size:
    byIndex += values[cursor]
    cursor += 1

let byIteration = 0
for item in values:
    byIteration += item

print(str(byIndex))
print(str(byIteration))
print(str(values[-1]))
print(str(values.slice(1, 3).sum()))
print(str(values.map(item => item + 1).sum()))
`);
  assert.deepEqual(result.diagnostics, []);
  // The lowering is unchanged: every `values[i]` still goes through the one
  // runtime entry point, so the fast path is inside the runtime rather than a
  // second emitted shape.
  assert.match(result.code ?? "", /__velarListIndexGet\(/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout), "20\n20\n8\n6\n25\n");
});

test("[COL-P1] a host array with an accessor index is refused before the getter runs", () => {
  const stdout = runWithBoundary(`
import js {values, reads} from "./fixture.js"

try:
    print(str(values[0]))
catch error:
    print(error.message)
print(str(reads()))
`, [
    "let readCount = 0;",
    "const values = [1, 2];",
    "Object.defineProperty(values, \"0\", { configurable: true, enumerable: true, get() { readCount += 1; return 9; } });",
    "const reads = () => readCount;",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["values", numberList],
    ["reads", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "number" } }],
  ]));
  assert.equal(stdout, "List index requires ordinary mutable List data elements\n0\n");
});

test("[COL-P1] a host array with a hole, a non-enumerable index, or an extra key is refused", () => {
  const shapes: readonly (readonly [string, string])[] = [
    ["const values = [1, 2, 3];\ndelete values[1];\n", "List index requires a dense VelarScript List"],
    [
      "const values = [1, 2];\nObject.defineProperty(values, \"1\", { value: 9, writable: true, enumerable: false, configurable: true });\n",
      "List index requires ordinary mutable List data elements",
    ],
    [
      "const values = [1, 2];\nObject.defineProperty(values, \"tag\", { value: 9, writable: true, enumerable: true, configurable: true });\n",
      "List index requires a dense VelarScript List",
    ],
    ["const values = Object.freeze([1, 2]);\n", "List index received a frozen JavaScript array"],
  ];
  for (const [boundary, expected] of shapes) {
    const stdout = runWithBoundary(`
import js {values} from "./fixture.js"

try:
    print(str(values[0]))
catch error:
    print(error.message)
`, `${boundary}\n`, new Map<string, unknown>([["values", numberList]]));
    assert.ok(stdout.startsWith(expected), `${boundary}\nexpected ${expected}, received ${JSON.stringify(stdout)}`);
  }
});

test("[COL-P1] an accessor installed after a host List is validated is still refused", () => {
  // The tamper that only a per-element descriptor can see: the length never
  // moves, so the ownership memo still matches. A List the host handed over
  // keeps paying for that descriptor for exactly this case.
  const stdout = runWithBoundary(`
import js {values, poison} from "./fixture.js"

print(str(values[0]))
poison()
try:
    print(str(values[1]))
catch error:
    print(error.message)
try:
    for item in values:
        print(str(item))
catch error:
    print(error.message)
`, [
    "const values = [1, 2];",
    "const poison = () => { Object.defineProperty(values, \"1\", { configurable: true, enumerable: true, get() { return 9; } }); };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["values", numberList],
    ["poison", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(stdout, "1\nList index requires ordinary mutable List data elements\n1\nList iteration requires ordinary mutable List data elements\n");
});

test("[COL-P1] a species-hijacked host array reads correctly and never reaches its overrides", () => {
  const stdout = runWithBoundary(`
import js {values} from "./fixture.js"

print(str(values[0]))
for item in values:
    print(str(item))
print(str(values.slice(0, 1).size))
`, [
    "class HostileList extends Array {",
    "  static get [Symbol.species]() { throw new Error(\"list species override\"); }",
    "  [Symbol.iterator]() { throw new Error(\"list iterator override\"); }",
    "  includes() { throw new Error(\"list includes override\"); }",
    "}",
    "const values = new HostileList(1, 2);",
    "",
  ].join("\n"), new Map<string, unknown>([["values", numberList]]));
  assert.equal(stdout, "1\n1\n2\n1\n");
});

test("[COL-P1] a length change behind the runtime's back revalidates and demotes the List", () => {
  // Both halves of the memo contract. The runtime built this List, so its
  // reads take the plain load; the moment the host moves the length the memo
  // stops matching, full validation runs again, and the List is refused --
  // and, because a length only moves behind the runtime's back when the host
  // is holding the array, it is a checked List from then on.
  const stdout = runWithBoundary(`
import js {escape, truncate, restore} from "./fixture.js"

let values: List<number> = []
values.append(1)
values.append(2)
values.append(3)
escape(values)
print(str(values[0]))
truncate()
try:
    print(str(values[0]))
catch error:
    print(error.message)
restore()
print(str(values[0]))
print(str(values.size))
`, [
    "let held = null;",
    "const escape = (values) => { held = values; };",
    "const truncate = () => { held.length = 9; };",
    "const restore = () => { held.length = 3; };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["escape", listConsumer],
    ["truncate", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
    ["restore", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(stdout, "1\nList index requires a dense VelarScript List\n1\n3\n");
});

test("[COL-P1] the accessor a List this runtime wrote no longer refuses is the documented residual", () => {
  // The one behaviour the split gives up, pinned so that changing it back is a
  // decision rather than an accident. This List was written entirely by the
  // runtime, so its elements are read with a plain load; once the program has
  // handed it to JavaScript, an accessor installed on it reads like any other
  // element instead of raising. The exposure is the same one a plain foreign
  // write already had -- `held[1] = 99` was never detected either -- and it
  // ends the moment the size moves, which demotes the List for good.
  const stdout = runWithBoundary(`
import js {escape, poison, truncate} from "./fixture.js"

let values: List<number> = []
values.append(1)
values.append(2)
escape(values)
poison()
print(str(values[1]))
truncate()
try:
    print(str(values[1]))
catch error:
    print(error.message)
`, [
    "let held = null;",
    "const escape = (values) => { held = values; };",
    "const poison = () => { Object.defineProperty(held, \"1\", { configurable: true, enumerable: true, get() { return 9; } }); };",
    "const truncate = () => { held.length = 5; };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["escape", listConsumer],
    ["poison", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
    ["truncate", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(stdout, "9\nList index requires a dense VelarScript List\n");
});

test("[COL-P1] the empty List literal is the one array the compiler adopts", () => {
  // The bit the runtime cannot recover: at run time `[]` written in VelarScript
  // and `[]` handed over by JavaScript are the same empty array, and the
  // difference decides whether every later read re-proves its slot. The
  // compiler knows which one it emitted, so it says so; a literal that already
  // has elements needs no such help, because a non-empty array is never adopted
  // on the strength of validation alone.
  const result = compile(`
let grown: List<number> = []
const given = [1, 2]
grown.append(given[0])
print(str(grown.size + given.size))
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /let grown = __velarAdoptList\(\[\]\);/u);
  assert.match(result.code ?? "", /const given = \[1, 2\];/u);
});

test("[COL-P1] an array JavaScript hands over empty is checked, never owned", () => {
  // The runtime used to adopt any array it first met empty, which handed the
  // owned tier to an array the host allocated, still holds, and can rewrite --
  // the one case the tier split exists to keep out. Filling it from VelarScript
  // does not make VelarScript its only author.
  const stdout = runWithBoundary(`
import js {values, poison} from "./fixture.js"

values.append(1)
values.append(2)
poison()
try:
    print(str(values[1]))
catch error:
    print(error.message)
`, [
    "const values = [];",
    "const poison = () => { Object.defineProperty(values, \"1\", { configurable: true, enumerable: true, get() { return 9; } }); };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["values", numberList],
    ["poison", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(stdout, "List index requires ordinary mutable List data elements\n");
});

test("[COL-P1] a frozen List refuses every mutation in the same voice on both tiers", () => {
  // COL-U4 answers a frozen array at the boundary, but freezing is also the one
  // foreign change that revokes the right to mutate without moving the length,
  // so it survives a memo hit on either tier. Skipping the length descriptor on
  // the owned tier left append, index assignment and pop reporting the host's
  // own "Cannot assign to read only property" instead of a refusal, for the
  // same author mistake the checked tier already named.
  const refusals = [
    "List.append requires an ordinary mutable List length",
    "List index assignment requires an ordinary mutable List length",
    "List.pop requires an ordinary mutable List length",
  ].join("\n");
  const mutations = `
try:
    values.append(3)
catch error:
    print(error.message)
try:
    values[0] = 9
catch error:
    print(error.message)
try:
    print(str(values.pop()))
catch error:
    print(error.message)
`;
  const owned = runWithBoundary(`
import js {escape, freeze} from "./fixture.js"

let values: List<number> = []
values.append(1)
values.append(2)
escape(values)
freeze()
${mutations}`, [
    "let held = null;",
    "const escape = (values) => { held = values; };",
    "const freeze = () => { Object.freeze(held); };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["escape", listConsumer],
    ["freeze", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(owned, `${refusals}\n`);

  const checked = runWithBoundary(`
import js {values, freeze} from "./fixture.js"

print(str(values[0]))
freeze()
${mutations}`, [
    "const values = [1, 2];",
    "const freeze = () => { Object.freeze(values); };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["values", numberList],
    ["freeze", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(checked, `1\n${refusals}\n`);
});

test("[COL-P1] an owned List refuses a hole, and reports what a polluted array prototype answers", () => {
  // The exact reach of the plain load, pinned because a comment that overstates
  // it is itself a defect. An emptied slot reads as undefined, no List element
  // is ever undefined, and that single case pays for the descriptor probe. It
  // is the undefined the load notices, not the emptying: once a polluted array
  // prototype answers for the index, the load finds a value and returns it,
  // exactly as it returns a value a foreign write left behind.
  const stdout = runWithBoundary(`
import js {escape, empty, pollute} from "./fixture.js"

let values: List<number> = []
values.append(1)
values.append(2)
values.append(3)
escape(values)
empty()
try:
    print(str(values[1]))
catch error:
    print(error.message)
pollute()
print(str(values[1]))
`, [
    "let held = null;",
    "const escape = (values) => { held = values; };",
    "const empty = () => { delete held[1]; };",
    "const pollute = () => { Object.getPrototypeOf(held)[1] = 999; };",
    "",
  ].join("\n"), new Map<string, unknown>([
    ["escape", listConsumer],
    ["empty", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
    ["pollute", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]));
  assert.equal(stdout, "List index requires ordinary mutable List data elements\n999\n");
});

test("[COL-P1] a reactive List still reports every element read through the bridge", () => {
  // A fast path that skipped __velarReactiveCollectionRead would silently drop
  // dependency tracking, which is a wrong answer rather than a speed-up. Both
  // tiers are exercised: `grown` is written entirely by the runtime and takes
  // the plain load, `given` was a literal and keeps the descriptor read.
  const result = compileCore(`
type Row:
    value: number

state grown: List<number> = []
grown.append(1)
grown.append(2)
state given = [7, 8]
state rows: List<Row> = [{value: 1}, {value: 2}]

def rowTotal(items: List<Row>) -> number:
    let sum = 0
    for row in items:
        sum += row.value
    return sum

computed grownHead = grown[0] + grown[1]
computed givenHead = given[0] + given[1]
computed rowSum = rowTotal(rows)

print(str(grownHead))
print(str(givenHead))
print(str(rowSum))
grown[1] = 20
given[1] = 80
rows[0].value = 5
print(str(grownHead))
print(str(givenHead))
print(str(rowSum))
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout), "3\n15\n3\n21\n87\n7\n");
});

test("[COL-P1] inserting into an owned List keeps reading it as an owned List", (t) => {
  // List.insert lands the new slot before it shifts the tail, which moves the
  // length past the recorded one. Reading the tier after that point answers
  // "checked" about a List this runtime wrote in full, so every shifted element
  // allocated a descriptor: 200 inserts into 20,000 elements cost 142ms that
  // way and 8ms with the tier read hoisted above the new slot (Apple Silicon,
  // Node 24, 2026-08-21). The budget sits between the two.
  const budget = 60 * (process.env.CI ? 3 : 1);
  const program = (rounds: number) => `
let values: List<number> = []
let index = 0
while index < 20000:
    values.append(index)
    index += 1

let round = 0
while round < ${rounds}:
    values.insert(0, round)
    values.pop(0)
    round += 1
print(str(values.size))
`;
  const elapsed = (rounds: number): number => {
    const result = compile(program(rounds));
    assert.deepEqual(result.diagnostics, []);
    const samples: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = process.hrtime.bigint();
      const execution = executeModule(result.code ?? "");
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
      assert.equal(execution.status, 0, String(execution.stderr));
    }
    return samples.sort((left, right) => left - right)[1]!;
  };
  const shifts = elapsed(200) - elapsed(0);
  t.diagnostic(`200 owned List.insert calls over 20,000 elements: ${shifts.toFixed(1)}ms (budget ${budget}ms)`);
  assert.ok(shifts < budget, `200 owned List.insert calls took ${shifts.toFixed(1)}ms, over the ${budget}ms budget`);
});

test("[COL-P1] reading an owned List does not allocate a descriptor per element", (t) => {
  // A wall-clock floor for the descriptor pair coming back. 2,000,000 owned
  // element reads cost roughly 25ms on the reference machine (Apple Silicon,
  // Node 24, 2026-08-21) and 232ms on the same machine before the split; the
  // budget sits well under the old cost and well over the new one. The
  // construction pass is measured separately and subtracted so the bound
  // describes the reads alone.
  const budget = 100 * (process.env.CI ? 3 : 1);
  const program = (passes: number) => `
let values: List<number> = []
let index = 0
while index < 200000:
    values.append(index)
    index += 1

let total = 0
let round = 0
while round < ${passes}:
    let cursor = 0
    while cursor < values.size:
        total += values[cursor]
        cursor += 1
    round += 1
print(str(total))
`;
  const elapsed = (passes: number): number => {
    const result = compile(program(passes));
    assert.deepEqual(result.diagnostics, []);
    const samples: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = process.hrtime.bigint();
      const execution = executeModule(result.code ?? "");
      samples.push(Number(process.hrtime.bigint() - started) / 1e6);
      assert.equal(execution.status, 0, String(execution.stderr));
    }
    return samples.sort((left, right) => left - right)[1]!;
  };
  const reads = elapsed(10) - elapsed(0);
  t.diagnostic(`2,000,000 owned List element reads: ${reads.toFixed(1)}ms (budget ${budget}ms)`);
  assert.ok(reads < budget, `2,000,000 owned List element reads took ${reads.toFixed(1)}ms, over the ${budget}ms budget`);
});
