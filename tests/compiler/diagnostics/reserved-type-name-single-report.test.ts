import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../../packages/web/src/compiler.ts";

/**
 * Charter §5: a reserved name is refused where the declaration is written, and
 * one declaration earns one report.
 *
 * D114 S4b closed the Core roster and filed four shapes it left open. Two were
 * double reports — one mistake answered twice, by two rules that both happened
 * to cover the name — and two were declarations accepted at the name slot and
 * then unusable at every annotation, answering with a message about something
 * else.
 *
 * (a) `class Text:` reported the bound vocabulary's refusal (VEL4021) and
 *     "'Text' is a reserved Core binding" (VEL3007). The bound's sentence says
 *     *why* the name is taken — a same-named user type loses to the bound at
 *     every `<T: Data>` — so it is the one that survives.
 * (b) `type Duration:` in a Web module reported Core's roster (VEL3007) and the
 *     Web extension's (VEL5065). `Duration` is on both rosters; the Web
 *     sentence names the surface the author is writing against.
 * (c) `type null:` never reached a declaration at all — `type` is contextual,
 *     so the line read as an expression and answered with the statement-layout
 *     recovery. `class null:` and `enum null:` answered "Expected a class name"
 *     and a cascade after it. None of the three named the rule.
 * (d) `type readonly:` was accepted and then unreachable: every annotation
 *     answered "Expected a type name", because the type-reference grammar takes
 *     `readonly` as the read-only view modifier before it reads a name.
 *
 * The neighbours of (d) in the same slot are the guided spellings — `Array`,
 * `str`, `void` — which declared a name every annotation rewrites to the type
 * the guidance names, so `const value: Array` answered "Unknown type 'List'".
 */

const reports = (source: string): readonly string[] =>
  compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);

