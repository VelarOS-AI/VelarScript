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

mount(<App />, "#app")
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

mount(<App />, "#app")
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
