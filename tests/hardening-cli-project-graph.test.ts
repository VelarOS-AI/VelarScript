import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildOwnershipGraph } from "../packages/cli/src/ownership-graph.ts";
import { compileProject, type ProjectResult } from "../packages/cli/src/project.ts";
import { projectWorkspaceSymbols } from "../packages/cli/src/project-semantic.ts";
import { WorkspaceTextIndex } from "../packages/cli/src/workspace-index.ts";

const CYCLE = "VEL3019";
const projectRoot = join(tmpdir(), "velar-cli-project-graph-tests");
const projectModulePath = fileURLToPath(new URL("../packages/cli/src/project.ts", import.meta.url));

async function checkProject(
  modules: Readonly<Record<string, string>>,
  entry: string,
): Promise<ProjectResult> {
  const overrides = new Map(Object.entries(modules).map(([name, text]) => [join(projectRoot, name), text]));
  return await compileProject(join(projectRoot, entry), overrides);
}

function diagnosticsOf(project: ProjectResult, name: string): readonly { code: string; message: string }[] {
  const module = project.modules.find((candidate) => candidate.inputPath === join(projectRoot, name));
  assert.ok(module, `module ${name} was compiled`);
  return module.result.diagnostics;
}

function allDiagnostics(project: ProjectResult): readonly { code: string; message: string }[] {
  return project.modules.flatMap((module) => module.result.diagnostics);
}

// cli-x2: the cycle exemption asked the origin module about the name written at
// the import site. Through an aliasing barrel those are two different names, so
// it answered about an unrelated export in both directions.
test("an aliasing barrel no longer hides a cycle read behind an unrelated hoisted export", async () => {
  const project = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export const value = 41",
      "",
      "export def helper() -> number:",
      "    return 1",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "barrel.vel": 'export {value as helper} from "./a.vel"\n',
    "reader.vel": [
      'import {helper} from "./barrel.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = helper",
      "",
    ].join("\n"),
  }, "a.vel");
  assert.deepEqual(project.failures, []);
  const reported = diagnosticsOf(project, "reader.vel");
  assert.equal(reported.length, 1);
  assert.equal(reported[0]?.code, CYCLE);
});

test("an aliasing barrel no longer refuses a correct program", async () => {
  const project = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export def helper() -> number:",
      "    return 1",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "barrel.vel": 'export {helper as run} from "./a.vel"\n',
    "reader.vel": [
      'import {run} from "./barrel.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = run()",
      "",
    ].join("\n"),
  }, "a.vel");
  assert.deepEqual(project.failures, []);
  assert.deepEqual(allDiagnostics(project), []);
});

// The sink rather than the spelling: the origin is resolved by walking the
// re-export chain, so a chain of any length has to answer with the name the
// module at its end declares, and a chain that loops has to stop.
test("a chain of aliasing barrels resolves to the name the origin declares", async () => {
  const legal = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export def helper() -> number:",
      "    return 1",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "b1.vel": 'export {helper as mid} from "./a.vel"\n',
    "b2.vel": 'export {mid as run} from "./b1.vel"\n',
    "reader.vel": [
      'import {run} from "./b2.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = run()",
      "",
    ].join("\n"),
  }, "a.vel");
  assert.deepEqual(legal.failures, []);
  assert.deepEqual(allDiagnostics(legal), []);

  const reported = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export const value = 41",
      "",
      "export def helper() -> number:",
      "    return 1",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "b1.vel": 'export {value as mid} from "./a.vel"\n',
    "b2.vel": 'export {mid as helper} from "./b1.vel"\n',
    "reader.vel": [
      'import {helper} from "./b2.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = helper",
      "",
    ].join("\n"),
  }, "a.vel");
  assert.deepEqual(reported.failures, []);
  assert.deepEqual(
    diagnosticsOf(reported, "reader.vel").map((item) => item.code),
    [CYCLE],
  );
});

test("a re-export loop is reported, not walked forever", async () => {
  const project = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export const value = 41",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "b1.vel": 'export {value} from "./b2.vel"\n',
    "b2.vel": 'export {value} from "./b1.vel"\n',
    "reader.vel": [
      'import {value} from "./b1.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = value",
      "",
    ].join("\n"),
  }, "a.vel");
  assert.deepEqual(
    project.failures.map((failure) => failure.message),
    [
      "Module './b2.vel' has no export named 'value'",
      "Module './b1.vel' has no export named 'value'",
      "Module './b1.vel' has no export named 'value'",
    ],
  );
});

