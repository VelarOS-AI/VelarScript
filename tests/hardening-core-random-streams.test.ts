import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// velar/random used to fold every seed and every fork label into one 32-bit
// register, so `random(261848)` and `random(1303696)` were the same stream to
// the last bit, and `int` refused any range wider than the single word its
// rejection sampler drew. D83 rule 4 promises derivable streams from strings or
// safe integers; a 2^32 state space and a 2^32 range cap cannot carry that.

after(async () => {
  await removeTemporaryDirectories();
});

/**
 * Compiles one Vel module and runs it against the real standard module sources,
 * which is where the generator lives — `velar/random` is a shipped module, not
 * an inlined helper.
 */
async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-random-streams-");
  const project = await compileProject(join(directory, "main.vel"), new Map([[join(directory, "main.vel"), source.trimStart()]]), {});
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
  return String(execution.stdout);
}

test("[D83] distinct safe-integer seeds give distinct streams across a sweep", async () => {
  const output = await run(`
import {random} from "velar/random"

def stream(seed: number) -> string:
    const source = random(seed)
    return f"{source.number()}|{source.number()}|{source.number()}"

const seen: Set<string> = Set()
for value in range(4000):
    seen.add(stream(value))
print(str(seen.size))
print(str(stream(261848) == stream(1303696)))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  // Every one of the 4000 seeds owns its own stream — no two share a key.
  assert.equal(lines[0], "4000");
  // The pair that used to be identical to the last bit.
  assert.equal(lines[1], "false");
});

test("[D83] distinct fork labels give distinct streams, and forks do not collide with seeds", async () => {
  const output = await run(`
import {random} from "velar/random"
import {Random} from "velar/random"

def stream(source: Random) -> string:
    return f"{source.number()}|{source.number()}|{source.number()}"

const parent = random("parent")
const seen: Set<string> = Set()
for value in range(2000):
    seen.add(stream(parent.fork(f"child:{value}")))
print(str(seen.size))
print(str(stream(parent.fork("a")) == stream(parent.fork("b"))))
print(str(stream(parent.fork("a")) == stream(random("a"))))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "2000");
  assert.equal(lines[1], "false");
  assert.equal(lines[2], "false");
});

test("[D83] a one-character change anywhere in a long seed moves the whole stream", async () => {
  const output = await run(`
import {random} from "velar/random"

def stream(seed: string) -> string:
    const source = random(seed)
    return f"{source.number()}|{source.number()}|{source.number()}|{source.number()}"

let base = "seed-"
for _ in range(120):
    base += "x"

const seen: Set<string> = Set()
seen.add(stream(base))
for index in range(base.size):
    const mutated = base.slice(0, index) + "y" + base.slice(index + 1)
    seen.add(stream(mutated))
print(str(seen.size))
`);
  // 125 positions plus the original: every mutation lands on its own stream.
  assert.equal(output.trimEnd(), "126");
});

test("[D83] the same seed replayed gives the identical sequence", async () => {
  const output = await run(`
import {random} from "velar/random"

def stream(seed: string) -> string:
    const source = random(seed)
    return f"{source.number()}|{source.int(0, 1000)}|{source.bool()}|{source.number()}"

print(str(stream("replay") == stream("replay")))
print(str(random(7).int(0, 1000000) == random(7).int(0, 1000000)))
`);
  assert.equal(output.trimEnd(), "true\ntrue");
});

test("[D83] a string seed and a safe-integer seed of the same spelling stay apart", async () => {
  const output = await run(`
import {random} from "velar/random"
import {Random} from "velar/random"

def stream(source: Random) -> string:
    return f"{source.number()}|{source.number()}"

print(str(stream(random("5")) == stream(random(5))))
print(str(stream(random("-1")) == stream(random(-1))))
`);
  assert.equal(output.trimEnd(), "false\nfalse");
});

test("[D83] Random.int accepts the same safe-integer range as Math.randomInt", async () => {
  const output = await run(`
import {random} from "velar/random"

const source = random("wide")
let low = 10000000000
let high = -1
let above = 0
for _ in range(400):
    const value = source.int(0, 10000000000)
    if value < low:
        low = value
    if value > high:
        high = value
    if value > 4294967296:
        above += 1
print(str(low >= 0))
print(str(high < 10000000000))
print(str(above > 0))
print(str(source.int(9007199254740991 - 1, 9007199254740991) == 9007199254740990))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "true");
  assert.equal(lines[1], "true");
  // The old single-word sampler could not reach past 2^32 even when it accepted
  // the range; the two-word draw does.
  assert.equal(lines[2], "true");
  assert.equal(lines[3], "true");
});

test("[D83] Random.int stays in range and roughly uniform for a small width", async () => {
  const output = await run(`
import {random} from "velar/random"

const source = random("dice")
const counts: List<number> = [0, 0, 0, 0, 0, 0]
for _ in range(60000):
    const value = source.int(1, 7)
    counts[value - 1] += 1
print(f"{counts[0]} {counts[1]} {counts[2]} {counts[3]} {counts[4]} {counts[5]}")
`);
  const counts = output.trimEnd().split(" ").map((item) => Number(item));
  assert.equal(counts.length, 6);
  assert.equal(counts.reduce((total, item) => total + item, 0), 60000);
  // A deterministic stream, so this bound is a fixed fact, not a flake.
  for (const count of counts) assert.ok(count > 9500 && count < 10500, output);
});

test("[D83] Random.int still rejects an empty or decreasing range", async () => {
  const output = await run(`
import {random} from "velar/random"

const source = random("bounds")
try:
    print(str(source.int(0, 0)))
catch error:
    print(error.message)
try:
    print(str(source.int(5, 3)))
catch error:
    print(error.message)
try:
    print(str(source.int(0, 9007199254740992)))
catch error:
    print(error.message)
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal(line, "Random.int requires an increasing safe-integer range");
});
