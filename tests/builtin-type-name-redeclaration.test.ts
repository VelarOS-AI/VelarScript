import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * Charter §5: the built-in Core types are reserved type names.
 *
 * The rule was already written twice — §7 for the three type-parameter bounds
 * and §6 for the Web type names — and enforced for one Core name by accident.
 * `type Promise:` was refused because `Promise` is *also* a reserved Core
 * binding; `type List:` and `type Function:` were accepted and then never
 * reached, and `type Duration:` was accepted and then told, at the use, that
 * `{label: "a"}` could not be assigned to a type the author had just declared.
 * Half the roster lost the other way: `type List:` left bare `List` meaning the
 * user record while `List<string>` on the next line still meant the built-in,
 * so one module had two readings of one name.
 *
 * Every declaring position now asks one question of one roster and reports one
 * sentence, the same sentence the Web extension already says about its own
 * names (VEL5065).
 */

/**
 * `builtinTypeNames` in packages/compiler/src/analyzer.ts, restated. It is not
 * exported, so this is a second copy on purpose: a built-in added there fails
 * here until it is added here too, and that is exactly the moment to check the
 * new name is refused in every position below.
 */
const BUILTIN_TYPE_NAMES = [
  "string", "number", "bool", "null", "unknown", "any",
  "List", "Set", "Map", "Record", "Promise", "Function", "Type", "Duration",
] as const;

/**
 * `null` is a hard keyword, so it never reaches a declaration to be refused
 * there — the parser stops it at the name slot. Every other spelling parses.
 */
const DECLARABLE = BUILTIN_TYPE_NAMES.filter((name) => name !== "null");

const refusal = (name: string, position: string): string =>
  `'${name}' is a Core type name, so it cannot also name ${/^[aeiou]/iu.test(position) ? "an" : "a"} ${position}`
  + "; every use of it resolves to the built-in. Rename this declaration";

const reports = (source: string): readonly string[] =>
  compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);

const declarations: readonly (readonly [position: string, source: (name: string) => string])[] = [
  ["type", (name) => `type ${name}:\n    label: string\n`],
  ["type", (name) => `type ${name} = string\n`],
  ["class", (name) => `class ${name}:\n    const label: string\n\n    constructor(label: string):\n        self.label = label\n`],
  ["enum", (name) => `enum ${name}:\n    one\n    two\n`],
];

test("every built-in Core type name is refused in every declaration position", () => {
  assert.equal(DECLARABLE.length, 13);
  for (const [position, source] of declarations) {
    for (const name of DECLARABLE) {
      assert.deepEqual(
        reports(source(name)),
        [`VEL3007 ${refusal(name, position)}`],
        source(name),
      );
    }
  }
});

test("the refusal is the only report the declaration earns", () => {
  // `Promise`, `Set`, `Map` and `number` are reserved Core bindings as well as
  // built-in type names — the four the old rule reached by accident. A `type`
  // spelled with one is one mistake, so it earns one sentence, and it is the
  // one about the type rather than the one about the binding.
  for (const name of ["number", "Set", "Map", "Promise"]) {
    assert.deepEqual(reports(`type ${name}:\n    label: string\n`), [`VEL3007 ${refusal(name, "type")}`]);
  }
});

test("a name reserved as a binding but not as a type keeps its own message", () => {
  // `Json`, `Text` and `Math` are permanent namespaces and `Error` is a Core
  // builtin, but none of them names a type, so none of them is touched here.
  assert.deepEqual(reports("type Json:\n    label: string\n"), ["VEL3007 'Json' is a reserved Core binding"]);
  assert.deepEqual(reports("type Error:\n    label: string\n"), ["VEL3007 'Error' is a reserved Core binding"]);
});

test("'null' is stopped in the name slot, before any declaration exists", () => {
  for (const [, source] of declarations) {
    const diagnostics = reports(source("null"));
    assert.ok(diagnostics.length > 0, source("null"));
    assert.deepEqual(diagnostics.filter((message) => message.startsWith("VEL3007")), [], source("null"));
  }
  // The class and enum forms name the rule where they stop; `type null:` and
  // `type null = string` land on the statement-layout message instead, which is
  // the parser's recovery for a keyword in an expression, not a sentence about
  // reserved names.
  assert.ok(reports("class null:\n    const label: string\n")[0]?.includes("Expected a class name"));
  assert.ok(reports("enum null:\n    one\n")[0]?.includes("Expected an enum name"));
});

test("a type parameter spelled with a built-in stays refused, by the rule that already covered it", () => {
  // This position was closed before this change and reads the same roster
  // through `isDeclaredTypeName`, so it keeps VEL4021's wider sentence: a type
  // parameter may not shadow *any* declared type name, built-in or authored.
  for (const name of DECLARABLE) {
    const source = `def identity<${name}>(value: string) -> string:\n    return value\n`;
    assert.deepEqual(
      reports(source).filter((message) => message.startsWith("VEL4021")),
      [`VEL4021 Type parameter '${name}' shadows an existing type name; choose another name`],
      source,
    );
  }
  assert.deepEqual(
    reports("def identity<List>(value: string) -> string:\n    return value\n"),
    ["VEL4021 Type parameter 'List' shadows an existing type name; choose another name"],
  );
});