const webReports = (source: string): readonly string[] =>
  compile(source, { path: "probe.vel", extensions: [velarCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);

/** The three declaring forms that own a type name, as `<noun, source>` pairs. */
const forms: readonly (readonly [noun: "type" | "class" | "enum", source: (name: string) => string])[] = [
  ["type", (name) => `type ${name}:\n    label: string\n`],
  ["class", (name) => `class ${name}:\n    const label: string\n\n    constructor(label: string):\n        self.label = label\n`],
  ["enum", (name) => `enum ${name}:\n    one\n    two\n`],
];

const article = (noun: string): string => (/^[aeiou]/iu.test(noun) ? "an" : "a");

const boundRefusal = (name: string, noun: string): string =>
  `VEL4021 '${name}' is a reserved type-parameter bound — the bounds are Comparable, Text, Data`
  + ` — so it cannot also name ${article(noun)} ${noun}; rename this declaration`;

const webRefusal = (name: string, noun: string): string =>
  `VEL5065 '${name}' is a Web type name, so it cannot also name ${article(noun)} ${noun}`
  + "; every use of it in a Web module resolves to the built-in. Rename this declaration";

const slotRefusal = (name: string, noun: string, because: string, instead: string): string =>
  `VEL3007 '${name}' ${because}, so it cannot name ${article(noun)} ${noun}; every use of it would read as ${instead}`;

// ---------------------------------------------------------------------------
// (a) a bound name is refused once, by the rule that says why it is taken
// ---------------------------------------------------------------------------

test("[D114 S4b a] a declaration spelled with a bound name earns the bound's sentence, alone", () => {
  // `Text` is the one bound that is also a reserved Core binding, which is what
  // made it report twice. `Comparable` and `Data` are on the bound roster only
  // and were always single; they are here so the rule is pinned for the roster
  // rather than for the name that exposed it.
  for (const [noun, source] of forms) {
    for (const name of ["Text", "Comparable", "Data"]) {
      assert.deepEqual(reports(source(name)), [boundRefusal(name, noun)], source(name));
    }
  }
  assert.deepEqual(reports("type Text = string\n"), [boundRefusal("Text", "type")]);
});

test("[D114 S4b a] the import positions answer the same way", () => {
  assert.deepEqual(reports('import * as Text from "velar/url"\n'), [boundRefusal("Text", "import alias")]);
  assert.deepEqual(reports('import js {readFile as Data} from "node:fs"\n'), [boundRefusal("Data", "import alias")]);
});

test("[D114 S4b a] a reserved binding that is not a bound keeps its own sentence", () => {
  // Nothing more specific covers these, so the general reserved-binding report
  // is the only one there is and it must still be said.
  assert.deepEqual(reports("type Json:\n    label: string\n"), ["VEL3007 'Json' is a reserved Core binding"]);
  assert.deepEqual(reports("type Error:\n    label: string\n"), ["VEL3007 'Error' is a reserved Core binding"]);
  assert.deepEqual(
    reports("type Promise:\n    label: string\n"),
    ["VEL3007 'Promise' is a Core type name, so it cannot also name a type"
      + "; every use of it resolves to the built-in. Rename this declaration"],
  );
});

// ---------------------------------------------------------------------------
// (b) two rosters, one report — without either side learning the other's
// ---------------------------------------------------------------------------

test("[D114 S4b b] a name on both rosters is refused by the Web sentence, alone", () => {
  for (const [noun, source] of forms) {
    assert.deepEqual(webReports(source("Duration")), [webRefusal("Duration", noun)], source("Duration"));
  }
  assert.deepEqual(webReports("type Duration = string\n"), [webRefusal("Duration", "type")]);
  assert.deepEqual(webReports('import {ms as Duration} from "velar/look"\n'), [webRefusal("Duration", "import alias")]);
});

test("[D114 S4b b] each roster still answers alone for the names only it owns", () => {
  assert.deepEqual(webReports("type Event:\n    label: string\n"), [webRefusal("Event", "type")]);
  assert.deepEqual(
    webReports("type List:\n    label: string\n"),
    ["VEL3007 'List' is a Core type name, so it cannot also name a type"
      + "; every use of it resolves to the built-in. Rename this declaration"],
  );
  // Outside a Web module the Web roster does not exist, so Core answers for
  // `Duration` there — the precedence is a choice between two live reports, not
  // a hole in Core's.
  assert.deepEqual(
    reports("type Duration:\n    label: string\n"),
    ["VEL3007 'Duration' is a Core type name, so it cannot also name a type"
      + "; every use of it resolves to the built-in. Rename this declaration"],
  );
  // The standard-module import of the name under itself *is* the built-in
  // surface, and stays accepted.
  assert.deepEqual(webReports('import {Duration, ms} from "velar/look"\n'), []);
});

// ---------------------------------------------------------------------------
// (c) a reserved word in the name slot names the rule
// ---------------------------------------------------------------------------

test("[D114 S4b c] a reserved word is refused in the name slot of all three forms", () => {
  for (const [noun, source] of forms) {
    for (const name of ["null", "true", "false"]) {
      assert.deepEqual(
        reports(source(name)),
        [slotRefusal(name, noun, "is a reserved word", "the literal")],
        source(name),
      );
    }
    for (const name of ["if", "import", "return", "class", "await"]) {
      assert.deepEqual(
        reports(source(name)),
        [slotRefusal(name, noun, "is a reserved word", "the keyword")],
        source(name),
      );
    }
  }
});

test("[D114 S4b c] the alias form and the readonly record form answer the same way", () => {
  assert.deepEqual(reports("type null = string\n"), [slotRefusal("null", "type", "is a reserved word", "the literal")]);
  assert.deepEqual(
    reports("readonly type null:\n    label: string\n"),
    [slotRefusal("null", "type", "is a reserved word", "the literal")],
  );
});

test("[D114 S4b c] the refused declaration is skipped, so its body reports nothing after it", () => {
  // The body used to be parsed as loose statements: `enum null:` answered with
  // seven messages, six of them about the members it could no longer place.
  assert.deepEqual(
    reports("enum null:\n    one\n    two\n\nprint(\"after\")\n"),
    [slotRefusal("null", "enum", "is a reserved word", "the literal")],
  );
  assert.deepEqual(
    reports("class null:\n    const label: string\n\n    constructor(label: string):\n        self.label = label\n\nprint(\"after\")\n"),
    [slotRefusal("null", "class", "is a reserved word", "the literal")],
  );
});

test("[D114 S4b c] a reserved word elsewhere on the line is still an ordinary parse error", () => {
  // The name slot is the only position this rule reaches. `type Box extends
  // null:` is a wrong base type, not a wrong name, and it keeps whatever the
  // grammar already said about it.
  assert.deepEqual(reports("type Box:\n    label: string\n").length, 0);
  assert.ok(reports("const null = 1\n").every((message) => !message.includes("cannot name a type")));
});

// ---------------------------------------------------------------------------
// (d) a name a type position cannot spell as itself
// ---------------------------------------------------------------------------

test("[D114 S4b d] 'readonly' is refused where it is written, in all three forms", () => {
  for (const [noun, source] of forms) {
    assert.deepEqual(
      reports(source("readonly")),
      [slotRefusal("readonly", noun, "is the read-only view modifier", "the modifier")],
      source(noun),
    );
  }
  assert.deepEqual(
    reports("type readonly = string\n"),
    [slotRefusal("readonly", "type", "is the read-only view modifier", "the modifier")],
  );
  // Before this, the declaration was accepted and the annotation that used it
  // answered "Expected a type name" — a message about the grammar, at a line
  // the author had written correctly for the name they had declared.
  //
  // CO-D1: the annotation keeps its own report, because with no declaration in
  // force `const value: readonly` is the grammar error it always was — the
  // type-reference grammar takes `readonly` as the view modifier before it
  // reads a name. Until CO-D1 the second report was invisible, and not because
  // anything suppressed it: the refused declaration's skip was synchronized
  // over a second time and that line was eaten whole.
  assert.deepEqual(
    reports('type readonly:\n    label: string\n\nconst value: readonly = {label: "a"}\nprint(value.label)\n'),
    [
      slotRefusal("readonly", "type", "is the read-only view modifier", "the modifier"),
      "VEL2001 Expected a type name",
    ],
  );
});

test("[D114 S4b d] a guided spelling is refused for the same reason: the annotation would name another type", () => {
  const guided: readonly (readonly [name: string, replacement: string])[] = [
    ["Array", "List"],
    ["array", "List"],
    ["list", "List"],
    ["dict", "Map"],
    ["set", "Set"],
    ["str", "string"],
    ["String", "string"],
    ["Number", "number"],
    ["boolean", "bool"],
    ["Boolean", "bool"],
    ["void", "null"],
  ];
  for (const [name, replacement] of guided) {
    for (const [noun, source] of forms) {
      assert.deepEqual(
        reports(source(name)),
        [slotRefusal(name, noun, `is guided to '${replacement}' in every type position`, `'${replacement}'`)],
        source(name),
      );
    }
  }
  // `type Array:` used to be accepted, and the annotation under it answered
  // with the guidance and then "Unknown type 'List'" — three reports, the last
  // of them about a type nobody wrote. That last one is the one the refusal
  // removes: `Array` in a type position is guided to `List` whether or not
  // anybody wrote `type Array:`, so the annotation still earns the guidance at
  // its own site (CO-D1 stopped the line being eaten, which is the only reason
  // it did not appear here before).
  assert.deepEqual(
    reports('type Array:\n    label: string\n\nconst value: Array = {label: "a"}\nprint(value.label)\n'),
    [
      slotRefusal("Array", "type", "is guided to 'List' in every type position", "'List'"),
      "VEL2012 Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type",
    ],
  );
});

test("[D114 item 9] a guided spelling whose successor is a shape is refused in the same slots", () => {
  // Until D114 item 9 these three were the exception: `type object:` was
  // accepted and every `x: object` after it refused, which is precisely the
  // "declaration writable, every use refused" shape this file is about. Their
  // successor is a shape rather than a name, so the refusal carries the shape.
  const advice: Readonly<Record<string, string>> = {
    object: "declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary",
    Object: "declare a named 'type' for the shape, or use 'unknown' at an unchecked boundary",
    Callable: "write an explicit function type such as '(value: string) -> bool'",
  };
  for (const [name, replacement] of Object.entries(advice)) {
    assert.deepEqual(
      reports(`type ${name}:\n    label: string\n`),
      [`VEL3007 '${name}' is a guided spelling no type position accepts, so it cannot name a type; ${replacement}`],
      name,
    );
  }
});

test("[D114 S4b] a name none of these rules covers still declares, and still runs", () => {
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
    'print(f"{box.label} {Crate(\"c\").label} {str(Size.small)}")',
    "",
  ].join("\n")), []);
  // A name that merely *contains* a refused word is an ordinary name.
  assert.deepEqual(reports("type Nullable:\n    label: string\n"), []);
  assert.deepEqual(reports("type ReadonlyView:\n    label: string\n"), []);
  assert.deepEqual(reports("type Arrays:\n    label: string\n"), []);
});

