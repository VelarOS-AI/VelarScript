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
 * D114 S3b items A and B: one rule for what a List callback receives, and the
 * first-class binding the charter promises for the members that take one.
 *
 * Item A completes D113's boundary — `sorted(by=)` was the last element
 * callback that did not carry the snapshot index, so `rows.min(by=(r, i) => …)`
 * compiled while `rows.sorted(by=(r, i) => …)` did not. Every callback that
 * receives an element now receives `(value, index)`, and a comparator, which
 * weighs two elements rather than receiving one, keeps its own `(left, right)`
 * shape.
 *
 * Item B is the assignability rule underneath: a function that declares fewer
 * parameters than its contract passes satisfies it, because the arguments it
 * did not ask for are passed and ignored. Without it a bound `const keep =
 * values.filter` and an optional `values?.map(…)` had no callback arity that
 * compiled, while the identical direct call did.
 */

after(async () => {
  await removeTemporaryDirectories();
});

function messagesOf(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

function typeOf(source: string, binding: string): string | null | undefined {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => item.message), []);
  return result.semanticIndex.symbols.find((symbol) => symbol.name === binding)?.type;
}

/** Compiles one module and runs it against the real standard module sources. */
async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-list-callbacks-");
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

const ROWS = `
type Row:
    id: string
    rank: number

const rows: List<Row> = [
    {id: "a", rank: 3},
    {id: "b", rank: 1},
    {id: "c", rank: 2},
]
`.trimStart();

// ---------------------------------------------------------------------------
// Item A — sorted(by=) is an element callback like every other
// ---------------------------------------------------------------------------

test("[D114 S3b] sorted(by=) receives the value and the snapshot index", () => {
  const source = `${ROWS}
def rankOf(row: Row, index: number) -> number:
    return row.rank * 10 + index

const indexed = rows.sorted(by=(row, index) => row.rank * 10 + index)
const valueOnly = rows.sorted(by=row => row.rank)
const named = rows.sorted(by=rankOf)
const directed = rows.sorted(by=(row, index) => index, descending=true)
`;
  assert.equal(typeOf(source, "indexed"), "List<Row>");
  assert.equal(typeOf(source, "valueOnly"), "List<Row>");
  assert.equal(typeOf(source, "named"), "List<Row>");
  assert.equal(typeOf(source, "directed"), "List<Row>");
});

test("[D114 S3b] a two-parameter sorted(by=) key still has to be ordered", () => {
  assert.deepEqual(messagesOf(`${ROWS}
const invalid = rows.sorted(by=(row, index) => index > 1)
`), ["sorted(by=) key must return only string or only number, received bool"]);
});

test("[D114 S3b] a sorted(by=) index is the snapshot position, not the sorted one", async () => {
  assert.equal(await run(`
const values: List<number> = [30, 10, 20]
const seen: List<string> = []

def note(value: number, index: number) -> number:
    seen.append(f"{index}={value}")
    return value

print(values.sorted(by=(value, index) => note(value, index)).map(value => str(value)).join(","))
print(seen.join(" "))
print(values.sorted(by=(value, index) => index, descending=true).map(value => str(value)).join(","))
`), [
    "10,20,30",
    "0=30 1=10 2=20",
    "20,10,30",
    "",
  ].join("\n"));
});

test("[D114 S3b] the sorted comparator weighs two elements and is not an element callback", async () => {
  assert.equal(typeOf(`${ROWS}
const ordered = rows.sorted((left, right) => left.rank - right.rank)
`, "ordered"), "List<Row>");
  assert.deepEqual(messagesOf(`${ROWS}
const invalid = rows.sorted((left, right) => left.rank - right)
`), ["Cannot assign Row to number"]);
  assert.equal(await run(`
${ROWS}
print(rows.sorted((left, right) => left.rank - right.rank).map(row => row.id).join(""))
`), "bca\n");
});

// ---------------------------------------------------------------------------
// Item B — the contract an author reads is the contract assignability judges
// ---------------------------------------------------------------------------

const BOUND_MEMBERS = `
const values: List<number> = [3, 1, 2]

const keep = values.filter
const project = values.map
const spread = values.flatMap
const first = values.find
const any = values.some
const all = values.every
const split = values.partition
const group = values.groupBy
const key = values.keyBy
const count = values.countBy
const smallest = values.min
const largest = values.max
const order = values.sorted
`.trimStart();

