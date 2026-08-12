import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function compileAndRun(source: string, suffix = ""): ReturnType<typeof spawnSync> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\n${suffix}`);
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

test("[#8] interpolated inline strings preserve carriage-return escapes", () => {
  const execution = compileAndRun(String.raw`
const marker = "N"
const plain = "a\rbN"
const interpolated = f"a\rb{marker}"
print(str(interpolated == plain))
print(str("\r" in interpolated))
print(str("\n" in interpolated))
`.trimStart());
  assert.equal(execution.stdout, "true\ntrue\nfalse\n");
});

test("[#11] layout strings preserve whitespace beyond the structural margin on blank lines", () => {
  const execution = compileAndRun([
    "const value = \"",
    "    one",
    "        ",
    "    two",
    "\"",
    'const expected = ["one", "    ", "two"].join("\\n")',
    "print(str(value == expected))",
    "",
  ].join("\n"));
  assert.equal(execution.stdout, "true\n");
});

test("[#12] deeply nested interpolated strings produce a bounded VEL diagnostic", () => {
  const nested = Array.from({ length: 800 }).reduce((value) => `f"{${value}}"`, "1");
  let result: ReturnType<typeof compile> | undefined;
  assert.doesNotThrow(() => { result = compile(`const value = ${nested}\n`); });
  assert.equal(result?.code, null);
  assert.ok(result?.diagnostics.some((item) => item.code === "VEL2008" && /complex/u.test(item.message)));
});

test("[#13] String.replace and replaceAll insert replacement text literally", () => {
  const execution = compileAndRun(String.raw`
print("Hello NAME".replace("NAME", "$&"))
print("cost: X5".replaceAll("X", "$$"))
print("a-b".replace("-", "$'"))
`.trimStart());
  assert.equal(execution.stdout, "Hello $&\ncost: $$5\na$'b\n");
});

test("[#14] List ordering accepts Infinity produced by ordinary arithmetic", () => {
  const execution = compileAndRun(`
const infinity = 100 / 0
const values: List<number> = [25, infinity, 50]
const direct = values.sorted()
const keyed = values.sorted(by=value => value)
print(str(values.min() == 25))
print(str(values.max() == infinity))
print(str(direct.get(2) == infinity))
print(str(keyed.get(2) == infinity))
`.trimStart());
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\n");

  const rejected = compile(`
const notNumber = 0 / 0
print([1, notNumber].sorted().size)
`.trimStart());
  assert.deepEqual(rejected.diagnostics, []);
  const rejectedExecution = executeModule(rejected.code ?? "");
  assert.notEqual(rejectedExecution.status, 0);
  assert.match(String(rejectedExecution.stderr), /TypeError: List\.sorted\(\) requires uniform non-NaN numbers or strings/u);
});

test("[#15/#20] text operations count code points and never split a surrogate pair", () => {
  const execution = compileAndRun(`
export const start = "😀".padStart(4, "-")
export const end = "abc".padEnd(6, "😀")
export const parts = "😀".split("")
export const inserted = "😀".replaceAll("", "-")
print(str(start.size))
print(str(end.size))
print(str(parts.size))
print(str(parts.get(0) == "😀"))
print(inserted)
print(str(inserted.size))
`.trimStart(), `
const wellFormed = value => Array.from(value).every(character => {
  if (character.length !== 1) return true;
  const unit = character.charCodeAt(0);
  return unit < 0xd800 || unit > 0xdfff;
});
console.log(wellFormed(start), wellFormed(end), parts.every(wellFormed), wellFormed(inserted));
`);
  assert.equal(execution.stdout, "4\n6\n1\ntrue\n-😀-\n3\ntrue true true true\n");
});

test("[#16] sorted(by=selector) statically rejects non-orderable key types", () => {
  const result = compile(`
const values: List<number> = [1]
const sorted = values.sorted(by=value => value > 0)
`.trimStart());
  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => /number or string|number \| string|only string or only number/u.test(item.message)));
});

test("[#17] unknown escapes are diagnosed in plain, interpolated, and layout strings", () => {
  const result = compile(String.raw`
const plain = "\x41"
const interpolated = f"\q{1}"
const layout = "
    \z
"
`.trimStart());
  const escapes = result.diagnostics.filter((item) => item.code === "VEL1008");
  assert.equal(escapes.length, 3);
  assert.ok(escapes.every((item) => /Unknown string escape/u.test(item.message)));
  assert.equal(result.code, null);
});

test("[#18] host undefined values become null consistently in Lists and Sets", () => {
  const module = "data:text/javascript,export function values(){return [1,undefined,3]}";
  const execution = compileAndRun(`
extern module "${module}":
    export def values() -> List<number?>

import js {values} from "${module}"

const found = values()
const copied = Set(found)
print(str(found.get(1) == null))
print(str(found.has(null)))
print(str(found.index(null) == 1))
print(str(copied.has(null)))
for value in found:
    if value == null:
        print("iter:null")
