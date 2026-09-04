import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(async () => {
  await removeTemporaryDirectories();
});

async function run(source: string): Promise<{ readonly code: string; readonly output: string }> {
  const directory = await makeTemporaryDirectory("velar-binary-values-");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([[entry, source.trimStart()]]), {});
  assert.deepEqual(project.failures.map((item) => item.message), []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const compiled = project.modules.find((module) => module.inputPath === entry)!.result;
  const files = new Map([...standardModuleClosure([
    ...compiled.runtimeModules,
    ...compiled.dependencies.map((dependency) => dependency.source),
  ])].map((name, index) => [name, `module-${index}.js`]));
  const link = (text: string): string => {
    let linked = text;
    for (const [name, file] of files) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(`./${file}`));
    return linked;
  };
  for (const [name, file] of files) await writeFile(join(directory, file), link(standardModuleSource(name) ?? ""), "utf8");
  await writeFile(join(directory, "main.js"), link(compiled.code ?? ""), "utf8");
  const execution = spawnSync(process.execPath, [join(directory, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  return { code: compiled.code ?? "", output: String(execution.stdout) };
}

test("fixed numeric buffer values() returns one independent mutable List<number>", async () => {
  const result = await run(`
import {uint16Buffer} from "velar/binary"

const buffer = uint16Buffer(3)
buffer[0] = 5
buffer[1] = 6
buffer[2] = 7
const values: List<number> = buffer.values()
buffer[1] = 99
values[0] = 4
print(values)
print(buffer[0])
`);
  assert.equal(result.output, "[ 4, 6, 7 ]\n5\n");
  assert.match(result.code, /__velarBinaryRuntime\.__velarBufferValues\(buffer\)/u);
});

test("values() is available through readonly fixed buffers and every numeric width", async () => {
  const result = await run(`
import {Float32Buffer, UInt8Buffer, UInt16Buffer, UInt32Buffer, float32Buffer, uint8Buffer, uint16Buffer, uint32Buffer} from "velar/binary"

def snapshot(value: readonly UInt16Buffer) -> List<number>:
    return value.values()

const a: UInt8Buffer = uint8Buffer(0)
const b: UInt16Buffer = uint16Buffer(0)
const c: UInt32Buffer = uint32Buffer(0)
const d: Float32Buffer = float32Buffer(0)
print(a.values().size + snapshot(b).size + c.values().size + d.values().size)
`);
  assert.equal(result.output, "0\n");
});

test("fixed numeric buffers iterate values and indexes without allocating a List snapshot", async () => {
  const result = await run(`
import {Bytes, UInt8Buffer, UInt16Buffer, UInt32Buffer, Float32Buffer, uint8Buffer, uint16Buffer, uint32Buffer, float32Buffer} from "velar/binary"

def total8(values: readonly UInt8Buffer) -> number:
    let total = 0
    for value, index in values:
        total += value + index
    return total

def total16(values: readonly UInt16Buffer) -> number:
    let total = 0
    for value in values:
        total += value
    return total

def total32(values: readonly UInt32Buffer) -> number:
    let total = 0
    for value in values:
        total += value
    return total

def totalFloat(values: readonly Float32Buffer) -> number:
    let total = 0
    for value in values:
        total += value
    return total

def totalBytes(values: Bytes) -> number:
    let total = 0
    for value in values:
        total += value
    return total

const a = uint8Buffer(2)
a[0] = 4
a[1] = 6
const b = uint16Buffer(1)
b[0] = 7
const c = uint32Buffer(1)
c[0] = 8
const d = float32Buffer(1)
d[0] = 1.5
print(total8(a))
print(total16(b))
print(total32(c))
print(totalFloat(d))
print(totalBytes(a.toBytes()))
`);
  assert.equal(result.output, "11\n7\n8\n1.5\n10\n");
  assert.match(result.code, /__velarBinaryRuntime\.__velarBufferPairIterator\(values\)/u);
  assert.match(result.code, /__velarBinaryRuntime\.__velarBufferIterator\(values\)/u);
  assert.doesNotMatch(result.code, /__velarBufferValues/u);
});

test("binary builders finish partially filled storage without copying unused capacity", async () => {
  const result = await run(`
import {float32Builder, uint32Builder} from "velar/binary"

const positions = float32Builder(4096)
positions.push(1.25)
positions.push(2.5)
const indices = uint32Builder(4096)
indices.push(7)
print(positions.finish().values())
print(indices.finish().values())
`);
  assert.equal(result.output, "[ 1.25, 2.5 ]\n[ 7 ]\n");
});

test("values() enforces the universal List item ceiling before allocating", async () => {
  const result = await run(`
import {uint16Buffer} from "velar/binary"

const buffer = uint16Buffer(1000001)
try:
    buffer.values()
catch error:
    print(error.message)
`);
  assert.equal(result.output, "UInt16Buffer.values cannot produce more than 1000000 List items\n");
});

test("运行时创建的定长缓冲区共用可信索引快路径并保留边界错误", async () => {
  const result = await run(`
import {float32Buffer, uint16Buffer} from "velar/binary"

const integers = uint16Buffer(3)
integers[0] = 7
integers[2] = 11
const floats = float32Buffer(2)
floats[1] = 1.5
print(integers[0] + integers[2])
print(floats[1])
try:
    print(integers[3])
catch error:
    print(error.name)
try:
    integers[-1] = 2
catch error:
    print(error.name)
`);
  assert.equal(result.output, "18\n1.5\nIndexError\nIndexError\n");
  assert.match(result.code, /__velarBinaryRuntime\.__velarUInt16Index/u);

  const runtime = standardModuleSource("velar/binary") ?? "";
  assert.match(runtime, /const __velarBinaryTrustedLengths = new __velarBinaryNativeWeakMap/u);
  assert.match(runtime, /function __velarBinaryTrustedIndex/u);
  assert.match(runtime, /return __velarBinaryCheckedIndex\(value, index, expected, name\)/u);
});
