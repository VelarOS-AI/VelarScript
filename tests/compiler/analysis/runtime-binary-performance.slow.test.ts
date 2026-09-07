import assert from "node:assert/strict";
import test, { after } from "node:test";
import { removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { BENCHMARK_WALL_CLOCK_BUDGET_MS, benchmarkProgram, dimension, timeBudget } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — fixed numeric buffers, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is indexing a `velar/binary` buffer a million times in
 * each direction: the emitted read and write must reach the typed array
 * through the binary runtime and cost what a typed-array index costs. The
 * harness and the budget convention are in
 * `tests/support/runtime-benchmark.ts`; the bodies below are the bodies that
 * file had.
 */

after(removeTemporaryDirectories);

const binaryBufferProgram = `
import {float32Buffer} from "velar/binary"
import {monotonic} from "velar/time"

const values = float32Buffer(8192)

def writeRound(count: number) -> number:
    const started = monotonic()
    let index = 0
    while index < count:
        values[index % 8192] = (index % 1000) / 10
        index += 1
    return monotonic() - started

def readRound(count: number) -> number:
    const started = monotonic()
    let total = 0
    let index = 0
    while index < count:
        total += values[index % 8192]
        index += 1
    if total < 0: print("unreachable")
    return monotonic() - started

writeRound(1000000)
readRound(1000000)
let writeSamples = ""
let readSamples = ""
let round = 0
while round < 5:
    writeSamples += f"{str(writeRound(1000000))},"
    readSamples += f"{str(readRound(1000000))},"
    round += 1
print(f"write={writeSamples}")
print(f"read={readSamples}")
`.trimStart();

test("fixed numeric buffer indexing holds its million-operation budget", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples, code } = await benchmarkProgram("velar-runtime-binary-", binaryBufferProgram);
  assert.match(code, /__velarBinaryRuntime\.__velarFloat32Index/u);
  assert.match(code, /__velarBinaryRuntime\.__velarFloat32SetIndex/u);
  const write = dimension(samples, "write");
  const read = dimension(samples, "read");
  const context = `per 1,000,000 Float32Buffer operations: write ${write.toFixed(1)}ms, read ${read.toFixed(1)}ms`;
  t.diagnostic(context);
  // 2026-08-26 基线：预绑定可信长度查询后每百万次写约 6.1ms、读约 5.7ms。
  // 这里约束的是可信
  // 运行时缓冲区的索引路径；宿主传入且尚未 parse 的值仍回退到完整品牌校验。
  assert.ok(write < timeBudget(25), `Float32Buffer writes exceeded their budget -- ${context}`);
  assert.ok(read < timeBudget(25), `Float32Buffer reads exceeded their budget -- ${context}`);
  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the binary buffer benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});
