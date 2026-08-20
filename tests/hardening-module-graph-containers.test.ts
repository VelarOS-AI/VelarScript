/// A-010: dependency discovery kept its own switch over statement and
/// expression kinds, and a `import("./dep.vel")` written in a container that
/// switch had never been taught — `try`, `using`, a `test "…":` body, a class
/// getter, `@dispose:`, `@iterate:` — left its module out of the graph with a
/// clean compile and exit 0. The main instance turned "the module exists and
/// loads" into `false`; its siblings crashed at run time with
/// ERR_MODULE_NOT_FOUND.
///
/// The old gate for dynamic imports varied the *target* and never the
/// *container*, so it verified that one example existed rather than that every
/// container × every path works. These tests are that matrix, and the
/// container list is derived rather than typed out: hand-listing containers is
/// the same mistake in a second place.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { astNodes, CORE_EXPRESSION_CONSTRUCTS, CORE_STATEMENT_CONSTRUCTS } from "../packages/compiler/src/ast.ts";
import { Lexer } from "../packages/compiler/src/lexer.ts";
import { Parser } from "../packages/compiler/src/parser.ts";
// Inspection and the extension type come from the built package, because that
// is what the Web and Desktop extensions are compiled against; the source
// declarations are the same shape, but a class inside one is nominal across
// the two builds.
import { inspectModule } from "@velarscript/compiler";
import type { CompilerExtension } from "@velarscript/compiler/extension";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";
import { velarCompilerExtension as desktopCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { velarCompilerExtension as nodeCompilerExtension } from "../packages/node/src/compiler.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const examples = fileURLToPath(new URL("../examples", import.meta.url));

/**
 * Every kind Core's expression union spells. The AST's own discriminator
 * convention supplies the rest: an extension node is disjoint from Core by its
 * `ExtensionExpression:`/`ExtensionStatement:` prefix, and the statement
 * roster is `CORE_STATEMENT_CONSTRUCTS`, which `tsc` refuses to accept as
 * incomplete.
 */
const CORE_EXPRESSION_KINDS: ReadonlySet<string> = new Set(Object.keys(CORE_EXPRESSION_CONSTRUCTS));
const CORE_STATEMENT_KINDS: ReadonlySet<string> = new Set(Object.keys(CORE_STATEMENT_CONSTRUCTS)
  .map((key) => key.split(":", 1)[0]!));
const isExpressionKind = (kind: string): boolean => CORE_EXPRESSION_KINDS.has(kind) || kind.startsWith("ExtensionExpression:");
const isStatementKind = (kind: string): boolean => CORE_STATEMENT_KINDS.has(kind) || kind.startsWith("ExtensionStatement:");

interface PlacedNode {
  readonly node: { readonly kind: string; readonly span: { start: number; end: number } };
  /**
   * The slot path from the program root down to this node: one
   * `OwnerKind.field` step per node boundary, with keyless shapes on the way
   * (a `Parameter`, a `ClassFieldDeclaration`) folded into the field name. A
   * class getter's body is `ClassDeclaration.getters` then
   * `FunctionDeclaration.body`, which is what tells it apart from a method's —
   * the exact distinction A-010's hand-written walk lost.
   */
  readonly chain: readonly string[];
}

/** The same structural descent `astNodes` performs, carrying each node's slot path. */
function placedNodes(root: unknown): PlacedNode[] {
  const found: PlacedNode[] = [];
  const visit = (value: unknown, ownerKind: string, field: string, chain: readonly string[]): void => {
    if (typeof value !== "object" || value === null) return;
    if (Array.isArray(value)) {
      for (const element of value) visit(element, ownerKind, field, chain);
      return;
    }
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind === "string") {
      const next = [...chain, `${ownerKind}.${field}`];
      found.push({ node: value as PlacedNode["node"], chain: next });
      for (const [key, child] of Object.entries(value)) visit(child, kind, key, next);
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, ownerKind, `${field}.${key}`, chain);
  };
  for (const [key, child] of Object.entries(root as object)) visit(child, "Program", key, []);
  return found;
}

