import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { compileProject, moduleInterfaceIdentity } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource, standardModuleSources } from "../packages/cli/src/standard-modules.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";

// D55 — generic records (`type Box<T>`), their identities, bounds, variance,
// recursion, and the crossing into another module.
//
// Every capability below is asserted at *execution* level rather than at
// "it compiled": a generic record's whole point is the validator it produces,
// and a validator that is emitted but wrong looks exactly like one that is
// right until something runs it.

function execute(code: string): ReturnType<typeof spawnSync> {
  let linked = code;
  for (const source of ["velar/json", "velar/text", "velar/math", "velar/async"]) {
    const module = standardModuleSource(source);
    if (!module) continue;
    linked = linked.replaceAll(
      JSON.stringify(source),
      JSON.stringify(`data:text/javascript;base64,${Buffer.from(module).toString("base64")}`),
    );
  }
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 20_000 });
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function diagnostics(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** Compiles a whole project on disk and runs its entry, so a claim about "across modules" is one. */
async function runProject(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velar-d55-"));
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" }, null, 2));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text.trimStart());
  }
  const config = await resolveVelarProject(root);
  const project = await compileProject(config.entryPath, new Map(), {
    sourceRoot: config.root,
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
  assert.deepEqual(project.failures.map((failure) => failure.message), []);
  assert.deepEqual(
    project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${module.relativePath} ${item.code} ${item.message}`)),
    [],
  );
  const sources = standardModuleSources(config.compilerExtensions);
  const roots = new Set<string>();
  for (const module of project.modules) {
    for (const dependency of module.result.dependencies) if (sources.has(dependency.source)) roots.add(dependency.source);
    for (const source of module.result.runtimeModules) if (sources.has(source)) roots.add(source);
  }
  const packageRoot = join(root, "dist", "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exportMap: Record<string, string> = {};
  for (const source of standardModuleClosure(roots, config.extensionConfig, config.compilerExtensions)) {
    const name = source.slice("velar/".length);
    exportMap[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), standardModuleSource(source, config.extensionConfig, config.compilerExtensions) ?? "");
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports: exportMap }, null, 2));
  for (const module of project.modules) {
    const code = module.result.code;
    if (!code) continue;
    const output = join(root, "dist", module.relativePath.replace(/\.vel$/u, ".js"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, code);
  }
  const execution = spawnSync(process.execPath, [join(root, "dist", "main.js")], { encoding: "utf8", timeout: 20_000 });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("[D55 120] a generic record declares, instantiates, and validates at runtime", () => {
  const output = run(`
type Box<T>:
    value: T

type StringBox = Box<string>
type NumberBox = Box<number>

const held: Box<string> = { value: "kept" }
print(held.value)
print(f"{StringBox.is({ value: "kept" })} {StringBox.is({ value: 1 })}")
print(f"{NumberBox.is({ value: 1 })} {NumberBox.is({ value: "kept" })}")
`);
  assert.equal(output, "kept\ntrue false\ntrue false\n");
});

test("[D55 121] two instantiations of one declaration are two types", () => {
  // The static half of the same claim the run above makes at runtime: the type
  // arguments are in the identity, so assignment between them is checked.
  assert.deepEqual(diagnostics(`
type Box<T>:
    value: T

const held: Box<string> = { value: "kept" }
const other: Box<number> = held
`), ["VEL4001 Cannot assign Box<string> to Box<number>"]);
});

test("[D55 121] an alias is transparent inside a type argument", () => {
  // `Box<Id>` and `Box<string>` are one type when `Id` aliases `string`: the
  // identity is keyed by the argument's own identity, not by its spelling.
  const output = run(`
type Id = string

type Box<T>:
    value: T

const named: Box<Id> = { value: "one" }
const direct: Box<string> = named
print(direct.value)
`);
  assert.equal(output, "one\n");
});

test("[D55 122] variance is by field: readonly is covariant, mutable is invariant", () => {
  // The strongest positive finding of D55's investigation, kept honest here:
  // `objectFieldsAssignable` already decided variance field by field, and an
  // instantiation's substituted field table inherits that decision for free.
  const output = run(`
type Animal:
    name: string

type Dog:
    name: string
    breed: string

type Held<T>:
    readonly value: T

const dog: Held<Dog> = { value: { name: "rex", breed: "lab" } }
const animal: Held<Animal> = dog
print(animal.value.name)
`);
  assert.equal(output, "rex\n");

  assert.deepEqual(diagnostics(`
type Animal:
    name: string

type Dog:
    name: string
    breed: string

type Cell<T>:
    value: T

const dog: Cell<Dog> = { value: { name: "rex", breed: "lab" } }
const animal: Cell<Animal> = dog
`), ["VEL4001 Cannot assign Cell<Dog> to Cell<Animal>"]);
});

test("[D55 124] a bound on a type is the same bound a def carries", () => {
  const output = run(`
type Sorted<T: Comparable>:
    items: List<T>

const numbers: Sorted<number> = { items: [3, 1] }
print(f"{numbers.items.size}")
`);
  assert.equal(output, "2\n");

  const refused = diagnostics(`
type Sorted<T: Comparable>:
    items: List<T>

const flags: Sorted<bool> = { items: [true] }
`);
  assert.equal(refused.length, 1);
  assert.match(refused[0]!, /^VEL4031 Type parameter 'T' of 'Sorted' is bound by Comparable/u);
  assert.match(refused[0]!, /numbers and strings/u);
});

test("[D55 124] a static Type carrier cannot be a type argument of a validated record", () => {
  const refused = diagnostics(`
type User:
    name: string

type Box<T>:
    value: T

type Bad = Box<Type<User>>
`);
  assert.equal(refused.length, 1);
  assert.match(refused[0]!, /^VEL4022 Type<T> is a static runtime-Type carrier and cannot be a type argument of 'Box'/u);
});

test("[D44 72 / D55 121] the readonly deep-data rule reaches the instantiation", () => {
  // A bare `T` under `readonly` is legal at the declaration — opacity is as
  // good as immutability there — so the argument is what decides whether the
  // promise holds, and only the instantiation site knows it.
  const refused = diagnostics(`
class Engine:
    let power: number = 1

type Held<T>:
    readonly value: T

const bad: Held<Engine> = { value: Engine() }
`);
  assert.equal(refused.length, 1, JSON.stringify(refused));
  assert.match(refused[0]!, /^VEL4001 'readonly' accepts only pure data at every depth; 'Held<Engine>\.value' is class 'Engine'/u);

  const deep = diagnostics(`
class Engine:
    let power: number = 1

type Wrap:
    engine: Engine

type Held<T>:
    readonly value: T

const bad: Held<Wrap> = { value: { engine: Engine() } }
`);
  assert.equal(deep.length, 1, JSON.stringify(deep));
  assert.match(deep[0]!, /'Held<Wrap>\.value\.engine' is class 'Engine'/u);

  const output = run(`
type Item:
    name: string

type Held<T>:
    readonly value: T

const good: Held<Item> = { value: { name: "kept" } }
print(good.value.name)
`);
  assert.equal(output, "kept\n");
});

test("[D55 125] homogeneous recursion compiles and validates to any depth", () => {
  const output = run(`
type Tree<T>:
    label: T
    kids: List<Tree<T>>

type StringTree = Tree<string>

const tree: Tree<string> = { label: "root", kids: [{ label: "leaf", kids: [] }] }
print(tree.kids[0].label)
print(f"{StringTree.is(tree)}")
print(f"{StringTree.is({ label: "root", kids: [{ label: 1, kids: [] }] })}")
`);
  assert.equal(output, "leaf\ntrue\nfalse\n");
});

test("[D55 125] polymorphic recursion is refused at the declaration that writes it", () => {
  // The refusal lands on the line that declares it, not on some later
  // instantiation that ran out of stack.
  const direct = diagnostics(`
type Bad<T>:
    next: Bad<List<T>>?
`);
  assert.equal(direct.length, 1);
  assert.match(direct[0]!, /^VEL4021 Recursive generic type 'Bad' must use its own type parameters where it refers to 'Bad'; write 'Bad<T>'/u);

  // And through a cycle, which a direct self-reference check would miss.
  const mutual = diagnostics(`
type Ping<T>:
    next: Pong<List<T>>?

type Pong<T>:
    back: Ping<T>?
`);
  assert.equal(mutual.length, 1);
  assert.match(mutual[0]!, /^VEL4021 Recursive generic type 'Ping' must use its own type parameters where it refers to 'Pong'/u);
});

test("[D55 126] a bare generic name is refused as a type and as a value", () => {
  const asType = diagnostics(`
type Box<T>:
    value: T

const held: Box = { value: 1 }
`);
  assert.equal(asType.length, 1);
  assert.match(asType[0]!, /^VEL4001 Generic type 'Box' needs a type argument; write 'Box<T>' with concrete types/u);

  // Rule 126's decisive reason: `unknown` satisfies every bound, so reading a
  // bare `Box` as `Box<unknown>` would hand back a validator that accepts
  // everything the author forgot to describe.
  const asValue = diagnostics(`
type Box<T>:
    value: T

print(f"{Box.is({ value: 1 })}")
`);
  assert.ok(asValue.some((item) => /is a generic type, not a value; name one instantiation first/u.test(item)), JSON.stringify(asValue));

  const wrongArity = diagnostics(`
type Box<T>:
    value: T

const held: Box<string, number> = { value: "x" }
`);
  assert.equal(wrongArity.length, 1);
  assert.match(wrongArity[0]!, /^VEL4001 Generic type 'Box' takes 1 type argument, not 2/u);
});

test("[D55 123] naming an instantiation is what turns it into a value", () => {
  // Rule 123: the expression position keeps its comparison `<`, and the idiom
  // that gives an instantiation a runtime Type object is the one this language
  // already teaches for `List<Item>` — name it. On ENM-I4's precedent the name
  // *is* that instantiation's Type object, so `parse` reports the instantiated
  // field type rather than a bare refusal.
  const output = run(`
type Box<T>:
    value: T

type Deep<T>:
    items: List<Box<T>>

type Boxed = Box<string>
type Held = Deep<number>

const parsed = Boxed.parse({ value: "raw" })
print(parsed.value)
try:
    const refused = Boxed.parse({ value: 1 })
    print("unreachable")
catch error:
    print(error.message)
try:
    const missing = Boxed.parse({})
    print("unreachable")
catch error:
    print(error.message)
try:
    const nested = Held.parse({ items: [{ value: "x" }] })
    print("unreachable")
catch error:
    print(error.message)
`);
  assert.equal(output, [
    "raw",
    "Value does not match Box<string> — field 'value' does not match string",
    "Value does not match Box<string> — field 'value' is missing",
    "Value does not match Deep<number> — field 'items' does not match List<Box<number>>",
    "",
  ].join("\n"));
});

test("[D55 121] a generic def solves its parameter through a generic record", () => {
  const output = run(`
type Box<T>:
    value: T

def unwrap<T>(box: Box<T>) -> T:
    return box.value

const counted: Box<number> = { value: 41 }
print(f"{unwrap(counted) + 1}")
print(unwrap({ value: "literal" }))
`);
  assert.equal(output, "42\nliteral\n");
});

test("[D55 120] a generic record crosses a module boundary and is instantiated on the far side", async () => {
  const output = await runProject({
    "shelf.vel": `
export type Item:
    label: string

export type Box<T: Data>:
    value: T

export type Pair<A, B>:
    left: A
    right: B

export def boxItem(item: Item) -> Box<Item>:
    return { value: item }
`,
    "barrel.vel": `
export {Box, Item, Pair, boxItem} from "./shelf.vel"
`,
    "main.vel": `
import {Box as Crate, Item, Pair, boxItem} from "./barrel.vel"

type ItemCrate = Crate<Item>
type NumberCrate = Crate<number>

const held: Crate<Item> = boxItem({ label: "ada" })
print(held.value.label)
print(f"{ItemCrate.is({ value: { label: "x" } })} {ItemCrate.is({ value: 1 })} {NumberCrate.is({ value: 1 })}")

const pair: Pair<string, number> = { left: "l", right: 2 }
print(f"{pair.left} {pair.right}")
`,
  });
  assert.equal(output, "ada\ntrue false true\nl 2\n");
});

test("[D55 120] an imported instantiation keeps the identity the declaring module gave it", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-d55-cross-"));
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" }, null, 2));
  await writeFile(join(root, "shelf.vel"), "export type Box<T>:\n    value: T\n\nexport def boxed() -> Box<string>:\n    return { value: \"x\" }\n");
  await writeFile(join(root, "main.vel"), "import {Box, boxed} from \"./shelf.vel\"\n\nconst wrong: Box<number> = boxed()\n");
  const config = await resolveVelarProject(root);
  const project = await compileProject(config.entryPath, new Map(), {
    sourceRoot: config.root,
    projectRoot: config.root,
    extensions: config.compilerExtensions,
    framework: config.framework,
  });
  assert.deepEqual(
    project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)),
    ["VEL4001 Cannot assign Box<string> to Box<number>"],
  );
});

test("[D55 120] a generic declaration's parameters and bounds enter the module-interface identity", async () => {
  // Batch M's lesson, one layer out: a bound that does not reach this hash is a
  // constraint that silently disappears from every dependent already built.
  const identity = async (shelf: string): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "velar-d55-identity-"));
    await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" }, null, 2));
    await writeFile(join(root, "shelf.vel"), shelf.trimStart());
    await writeFile(join(root, "main.vel"), "import {Box} from \"./shelf.vel\"\n\ntype Held = Box<string>\nprint(f\"{Held.is({ value: \"x\" })}\")\n");
    const config = await resolveVelarProject(root);
    const project = await compileProject(config.entryPath, new Map(), {
      sourceRoot: config.root,
      projectRoot: config.root,
      extensions: config.compilerExtensions,
      framework: config.framework,
    });
    const shelfModule = project.modules.find((module) => module.relativePath.endsWith("shelf.vel"));
    return moduleInterfaceIdentity(shelfModule!.result.moduleInterface!, config.compilerExtensions);
  };
  const unbounded = await identity("export type Box<T>:\n    value: T\n");
  const bounded = await identity("export type Box<T: Text>:\n    value: T\n");
  const renamed = await identity("export type Box<U>:\n    value: U\n");
  const widened = await identity("export type Box<T>:\n    value: T?\n");
  assert.notEqual(unbounded, bounded);
  assert.notEqual(unbounded, renamed);
  assert.notEqual(unbounded, widened);
});

test("[D55 124] the parameter-list rules apply to a type exactly as to a def", () => {
  // Rule 124 called these "free" because they are about the list, not about
  // the declaration carrying it — free only once the same procedure is asked.
  for (const [source, pattern] of [
    ["type User:\n    name: string\n\ntype Box<User>:\n    value: User\n", /shadows an existing type name/u],
    ["type Box<Data>:\n    value: Data\n", /is a reserved type-parameter bound/u],
    ["type Box<T, T>:\n    value: T\n", /Type parameter 'T' is declared more than once/u],
    ["type Box<T: Nope>:\n    value: T\n", /Unknown type parameter bound 'Nope'/u],
  ] as const) {
    const reported = diagnostics(source);
    assert.equal(reported.length, 1, JSON.stringify(reported));
    assert.match(reported[0]!, /^VEL4021 /u);
    assert.match(reported[0]!, pattern);
  }
});

test("[D55 127.1] enum gets the directed refusal the other declaration forms have", () => {
  // The one declaration in this family with no `parseTypeParameters` call at
  // all: `enum Color<T>:` used to cascade into six parse errors.
  const refused = diagnostics(`
enum Color<T>:
    red
    blue
`);
  assert.equal(refused.length, 1);
  assert.equal(refused[0], "VEL2025 Enum 'Color' cannot declare type parameters; 'def' functions and 'type' records take '<T>'");
});

test("[D55 127.2] the formatter reads a type argument list by position, not by a name it knows", () => {
  // The whitelist this replaced knew six names and would have been blind to
  // every generic a program declares for itself.
  for (const source of [
    "def take(x: Record<string>) -> null: pass\n",
    "type Node:\n    kids: Record<string>\n",
    "const held: Record<string> = {}\n",
    "type Box<T>:\n    value: T\n",
    "type Boxed = Box<string>\n",
    "def read(box: Box<List<string>>) -> null: pass\n",
  ]) {
    assert.equal(formatSource(source), source, source);
  }
});
