import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";

/**
 * D114 S3 (D35's open sub-decision, ruling A): `velar/collections` retired.
 * Twelve of its exports duplicated a List method word for word, four were
 * `get`/`slice` under other names, three survived only because the method side
 * lacked `min(by=)`, `max(by=)` and a descending order, and the rest are List
 * members now. `range` was always the Core prelude name and keeps the VEL3008
 * that teaches the bare spelling.
 *
 * Each import earns one recovered diagnostic per name, so analysis continues
 * and the module reports every retired name it uses in one compile. The report
 * carries the whole migration of that name — every call site plus the specifier
 * — whenever the rewrite is mechanical.
 *
 * `tests/list-pipeline-methods.test.ts` covers the other half: the members.
 */

const TAIL = "; velar/collections retired into checked List members";

function reports(source: string): readonly { readonly code: string; readonly message: string; readonly recovered: boolean; readonly fixed: boolean }[] {
  return compile(source).diagnostics.map((item) => ({
    code: item.code,
    message: item.message,
    recovered: item.recovered === true,
    fixed: item.fix !== undefined,
  }));
}

function messagesOf(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

/** One `velar fix` pass, against the text the diagnostics were reported on. */
function fixedOnce(source: string): string {
  return applyMechanicalFixes(source, compile(source).diagnostics).text;
}

/**
 * What `velar fix` converges on: it recompiles until a pass applies nothing,
 * which is what makes two names in one import line take two passes rather than
 * two conflicting edits against one snapshot.
 */
function fixedFully(source: string): string {
  let text = source;
  for (let pass = 0; pass < 64; pass += 1) {
    const next = applyMechanicalFixes(text, compile(text).diagnostics);
    if (next.applied.length === 0) return next.text;
    text = next.text;
  }
  assert.fail(`velar fix did not converge on:\n${source}`);
}

const PRELUDE = `type Row:
    id: string
    rank: number

const rows: List<Row> = [{id: "a", rank: 2}]
const values: List<number> = [3, 1, 2]
const words: List<string> = ["a", "b"]
const nested: List<List<number>> = [[1], [2]]
const sparse: List<number?> = [1, null]
`;

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

test("[D114 S3] the module is gone from the standard roster while range keeps working", () => {
  assert.equal(standardModuleInterfaces().get("velar/collections"), undefined);
  assert.deepEqual(messagesOf("const counted = range(1, 4)\nprint(str(counted.size))\n"), []);
  assert.deepEqual(messagesOf("for index in range(3):\n    print(str(index))\n"), []);
});

test("[D114 S3] every retired name reports the member it became, once, and recovers", () => {
  const expected: readonly (readonly [string, string])[] = [
    ["find", "Use 'values.find(test)'"],
    ["index", "Use 'values.index(value)'"],
    ["has", "Use 'values.has(value)'"],
    ["count", "Use 'values.count(value)'"],
    ["some", "Use 'values.some(test)'"],
    ["every", "Use 'values.every(test)'"],
    ["sum", "Use 'values.sum()'"],
    ["join", "Use 'values.join(separator)'"],
    ["reversed", "Use 'values.reversed()'"],
    ["first", "Use 'values.get(0)'"],
    ["last", "Use 'values.get(-1)'"],
    ["take", "Use 'values.slice(0, count)'"],
    ["drop", "Use 'values.slice(count)'"],
    ["sortBy", "Use 'values.sorted(by=key, descending=descending)'"],
    ["minBy", "Use 'values.min(by=key)'"],
    ["maxBy", "Use 'values.max(by=key)'"],
    ["unique", "Use 'values.unique()'"],
    ["compact", "Use 'values.compact()'"],
    ["flatten", "Use 'values.flatten()'"],
    ["chunk", "Use 'values.chunk(size)'"],
    ["partition", "Use 'values.partition(test)'"],
    ["groupBy", "Use 'values.groupBy(key)'"],
    ["keyBy", "Use 'values.keyBy(key)'"],
    ["countBy", "Use 'values.countBy(key)'"],
    ["zip", "Use 'left.zip(right)'"],
    ["repeat", "Use '[value].repeat(count)', which repeats the whole List the way string.repeat does"],
    ["enumerate", "Use 'for value, index in values:'"],
  ];
  for (const [name, guidance] of expected) {
    assert.deepEqual(reports(`import {${name}} from "velar/collections"\n`), [{
      code: "VEL3008",
      message: `${guidance}${TAIL}`,
      recovered: true,
      // `enumerate` is guidance only: its `{index, value}` records are read at
      // sites no edit here can see.
      fixed: name !== "enumerate",
    }], name);
  }
});

test("[D114 S3] one import of several retired names reports each of them", () => {
  assert.deepEqual(messagesOf(`import {groupBy, sum, zip} from "velar/collections"\n${PRELUDE}`), [
    `Use 'values.groupBy(key)'${TAIL}`,
    `Use 'values.sum()'${TAIL}`,
    `Use 'left.zip(right)'${TAIL}`,
  ]);
});

// ---------------------------------------------------------------------------
// The mechanical rewrite
// ---------------------------------------------------------------------------

test("[D114 S3] a positional call becomes the member call, and the empty import line goes", () => {
  assert.equal(
    fixedOnce(`import {groupBy} from "velar/collections"\n${PRELUDE}const grouped = groupBy(rows, row => row.id)\n`),
    `${PRELUDE}const grouped = rows.groupBy(row => row.id)\n`,
  );
  assert.equal(
    fixedOnce(`import {first} from "velar/collections"\n${PRELUDE}const head = first(values)\n`),
    `${PRELUDE}const head = values.get(0)\n`,
  );
  assert.equal(
    fixedOnce(`import {take} from "velar/collections"\n${PRELUDE}const firstTwo = take(values, 2)\n`),
    `${PRELUDE}const firstTwo = values.slice(0, 2)\n`,
  );
  assert.equal(
    fixedOnce(`import {drop} from "velar/collections"\n${PRELUDE}const rest = drop(values, 1)\n`),
    `${PRELUDE}const rest = values.slice(1)\n`,
  );
  assert.equal(
    fixedOnce(`import {sortBy} from "velar/collections"\n${PRELUDE}const down = sortBy(rows, row => row.rank, true)\n`),
    `${PRELUDE}const down = rows.sorted(by=row => row.rank, descending=true)\n`,
  );
  assert.equal(
    fixedOnce(`import {repeat} from "velar/collections"\n${PRELUDE}const many = repeat("a", 3)\n`),
    `${PRELUDE}const many = ["a"].repeat(3)\n`,
  );
  assert.equal(
    fixedOnce(`import {zip} from "velar/collections"\n${PRELUDE}const pairs = zip(words, values)\n`),
    `${PRELUDE}const pairs = words.zip(values)\n`,
  );
});

test("[D114 S3] a named-argument call is read back into positions before it is rewritten", () => {
  assert.equal(
    fixedOnce(`import {take} from "velar/collections"\n${PRELUDE}const firstTwo = take(count=2, values=values)\n`),
    `${PRELUDE}const firstTwo = values.slice(0, 2)\n`,
  );
  assert.equal(
    fixedOnce(`import {sortBy} from "velar/collections"\n${PRELUDE}const down = sortBy(descending=true, key=row => row.rank, values=rows)\n`),
    `${PRELUDE}const down = rows.sorted(by=row => row.rank, descending=true)\n`,
  );
  // A trailing optional argument the call omits stays omitted.
  assert.equal(
    fixedOnce(`import {join} from "velar/collections"\n${PRELUDE}const text = join(values=words)\n`),
    `${PRELUDE}const text = words.join()\n`,
  );
});

test("[D114 S3] one pass migrates every name in the line, and leaves the ones no edit can rewrite", () => {
  // The import statement is one span, so two rewrites of it cannot both apply
  // against one snapshot: every migratable name in a line carries the same
  // rewrite, and one pass finishes the line.
  assert.equal(
    fixedOnce(`import {groupBy, sum} from "velar/collections"\n${PRELUDE}const total = sum(values)\nconst grouped = groupBy(rows, row => row.id)\n`),
    `${PRELUDE}const total = values.sum()\nconst grouped = rows.groupBy(row => row.id)\n`,
  );
  // `enumerate` has no mechanical rewrite, so it is what the line is left
  // holding — and it still reports on its own.
  const mixed = `import {enumerate, sum} from "velar/collections"\n${PRELUDE}const total = sum(values)\nconst pages = enumerate(words)\n`;
  assert.equal(
    fixedOnce(mixed),
    `import {enumerate} from "velar/collections"\n${PRELUDE}const total = values.sum()\nconst pages = enumerate(words)\n`,
  );
  assert.deepEqual(reports(mixed).filter((item) => item.code === "VEL3008").map((item) => [item.message, item.fixed]), [
    [`Use 'for value, index in values:'${TAIL}`, false],
    [`Use 'values.sum()'${TAIL}`, true],
  ]);
});

test("[D114 S3] a receiver keeps the parentheses a postfix member needs", () => {
  assert.equal(
    fixedOnce(`import {sum} from "velar/collections"\n${PRELUDE}const total = sum(values.size > 2 ? values : words.map(word => word.size))\n`),
    `${PRELUDE}const total = (values.size > 2 ? values : words.map(word => word.size)).sum()\n`,
  );
  // A call, an index, a member path, and a List literal are already postfix
  // receivers, so none of them gains a pair.
  assert.equal(
    fixedOnce(`import {sum} from "velar/collections"\n${PRELUDE}const total = sum(values.slice(1))\n`),
    `${PRELUDE}const total = values.slice(1).sum()\n`,
  );
  assert.equal(
    fixedOnce(`import {sum} from "velar/collections"\n${PRELUDE}const total = sum([1, 2])\n`),
    `${PRELUDE}const total = [1, 2].sum()\n`,
  );
  assert.equal(
    fixedOnce(`import {sum} from "velar/collections"\n${PRELUDE}const total = sum(nested[0])\n`),
    `${PRELUDE}const total = nested[0].sum()\n`,
  );
});

test("[D114 S3] every mechanical rewrite compiles clean and keeps the program's meaning", () => {
  const migrated = fixedFully(`import {chunk, compact, count as countValue, countBy, drop, every, find, first, flatten, groupBy, has, index, join, keyBy, last, maxBy, minBy, partition, repeat, reversed, some, sortBy, sum, take, unique, zip} from "velar/collections"
${PRELUDE}
const found = find(values, value => value > 1)
const position = index(values, 3)
const present = has(values, 3)
const occurrences = countValue(values, 3)
const anyMatch = some(values, value => value > 1)
const allMatch = every(values, value => value > 0)
const total = sum(values)
const text = join(words, "-")
const backwards = reversed(values)
const head = first(values)
const tail = last(values)
const firstTwo = take(values, 2)
const rest = drop(values, 1)
const ranked = sortBy(rows, row => row.rank)
const smallest = minBy(rows, row => row.rank)
const largest = maxBy(rows, row => row.rank)
const uniqueValues = unique(values)
const compacted = compact(sparse)
const flattened = flatten(nested)
const chunked = chunk(values, 2)
const split = partition(values, value => value > 1)
const grouped = groupBy(rows, row => row.id)
const keyed = keyBy(rows, row => row.id)
const counted = countBy(rows, row => row.id)
const pairs = zip(words, values)
const many = repeat("a", 3)
`);
  assert.match(migrated, /const found = values\.find\(value => value > 1\)/u);
  assert.match(migrated, /const position = values\.index\(3\)/u);
  assert.match(migrated, /const present = values\.has\(3\)/u);
  assert.match(migrated, /const occurrences = values\.count\(3\)/u);
  assert.match(migrated, /const anyMatch = values\.some\(value => value > 1\)/u);
  assert.match(migrated, /const allMatch = values\.every\(value => value > 0\)/u);
  assert.match(migrated, /const total = values\.sum\(\)/u);
  assert.match(migrated, /const text = words\.join\("-"\)/u);
  assert.match(migrated, /const backwards = values\.reversed\(\)/u);
  assert.match(migrated, /const head = values\.get\(0\)/u);
  assert.match(migrated, /const tail = values\.get\(-1\)/u);
  assert.match(migrated, /const firstTwo = values\.slice\(0, 2\)/u);
  assert.match(migrated, /const rest = values\.slice\(1\)/u);
  assert.match(migrated, /const ranked = rows\.sorted\(by=row => row\.rank\)/u);
  assert.match(migrated, /const smallest = rows\.min\(by=row => row\.rank\)/u);
  assert.match(migrated, /const largest = rows\.max\(by=row => row\.rank\)/u);
  assert.match(migrated, /const uniqueValues = values\.unique\(\)/u);
  assert.match(migrated, /const compacted = sparse\.compact\(\)/u);
  assert.match(migrated, /const flattened = nested\.flatten\(\)/u);
  assert.match(migrated, /const chunked = values\.chunk\(2\)/u);
  assert.match(migrated, /const split = values\.partition\(value => value > 1\)/u);
  assert.match(migrated, /const grouped = rows\.groupBy\(row => row\.id\)/u);
  assert.match(migrated, /const keyed = rows\.keyBy\(row => row\.id\)/u);
  assert.match(migrated, /const counted = rows\.countBy\(row => row\.id\)/u);
  assert.match(migrated, /const pairs = words\.zip\(values\)/u);
  assert.match(migrated, /const many = \["a"\]\.repeat\(3\)/u);
  assert.doesNotMatch(migrated, /velar\/collections/u);
  assert.deepEqual(messagesOf(migrated), []);
});

// ---------------------------------------------------------------------------
// Where the rewrite stops
// ---------------------------------------------------------------------------

test("[D114 S3] a rewrite that would erase an authored comment is withheld", () => {
  const commented = `import {sum} from "velar/collections"\n${PRELUDE}const total = sum(values) // the running total\n`;
  assert.deepEqual(reports(commented).filter((item) => item.code === "VEL3008"), [
    { code: "VEL3008", message: `Use 'values.sum()'${TAIL}`, recovered: true, fixed: true },
  ]);
  const inside = `import {sum} from "velar/collections"\n${PRELUDE}const total = sum(\n    // every score\n    values,\n)\n`;
  assert.deepEqual(reports(inside).filter((item) => item.code === "VEL3008"), [
    { code: "VEL3008", message: `Use 'values.sum()'${TAIL}`, recovered: true, fixed: false },
  ]);
  assert.equal(fixedOnce(inside), inside);
});

test("[D114 S3] a retired name used as a value earns guidance without a rewrite", () => {
  const source = `import {groupBy} from "velar/collections"\n${PRELUDE}const grouper = groupBy\nprint(str(grouper(rows, row => row.id) != null))\n`;
  assert.deepEqual(reports(source).filter((item) => item.code === "VEL3008"), [
    { code: "VEL3008", message: `Use 'values.groupBy(key)'${TAIL}`, recovered: true, fixed: false },
  ]);
  assert.equal(fixedOnce(source), source);
});

test("[D114 S3] enumerate is guidance only, because its records are read elsewhere", () => {
  const source = `import {enumerate} from "velar/collections"\n${PRELUDE}for entry in enumerate(words):\n    print(str(entry.index))\n`;
  assert.deepEqual(reports(source).filter((item) => item.code === "VEL3008"), [
    { code: "VEL3008", message: `Use 'for value, index in values:'${TAIL}`, recovered: true, fixed: false },
  ]);
  assert.equal(fixedOnce(source), source);
  // The spelling the message names has to compile.
  assert.deepEqual(messagesOf("const words: List<string> = [\"a\"]\nfor value, index in words:\n    print(f\"{str(index)}{value}\")\n"), []);
});

test("[D114 S3] a namespace import earns guidance without a rewrite", () => {
  const source = `import * as tools from "velar/collections"\n${PRELUDE}print(str(tools.unique(values) != null))\n`;
  assert.deepEqual(reports(source).filter((item) => item.code === "VEL3008"), [{
    code: "VEL3008",
    message: "velar/collections retired into checked List members; drop the namespace import and call the member on the List — values.groupBy(key)",
    recovered: true,
    fixed: false,
  }]);
  assert.equal(fixedOnce(source), source);
});

test("[D114 S3] a re-export cannot restore a retired import spelling", () => {
  assert.deepEqual(messagesOf('export {groupBy} from "velar/collections"\n'), [
    `Use 'values.groupBy(key)'${TAIL}; a re-export cannot restore a retired import spelling`,
  ]);
  // The prelude name keeps the answer D50 rule 97.3 already gave it.
  assert.deepEqual(messagesOf('export {range} from "velar/collections"\n'), [
    "Use range(...) directly; a re-export cannot restore a retired import spelling, and the Core prelude needs none",
  ]);
});

test("[D114 S3] importing range still teaches the bare prelude name", () => {
  const reported = reports('import {range} from "velar/collections"\nprint(str(range(3).size))\n');
  assert.ok(
    reported.some((item) => item.code === "VEL3008" && item.message === "Use range(...) directly; the Core prelude needs no import" && item.fixed),
    JSON.stringify(reported),
  );
  assert.ok(reported.every((item) => !item.message.includes("retired into checked List members")), JSON.stringify(reported));
});

// ---------------------------------------------------------------------------
// D114 0.28.0 D-D1: two rewrite points in one expression
// ---------------------------------------------------------------------------

/**
 * `velar fix` splices every accepted edit into one snapshot, and nothing in
 * that splice composes two edits that overlap. An outer `sum(...)` and the
 * inner `unique(...)` it wraps are two edits over one expression, so the file
 * came back with the outer rewrite, the inner call untouched, an unbalanced
 * `)` and the import already deleted — an unparseable module, reported as
 * `applied 1 mechanical fix`.
 *
 * The rule the wave restored: after `velar fix` the program compiles and means
 * what it meant. A nest is therefore one edit, over the outermost call, whose
 * replacement text is built from the rewritten text of everything inside it.
 */
function migrated(source: string): string {
  const text = fixedFully(source);
  assert.deepEqual(messagesOf(text), [], text);
  return text;
}

test("[D-D1] a nested pair of retired calls is one rewrite, and the result compiles", () => {
  assert.match(
    migrated(`import {sum, unique} from "velar/collections"\n${PRELUDE}const total = sum(unique(values))\nprint(str(total))\n`),
    /const total = values\.unique\(\)\.sum\(\)\n/u,
  );
  // The audit's own probe: the same nest inside an f-string interpolation,
  // where the extra ')' was a parse error rather than a statement error.
  assert.match(
    migrated(`import {sum, unique} from "velar/collections"\n${PRELUDE}print(f"{sum(unique(values))}")\n`),
    /print\(f"\{values\.unique\(\)\.sum\(\)\}"\)\n/u,
  );
});

test("[D-D1] three levels compose inside out", () => {
  assert.match(
    migrated(`import {sum, unique, reversed} from "velar/collections"\n${PRELUDE}const total = sum(unique(reversed(values)))\nprint(str(total))\n`),
    /const total = values\.reversed\(\)\.unique\(\)\.sum\(\)\n/u,
  );
});

test("[D-D1] a nest mixed with method calls, arguments and operators composes", () => {
  const source = `import {sum, unique, take, first, flatten} from "velar/collections"\n${PRELUDE}`
    + "def show(value: number) -> number:\n    return value\n\n"
    + "const size = unique(values).size\n"
    + "const inner = sum(values.map(value => sum([value])))\n"
    + "const argument = show(sum(values))\n"
    + "const chained = take(values, 2).map(value => value * 2)\n"
    + "const fallback = first(values) ?? 0\n"
    + "const deep = sum(flatten(nested))\n"
    + "print(str(size + inner + argument + chained.size + fallback + deep))\n";
  const text = migrated(source);
  assert.match(text, /const size = values\.unique\(\)\.size\n/u);
  assert.match(text, /const inner = values\.map\(value => \[value\]\.sum\(\)\)\.sum\(\)\n/u);
  assert.match(text, /const argument = show\(values\.sum\(\)\)\n/u);
  assert.match(text, /const chained = values\.slice\(0, 2\)\.map\(value => value \* 2\)\n/u);
  assert.match(text, /const fallback = values\.get\(0\) \?\? 0\n/u);
  assert.match(text, /const deep = nested\.flatten\(\)\.sum\(\)\n/u);
});

test("[D-D1] a nest whose outer name cannot be rewritten still migrates the inner one", () => {
  // `enumerate` has no mechanical rewrite at all, and an outer call whose
  // rewrite would erase a comment withholds its own. Both leave their name in
  // the import and neither blocks the inner rewrite, so what is written is
  // always a program that compiles.
  const withComment = `import {sum, unique} from "velar/collections"\n${PRELUDE}const total = sum(/* keep */ unique(values))\nprint(total)\n`;
  const fixedComment = fixedFully(withComment);
  assert.match(fixedComment, /const total = sum\(\/\* keep \*\/ values\.unique\(\)\)\n/u);
  assert.match(fixedComment, /^import \{sum\} from "velar\/collections"\n/u);
  assert.deepEqual(messagesOf(fixedComment).filter((message) => !message.includes("velar/collections")), []);

  const withEnumerate = `import {sum, enumerate} from "velar/collections"\n${PRELUDE}const total = sum(values)\nfor entry in enumerate(words):\n    print(entry.value)\n`;
  const fixedEnumerate = fixedFully(withEnumerate);
  assert.match(fixedEnumerate, /const total = values\.sum\(\)\n/u);
  assert.match(fixedEnumerate, /^import \{enumerate\} from "velar\/collections"\n/u);
});

test("[D-D1] the fixed module means what the original meant", () => {
  // A rewrite is only correct if the program computes what it computed before,
  // so the migrated source is run rather than only matched.
  const source = `import {sum, unique, reversed, take, first, compact, flatten} from "velar/collections"\n`
    + "const values: List<number> = [3, 1, 2, 3]\n"
    + "const nested: List<List<number>> = [[1, 2], [3]]\n"
    + "const sparse: List<number?> = [1, null, 2]\n"
    + "print(str(sum(unique(reversed(values)))))\n"
    + "print(str(unique(values).size))\n"
    + "print(str(take(values, 2).map(value => value * 2).size))\n"
    + "print(str(first(values) ?? 0))\n"
    + "print(str(sum(flatten(nested))))\n"
    + "print(str(sum(compact(sparse))))\n";
  const text = fixedFully(source);
  assert.deepEqual(messagesOf(text), [], text);
  const result = compile(text);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout), "6\n3\n2\n3\n6\n3\n");
});

