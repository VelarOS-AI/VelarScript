import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { join, resolve } from "node:path";
import { compile } from "@velarscript/compiler";
import { compileProject, compileProjectEntries, type ProjectResult } from "../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";

after(removeTemporaryDirectories);


const root = repositoryRoot;

// Fix wave 1 of the marathon defect ledger (docs/decisions/archive/MARATHON-DEFECTS.md):
// the Core compiler and CLI items. Every test here is a regression probe for a
// defect that was confirmed with execution evidence, kept at the same level as
// that evidence -- execution where the ledger measured execution.

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function runClean(source: string): ReturnType<typeof spawnSync> {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

const projectRoot = join(tmpdir(), "velar-marathon-core-tests");

function projectSources(modules: Readonly<Record<string, string>>): Map<string, string> {
  return new Map(Object.entries(modules).map(([name, text]) => [join(projectRoot, name), text]));
}

function moduleOf(project: ProjectResult, name: string): ProjectResult["modules"][number] {
  const module = project.modules.find((candidate) => candidate.inputPath === join(projectRoot, name));
  assert.ok(module, `module ${name} was compiled`);
  return module;
}

function codesOf(project: ProjectResult, name: string): readonly string[] {
  return moduleOf(project, name).result.diagnostics.map((item) => item.code);
}

// ---------------------------------------------------------------------------
// alpha-1: `str` as a value bypassed the text-conversion whitelist.
// ---------------------------------------------------------------------------

test("[alpha-1] str held as a value keeps the text-conversion whitelist at the call site", () => {
  // The hole: `builtin("str")` declared an `any` parameter, the whitelist only
  // fired on direct-call syntax, and the emitter rewrote the identifier to
  // `String` unconditionally -- so a record's 'toString' hook ran through the
  // front door.
  const rejected = compile(`
type Report:
    title: string

const convert = str
const report: Report = {title: "quarterly"}
print(convert(report))
`.trimStart());
  assert.ok(rejected.diagnostics.length > 0, "a record reached str() through a value binding");
  assert.ok(rejected.diagnostics.some((item) => item.message.includes("string | number | bool | enum | null")),
    rejected.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
  assert.equal(rejected.code, null);

  // Execution-level: the hook is never reached, because the module never
  // compiles. The pre-fix emission ran `String(report)` and executed toString.
  const hook = compile(`
import js {report} from "./fixture.js"
const convert = str
print(convert(report))
`.trimStart(), { analysis: { imports: new Map([["report", { kind: "unknown" }]]) } });
  assert.ok(hook.diagnostics.length > 0, "an unknown JavaScript value reached str() through a value binding");
});

test("[alpha-1] a bare str stays a first-class value over text-convertible data", () => {
  // The fix must not change the language surface: holding `str` and mapping it
  // over text-convertible elements both stay legal.
  const execution = runClean(`
enum Status:
    active
    paused

const convert = str
const labels: List<number> = [1, 2, 3]
const flags: List<bool> = [true, false]
const states: List<Status> = [Status.active, Status.paused]
print(convert("direct"))
print(labels.map(str).join("-"))
print(flags.map(str).join("-"))
print(states.map(str).join("-"))
`);
  assert.equal(execution.stdout, "direct\n1-2-3\ntrue-false\nactive-paused\n");
});

test("[alpha-1] mapping str over a non-text List is a type error", () => {
  const result = compile(`
type Row:
    id: number

const rows: List<Row> = [{id: 1}]
print(rows.map(str).size)
`.trimStart());
  assert.ok(result.diagnostics.length > 0, "map(str) over records type-checked");
  assert.equal(result.code, null);
});

// ---------------------------------------------------------------------------
// alpha-3 / NEW-1: the detached reporter could kill the process.
// ---------------------------------------------------------------------------

test("[alpha-3/NEW-1] a rejection whose stack getter throws is reported, not fatal", () => {
  const result = compile(`
async def tick():
    pass

detach tick()
print("still running")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // The reporter reads `.stack` off a foreign error object. An accessor that
  // throws used to make the reporter itself throw inside a rejection handler,
  // and the discarded derived Promise turned that into an unhandled rejection
  // that ended the process.
  const hostile = [
    "const hostile = new Error(\"hostile failure\");",
    "Object.defineProperty(hostile, \"stack\", { get() { throw new Error(\"stack getter\"); } });",
    "__velarDetachedTask(Promise.reject(hostile));",
  ].join("\n");
  const execution = executeModule(`${result.code ?? ""}\n${hostile}\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "still running\n");
  assert.match(String(execution.stderr), /Detached task failed: hostile failure/u);
});

test("[alpha-3/NEW-1] a rejection with no readable message still reports without ending the process", () => {
  const result = compile(`
async def tick():
    pass

detach tick()
print("alive")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const hostile = [
    "const hostile = new Error(\"ignored\");",
    "Object.defineProperty(hostile, \"stack\", { get() { throw new Error(\"stack\"); } });",
    "Object.defineProperty(hostile, \"message\", { get() { throw new Error(\"message\"); } });",
    "__velarDetachedTask(Promise.reject(hostile));",
  ].join("\n");
  const execution = executeModule(`${result.code ?? ""}\n${hostile}\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "alive\n");
  assert.match(String(execution.stderr), /Detached task failed: A detached task failed/u);
});

// ---------------------------------------------------------------------------
// alpha-5: `async <expr>` skipped Promise normalization.
// ---------------------------------------------------------------------------

function detachedBoundary(supply: string): string {
  const module = `data:text/javascript,export function supply(){return ${encodeURIComponent(supply)}}`;
  return `
extern module "${module}":
    export def supply() -> Promise<null>

import js {supply} from "${module}"

try:
    detach supply()
catch error:
    print(error.message)
print("continued")
`.trimStart();
}

test("[alpha-5] a foreign thenable handed to 'async' fails as an owned error", () => {
  // A foreign thenable is not a Promise: handing it straight to
  // Promise.prototype.then threw a synchronous, host-voiced
  // 'Method Promise.prototype.then called on incompatible receiver' that
  // nothing owned and no catch block could name.
  const execution = runClean(detachedBoundary("{then(resolve){resolve(null)}}"));
  assert.equal(execution.stdout, "Expected an actual Promise\ncontinued\n");
});

test("[alpha-5] an extern boundary returning undefined fails as an owned error", () => {
  const execution = runClean(detachedBoundary("undefined"));
  assert.equal(execution.stdout, "Expected an actual Promise\ncontinued\n");
});

// ---------------------------------------------------------------------------
// alpha-2, alpha-6 through alpha-10, alpha-13: the VEL3019 family.
// ---------------------------------------------------------------------------

test("[alpha-2] a module that leaves a cycle recovers its emitted code under incremental reuse", async () => {
  // The cycle check nulled the emitted output in place, and that mutated
  // result was what the incremental cache stored. A later compile that reused
  // the module never restored `code`, so `velar dev` served an empty module
  // with zero diagnostics and importers failed with a bare SyntaxError.
  //
  // Swapping the entry's import order flips which cycle member evaluates
  // first, so the flagged module changes while neither cycle member is itself
  // affected by the edit -- exactly the reuse path that kept `code: null`.
  const cycle = {
    "a.vel": 'import {fromB} from "./b.vel"\nexport const fromA = "a"\nprint(fromB)\n',
    "b.vel": 'import {fromA} from "./a.vel"\nexport const fromB = "b"\nprint(fromA)\n',
  };
  const first = { ...cycle, "main.vel": 'import {fromA} from "./a.vel"\nimport {fromB} from "./b.vel"\nprint(fromA + fromB)\n' };
  const swapped = { ...cycle, "main.vel": 'import {fromB} from "./b.vel"\nimport {fromA} from "./a.vel"\nprint(fromA + fromB)\n' };

  const one = await compileProject(join(projectRoot, "main.vel"), projectSources(first), {});
  assert.deepEqual(codesOf(one, "b.vel"), ["VEL3019"]);
  assert.equal(moduleOf(one, "b.vel").result.code, null);
  assert.deepEqual(codesOf(one, "a.vel"), []);

  const two = await compileProject(
    join(projectRoot, "main.vel"),
    projectSources(swapped),
    {},
    one,
    new Set([join(projectRoot, "main.vel")]),
  );
  assert.ok(two.stats.reusedModules > 0, "the cycle members were reused, not recompiled");
  // The flag moved to the other member, and the module that left the cycle got
  // its emitted output back.
  assert.deepEqual(codesOf(two, "a.vel"), ["VEL3019"]);
  assert.deepEqual(codesOf(two, "b.vel"), []);
  assert.ok(moduleOf(two, "b.vel").result.code, "a reused module kept a null code with no diagnostic");

  // The invariant, stated directly: no module ever carries a null code with an
  // empty diagnostic list.
  for (const project of [one, two]) {
    for (const module of project.modules) {
      assert.ok(module.result.code !== null || module.result.diagnostics.length > 0,
        `${module.relativePath} has no code and no diagnostic explaining why`);
    }
  }
});

test("[alpha-6] a top-level call of an imported def is legal; a const arrow is not", async () => {
  // `def` emits a hoisted function declaration that the host initializes when
  // the module is linked, so a cycle member may call it before the defining
  // module evaluates. The check used to reject both shapes.
  const hoisted = await compileProject(join(projectRoot, "a.vel"), projectSources({
    "a.vel": 'import {helper} from "./b.vel"\nexport def shared() -> string:\n    return "s"\nprint(helper())\n',
    "b.vel": 'import {shared} from "./a.vel"\nexport def helper() -> string:\n    return "h"\nprint(shared())\n',
  }), {});
  assert.deepEqual(hoisted.failures, []);
  for (const module of hoisted.modules) {
    assert.deepEqual(module.result.diagnostics, [], module.relativePath);
    assert.ok(module.result.code, module.relativePath);
  }

  const deadZone = await compileProject(join(projectRoot, "a.vel"), projectSources({
    "a.vel": 'import {helper} from "./b.vel"\nexport const shared = () => "s"\nprint(helper())\n',
    "b.vel": 'import {shared} from "./a.vel"\nexport def helper() -> string:\n    return "h"\nprint(shared())\n',
  }), {});
  assert.deepEqual(deadZone.failures, []);
  assert.deepEqual(codesOf(deadZone, "b.vel"), ["VEL3019"]);
  assert.deepEqual(codesOf(deadZone, "a.vel"), []);
});

test("[alpha-7] a re-export barrel no longer hides the defining module", async () => {
  // Reads were resolved against the direct import specifier, so a barrel made
  // the check compare the reader against the barrel -- which sits outside the
  // cycle -- and the read passed while the program crashed at run time.
  const project = await compileProject(join(projectRoot, "main.vel"), projectSources({
    "main.vel": 'import {value} from "./barrel.vel"\nexport const forwarded = "f"\nprint(value)\n',
    "barrel.vel": 'export {value} from "./source.vel"\n',
    "source.vel": 'import {forwarded} from "./main.vel"\nexport const value = "v" + forwarded\n',
  }), {});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(codesOf(project, "source.vel"), ["VEL3019"]);
});

test("[alpha-8] a cycle reachable only through a dynamic import is checked", async () => {
  // Dynamic references were dropped from the ordering, so the cycle behind an
  // `await import(...)` had no position at all and every read in it passed.
  const project = await compileProject(join(projectRoot, "main.vel"), projectSources({
    "main.vel": 'async def load():\n    const loaded = await import("./a.vel")\n    return null\n\ndetach load()\n',
    "a.vel": 'import {b} from "./b.vel"\nexport const a = "A"\nprint(b)\n',
    "b.vel": 'import {a} from "./a.vel"\nexport const b = "B" + a\n',
  }), {});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(codesOf(project, "b.vel"), ["VEL3019"]);
  assert.deepEqual(codesOf(project, "a.vel"), []);
  assert.deepEqual(codesOf(project, "main.vel"), []);
});

test("[alpha-9] the language server and velar check reach the same verdict", async () => {
  // The verdict used to depend on the caller's entry list, so the language
  // server -- where every file is an entry -- reported VEL3019 on sources that
  // `velar check` accepted: editor red, build green.
  const cases: Readonly<Record<string, string>>[] = [
    {
      "a.vel": 'import {helper} from "./b.vel"\nexport def shared() -> string:\n    return "s"\nprint(helper())\n',
      "b.vel": 'import {shared} from "./a.vel"\nexport def helper() -> string:\n    return "h"\nprint(shared())\n',
    },
    {
      "a.vel": 'import {fromB} from "./b.vel"\nexport const fromA = "a"\nprint(fromB)\n',
      "b.vel": 'import {fromA} from "./a.vel"\nexport const fromB = "b"\nprint(fromA)\n',
    },
  ];
  for (const modules of cases) {
    const sources = projectSources(modules);
    const entry = join(projectRoot, "a.vel");
    const build = await compileProject(entry, sources, {});
    const editor = await compileProjectEntries([...sources.keys()], entry, sources, {});
    for (const name of Object.keys(modules)) {
      assert.deepEqual(codesOf(editor, name), codesOf(build, name),
        `${name} produced a different verdict in the two drivers`);
    }
  }
});

test("[alpha-10] an acyclic project skips the ordering work entirely", async () => {
  // `entryOrders` was computed unconditionally, once per entry over the whole
  // graph. With the language server's every-file-is-an-entry shape that is
  // quadratic in the module count on a project with no cycle at all.
  const modules: Record<string, string> = { "main.vel": "" };
  const imports: string[] = [];
  const reads: string[] = [];
  for (let index = 0; index < 160; index += 1) {
    modules[`module-${index}.vel`] = `export const value${index} = ${index}\n`;
    imports.push(`import {value${index}} from "./module-${index}.vel"`);
    reads.push(`print(value${index})`);
  }
  modules["main.vel"] = `${imports.join("\n")}\n${reads.join("\n")}\n`;
  const sources = projectSources(modules);
  const started = performance.now();
  const project = await compileProjectEntries([...sources.keys()], join(projectRoot, "main.vel"), sources, {});
  const elapsed = performance.now() - started;
  assert.deepEqual(project.failures, []);
  for (const module of project.modules) assert.deepEqual(module.result.diagnostics, [], module.relativePath);
  // A generous ceiling: the point is that the check is not paying
  // entries x (V+E) work, not that compilation itself is fast.
  assert.ok(elapsed < 30_000, `an acyclic 161-module project took ${elapsed.toFixed(0)}ms with every file as an entry`);
});

test("[alpha-13] cycle diagnostics keep the span order the compile contract promises", async () => {
  const project = await compileProject(join(projectRoot, "reader.vel"), projectSources({
    "reader.vel": 'import {alpha, beta} from "./values.vel"\nexport const seed = "s"\nprint(alpha)\nprint(beta)\nprint(alpha)\n',
    "values.vel": 'import {seed} from "./reader.vel"\nexport const alpha = "a"\nexport const beta = "b"\nprint(seed)\n',
  }), {});
  assert.deepEqual(project.failures, []);
  const diagnostics = moduleOf(project, "values.vel").result.diagnostics;
  assert.equal(diagnostics.length, 1);

  const reader = moduleOf(project, "reader.vel").result.diagnostics;
  assert.deepEqual(reader.map((item) => item.code), []);

  // Three reads on separate lines of the flagged module, still span-sorted.
  const many = await compileProject(join(projectRoot, "values.vel"), projectSources({
    "reader.vel": 'import {alpha, beta} from "./values.vel"\nexport const seed = "s"\nprint(alpha)\nprint(beta)\nprint(alpha + beta)\n',
    "values.vel": 'import {seed} from "./reader.vel"\nexport const alpha = "a"\nexport const beta = "b"\n',
  }), {});
  const flagged = moduleOf(many, "reader.vel").result.diagnostics;
  assert.ok(flagged.length >= 3, flagged.map((item) => item.message).join("\n"));
  for (let index = 1; index < flagged.length; index += 1) {
    assert.ok(flagged[index - 1]!.span.start <= flagged[index]!.span.start, "cycle diagnostics are not span-sorted");
  }
  for (const item of flagged) assert.equal(item.code, "VEL3019");
});

// ---------------------------------------------------------------------------
// beta-2, beta-3, beta-10, beta-12: collection runtime correctness.
// ---------------------------------------------------------------------------

test("[beta-3] Set and Map construction stores raw members and keys", () => {
  // Construction stored whatever the source list held while every read
  // unwrapped its argument, so member identity split and lookups always
  // missed. This is the documented contract in docs/web-api.md.
  const execution = runClean(`
const seeds: List<string> = ["alpha", "beta"]
const members: Set<string> = Set(seeds)
print("alpha" in members)
print(members.size)

const pairs: List<List<string>> = [["key", "value"]]
const lookup: Map<string, string> = Map(pairs)
print(lookup.get("key") ?? "missing")

const copied: Set<string> = Set(members)
print("beta" in copied)
`);
  assert.equal(execution.stdout, "true\n2\nvalue\ntrue\n");
});

test("[beta-12] a List whose length is changed behind the runtime's back is revalidated", () => {
  // The owned fast path skipped density revalidation, so `unsafe` JavaScript
  // could leave `size` and `[i]` disagreeing: size reported the raw length
  // while an index read into the hole threw.
  const result = compile(`
import js {values, truncate} from "./fixture.js"

values.append(4)
print(values.size)
truncate()
try:
    print(values.size)
catch error:
    print(error.message)
try:
    print(values[2])
catch error:
    print(error.message)
`.trimStart(), { analysis: { imports: new Map([
    ["values", { kind: "list", element: { kind: "number" } }],
    ["truncate", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  const boundary = "const values = [1, 2, 3];\nconst truncate = () => { values.length = 8; };\n";
  const execution = executeModule((result.code ?? "").replace(/^import .*?;\n/mu, boundary));
  assert.equal(execution.status, 0, String(execution.stderr));
  // Both refuse for the same reason: neither trusts the stale check, and
  // neither reports a length the other cannot honour.
  const lines = String(execution.stdout).trim().split("\n");
  assert.equal(lines[0], "4");
  assert.match(lines[1] ?? "", /^List size requires a dense VelarScript List$/u, `size did not revalidate: ${lines.join(" | ")}`);
  assert.match(lines[2] ?? "", /^List index requires a dense VelarScript List$/u, `index did not revalidate: ${lines.join(" | ")}`);
});

test("[beta-12] an index accessor installed after validation is still refused", () => {
  const result = compile(`
import js {values, poison} from "./fixture.js"

print(values[0])
poison()
try:
    print(values[1])
catch error:
    print(error.message)
`.trimStart(), { analysis: { imports: new Map([
    ["values", { kind: "list", element: { kind: "number" } }],
    ["poison", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  const boundary = [
    "let reads = 0;",
    "const values = [1, 2];",
    "const poison = () => { Object.defineProperty(values, \"1\", { configurable: true, enumerable: true, get() { reads += 1; return 9; } }); };",
    "",
  ].join("\n");
  const execution = executeModule((result.code ?? "").replace(/^import .*?;\n/mu, boundary));
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout), "1\nList index requires ordinary mutable List data elements\n");
});

test("[gamma-1] a List the compiler did not build is validated before it is trusted", () => {
  // The ownership memo must not weaken the hostile-host guarantee: a foreign
  // array still passes full dense validation on first contact.
  const result = compile(`
import js {values} from "./fixture.js"

try:
    print(values[0])
catch error:
    print(error.message)
`.trimStart(), { analysis: { imports: new Map([["values", { kind: "list", element: { kind: "number" } }]]) } });
  assert.deepEqual(result.diagnostics, []);
  const boundary = [
    "const values = [1, 2];",
    "Object.defineProperty(values, \"extra\", { configurable: true, enumerable: true, writable: true, value: 3 });",
    "",
  ].join("\n");
  const execution = executeModule((result.code ?? "").replace(/^import .*?;\n/mu, boundary));
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout), "List index requires a dense VelarScript List\n");
});

test("[beta-8] insert, pop, and copy keep the List dense and consistent", () => {
  const execution = runClean(`
const values: List<number> = [0, 1, 2, 3, 4]
values.insert(0, 99)
print(values.map(str).join(","))
print(str(values.pop(0)))
print(values.map(str).join(","))
print(str(values.pop()))
print(str(values.size))
print(values.copy().map(str).join(","))
print(values.map(value => value * 2).map(str).join(","))
for value in values:
    print(str(value))
`);
  assert.equal(execution.stdout, "99,0,1,2,3,4\n99\n0,1,2,3,4\n4\n4\n0,1,2,3\n0,2,4,6\n0\n1\n2\n3\n");
});

/**
 * Builds a Web application and runs its production bundle under Node. The
 * reactive runtime only reaches the DOM through `mount`, so an unmounted
 * program exercises state, collections, and `watch` headlessly.
 */
async function runWebProgram(prefix: string, source: string): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "Marathon core hardening" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), source, "utf8");

  const build = spawnSync(process.execPath, [join(root, "packages", "cli", "src", "cli.ts"), "build", directory], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(build.status, 0, String(build.stderr || build.error));
  const assets = await readdir(join(directory, "dist", "assets"));
  const bundle = assets.find((name) => name.startsWith("main-") && name.endsWith(".js"));
  assert.ok(bundle, `Web build produced no main bundle: ${assets.join(", ")}`);
  const execution = spawnSync(process.execPath, [join(directory, "dist", "assets", bundle)], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr || execution.error));
  return String(execution.stdout);
}

test("[beta-2/beta-10] Set.update publishes every member key it adds", { timeout: 180_000 }, async () => {
  // Set.update triggered only the iterate key, so a membership observer --
  // which tracks the member key, exactly as Set.add publishes it -- never
  // re-ran and `"x" in tags` stayed stale in every rendered view. D90 R15(a)
  // put the membership test in the `computed` a watch subject now has to name;
  // the computed reads `in` under tracking, so it is still the member key that
  // has to be published for this observer to re-run.
  const output = await runWebProgram("velar-marathon-set-update-", `
state tags: Set<string> = Set()
computed hasX = "x" in tags
let membershipRuns = 0
let observed = false

watch hasX as current, previous:
    membershipRuns += 1
    observed = current

@main:
    await tick()
    const baseline = membershipRuns

    tags.update(["w", "x", "y"])
    await tick()
    print(f"afterUpdate={str(membershipRuns - baseline)},{str(observed)},{str("x" in tags)}")

    tags.remove("x")
    await tick()
    print(f"afterRemove={str(membershipRuns - baseline)},{str(observed)},{str("x" in tags)}")

    tags.add("x")
    await tick()
    print(f"afterAdd={str(membershipRuns - baseline)},{str(observed)},{str("x" in tags)}")
`.trimStart());

  assert.match(output, /afterUpdate=1,true,true/u, output);
  assert.match(output, /afterRemove=2,false,false/u, output);
  assert.match(output, /afterAdd=3,true,true/u, output);
});
