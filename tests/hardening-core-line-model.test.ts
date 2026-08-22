import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// One line model, not two. The language accepts a lone CR as a statement
// separator -- `const a = 1\rconst b = 2` compiles -- and SourceText indexes
// CRLF, lone CR and LF alike so diagnostics can point at a line. `Text.lines`
// split on /\r?\n/ and `Text.lineStarts` counted only LF, so a Vel program
// reading its own source computed line numbers the compiler does not report.
// The audit filed that as four disagreeing models; two of the four turned out
// to agree, and this is the one that did not.

after(async () => {
  await removeTemporaryDirectories();
});

async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-text-patterns-");
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

test("a lone CR ends a line, because the language ends a statement there", async () => {
  const output = await run(`
const cr = "a\\rb"
print(f"{Text.lines(cr).size} {Text.lineStarts(cr).size}")
`);
  assert.equal(output.trim(), "2 2");
});

test("CRLF is one line ending, not two", async () => {
  const output = await run(`
const crlf = "a\\r\\nb"
print(f"{Text.lines(crlf).size} {Text.lineStarts(crlf).size}")
`);
  assert.equal(output.trim(), "2 2");
});

test("lineStarts places the start after the whole ending, in code points", async () => {
  // "a\r\nb\rc\nd": starts at 0, after the CRLF (3), after the CR (5), after
  // the LF (7). A CRLF that counted as two breaks would report a start of 2.
  const output = await run(`
const mix = "a\\r\\nb\\rc\\nd"
const starts = Text.lineStarts(mix)
print(f"{starts.size} {starts[0]} {starts[1]} {starts[2]} {starts[3]}")
`);
  assert.equal(output.trim(), "4 0 3 5 7");
});

test("the three endings agree between lines and lineStarts", async () => {
  const output = await run(`
const samples = ["a\\nb", "a\\r\\nb", "a\\rb", "a\\r\\nb\\rc\\nd", "abc", ""]
for sample in samples:
    print(f"{Text.lines(sample).size == Text.lineStarts(sample).size}")
`);
  assert.equal(output.trim().split("\n").every((line) => line === "true"), true, output);
});

test("a trailing ending leaves an empty final line, and an empty text is one line", async () => {
  const output = await run(`
print(f"{Text.lines("a\\n").size} {Text.lineStarts("a\\n").size}")
print(f"{Text.lines("").size} {Text.lineStarts("").size}")
`);
  assert.equal(output.trim(), "2 2\n1 1");
});
