import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileWeb, standardModuleInterface } from "../support/compiler-suite.ts";

const domId = standardModuleInterface("velar/web")!.exports.get("domId")!;
const compile = (source: string) => compileWeb(source, { analysis: { imports: new Map([["domId", domId], ["id", domId]]) } });

test("DOM ID prefixes check literals, constant expressions and renamed imports", () => {
  for (const value of ['"1bad"', '"bad space"', '""', JSON.stringify("a".repeat(65)), '"1" + "bad"']) {
    const result = compile(`import {domId as id} from "velar/web"\nconst prefix = ${value}\nprint(id(prefix=prefix))\n`);
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.match(result.diagnostics[0]!.message, /DOM ID prefixes/u);
  }
});

test("DOM ID contracts respect scope and leave dynamic prefixes to runtime", () => {
  for (const source of [
    'import {domId} from "velar/web"\nconst prefix="valid-prefix_2"\nprint(domId(prefix))\n',
    'import {domId} from "velar/web"\ndef make(prefix: string): return domId(prefix)\n',
    'def domId(prefix: string): return prefix\nprint(domId("1bad"))\n',
    'import {domId as id} from "velar/web"\ndef check(id: (prefix: string) -> string): return id("1bad")\n',
  ]) assert.deepEqual(compile(source).diagnostics, [], source);
});

test("DOM ID contracts follow immutable function aliases but never mutable callees", () => {
  const refused = compile('import {domId} from "velar/web"\nconst makeId=domId\nconst alias=makeId\nprint(alias("1bad"))\n');
  assert.equal(refused.diagnostics.length, 1);
  assert.match(refused.diagnostics[0]!.message, /DOM ID prefixes/u);
  assert.deepEqual(compile('import {domId} from "velar/web"\ndef custom(prefix: string=""): return prefix\nlet makeId=domId\nmakeId=custom\nprint(makeId("1bad"))\n').diagnostics, []);
});