`.trimStart());
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\niter:null\n");
});

test("[#19] interpolated layout strings preserve CRLF as CRLF", () => {
  const source = [
    'const marker = "N"',
    'const value = f"',
    "    one",
    "    {marker}",
    '"',
    'print(str("\\r" in value))',
    'print(str(value.size))',
    '',
  ].join("\r\n");
  const execution = compileAndRun(source);
  assert.equal(execution.stdout, "true\n6\n");
});

test("[#20] all JavaScript replacement-pattern tokens remain literal text", () => {
  const execution = compileAndRun([
    'print("abc".replaceAll("b", "$&$&"))',
    'print("abc".replaceAll("b", "[$`|$\']"))',
    'print("xxx".replaceAll("x", "$$"))',
    "",
  ].join("\n"));
  assert.equal(execution.stdout, "a$&$&c\na[$`|$']c\n$$$$$$\n");
});

test("[#21] Unicode padding reaches the requested code-point size on both sides", () => {
  const execution = compileAndRun(`
const left = "ab".padStart(5, "😀")
const right = "ab".padEnd(5, "😀")
print(str(left.size))
print(str(right.size))
let leftCount = 0
for character in left:
    leftCount += 1
let rightCount = 0
for character in right:
    rightCount += 1
print(str(leftCount))
print(str(rightCount))
`.trimStart());
  assert.equal(execution.stdout, "5\n5\n5\n5\n");
});

test("[#22] very long flat expressions produce a bounded VEL diagnostic", () => {
  const expression = Array.from({ length: 1_000 }, () => "1").join(" + ");
  let result: ReturnType<typeof compile> | undefined;
  assert.doesNotThrow(() => { result = compile(`const value = ${expression}\n`); });
  assert.equal(result?.code, null);
  assert.ok(result?.diagnostics.some((item) => item.code === "VEL2008" && /complex/u.test(item.message)));
});

test("[#34] formatting preserves a tab-margined layout string's program and value", () => {
  const source = [
    "def command() -> string:",
    '  return "',
    "\tall:",
    "\t\techo hi",
    '  "',
    "",
    "print(command())",
    "",
  ].join("\n");
  const before = compileAndRun(source);
  const formatted = formatSource(source);
  const after = compileAndRun(formatted);
  assert.equal(before.stdout, "all:\n\techo hi\n");
  assert.equal(after.stdout, before.stdout);
  assert.equal(formatSource(formatted), formatted);
});

test("[#35] a raw inline string may begin with a doubled delimiter", () => {
  const execution = compileAndRun('print(r"""quoted"" text")\n');
  assert.equal(execution.stdout, '"quoted" text\n');

  const legacy = compile('const text = r"""legacy\ntext"""\n');
  assert.ok(legacy.diagnostics.some((item) => item.code === "VEL1005" && /layout string/u.test(item.message)));
});

test("[#36] replaceAll checks its complete output budget before replacement", () => {
  const result = compile(`
const source = "a".repeat(9000000)
const oversized = source.replaceAll("a", "aa")
print(str(oversized.size))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(String(execution.stderr), /RangeError: String\.replaceAll output cannot exceed 16 MiB/u);
});

test("[#37] named extern calls omit trailing defaulted parameters from JavaScript arity", () => {
  const module = "data:text/javascript,export function argc(...args){return args.length}";
  const execution = compileAndRun(`
extern module "${module}":
    export def argc(a: number = 1, b: number = 2, c: number = 3) -> number

import js {argc} from "${module}"

print(str(argc()))
print(str(argc(a=7)))
print(str(argc(b=8)))
print(str(argc(c=9)))
`.trimStart());
  assert.equal(execution.stdout, "0\n1\n2\n3\n");
});

test("[#40] a type test followed by ?: gets one targeted parenthesization diagnostic", () => {
  const result = compile(`
const value: unknown = "ready"
const label = value is string ? "yes" : "no"
print(label)
`.trimStart());
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "VEL2031");
  assert.match(result.diagnostics[0]?.message ?? "", /Parenthesize.*type test/u);

  const negative = compile(`
const value: unknown = "ready"
const label = value is not string ? "yes" : "no"
print(label)
`.trimStart());
  assert.equal(negative.diagnostics.length, 1);
  assert.equal(negative.diagnostics[0]?.code, "VEL2031");
  assert.match(negative.diagnostics[0]?.message ?? "", /Parenthesize.*type test/u);

  const execution = compileAndRun(`
const value: unknown = "ready"
print((value is string) ? "yes" : "no")
print((value is not number) ? "yes" : "no")
`.trimStart());
  assert.equal(execution.stdout, "yes\nyes\n");
});

test("[#41] explicit call type arguments get one inferred-arguments diagnostic without cascades", () => {
  const result = compile(`
def identity<T>(value: T) -> T:
    return value

print(identity<string>("x"))
`.trimStart());
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "VEL2031");
  assert.match(result.diagnostics[0]?.message ?? "", /Type arguments are inferred.*identity\(\.\.\.\)/u);

  const method = compile(`
class Box:
    def wrap<T>(value: T) -> T:
        return value

print(Box().wrap<string>("x"))
`.trimStart());
  assert.equal(method.diagnostics.length, 1);
  assert.equal(method.diagnostics[0]?.code, "VEL2031");
  assert.match(method.diagnostics[0]?.message ?? "", /Type arguments are inferred.*wrap\(\.\.\.\)/u);

  const comparison = compile(`
const a = 1
const b = 2
const c = 3
const valid = a<b>(c)
`.trimStart());
  assert.deepEqual(comparison.diagnostics, []);
});
