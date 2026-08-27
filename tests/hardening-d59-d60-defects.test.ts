import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";

// ---------------------------------------------------------------------------
// D59 rule 141 and D60 rule 148 — the two defects whose shape is "compiles
// clean, fails afterwards". The evidence in both rulings was execution-level,
// so every probe here runs the toolchain rather than reading its output.
// ---------------------------------------------------------------------------

const root = repositoryRoot;
const cli = join(root, "packages", "cli", "src", "cli.ts");

after(async () => {
  await removeTemporaryDirectories();
});

function velar(arguments_: readonly string[]): { readonly status: number; readonly output: string } {
  const execution = spawnSync(process.execPath, [cli, ...arguments_], { encoding: "utf8", timeout: 300_000 });
  return { status: execution.status ?? 1, output: `${String(execution.stdout)}${String(execution.stderr)}` };
}

async function webProject(prefix: string, files: ReadonlyMap<string, string>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D60 rule 148", base: "/" },
  }), "utf8");
  for (const [name, contents] of files) await writeFile(join(directory, name), contents, "utf8");
  return directory;
}

function webEmission(source: string): string {
  const result = compile(source.trimStart(), { extensions: [webCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code);
  return result.code;
}

// ---------------------------------------------------------------------------
// D60 rule 148 — check passing is a contract, so what checks must build.
// ---------------------------------------------------------------------------

test("[D60-148] an exported Component alias checks and then builds", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d60-148-alias-", new Map([
    ["src/q1.vel", `export type RowView = Component<(label: string) -> WebNode>

export component Row(label: string):
    return <li>{label}</li>
`],
    ["src/main.vel", `import {Row, RowView} from "./q1.vel"

const view: RowView = Row

component App:
    return <ul><view label="hello" /></ul>

@main: mount(<App />, "#app")
`],
  ]));
  const checked = velar(["check", directory]);
  assert.equal(checked.status, 0, checked.output);
  // Before D60 rule 148 the build stopped here with
  // `ERROR: Expected ")" but found ":"` -- the bundler rejecting the
  // compiler's own emission.
  const built = velar(["build", directory, "--out-dir", join(directory, "out")]);
  assert.equal(built.status, 0, built.output);
});

test("[D60-148] an exported record with a Component field checks and then builds", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d60-148-record-", new Map([
    ["src/q2.vel", `export type Slot:
    render: Component<(label: string) -> WebNode>

export component Row(label: string):
    return <li>{label}</li>
`],
    ["src/main.vel", `import {Row, Slot} from "./q2.vel"

const slot: Slot = {render: Row}
const Render = slot.render

component App:
    return <ul><Render label="hello" /></ul>

@main: mount(<App />, "#app")
`],
  ]));
  const checked = velar(["check", directory]);
  assert.equal(checked.status, 0, checked.output);
  const built = velar(["build", directory, "--out-dir", join(directory, "out")]);
  assert.equal(built.status, 0, built.output);
});

test("[D60-148] no type check names a binding the module does not have", () => {
  // The root cause: a `named` ValueType carries the type's *display* name, and
  // the emitter wrote it into JavaScript as a receiver. An unresolved generic
  // formats to type text that is not even an identifier -- which is why this
  // one failed loudly at build -- while an extension host name is a valid
  // identifier that is simply not bound, which failed quietly at run time. Both
  // now fail closed.
  const shapes: readonly (readonly [string, string])[] = [
    ["exported Component alias", `export type RowView = Component<(label: string) -> WebNode>

export component Row(label: string):
    return <li>{label}</li>
`],
    ["exported List of Component", `export type Rows = List<Component<(label: string) -> WebNode>>

export component Row(label: string):
    return <li>{label}</li>
`],
    ["inline Component in an is test", `export component Row(label: string):
    return <li>{label}</li>

export def probe(value: unknown) -> bool:
    return value is Component<(label: string) -> WebNode>
`],
    ["alias of a Component in an is test", `type RowView = Component<(label: string) -> WebNode>

export component Row(label: string):
    return <li>{label}</li>

export def probe(value: unknown) -> bool:
    return value is RowView
`],
    ["exported WebNode alias", "export type Rendered = WebNode\n"],
    ["exported bare Component alias", "export type AnyView = Component\n"],
    ["exported Look scalar alias", "export type Size = Length\n"],
    ["exported Color alias", "export type Ink = Color\n"],
  ];
  for (const [label, source] of shapes) {
    const code = webEmission(source);
    assert.doesNotMatch(code, /Component</u, `${label} wrote VelarScript type syntax into JavaScript`);
    for (const unbound of ["WebNode", "Component", "Length", "Color"]) {
      assert.doesNotMatch(
        code,
        new RegExp(String.raw`(?<![.\w$])${unbound}\.is\(`, "u"),
        `${label} named ${unbound} as a runtime Type binding it does not have`,
      );
    }
  }
});

