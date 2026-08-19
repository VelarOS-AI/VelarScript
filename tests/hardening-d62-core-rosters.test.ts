import assert from "node:assert/strict";
import test from "node:test";
import {
  bindingNameRestriction,
  compile,
  CORE_CONTEXTUAL_KEYWORD_WORDS,
  CORE_CONTEXTUAL_KEYWORDS,
  CORE_NUMERIC_SUFFIXES,
  CORE_STATEMENT_HEAD_KEYWORDS,
  CORE_WORDS,
  formatSource,
  keywordKinds,
} from "@velarscript/compiler";
import { Lexer } from "../packages/compiler/src/lexer.ts";
import { completionItemsFor } from "../packages/cli/src/language-server.ts";

// ---------------------------------------------------------------------------
// D62 rules 157/158 — Core's two missing rosters.
//
// Rule 157 is D57 rule 134's family in its purest form: the seven earlier
// instances each had an authority and a second hand-kept copy of it, while
// this one had *no original at all*. Four consumers each invented a partial
// copy — `parser.ts` held one word in a table and the rest as inline literals
// at each shape, `formatter.ts` held two, `language-server.ts` held six of the
// ten plus thirty-three of the forty hard keywords — and not one of them was
// complete. Charter §3 makes a cross-cutting claim about this family (each
// word is an ordinary name in seven positions), and nothing could enumerate
// the set that claim is about.
//
// These tests pin the derivation rather than the members: adding a word to
// `core-vocabulary.ts` is the whole change, and every assertion below reads
// the roster rather than restating it. The two that do name members name them
// to prove the roster did not quietly shrink.
// ---------------------------------------------------------------------------

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

// ---------------------------------------------------------------------------
// The roster is an original, not another copy
// ---------------------------------------------------------------------------

test("[D62-157] the roster is well formed and disjoint from the hard keywords", () => {
  assert.deepEqual([...CORE_CONTEXTUAL_KEYWORD_WORDS], [
    "as", "case", "constructor", "from", "get", "json", "match", "readonly", "test", "type", "using",
  ]);
  // Sorted and unique, so a later addition has one obvious place to go.
  assert.deepEqual([...CORE_CONTEXTUAL_KEYWORD_WORDS], [...new Set(CORE_CONTEXTUAL_KEYWORD_WORDS)].sort());
  for (const entry of CORE_CONTEXTUAL_KEYWORDS) {
    // A contextual keyword is by definition one the lexer does *not* reserve;
    // a word in both tables would be a contradiction rather than a duplicate.
    assert.ok(!Object.hasOwn(keywordKinds, entry.word), `${entry.word} is a hard keyword`);
    assert.ok(entry.shape.length > 0, `${entry.word} records no shape`);
  }
  // The keyed form and the list are the same roster, so `CORE_WORDS.type` can
  // never name a word the list has dropped.
  assert.deepEqual(Object.keys(CORE_WORDS).sort(), [...CORE_CONTEXTUAL_KEYWORD_WORDS].sort());
  for (const [key, value] of Object.entries(CORE_WORDS)) assert.equal(key, value);
});

test("[D62-157] the lexer emits every roster word as an ordinary identifier", () => {
  // The membership rule in one assertion: these are words the *lexer* hands
  // over as names, which is what leaves the parser free to claim them by shape
  // and leaves an author free to spell them anywhere a name can stand.
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    const lexed = new Lexer(`${word}\n`).lex();
    assert.deepEqual(lexed.diagnostics, [], word);
    assert.equal(lexed.tokens[0]?.kind, "identifier", word);
    assert.equal(lexed.tokens[0]?.value, word, word);
  }
});

test("[D62-157] words the parser recognizes only in order to refuse them are not on the roster", () => {
  // D62 rule 157 warns against scraping the parser for this roster: `invert`
  // is a removed statement the parser still recognizes so it can teach the
  // replacement, and a scraped roster would demand it back. `init`, `set` and
  // `default` are the same shape of thing — a spelling the language does not
  // have, recognized only to say so.
  for (const word of ["invert", "init", "set", "default"]) {
    assert.ok(!(CORE_CONTEXTUAL_KEYWORD_WORDS as readonly string[]).includes(word), `${word} is on the roster`);
  }
  // Each is still refused with its own directed message, which is why keeping
  // them off the roster costs nothing.
  assert.ok(messages("class Box:\n    init:\n        print(1)\n").some((item) => item.includes("the separate 'init:' block was removed")));
  assert.ok(messages("class Box:\n    set name(value: string):\n        print(1)\n").some((item) => item.includes("VelarScript classes have no setters")));
  assert.ok(messages("export default 1\n").some((item) => item.includes("VelarScript modules have no default export")));
  // `@dispose` is not on the roster either: it is only ever read after `@`,
  // which is D43 item 67's separate closed vocabulary.
  assert.ok(!(CORE_CONTEXTUAL_KEYWORD_WORDS as readonly string[]).includes("dispose"));
});

// ---------------------------------------------------------------------------
// Charter §3's cross-cutting claim, now enumerable
// ---------------------------------------------------------------------------