test("a plain barrel still reports the cycle read it always reported", async () => {
  const project = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export const value = 41",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "barrel.vel": 'export {value} from "./a.vel"\n',
    "reader.vel": [
      'import {value} from "./barrel.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = value",
      "",
    ].join("\n"),
  }, "a.vel");
  const reported = diagnosticsOf(project, "reader.vel");
  assert.equal(reported.length, 1);
  assert.equal(reported[0]?.code, CYCLE);
  // cli-x15: the barrel initialized fine; naming it sent the author to the
  // wrong file. Name the module that has not initialized, and keep the
  // specifier as the route the author actually wrote.
  assert.equal(
    reported[0]?.message,
    "Move this read into a function, or extract the shared value into a third module; "
      + "'a.vel' (re-exported by './barrel.vel') has not initialized when this line runs",
  );
});

test("a direct cycle read still names the module the import names", async () => {
  const project = await checkProject({
    "a.vel": [
      'import {seed} from "./reader.vel"',
      "",
      "export const value = 41",
      "",
      "export const total = seed",
      "",
    ].join("\n"),
    "reader.vel": [
      'import {value} from "./a.vel"',
      "",
      "export const seed = 1",
      "",
      "export const x = value",
      "",
    ].join("\n"),
  }, "a.vel");
  const reported = diagnosticsOf(project, "reader.vel");
  assert.equal(reported.length, 1);
  assert.equal(
    reported[0]?.message,
    "Move this read into a function, or extract the shared value into a third module; "
      + "'./a.vel' has not initialized when this line runs",
  );
});

// cli-x4: a standard module's signature routinely returns a type another
// standard module declares. The field table used to travel only with the
// declaring module, so the analyzer reported the false fact that the type has
// no such field and an unused import was the only way to make it compile.
test("a standard type keeps its members without importing the module that declares it", async () => {
  const project = await checkProject({
    "main.vel": [
      'import {readBytes} from "velar/fs"',
      "",
      "export async def total(path: string) -> number:",
      "    const data = await readBytes(path)",
      "    return data.size",
      "",
    ].join("\n"),
  }, "main.vel");
  assert.deepEqual(project.failures, []);
  assert.deepEqual(allDiagnostics(project), []);
});

test("the same holds for the other standard modules that hand back a foreign type", async () => {
  const project = await checkProject({
    "main.vel": [
      'import {http} from "velar/http"',
      'import {Request} from "velar/serve"',
      "",
      "export async def probe(url: string) -> number:",
      "    const response = await http.get(url).response()",
      "    const data = await response.bytes()",
      "    return data.size",
      "",
      "export def cancelled(request: Request) -> bool:",
      "    return request.cancellation.cancelled",
      "",
    ].join("\n"),
  }, "main.vel");
  assert.deepEqual(project.failures, []);
  assert.deepEqual(allDiagnostics(project), []);
});

test("a project module that re-exports a standard binding carries the type with it", async () => {
  const project = await checkProject({
    "barrel.vel": 'export {readBytes} from "velar/fs"\n',
    "main.vel": [
      'import {readBytes} from "./barrel.vel"',
      "",
      "export async def total(path: string) -> number:",
      "    const data = await readBytes(path)",
      "    return data.size",
      "",
    ].join("\n"),
  }, "main.vel");
  assert.deepEqual(project.failures, []);
  assert.deepEqual(allDiagnostics(project), []);
});

// The metadata travels keyed by type identity, so it must not make a name
// spellable that the module never imported: reaching a type's members is not
// the same as being allowed to write its name.
test("reaching a foreign type's members does not put its name in scope", async () => {
  const project = await checkProject({
    "main.vel": [
      'import {readBytes} from "velar/fs"',
      "",
      "export async def total(path: string) -> number:",
      "    const data: Bytes = await readBytes(path)",
      "    return data.size",
      "",
    ].join("\n"),
  }, "main.vel");
  assert.deepEqual(
    allDiagnostics(project).map((item) => item.message),
    ["Unknown type 'Bytes'"],
  );
});