// ---------------------------------------------------------------------------
// CO-D1: the refusal is the whole of what the mistake earns, whatever follows
// ---------------------------------------------------------------------------

/**
 * The 0.32.0 audit's own table. Thirteen of these names — the eleven guided
 * spellings that carry a replacement, plus `readonly` and `null` — reported
 * twice in every real file, because "a real file" means "the declaration is not
 * the last thing in it". `class str:` followed by `@main:` added "this indented
 * line continues nothing" pointing at a correct `print`; followed by a `def` it
 * added "Executable module code must be placed inside the module's '@main'
 * region" about a `return` that was inside a function body; followed by an
 * ordinary binding it silently ate the binding instead.
 *
 * The other eleven were single already, and are here for the same reason the
 * bound roster is tested above the name that exposed it: the table is the unit,
 * not the row. `any` is the twenty-fifth, and is refused in these three
 * positions too (CO-D2 gives it the fourth).
 */
const refusedDeclarationNames: readonly string[] = [
  "int", "float", "undefined", "NaN", "Infinity", "bool", "number", "string", "object", "Object", "Callable",
  "str", "Array", "array", "list", "dict", "set", "String", "Number", "boolean", "Boolean", "void", "readonly", "null",
  "any",
];

/** The three declaring positions, each with a body the refusal has to skip. */
const declaringPositions: Readonly<Record<string, (name: string) => string>> = {
  class: (name) => `class ${name}:\n    let x: number = 1\n`,
  type: (name) => `type ${name}:\n    x: number\n`,
  enum: (name) => `enum ${name}:\n    one\n    two\n`,
};

