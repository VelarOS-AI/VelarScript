import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";

function accepts(source: string): void {
  assert.deepEqual(compile(source).diagnostics, [], source);
}

function incomplete(source: string): void {
  const result = compile(source);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0]!.code, "VEL4015");
}

test("every match covers its bool, optional, scalar or open input domain", () => {
  for (const type of ["bool", "bool?"]) {
    const header = `def handle(value: ${type}):\n    match value:\n`;
    incomplete(header + "        case true: pass\n");
    const both = header + "        case true: pass\n        case false: pass\n";
    if (type === "bool?") {
      incomplete(both);
      accepts(both + "        case null: pass\n");
    } else accepts(both);
  }
  for (const [type, pattern] of [["string", '"chosen"'], ["number", "1"], ["unknown", "number"]]) {
    const source = `def handle(value: ${type}):\n    match value:\n        case ${pattern}: pass\n`;
    incomplete(source);
    accepts(source + "        case _: pass\n");
  }
});

test("guards never close coverage, including constant true and wildcard guards", () => {
  for (const pattern of ["_", "bool", "true, false"]) {
    const source = `def handle(value: bool):\n    match value:\n        case ${pattern} if true: pass\n`;
    incomplete(source);
    accepts(source + "        case _: pass\n");
  }
});

test("enum member unions and aliases require only their actual static members", () => {
  const header = "enum State:\n    ready\n    done\n    failed\ntype Selected = State.ready | State.done\n";
  for (const type of ["State.ready | State.done", "Selected", "Selected?"]) {
    const source = header + `def handle(value: ${type}):\n    match value:\n        case State.ready: pass\n`;
    incomplete(source);
    const complete = source + "        case State.done: pass\n";
    if (type === "Selected?") {
      incomplete(complete);
      accepts(complete + "        case null: pass\n");
    } else accepts(complete);
  }
  accepts(header + "def handle(value: State.ready):\n    match value:\n        case State.ready: pass\n");
});

test("collection type patterns preserve the exact finite enum domain", () => {
  const header = "enum State:\n    ready\n    done\ntype All = List<State.ready | State.done>\ntype Ready = List<State.ready>\n";
  accepts(header + "def handle(values: List<State>):\n    match values:\n        case All: pass\n");
  incomplete(header + "def handle(values: List<State>):\n    match values:\n        case Ready: pass\n");
});

test("record union coverage recognizes type and discriminant patterns", () => {
  const header = "enum Kind:\n    success\n    failure\ntype Success:\n    kind: Kind.success\n    value: string\ntype Failure:\n    kind: Kind.failure\n    message: string\n";
  for (const [first, last] of [["Success", "Failure"], ["{kind: Kind.success}", "{kind: Kind.failure}"]]) {
    const source = header + `def handle(value: Success | Failure):\n    match value:\n        case ${first}: pass\n`;
    incomplete(source);
    accepts(source + `        case ${last}: pass\n`);
    incomplete(source + `        case ${last} if true: pass\n`);
  }
});

test("List length and required record field patterns provide structural coverage", () => {
  const list = "def handle(values: List<number>):\n    match values:\n";
  incomplete(list + "        case []: pass\n");
  incomplete(list + "        case [first, ...rest]: pass\n");
  accepts(list + "        case []: pass\n        case [first, ...rest]: pass\n");
  incomplete(list + "        case []: pass\n        case [1, ...rest]: pass\n");
  accepts("type Row:\n    value: number\ndef handle(row: Row):\n    match row:\n        case {value}: pass\n");
  const optional = "type Row:\n    value: number?\ndef handle(row: Row):\n    match row:\n        case {value}: pass\n";
  incomplete(optional);
  accepts(optional + "        case _: pass\n");
});

test("runtime type coverage respects readonly shapes without granting write permission", () => {
  const header = "readonly type Row:\n    value: number\ntype Mutable:\n    value: number\ntype Rows = List<Mutable>\n";
  accepts(header + "def handle(row: Row):\n    match row:\n        case Mutable: pass\n");
  accepts(header + "def handle(rows: readonly List<Row>):\n    match rows:\n        case Rows: pass\n");
  const result = compile(header + "def handle(row: Row):\n    match row:\n        case Mutable:\n            row.value = 2\n");
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0]!.message, /readonly|read-only/);
});

test("overlapping record patterns retain first-match evaluation and explicit no-op behavior", () => {
  const result = compile("type Left:\n    x: number\ntype Right:\n    y: number\ndef classify(value: Left | Right):\n    match value:\n        case Left:\n            print(value.x)\n        case Right:\n            print(value.y)\ndef selective(value: bool):\n    match value:\n        case true:\n            print(9)\n        case _: pass\nclassify({x: 1, y: 2})\nclassify({y: 3})\nselective(false)\nselective(true)\n");
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code!);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "1\n3\n9\n");
});