// ---------------------------------------------------------------------------
// D114 0.28.0 D-I1: one spelling, one report
// ---------------------------------------------------------------------------

test("[D-I1] importing a prelude name from the retired module reports once", () => {
  // `range` is a reserved Core binding *and* a name this import cannot bind,
  // and it used to earn a sentence for each. The one that survives is the one
  // that says what to write instead; the retired-module sentence belongs to
  // the names that really were exports of the module, and never reached this
  // one. The call it leaves behind recovers as the prelude value rather than
  // adding an "unknown JavaScript value" of its own.
  const source = 'import {range, sum} from "velar/collections"\nconst values: List<number> = range(3)\nprint(sum(values))\n';
  assert.deepEqual(reports(source).map((item) => `${item.code} ${item.message}`), [
    "VEL3008 Use range(...) directly; the Core prelude needs no import",
    `VEL3008 Use 'values.sum()'${TAIL}`,
  ]);
  // And the fix converges on a module that compiles and needs no import.
  const text = fixedFully(source);
  assert.equal(text, "const values: List<number> = range(3)\nprint(values.sum())\n");
  assert.deepEqual(messagesOf(text), []);
});

test("[D-I1] a local named after a reserved Core binding is still refused", () => {
  // The suppression is per import specifier, by span. Nothing else that spells
  // a reserved name is answered for by a retirement report.
  assert.deepEqual(messagesOf("def go(range: number) -> number:\n    return range\n"), [
    "'range' is a reserved Core binding",
  ]);
});
