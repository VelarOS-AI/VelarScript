import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("lowers null and readable logical operators", () => {
  const result = compile(`
const missing = null
const visible = true and not false
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const missing = null;/);
  assert.match(result.code ?? "", /true && !\(false\)/);
});

test("in provides typed Python-style membership over JavaScript collections", () => {
  const result = compile(`
const names = ["Ada", "Lin"]
const tags = Set(["web", "game"])
const scores: Map<string, number> = Map()
scores.set("Ada", 9)
print("Ada" in names)
print("web" in tags)
print("Ada" in scores)
print("Script" in "VelarScript")
print("missing" not in names)

let order: List<string> = []

def needle() -> string:
    order.append("needle")
    return "Ada"

def haystack() -> List<string>:
    order.append("haystack")
    return names

print(needle() in haystack())
print(order.join(","))

order.clear()

print(needle() not in haystack())
print(order.join(","))

order.clear()

async def asyncNeedle() -> string:
    order.append("async needle")
    return "Lin"

async def asyncHaystack() -> List<string>:
    order.append("async haystack")
    return names

async def containsAsync() -> bool:
    return await asyncNeedle() in await asyncHaystack()

print(await containsAsync())
print(order.join(","))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarListContains\("Ada", names\)/u);
  assert.match(result.code ?? "", /__velarMapContains\("Ada", scores\)/u);
  assert.match(result.code ?? "", /!\(__velarListContains\("missing", names\)\)/u);
  assert.match(result.code ?? "", /__velarContains\("Script", "VelarScript"\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\ntrue\ntrue\nneedle,haystack\nfalse\nneedle,haystack\ntrue\nasync needle,async haystack\n");

  const invalid = compile("print(1 in \"123\")\nprint(1 not in \"123\")\nprint(\"x\" in {x: 1})\n");
  assert.ok(invalid.diagnostics.some((item) => /number and string have no values in common, so 'in' can never match/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Membership requires a List, Set, Map, Record, or string/u.test(item.message)));

  const dynamic = compileCore(`
import js unsafe {text, values} from "fixture"
print("lar" in text)
print(2 in values)
`.trimStart(), { analysis: { imports: new Map([
    ["text", { kind: "any" }],
    ["values", { kind: "any" }],
  ]) } });
  assert.deepEqual(dynamic.diagnostics, []);
  assert.match(dynamic.code ?? "", /__velarContains/u);
  const dynamicExecution = executeModule((dynamic.code ?? "").replace(/^import .*?;\n+/mu, 'const text = "VelarScript";\nconst values = [1, 2];\n'));
  assert.equal(dynamicExecution.status, 0, String(dynamicExecution.stderr));
  assert.equal(dynamicExecution.stdout, "true\ntrue\n");

  // The left operand is evaluated first; the later narrowed read is checked.
  const effects = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "Ada"

def contains(box: Box) -> bool:
    assert box.user != null
    return clear(box) in [box.user.name]
`.trimStart());
  assert.deepEqual(effects.diagnostics, []);
  assert.match(effects.code ?? "", /NarrowingError/u);
});

test("exponentiation is numeric and right-associative", () => {
  const result = compile(`
const squared = 3 ** 2
const tower = 2 ** 3 ** 2
const leading = -2 ** 2
const grouped = (-2) ** 2
const reciprocal = 2 ** -2
async def two() -> number:
    return 2
const awaited = await two() ** 2
const groupedAwait = (await two()) ** 2
print(squared)
print(tower)
print(leading)
print(grouped)
print(reciprocal)
print(awaited)
print(groupedAwait)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /2 \*\* \(3 \*\* 2\)/u);
  assert.match(result.code ?? "", /const leading = -\(\(2 \*\* 2\)\)/u);
  assert.match(result.code ?? "", /const grouped = \(\(-\(2\)\) \*\* 2\)/u);
  assert.match(result.code ?? "", /const reciprocal = \(2 \*\* -\(2\)\)/u);
  assert.match(result.code ?? "", /const awaited = \(\(await __velarNormalizePromiseValue\(two\(\)\)\) \*\* 2\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "9\n512\n-4\n4\n0.25\n4\n4\n");

  const invalid = compile("const value = \"2\" ** 3\n");
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
});

test("ordered comparison chains evaluate once, short-circuit, and preserve await", () => {
  const result = compile(`
let order: List<string> = []

def value(label: string, result: number) -> number:
    order.append(label)
    return result

async def load() -> number:
    return 5

async def inRange() -> bool:
    return 0 < await load() <= 10

const ascending = value("a", 1) < value("b", 2) < value("c", 3)
const stopped = value("d", 3) < value("e", 2) < value("f", 4)
const lexical = "alpha" < "beta" < "gamma"
// Equality no longer chains (D30 item 20), so this reads as two comparisons
// joined by 'and' — each operand still evaluates exactly once, in source order.
const equality = value("g", 4) == 4 and value("h", 4) != value("i", 5)
print(ascending)
print(stopped)
print(lexical)
print(equality)
print(await inRange())
print(order.size)
print(order[0])
print(order[1])
print(order[2])
print(order[3])
print(order[4])
print(order[5])
print(order[6])
print(order[7])
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCompare/u);
  assert.match(result.code ?? "", /await \(async \(\) =>/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\ntrue\ntrue\ntrue\n8\na\nb\nc\nd\ne\ng\nh\ni\n");

  const invalid = compile(`
class Item:
    pass

const booleans = true < false
const mixed = 1 < "2"
const objects = Item() < Item()
`.trimStart());
  assert.equal(invalid.diagnostics.filter((item) => /Ordered comparison requires two numbers or two strings/u.test(item.message)).length, 3);
});

test("equality split with 'and' carries successful-link facts into later operands and bodies", () => {
  // Equality no longer chains (D30 item 20): 'user != null != user.name' is
  // rejected, and the null narrowing it used to carry rides 'and' instead —
  // to the right operand and into the controlled body, with no optional-access
  // workaround at either place.
  const result = compileCore(`
type User:
    name: string

def hasName(user: User?) -> bool:
    return user != null and user.name != ""

def label(user: User?) -> string:
    if user != null and user.name != "":
        return user.name
    return "missing"

print(hasName(null))
print(hasName({name: "Ada"}))
print(label(null))
print(label({name: "Ada"}))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "false\ntrue\nmissing\nAda\n");

  const chained = compileCore("type User:\n    name: string\ndef broken(user: User?) -> bool:\n    return user != null != user.name\n");
  assert.deepEqual(
    chained.diagnostics.map((item) => item.message),
    ["Equality comparisons do not chain; split the comparisons with 'and'"],
  );
});
