import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";

function fixed(source: string, code: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.advisories.some(item => item.code === code));
  const output = applyMechanicalFixes(source, result.advisories).text;
  const checked = compile(output);
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(checked.advisories, []);
  return output;
}

test("A20 promotes whole records and preserves export, generics, comments and value qualifiers", () => {
  const source = "/// state\nexport type Box<T>:\n    // retain this comment\n    readonly value: T // value\n    readonly items: readonly List<T>\n";
  assert.equal(fixed(source, "A20"), source.replace("export type", "export readonly type").replace("    readonly value", "    value").replace("    readonly items", "    items"));
});

test("A20 removes field modifiers already covered by a readonly declaration", () => {
  assert.equal(fixed("readonly type Box:\n    readonly items: readonly List<number>\n", "A20"), "readonly type Box:\n    items: readonly List<number>\n");
});

test("A20 leaves mixed and derived records' permissions intact", () => {
  for (const source of ["type Mixed:\n    readonly id: number\n    value: number\n", "type Base:\n    x: number\ntype Derived extends Base:\n    readonly y: number\n"]) {
    const result = compile(source);
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.advisories, []);
  }
});

test("A21 recognizes readonly declarations, aliases and duplicate qualifiers", () => {
  for (const source of [
    "readonly type State:\n    x: number\ndef read(s: readonly State): pass\n",
    "readonly type State:\n    x: number\ntype Alias = State\ndef read(s: readonly Alias?): pass\n",
    "type State:\n    x: number\ndef read(s: readonly readonly State): pass\n",
    "type States = readonly List<number>\ndef read(s: readonly States): pass\n",
  ]) fixed(source, "A21");
});

test("A21 retains independent list and element qualifiers", () => {
  const source = "type State:\n    x: number\nreadonly type Snapshot:\n    readonlyStates: readonly List<readonly State>\n";
  assert.deepEqual(compile(source).advisories, []);
});
