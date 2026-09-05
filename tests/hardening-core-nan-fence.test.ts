import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// R1 extends the D36/41 NaN fence past the List operations: a NaN may be held
// and tested with .isNaN(), but no operation compares or aggregates it and
// hands back a plausible-looking answer. velar/math and velar/collections used
// to do exactly that.

after(async () => {
  await removeTemporaryDirectories();
});

/**
 * Compiles one Vel module and runs it against the real standard module sources,
 * which is where the fence lives — `Math.` lowers to an import of `velar/math`.
 */
async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-nan-fence-");
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

test("[D36 41] Math.min and Math.max fence NaN the way List.min and List.max do", async () => {
  const output = await run(`
try:
    print(str(Math.min(1.0, 0.0 / 0.0)))
catch error:
    print(error.message)
try:
    print(str(Math.max(1.0, 0.0 / 0.0)))
catch error:
    print(error.message)
try:
    print(str(Math.min(0.0 / 0.0)))
catch error:
    print(error.message)
print(str(Math.min(4.0, 2.0, 8.0)))
print(str(Math.max(4.0, 2.0, 8.0)))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0]!, /^Math\.min found NaN, which has no ordering;/u);
  assert.match(lines[1]!, /^Math\.max found NaN, which has no ordering;/u);
  assert.match(lines[2]!, /^Math\.min found NaN, which has no ordering;/u);
  for (const line of lines.slice(0, 3)) assert.ok(line.includes("filter(x => not x.isNaN())"), line);
  assert.equal(lines[3], "2");
  assert.equal(lines[4], "8");
});

test("[D36 41] Math.clamp fences NaN in the value and in both bounds", async () => {
  const output = await run(`
try:
    print(str(Math.clamp(0.0 / 0.0, 0.0, 1.0)))
catch error:
    print(error.message)
try:
    print(str(Math.clamp(0.5, 0.0 / 0.0, 1.0)))
catch error:
    print(error.message)
try:
    print(str(Math.clamp(0.5, 0.0, 0.0 / 0.0)))
catch error:
    print(error.message)
try:
    print(str(Math.clamp(0.5, 0.0 / 0.0, 0.0 / 0.0)))
catch error:
    print(error.message)
try:
    print(str(Math.clamp(1.0, 2.0, 0.0)))
catch error:
    print(error.message)
print(str(Math.clamp(12.0, 0.0, 10.0)))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 6);
  for (const line of lines.slice(0, 4)) {
    assert.match(line, /^Math\.clamp found NaN, which has no ordering;/u);
    assert.ok(line.includes("filter(x => not x.isNaN())"), line);
  }
  // The bounds order check survives: a NaN bound used to slip past it, because
  // `minimum > maximum` is vacuously false for NaN.
  assert.equal(lines[4], "clamp minimum cannot exceed maximum");
  assert.equal(lines[5], "10");
});

test("[D36 41] a zero-total progress bar raises instead of rendering a NaN width", async () => {
  const output = await run(`
def fraction(done: number, total: number) -> number:
    return Math.clamp(done / total, 0.0, 1.0)

print(str(fraction(3.0, 4.0)))
try:
    print(str(fraction(0.0, 0.0)))
catch error:
    print(error.message)
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "0.75");
  assert.match(lines[1]!, /^Math\.clamp found NaN, which has no ordering;/u);
});

test("[D36 41] the keyed aggregations fence NaN the way List.sum does", async () => {
  const output = await run(`
try:
    print(str([{value: 1.0}, {value: 0.0 / 0.0}].min(by=row => row.value)?.value ?? 0.0))
catch error:
    print(error.message)
print(str([1.0, 2.0, 3.0].sum()))
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^List\.min by found NaN, which has no ordering;/u);
  assert.ok(lines[0]!.includes("filter(x => not x.isNaN())"), lines[0]!);
  assert.equal(lines[1], "6");
});

test("[D36 41] holding a NaN, testing it, and the infinities all still work", async () => {
  const output = await run(`
const nan = 0.0 / 0.0
print(str(nan.isNaN()))
print(str((1.0).isNaN()))
print(str(1.0 / 0.0))
print(str(-1.0 / 0.0))
print(str(nan))
`);
  assert.equal(output, "true\nfalse\nInfinity\n-Infinity\nNaN\n");
});
