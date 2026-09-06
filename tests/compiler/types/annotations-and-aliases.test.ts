import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("optional unions preserve nullability before optional member access", () => {
  const valid = compile(`
type Left:
    name: string

type Right:
    name: string

def read(flag: bool, left: Left?, right: Right?) -> string?:
    const selected = flag ? left : right
    return selected?.name
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(`${valid.code ?? ""}
console.log(read(true, null, { name: "right" }) === null);
console.log(read(false, null, { name: "right" }));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nright\n");

  const invalid = compile(`
type Left:
    name: string

type Right:
    name: string

def read(flag: bool, left: Left?, right: Right?) -> string:
    const selected = flag ? left : right
    return selected?.name
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), [
    "Cannot assign string? to string",
  ]);
});

test("readonly wrappers and union field writes preserve capability restrictions", () => {
  const wrappers = compile(`
type User:
    name: string

def optional(user: readonly User?) -> string?:
    return user?.name

def either(user: readonly User | string):
    print(user)

const owned: User = {name: "Ada"}
const view: readonly User = owned
optional(view)
either(view)
`.trimStart());
  assert.deepEqual(wrappers.diagnostics, []);

  const writes = compile(`
type Open:
    name: string

type Locked:
    readonly name: string

type User:
    name: string

def writeDeclared(value: Open | Locked):
    value.name = "blocked"

def writeView(value: User | readonly User):
    value.name = "blocked"

const owned: User = {name: "Ada"}
const view: readonly User = owned
writeView(view)
`.trimStart());
  assert.deepEqual(writes.diagnostics.map((item) => item.message), [
    "Cannot assign field 'name' through Open | Locked because at least one variant exposes it as read-only; narrow the owner first",
    "Cannot assign field 'name' through User | readonly User because at least one variant exposes it as read-only; narrow the owner first",
  ]);
});

test("mutable Record aliases keep object field values invariant", () => {
  const invalid = compile(`
const counters = {count: 1}
let values: Record<number | string> = counters
values.set("count", "oops")
const total: number = counters.count + 1
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), [
    "Cannot assign { count: number } to Record<number | string>",
  ]);

  const valid = compile(`
const counters = {count: 1}
let exact: Record<number> = counters
const widened: readonly Record<number | string> = counters
exact.set("count", 2)
print(widened.get("count"))
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
});

test("type annotations guide familiar JavaScript and Python spellings without parser cascades", () => {
  const spellings = [
    ["const values: Array<number> = []\n", /Use 'List<T>'/u],
    ["const value: str = \"text\"\n", /Use 'string'/u],
    ["const value: String = \"text\"\n", /wrapper-object types are not exposed/u],
    ["const value: boolean = true\n", /Use 'bool'/u],
    ["const value: void = null\n", /Use 'null'/u],
    ["const value: object = {}\n", /Declare a named 'type'/u],
    ["const callback: Callable = value => value\n", /explicit function type/u],
  ] as const;
  for (const [source, expected] of spellings) {
    const result = compile(source);
    assert.equal(result.diagnostics.length, 1, result.diagnostics.map((item) => item.message).join("\n"));
    assert.equal(result.diagnostics[0]?.code, "VEL2012");
    assert.match(result.diagnostics[0]?.message ?? "", expected);
  }

  const square = compile("const values: List[number] = []\n");
  assert.equal(square.diagnostics.length, 1);
  assert.equal(square.diagnostics[0]?.message, "Generic type arguments use '<...>', not '[...]'");

  const python = compile("const values: list[number] = []\n");
  assert.deepEqual(python.diagnostics.map((item) => item.message), [
    "Use 'List<T>' for ordered collections",
    "Generic type arguments use '<...>', not '[...]'",
  ]);

  const map = compile("const values: Map[string, number] = Map()\n");
  assert.equal(map.diagnostics.length, 1);
  assert.equal(map.diagnostics[0]?.message, "Generic type arguments use '<...>', not '[...]'");
});

test("type validation keeps AST-level spans and contains invalid annotations at their source", () => {
  const missingSource = "const value: Missing = null\n";
  const missing = compile(missingSource);
  assert.equal(missing.diagnostics.length, 1);
  assert.deepEqual(missing.diagnostics[0]?.span, {
    start: missingSource.indexOf("Missing"),
    end: missingSource.indexOf("Missing") + "Missing".length,
  });

  const repeatedSource = "const values: Map<Missing, Missing> = Map()\n";
  const repeated = compile(repeatedSource);
  const firstMissing = repeatedSource.indexOf("Missing");
  const secondMissing = repeatedSource.indexOf("Missing", firstMissing + 1);
  assert.deepEqual(repeated.diagnostics.map((item) => item.span), [
    { start: firstMissing, end: firstMissing + "Missing".length },
    { start: secondMissing, end: secondMissing + "Missing".length },
  ]);
  assert.ok(repeated.diagnostics.every((item) => item.message === "Unknown type 'Missing'"));

  const functionSource = "const callback: (Missing) -> Missing = value => value\n";
  const functionType = compile(functionSource);
  assert.deepEqual(functionType.diagnostics.map((item) => item.span.start), [
    functionSource.indexOf("Missing"),
    functionSource.lastIndexOf("Missing"),
  ]);

  const alias = compile("type Broken = Missing\nconst value: Broken = null\n");
  assert.equal(alias.diagnostics.length, 1);
  assert.equal(alias.diagnostics[0]?.message, "Unknown type 'Missing'");

  const forwardAlias = compile("const value: Broken = null\ntype Broken = Missing\n");
  assert.equal(forwardAlias.diagnostics.length, 1);
  assert.equal(forwardAlias.diagnostics[0]?.message, "Unknown type 'Missing'");

  const genericSource = "const value: Missing<number> = null\n";
  const generic = compile(genericSource);
  assert.deepEqual(generic.diagnostics[0]?.span, {
    start: genericSource.indexOf("Missing"),
    end: genericSource.indexOf("Missing") + "Missing".length,
  });

  const anySource = "const values: List<any> = []\n";
  const any = compile(anySource);
  assert.deepEqual(any.diagnostics[0]?.span, {
    start: anySource.indexOf("any"),
    end: anySource.indexOf("any") + "any".length,
  });

  const webSource = `
component App(value: Missing):
    state current: List<Missing> = []
    return <p>{value}</p>
`.trimStart();
  const web = compile(webSource);
  assert.deepEqual(web.diagnostics.map((item) => item.span.start), [
    webSource.indexOf("Missing"),
    webSource.lastIndexOf("Missing"),
  ]);
  assert.ok(web.diagnostics.every((item) => item.message === "Unknown type 'Missing'"));

  const propagated = compile(`
const before: number = broken(null).field[0]() + 1
def broken(value: Missing) -> Missing:
    if value:
        throw value
    return value
const after: number = not broken(null)
`.trimStart());
  assert.equal(propagated.diagnostics.length, 2);
  assert.ok(propagated.diagnostics.every((item) => item.message === "Unknown type 'Missing'"));

  const invalidRuntimeType = compile(`
type Broken = Missing
const parsed: number = Broken.parse(null)
`.trimStart());
  assert.equal(invalidRuntimeType.diagnostics.length, 1);
  assert.equal(invalidRuntimeType.diagnostics[0]?.message, "Unknown type 'Missing'");

  const extern = compile(`
extern module "broken-sdk":
    export def broken(value: Missing) -> Missing

import js {broken} from "broken-sdk"
const value: number = broken(null)
`.trimStart());
  assert.equal(extern.diagnostics.length, 2);
  assert.ok(extern.diagnostics.every((item) => item.message === "Unknown type 'Missing'"));

  const webPropagation = compile(`
def broken() -> Missing:
    return null
component App:
    resource value: number = broken()
    return <p title={broken()}>{broken()}</p>
`.trimStart());
  assert.equal(webPropagation.diagnostics.length, 1);
  assert.equal(webPropagation.diagnostics[0]?.message, "Unknown type 'Missing'");
});