/**
 * What comes after it: the two shapes the audit recorded, and the one-line
 * binding whose loss was silent — the same defect with no report to notice it
 * by, which is why it is pinned here beside the two that were loud.
 */
const followingCode: Readonly<Record<string, string>> = {
  "@main": '\n@main:\n    print("ok")\n',
  def: '\ndef f() -> string:\n    return "y"\n\n@main:\n    print(f())\n',
  binding: '\nconst q: number = 2\n\n@main:\n    print(f"{q}")\n',
};

test("[CO-D1] a refused declaration name reports once, and the code after it reports nothing", () => {
  for (const [position, declaration] of Object.entries(declaringPositions)) {
    for (const [shape, tail] of Object.entries(followingCode)) {
      // The control proves the three tails are correct code on their own, so a
      // cell below can only be reporting the refusal.
      assert.deepEqual(reports(declaration("Thing") + tail), [], `${position} / ${shape}`);
      for (const name of refusedDeclarationNames) {
        const source = declaration(name) + tail;
        const found = reports(source);
        assert.equal(found.length, 1, `${position} ${name} / ${shape}\n${source}\n${found.join("\n")}`);
        assert.ok(found[0]!.startsWith("VEL3007 "), `${position} ${name} / ${shape}: ${found[0]}`);
        assert.ok(found[0]!.includes(`'${name}'`), `${position} ${name} / ${shape}: ${found[0]}`);
      }
    }
  }
});

test("[CO-D1] the statement after a refused declaration is parsed, not discarded", () => {
  // The second synchronize did not always report: when the next line was an
  // ordinary statement it was eaten in silence, so the module compiled without
  // a binding its author had written. Reading `q` is what proves it is there.
  assert.deepEqual(
    reports('class str:\n    let x: number = 1\n\nconst q: number = 2\n\n@main:\n    print(f"{q}")\n'),
    [slotRefusal("str", "class", "is guided to 'string' in every type position", "'string'")],
  );
  // Two refused declarations are two reports, and neither swallows the other.
  assert.deepEqual(
    reports('class str:\n    let x: number = 1\n\nenum void:\n    one\n\n@main:\n    print("ok")\n'),
    [
      slotRefusal("str", "class", "is guided to 'string' in every type position", "'string'"),
      slotRefusal("void", "enum", "is guided to 'null' in every type position", "'null'"),
    ],
  );
  // A refused declaration nested in a block is skipped by the same rule.
  assert.deepEqual(
    reports('@main:\n    class str:\n        let x: number = 1\n    print("ok")\n'),
    [slotRefusal("str", "class", "is guided to 'string' in every type position", "'string'")],
  );
});
