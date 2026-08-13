import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const CONTRACT = "VEL4026";
const F_STRING_LEAD = /^An f-string renders strings, numbers, bools, enums, null, and extension values with a declared text form; format /u;
const STR_LEAD = /^str\(\) converts strings, numbers, bools, enums, null, and extension values with a declared text form; format /u;
const TWO_EXITS = /print\(value\) to inspect it, or stringify\(value\) for data text \(import \{stringify\} from "velar\/json"\)$/u;

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function runClean(source: string): ReturnType<typeof spawnSync> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

function contractRejections(source: string): readonly string[] {
  const result = compile(source);
  const rejections = result.diagnostics.filter((item) => item.code === CONTRACT);
  assert.ok(rejections.length > 0, `expected a ${CONTRACT} rejection:\n${result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n")}`);
  for (const item of rejections) assert.match(item.message, TWO_EXITS);
  return rejections.map((item) => item.message);
}

test("a record in an f-string is rejected and the diagnostic teaches both exits", () => {
  const messages = contractRejections(`
type User:
    id: number
    name: string

const user: User = {id: 1, name: "Ada"}
print(f"user: {user}")
`.trimStart());
  assert.equal(messages.length, 1);
  assert.match(messages[0]!, F_STRING_LEAD);
  assert.match(messages[0]!, /format User explicitly/u);
});

test("an own 'toString' data field never runs: the object is rejected in both f-strings and str()", () => {
  const messages = contractRejections(`
const sneaky = {toString: () => "HOOK-INVOKED"}
print(f"value: {sneaky}")
print(str(sneaky))
`.trimStart());
  assert.equal(messages.length, 2);
  assert.match(messages[0]!, F_STRING_LEAD);
  assert.match(messages[1]!, STR_LEAD);
});

test("collections, functions, class instances, unknown, and any are all outside the conversion contract", () => {
  const cases: readonly [string, string][] = [
    ['print(f"list: {[1, 2, 3]}")', "List<number>"],
    ['const pairs = Map([["a", 1]])\nprint(f"{pairs}")', "Map<string, number>"],
    ['const bag = Set(["a"])\nprint(f"{bag}")', "Set<string>"],
    ['const record: Record<number> = {a: 1}\nprint(f"{record}")', "Record<number>"],
    ['def helper() -> null:\n    pass\nprint(f"{helper}")', "() -> null"],
    ['class Ticket:\n    pass\nconst ticket = Ticket()\nprint(f"{ticket}")', "Ticket"],
    ['def show(value: unknown) -> string:\n    return f"{value}"', "unknown"],
  ];
  for (const [source, described] of cases) {
    const messages = contractRejections(`${source}\n`);
    assert.ok(
      messages.some((message) => message.includes(`format ${described} explicitly`)),
      `${described}:\n${messages.join("\n")}`,
    );
  }

  const unsafeAny = contractRejections('import js unsafe {legacyValue} from "legacy-package"\nprint(f"{legacyValue}")\n');
  assert.match(unsafeAny[0]!, /format any explicitly/u);
});

test("str() enforces the same contract, including through the named-argument spelling", () => {
  const positional = contractRejections('type Row:\n    id: number\nconst row: Row = {id: 1}\nprint(str(row))\n');
  assert.match(positional[0]!, STR_LEAD);
  assert.match(positional[0]!, /format Row explicitly/u);

  const named = contractRejections('type Row:\n    id: number\nconst row: Row = {id: 1}\nprint(str(value = row))\n');
  assert.match(named[0]!, STR_LEAD);
});

test("the whitelist renders inertly: strings, numbers, bools, enums, null, optionals, and unions", () => {
  const execution = runClean(`
enum Color:
    Red
    Blue

const count = 3
const flag = true
const missing: string? = null
const present: string? = "here"
const either: string | number = 7
const held: Color = Color.Blue
print(f"{count} {flag} {missing} {present} {either} {Color.Red} {held}")
print(str(42))
print(str(true))
print(str(null))
print(str(Color.Red))
print(str(present))
`.trimStart());
  assert.equal(execution.stdout, [
    "3 true null here 7 Red Blue",
    "42",
    "true",
    "null",
    "Red",
    "here",
  ].join("\n") + "\n");
});

test("Infinity and NaN print honestly: logs stay truthful", () => {
  const execution = runClean(`
const infinite = 1 / 0
const notANumber = 0 / 0
print(f"{infinite} {notANumber} {-infinite}")
print(str(infinite))
`.trimStart());
  assert.equal(execution.stdout, "Infinity NaN -Infinity\nInfinity\n");
});

test("the JSX children contract and the f-string contract reject the same value", () => {
  const result = compile(`
type User:
    name: string

component Card(user: User):
    return <div>
        <span>{user}</span>
        <span>{f"{user}"}</span>
    </div>
`.trimStart(), { extensions: [velarCompilerExtension] });
  const codes = result.diagnostics.map((item) => item.code).sort();
  assert.deepEqual(codes, ["VEL4026", "VEL5047"], result.diagnostics.map((item) => item.message).join("\n"));
});

test("web unit values declare a total text form for f-strings and str()", () => {
  const result = compile(`
const width = 12px
const ratio = 50%
const time = 300ms
const angle = 0.5turn
print(f"gap: {width}; ratio: {ratio}; time: {time}; angle: {angle}")
print(str(width))
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "gap: 12px; ratio: 50%; time: 300ms; angle: 0.5turn\n12px\n");
});

test("a Web extension value without a text form keeps VEL4026 and offers only inspection", () => {
  const result = compile(`
const card = look:
    display = "grid"
print(f"{card}")
`.trimStart(), { extensions: [velarCompilerExtension] });
  const rejection = result.diagnostics.find((item) => item.code === CONTRACT);
  assert.ok(rejection, result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
  assert.match(rejection.message, /format Look explicitly — print\(value\) to inspect it$/u);
  assert.doesNotMatch(rejection.message, /stringify/u);
});

test("recovered earlier guidance still reaches the conversion check in the same compile", () => {
  // 'fr' recovers to 'rf', so the conversion contract co-reports the record
  // in the same compile instead of hiding behind the prefix guidance.
  const result = compile(`
type User:
    name: string

const user: User = {name: "Ada"}
const text = fr"{user}"
`.trimStart());
  assert.ok(result.diagnostics.some((item) => item.code === "VEL1005" && item.recovered === true));
  assert.ok(result.diagnostics.some((item) => item.code === CONTRACT));
});