function parseProgram(text: string, extensions: readonly CompilerExtension[]): unknown {
  const lexical = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
  const lexed = new Lexer(text, lexical).lex();
  const parsed = extensions.find((extension) => extension.parser)?.parser?.create(lexed.tokens, lexical).parse()
    ?? new Parser(lexed.tokens, lexical).parse();
  return parsed.program;
}

/**
 * The corpus the container roster is derived from. `examples/tour` is the one
 * corpus a gate already requires to spell every statement construct, so a
 * container that reaches the language reaches this list too; `examples/app` is
 * the same syntax under real structure.
 */
const corpusDirectories: readonly { readonly directory: string; readonly extensions: readonly CompilerExtension[] }[] = [
  { directory: join(examples, "tour", "core"), extensions: [] },
  { directory: join(examples, "tour", "web"), extensions: [webCompilerExtension] },
  { directory: join(examples, "tour", "desktop"), extensions: [desktopCompilerExtension] },
  { directory: join(examples, "tour", "node"), extensions: [nodeCompilerExtension] },
  { directory: join(examples, "app", "src"), extensions: [webCompilerExtension] },
];

/**
 * One container the tour does not spell in a form a probe can reach: its only
 * `expose` publishes shorthand fields, whose value span is the key's, so
 * rewriting it produces `{import(...)}` — a key, not a value.
 */
const extraCorpusSource = `
component Panel(title: string) exposes Handle:
    def focus():
        pass

    expose {focus: focus, loaded: import("./dep.vel")}
    return <p>{title}</p>
`;

interface CorpusSource {
  readonly path: string;
  readonly text: string;
  readonly extensions: readonly CompilerExtension[];
}

async function corpusSources(): Promise<CorpusSource[]> {
  const sources: CorpusSource[] = [];
  for (const corpus of corpusDirectories) {
    for (const name of (await readdir(corpus.directory)).filter((item) => item.endsWith(".vel"))) {
      const path = join(corpus.directory, name);
      sources.push({ path, text: await readFile(path, "utf8"), extensions: corpus.extensions });
    }
  }
  sources.push({ path: join(examples, "tour", "web", "expose-probe.vel"), text: extraCorpusSource, extensions: [webCompilerExtension] });
  return sources;
}

interface CorpusSlots {
  /** Every slot in the corpus that holds a statement or an expression. */
  readonly containers: ReadonlySet<string>;
  /** Those of them that hold a statement — a code region rather than a value. */
  readonly regions: ReadonlySet<string>;
  /** Slots nested below an extension statement; the Core runtime matrix does not execute target frameworks. */
  readonly extensionOwned: ReadonlySet<string>;
}

async function corpusContainerSlots(): Promise<CorpusSlots> {
  const containers = new Set<string>();
  const regions = new Set<string>();
  const extensionOwned = new Set<string>();
  const coreOwned = new Set<string>();
  for (const source of await corpusSources()) {
    for (const placed of placedNodes(parseProgram(source.text, source.extensions))) {
      if (!isExpressionKind(placed.node.kind) && !isStatementKind(placed.node.kind)) continue;
      const slot = placed.chain.at(-1)!;
      containers.add(slot);
      if (isStatementKind(placed.node.kind)) regions.add(slot);
      if (placed.chain.some((entry) => slotOwner(entry).startsWith("ExtensionStatement:"))) extensionOwned.add(slot);
      else coreOwned.add(slot);
    }
  }
  return { containers, regions, extensionOwned: new Set([...extensionOwned].filter((slot) => !coreOwned.has(slot))) };
}

const slotOwner = (slot: string): string => slot.slice(0, slot.indexOf("."));

