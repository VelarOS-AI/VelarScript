import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

/**
 * D114 S3b item C: a call made through `?.` answers `T?`, because the receiver
 * may be absent and the emitted chain short-circuits to `null`. Charter section
 * 5 states the rule — every optional access result normalizes to `null` — and
 * section 8 states its collection half: optional collection method access
 * yields the bound callable or `null`.
 *
 * These lock the whole family against a regression that would let one member's
 * result drop the optional arm while its emitted code still answers `null`: a
 * collection method, a checked string/number method, a class method, a record
 * function field, `?.[index]`, and `?.()`.
 */

after(async () => {
  await removeTemporaryDirectories();
});

/** The declared type of `out` in a program the compiler accepted. */
function resultType(source: string): string | null | undefined {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => item.message), []);
  return result.semanticIndex.symbols.find((symbol) => symbol.name === "out")?.type;
}

/** `out` bound from one optional-receiver expression inside a function body. */
function optionalResultType(parameter: string, expression: string): string | null | undefined {
  return resultType(`def go(${parameter}):\n    const out = ${expression}\n    print(str(out != null))\n`);
}

/** Compiles one module and runs it against the real standard module sources. */
async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-optional-calls-");
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
  return String(execution.stdout);
}

test("[D114 S3b] a collection method called through '?.' answers an optional", () => {
  const list = "values: List<number>?";
  assert.equal(optionalResultType(list, "values?.copy()"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.slice(0, 1)"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.sorted()"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.reversed()"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.unique()"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.chunk(2)"), "List<List<number>>?");
  assert.equal(optionalResultType(list, "values?.repeat(2)"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.sum()"), "number?");
  assert.equal(optionalResultType(list, "values?.min()"), "number?");
  assert.equal(optionalResultType(list, "values?.count(1)"), "number?");
  assert.equal(optionalResultType(list, "values?.has(1)"), "bool?");
  assert.equal(optionalResultType(list, "values?.get(0)"), "number?");
  assert.equal(optionalResultType(list, "values?.filter(value => value > 1)"), "List<number>?");
  assert.equal(optionalResultType(list, "values?.partition(value => value > 1)"), "{ matches: List<number>, rest: List<number> }?");
  assert.equal(optionalResultType("values: List<string>?", "values?.join(\",\")"), "string?");
  assert.equal(optionalResultType("values: Set<number>?", "values?.copy()"), "Set<number>?");
  assert.equal(optionalResultType("values: Set<number>?", "values?.values()"), "List<number>?");
  assert.equal(optionalResultType("values: Map<string, number>?", "values?.copy()"), "Map<string, number>?");
  assert.equal(optionalResultType("values: Map<string, number>?", "values?.keys()"), "List<string>?");
  assert.equal(optionalResultType("values: Map<string, number>?", "values?.getOrSet(\"a\", 1)"), "number?");
  assert.equal(optionalResultType("values: Record<number>?", "values?.keys()"), "List<string>?");
  assert.equal(optionalResultType("values: Record<number>?", "values?.get(\"a\")"), "number?");
});

test("[D114 S3b] a checked string or number method called through '?.' answers an optional", () => {
  assert.equal(optionalResultType("text: string?", "text?.trim()"), "string?");
  assert.equal(optionalResultType("text: string?", "text?.upper()"), "string?");
  assert.equal(optionalResultType("text: string?", "text?.split(\",\")"), "List<string>?");
  assert.equal(optionalResultType("text: string?", "text?.isBlank()"), "bool?");
  assert.equal(optionalResultType("text: string?", "text?.size"), "number?");
  assert.equal(optionalResultType("value: number?", "value?.abs()"), "number?");
  assert.equal(optionalResultType("value: number?", "value?.toFixed(2)"), "string?");
  assert.equal(optionalResultType("value: number?", "value?.isNaN()"), "bool?");
});

test("[D114 S3b] a class method, record function field, index, and call through '?.' answer optionals", () => {
  assert.equal(resultType(`
class Box:
    def label() -> string:
        return "box"

def go(box: Box?):
    const out = box?.label()
    print(str(out != null))
`), "string?");
  assert.equal(resultType(`
type Holder:
    make: () -> string

def go(holder: Holder?):
    const out = holder?.make()
    print(str(out != null))
`), "string?");
  assert.equal(optionalResultType("values: List<number>?", "values?.[0]"), "number?");
  assert.equal(optionalResultType("values: Record<number>?", "values?.[\"a\"]"), "number?");
  assert.equal(optionalResultType("make: (() -> string)?", "make?.()"), "string?");
});

test("[D114 S3b] a present receiver's call is unchanged", () => {
  assert.equal(resultType(`
def go(values: List<number>):
    const out = values.copy()
    print(str(out.size))
`), "List<number>");
  assert.equal(resultType(`
def go(text: string):
    const out = text.trim()
    print(out)
`), "string");
  assert.equal(resultType(`
class Box:
    def label() -> string:
        return "box"

def go(box: Box):
    const out = box.label()
    print(out)
`), "string");
});

test("[D114 S3b] an absent receiver answers null at runtime, exactly as the type says", async () => {
  assert.equal(await run(`
class Box:
    def label() -> string:
        return "box"

type Holder:
    make: () -> string

def report(
    values: List<number>?,
    text: string?,
    value: number?,
    box: Box?,
    holder: Holder?,
    make: (() -> string)?,
):
    print(str(values?.copy() == null))
    print(str(values?.map(item => item) == null))
    print(str(values?.[0] == null))
    print(str(text?.trim() == null))
    print(str(value?.abs() == null))
    print(str(box?.label() == null))
    print(str(holder?.make() == null))
    print(str(make?.() == null))

report(null, null, null, null, null, null)
report([1], "a", 1, Box(), {make: () => "made"}, () => "called")
`), [
    "true", "true", "true", "true", "true", "true", "true", "true",
    "false", "false", "false", "false", "false", "false", "false", "false",
    "",
  ].join("\n"));
});
