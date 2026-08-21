import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// The velar/text pattern and slug region: a slug that is not comparable to the
// text it renders as (core-15), an invalid pattern that says nothing about why
// it is invalid (core-21), and the one list-producing text operation that could
// step past the documented 1,000,000-item bound (core-22). The slug used to
// strip every combining mark, which collapsed distinct non-Latin titles onto
// one URL, and pattern matching used to bound its input but never its time —
// a budget that belongs to the patterns an author supplies, not to the fixed
// linear ones slug, title and normalizeWhitespace run over a large text.

after(async () => {
  await removeTemporaryDirectories();
});

/**
 * Compiles one Vel module and runs it against the real standard module sources,
 * which is where the behavior lives — `Text.` lowers to an import of
 * `velar/text`.
 */
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

/**
 * Materializes one standard module and its closure so the module's own exports
 * can be called directly. `rewrite` reaches the named module's source before it
 * is written, which is how the item cap is brought down to a testable size.
 */
async function loadStandardModule(name: string, rewrite: (source: string) => string = (source) => source): Promise<Record<string, (...args: readonly unknown[]) => unknown>> {
  const directory = await makeTemporaryDirectory("velar-text-module-");
  const files = new Map([...standardModuleClosure([name])].map((member, index) => [member, `module-${index}.js`]));
  for (const [member, file] of files) {
    let source = standardModuleSource(member) ?? "";
    if (member === name) source = rewrite(source);
    for (const [linked, target] of files) source = source.replaceAll(JSON.stringify(linked), JSON.stringify(`./${target}`));
    await writeFile(join(directory, file), source, "utf8");
  }
  return await import(join(directory, files.get(name)!));
}

test("[core-15] Text.slug output is NFC, so a Hangul slug equals the text it renders as", async () => {
  const output = await run(`
print(Text.slug("한국어") == "한국어")
print(Text.slug("한국어").size)
print(Text.slug("Crème brûlée!") == "creme-brulee")
print(Text.slug("  Velar Web 游戏  "))
`);
  assert.equal(output, "true\n3\ntrue\nvelar-web-游戏\n");
});

test("[core-15] a Hangul slug is found again as a Map key", async () => {
  const output = await run(`
const routes: Map<string, string> = Map()
routes.set(Text.slug("한국어"), "article")
print(routes.get("한국어") ?? "missing")
`);
  assert.equal(output, "article\n");
});

test("a slug folds Latin accents and keeps every other script's marks", async () => {
  const output = await run(`
for value in ["कि", "की", "क", "हिन्दी", "ไทยแลนด์", "مُحَمَّد"]:
    print(str(Text.slug(value) == Text.normalize(value, "NFC")))
print(str(Text.slug("कि") == Text.slug("की")))
print(Text.slug("Crème brûlée!"))
`);
  // Five article titles used to answer one slug; the marks are the difference.
  assert.equal(output, ["true", "true", "true", "true", "true", "true", "false", "creme-brulee", ""].join("\n"));
});

test("a slug drops a mark run that has no base, so nothing invisible reaches a URL", async () => {
  const output = await run(`
print(Text.slug("a ❤️ b"))
print(Text.slug("hello ́ world"))
print(Text.slug("हिन्दी"))
`);
  // The separator class has to keep marks for the scripts above, so a variation
  // selector left behind by a dropped emoji would otherwise ride into the slug
  // and two slugs that read alike would name two different pages.
  assert.equal(output, ["a-b", "hello-world", "हिन्दी", ""].join("\n"));
});

test("slug, title and normalizeWhitespace stay bounded by size alone", async () => {
  const module = await loadStandardModule("velar/text");
  const value = "Velar Web ".repeat(838_861);
  // Every pattern these three run is this module's own and linear, so the time
  // budget is not charged to them. An 8 MiB text is well inside the documented
  // 16 MiB cap and must not fail by how busy the machine happens to be.
  assert.equal((module.slug as (value: string) => string)(value).length, value.length - 1);
  assert.equal((module.title as (value: string) => string)(value).length, value.length);
  assert.equal((module.normalizeWhitespace as (value: string) => string)(value).length, value.length - 1);
});