test("[D60-148] a runtime Type binding that does exist is still reached", async () => {
  // The guard must not swallow the cross-module case FLW-U1 established: an
  // imported record type is not in this module's declarations, but its Type
  // object is an in-scope import, so the check still routes through it.
  const { compileProject } = await import("../packages/cli/src/project.ts");
  const directory = await makeTemporaryDirectory("velar-d60-148-imported-");
  await writeFile(join(directory, "user.vel"), "export type User:\n    name: string\n", "utf8");
  await writeFile(join(directory, "main.vel"), `import {User} from "./user.vel"

export type Roster:
    lead: User

export def probe(value: unknown) -> bool:
    return value is User
`, "utf8");
  const project = await compileProject(join(directory, "main.vel"));
  assert.deepEqual(project.failures.map((failure) => failure.message), []);
  const main = project.modules.find((module) => module.inputPath.endsWith("main.vel"));
  assert.ok(main?.result.code);
  assert.match(main.result.code, /User\.is\(/u);
});

// ---------------------------------------------------------------------------
// D60 rule 148, the nominal half (P1-1).
//
// `named` was gated; `class`, `enum`, and `enumMember` were not, and they carry
// the very same display name. A module that reached an enum only through an
// imported signature -- `def maybeKind() -> Kind?` imported without `Kind` --
// had `Kind.is(value)` written into it: `velar check` green, `velar build`
// green, and `ReferenceError: Kind is not defined` the first time the narrowing
// recheck ran. The bundler renaming the declaring module's `Kind` to `Kind2`
// (because the consumer's free `Kind` looked like a global) is what turned the
// single-bundle accident into a certainty at scale.
// ---------------------------------------------------------------------------

/** JavaScript names the emitted output may reference without the module binding them. */
const ambientNames = new Set([
  "Array", "ArrayBuffer", "BigInt", "Boolean", "DataView", "Date", "Error", "EvalError", "Float32Array", "Float64Array",
  "Function", "Infinity", "Int8Array", "Int16Array", "Int32Array", "Intl", "JSON", "Map", "Math", "NaN", "Number",
  "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect", "RegExp", "Set", "String", "Symbol",
  "SyntaxError", "TypeError", "URIError", "Uint8Array", "Uint8ClampedArray", "Uint16Array", "Uint32Array", "URL",
  "URLSearchParams", "WeakMap", "WeakRef", "WeakSet", "AbortController", "AbortSignal", "Blob", "Buffer", "Event",
  "EventTarget", "FormData", "Headers", "Request", "Response", "TextDecoder", "TextEncoder", "AggregateError",
  "BigInt64Array", "BigUint64Array", "FinalizationRegistry", "SharedArrayBuffer", "Atomics", "Iterator",
]);

/** Strings, templates, regular expressions, and comments, blanked so a scan reads code and not text. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ")
    .replace(/"(?:[^"\\\n]|\\[\s\S])*"/gu, '""')
    .replace(/'(?:[^'\\\n]|\\[\s\S])*'/gu, "''")
    .replace(/`(?:[^`\\]|\\[\s\S])*`/gu, "``")
    .replace(/\/(?:[^/\\\n[]|\\[\s\S]|\[(?:[^\]\\\n]|\\[\s\S])*\])+\/[dgimsuvy]*/gu, "/RE/");
}