// cli-6 / D90 R3(a): module order decides the concatenated stylesheet's bytes,
// its content hash and `buildId`. `localeCompare` made all three follow the
// build machine's `LC_ALL` — `aa.vel` sorts after `z.vel` under Danish
// collation and before it under American.
test("module order does not follow the build machine's collation", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-module-order-"));
  try {
    await writeFile(join(root, "aa.vel"), "export const red = 1\n", "utf8");
    await writeFile(join(root, "z.vel"), "export const blue = 2\n", "utf8");
    await writeFile(join(root, "main.vel"), [
      'import {red} from "./aa.vel"',
      'import {blue} from "./z.vel"',
      "",
      "export const total = red + blue",
      "",
    ].join("\n"), "utf8");
    const script = [
      `const {compileProject} = await import(${JSON.stringify(projectModulePath)});`,
      `const project = await compileProject(${JSON.stringify(join(root, "main.vel"))});`,
      "process.stdout.write(project.modules.map((module) => module.relativePath).join(' '));",
    ].join("\n");
    const orders = ["en_US.UTF-8", "da_DK.UTF-8", "sv_SE.UTF-8"].map((locale) => {
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        timeout: 300_000,
        env: { ...process.env, LC_ALL: locale, LANG: locale },
      });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout;
    });
    assert.equal(orders[0], "aa.vel main.vel z.vel");
    assert.deepEqual([...new Set(orders)], [orders[0]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Taking the collation out of the workspace symbol list must not take the
// reading order out with it: the list a person scrolls still reads `apple`
// before `Banana`, as every Latin collation gave, and now says so on every
// machine rather than on the ones whose `LC_ALL` agreed.
test("the workspace symbol list keeps its reading order without a collation", async () => {
  const project = await checkProject({
    "names.vel": [
      "export def apple() -> number:",
      "    return 1",
      "",
      "export def Banana() -> number:",
      "    return 2",
      "",
      "export def cherry() -> number:",
      "    return 3",
      "",
      "export const total = apple() + Banana() + cherry()",
      "",
    ].join("\n"),
  }, "names.vel");
  assert.deepEqual(allDiagnostics(project), []);
  assert.deepEqual(
    projectWorkspaceSymbols(project, "").map((symbol) => symbol.name),
    ["apple", "Banana", "cherry", "total"],
  );
});

// cli-x9: the newly-appeared-module pass scanned the previous module list once
// per loaded module. The caller already holds the map that answers it.
test("an incremental rebuild affects the same modules the linear scan chose", async () => {
  const base = {
    "main.vel": [
      'import {label} from "./model.vel"',
      "",
      "export const shown = label(1)",
      "",
    ].join("\n"),
    "model.vel": "export def label(value: number) -> string:\n    return str(value)\n",
  };
  const first = await checkProject(base, "main.vel");
  assert.deepEqual(first.failures, []);
  assert.equal(first.stats.affectedModules, 2);

  const unchanged = await compileProject(
    join(projectRoot, "main.vel"),
    new Map(Object.entries(base).map(([name, text]) => [join(projectRoot, name), text])),
    {},
    first,
    new Set(),
  );
  assert.equal(unchanged.stats.affectedModules, 0);
  assert.equal(unchanged.stats.compiledModules, 0);
  assert.equal(unchanged.stats.reusedModules, 2);

  const changed = await compileProject(
    join(projectRoot, "main.vel"),
    new Map(Object.entries(base).map(([name, text]) => [join(projectRoot, name), text])),
    {},
    first,
    new Set([join(projectRoot, "model.vel")]),
  );
  assert.equal(changed.stats.affectedModules, 2);

  const added = {
    ...base,
    "main.vel": [
      'import {label} from "./model.vel"',
      'import {extra} from "./extra.vel"',
      "",
      "export const shown = label(extra)",
      "",
    ].join("\n"),
    "extra.vel": "export const extra = 2\n",
  };
  const grown = await compileProject(
    join(projectRoot, "main.vel"),
    new Map(Object.entries(added).map(([name, text]) => [join(projectRoot, name), text])),
    {},
    first,
    new Set([join(projectRoot, "main.vel")]),
  );
  assert.deepEqual(grown.failures, []);
  assert.equal(grown.stats.moduleCount, 3);
  // The added module has no previous entry, so it is affected by definition;
  // `model.vel` is a dependency of the changed module rather than a dependent,
  // so it is still reused.
  assert.equal(grown.stats.affectedModules, 2);
  assert.equal(grown.stats.compiledModules, 2);
  assert.equal(grown.stats.reusedModules, 1);
});

// cli-x6: `positionAt` counted code points from the start of the line on every
// call, so one long-lined file cost O(matches x size) and polled cancellation
// once for the whole request.
test("workspace search over one very long line stays interruptible and bounded", async () => {
  const root = join(tmpdir(), "velar-workspace-long-line");
  const index = new WorkspaceTextIndex();
  index.configure([root]);
  const filler = "x".repeat(3_000);
  const text = Array.from({ length: 1_000 }, () => `${filler}needle`).join("");
  assert.ok(text.length > 3_000_000);
  index.openDocument(join(root, "vendor.js"), text);

  // Best of three. The bound only has to separate a linear implementation from
  // the quadratic one it replaced — 9 ms against 6.2 s over this same input —
  // so it is read from the fastest attempt rather than from whichever attempt
  // a loaded machine happened to interrupt.
  let polls = 0;
  let elapsed = Number.POSITIVE_INFINITY;
  let result = await index.search("needle", { maximumResults: 1_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    polls = 0;
    const started = performance.now();
    result = await index.search("needle", { maximumResults: 1_000, cancelled: () => { polls += 1; return false; } });
    elapsed = Math.min(elapsed, performance.now() - started);
  }
  assert.equal(result.matches.length, 1_000);
  assert.ok(elapsed < 2_000, `workspace search took ${Math.round(elapsed)} ms`);
  assert.ok(polls > 2, `cancellation was polled ${polls} times`);
  assert.equal(result.matches[0]?.start.utf16Character, 3_000);
  assert.equal(result.matches.at(-1)?.start.utf32Character, text.length - 6);

  let cancelAfter = 3;
  await assert.rejects(
    index.search("needle", { maximumResults: 1_000, cancelled: () => (cancelAfter -= 1) <= 0 }),
    /cancel/iu,
  );
});

test("workspace search still counts astral characters per line", async () => {
  const root = join(tmpdir(), "velar-workspace-astral");
  const index = new WorkspaceTextIndex();
  index.configure([root]);
  index.openDocument(join(root, "mixed.md"), "\u{1F600}\u{1F600} needle \u{1F600} needle\n");
  const result = await index.search("needle", { maximumResults: 10 });
  assert.deepEqual(result.matches.map((match) => match.start), [
    { line: 0, utf16Character: 5, utf32Character: 3 },
    { line: 0, utf16Character: 15, utf32Character: 12 },
  ]);
});

// cli-x7: the owner lookup filtered and sorted the module's whole symbol array
// once per symbol and once per reference, and the caps were applied only after
// every candidate had been built.
test("the ownership graph's node cap bounds the work it does", async () => {
  const lines: string[] = [];
  for (let index = 0; index < 800; index += 1) {
    lines.push(`def helper${index}(value: number) -> number:`);
    lines.push(`    const a${index} = value + ${index}`);
    lines.push(`    const b${index} = a${index} * 2`);
    lines.push(`    return a${index} + b${index}`);
    lines.push("");
  }
  lines.push("export const total = helper0(1)");
  lines.push("");
  const project = await checkProject({ "big.vel": lines.join("\n") }, "big.vel");
  assert.deepEqual(allDiagnostics(project), []);

  // Best of three on both sides. The two runs are measured in the same process
  // so the machine's speed cancels out of the ratio, but a single garbage
  // collection landing in the capped run is worth more than the margin; the
  // fastest attempt of each is the one that reports the work, not the pause.
  let polls = 0;
  let fullMs = Number.POSITIVE_INFINITY;
  let cappedMs = Number.POSITIVE_INFINITY;
  let full = await buildOwnershipGraph(project);
  let capped = await buildOwnershipGraph(project, { maximumNodes: 50, maximumEdges: 50 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    full = await buildOwnershipGraph(project);
    fullMs = Math.min(fullMs, full.durationMs);
    polls = 0;
    capped = await buildOwnershipGraph(project, {
      maximumNodes: 50,
      maximumEdges: 50,
      cancelled: () => { polls += 1; return false; },
    });
    cappedMs = Math.min(cappedMs, capped.durationMs);
  }
  assert.equal(capped.nodes.length, 50);
  assert.equal(capped.edges.length, 50);
  assert.ok(capped.limitReached);
  assert.ok(full.nodes.length > 3_000);
  assert.ok(
    cappedMs < fullMs * 0.75,
    `capped ${Math.round(cappedMs)} ms vs full ${Math.round(fullMs)} ms`,
  );
  assert.ok(polls > 2, `cancellation was polled ${polls} times`);
});

test("the ownership graph still charges a symbol to its innermost containing owner", async () => {
  const project = await checkProject({
    "nested.vel": [
      "def outer(value: number) -> number:",
      "    def inner(inner_value: number) -> number:",
      "        return inner_value + 1",
      "    return inner(value)",
      "",
      "def sibling(value: number) -> number:",
      "    return value",
      "",
      "export const total = outer(1) + sibling(2)",
      "",
    ].join("\n"),
  }, "nested.vel");
  assert.deepEqual(allDiagnostics(project), []);
  const graph = await buildOwnershipGraph(project);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const owners = (name: string): readonly string[] => graph.nodes
    .filter((candidate) => candidate.name === name)
    .map((node) => graph.edges.find((edge) => edge.kind === "owns" && edge.to === node.id))
    .map((edge) => (edge ? nodeById.get(edge.from)?.name : undefined) ?? "<none>")
    .sort();
  // Two `value` parameters live in disjoint sibling functions and one
  // `inner_value` lives in a function nested inside one of them: each must be
  // charged to the smallest owner candidate that contains it, which is what
  // the interval index has to reproduce.
  assert.deepEqual(owners("value"), ["outer", "sibling"]);
  assert.deepEqual(owners("inner_value"), ["inner"]);
  assert.deepEqual(owners("outer"), ["nested.vel"]);
  assert.deepEqual(owners("sibling"), ["nested.vel"]);
});