test("[D114 S3b] a bound callback member accepts a one-parameter callback", () => {
  assert.deepEqual(messagesOf(`${BOUND_MEMBERS}
print(str(keep(value => value > 1).size))
print(str(project(value => value).size))
print(str(spread(value => [value]).size))
print(str(first(value => value > 1) ?? 0))
print(str(any(value => value > 1)))
print(str(all(value => value > 1)))
print(str(split(value => value > 1).matches.size))
print(str(group(value => value).size))
print(str(key(value => value).size))
print(str(count(value => value).size))
print(str(smallest(by=value => value) ?? 0))
print(str(largest(by=value => value) ?? 0))
print(str(order(by=value => value).size))
`), []);
});

test("[D114 S3b] a bound callback member accepts a two-parameter callback", () => {
  assert.deepEqual(messagesOf(`${BOUND_MEMBERS}
print(str(keep((value, index) => index > 1).size))
print(str(project((value, index) => value + index).size))
print(str(spread((value, index) => [value, index]).size))
print(str(first((value, index) => index > 1) ?? 0))
print(str(any((value, index) => index > 1)))
print(str(all((value, index) => index > 1)))
print(str(split((value, index) => index > 1).matches.size))
print(str(group((value, index) => index).size))
print(str(key((value, index) => index).size))
print(str(count((value, index) => index).size))
print(str(smallest(by=(value, index) => index) ?? 0))
print(str(largest(by=(value, index) => index) ?? 0))
print(str(order(by=(value, index) => index).size))
`), []);
});

test("[D114 S3b] an optional receiver takes the same callbacks as a present one", () => {
  const source = `
def go(values: List<number>?):
    print(str(values?.filter(value => value > 1)?.size))
    print(str(values?.map(value => value)?.size))
    print(str(values?.flatMap((value, index) => [value, index])?.size))
    print(str(values?.find((value, index) => index > 1)))
    print(str(values?.some(value => value > 1)))
    print(str(values?.every((value, index) => index > 1)))
    print(str(values?.partition(value => value > 1)?.matches?.size))
    print(str(values?.groupBy((value, index) => index)?.size))
    print(str(values?.keyBy(value => value)?.size))
    print(str(values?.countBy((value, index) => index)?.size))
    print(str(values?.min(by=(value, index) => index)))
    print(str(values?.max(by=value => value)))
    print(str(values?.sorted(by=(value, index) => index)?.size))
`;
  assert.deepEqual(messagesOf(source), []);
});

test("[D114 S3b] the direct call is unchanged, and a bound call answers the same values", async () => {
  assert.deepEqual(messagesOf(`
const values: List<number> = [3, 1, 2]
print(str(values.filter(value => value > 1).size))
print(str(values.map((value, index) => value + index).size))
print(str(values.sorted(by=(value, index) => index).size))
`), []);
  assert.equal(await run(`
const values: List<number> = [3, 1, 2]
const keep = values.filter
const order = values.sorted

print(f"{keep(value => value > 1).size} {values.filter(value => value > 1).size}")
print(f"{keep((value, index) => index > 0).size} {values.filter((value, index) => index > 0).size}")
print(order(by=(value, index) => index).map(value => str(value)).join(""))
print(values.sorted(by=(value, index) => index).map(value => str(value)).join(""))
`), [
    "2 2",
    "2 2",
    "312",
    "312",
    "",
  ].join("\n"));
});

test("[D114 S3b] a callback may not require an argument its contract never passes", () => {
  assert.deepEqual(messagesOf(`
def take(check: (a: number) -> bool) -> bool:
    return check(1)

def wider(check: (a: number, b: string) -> bool) -> bool:
    return take(check)
`), ["Cannot assign (a: number, b: string) -> bool to (a: number) -> bool"]);
  assert.deepEqual(messagesOf(`
const values: List<number> = [3, 1, 2]
const keep = values.filter
print(str(keep((value, index, extra) => value > 1).size))
`), ["Cannot assign (value: number, index: number, extra: unknown) -> bool to (number, number) -> bool"]);
});

test("[D114 S3b] a shorter function satisfies a contract with an omissible parameter", async () => {
  assert.deepEqual(messagesOf(`
const identity: (a: number, b?: number) -> number = a => a
const widened: (a: number, b: number) -> number = a => a
print(str(identity(1) + widened(2, 3)))
`), []);
  assert.equal(await run(`
const identity: (a: number, b?: number) -> number = a => a
print(str(identity(1)))
print(str(identity(1, 2)))
`), "1\n1\n");
});
