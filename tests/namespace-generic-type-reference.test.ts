import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectExpressionAt } from "../packages/cli/src/project-semantic.ts";

/**
 * D114 S2 上报 (c): `namespace.Generic<T>` did not parse in a type position.
 *
 * Charter §12 answers a namespace-qualified type by naming the import-by-name
 * spelling (ENM-I9), and `library.Box` earned that one sentence. `library.Box`
 * with type arguments earned nothing of the kind: the type-reference grammar
 * read a member path and then returned *before* the argument list every
 * bare-name reference reads, so the `<` ended the statement and the annotation
 * answered with three recovery messages about lines — VEL2001, VEL2002, and
 * VEL2032 — none of them about the name. One concept, two definitions: the two
 * spellings disagreed about whether `<` may follow a type name.
 *
 * The member path now reads its arguments from the same grammar, so every
 * spelling of the mistake reaches the analyzer whole and earns exactly one
 * refusal, and the refusal names the rewrite the arguments belong on.
 *
 * The refusal itself is unchanged policy. Charter §12 keeps namespace members
 * out of type positions; this file pins that a written argument list changes
 * how the path is *read*, never whether it is accepted.
 */

const LIBRARY = [
  "export type Box<T>:",
  "    value: T",
  "",
  "export type Item:",
  "    label: string",
  "",
  "export enum Status:",
  "    pending",
  "    done",
  "",
  "export class Stack<T>:",
  "    private let items: List<T> = []",
  "",
  "    def push(value: T):",
  "        self.items.append(value)",
  "",
  "    def size() -> number:",
  "        return self.items.size",
  "",
].join("\n");

const NAMESPACE_IMPORT = 'import * as library from "./library.vel"\n';

interface Project {
  readonly directory: string;
  readonly mainPath: string;
  readonly check: (body: string) => Promise<readonly string[]>;
}

async function project(): Promise<Project> {
  const directory = await mkdtemp(join(tmpdir(), "velar-namespace-generic-"));
  const mainPath = join(directory, "consumer.vel");
  await writeFile(join(directory, "library.vel"), LIBRARY, "utf8");
  return {
    directory,
    mainPath,
    check: async (body: string): Promise<readonly string[]> => {
      await writeFile(mainPath, body, "utf8");
      const compiled = await compileProject(mainPath);
      assert.deepEqual(compiled.failures, [], body);
      return compiled.modules.flatMap((module) => module.result.diagnostics)
        .map((item) => `${item.code} ${item.message}`);
    },
  };
}

/** The one sentence a namespace-qualified path earns, with and without arguments. */
const refusal = (member: string, applied: string | null): string =>
  `VEL4001 Namespace members cannot be written in type positions; import '${member}' by name`
  + ` — import {${member}} from "./library.vel" — `
  + (applied !== null ? `and write '${applied}'` : `or bind an enum object first with const ${member} = library.${member}`);

test("a namespace-qualified generic record takes its arguments in every type position", async (t) => {
  const built = await project();
  t.after(() => rm(built.directory, { recursive: true, force: true }));
  const { check } = built;
  const positions: readonly (readonly [label: string, body: string])[] = [
    ["binding annotation", 'const box: library.Box<string> = {value: "a"}\nprint(box.value)\n'],
    ["parameter", 'def take(box: library.Box<string>) -> string:\n    return box.value\nprint(take({value: "a"}))\n'],
    ["result", 'def make() -> library.Box<string>:\n    return {value: "a"}\nprint(make().value)\n'],
    ["record field", 'type Holder:\n    box: library.Box<string>\nconst h: Holder = {box: {value: "a"}}\nprint(h.box.value)\n'],
    ["alias target", 'type Boxed = library.Box<string>\nconst b: Boxed = {value: "a"}\nprint(b.value)\n'],
    ["optional", "const box: library.Box<string>? = null\nprint(str(box == null))\n"],
    ["readonly view", 'const box: readonly library.Box<string> = {value: "a"}\nprint(box.value)\n'],
    ["union member", 'const box: string | library.Box<string> = "a"\nprint(str(box))\n'],
    ["function type result", 'const make: () -> library.Box<string> = () => {value: "a"}\nprint(make().value)\n'],
    ["nested in List", "const boxes: List<library.Box<string>> = []\nprint(str(boxes.size))\n"],
  ];
  for (const [label, body] of positions) {
    assert.deepEqual(await check(NAMESPACE_IMPORT + "\n" + body), [refusal("Box", "Box<string>")], label);
  }
});

test("a namespace-qualified generic class reads the same way, and so does a nested namespace argument", async (t) => {
  const built = await project();
  t.after(() => rm(built.directory, { recursive: true, force: true }));
  const { check } = built;
  assert.deepEqual(
    await check(NAMESPACE_IMPORT + "\nconst stack: library.Stack<number> = library.Stack()\nprint(str(stack.size()))\n"),
    [refusal("Stack", "Stack<number>")],
  );
  // The argument is itself a namespace path. The outer reference is refused
  // before its arguments are validated, so one mistake earns one report even
  // when the author wrote the same mistake twice inside it.
  assert.deepEqual(
    await check(NAMESPACE_IMPORT + '\nconst box: library.Box<library.Item> = {value: {label: "a"}}\nprint(box.value.label)\n'),
    [refusal("Box", "Box<library.Item>")],
  );
});

test("the bare path keeps the sentence it already had", async (t) => {
  const built = await project();
  t.after(() => rm(built.directory, { recursive: true, force: true }));
  const { check } = built;
  for (const [member, body] of [
    ["Box", 'const box: library.Box = {value: "a"}\nprint(box.value)\n'],
    ["Stack", "const stack: library.Stack = library.Stack()\nprint(str(stack.size()))\n"],
    ["Item", 'const item: library.Item = {label: "a"}\nprint(item.label)\n'],
  ] as const) {
    assert.deepEqual(await check(NAMESPACE_IMPORT + "\n" + body), [refusal(member, null)], body);
  }
});

