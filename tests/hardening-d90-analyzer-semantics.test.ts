import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import { compile } from "../packages/compiler/src/index.ts";
import { compileProject, type ProjectResult } from "../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

/**
 * D90 regression coverage for four analyzer semantics that landed with no test
 * of their own: D85 rule 207's settling positions (compiler-back-10), the
 * retired bare-name spelling a re-export used to restore (compiler-back-14),
 * the initialization-position read reached through one local call
 * (compiler-back-17), and `Map(record)` (compiler-back-24).
 *
 * One residual survives and is pinned as it behaves: VEL3019's wording still
 * says only "Move this read into a function", and that sentence is built in
 * packages/cli/src/project.ts, outside this wave's file domain. The assertion
 * carries a RESIDUAL comment naming the gap so the record is in the repository
 * and goes red the moment the wording changes.
 */

test.after(async () => {
  await removeTemporaryDirectories();
});

/** `CODE@line` for each diagnostic, so an assertion can say *where* it reports. */
function reportOf(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => {
    const line = source.slice(0, item.span.start).split("\n").length;
    return `${item.code}@${line}`;
  });
}

/** The 1-based line a span starts on. */
function lineOf(source: string, span: { readonly start: number }): number {
  return source.slice(0, span.start).split("\n").length;
}