test("every dynamic import the parser produces reaches the module graph, in every container the corpus spells", async () => {
  const sources = await corpusSources();
  // One probe per distinct slot path: rewrite the expression at that position
  // into `import("./dep.vel")` and require the module graph to have it. The
  // positions come from the parsed AST, so a container added to the language
  // and written into the tour enters this matrix without a line here.
  const probes = new Map<string, CorpusSource & { readonly placed: PlacedNode }>();
  const containerSlots = new Set<string>();
  for (const source of sources) {
    for (const placed of placedNodes(parseProgram(source.text, source.extensions))) {
      if (isExpressionKind(placed.node.kind) || isStatementKind(placed.node.kind)) containerSlots.add(placed.chain.at(-1)!);
      if (!isExpressionKind(placed.node.kind)) continue;
      const key = `${source.path}|${placed.chain.join(">")}`;
      if (!probes.has(key)) probes.set(key, { ...source, placed });
    }
  }
  assert.ok(probes.size > 500, `the corpus produced only ${probes.size} probe positions`);

  const missed: string[] = [];
  const refusals = new Map<string, Set<string>>();
  const covered = new Set<string>();
  for (const probe of probes.values()) {
    const { span } = probe.placed.node;
    const spliced = `${probe.text.slice(0, span.start)}import("./dep.vel")${probe.text.slice(span.end)}`;
    const inspection = inspectModule(spliced, { path: probe.path, extensions: probe.extensions });
    const landed = placedNodes(parseProgram(spliced, probe.extensions)).filter((placed) => placed.node.kind === "DynamicImportExpression"
      && (placed.node as unknown as { source: string }).source === "./dep.vel");
    // Whatever the parser produced, the module graph must have it. This is the
    // matrix assertion, and it needs no idea of what a container is.
    if (landed.length > 0 && !inspection.dependencies.some((dependency) => dependency.dynamic && dependency.source === "./dep.vel")) {
      missed.push(`${probe.placed.chain.join(">")} in ${probe.path}`);
      continue;
    }
    const chain = probe.placed.chain.join(">");
    const here = landed.filter((placed) => placed.chain.join(">").startsWith(chain));
    if (inspection.diagnostics.length === 0 && here.length > 0) {
      for (const placed of here) for (const slot of placed.chain) covered.add(slot);
      continue;
    }
    // The position refuses a dynamic import — an assignment target, a match
    // pattern, a shorthand field name — or the parser recovered it somewhere
    // else entirely. That is the language's answer, read off the parser rather
    // than written down here as an exception.
    const reason = inspection.diagnostics[0] ? `${inspection.diagnostics[0].code} ${inspection.diagnostics[0].message}` : "parsed as something else";
    for (const slot of probe.placed.chain) refusals.set(slot, (refusals.get(slot) ?? new Set()).add(reason));
  }
  assert.deepEqual(missed, [], `dependency discovery skipped ${missed.length} container(s)`);

  // Every container the corpus spells either holds a dynamic import that the
  // graph found, or refuses to hold one at all — and the refusal is the
  // parser's, quoted here rather than assumed.
  const unexplained = [...containerSlots]
    .filter((slot) => !covered.has(slot))
    .filter((slot) => (refusals.get(slot)?.size ?? 0) === 0);
  assert.deepEqual(unexplained, [], "container slots with neither a dynamic import nor a refusal");
  const uncovered = [...containerSlots].filter((slot) => !covered.has(slot)).sort();
  assert.deepEqual(uncovered, ["MatchValuePattern.values"], "the only container a dynamic import cannot be written into");

  // The six containers A-010 named, held by their own names so the matrix
  // cannot lose its subject to a corpus edit.
  for (const anchor of [
    "TryExpression.value",
    "UsingDeclaration.initializer",
    "TestDeclaration.body",
    "ClassDeclaration.getters",
    "ClassDisposeBlock.body",
    "ClassIterateBlock.body",
  ]) assert.ok(covered.has(anchor), `${anchor} left the matrix`);
});