test("an erased runtime check refuses the path once, with arguments and without", async (t) => {
  const built = await project();
  t.after(() => rm(built.directory, { recursive: true, force: true }));
  const { check } = built;
  const subject = "const value: unknown = 1\n";
  assert.deepEqual(
    await check(`${NAMESPACE_IMPORT}\n${subject}if value is library.Stack<number>:\n    print("y")\n`),
    [refusal("Stack", "Stack<number>")],
  );
  assert.deepEqual(
    await check(`${NAMESPACE_IMPORT}\n${subject}if value is library.Stack:\n    print("y")\n`),
    [refusal("Stack", null)],
  );
});

test("a namespace-qualified enum member is one reference too, and names the import", async (t) => {
  const built = await project();
  t.after(() => rm(built.directory, { recursive: true, force: true }));
  const { check } = built;
  assert.deepEqual(
    await check(`${NAMESPACE_IMPORT}\nconst state: library.Status.pending = library.Status.pending\nprint(str(state))\n`),
    ['VEL4001 Namespace members cannot be written in type positions; import \'Status\' by name'
      + ' — import {Status} from "./library.vel" — and write \'Status.pending\''],
  );
});

test("a path deeper than a namespace names nothing, and says so once", () => {
  assert.deepEqual(
    compile("const value: outer.middle.inner.leaf = 1\nprint(str(value))\n").diagnostics
      .map((item) => `${item.code} ${item.message}`),
    ["VEL4001 A type is named by one name, or by an enum member written as 'Enum.member'"
      + "; 'outer.middle.inner.leaf' is neither"],
  );
});

test("an enum member type takes no arguments, and the refusal names the member rather than the grammar", () => {
  const enumeration = "enum Status:\n    pending\n    done\n\n";
  assert.deepEqual(
    compile(`${enumeration}const state: Status.pending<string> = Status.pending\nprint(str(state))\n`).diagnostics
      .map((item) => `${item.code} ${item.message}`),
    ["VEL4001 Enum singleton type 'Status.pending' takes no type arguments; it names one member of 'Status'"],
  );
  // The spelling without arguments is the ordinary one and stays untouched.
  assert.deepEqual(compile(`${enumeration}const state: Status.pending = Status.pending\nprint(str(state))\n`).diagnostics, []);
});

test("the rewrite the refusal names is the one that compiles, and the editor reads the instantiation back", async (t) => {
  const built = await project();
  t.after(() => rm(built.directory, { recursive: true, force: true }));
  const { mainPath, check } = built;
  assert.deepEqual(
    await check(NAMESPACE_IMPORT + '\nconst box: library.Box<string> = {value: "kept"}\nprint(box.value)\n'),
    [refusal("Box", "Box<string>")],
  );
  const rewritten = [
    'import {Box, Stack} from "./library.vel"',
    "",
    'const box: Box<string> = {value: "kept"}',
    "const stack: Stack<number> = Stack()",
    "stack.push(1)",
    'print(f"{box.value} {stack.size()}")',
    "",
  ].join("\n");
  await writeFile(mainPath, rewritten, "utf8");
  const compiled = await compileProject(mainPath);
  assert.deepEqual(compiled.failures, []);
  assert.deepEqual(compiled.modules.flatMap((module) => module.result.diagnostics), []);

  const main = compiled.modules.find((module) => module.inputPath === mainPath);
  const typeOf = (name: string): string | null | undefined =>
    main?.result.semanticIndex.symbols.find((item) => item.name === name)?.type;
  assert.equal(typeOf("box"), "Box<string>");
  assert.equal(typeOf("stack"), "Stack<number>");

  const hover = projectExpressionAt(compiled, mainPath, rewritten.indexOf("box.value") + "box.va".length);
  assert.equal(hover?.ownerType, "Box<string>");
  assert.equal(hover?.type, "string");
});

test("the formatter round-trips every namespace-qualified spelling, and is idempotent on it", () => {
  const sources = [
    'const box: library.Box<string> = {value: "a"}\n',
    "const boxes: List<library.Box<string>> = []\n",
    'const box: library.Box<library.Item> = {value: {label: "a"}}\n',
    "const box: library.Box<string>? = null\n",
    'const box: readonly library.Box<string> = {value: "a"}\n',
    "const state: library.Status.pending = library.Status.pending\n",
    'def take(box: library.Box<string>, other: library.Box<number>) -> library.Box<string>:\n    print(str(other))\n    return box\n',
    "type Holder:\n    box: library.Box<string>\n",
    "type Boxed = library.Box<string>\n",
  ];
  for (const body of sources) {
    const source = `${NAMESPACE_IMPORT}\n${body}`;
    const once = formatSource(source);
    assert.equal(once, source, body);
    assert.equal(formatSource(once), once, body);
  }
});

test("the local spelling is untouched: a generic record and a generic class still resolve and run", () => {
  const source = [
    "type Box<T>:",
    "    value: T",
    "",
    "class Stack<T>:",
    "    private let items: List<T> = []",
    "",
    "    def push(value: T):",
    "        self.items.append(value)",
    "",
    "    def size() -> number:",
    "        return self.items.size",
    "",
    'const box: Box<string> = {value: "kept"}',
    "const stack: Stack<number> = Stack()",
    "stack.push(1)",
    'print(f"{box.value} {stack.size()}")',
    "",
  ].join("\n");
  assert.deepEqual(compile(source).diagnostics, []);
});