/** Every module-scope name an emitted module binds: its imports and its top-level declarations. */
function boundNames(code: string): Set<string> {
  const bound = new Set<string>();
  for (const match of code.matchAll(/import\s+([\s\S]*?)\s+from\s*["']/gu)) {
    for (const piece of (match[1] ?? "").split(/[{},]/u)) {
      const name = piece.trim().split(/\s+as\s+/u).at(-1)?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) bound.add(name);
    }
  }
  for (const match of code.matchAll(/\b(?:const|let|var|function|class)\s+\*?\s*([A-Za-z_$][\w$]*)/gu)) bound.add(match[1]!);
  // Destructured module-scope bindings and every parameter name: a scan for a
  // *type* name must not report a local the emitter introduced.
  for (const match of code.matchAll(/(?:\{|\(|,|\[)\s*([A-Za-z_$][\w$]*)\s*(?:[,}\])=:]|$)/gu)) bound.add(match[1]!);
  return bound;
}

/**
 * The type names an emitted module writes into a value position without binding
 * them. A complete free-variable analysis needs a JavaScript parser; this is
 * exact for the class of defect that produced it -- a *type* name written as a
 * receiver or an argument -- because a type name is capitalized, and because
 * every position the emitter writes one into is a value position.
 */
function unboundTypeNames(code: string): string[] {
  const stripped = codeOnly(code);
  const bound = boundNames(stripped);
  // Import and re-export clauses name their *source* export as well as the
  // local binding, and only the local one is a name in this module. They have
  // already been read for `bound`, so the scan reads the body alone.
  const body = stripped
    .replace(/\bimport\b[^;]*?\bfrom\b\s*(?:""|'')\s*;?/gu, " ")
    .replace(/\bexport\b\s*\{[^}]*\}\s*(?:\bfrom\b\s*(?:""|''))?\s*;?/gu, " ");
  const free = new Set<string>();
  for (const match of body.matchAll(/(?<![.\w$])([A-Z][A-Za-z0-9_$]*)(?!\s*:)/gu)) {
    const name = match[1]!;
    if (bound.has(name) || ambientNames.has(name) || name.startsWith("__Velar") || name.startsWith("Velar")) continue;
    free.add(name);
  }
  return [...free].sort();
}

/** The ledger's shapes: a declaring module, and a consumer that imports the *function* and never the type. */
const crossModuleNominalShapes: readonly (readonly [string, string, string])[] = [
  ["an optional enum narrowed by != null", `export enum Kind:
    alpha
    beta

export def maybeKind() -> Kind?:
    return Kind.alpha
`, `import {maybeKind} from "./declared.vel"

export def label() -> string:
    let value = maybeKind()
    if value != null: return str(value)
    return "none"
`],
  ["an optional enum member singleton", `export enum Kind:
    alpha
    beta

export def pinned() -> Kind.alpha?:
    return Kind.alpha
`, `import {pinned} from "./declared.vel"

export def label() -> string:
    let value = pinned()
    if value != null: return str(value)
    return "none"
`],
  ["an optional class instance", `export class Widget:
    def title() -> string: return "widget"

export def maybeWidget() -> Widget?:
    return Widget()
`, `import {maybeWidget} from "./declared.vel"

export def label() -> string:
    let value = maybeWidget()
    if value != null: return value.title()
    return "none"
`],
  ["an optional declared record", `export type Row:
    name: string

export def maybeRow() -> Row?:
    return {name: "row"}
`, `import {maybeRow} from "./declared.vel"

export def label() -> string:
    let value = maybeRow()
    if value != null: return value.name
    return "none"
`],
  ["a Record of an enum", `export enum Kind:
    alpha
    beta

export def maybeBox() -> Record<Kind>?:
    return {kind: Kind.alpha}
`, `import {maybeBox} from "./declared.vel"

export def label() -> number:
    let value = maybeBox()
    if value != null: return value.size
    return 0
`],
  ["a List of an enum", `export enum Kind:
    alpha
    beta

export def maybeKinds() -> List<Kind>?:
    return [Kind.alpha]
`, `import {maybeKinds} from "./declared.vel"

export def label() -> number:
    let value = maybeKinds()
    if value != null: return value.size
    return 0
`],
  ["an alias of an enum", `export enum Kind:
    alpha
    beta

export type Sort = Kind

export def maybeSort() -> Sort?:
    return Kind.alpha
`, `import {maybeSort} from "./declared.vel"

export def label() -> string:
    let value = maybeSort()
    if value != null: return str(value)
    return "none"
`],
];

