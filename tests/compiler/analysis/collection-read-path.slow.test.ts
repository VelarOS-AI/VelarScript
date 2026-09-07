import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";

// D116: the two COL-P1 wall-clock budgets (200 owned List.insert calls, and
// 2,000,000 owned List element reads under an absolute millisecond cap) live
// in the heavy tier: a budget is not a witness on a machine running other
// gates, and the heavy tier runs alone before a release. The functional COL-P1
// pins stay in collection-read-path.test.ts.

function compile(source: string, options?: Parameters<typeof compileCore>[1]) {
  return compileCore(source.trimStart(), options);
}

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
