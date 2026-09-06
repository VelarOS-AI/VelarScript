import assert from "node:assert/strict";
import test from "node:test";
import { describeType } from "@velarscript/compiler";
import { isAssignable, sameType } from "../../../packages/compiler/src/types.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("function types make component callbacks explicit without a second type system", () => {
  const result = compile(`
component Choice(label: string, onChoose: (string) -> null):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>

component App:
    state selected = "null"

    def choose(label: string):
        selected = label
        return null

    return <main><Choice label="Velar" onChoose={choose} /><p>{selected}</p></main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /onChoose\.get\(\)\(label\.get\(\)\)/u);
  const callback = result.semanticIndex.symbols.find((item) => item.kind === "parameter" && item.name === "onChoose");
  assert.equal(callback?.type, "(string) -> null");
  assert.equal(describeType({
    kind: "function",
    parameters: [{ kind: "string" }],
    requiredParameters: 1,
    rest: { kind: "number" },
    result: { kind: "bool" },
  }), "(string, ...number) -> bool");
  assert.equal(describeType({
    kind: "optional",
    inner: { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } },
  }), "(() -> null)?");
  assert.equal(describeType({
    kind: "optional",
    inner: { kind: "union", members: [{ kind: "string" }, { kind: "number" }] },
  }), "(string | number)?");
  assert.equal(describeType({
    kind: "function",
    parameters: [{ kind: "optional", inner: { kind: "string" } }],
    requiredParameters: 0,
    result: { kind: "null" },
  }), "(string? = default) -> null");

  const requiredCallback = {
    kind: "function" as const,
    parameters: [{ kind: "string" as const }],
    requiredParameters: 1,
    result: { kind: "null" as const },
  };
  const defaultableCallback = { ...requiredCallback, requiredParameters: 0 };
  const emptyEnvironment = {
    fieldsOf: () => null,
    isSubclassOf: () => false,
    isPrimitiveType: () => false,
    isPrimitiveSubtype: () => false,
  };
  assert.equal(sameType(requiredCallback, defaultableCallback), false);
  assert.equal(isAssignable(defaultableCallback, requiredCallback, emptyEnvironment), true);
  assert.equal(isAssignable(requiredCallback, defaultableCallback, emptyEnvironment), false);

  const grouped = compile(`
type MaybeValue = (string | number)?
const callback: (() -> null)? = null
const value: MaybeValue = "ready"
`.trimStart());
  assert.deepEqual(grouped.diagnostics, []);

  const invalid = compile(`
component Choice(onChoose: (string) -> null):
    return <button type="button" on:click={() => onChoose("value")}>Choose</button>

component App:
    return <Choice onChoose={(value: number) => null} />
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign \(value: number\) -> null to \(string\) -> null/u.test(item.message)));

  const incompatibleDefaultOverride = compile(`
class Greeter:
    def greet(name: string = "world") -> string:
        return name

class FormalGreeter extends Greeter:
    override def greet(name: string) -> string:
        return name
`.trimStart());
  assert.ok(incompatibleDefaultOverride.diagnostics.some((item) => /must keep the base method signature \(name: string = default\) -> string/u.test(item.message)));

  const malformed = compile("const callback: (...string, number) -> null = (value, next) => null\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2016" && /rest function type parameter must be final/u.test(item.message)));

  const runtime = compile(`
type Handler:
    run: (string) -> null

const handler = Handler.parse({run: value => print(value)})
print(handler is Handler)
handler.run("checked")
`.trimStart());
  assert.deepEqual(runtime.diagnostics, []);
  const execution = executeModule(runtime.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nchecked\n");
});