test("a JavaScript import binds the name under itself, and is refused as an imported name", () => {
  assert.deepEqual(
    reports('import js {List} from "./thing.js"\n').filter((message) => message.startsWith("VEL3007")),
    [`VEL3007 ${refusal("List", "imported name")}`],
  );
  assert.deepEqual(
    reports('import * as List from "velar/collections"\n'),
    [`VEL3007 ${refusal("List", "import alias")}`],
  );
});

test("a module may export a legal name, and importing it under a built-in alias is refused at the import", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-builtin-type-name-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const libraryPath = join(directory, "library.vel");
  const consumerPath = join(directory, "consumer.vel");

  await writeFile(libraryPath, ["export type Box:", "    label: string", ""].join("\n"), "utf8");
  await writeFile(consumerPath, [
    'import {Box as List} from "./library.vel"',
    "",
    'const value: List = {label: "a"}',
    "print(value.label)",
    "",
  ].join("\n"), "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(
    project.modules.flatMap((module) => module.result.diagnostics).map((item) => `${item.code} ${item.message}`),
    [`VEL3007 ${refusal("List", "import alias")}`],
  );

  // The same import under a name of the author's own is the ordinary case, and
  // it stays ordinary.
  await writeFile(consumerPath, [
    'import {Box as Crate} from "./library.vel"',
    "",
    'const value: Crate = {label: "a"}',
    "print(value.label)",
    "",
  ].join("\n"), "utf8");
  const accepted = await compileProject(consumerPath);
  assert.deepEqual(accepted.failures, []);
  assert.deepEqual(accepted.modules.flatMap((module) => module.result.diagnostics), []);
});

test("a standard module may publish a name that is also a built-in, and importing it under itself is not a redeclaration", () => {
  // `velar/look` republishes `Duration`, which Core owns as a primitive. An
  // import of the name under itself *is* the built-in surface, so only a
  // binding that would make the name mean something else is refused — the
  // carve-out D72 rule 186 already makes for `import {Color} from
  // "velar/look"`. The remaining diagnostics come from compiling a Web module
  // without its module interfaces wired, and none of them is a refusal.
  const web = (source: string) => compileSourceWithWeb(source).map((item) => `${item.code} ${item.message}`);
  assert.deepEqual(
    web('import {Duration, ms} from "velar/look"\n').filter((message) => /VEL3007|VEL5065/u.test(message)),
    [],
  );
  assert.deepEqual(
    web('import {ms as Duration} from "velar/look"\n').filter((message) => message.startsWith("VEL3007")),
    [`VEL3007 ${refusal("Duration", "import alias")}`],
  );
});

test("a Core built-in is refused inside a Web module too, and a Web-only name still answers for itself", () => {
  const web = (source: string) => compileSourceWithWeb(source).map((item) => `${item.code} ${item.message}`);
  assert.deepEqual(
    web("type List:\n    label: string\n"),
    [`VEL3007 ${refusal("List", "type")}`],
  );
  assert.deepEqual(
    web("type Event:\n    label: string\n").filter((message) => message.startsWith("VEL3007")),
    [],
  );
  // `Duration` is the one name on both rosters — Core owns it as a primitive
  // and velar/look republishes it — so a Web module reports it from both
  // surfaces. Two true sentences about one line; deduplicating them would mean
  // Core learning the extension's roster or the extension learning Core's.
  assert.deepEqual(
    web("type Duration:\n    label: string\n"),
    [
      `VEL3007 ${refusal("Duration", "type")}`,
      "VEL5065 'Duration' is a Web type name, so it cannot also name a type; every use of it in a Web module resolves to the built-in. Rename this declaration",
    ],
  );
});

test("a declaration below module scope reports the name and the scope, both", () => {
  // Neither declaration reaches the module-scope predeclaration pass, so both
  // ask the question on the way through `declareBinding` instead.
  assert.deepEqual(
    reports('def wrap() -> string:\n    type List:\n        label: string\n    return "a"\n'),
    [`VEL3007 ${refusal("List", "type")}`, "VEL3011 Types can only be declared at module scope"],
  );
  assert.deepEqual(
    reports('def wrap() -> string:\n    import js {readFile as List} from "node:fs"\n    return "a"\n'),
    ["VEL3011 Imports can only be declared at module scope", `VEL3007 ${refusal("List", "import alias")}`],
  );
});

test("the rule is about type names, so ordinary bindings spelled the same are untouched", () => {
  // `const List = 3` shadows the built-in *value* and nothing else: `List` in a
  // type position still means the built-in there, so there is no second reading
  // for the rule to prevent.
  assert.deepEqual(reports("const List = 3\nprint(str(List))\n"), []);
  assert.deepEqual(reports('def Record() -> string:\n    return "a"\n\nprint(Record())\n'), []);
});

test("an unrelated user type, class, and enum still declare", () => {
  assert.deepEqual(reports([
    "type Box:",
    "    label: string",
    "",
    "class Crate:",
    "    const label: string",
    "",
    "    constructor(label: string):",
    "        self.label = label",
    "",
    "enum Size:",
    "    small",
    "    large",
    "",
    'const box: Box = {label: "a"}',
    "print(box.label)",
    'print(Crate("c").label)',
    "print(str(Size.small))",
    "",
  ].join("\n")), []);
  assert.deepEqual(reports("readonly type Snapshot:\n    label: string\n"), []);
});

function compileSourceWithWeb(source: string) {
  return compile(source, { extensions: [velarCompilerExtension] }).diagnostics;
}