test("dependency discovery reaches a container the compiler has never been taught", () => {
  // The structural walk is what makes a *new* container safe, and a new
  // container is by definition one no case here knows. This is that container:
  // a node shape the compiler has never seen, nested three levels deep.
  const program = {
    kind: "Program",
    body: [{
      kind: "ExtensionStatement:probe:box",
      compartments: [{ shelves: [{ kind: "ExtensionExpression:probe:slot", value: { kind: "DynamicImportExpression", source: "./deep.vel", sourceSpan: { start: 0, end: 0 }, span: { start: 0, end: 0 } } }] }],
      span: { start: 0, end: 0 },
    }],
    span: { start: 0, end: 0 },
  };
  const found = [...astNodes(program)].filter((node) => node.kind === "DynamicImportExpression");
  assert.equal(found.length, 1);
  assert.equal((found[0] as unknown as { source: string }).source, "./deep.vel");
});

const depModule = (slug: string): string => `print("loaded ${slug}")\n\nexport const name = "${slug}"\n`;

const containerModule = `
/// Every AST container that can hold an expression, each holding one dynamic
/// import of a module of its own, so a container the module graph skips loses
/// exactly one module and nothing else.
///
/// \`runContainers()\` evaluates all of them, so \`velar run\` and \`velar test\`
/// reach every container rather than merely compiling it.

type Dep:
    readonly name: string

let detached = false

async def record(pending: Promise<Dep>) -> string:
    const loaded = await pending
    return loaded.name

async def detach(pending: Promise<Dep>):
    const loaded = await pending
    detached = loaded.name == "async-statement"

// VariableDeclaration.initializer
const variableInitializer = await import("./dep-variable-initializer.vel")

let released = "none"

class Owned:
    constructor(const label: string):
        pass

    @dispose:
        // ClassDeclaration.dispose
        released = await record(import("./dep-class-dispose.vel"))

class Box:
    // ClassDeclaration.fields.initializer
    const fieldPending: Promise<Dep> = import("./dep-class-field.vel")
    let iteratePending: Promise<Dep> = import("./dep-class-iterate-seed.vel")
    let initPending: Promise<Dep>
    let items: List<string> = ["one"]

    // ClassDeclaration.parameters.defaultValue
    constructor(const seeded: Promise<Dep> = import("./dep-class-parameter-default.vel")):
        // ClassDeclaration.initialization
        self.initPending = import("./dep-class-initialization.vel")

    // ClassDeclaration.getters
    get getterPending() -> Promise<Dep>:
        return import("./dep-class-getter.vel")

    // ClassDeclaration.methods
    async def methodBody() -> string:
        return await record(import("./dep-class-method.vel"))

    // ClassDeclaration.iterate
    @iterate:
        self.iteratePending = import("./dep-class-iterate.vel")
        return self.items

// FunctionDeclaration.parameters.defaultValue
async def functionParameterDefault(pending: Promise<Dep> = import("./dep-function-parameter-default.vel")) -> List<string>:
    // FunctionDeclaration.body
    const inBody = await record(import("./dep-function-body.vel"))
    return [await record(pending), inBody]

// ReturnStatement.value
async def returnValue() -> Dep:
    return await import("./dep-return-value.vel")

async def branches() -> List<string>:
    let seen: List<string> = []
    // IfStatement.condition
    if (await import("./dep-if-condition.vel")).name == "if-condition":
        // IfStatement.thenBody
        seen.append(await record(import("./dep-if-then.vel")))
    else:
        seen.append("unreachable")
    if released == "impossible":
        seen.append("unreachable")
    else:
        // IfStatement.elseBody
        seen.append(await record(import("./dep-if-else.vel")))
    return seen

async def loops() -> List<string>:
    let seen: List<string> = []
    let rounds = 0
    // WhileStatement.condition
    while rounds < 1 and (await import("./dep-while-condition.vel")).name == "while-condition":
        // WhileStatement.body
        seen.append(await record(import("./dep-while-body.vel")))
        rounds += 1
    // ForStatement.iterable
    for item in [(await import("./dep-for-iterable.vel")).name]:
        // ForStatement.body
        seen.append(f"{item} {await record(import("./dep-for-body.vel"))}")
    return seen

async def matching() -> List<string>:
    let seen: List<string> = []
    // MatchStatement.value
    match (await import("./dep-match-value.vel")).name:
        // MatchStatement.cases.guard
        case _ if (await import("./dep-match-guard.vel")).name == "never":
            seen.append("unreachable")
        case _:
            // MatchStatement.cases.body
            seen.append(await record(import("./dep-match-body.vel")))
    return seen

async def failures() -> List<string>:
    let seen: List<string> = []
    try:
        // TryStatement.tryBody
        seen.append(await record(import("./dep-try-body.vel")))
        // ThrowStatement.value
        throw Error((await import("./dep-throw-value.vel")).name)
    catch error:
        // TryStatement.catchBody
        seen.append(f"{error.message} {await record(import("./dep-catch-body.vel"))}")
    finally:
        // TryStatement.finallyBody
        seen.append(await record(import("./dep-finally-body.vel")))
    return seen

async def assertions() -> List<string>:
    let seen: List<string> = []
    // AssertStatement.condition
    assert (await import("./dep-assert-condition.vel")).name == "assert-condition"
    let unmet = false
    try:
        // AssertStatement.message — a message is evaluated only when the
        // assertion fails, so only a failing one runs the container.
        assert unmet else (await import("./dep-assert-message.vel")).name
    catch error:
        seen.append(error.message)
    return seen

async def assignments() -> List<string>:
    let last = "none"
    // AssignmentStatement.value
    last = (await import("./dep-assignment-value.vel")).name
    let store: Record<string> = {}
    // AssignmentStatement.target
    store[(await import("./dep-assignment-target.vel")).name] = last
    return [last, store["assignment-target"] ?? "missing"]

async def statements() -> List<string>:
    // ExpressionStatement.expression
    print(f"container expression {(await import("./dep-expression-statement.vel")).name}")
    // AsyncStatement.expression
    async detach(import("./dep-async-statement.vel"))
    return ["statements"]

async def owned() -> List<string>:
    // UsingDeclaration.initializer
    using resource = Owned((await import("./dep-using-initializer.vel")).name)
    return [resource.label]

export async def runContainers() -> List<string>:
    let seen: List<string> = []
    const box = Box()
    for item in box:
        seen.append(item)
    seen.append(variableInitializer.name)
    seen.append(await record(box.fieldPending))
    seen.append(await record(box.seeded))
    seen.append(await record(box.initPending))
    seen.append(await record(box.getterPending))
    seen.append(await box.methodBody())
    seen.append(await record(box.iteratePending))
    for name in await functionParameterDefault():
        seen.append(name)
    seen.append((await returnValue()).name)
    for name in await branches():
        seen.append(name)
    for name in await loops():
        seen.append(name)
    for name in await matching():
        seen.append(name)
    for name in await failures():
        seen.append(name)
    for name in await assertions():
        seen.append(name)
    for name in await assignments():
        seen.append(name)
    for name in await statements():
        seen.append(name)
    for name in await owned():
        seen.append(name)
    seen.append(released)
    let waited = 0
    while not detached and waited < 2000:
        await Promise.sleep(5ms)
        waited += 1
    seen.append(f"detached {detached}")
    return seen
`.trimStart();