test("[D60-148] no emitted module names a type its own module does not bind", async () => {
  const { compileProject } = await import("../packages/cli/src/project.ts");
  for (const [label, declared, consumer] of crossModuleNominalShapes) {
    const directory = await makeTemporaryDirectory("velar-p1-1-scan-");
    await writeFile(join(directory, "declared.vel"), declared, "utf8");
    await writeFile(join(directory, "consumer.vel"), consumer, "utf8");
    await writeFile(join(directory, "main.vel"), `import {label} from "./consumer.vel"

export const rendered = str(label())
`, "utf8");
    const project = await compileProject(join(directory, "main.vel"));
    assert.deepEqual(project.failures.map((failure) => failure.message), [], label);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), [], label);
    for (const module of project.modules) {
      assert.ok(module.result.code, `${label}: ${module.inputPath} emitted nothing`);
      assert.deepEqual(
        unboundTypeNames(module.result.code),
        [],
        `${label}: ${module.inputPath} names a type it does not bind`,
      );
    }
  }
});

test("[D60-148] the check a module can still spell is still precise", async () => {
  // The gate degrades a check the module cannot write; it must not degrade one
  // it can. Importing the enum alongside the function keeps `Kind.is(...)`.
  const { compileProject } = await import("../packages/cli/src/project.ts");
  const directory = await makeTemporaryDirectory("velar-p1-1-bound-");
  await writeFile(join(directory, "declared.vel"), `export enum Kind:
    alpha
    beta

export def maybeKind() -> Kind?:
    return Kind.alpha
`, "utf8");
  await writeFile(join(directory, "main.vel"), `import {Kind, maybeKind} from "./declared.vel"

export def label() -> string:
    let value = maybeKind()
    if value != null: return str(value)
    return str(Kind.beta)
`, "utf8");
  const project = await compileProject(join(directory, "main.vel"));
  assert.deepEqual(project.failures.map((failure) => failure.message), []);
  const main = project.modules.find((module) => module.inputPath.endsWith("main.vel"));
  assert.ok(main?.result.code);
  assert.match(main.result.code, /Kind\.is\(/u);
  assert.deepEqual(unboundTypeNames(main.result.code), []);
});

test("[D60-148] check green means the built application runs", { timeout: 300_000 }, async () => {
  // The ledger's own repro, executed. Before the fix this printed
  // "ReferenceError: Kind is not defined" the first time the narrowing ran.
  const directory = await makeTemporaryDirectory("velar-p1-1-run-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }), "utf8");
  await writeFile(join(directory, "src", "kind.vel"), `export enum Kind:
    alpha
    beta

export def maybeKind() -> Kind?:
    return Kind.alpha
`, "utf8");
  await writeFile(join(directory, "src", "label.vel"), `import {maybeKind} from "./kind.vel"

export def label() -> string:
    let value = maybeKind()
    if value != null: return str(value)
    return "none"
`, "utf8");
  await writeFile(join(directory, "src", "main.vel"), `import {label} from "./label.vel"

@main:
    print(label())
`, "utf8");
  const checked = velar(["check", directory]);
  assert.equal(checked.status, 0, checked.output);
  const executed = velar(["run", join(directory, "src", "main.vel")]);
  assert.equal(executed.status, 0, executed.output);
  assert.match(executed.output, /alpha/u);
  assert.doesNotMatch(executed.output, /ReferenceError/u);
});

// ---------------------------------------------------------------------------
// D59 rule 141 — `toBe` is the language's own `==`.
// ---------------------------------------------------------------------------

test("[D59-141] toBe agrees with ==, equals, and toEqual on NaN", { timeout: 300_000 }, async () => {
  const directory = await makeTemporaryDirectory("velar-d59-141-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export const zero = 0\n", "utf8");
  await writeFile(join(directory, "src", "main.test.vel"), `import {expect} from "velar/test"

const nan = 0 / 0

test "the language says NaN == NaN is true":
    expect(nan == nan).toBeTruthy()

test "equals agrees":
    expect(equals(nan, nan)).toBeTruthy()

test "toEqual agrees":
    expect(nan).toEqual(nan)

test "toBe agrees":
    expect(nan).toBe(nan)

test "toBe still separates values the language separates":
    expect(nan != 1).toBeTruthy()
    expect(() => expect(nan).toBe(1)).toThrow()
    expect(() => expect(1).toBe(nan)).toThrow()

test "toBe keeps every answer == already gave":
    expect(-0).toBe(0)
    expect(0).toBe(-0)
    expect("a").toBe("a")
    expect(true).toBe(true)
    expect(null).toBe(null)
    expect(() => expect("a").toBe("b")).toThrow()
    expect(() => expect(1).toBe(2)).toThrow()

test "toBe stays reference identity for values the language compares by reference":
    const left = [1, 2]
    const right = [1, 2]
    expect(left).toBe(left)
    expect(() => expect(left).toBe(right)).toThrow()
    expect(left).toEqual(right)
`, "utf8");
  const execution = velar(["test", directory]);
  assert.equal(execution.status, 0, execution.output);
  assert.match(execution.output, /7 passed/u);
});

test("[D59-141] the test module reaches for the Core comparison instead of restating it", async () => {
  const { standardModuleSource } = await import("../packages/cli/src/standard-modules.ts");
  const source = standardModuleSource("velar/test");
  assert.ok(source);
  // D50 rule 97.2 forbids a second comparison implementation living here, and
  // rule 141 puts `toBe` under the same rule: both matchers import the Core
  // operation rather than spelling one out.
  assert.match(source, /import \{ __velarEquals, __velarSameValueZero \}/u);
  assert.match(source, /toBe\(expected\) \{ if \(!__velarSameValueZero\(actual, expected\)\)/u);
  assert.doesNotMatch(source, /toBe\(expected\) \{ if \(actual !== expected\)/u);
  // D59 rule 141.1: the List branch of `toContain` is the same comparison, and
  // the native `===` that used to stand here is gone.
  assert.match(source, /if \(__velarSameValueZero\(__velarDeepGetOwnPropertyDescriptor\(actual, index\)\.value, expected\)\)/u);
  assert.doesNotMatch(source, /__velarDeepGetOwnPropertyDescriptor\(actual, index\)\.value === expected/u);
});

// ---------------------------------------------------------------------------
// D59 rule 141.1 — `toContain` is the language's own `==` too.
// ---------------------------------------------------------------------------

test("[D59-141.1] toContain agrees with List.has, 'in', and == on NaN", { timeout: 300_000 }, async () => {
  // Repairing `toBe` left `toContain` as the last comparison in the language
  // that disagreed with the language: `values.has(nan)` was true while
  // `expect(values).toContain(nan)` was false, from the same List and the same
  // value. The ledger's evidence was execution-level, so this probe runs the
  // real runner rather than reading the emitted module.
  const directory = await makeTemporaryDirectory("velar-d59-141-1-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export const zero = 0\n", "utf8");
  await writeFile(join(directory, "src", "main.test.vel"), `import {expect} from "velar/test"

const nan = 0 / 0
const values = [nan]

test "the List itself says it holds NaN":
    expect(values.has(nan)).toBeTruthy()
    expect(nan in values).toBeTruthy()

test "toContain agrees":
    expect(values).toContain(nan)

test "toContain keeps every answer == already gave":
    expect([-0]).toContain(0)
    expect([0]).toContain(-0)
    expect(["a", "b"]).toContain("b")
    expect([true]).toContain(true)
    expect([null]).toContain(null)

test "toContain still refuses a value the List does not hold":
    expect(() => expect(values).toContain(1)).toThrow()
    expect(() => expect([1, 2]).toContain(3)).toThrow()

test "toContain stays reference identity for values the language compares by reference":
    const inner = [1, 2]
    const twin = [1, 2]
    expect([inner]).toContain(inner)
    expect(() => expect([inner]).toContain(twin)).toThrow()

test "text containment is unchanged: it is code-point identity, not a value comparison":
    expect("VelarScript").toContain("Script")
    expect(() => expect("VelarScript").toContain("script")).toThrow()
`, "utf8");
  const execution = velar(["test", directory]);
  assert.equal(execution.status, 0, execution.output);
  assert.match(execution.output, /6 passed/u);
});
