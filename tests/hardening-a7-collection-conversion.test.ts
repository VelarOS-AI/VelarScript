import assert from "node:assert/strict";
import test from "node:test";
import { compile, formatSource, type CompileResult } from "@velarscript/compiler";

function compiled(source: string): CompileResult {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code}: ${item.message}`), [], source);
  assert.notEqual(result.code, null, "an advisory never blocks code generation");
  return result;
}

function a7(source: string): CompileResult["advisories"][number] {
  const result = compiled(source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A7"], source);
  return result.advisories[0]!;
}

test("[A7] an identity Set-to-List loop teaches Set.values()", () => {
  const source = `
def sortedValues(values: Set<string>) -> readonly List<string>:
    const result: List<string> = []
    for value in values:
        result.append(value)
    return result.sorted()
`.trimStart();
  const reported = a7(source);
  assert.match(reported.message, /'values\.values\(\)' already creates the same fresh List<string>/u);
  assert.equal(source.slice(reported.span.start, reported.span.end), "values");

  const canonical = compiled(`
def sortedValues(values: readonly Set<string>) -> readonly List<string>:
    return values.values().sorted()
`.trimStart());
  assert.deepEqual(canonical.advisories, []);
});

test("[A7] the same exact check covers the neighbouring collection snapshots and constructors", () => {
  const fixtures: readonly (readonly [string, string])[] = [
    ["List copy", `
const source: List<string> = ["a"]
const result: List<string> = []
for value in source:
    result.append(value)
print(result.size)
`],
    ["Map keys", `
const source: Map<string, number> = Map([["a", 1]])
const result: List<string> = []
for key in source:
    result.append(key)
print(result.size)
`],
    ["Record values", `
const source: Record<number> = {a: 1}
const result: List<number> = []
for key, value in source:
    result.append(value)
print(result.size)
`],
    ["List to Set", `
const source: List<string> = ["a"]
const result: Set<string> = Set()
for value in source:
    result.add(value)
print(result.size)
`],
    ["Map values to Set", `
const source: Map<string, number> = Map([["a", 1]])
const result: Set<number> = Set()
for key, value in source:
    result.add(value)
print(result.size)
`],
    ["Map copy", `
const source: Map<string, number> = Map([["a", 1]])
const result: Map<string, number> = Map()
for key, value in source:
    result.set(key, value)
print(result.size)
`],
    ["Record to Map with named arguments", `
const source: Record<number> = {a: 1}
const result: Map<string, number> = Map()
for key, value in source:
    result.set(value=value, key=key)
print(result.size)
`],
  ];

  const replacements = ["source.copy()", "source.keys()", "source.values()", "Set(source)", "Set(source.values())", "source.copy()", "Map(source)"];
  fixtures.forEach(([label, source], index) => {
    const reported = a7(source.trimStart());
    assert.match(reported.message, new RegExp(`'${replacements[index]!.replace(/[().]/gu, "\\$&")}' already creates`, "u"), label);
  });
});

test("[A7] transforms, filters, effects, existing contents, distance, and computed sources stay silent", () => {
  const silent = [
    `
const source: Set<string> = Set(["a"])
const result: List<string> = []
for value in source:
    result.append(value.trim())
print(result.size)
`,
    `
const source: Set<string> = Set(["a"])
const result: List<string> = []
for value in source:
    if value != "":
        result.append(value)
print(result.size)
`,
    `
const source: Set<string> = Set(["a"])
const result: List<string> = []
for value in source:
    result.append(value)
    print(value)
print(result.size)
`,
    `
const source: Set<string> = Set(["a"])
const result: List<string> = ["seed"]
for value in source:
    result.append(value)
print(result.size)
`,
    `
const source: Set<string> = Set(["a"])
const result: List<string> = []
print("copy")
for value in source:
    result.append(value)
print(result.size)
`,
    `
def values() -> Set<string>:
    return Set(["a"])
const result: List<string> = []
for value in values():
    result.append(value)
print(result.size)
`,
    `
const result: List<string> = []
for value in result:
    result.append(value)
print(result.size)
`,
    `
const source: Map<string, List<string>> = Map([["a", []]])
const result: List<string> = []
for key, result in source:
    result.append(key)
print(result.size)
`,
  ];
  for (const source of silent) assert.deepEqual(compiled(source.trimStart()).advisories, [], source);
});

test("[A7] a reasoned suppression works, while bare and stale suppressions fail", () => {
  const suppressed = `
const source: Set<string> = Set(["a"])
const result: List<string> = []
for value in source: // velar-allow A7: the expanded loop is a teaching example
    result.append(value)
print(result.size)
`.trimStart();
  assert.deepEqual(compiled(suppressed).advisories, []);
  assert.equal(formatSource(suppressed), suppressed);
  assert.equal(formatSource(formatSource(suppressed)), suppressed);

  const bare = compile(suppressed.replace(": the expanded loop is a teaching example", ""));
  assert.deepEqual(bare.diagnostics.map((item) => item.code), ["VEL1011"]);
  assert.deepEqual(bare.advisories, []);

  const stale = compile(`
const source: Set<string> = Set(["a"])
const result = source.values() // velar-allow A7: the expanded loop is a teaching example
print(result.size)
`.trimStart());
  assert.deepEqual(stale.advisories, []);
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});