const entryModule = `
/// The entry: \`velar run\` drives every container in ./containers.vel.

import {runContainers} from "./containers.vel"

for name in await runContainers():
    print(f"container {name}")
`.trimStart();

const testModule = `
/// The same containers under \`velar test\`, plus the one container only a test
/// module has: the test body itself.

import {runContainers} from "./containers.vel"

test "every container's dynamic import resolves under velar test":
    // TestDeclaration.body
    const loaded = await import("./dep-test-body.vel")
    assert loaded.name == "test-body"
    const names = await runContainers()
    assert names.size > 0
`.trimStart();

test("every container carries its dynamic import through check, run, build, and test", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-module-graph-containers-"));
  try {
    await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
    await writeFile(join(directory, "containers.vel"), containerModule, "utf8");
    await writeFile(join(directory, "main.vel"), entryModule, "utf8");
    await writeFile(join(directory, "matrix.test.vel"), testModule, "utf8");

    // The dynamic imports are read back out of the AST rather than listed: the
    // slug in each path is one container's marker in every path's output, and
    // the chain each import sits on is what the container roster is matched
    // against below.
    const slots = new Map<string, readonly string[]>();
    for (const [name, text] of [["containers.vel", containerModule], ["matrix.test.vel", testModule]] as const) {
      for (const placed of placedNodes(parseProgram(text, []))) {
        if (placed.node.kind !== "DynamicImportExpression") continue;
        slots.set((placed.node as unknown as { source: string }).source, placed.chain);
      }
      void name;
    }
    for (const source of slots.keys()) {
      const slug = source.replace(/^\.\/dep-/u, "").replace(/\.vel$/u, "");
      await writeFile(join(directory, `dep-${slug}.vel`), depModule(slug), "utf8");
    }
    const runtimeSlugs = [...slots.keys()]
      .filter((source) => source !== "./dep-test-body.vel")
      .map((source) => source.replace(/^\.\/dep-/u, "").replace(/\.vel$/u, ""));
    assert.ok(runtimeSlugs.length > 30, `only ${runtimeSlugs.length} containers were spelled`);

    // Derived roster: every container the corpus spells that belongs to the
    // statement side of the AST — a slot a statement owns, or one holding a
    // code region, which is what `@dispose:`, `@iterate:` and `constructor:`
    // are (their blocks are neither statement nor expression nodes, so owner
    // alone would leave out two of the six containers A-010 named). Extension
    // statements are excluded: they have no `velar run` of their own, and the
    // corpus matrix above already walks them.
    // A new core container that reaches the tour fails this until the project
    // above spells it too.
    const spelled = new Set([...slots.values()].flatMap((chain) => [...chain]));
    const corpus = await corpusContainerSlots();
    const required = [...corpus.containers]
      .filter((slot) => isStatementKind(slotOwner(slot)) || corpus.regions.has(slot))
      .filter((slot) => !corpus.extensionOwned.has(slot))
      .sort();
    assert.ok(required.length > 30, `the corpus derived only ${required.length} core containers`);
    assert.deepEqual(required.filter((slot) => !spelled.has(slot)), [], "core containers with no dynamic import in the matrix project");

    const modules = (await readdir(directory)).filter((name) => name.endsWith(".vel"));
    const checked = spawnSync(process.execPath, [cliPath, "check", directory], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    // Every module in this project is reachable through exactly one container,
    // so the count is the per-container assertion for `check`.
    assert.match(checked.stdout, new RegExp(`Checked ${modules.length} modules`, "u"));

    const ran = spawnSync(process.execPath, [cliPath, "run", directory], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.deepEqual(runtimeSlugs.filter((slug) => !ran.stdout.includes(`loaded ${slug}`)), [], "containers whose module never loaded under velar run");
    assert.match(ran.stdout, /container detached true/u);

    const tested = spawnSync(process.execPath, [cliPath, "test", directory], { encoding: "utf8" });
    assert.equal(tested.status, 0, tested.stderr);
    assert.match(tested.stdout, /1 passed, 0 failed/u);
    assert.deepEqual([...runtimeSlugs, "test-body"].filter((slug) => !tested.stdout.includes(`loaded ${slug}`)), [], "containers whose module never loaded under velar test");

    const output = join(directory, "dist");
    const built = spawnSync(process.execPath, [cliPath, "build", directory, "--out-dir", output], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const emitted = new Set(await readdir(output));
    assert.deepEqual(runtimeSlugs.filter((slug) => !emitted.has(`dep-${slug}.js`)), [], "containers whose module was not emitted by velar build");
    // A test module is not part of a production build, so its container's
    // module is the one that must *not* be there.
    assert.ok(!emitted.has("dep-test-body.js"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