test("a backtracking pattern fails loudly instead of running unbounded", async () => {
  const output = await run(`
try:
    print(str(Text.matches("aaaaaaaaaaaaaaaaaaaaaaaaaaaa!", "^(a+)+$")))
catch error:
    print(error.message)
print(str(Text.matches("velar-web", "^[a-z-]+$")))
print(Text.replaceMatches("a1b2c", "[0-9]", "-"))
print(Text.splitPattern("a, b; c", " *[,;] *").join("|"))
`);
  // Twenty-eight characters cost about a second before the budget landed, and
  // the doubling per character means no ordinary pattern comes near it.
  assert.equal(output, ["text pattern matching cannot exceed 250 ms", "true", "a-b-c", "a|b|c", ""].join("\n"));
});

test("toMatch carries the same time budget as the text pattern operations", async () => {
  const module = await loadStandardModule("velar/test");
  const expect = module.expect as (actual: unknown) => { toMatch: (expected: string) => void };
  assert.throws(() => expect("a".repeat(28) + "!").toMatch("^(a+)+$"), { name: "RangeError", message: "toMatch pattern matching cannot exceed 250 ms" });
  assert.equal(expect("Velar").toMatch("^Vel"), undefined);
});

test("[core-21] an invalid text pattern carries the reason it was rejected", async () => {
  const output = await run(`
try:
    Text.matches("x", "[a-z")
catch error:
    print(error.message)
try:
    Text.matches("x", "\\\\@")
catch error:
    print(error.message)
`);
  const lines = output.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^Invalid text pattern: /u);
  // The two failure classes used to be byte-identical; they must not be now.
  assert.notEqual(lines[0], lines[1]);
  // The host-shaped "Invalid regular expression: /…/u: " prefix does not travel.
  for (const line of lines) assert.doesNotMatch(line, /Invalid regular expression/u);
});

test("[core-21] a valid pattern still compiles and the TypeError type is unchanged", async () => {
  const output = await run(`
print(Text.splitPattern("a, b; c", " *[,;] *").join("|"))
print(Text.splitPattern("a1b", "([0-9])").join("|"))
try:
    Text.matches("x", "[")
catch error:
    print(error.name)
`);
  assert.equal(output, "a|b|c\na|b\nTypeError\n");
});

test("[core-21] toMatch carries the reason a pattern was rejected", async () => {
  const module = await loadStandardModule("velar/test");
  const expect = module.expect as (actual: unknown) => { toMatch: (expected: string) => void };
  const reject = (pattern: string): Error => {
    try { expect("x").toMatch(pattern); } catch (error) { return error as Error; }
    throw new Error("toMatch accepted " + pattern);
  };
  const classFailure = reject("[a-z");
  const escapeFailure = reject("\\@");
  assert.ok(classFailure instanceof TypeError);
  assert.ok(escapeFailure instanceof TypeError);
  assert.match(classFailure.message, /^Invalid toMatch pattern: /u);
  assert.match(escapeFailure.message, /^Invalid toMatch pattern: /u);
  assert.notEqual(classFailure.message, escapeFailure.message);
  assert.doesNotMatch(escapeFailure.message, /Invalid regular expression/u);
  assert.equal(expect("Velar").toMatch("^Vel"), undefined);
});

test("[core-22] splitPattern stays inside the item cap its siblings enforce", async () => {
  const capped = await loadStandardModule("velar/text", (source) => source
    .replace("const __velarMaxTextItems = 1000000;", "const __velarMaxTextItems = 5;")
    .replace("const maxTextItems = __velarMaxTextItems;", "const maxTextItems = 5;"));
  const splitPattern = capped.splitPattern as (value: string, expression: string) => readonly string[];
  const lines = capped.lines as (value: string) => readonly string[];
  // Five separators produce five pieces plus a trailing remainder: the tail used
  // to be appended unchecked, so this returned six items past a cap of five.
  assert.throws(() => splitPattern("a,b,c,d,e,f", ","), { name: "RangeError", message: "splitPattern cannot produce more than 5 items" });
  assert.throws(() => lines("a\nb\nc\nd\ne\nf"), { name: "RangeError" });
  assert.deepEqual(splitPattern("a,b,c,d,e", ","), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(lines("a\nb\nc\nd\ne"), ["a", "b", "c", "d", "e"]);
});
