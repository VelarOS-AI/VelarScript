import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

test("string argument contracts read arithmetic and immutable lexical snapshots", () => {
  for (const expression of ["0 - 1", "index", "alias", "1 / 2"]) {
    const source = `const index = 0 - 1\nconst alias = index\nprint("abc".char(${expression}))\n`;
    const result = compile(source);
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.match(result.diagnostics[0]!.message, /String.char index/u);
    assert.equal(source.slice(result.diagnostics[0]!.span.start, result.diagnostics[0]!.span.end), expression);
  }
});

test("constant arguments keep lexical identity across nested scopes and named positions", () => {
  const source = `const index = -1
const saved = index
def read(index: number):
    print("abc".char(index))
    print("abc".char(saved))
print("abc".slice(end=1.5, start=0))
`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => source.slice(item.span.start, item.span.end)), ["saved", "1.5"]);
});

test("mutable cells and member reads stay with runtime validation", () => {
  const result = compile(`let index = -1
const copied = index
const record = {index: -1}
index = 0
print("abc".char(index))
print("abc".char(copied))
print("abc".char(record.index))
`);
  assert.deepEqual(result.diagnostics, []);
});

test("constant pattern concatenation uses the same text validator", () => {
  const result = compile('const open = "("\nconst pattern = open + "["\nprint(Text.matches("x", pattern))\n');
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.match(result.diagnostics[0]!.message, /Invalid text pattern/u);
  assert.deepEqual(compile('print(Text.matches(expression="x", value="(["))\n').diagnostics, []);
  assert.match(compile('print(Text.matches(expression="([", value="x"))\n').diagnostics[0]!.message, /Invalid text pattern/u);
});
