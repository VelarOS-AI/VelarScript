import assert from "node:assert/strict";
import test from "node:test";
import { compile, applyMechanicalFixes } from "@velarscript/compiler";

const prefix = 'async def load() -> number: return 7\nconst pending = load()\n';

test("A19 warns on Promise inspection without changing legal printing", () => {
  for (const body of ['print(pending)', 'print(value=pending)', 'const inspect = print\ninspect(pending)']) {
    const source = prefix + body + '\n';
    const result = compile(source);
    assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
    assert.deepEqual(result.advisories.map((item) => item.code), ["A19"], source);
    assert.ok(result.code);
    assert.match(result.advisories[0]!.message, /await/u);
    assert.equal(result.advisories[0]!.fix, undefined);
    assert.equal(applyMechanicalFixes(source, result.advisories).text, source);
  }
});

test("A19 also explains rejected text conversions without weakening their type contract", () => {
  for (const body of ['print(str(pending))', 'print(f"result={pending}")', 'const convert = str\nprint(convert(pending))']) {
    const result = compile(prefix + body + '\n');
    assert.deepEqual(result.advisories.map((item) => item.code), ["A19"], body);
    assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
    assert.equal(result.code, null);
  }
});

test("A19 accepts awaiting and reasoned inspection, and diagnoses stale suppression", () => {
  const awaited = compile(prefix + 'print(await pending)\n');
  assert.deepEqual(awaited.advisories, []);
  assert.deepEqual(awaited.diagnostics, []);
  const explained = compile(prefix + 'print(pending) // velar-allow A19: inspecting the task state is intentional\n');
  assert.deepEqual(explained.advisories, []);
  assert.deepEqual(explained.diagnostics, []);
  const stale = compile('print(1) // velar-allow A19: this explanation is obsolete\n');
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});

test("A19 follows optional and union values but not unrelated functions or nested data", () => {
  const result = compile(`async def load() -> number: return 7
def inspect(value: unknown): pass
def show(value: Promise<number>?):
    print(value)
    inspect(value)
def mixed(value: Promise<number> | number):
    print(value)
print({pending: load()})
`);
  assert.deepEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  assert.deepEqual(result.advisories.map((item) => item.code), ["A19", "A19"]);
});

test("callable signatures cannot turn mutable or mixed callees into builtin identities", () => {
  const result = compile(`async def load() -> number: return 7
def custom(value: unknown): pass
let output = print
output = custom
output(load())
def choose(flag: bool):
    const output = flag ? print : custom
    output(load())
`);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories, []);
});
