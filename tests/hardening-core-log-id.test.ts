import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// Two settled behaviours of the small core modules. `velar/log` gates on the
// active level before it materializes anything, so a suppressed call is free
// and cannot raise; `velar/id` answers the textual UUID question its name asks,
// so canonical text is accepted whatever version or variant produced it.

after(async () => {
  await removeTemporaryDirectories();
});

/**
 * Compiles one Vel module and runs it against the real standard module sources,
 * which is where both behaviours live — `logger` and `isUuid` are imports.
 */
async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-log-id-");
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

test("[core-17] a suppressed log call neither merges its context nor checks a bound", async () => {
  const output = await run(`
import {logger, setLevel} from "velar/log"

const context: Map<string, unknown> = Map()
for index in range(0, 1000):
    context.set(f"k{index}", index)

const extra: Map<string, unknown> = Map()
extra.set("extra", 1)

setLevel("silent")
const app = logger("app", context)
try:
    app.debug("suppressed", extra)
    print("suppressed debug returned")
catch error:
    print(f"suppressed debug raised: {error.message}")
try:
    app.error("suppressed", Error("boom"), extra)
    print("suppressed error returned")
catch error:
    print(f"suppressed error raised: {error.message}")
`);
  assert.deepEqual(output.trim().split("\n"), [
    "suppressed debug returned",
    "suppressed error returned",
  ]);
});

test("[core-17] setLevel still reaches a logger that already exists", async () => {
  const output = await run(`
import {logger, setLevel, useSink} from "velar/log"

setLevel("silent")
const app = logger("app")
const stop = useSink(record => print(f"{record.level}:{record.scope}:{record.message}"))
app.debug("while silent")
app.info("while silent")
setLevel("debug")
app.debug("after raising the level")
setLevel("warn")
app.info("below warn")
app.warn("at warn")
stop()
`);
  assert.deepEqual(output.trim().split("\n"), [
    "debug:app:after raising the level",
    "warn:app:at warn",
  ]);
});

test("[core-17] an enabled level still enforces the merged field cap", async () => {
  const output = await run(`
import {logger, setLevel, useSink} from "velar/log"

const context: Map<string, unknown> = Map()
for index in range(0, 1000):
    context.set(f"k{index}", index)

const extra: Map<string, unknown> = Map()
extra.set("extra", 1)
const known: Map<string, unknown> = Map()
known.set("k0", 1)

setLevel("debug")
const stop = useSink(record => print(f"delivered {record.fields.size}"))
const app = logger("app", context)
try:
    app.debug("over the cap", extra)
    print("no bound was checked")
catch error:
    print(error.message)
app.debug("at the cap", known)
stop()
`);
  assert.deepEqual(output.trim().split("\n"), [
    "Merged log fields cannot exceed 1000 entries",
    "delivered 1000",
  ]);
});

test("[core-17] an enabled debug still delivers the merged context to a sink", async () => {
  const output = await run(`
import {logger, setLevel, useSink} from "velar/log"

setLevel("debug")
const stop = useSink(record => print(f"{record.message} {record.fields.size} {str(record.fields.get(\"scope\") ?? \"missing\")} {str(record.fields.get(\"extra\") ?? \"missing\")}"))
const base: Map<string, unknown> = Map()
base.set("scope", "base")
const call: Map<string, unknown> = Map()
call.set("extra", "call")
const app = logger("app", base)
app.debug("merged", call)
stop()
`);
  assert.equal(output.trim(), "merged 2 base call");
});

test("[core-18] isUuid accepts canonical UUID text from any version or variant", async () => {
  const output = await run(`
import {isUuid, uuid} from "velar/id"

print(isUuid("00000000-0000-0000-0000-000000000000"))
print(isUuid("ffffffff-ffff-ffff-ffff-ffffffffffff"))
print(isUuid("123e4567-e89b-12d3-c456-426614174000"))
print(isUuid("123e4567-e89b-12d3-d456-426614174000"))
print(isUuid("123E4567-E89B-12D3-A456-426614174000"))
print(isUuid(uuid()))
print(isUuid("0000000-0000-0000-0000-000000000000"))
print(isUuid("000000000-0000-0000-0000-000000000000"))
print(isUuid("123e4567e89b12d3a456426614174000"))
print(isUuid("123e4567-e89b-12d3-a456-42661417400g"))
`);
  assert.deepEqual(output.trim().split("\n"), [
    "true",
    "true",
    "true",
    "true",
    "true",
    "true",
    "false",
    "false",
    "false",
    "false",
  ]);
});