/** Charter §3's seven positions, one compilable module each. */
const namePositions: Readonly<Record<string, (word: string) => string>> = {
  binding: (word) => `const ${word} = 1\nprint(${word})\n`,
  parameter: (word) => `def take(${word}: number) -> number:\n    return ${word}\n\nprint(take(1))\n`,
  "loop binding": (word) => `for ${word} in [1, 2]:\n    print(${word})\n`,
  "named argument": (word) => `def take(${word}: number) -> number:\n    return ${word}\n\nprint(take(${word}=1))\n`,
  "record field": (word) => `type Holder:\n    ${word}: number\n\nconst holder: Holder = {${word}: 1}\nprint(holder.${word})\n`,
  "member name": (word) => `const holder = {${word}: 1}\nprint(holder.${word})\n`,
  "record shorthand": (word) => `const ${word} = 1\nconst holder = {${word}}\nprint(holder.${word})\n`,
  // D64 rule 165: the shorthand again, inside an arrow body. `{` after `=>`
  // opens a record, so this is the same position — but the brace scan that
  // decides record-versus-statements reads the word rather than the shape, and
  // it used to answer "statements" for `{match}` because the next token is `}`
  // rather than ':'. Charter §3's claim covers this spelling too.
  "record shorthand in an arrow body": (word) =>
    `const ${word} = 1\nconst build = () => {${word}}\nprint(build().${word})\n`,
};

/**
 * The positions each roster word is refused in today. Charter §3 asserts the
 * empty entry for every word but one, and names `case`'s exception itself:
 * JavaScript reserves the spelling, so it can be a name only where a name is
 * not being *bound*.
 *
 * D64 rules 164 and 165 emptied the other two entries this map used to hold.
 * `readonly: number` as a record field was refused because the field-line
 * parse read the word as the modifier before looking at what followed it, and
 * `{match}` in an arrow body was refused because the brace scan took the word
 * as statement evidence. Both are now claimed by their own shape and by
 * nothing else, which is what the rest of the roster already did — so the map
 * states `case` alone, and any regression puts a word back into it.
 */
const refusedPositions = new Map<string, readonly string[]>([
  ["case", ["binding", "parameter", "loop binding", "named argument", "record shorthand", "record shorthand in an arrow body"]],
]);

test("[D62-157] every roster word is an ordinary name in charter §3's seven positions", () => {
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    const refused = refusedPositions.get(word) ?? [];
    for (const [position, build] of Object.entries(namePositions)) {
      const diagnostics = messages(build(word));
      if (refused.includes(position)) {
        assert.notDeepEqual(diagnostics, [], `${word} unexpectedly compiles as a ${position}`);
      } else {
        assert.deepEqual(diagnostics, [], `${word} as a ${position}`);
      }
    }
  }
  // `case`'s refusal is the one charter §3 states, by name and by reason.
  assert.deepEqual(messages("const case = 1\n"), [
    "VEL3007 'case' is reserved by JavaScript and cannot be used as a VelarScript binding",
  ]);
  assert.equal(bindingNameRestriction("case"), "javascript");
  // Every other roster word binds, which is what makes the claim non-trivial.
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    if (word === "case") continue;
    assert.equal(bindingNameRestriction(word), null, word);
  }
});

test("[D62-157] every roster word is still claimed as syntax in its own shape", () => {
  // The other half of the claim: the word stays a keyword where its
  // declaration stands, so the roster names live syntax and not just spellings
  // the lexer happens to pass through.
  const matchStatement = [
    "def pick(n: number) -> number:",
    "    match n:",
    "        case 1:",
    "            return 2",
    "        case _:",
    "            return 3",
    "",
    "print(pick(1))",
    "",
  ].join("\n");
  const shapes = new Map<string, string>([
    ["as", "import {compile as build} from \"./m.vel\"\n\nprint(build)\n"],
    ["case", matchStatement],
    ["constructor", "class Box:\n    const name: string\n\n    constructor(name: string):\n        self.name = name\n\nprint(Box(\"a\").name)\n"],
    ["from", "import {compile} from \"./m.vel\"\n\nprint(compile)\n"],
    ["get", "class Box:\n    get empty() -> bool:\n        return true\n\nprint(Box().empty)\n"],
    ["json", "import json data from \"./catalog.json\"\n\nprint(data)\n"],
    ["match", matchStatement],
    ["readonly", "type Holder:\n    readonly tags: List<string>\n\nconst holder: Holder = {tags: [\"a\"]}\nprint(holder.tags)\n"],
    ["test", "test \"a name\":\n    print(1)\n"],
    ["type", "type Id = string\n\nconst id: Id = \"a\"\nprint(id)\n"],
    ["using", [
      "class Handle:",
      "    @dispose:",
      "        print(\"closed\")",
      "",
      "def work():",
      "    using handle = Handle()",
      "    print(handle)",
      "",
      "work()",
      "",
    ].join("\n")],
  ]);
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    const source = shapes.get(word);
    assert.ok(source, `no declaration shape is exercised for ${word}`);
    // `test` declares only inside a `*.test.vel` module, which is the shape's
    // own rule (VEL3019) rather than anything about the word.
    const path = word === "test" ? "probe.test.vel" : "probe.vel";
    // `as` and `from` name a sibling module, so only the import resolution is
    // outstanding; nothing else may be.
    const unresolved = new Set(["as", "from"]);
    const diagnostics = compile(source, { path }).diagnostics
      .map((item) => `${item.code} ${item.message}`)
      .filter((item) => !(unresolved.has(word) && item.startsWith("VEL3008")));
    assert.deepEqual(diagnostics, [], word);
  }
});

