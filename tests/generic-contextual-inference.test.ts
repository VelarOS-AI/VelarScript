import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectExpressionAt } from "../packages/cli/src/project-semantic.ts";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * D114 item ① (the ruling D77 rule 194 left open): a type parameter the
 * arguments leave unsolved is solved from the position the call is written in,
 * against the same table of contextual positions charter section 8 uses to
 * settle an empty `[]`, `Set()`, or `Map()`.
 */

const empty = `
def empty<T>() -> List<T>:
    return []
`.trimStart();

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function webMessages(source: string): readonly string[] {
  return compile(source.trimStart(), { path: "probe.vel", extensions: [webCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("[D114 ①] the four Core contextual positions solve a call's remaining type parameters", () => {
  assert.deepEqual(messages(`${empty}
const names: List<string> = empty()
print(f"{names.size}")
`), []);

  assert.deepEqual(messages(`${empty}
def use(values: List<string>) -> number:
    return values.size

print(f"{use(empty())}")
print(f"{use(values=empty())}")
`), []);

  assert.deepEqual(messages(`${empty}
def widest(...groups: List<List<string>>) -> number:
    return groups.size

print(f"{widest(empty(), empty())}")
`), []);

  assert.deepEqual(messages(`${empty}
def names() -> List<string>:
    return empty()

async def laterNames() -> List<string>:
    return empty()

print(f"{names().size}")
print(f"{(await laterNames()).size}")
`), []);

  assert.deepEqual(messages(`${empty}
type Holder:
    items: List<string>

const holder: Holder = {items: empty()}
print(f"{holder.items.size}")
`), []);
});

test("[D114 ①] Web state, resource, and JSX attribute positions solve them too", () => {
  assert.deepEqual(webMessages(`${empty}
state moduleNames: List<string> = empty()

component Panel:
    state names: List<string> = empty()
    return <p>{names.size + moduleNames.size}</p>
`), []);

  assert.deepEqual(webMessages(`
async def loadEmpty<T>() -> List<T>:
    return []

component Panel:
    resource rows: List<string> = loadEmpty()
    return <p>{rows.value?.size ?? 0}</p>
`), []);

  assert.deepEqual(webMessages(`${empty}
component Row(items: List<string>):
    return <li>{items.size}</li>

component Panel:
    return <Row items={empty()} />
`), []);
});

test("[D114 ①] seeding walks the shapes a type argument can stand in", () => {
  assert.deepEqual(messages(`
def emptyMap<K, V>() -> Map<K, V>:
    return Map()

const groups: Map<string, List<number>> = emptyMap()
print(f"{groups.size}")
`), []);

  assert.deepEqual(messages(`
def emptySet<T>() -> Set<T>:
    return Set()

def emptyRecord<T>() -> Record<T>:
    return {}

const tags: Set<string> = emptySet()
const fields: Record<number> = emptyRecord()
print(f"{tags.size + fields.size}")
`), []);

  // An async result is a `Promise<T?>` against a `Promise<string?>` position:
  // the promise pairs, then the optional inside it does.
  assert.deepEqual(messages(`
async def blank<T>(count: number) -> T?:
    return null

const later: Promise<string?> = blank(1)
print(f"{await later ?? "none"}")
`), []);

  // `U` is the argument's; `T` stands only in the result's parameter list, and
  // the annotated function type is what says it is `number`.
  assert.deepEqual(messages(`
def constant<T, U>(value: U) -> (T) -> U:
    return input => value

const render: (number) -> string = constant("x")
print(render(1))
`), []);

  assert.deepEqual(messages(`
def constant<T, U>(value: U) -> (T) -> U:
    return input => value

const render: (number) -> string = constant("x")
print(render("a"))
`), ["VEL4001 Cannot assign string to number"]);
});

test("[D114 ①] a generic record application seeds through its own declaration, alias included", () => {
  const box = `
type Box<T>:
    value: T

def blank<T>() -> Box<T>?:
    return null
`.trimStart();

  assert.deepEqual(messages(`${box}
const box: Box<string>? = blank()
print(f"{box?.value ?? "none"}")
`), []);

  assert.deepEqual(messages(`${box}
type StringBox = Box<string>

const box: StringBox? = blank()
print(f"{box?.value ?? "none"}")
`), []);

  // A different generic declaration is a different shape, so nothing is seeded.
  assert.deepEqual(messages(`${box}
type Crate<T>:
    value: T

const crate: Crate<string>? = blank()
`), ["VEL4001 Cannot assign Box<unknown>? to Crate<string>?"]);
});

test("[D114 ①] an optional result pairs with an optional position and with a bare one", () => {
  assert.deepEqual(messages(`
def blank<T>() -> T?:
    return null

const value: string? = blank()
const fallback: string = blank() ?? "x"
print(f"{value ?? fallback}")
`), []);

  // Section 8 reads an optional annotation through to the collection it holds;
  // a type argument is read through the same way.
  assert.deepEqual(messages(`${empty}
const names: List<string>? = empty()
print(f"{names != null}")
`), []);
});

test("[D114 ①] aliases are transparent and a readonly view belongs to the position", () => {
  assert.deepEqual(messages(`${empty}
type Names = List<string>

const names: Names = empty()
const viewed: readonly List<string> = empty()
print(f"{names.size + viewed.size}")
`), []);
});

test("[D114 ①] a bound applies to a seeded solution and names the position as its solver", () => {
  assert.deepEqual(messages(`
type Row:
    id: string

def ordered<T: Comparable>() -> List<T>:
    return []

const rows: List<Row> = ordered()
`), [
    "VEL4031 Type parameter 'T' is bound by Comparable but the expected type solves it to Row;"
    + " a Comparable parameter accepts the types with a runtime order — numbers and strings",
  ]);

  assert.deepEqual(messages(`
def ordered<T: Comparable>() -> List<T>:
    return []

const values: List<number> = ordered()
print(f"{values.size}")
`), []);
});

test("[D114 ①] an argument-solved parameter is never overridden by the position", () => {
  assert.deepEqual(messages(`
type Box<T>:
    value: T

def wrap<T>(value: T) -> Box<T>:
    return {value}

const box: Box<string> = wrap(1)
`), ["VEL4001 Cannot assign Box<number> to Box<string>"]);

  assert.deepEqual(messages(`
def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)

const flags: List<string> = mapValues(["a", ""], value => value != "")
`), ["VEL4001 Cannot assign List<bool> to List<string>"]);

  // A parameter an `unknown` argument reached keeps the report it has today,
  // including the bound violation that names the argument as its cause.
  assert.deepEqual(messages(`
def label<T: Text>(value: T) -> List<T>:
    return [value]

def go(source: unknown):
    const names: List<string> = label(source)
    print(f"{names.size}")
`), [
    "VEL4001 Cannot assign List<unknown> to List<string>",
    "VEL4031 Type parameter 'T' is bound by Text, so this argument cannot be unknown;"
    + " a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  ]);
});

test("[D114 ①] a position that says nothing still leaves the parameter unknown", () => {
  const unchanged = ["VEL4001 Cannot assign List<unknown> to List<string>"];

  assert.deepEqual(messages(`${empty}
const names = empty()
const typed: List<string> = names
`), unchanged);

  assert.deepEqual(messages(`${empty}
def names():
    return empty()

const typed: List<string> = names()
`), unchanged);

  assert.deepEqual(messages(`${empty}
const holder = {items: empty()}
const typed: List<string> = holder.items
`), unchanged);

  // A shape the expected type cannot match falls through to `unknown` as well.
  assert.deepEqual(messages(`${empty}
def use(values: Set<string>) -> number:
    return values.size

print(f"{use(empty())}")
`), ["VEL4001 Cannot assign List<unknown> to Set<string>; Set(values) builds a Set from a List"]);

  assert.deepEqual(messages(`${empty}
const value: List<string> | number = empty()
`), ["VEL4001 Cannot assign List<unknown> to List<string> | number"]);
});

test("[D114 ①] the enclosing declaration's own type parameters seed a nested call", () => {
  assert.deepEqual(messages(`${empty}
def collect<U>(value: U) -> List<U>:
    const values: List<U> = empty()
    values.append(value)
    return values

def onlyEmpty<U>() -> List<U>:
    return empty()

print(f"{collect("a").size + onlyEmpty<string>().size}")
`), ["VEL2031 Type arguments are inferred at each call site; write 'onlyEmpty(...)' without '<...>'"]);

  assert.deepEqual(messages(`${empty}
def collect<U>(value: U) -> List<U>:
    const values: List<U> = empty()
    values.append(value)
    return values

print(f"{collect("a").size}")
`), []);
});

test("[D114 ①] seeding crosses module boundaries through every import spelling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-generic-contextual-"));
  try {
    const utilitiesPath = join(directory, "utilities.vel");
    const mainPath = join(directory, "main.vel");
    const mainSource = `
import {empty} from "./utilities.vel"
import {empty as blank} from "./utilities.vel"
import * as utilities from "./utilities.vel"

const named: List<string> = empty()
const renamed: List<number> = blank()
const namespaced: List<bool> = utilities.empty()

def use(values: List<string>) -> number:
    return values.size

print(f"{named.size + renamed.size + namespaced.size + use(utilities.empty())}")
print(f"{named.size}")
`.trimStart();
    await writeFile(utilitiesPath, `
export def empty<T>() -> List<T>:
    return []
`.trimStart(), "utf8");
    await writeFile(mainPath, mainSource, "utf8");

    const project = await compileProject(mainPath, new Map(), {});
    assert.deepEqual(project.failures, []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
    const main = project.modules.find((module) => module.inputPath === mainPath);
    const typeOf = (name: string): string | null | undefined =>
      main?.result.semanticIndex.symbols.find((item) => item.name === name)?.type;
    assert.equal(typeOf("named"), "List<string>");
    assert.equal(typeOf("renamed"), "List<number>");
    assert.equal(typeOf("namespaced"), "List<bool>");

    // The editor reads the seeded type through the member surface it opens.
    const memberOffset = mainSource.indexOf("named.size") + "named.si".length;
    const member = projectExpressionAt(project, mainPath, memberOffset);
    assert.equal(member?.ownerType, "List<string>");
    assert.equal(member?.type, "number");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D114 ①] a seeded type argument is erased, so the emitted module is unchanged", () => {
  // Each pair is the same program written twice: once with the position
  // solving the type argument, once with the result annotated outright. Key,
  // value and element types reach the lowering, so all three shapes are asked.
  const pairs: readonly (readonly [string, string])[] = [
    [`${empty}
const names: List<string> = empty()
names.append("a")
print(names.join(","))
`, `
def empty() -> List<string>:
    return []

const names: List<string> = empty()
names.append("a")
print(names.join(","))
`],
    [`
def emptyMap<K, V>() -> Map<K, V>:
    return Map()

const scores: Map<string, number> = emptyMap()
scores.set("a", 1)
print(f"{scores.get("a") ?? 0}")
`, `
def emptyMap() -> Map<string, number>:
    return Map()

const scores: Map<string, number> = emptyMap()
scores.set("a", 1)
print(f"{scores.get("a") ?? 0}")
`],
    [`
type Box<T>:
    value: T

def blank<T>(seed: number) -> Box<T>?:
    return null

const box: Box<string>? = blank(1)
print(box?.value ?? "none")
`, `
type Box<T>:
    value: T

def blank(seed: number) -> Box<string>?:
    return null

const box: Box<string>? = blank(1)
print(box?.value ?? "none")
`],
  ];
  for (const [seededSource, annotatedSource] of pairs) {
    const seeded = compile(seededSource.trimStart());
    const annotated = compile(annotatedSource.trimStart());
    assert.deepEqual(seeded.diagnostics, []);
    assert.deepEqual(annotated.diagnostics, []);
    assert.equal(seeded.code, annotated.code);
  }
});

test("[D114 ①] a seeded program runs, and its source round-trips through the formatter", () => {
  const source = `${empty}
type Box<T>:
    value: T

def wrap<T>(value: T) -> Box<T>:
    return {value}

const names: List<string> = empty()
names.append("ada")
names.append("lin")

const boxed: Box<string> = wrap(names.join("+"))
const counts: Map<string, List<number>> = Map()
counts.getOrSet("sizes", []).append(names.size)

print(names.join(","))
print(boxed.value)
print(f"{counts.get("sizes")?.size ?? 0}")
`;
  assert.equal(run(source), "ada,lin\nada+lin\n1\n");
  // The seeded call is ordinary syntax, so formatting it settles and running
  // the formatted source answers the same thing.
  const formatted = formatSource(source.trimStart());
  assert.equal(formatSource(formatted), formatted);
  assert.equal(run(formatted), "ada,lin\nada+lin\n1\n");
});

// ---------------------------------------------------------------------------
// D114 0.28.0 A-I1: both operands of `??` are the position
// ---------------------------------------------------------------------------

test("[A-I1] the subject of '??' receives the expected type its fallback already did", () => {
  // The audit's own message named the split: `Cannot assign List<unknown> |
  // List<string> to List<string>` — one `??`, under one annotation, settling
  // the empty literal on the right and leaving the generic call on the left at
  // `List<unknown>`. Both arms of a ternary already received it, and ruling ①
  // is that the propagation set is one set.
  assert.deepEqual(messages(`${empty}
def maybeEmpty<T>() -> List<T>?:
    return null

def maybeSet<T>() -> Set<T>?:
    return null

def go():
    const declared: List<string>? = null
    const settled: List<string> = declared ?? []
    const seeded: List<string> = maybeEmpty() ?? []
    const both: List<string> = maybeEmpty() ?? empty()
    const arms: List<string> = true ? empty() : empty()
    const caught: List<string> = (try empty()) ?? []
    const optional: List<string>? = maybeEmpty() ?? empty()
    const set: Set<string> = maybeSet() ?? Set()
    print(str(settled.size + seeded.size + both.size + arms.size + caught.size + set.size))
    print(str(optional?.size))
`), []);
});

test("[A-I1] a subject with nothing to solve is unaffected, and the presence test still holds", () => {
  // The subject is offered the *optional* spelling of the expected type, which
  // is what the position actually admits, so a subject that is not optional is
  // still the constant test VEL4001 refuses — the seed decides a type
  // argument, never whether `??` is legal.
  assert.deepEqual(messages(`${empty}
def go():
    const constant: List<string> = empty() ?? []
`), ["VEL4001 Left side of '??' is not optional: List<string>"]);
  assert.deepEqual(messages(`
def go():
    const width: number? = null
    const value: number = width ?? 0
    print(str(value))
`), []);
});

test("[A-I1] the seeded '??' runs", () => {
  assert.equal(run(`${empty}
def maybeEmpty<T>() -> List<T>?:
    return null

const names: List<string> = maybeEmpty() ?? []
names.append("ada")
const more: List<string> = maybeEmpty() ?? empty()
more.append("lin")
print(f"{names.join(",")}|{more.join(",")}")
`), "ada|lin\n");
});
