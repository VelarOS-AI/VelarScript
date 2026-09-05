import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

/**
 * D114 S3 (D35's open sub-decision): `velar/collections` methodized. These are
 * the List members that replaced it — the ten that had no method equivalent,
 * plus the three spellings the selector family was missing (`min(by=)`,
 * `max(by=)`, and a descending order). Every one of them is a Core checked
 * value method: compiler-owned, receiver-evaluated-once, first-class bindable,
 * reading one checked shallow snapshot, and bounded by the same 1,000,000-item
 * ceiling as `map`.
 *
 * `tests/retired-collections-module.test.ts` covers the other half — the
 * diagnostics and mechanical rewrites the retired module earns.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  const directory = await makeTemporaryDirectory("velar-list-pipeline-");
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
    group: string
    rank: number

const rows: List<Row> = [
    {id: "a", group: "x", rank: 2},
    {id: "b", group: "y", rank: 1},
    {id: "c", group: "x", rank: 2},
]
`.trimStart();

// ---------------------------------------------------------------------------
// Static contracts
// ---------------------------------------------------------------------------

test("[D114 S3] every pipeline member answers the collection its contract names", () => {
  const source = `${ROWS}const values: List<number> = [3, 1, 2, 3]
const nested: List<List<number>> = [[1, 2], [3]]
const sparse: List<number?> = [1, null, 3]

const uniqueValues = values.unique()
const compacted = sparse.compact()
const flattened = nested.flatten()
const chunked = values.chunk(2)
const split = values.partition(value => value > 2)
const grouped = rows.groupBy(row => row.group)
const keyed = rows.keyBy(row => row.id)
const counted = rows.countBy(row => row.group)
const zipped = values.zip(rows)
const repeated = values.repeat(2)
const smallest = rows.min(by=row => row.rank)
const ranked = rows.sorted(by=row => row.rank, descending=true)
`;
  assert.equal(typeOf(source, "uniqueValues"), "List<number>");
  assert.equal(typeOf(source, "compacted"), "List<number>");
  assert.equal(typeOf(source, "flattened"), "List<number>");
  assert.equal(typeOf(source, "chunked"), "List<List<number>>");
  assert.equal(typeOf(source, "split"), "{ matches: List<number>, rest: List<number> }");
  assert.equal(typeOf(source, "grouped"), "Map<string, List<Row>>");
  assert.equal(typeOf(source, "keyed"), "Map<string, Row>");
  assert.equal(typeOf(source, "counted"), "Map<string, number>");
  assert.equal(typeOf(source, "zipped"), "List<{ first: number, second: Row }>");
  assert.equal(typeOf(source, "repeated"), "List<number>");
  assert.equal(typeOf(source, "smallest"), "Row?");
  assert.equal(typeOf(source, "ranked"), "List<Row>");
});

test("[D114 S3] compact narrows the optional arm and refuses a List with nothing to remove", () => {
  assert.equal(
    typeOf("const sparse: List<string?> = [\"a\", null]\nconst present = sparse.compact()\n", "present"),
    "List<string>",
  );
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst same = values.compact()\n"), [
    "List<number>.compact() has nothing to remove; the element type has no null arm, so drop the call",
  ]);
});

test("[C-I1] the refusal on List<null> says which constant it is", () => {
  // The refusal is right — the call is a constant either way, and a silently
  // constant operation is a logic bug — but the reason it gave was false of
  // the one List it was reported on: `List<null>`'s element type is *nothing
  // but* the null arm. It removes every element, and what is left has no
  // element type at all.
  assert.deepEqual(messagesOf("const empties: List<null> = [null]\nconst gone = empties.compact()\n"), [
    "List<null>.compact() removes every element; the element type is only null, so the result would have no element type — drop the call",
  ]);
});

test("[D114 S3] flatten removes exactly one level and names the rule for anything else", () => {
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst flat = values.flatten()\n"), [
    "List.flatten removes exactly one List level, so it requires List<List<T>>, received List<number>",
  ]);
  assert.equal(
    typeOf("const nested: List<List<List<number>>> = [[[1]]]\nconst once = nested.flatten()\n", "once"),
    "List<List<number>>",
  );
});

test("[D114 S3] chunk, repeat, and zip check their arguments statically", () => {
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst parts = values.chunk(\"2\")\n"), [
    "Cannot assign string to number",
  ]);
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst many = values.repeat(true)\n"), [
    "Cannot assign bool to number",
  ]);
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst paired = values.zip(\"ab\")\n"), [
    "List.zip requires a List partner, received string",
  ]);
});

test("[D114 S3] descending is a named flag, and a comparator already states the order", () => {
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst down = values.sorted((left, right) => left - right, descending=true)\n"), [
    "sorted(descending=) applies to the default order or a 'by=selector'; the comparator already states the order",
  ]);
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst down = values.sorted(true)\n"), [
    "Cannot assign bool to (number, number) -> number",
  ]);
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst down = values.sorted(descending=1)\n"), [
    "Cannot assign number to bool",
  ]);
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst down = values.sorted(descending=true)\n"), []);
});

test("[D114 S3] a keyed min/max obeys the one ordering rule, and its key is named", () => {
  assert.deepEqual(messagesOf(`type Row:
    value: bool

const rows: List<Row> = []
const lowest = rows.min(by=row => row.value)
`), ["min(by=) key must return only string or only number, received bool"]);
  assert.deepEqual(messagesOf(`type Row:
    value: number

const rows: List<Row> = []
const lowest = rows.min(by=row => row)
`), ["min(by=) key must return only string or only number, received Row"]);
  assert.deepEqual(messagesOf(`enum Priority:
    low
    high

type Row:
    priority: Priority

const rows: List<Row> = []
const highest = rows.max(by=row => row.priority)
`), [
    "max(by=) key must return only string or only number, received Priority"
      + "; an enum carries no runtime order, so state the order explicitly with sorted(by=rank) or a string-backed enum whose values encode it",
  ]);
  assert.deepEqual(messagesOf("const values: List<number> = [1]\nconst lowest = values.min(value => value)\n"), [
    "Use 'min(by=selector)'; the key-function alternative is named",
  ]);
  // D41 item 61: a `Comparable`-bounded key is accepted by the one ordering
  // authority, exactly as `sorted(by=)` accepts it.
  assert.deepEqual(messagesOf(`def lowest<T: Comparable>(values: List<T>) -> T?:
    return values.min(by=value => value)
`), []);
});

test("[D114 S3] a groupBy key obeys the Map key rule rather than the ordering rule", () => {
  // A bool is not ordered, but it is a perfectly good Map key.
  assert.equal(
    typeOf("const values: List<number> = [1, 2]\nconst byParity = values.groupBy(value => value > 1)\n", "byParity"),
    "Map<bool, List<number>>",
  );
  assert.deepEqual(messagesOf(`enum Kind:
    text = "text"

const values: List<number> = [1]
const mixed = values.groupBy(value => value > 0 ? Kind.text : "raw")
`), [
    "A Map key type of Kind.text | string mixes Kind with string, and an enum member is a bare string at runtime,"
      + " so nominally distinct keys would collapse into one slot; keep the domains in separate collections,"
      + " or store wire strings deliberately with str(member)",
  ]);
});

test("[D114 S3] the pipeline members are available through a read-only List view", async () => {
  assert.equal(await run(`${ROWS}
def summarize(source: readonly List<Row>, values: readonly List<number>) -> number:
    return source.groupBy(row => row.group).size
        + values.chunk(2).size
        + values.unique().size
        + values.zip(source).size
        + values.repeat(2).size
        + values.partition(value => value > 1).rest.size
        + source.sorted(by=row => row.rank, descending=true).size
        + (source.min(by=row => row.rank) == null ? 0 : 1)

print(str(summarize(rows, [1, 2, 3])))
`), "21\n");
});

test("[D114 S3] a discarded pipeline result is a compile error", () => {
  for (const [call, member] of [
    ["values.unique()", "unique"],
    ["values.compact()", "compact"],
    ["nested.flatten()", "flatten"],
    ["values.chunk(2)", "chunk"],
    ["values.partition(value => value > 1)", "partition"],
    ["values.groupBy(value => value)", "groupBy"],
    ["values.keyBy(value => value)", "keyBy"],
    ["values.countBy(value => value)", "countBy"],
    ["values.zip(values)", "zip"],
    ["values.repeat(2)", "repeat"],
    ["values.min(by=value => value)", "min"],
  ] as const) {
    const source = `const values: List<number?> = [1]\nconst nested: List<List<number>> = [[1]]\n${call}\n`;
    assert.ok(
      compile(source).diagnostics.some((item) => item.code === "VEL4029"
        && item.message === `'${member}' does not modify its receiver, so the result is discarded; keep the returned value or remove the call`),
      `${call}: ${messagesOf(source).join(" | ")}`,
    );
  }
});

test("[D114 S3] every pipeline member accepts its published argument names", async () => {
  assert.equal(await run(`${ROWS}
const values: List<number> = [1, 2, 3]
print(str(values.chunk(size=2).size))
print(str(values.repeat(count=2).size))
print(str(values.partition(test=value => value > 1).matches.size))
print(str(values.zip(other=rows).size))
print(str(rows.groupBy(key=row => row.group).size))
print(str(rows.keyBy(key=row => row.id).size))
print(str(rows.countBy(key=row => row.group).size))
print(str(rows.min(by=row => row.rank)?.id ?? "none"))
print(str(rows.max(by=row => row.rank)?.id ?? "none"))
print(rows.sorted(by=row => row.rank, descending=true).map(row => row.id).join(""))
`), "2\n6\n2\n3\n2\n3\n2\nb\na\nacb\n");
});

test("[D114 S3] a pipeline member binds as a first-class value with its receiver captured once", async () => {
  assert.equal(await run(`
let receivers = 0

def source() -> List<number>:
    receivers += 1
    return [1, 2, 2]

const chunker = source().chunk
const uniquely = [3, 3, 4].unique
const repeater = [7].repeat
print(str(chunker(2).size))
print(str(chunker(1).size))
print(str(uniquely().size))
print(str(repeater(3).size))
print(str(receivers))
`), "2\n3\n2\n3\n1\n");
});

// ---------------------------------------------------------------------------
// Execution semantics
// ---------------------------------------------------------------------------

test("[D114 S3] the pipeline members answer what their contracts promise", async () => {
  assert.equal(await run(`${ROWS}
const values: List<number> = [3, 1, 2, 3]
const nested: List<List<number>> = [[1, 2], [3]]
const sparse: List<number?> = [1, null, 3]
const words: List<string> = ["b", "a", "b"]

print(values.unique().map(value => str(value)).join(","))
print(sparse.compact().map(value => str(value)).join(","))
print(nested.flatten().map(value => str(value)).join(","))
print(values.chunk(3).map(part => str(part.size)).join(","))
const split = values.partition(value => value > 2)
print(f"{split.matches.size}:{split.rest.size}")
print(str(words.keyBy(word => word).size))
print(str(values.zip(words).size))
print([1, 2].repeat(2).map(value => str(value)).join(""))
print(str([1, 2].repeat(0).size))
print(str(rows.countBy(row => row.group).get("x") ?? 0))
const grouped = rows.groupBy(row => row.group).get("x") ?? []
print(grouped.map(row => row.id).join(""))
`), [
    "3,1,2",
    "1,3",
    "1,2,3",
    "3,1",
    "2:2",
    "2",
    "3",
    "1212",
    "0",
    "2",
    "ac",
    "",
  ].join("\n"));
});

test("[D114 S3] a descending sort reverses the comparison, so equal keys keep their input order", async () => {
  assert.equal(await run(`
type Row:
    id: string
    rank: number

const rows: List<Row> = [
    {id: "a", rank: 1},
    {id: "b", rank: 2},
    {id: "c", rank: 1},
    {id: "d", rank: 2},
]
print(rows.sorted(by=row => row.rank).map(row => row.id).join(""))
print(rows.sorted(by=row => row.rank, descending=true).map(row => row.id).join(""))
print([3, 1, 2].sorted(descending=true).map(value => str(value)).join(""))
print([3, 1, 2].sorted(descending=false).map(value => str(value)).join(""))
`), "acbd\nbdac\n321\n123\n");
});

test("[D114 S3] a callback that mutates the source cannot change the current operation", async () => {
  assert.equal(await run(`
let source: List<number> = [1, 2, 3]

def growing(value: number) -> bool:
    source.append(9)
    return value > 1

const split = source.partition(growing)
print(f"{split.matches.size}:{split.rest.size}:{source.size}")

let keys: List<number> = [1, 2]

def keying(value: number) -> number:
    keys.append(7)
    return value

print(f"{keys.groupBy(keying).size}:{keys.size}")
`), "2:1:6\n2:4\n");
});

test("[D114 S3] a pipeline result stays inside the one-million-item ceiling", async () => {
  assert.equal(await run(`
try:
    print(str([1, 2].repeat(1000000).size))
catch error:
    print(error.message)
try:
    print(str([1].chunk(0).size))
catch error:
    print(error.message)
try:
    print(str([1].repeat(-1).size))
catch error:
    print(error.message)
`), [
    "A List cannot exceed 1000000 items",
    "List.chunk size requires a positive integer",
    "List.repeat count requires a non-negative integer",
    "",
  ].join("\n"));
});

// ---------------------------------------------------------------------------
// Web: the pipeline members register the dependencies map/filter register
// ---------------------------------------------------------------------------

/**
 * Builds a Web application and runs its production bundle under Node. The
 * reactive runtime only reaches the DOM through `mount`, so an unmounted
 * program exercises state and collections headlessly.
 */
async function runWebProgram(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-list-pipeline-web-");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "List pipeline members" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), source.trimStart(), "utf8");
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

test("[D114 S3] a computed over a pipeline member re-runs when the source List grows", { timeout: 180_000 }, async () => {
  // The pipeline members read their snapshot through the same tracked
  // collection reads `map` and `filter` use, so a `computed` over one of them
  // registers the iterate dependency and `append` publishes it.
  const output = await runWebProgram(`
state items: List<number> = [1, 2]
computed groups = items.groupBy(value => value > 1).size
computed parts = items.chunk(2).size
computed distinct = items.unique().size

@main:
    await tick()
    print(f"before={str(groups)},{str(parts)},{str(distinct)}")
    items.append(3)
    await tick()
    print(f"after={str(groups)},{str(parts)},{str(distinct)}")
`);
  assert.equal(output.trim(), ["before=2,1,2", "after=2,2,3"].join("\n"));
});