function messagesOf(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

function codesOf(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

const EMPTY_LIST = "Empty '[]' requires an explicit type; nothing at this position says what the List holds — write 'let items: List<string> = []'";
const EMPTY_SET = "Empty 'Set()' requires an explicit type; nothing at this position says what the Set holds — write 'const tags: Set<string> = Set()'";
const EMPTY_MAP = "Empty 'Map()' requires an explicit type; nothing at this position says what the Map holds — write 'const users: Map<string, User> = Map()'";

// ---------------------------------------------------------------------------
// compiler-back-10 — D85 rule 207 reaches every settling position
// ---------------------------------------------------------------------------

test("[D90] an empty collection reports at its own position in a return and a record field", () => {
  // The program filed against the pre-fix analyzer. Before the settling walk,
  // `requireSettledCollectionElement` ran only from the declaration-statement
  // handler, so neither `[]` was seen and the only reports were the two
  // VEL4001s below — pointing at lines with no `[]` in them.
  const source = [
    "def make():",
    "    return []",
    "",
    "type Holder:",
    "    items: List<string>",
    "",
    "def main():",
    "    const values: List<string> = make()",
    "    const holder = { items: [] }",
    "    holder.items.append(\"a\")",
    "    const h: Holder = holder",
    "",
  ].join("\n");

  // Line 2 is `return []` and line 9 is `const holder = { items: [] }`. Those
  // are the only two reports: each lands on a `[]` the author wrote, and
  // nothing lands on lines 8 or 11, which contain none.
  //
  // D85 §理由三 quotes `VEL4001 Cannot assign List<unknown> to List<string>`
  // verbatim as the diagnostic the ruling exists to delete, and §209 states
  // 「一个错误只报一次，而且两条话互相打架」. A reported hole therefore
  // becomes `invalidType` at the position that reported it, so `make()`'s
  // inferred result and `holder`'s binding never carry `List<unknown>` out to
  // a later line for a second, contradicting report.
  assert.deepEqual(reportOf(source), ["VEL4039@2", "VEL4039@9"]);
  const messages = messagesOf(source);
  assert.equal(messages[0], EMPTY_LIST);
  assert.equal(messages[1], EMPTY_LIST);
});

test("[D90] a reported hole does not become a second report on a line with no '[]'", () => {
  // The three positions that hand the hole to a name, each checked for the
  // cascade alone: a body-inferred result, a binding, and an arrow's result.
  // `invalidType` is assignable everywhere, so the annotation on the reading
  // line stays silent and VEL4039 is the whole story.
  assert.deepEqual(codesOf("def make():\n    return []\nconst v: List<string> = make()\n"), ["VEL4039"]);
  assert.deepEqual(codesOf("def main():\n    const a = []\n    const v: List<string> = a\n"), ["VEL4039"]);
  assert.deepEqual(codesOf("def main():\n    const f = () => []\n    const v: List<string> = f()\n"), ["VEL4039"]);

  // An invalid result is not a convergence failure either: the author has
  // already been told exactly what to write, so VEL4025 stays quiet.
  assert.deepEqual(codesOf("def make():\n    return []\n"), ["VEL4039"]);

  // Nor does the invalid binding become a destructuring complaint about a
  // type nobody wrote. VEL4020 still counts the literal's items, which is a
  // different mistake on a different span.
  assert.deepEqual(codesOf("def main():\n    const [a, b] = []\n"), ["VEL4020", "VEL4039"]);
});

test("[D90] the hole reaches the result through a name, a chain of them, or a local call", () => {
  // The suppression above was tied to the return statement's own value, so
  // anything the author wrote between the `[]` and the `return` defeated it and
  // one mistake was reported twice — the second time as
  // "add an explicit result annotation to this recursive contract", pointing at
  // a recursive contract that does not exist.
  assert.deepEqual(codesOf("def make():\n    const a = []\n    return a\n"), ["VEL4039"]);
  assert.deepEqual(codesOf("def make():\n    const a = []\n    const b = a\n    return b\n"), ["VEL4039"]);

  // Through a call, in both declaration orders. The forward one is why the
  // second report is decided at the end of the module: when `make` is analyzed
  // nothing yet knows `inner` has a hole in it.
  assert.deepEqual(reportOf("def inner():\n    return []\n\ndef make():\n    return inner()\n"), ["VEL4039@2"]);
  assert.deepEqual(reportOf("def make():\n    return inner()\n\ndef inner():\n    return []\n"), ["VEL4039@5"]);
  // And through a name that holds the call's result.
  assert.deepEqual(codesOf("def inner():\n    return []\n\ndef make():\n    const a = inner()\n    return a\n"), ["VEL4039"]);

  // Every spelling VEL4039 knows, not just the List one.
  const viaBinding = (spelling: string): string => `def make():\n    const a = ${spelling}\n    return a\n`;
  assert.deepEqual(messagesOf(viaBinding("[]")), [EMPTY_LIST]);
  assert.deepEqual(messagesOf(viaBinding("Set()")), [EMPTY_SET]);
  assert.deepEqual(messagesOf(viaBinding("Map()")), [EMPTY_MAP]);
});

test("[D90] a convergence failure with no reported hole behind it still reports on both halves", () => {
  // The suppression is tied to the hole VEL4039 reported, not to "the result is
  // invalid". A cycle with no empty collection anywhere in it has nothing
  // explaining it yet, so both declarations still ask for the annotation.
  assert.deepEqual(
    codesOf("def first():\n    return second()\n\ndef second():\n    return first()\n"),
    ["VEL4025", "VEL4025"],
  );
  assert.deepEqual(
    codesOf("def first():\n    const a = second()\n    return a\n\ndef second():\n    return first()\n").filter((code) => code === "VEL4025"),
    ["VEL4025", "VEL4025"],
  );
  // A call this module cannot resolve is not a hole it can claim was reported.
  assert.deepEqual(codesOf("def make():\n    return make()\n"), ["VEL4025"]);
});

test("[D90] a body-inferred export cannot publish List<unknown> across the module interface", () => {
  const source = "export def make():\n    return []\n";
  assert.deepEqual(codesOf(source), ["VEL4039"]);
  assert.equal(messagesOf(source)[0], EMPTY_LIST);
  // The zero-diagnostics gate for code generation holds, so `List<unknown>`
  // never reaches an importer.
  assert.equal(compile(source).code, null);
});

test("[D90] every settling position inside a value reports at its own empty collection", () => {
  // Ternary arms.
  assert.deepEqual(codesOf("def pick(flag: bool):\n    const a = flag ? [] : []\n"), ["VEL4039", "VEL4039"]);
  assert.deepEqual(messagesOf("def pick(flag: bool):\n    const a = flag ? Set() : Set()\n"), [EMPTY_SET, EMPTY_SET]);

  // List elements and spreads. The outer `[[], []]` is not itself empty, so
  // the walk descends to the two elements that are.
  assert.deepEqual(codesOf("def main():\n    const a = [[], []]\n"), ["VEL4039", "VEL4039"]);
  assert.deepEqual(codesOf("def main():\n    const a = [...[]]\n"), ["VEL4039"]);

  // Record-literal fields, one report per hole and one spelling per kind.
  assert.deepEqual(
    messagesOf("def main():\n    const holder = { items: [], tags: Set(), byId: Map() }\n"),
    [EMPTY_LIST, EMPTY_SET, EMPTY_MAP],
  );

  // The `??` fallback.
  assert.deepEqual(codesOf("def main():\n    const a = null ?? []\n"), ["VEL4039"]);

  // The walk recurses, so a hole nested two positions deep still reports.
  assert.deepEqual(codesOf("def pick(flag: bool):\n    const a = flag ? {items: []} : {items: []}\n"), ["VEL4039", "VEL4039"]);
});

test("[D90] rule 208's boundary holds: a receiver contributes a member, not the value", () => {
  // D85 rule 208 documents this exclusion by name: `print(Set().size)` does not
  // report, because what needs a type is the name that will be read later, and
  // neither of these names holds a collection.
  assert.deepEqual(codesOf("print(Set().size)\n"), []);
  assert.deepEqual(codesOf("const n = Set().size\nprint(n)\n"), []);

  // What separates the two is the value, not the syntax: the walk descends a
  // receiver or an argument only while the type arriving at the binding still
  // carries the hole. `Set().size` is a number, so the receiver is never
  // reached. `[].copy()` is a `List<unknown>` — a name that will be read later
  // with no element type, which is exactly what rule 207 is about — so the
  // receiver is reached and reports at the `[]`.
  assert.deepEqual(codesOf('def main():\n    const a = [].copy()\n    a.append(1)\n'), ["VEL4039"]);
  assert.deepEqual(codesOf("def main():\n    const a = [].reversed()\n"), ["VEL4039"]);
  assert.deepEqual(codesOf("def id<T>(x: T) -> T:\n    return x\n\ndef main():\n    const a = id([])\n"), ["VEL4039"]);
  assert.deepEqual(codesOf('def main():\n    const m = Map([["k", []]])\n'), ["VEL4039"]);
  assert.deepEqual(codesOf('def main():\n    const s = Set([["a"], []])\n'), ["VEL4039"]);

  // And a receiver whose hole came from an annotation is never a report: only
  // a freshly written empty construction can be the thing that failed to say.
  assert.deepEqual(codesOf("def main(raw: List<unknown>):\n    const a = raw.copy()\n    print(a.size)\n"), []);
});

test("[D90] a spread of an empty list leaves nothing to report; a sibling element does", () => {
  // A spread of an empty list is absorbed by the merge, so `["x", ...[]]` is a
  // `List<string>` with no hole left in it and no position to report at.
  assert.deepEqual(codesOf('def main():\n    const a = ["x", ...[]]\n    print(a.size)\n'), []);
  assert.deepEqual(codesOf('def main(base: List<string>):\n    const a = [...base, ...[]]\n    print(a.size)\n'), []);

  // A sibling *element*, by contrast, does not settle anything: list literals
  // merge to `List<List<string> | List<unknown>>`, and every read of that name
  // fails with "has no common field" — the message pointing at a line with no
  // `[]` that D85 §理由三 exists to delete. So the report belongs at the `[]`.
  assert.deepEqual(codesOf('def main():\n    const grid = [["a", "b"], []]\n'), ["VEL4039"]);
  assert.deepEqual(codesOf('def main():\n    const r = {a: ["x"], b: []}\n'), ["VEL4039"]);
});

test("[D90] a position that settles the element type stays clean", () => {
  // Every source rule 207 accepts: an annotation, a contextual type from a
  // return position, an argument position, an arrow's contextual result, and
  // an annotated record field.
  assert.deepEqual(codesOf("def make() -> List<string>:\n    return []\nprint(make().size)\n"), []);
  assert.deepEqual(codesOf("def make() -> Set<string>:\n    return Set()\nprint(make().size)\n"), []);
  assert.deepEqual(codesOf("def take(values: List<string>):\n    print(values.size)\n\ndef main():\n    take([])\n"), []);
  assert.deepEqual(codesOf("def take(make: () -> List<string>):\n    print(make().size)\n\ndef main():\n    take(() => [])\n"), []);
  assert.deepEqual(codesOf("type T:\n    items: List<string>\n\ndef main():\n    const t: T = {items: []}\n"), []);
  assert.deepEqual(codesOf("def maybe(flag: bool) -> List<string>?:\n    return null\n\ndef main():\n    const a = maybe(true) ?? []\n"), []);
});

// ---------------------------------------------------------------------------
// compiler-back-14 — a re-export cannot restore a retired import spelling
// ---------------------------------------------------------------------------

test("[D90] a re-export of a permanent-namespace member is refused the way the import is", () => {
  const two = compile('export {stringify, parse} from "velar/json"\n');
  assert.deepEqual(two.diagnostics.map((item) => item.code), ["VEL3008", "VEL3008"]);
  assert.deepEqual(two.diagnostics.map((item) => item.message), [
    "Use Json.stringify directly; a re-export cannot restore a retired import spelling",
    "Use Json.parse directly; a re-export cannot restore a retired import spelling",
  ]);
  // D85 §209's reasoning about guessed fixes applies here for a different
  // reason: which reads in which other modules wanted the name is not a
  // rewrite this module can make, so the report carries no mechanical fix.
  assert.equal(two.diagnostics[0]?.fix, undefined);
  assert.equal(two.code, null);

  // Renaming on the way out does not launder it — the retired spelling is the
  // one being republished, not the one being introduced.
  assert.deepEqual(messagesOf('export {stringify as toJson} from "velar/json"\n'), [
    "Use Json.stringify directly; a re-export cannot restore a retired import spelling",
  ]);

  // Every roster module, including the prelude one whose members carry no
  // namespace prefix.
  assert.deepEqual(messagesOf('export {all} from "velar/async"\n'), [
    "Use Promise.all directly; a re-export cannot restore a retired import spelling",
  ]);
  assert.deepEqual(messagesOf('export {min} from "velar/math"\n'), [
    "Use Math.min directly; a re-export cannot restore a retired import spelling",
  ]);
  assert.deepEqual(messagesOf('export {range} from "velar/collections"\n'), [
    "Use range(...) directly; a re-export cannot restore a retired import spelling, and the Core prelude needs none",
  ]);
});

test("[D90] the re-export check reads the same roster the import check reads", () => {
  // Control: the import spelling keeps its own VEL3008 and its mechanical fix.
  const imported = compile('import {stringify} from "velar/json"\nprint(stringify({a: 1}))\n');
  assert.equal(imported.diagnostics[0]?.code, "VEL3008");
  assert.equal(imported.diagnostics[0]?.message, "Use Json.stringify directly; VelarScript's pure namespaces need no import");
  assert.notEqual(imported.diagnostics[0]?.fix, undefined);

  // A name the roster does not carry is not a retired spelling. `floor` and
  // `abs` are number methods — `Math.floor` answers "Object has no field
  // 'floor'" and `(1.5).floor()` is the spelling — so they were never `Math`
  // members and re-exporting them names nothing retired. The roster is derived
  // from the namespace type, not from the module name.
  assert.deepEqual(codesOf('export {floor} from "velar/math"\n'), []);
  assert.deepEqual(codesOf('export {abs} from "velar/math"\n'), []);
  assert.deepEqual(codesOf('export {nonesuch} from "velar/json"\n'), []);
  // The two halves of that claim, so the control above cannot drift into
  // silently accepting a real `Math` member.
  assert.deepEqual(codesOf("print((1.5).floor())\n"), []);
  assert.deepEqual(codesOf("print(Math.floor(1.5))\n"), ["VEL4001"]);
  assert.deepEqual(codesOf("print(Math.min(1, 2))\n"), []);

  // `velar/text` does publish namespace members, and they are refused like
  // every other roster entry. `trim` is clean only because it is a string
  // method rather than a `Text` member — the same distinction `floor` draws
  // above, checked from the other side so the control cannot be misread as
  // "this module is exempt".
  assert.deepEqual(codesOf('export {trimStart} from "velar/text"\n'), ["VEL3008"]);
  assert.deepEqual(messagesOf('export {trimEnd} from "velar/text"\n'), [
    "Use Text.trimEnd directly; a re-export cannot restore a retired import spelling",
  ]);
  assert.deepEqual(codesOf('export {trim} from "velar/text"\n'), []);
  assert.deepEqual(codesOf('print(" x ".trim())\n'), []);

  // A re-export of an ordinary project module is untouched.
  assert.deepEqual(codesOf('export {thing} from "./other.vel"\n'), []);
});

test("[D90] the one-line barrel no longer republishes the bare name to a whole project", async () => {
  const root = await makeTemporaryDirectory("velar-d90-barrel-");
  const project = await checkProject(root, {
    "main.vel": 'import {stringify} from "./barrel.vel"\nprint(stringify({a: 1}))\n',
    "barrel.vel": 'export {stringify, parse} from "velar/json"\n',
  }, "main.vel");

  assert.deepEqual(project.failures, []);
  const barrel = moduleOf(project, root, "barrel.vel");
  assert.deepEqual(barrel.result.diagnostics.map((item) => item.code), ["VEL3008", "VEL3008"]);
  // The barrel emits nothing, so the project cannot build and no downstream
  // module can go on importing the retired spelling from it.
  assert.equal(barrel.result.code, null);
});

// ---------------------------------------------------------------------------
// compiler-back-17 — an initialization-position read reached through one call
// ---------------------------------------------------------------------------

const CYCLE_MESSAGE = "Move this read into a function, or extract the shared value into a third module; './a.vel' has not initialized when this line runs";

test("[D90] a direct initialization-position read of a cycle binding is still reported", () => {
  // Control: the machinery works, so a failure below is about what reaches it.
  const direct = compile('import {value} from "./a.vel"\nconst x = value\n');
  assert.deepEqual(direct.initializationImportReads.map((item) => item.local), ["value"]);
  assert.deepEqual(direct.initializationImportReads.map((item) => item.source), ["./a.vel"]);
});

test("[D90] an initialization read reached through one local call is reported", async () => {
  // compiler-back-17. D31 item 23 recorded this as a v1 residual, and the
  // residual was wider than it read: VEL3019's own remediation says "Move this
  // read into a function", and doing that and then calling the function at top
  // level re-created the bare ReferenceError. The intra-module reachability
  // pass closes it — one module, one walk over the call edges.
  //
  // Both mediated forms now record the read, at the *call* rather than at the
  // read: the call is the line that runs while the module evaluates, and the
  // read inside the body is already in a function.
  const viaDef = compile('import {value} from "./a.vel"\ndef pull() -> number:\n    return value\nconst x = pull()\n');
  assert.deepEqual(viaDef.initializationImportReads.map((read) => read.local), ["value"]);
  assert.equal(lineOf('import {value} from "./a.vel"\ndef pull() -> number:\n    return value\nconst x = pull()\n', viaDef.initializationImportReads[0]!.span), 4);
  const viaArrow = compile('import {value} from "./a.vel"\nconst f = () => value\nconst x = f()\n');
  assert.deepEqual(viaArrow.initializationImportReads.map((read) => read.local), ["value"]);

  // The walk is transitive, and it terminates on a recursive local.
  const twoHops = compile('import {value} from "./a.vel"\ndef inner() -> number:\n    return value\ndef outer() -> number:\n    return inner()\nconst x = outer()\n');
  assert.deepEqual(twoHops.initializationImportReads.map((read) => read.local), ["value"]);
  const recursive = compile('import {value} from "./a.vel"\ndef loop(n: number) -> number:\n    return n <= 0 ? 0 : loop(n - 1)\nconst x = loop(3)\n');
  assert.deepEqual(recursive.initializationImportReads, []);

  // End to end through the project driver: the module that used to compile
  // clean and then die with a host error now reports, and emits no code.
  const root = await makeTemporaryDirectory("velar-d90-init-call-");
  const project = await checkProject(root, {
    "main.vel": 'import {value} from "./a.vel"\nexport const seed = 1\ndef pull() -> number:\n    return value\nconst x = pull()\nprint(x)\n',
    "a.vel": 'import {seed} from "./main.vel"\nexport const value = seed + 1\n',
  }, "a.vel");

  assert.deepEqual(project.failures, []);
  const reported = moduleOf(project, root, "main.vel").result.diagnostics;
  assert.equal(reported.length, 1, reported.map((item) => item.message).join("\n"));
  assert.equal(reported[0]?.code, "VEL3019");
  assert.equal(reported[0]?.message, CYCLE_MESSAGE);
  assert.equal(moduleOf(project, root, "main.vel").result.code, null);
});

test("[D90] the shapes an initialization-position pass must leave clean", async () => {
  const root = await makeTemporaryDirectory("velar-d90-init-clean-");

  // A local function that reads an imported binding but is only ever called
  // from inside another function never runs during module evaluation.
  const deferred = await checkProject(root, {
    "main.vel": 'import {value} from "./a.vel"\nexport const seed = 1\ndef pull() -> number:\n    return value\ndef outer() -> number:\n    return pull()\nprint(outer)\n',
    "a.vel": 'import {seed} from "./main.vel"\nexport const value = seed + 1\n',
  }, "a.vel");
  assert.deepEqual(deferred.failures, []);
  assert.deepEqual(moduleOf(deferred, root, "main.vel").result.diagnostics, []);

  // A top-level call of a local function that reads nothing imported is not an
  // initialization-position read of anything.
  const local = compile("def pull() -> number:\n    return 1\nconst x = pull()\nprint(x)\n");
  assert.deepEqual(local.diagnostics, []);
  assert.deepEqual(local.initializationImportReads, []);
});

test("[D90] RESIDUAL: VEL3019's remediation names the escape hatch that re-creates the crash", async () => {
  const root = await makeTemporaryDirectory("velar-d90-init-message-");
  const project = await checkProject(root, {
    "main.vel": 'import {value} from "./a.vel"\nexport const seed = 1\nconst x = value\nprint(x)\n',
    "a.vel": 'import {seed} from "./main.vel"\nexport const value = seed + 1\n',
  }, "a.vel");

  const reported = moduleOf(project, root, "main.vel").result.diagnostics;
  assert.equal(reported.length, 1, reported.map((item) => item.message).join("\n"));
  assert.equal(reported[0]?.code, "VEL3019");
  assert.equal(reported[0]?.message, CYCLE_MESSAGE);
  // RESIDUAL (compiler-back-17, message half). The escape hatch the message
  // names is now checked — following it and calling the function at top level
  // reports rather than crashing — but the wording still says "Move this read
  // into a function" with no caveat, and it is the same sentence for both the
  // direct read and the read one call away. The message is built in
  // packages/cli/src/project.ts, outside this wave's file domain; the exact
  // replacement prose is filed in the wave's followups.
  assert.doesNotMatch(reported[0]?.message ?? "", /top level|top-level/u);
});

// ---------------------------------------------------------------------------
// compiler-back-24 — Map(record)
// ---------------------------------------------------------------------------

test("[D90] Map(record) type-checks the form its own diagnostic advertises", () => {
  // The filed program. It used to fail with
  // `VEL4001 Map construction requires a Map, a List of [key, value] Lists, or
  // a record, received Record<string>` — a message that lists "a record" among
  // the accepted forms and then refuses one.
  assert.deepEqual(codesOf('def main():\n    const byId: Record<string> = {"2": "second", "1": "first"}\n    const m = Map(byId)\n    print(m.size)\n'), []);

  // The inferred type is `Map<string, V>`; a record's keys are strings by
  // construction. The annotated forms are what pin it.
  assert.deepEqual(codesOf("def take(source: Record<string>):\n    const m: Map<string, string> = Map(source)\n    print(m.size)\n"), []);
  assert.deepEqual(
    messagesOf("def take(source: Record<string>):\n    const m: Map<string, number> = Map(source)\n"),
    ["Cannot assign Map<string, string> to Map<string, number>", "Cannot assign string to number"],
  );

  // A genuinely unsupported source still gets the roster message.
  assert.deepEqual(messagesOf("def main():\n    const m = Map(5)\n"), [
    "Map construction requires a Map, a List of [key, value] Lists, or a record, received number",
  ]);
});

test("[D90] a readonly Record projects a readonly value type through Map(record)", () => {
  assert.deepEqual(
    messagesOf('def take(source: readonly Record<List<number>>):\n    const m = Map(source)\n    const got = m.get("a")\n    if got != null:\n        got.append(1)\n'),
    ["Cannot call mutating method 'append' through readonly List<number>; it is a read-only view"],
  );
  // The mutable spelling is the control: the same body is legal there.
  assert.deepEqual(
    codesOf('def take(source: Record<List<number>>):\n    const m = Map(source)\n    const got = m.get("a")\n    if got != null:\n        got.append(1)\n'),
    [],
  );
});

test("[D90] Map(record) iterates the host's record order, not the written order", async () => {
  // NOT a bug, and deliberately pinned so nobody later reads it as one. A
  // `Record` has already lost the written order before `Map` ever sees it:
  // `__velarCreateMap` enumerates with `__velarCollectionRecordOwnNames`, and
  // the host returns integer-like keys first in ascending order. `Map(entries)`
  // is the only construction that keeps the written order.
  const source = [
    "def main():",
    '    const byId: Record<string> = {"2": "second", "1": "first", "b": "bee", "a": "ay"}',
    "    const m = Map(byId)",
    "    let order: List<string> = []",
    "    for key in m:",
    "        order.append(key)",
    '    print(order.join(","))',
    "",
    "main()",
    "",
  ].join("\n");

  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const root = await makeTemporaryDirectory("velar-d90-map-record-");
  const entry = join(root, "main.mjs");
  await writeFile(entry, result.code ?? "", "utf8");
  const execution = spawnSync(process.execPath, [entry], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  // Integer-like keys first in ascending order, then the string keys in
  // written order — "1,2,b,a", not the written "2,1,b,a".
  assert.equal(execution.stdout, "1,2,b,a\n");
});

// ---------------------------------------------------------------------------

async function checkProject(
  root: string,
  modules: Readonly<Record<string, string>>,
  entry: string,
): Promise<ProjectResult> {
  const overrides = new Map(Object.entries(modules).map(([name, text]) => [join(root, name), text]));
  return await compileProject(join(root, entry), overrides, { extensions: [] });
}

function moduleOf(project: ProjectResult, root: string, name: string): ProjectResult["modules"][number] {
  const module = project.modules.find((candidate) => candidate.inputPath === join(root, name));
  assert.ok(module, `module ${name} was compiled`);
  return module;
}