test("writable structural values are invariant and semantic type identity is order independent", () => {
  const unsafeWidening = compile(`
class Animal:
    const name: string

    constructor(name: string):
        self.name = name

class Dog extends Animal:
    constructor(name: string):
        super(name)

    def bark() -> string:
        return "woof"

type AnimalBox:
    value: Animal

const dogBox = {value: Dog("Rex")}
const animalBox: AnimalBox = dogBox
animalBox.value = Animal("Base")
print(dogBox.value.bark())
`.trimStart());
  assert.ok(unsafeWidening.diagnostics.some((item) => /Cannot assign \{ value: Dog \} to AnimalBox/u.test(item.message)));

  const freshness = compile(`
class Animal:
    const name: string

    constructor(name: string):
        self.name = name

class Dog extends Animal:
    constructor(name: string):
        super(name)

type AnimalBox:
    value: Animal

type Outer:
    box: AnimalBox

const fresh: Outer = {box: {value: Dog("Rex")}}
const make: () -> Outer = () => ({box: {value: Dog("Milo")}})
const selected: Outer? = true ? {box: {value: Dog("Nova")}} : null
const aliasedBox = {value: Dog("Ada")}
const unsafeOuter: Outer = {box: aliasedBox}
const aliasedOuter = {box: aliasedBox}
const unsafeSpread: Outer = {...aliasedOuter}
`.trimStart());
  assert.equal(freshness.diagnostics.filter((item) => /Cannot assign/u.test(item.message)).length, 2);
  assert.match(freshness.diagnostics.find((item) => /Cannot assign/u.test(item.message))?.message ?? "", /\{ value: Dog \} to AnimalBox/u);

  const leftObject = { kind: "object" as const, fields: new Map([
    ["name", { kind: "string" as const }],
    ["score", { kind: "number" as const }],
  ]) };
  const rightObject = { kind: "object" as const, fields: new Map([
    ["score", { kind: "number" as const }],
    ["name", { kind: "string" as const }],
  ]) };
  assert.equal(sameType(leftObject, rightObject), true);
  assert.equal(sameType(
    { kind: "object", fields: new Map([["a", { kind: "string" }], ["b", { kind: "number" }]]) },
    { kind: "object", fields: new Map([["a:string,b", { kind: "number" }]]) },
  ), false);
  assert.equal(sameType(
    { kind: "map", key: { kind: "named", name: "Left", identity: "x:named:y" }, value: { kind: "string" } },
    { kind: "map", key: { kind: "named", name: "Left", identity: "x" }, value: { kind: "named", name: "Right", identity: "y:string" } },
  ), false);
  const readonlyObject = { ...leftObject, readonlyFields: new Set(["name"]) };
  const structuralEnvironment = { fieldsOf: () => null, isSubclassOf: () => false, isPrimitiveType: () => false, isPrimitiveSubtype: () => false };
  assert.equal(sameType(leftObject, readonlyObject), false);
  assert.equal(isAssignable(leftObject, readonlyObject, structuralEnvironment), true);
  assert.equal(isAssignable(readonlyObject, leftObject, structuralEnvironment), false);
  assert.equal(sameType(
    { kind: "union", members: [{ kind: "string" }, { kind: "number" }] },
    { kind: "union", members: [{ kind: "number" }, { kind: "string" }] },
  ), true);
  assert.equal(sameType(
    { kind: "extension", extensionId: "@velarscript/web", family: "component", role: "constructor", nominal: "Card", properties: new Map([["title", { kind: "string" }]]), requiredProperties: new Set(["title"]), arguments: [], display: { kind: "constructor", prefix: "component", name: "Card" } },
    { kind: "extension", extensionId: "@velarscript/web", family: "component", role: "constructor", nominal: "Card", properties: new Map([["count", { kind: "number" }]]), requiredProperties: new Set(["count"]), arguments: [], display: { kind: "constructor", prefix: "component", name: "Card" } },
  ), false);
  assert.equal(sameType(
    { kind: "intrinsic", name: "json.stringify", parameters: [{ kind: "unknown" }], requiredParameters: 1, result: { kind: "string" } },
    { kind: "intrinsic", name: "json.clone", parameters: [{ kind: "unknown" }], requiredParameters: 1, result: { kind: "string" } },
  ), false);
  const redundantNull = compile("const value: null? = null\n");
  assert.ok(redundantNull.diagnostics.some((item) => item.message === "'null?' is redundant; use 'null'"));
});

test("callable compatibility accepts safe optional and rest parameter domains", () => {
  const valid = compile(`
def collect(...values: number):
    return null

def format(value: string, suffix: string = "") -> string:
    return value + suffix

const single: (number) -> null = collect
const basic: (string) -> string = format
single(1)
print(basic("ready"))
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\n");

  const invalid = compile(`
def one(value: number):
    return null

const variadic: (...number) -> null = one
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign \(value: number\) -> null to \(\.\.\.number\) -> null/u.test(item.message)));
});