// ---------------------------------------------------------------------------
// The three consumers, derived rather than copied
// ---------------------------------------------------------------------------

test("[D62-157] the formatter's statement-head set is the roster's, not its own", () => {
  assert.deepEqual([...CORE_STATEMENT_HEAD_KEYWORDS], ["case", "match"]);
  assert.deepEqual(
    [...CORE_STATEMENT_HEAD_KEYWORDS],
    CORE_CONTEXTUAL_KEYWORDS.filter((entry) => entry.statementSubjectFollows).map((entry) => entry.word),
  );
  // What the flag buys: at the head of a line these two take a subject, so the
  // space in front of it is meaning — `match(value)` is a call (D30 item 16)
  // and `case - 1:` is a subtraction. `constructor(...)` occupies a
  // declaration's *name* slot instead, so its `(` binds tight like `def f(`.
  const source = [
    "match (value):",
    "    case -1:",
    "        print(1)",
    "",
  ].join("\n");
  assert.equal(formatSource(source), source);
  const declaration = "class Box:\n    constructor(name: string):\n        self.name = name\n";
  assert.equal(formatSource(declaration), declaration);
  const getter = "class Box:\n    get empty() -> bool:\n        return true\n";
  assert.equal(formatSource(getter), getter);
  // Every roster word's own declaration shape is already canonical, so
  // `--check` agrees with the language rather than with the formatter.
  const shapes = [
    "type Holder:\n    readonly tags: List<string>\n",
    "using file = open(path)\n",
    "test \"a name\":\n    print(1)\n",
    "import {compile as build} from \"./m.vel\"\n",
    "import json catalog from \"./catalog.json\"\n",
  ];
  for (const shape of shapes) {
    assert.equal(formatSource(shape), shape, shape);
    assert.equal(formatSource(formatSource(shape)), shape, shape);
  }
});

test("[D62-157] the editor offers every hard keyword and every roster word", () => {
  const labels = new Set(completionItemsFor(null).map((item) => item.label));
  for (const word of Object.keys(keywordKinds)) assert.ok(labels.has(word), `no completion for hard keyword ${word}`);
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) assert.ok(labels.has(word), `no completion for contextual keyword ${word}`);
  // The seven hard keywords and four contextual words the hand-kept copy had
  // never learned. Named individually because the copy looked complete.
  for (const word of ["js", "unsafe", "extern", "module", "break", "continue", "is", "as", "from", "test", "using"]) {
    assert.ok(labels.has(word), `no completion for ${word}`);
  }
});

test("[D62-157] the parser reads the roster, so a word cannot be claimed by an inline literal", () => {
  // `CORE_WORDS.type` is a compile-time reference to a roster member: dropping
  // `type` from `core-vocabulary.ts` fails `tsc` at every parser use site
  // rather than leaving a working copy behind. This assertion is the runtime
  // half of that — the values the parser passes are the roster's spellings.
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    assert.equal((CORE_WORDS as Readonly<Record<string, string>>)[word], word);
  }
});

// ---------------------------------------------------------------------------
// Rule 158 — Core's numeric suffixes
// ---------------------------------------------------------------------------

test("[D62-158] Core's numeric suffixes are enumerable and are what Core lexes", () => {
  assert.deepEqual([...CORE_NUMERIC_SUFFIXES], ["ms", "s"]);
  // Read with no extension loaded: the pair belongs to Core, and a Core-only
  // checkout must be able to see it. Before the roster the only way to reach
  // these two was through the Web extension's LOOK_UNIT_TYPES.
  for (const suffix of CORE_NUMERIC_SUFFIXES) {
    const lexed = new Lexer(`const wait = 250${suffix}\n`).lex();
    assert.deepEqual(lexed.diagnostics, [], suffix);
    const unit = lexed.tokens.find((token) => token.kind === "unitNumber");
    assert.ok(unit, `250${suffix} did not lex as a unit literal`);
    assert.equal(unit.value, `250${suffix}`);
  }
  // A suffix Core does not own is not silently accepted, which is what makes
  // the roster a closed set rather than a starting point.
  assert.notDeepEqual(new Lexer("const size = 4px\n").lex().diagnostics, []);
  // And both spellings reach the language as Duration values.
  assert.deepEqual(messages("const wait: Duration = 250ms\nconst long: Duration = 3s\nprint(wait)\nprint(long)\n"), []);
});
