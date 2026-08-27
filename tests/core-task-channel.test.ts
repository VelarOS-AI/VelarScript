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

/** 编译并执行一个真正依赖 velar/task 标准模块的最小程序。 */
async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-task-channel-");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([[entry, source.trimStart()]]), {});
  assert.deepEqual(project.failures.map((item) => item.message), []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const compiled = project.modules[0]!.result;
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
  return String(execution.stdout).trimEnd();
}

test("Channel is a bounded FIFO pull source that drains before closing", async () => {
  const output = await run(`
import {channel} from "velar/task"

type Message:
    value: number
const values = channel(Message, 2)
print(str(values.capacity))
print(str(values.trySend({value: 1})))
await values.send({value: 2})
print(str(values.size))
print(str(values.trySend({value: 3})))
values.close()

let result = ""
async for value in values:
    result += str(value.value)
print(result)
print(str(values.closed))
`);
  assert.equal(output, "2\ntrue\n2\nfalse\n12\ntrue");
});

test("Channel wakes blocked producers in FIFO order and cancellation removes a waiter", async () => {
  const output = await run(`
import {channel, task} from "velar/task"

type Message:
    value: number
const values = channel(Message, 2)
await values.send({value: 1})
await values.send({value: 0})
const second = task(async cancellation => await values.send({value: 2}, cancellation))
const third = task(async cancellation => await values.send({value: 3}, cancellation))
await third.cancel("discard third")

print(str((await values.next())!.value))
print(str((await values.next())!.value))
await second.result()
print(str((await values.next())!.value))
values.close()
print(str(await values.next() == null))
`);
  assert.equal(output, "1\n0\n2\ntrue");
});

test("Channel bounds waiting work and rejects operations after close", async () => {
  const output = await run(`
import {channel} from "velar/task"

type Message:
    value: number
const values = channel(Message, 1)
await values.send({value: 1})
const waitingResult = values.send({value: 2})

try:
    await values.send({value: 3})
catch error: print(error.name)

values.close()
try:
    await waitingResult
catch error: print(error.name)
try:
    values.trySend({value: 4})
catch error: print(error.name)
`);
  assert.equal(output, "ChannelBackpressureError\nChannelClosedError\nChannelClosedError");
});

test("Channel validates capacity before allocating runtime state", async () => {
  const output = await run(`
import {channel} from "velar/task"

type Message:
    value: number
for capacity in [0, 65537, 1.5]:
    try:
        channel(Message, capacity)
    catch error: print(error.name)
`);
  assert.equal(output, "RangeError\nRangeError\nRangeError");
});
