import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { compile, CORE_COMPILER_CONTEXTUAL_NAMES, formatSource } from "../packages/compiler/src/index.ts";
import { compileProject, compileProjectEntries } from "../packages/cli/src/project.ts";

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("@main accepts one inline statement and emits it for a direct entry", () => {
  const result = compile(`
const applicationName = "Velar"
@main: print(applicationName)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.hasMain, true);
  assert.match(result.code ?? "", /const applicationName = "Velar";/u);
  assert.match(result.code ?? "", /\{\n  console\.log\(applicationName\);\n\}/u);
});

test("@main accepts an indented body with direct await", () => {
  const result = compile(`
async def start():
    return null

@main:
    const started = start()
    await started
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.hasMain, true);
  assert.match(result.code ?? "", /const started = __velarNormalizePromiseValue\(start\(\)\);\n  await __velarNormalizePromiseValue\(started\);/u);
});

test("a regular module reports that it has no application entry", () => {
  const result = compile("export const value = 1\n");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.hasMain, false);
});

test("an imported module is checked without emitting its @main body", async () => {
  const root = join(process.cwd(), ".test-main-block-project");
  const entry = join(root, "main.vel");
  const dependency = join(root, "dependency.vel");
  const project = await compileProject(entry, new Map([
    [entry, `import {value} from "./dependency.vel"\n@main: print(value)\n`],
    [dependency, `export const value = 7\n@main: print("dependency entry")\n`],
  ]));

  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const entryCode = project.modules.find((module) => module.inputPath === entry)?.result.code ?? "";
  const dependencyCode = project.modules.find((module) => module.inputPath === dependency)?.result.code ?? "";
  assert.match(entryCode, /console\.log\(value\)/u);
  assert.doesNotMatch(dependencyCode, /dependency entry/u);
});

test("an imported module's omitted @main body still receives semantic checking", async () => {
  const root = join(process.cwd(), ".test-main-block-check");
  const entry = join(root, "main.vel");
  const dependency = join(root, "dependency.vel");
  const project = await compileProject(entry, new Map([
    [entry, `import {value} from "./dependency.vel"\n@main: print(value)\n`],
    [dependency, `export const value = 7\n@main: print(missing)\n`],
  ]));

  const dependencyDiagnostics = project.modules
    .find((module) => module.inputPath === dependency)?.result.diagnostics ?? [];
  assert.equal(dependencyDiagnostics.some((item) => item.code === "VEL3001" && item.message.includes("missing")), true);
});

test("incremental compilation invalidates a module whose entry role changes", async () => {
  const root = join(process.cwd(), ".test-main-block-incremental");
  const entry = join(root, "main.vel");
  const worker = join(root, "worker.vel");
  const sources = new Map([
    [entry, `import {value} from "./worker.vel"\n@main: print(value)\n`],
    [worker, `export const value = 1\n@main: print("worker entry")\n`],
  ]);
  const first = await compileProjectEntries([entry, worker], entry, sources);
  const firstWorker = first.modules.find((module) => module.inputPath === worker)?.result.code ?? "";
  assert.match(firstWorker, /worker entry/u);

  const second = await compileProjectEntries([entry], entry, sources, {}, first, new Set());
  const secondWorker = second.modules.find((module) => module.inputPath === worker)?.result.code ?? "";
  assert.doesNotMatch(secondWorker, /worker entry/u);
  assert.equal(second.stats.compiledModules >= 1, true);
});

test("@main owns a local scope and return keeps its function-only meaning", () => {
  assert.equal(messages(`def read() -> number: return local\n@main: const local = 1\n`)
    .some((item) => item.includes("Unknown name 'local'")), true);
  assert.equal(messages(`@main: return 1\n`)
    .some((item) => item.includes("'return' can only be used inside a function")), true);
});

test("@main is unique, final, and contains a module's executable statements", () => {
  assert.equal(messages(`@main: pass\n@main: pass\n`)
    .some((item) => item.includes("at most one '@main'")), true);
  assert.equal(messages(`@main: pass\nconst value = 1\n`)
    .some((item) => item.includes("final top-level region")), true);
  assert.equal(messages(`print("outside")\n@main: print("inside")\n`)
    .some((item) => item.includes("must be placed inside")), true);
});

test("the module compiler namespace is closed while main stays an ordinary source name", () => {
  assert.deepEqual(CORE_COMPILER_CONTEXTUAL_NAMES.module, ["main"]);
  assert.deepEqual(CORE_COMPILER_CONTEXTUAL_NAMES.declaration, ["context"]);
  assert.equal(messages(`def main(): return "ordinary"\n@entry: print(main())\n`)
    .some((item) => item.includes("module namespace contains only '@main:'")), true);
  assert.deepEqual(messages(`def main(): return "ordinary"\n@main: print(main())\n`), []);
});

test("@context carries one static business label without changing runtime semantics", () => {
  const source = [
    '@context("Order checkout")',
    'export def submit(orderId: string) -> string:',
    '    return orderId',
    '',
  ].join("\n");
  const result = compile(source);

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "submit")?.context, "Order checkout");
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "orderId")?.context, "Order checkout");
  assert.deepEqual(result.semanticIndex.syntaxDocumentation.map((item) => item.key), ["@context"]);
  assert.doesNotMatch(result.code ?? "", /Order checkout|context/u);
  assert.equal(
    formatSource(source),
    '@context("Order checkout")\nexport def submit(orderId: string) -> string: return orderId\n',
  );
});

test("@context remains bounded, singular, and declaration-only", () => {
  assert.equal(messages('@context("")\ndef run(): return\n')
    .some((item) => item.includes("non-empty business context")), true);
  assert.equal(messages('@context("Flow")\nprint("now")\n')
    .some((item) => item.includes("top-level declaration")), true);
  assert.equal(messages('def outer():\n    @context("Inner")\n    def inner(): return\n')
    .some((item) => item.includes("top-level declaration")), true);
  assert.equal(messages('@context("Outer")\n@context("Inner")\ndef run(): return\n')
    .some((item) => item.includes("only one '@context'")), true);
});

test("test modules keep named test declarations instead of a program entry", () => {
  const result = compile("@main: print(\"not a test\")\n", { path: "sample.test.vel" });
  assert.equal(result.diagnostics.some((item) => item.message.includes("cannot also declare an '@main'")), true);
});

test("@main publishes compiler-role semantics to editor consumers", () => {
  const result = compile("@main: print(\"ready\")\n");
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(
    result.semanticIndex.syntaxDocumentation.map((item) => item.key),
    ["@main"],
  );
  assert.equal(result.semanticIndex.syntaxTokens[0]?.kind, "decorator");
});

test("the formatter treats @main like the existing executable suite family", () => {
  const formatted = formatSource("@main:\n        print(\"ready\")\n");
  assert.equal(formatted, "@main: print(\"ready\")\n");
  assert.equal(formatSource(formatted), formatted);
});
