import assert from "node:assert/strict";
import test from "node:test";
import { compile, type Diagnostic } from "@velarscript/compiler";

function applyRemedies(source: string, reports: readonly Diagnostic[]): string {
  const edits = reports.flatMap((item) => item.fix?.edits ?? []).sort((left, right) => right.span.start - left.span.start);
  return edits.reduce((text, edit) => text.slice(0, edit.span.start) + edit.text + text.slice(edit.span.end), source);
}

function repaired(source: string, typo: string): string {
  const reports = compile(source).diagnostics;
  assert.equal(reports.length, 1, JSON.stringify(reports));
  assert.match(reports[0]!.message, /did you mean/);
  assert.equal(source.slice(reports[0]!.span.start, reports[0]!.span.end), typo);
  assert.ok(reports[0]!.fix);
  const fixed = applyRemedies(source, reports);
  assert.deepEqual(compile(fixed).diagnostics, []);
  return fixed;
}

test("a misspelled record key reports once and the mechanical rename compiles", () => {
  for (const key of ["aeg", '"aeg"']) {
    repaired(`type User:\n    age: number\n\n@main:\n    const user: User = {${key}: 42}\n    print(user.age)\n`, key);
  }
  const shorthand = repaired('type User:\n    age: number\n\n@main:\n    const aeg = 42\n    const user: User = {aeg}\n    print(user.age)\n', "aeg");
  assert.ok(shorthand.includes("{age: aeg}"));
});

test("named calls offer the same exact rename for ordinary, generic and constructor parameters", () => {
  for (const declaration of [
    'def label(name: string) -> string:\n    return name\n',
    'def label<T>(name: T) -> T:\n    return name\n',
    'class Label:\n    constructor(const name: string):\n        pass\n',
  ]) {
    const callee = declaration.startsWith("class") ? "Label" : "label";
    repaired(`${declaration}\n@main:\n    print(${callee}(nmae= // keep this comment\n        "Ada"))\n`, "nmae");
  }
});

test("a rename never creates a duplicate field or parameter", () => {
  for (const source of [
    'type User:\n    age: number\n\n@main:\n    const user: User = {age: 1, aeg: 2}\n',
    'def label(name: string) -> string:\n    return name\n\n@main:\n    label(name="a", nmae="b")\n',
  ]) {
    const reports = compile(source).diagnostics;
    assert.equal(reports.length, 1, JSON.stringify(reports));
    assert.equal(reports[0]!.fix, undefined);
  }
});

test("a unique field-read correction edits only the member on structural and declared records", () => {
  for (const declaration of [
    'const user = {age: 42}\n',
    'type User:\n    age: number\n\nconst user: User = {age: 42}\n',
  ]) {
    const source = declaration + '@main:\n    print(user.aeg)\n';
    const reports = compile(source).diagnostics;
    assert.equal(reports.length, 1, JSON.stringify(reports));
    const edit = reports[0]!.fix?.edits[0];
    assert.ok(edit);
    assert.equal(source.slice(edit.span.start, edit.span.end), "aeg");
    assert.deepEqual(compile(applyRemedies(source, reports)).diagnostics, []);
  }
});

test("a missing unrelated required field remains visible after the near-name diagnosis", () => {
  const source = 'def label(name: string, age: number) -> string:\n    return name\n\n@main:\n    label(nmae="Ada")\n';
  const reports = compile(source).diagnostics;
  assert.equal(reports.length, 2, JSON.stringify(reports));
  assert.ok(reports.some((item) => item.message === "Missing required named argument: age"));
});
