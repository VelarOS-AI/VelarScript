import assert from "node:assert/strict";
import test from "node:test";
import { compile, formatSource, type CompileResult } from "@velarscript/compiler";

function compiled(source: string): CompileResult {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code}: ${item.message}`), [], source);
  assert.notEqual(result.code, null, "an advisory never blocks code generation");
  return result;
}

function a8(source: string): CompileResult["advisories"][number] {
  const result = compiled(source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A8"], source);
  return result.advisories[0]!;
}

test("[A8] an early-true List query teaches some", () => {
  const source = `
type SchemaColumnRow:
    name: string

def hasColumn(columns: List<SchemaColumnRow>, name: string) -> bool:
    for column in columns:
        if column.name == name:
            return true
    return false
`.trimStart();
  const reported = a8(source);
  assert.match(reported.message, /List\.some is the canonical existential query/u);
  assert.match(reported.message, /return columns\.some\(column => column\.name == name\)/u);
  assert.equal(source.slice(reported.span.start, reported.span.end), "columns");
  assert.equal(reported.fix, undefined, "the cross-statement rewrite does not erase comments automatically");

  const canonical = compiled(`
type SchemaColumnRow:
    name: string

def hasColumn(columns: List<SchemaColumnRow>, name: string) -> bool:
    return columns.some(column => column.name == name)
`.trimStart());
  assert.deepEqual(canonical.advisories, []);
});

test("[A8] pure boolean operators and data reads stay inside the proven query shape", () => {
  const source = `
type Row:
    name: string
    active: bool

def hasActive(rows: readonly List<Row>, name: string, enabled: bool) -> bool:
    for row in rows:
        if row.name == name and (row.active or enabled):
            return true
    return false
`.trimStart();
  const reported = a8(source);
  assert.match(reported.message, /return rows\.some\(row => \(row\.name == name\) and \(row\.active or enabled\)\)/u);

  const canonical = compiled(`
type Row:
    name: string
    active: bool

def hasActive(rows: readonly List<Row>, name: string, enabled: bool) -> bool:
    return rows.some(row => (row.name == name) and (row.active or enabled))
`.trimStart());
  assert.deepEqual(canonical.advisories, []);
});

test("[A8] effects, getters, optional conditions, wider bodies, and non-List sources stay silent", () => {
  const silent = [
    `
type Row:
    name: string

def matches(row: Row, name: string) -> bool:
    return row.name == name

def hasRow(rows: List<Row>, name: string) -> bool:
    for row in rows:
        if matches(row, name):
            return true
    return false
`,
    `
class Row:
    get matches() -> bool:
        return true

def hasRow(rows: List<Row>) -> bool:
    for row in rows:
        if row.matches:
            return true
    return false
`,
    `
type Row:
    selected: bool?

def hasSelected(rows: List<Row>) -> bool:
    for row in rows:
        if row.selected:
            return true
    return false
`,
    `
def hasPositive(values: List<number>) -> bool:
    for value in values:
        if value > 0:
            print(value)
            return true
    return false
`,
    `
def hasPositive(values: Set<number>) -> bool:
    for value in values:
        if value > 0:
            return true
    return false
`,
    `
def values() -> List<number>:
    return [1]

def hasPositive() -> bool:
    for value in values():
        if value > 0:
            return true
    return false
`,
    `
def hasPositive(values: List<number>) -> bool:
    for value, index in values:
        if value > 0:
            return true
    return false
`,
    `
def hasPositive(values: List<number>) -> bool:
    for value in values:
        if value > 0:
            return true
    print("searched")
    return false
`,
    `
def hasPositive(values: List<number>) -> bool:
    for value in values:
        if value > 0:
            return true
        else:
            print(value)
    return false
`,
  ];
  for (const source of silent) assert.deepEqual(compiled(source.trimStart()).advisories, [], source);
});

test("[A8] a reasoned suppression works, while bare and stale suppressions fail", () => {
  const suppressed = `
def hasPositive(values: List<number>) -> bool:
    for value in values: // velar-allow A8: the expanded early return is clearer in this lesson
        if value > 0:
            return true
    return false
`.trimStart();
  assert.deepEqual(compiled(suppressed).advisories, []);
  assert.equal(formatSource(suppressed), suppressed);
  assert.equal(formatSource(formatSource(suppressed)), suppressed);

  const bare = compile(suppressed.replace(": the expanded early return is clearer in this lesson", ""));
  assert.deepEqual(bare.diagnostics.map((item) => item.code), ["VEL1011"]);
  assert.deepEqual(bare.advisories, []);

  const stale = compile(`
def hasPositive(values: List<number>) -> bool:
    return values.some(value => value > 0) // velar-allow A8: the expanded early return is clearer in this lesson
`.trimStart());
  assert.deepEqual(stale.advisories, []);
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});
