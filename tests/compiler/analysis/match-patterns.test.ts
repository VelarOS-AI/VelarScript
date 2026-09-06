import assert from "node:assert/strict";
import test from "node:test";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("match structurally destructures records and Lists with safe scoped bindings", () => {
  const result = compile(`
type Payload:
    kind: string
    name: string
    scores: List<number>
    active: bool

def describe(payload: Payload) -> string:
    match payload:
        case {kind: "user", name, scores: [first, ...rest], ...details} as whole if details.active:
            return f"{whole.kind}:{name}:{first}:{rest.size}"
        case {kind: "user", name}:
            return name
        case _:
            return "other"

def listShape(values: List<number>) -> string:
    match values:
        case []:
            return "empty"
        case [only]:
            return f"one:{only}"
        case [first, second] as pair:
            return f"pair:{first + second}:{pair.size}"
        case [first, ...rest]:
            return f"many:{first}:{rest.size}"

const payload: Payload = {kind: "user", name: "Ada", scores: [7, 8, 9], active: true}
print(describe(payload))
print(listShape([]))
print(listShape([4]))
print(listShape([4, 5]))
print(listShape([4, 5, 6]))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCollectionRecordGetOwnPropertyDescriptor\(__velarMatchValue\d+, "kind"\)/u);
  assert.match(result.code ?? "", /__velarCollectionRecordOwnNames/u);
  assert.match(result.code ?? "", /__velarCollectionListIsArray/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "user:Ada:7:2\nempty\none:4\npair:9:2\nmany:4:2\n");
});

test("structural match retains its initialization-owned host ABI and mismatch semantics", () => {
  const result = compile(`
type Payload:
    kind: string
    name: string
    scores: List<number>
    active: bool

export def classify(value: Payload | List<number> | null) -> string:
    match value:
        case {kind: "user", scores: [first, ...rest], ...details}:
            return f"object:{first}:{rest.size}:{details.active}"
        case [first, ...rest]:
            return f"list:{first}:{rest.size}"
        case _:
            return "other"
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const code = (result.code ?? "").replaceAll("1000000", "5");
  const matchStart = code.indexOf("export function classify");
  const matchSource = code.slice(matchStart);
  assert.doesNotMatch(matchSource, /\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|defineProperty)|Reflect\.apply)\b|\.push\s*\(|for \(const/u);
  assert.match(matchSource, /__velarCollectionListGetOwnPropertyDescriptor/u);
  assert.match(matchSource, /__velarCollectionRecordDefineProperty/u);

  const execution = executeModule(`${code}
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const accessor = NativeObject.defineProperty({}, "kind", { enumerable: true, get() { throw new NativeTypeError("getter invoked"); } });
const symbolRecord = {kind: "user", scores: [1], active: true, [Symbol("private")]: 1};
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned host intrinsic"); };
globalThis.Array = poison;
globalThis.Object = poison;
globalThis.Reflect = { apply: poison };
NativeArray.isArray = poison;
NativeArray.prototype.push = poison;
NativeArray.prototype[Symbol.iterator] = poison;
NativeObject.getOwnPropertyDescriptor = poison;
NativeObject.getOwnPropertyNames = poison;
NativeObject.getOwnPropertySymbols = poison;
NativeObject.defineProperty = poison;
NativeReflect.apply = poison;

const sparse = new NativeArray(2);
sparse[0] = 1;
console.log(classify({kind: "user", name: "Ada", scores: [7, 8, 9], active: true}));
console.log(classify([4, 5, 6]));
console.log(classify(sparse));
console.log(classify(accessor));
console.log(classify(symbolRecord));
console.log(classify({kind: "user", name: "Ada", scores: [1], active: true, extra: 1, overflow: 2}));
console.log(poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "object:7:2:true\nlist:4:2\nother\nother\nother\nother\n0\n");
});

test("match structural patterns diagnose impossible shapes and ambiguous bindings", () => {
  const impossibleList = compile(`
match "text":
    case [first]:
        print(first)
`.trimStart());
  assert.ok(impossibleList.diagnostics.some((item) => /List pattern can never match string/u.test(item.message)));

  const missingField = compile(`
type User:
    name: string

const user: User = {name: "Ada"}
match user:
    case {missing}:
        print(missing)
`.trimStart());
  assert.ok(missingField.diagnostics.some((item) => /field 'missing' does not exist on User/u.test(item.message)));

  const duplicates = compile(`
match [1, 2]:
    case [value, value]:
        print(value)
    case _:
        pass
    case [last]:
        print(last)
`.trimStart());
  assert.ok(duplicates.diagnostics.some((item) => item.code === "VEL4019" && /binding 'value'.*more than once/u.test(item.message)));
  assert.ok(duplicates.diagnostics.some((item) => item.code === "VEL4014" && /already covered/u.test(item.message)));

  const malformedRest = compile(`
match [1, 2]:
    case [first, ...rest, last]:
        pass
`.trimStart());
  assert.ok(malformedRest.diagnostics.some((item) => item.code === "VEL2015" && /rest pattern must be last/u.test(item.message)));

  const impossibleUnionShape = compile(`
type Left:
    left: string

type Right:
    right: number

def inspect(value: Left | Right):
    match value:
        case {left, right}:
            print(left, right)
`.trimStart());
  assert.ok(impossibleUnionShape.diagnostics.some((item) => /fields cannot occur together on Left \| Right/u.test(item.message)));

  const unreachableFallback = compile(`
match true:
    case _:
        pass
    case _:
        pass
`.trimStart());
  assert.ok(unreachableFallback.diagnostics.some((item) => item.code === "VEL4014" && /This match branch is already covered/u.test(item.message)));
});

test("match structural bindings carry precise semantic types and lexical references", () => {
  const source = `
type Payload:
    name: string
    scores: List<number>

def inspect(payload: Payload):
    match payload:
        case {name, scores: [first, ...rest]} as whole:
            print(name)
            print(first)
            print(rest.size)
            print(whole.name)
`.trimStart();
  const result = compile(source, { path: "/tmp/match-patterns.vel" });
  assert.deepEqual(result.diagnostics, []);
  const symbols = new Map(result.semanticIndex.symbols.map((symbol) => [symbol.name, symbol]));
  assert.equal(symbols.get("name")?.type, "string");
  assert.equal(symbols.get("first")?.type, "number");
  assert.equal(symbols.get("rest")?.type, "List<number>");
  assert.equal(symbols.get("whole")?.type, "Payload");
  for (const name of ["name", "first", "rest", "whole"]) {
    assert.equal(result.semanticIndex.references.filter((reference) => reference.name === name).length, 1);
  }
  assert.ok(result.semanticIndex.memberReferences.some((reference) => reference.name === "name" && reference.syntax === "binding-key"));

  const union = compile(`
type Left:
    left: string

type Right:
    right: number

def inspect(value: Left | Right):
    match value:
        case {left} as selectedLeft:
            print(left)
            print(selectedLeft.left)
        case {right} as selectedRight:
            print(right)
            print(selectedRight.right)
`.trimStart());
  assert.deepEqual(union.diagnostics, []);
  const unionSymbols = new Map(union.semanticIndex.symbols.map((symbol) => [symbol.name, symbol.type]));
  assert.equal(unionSymbols.get("selectedLeft"), "Left");
  assert.equal(unionSymbols.get("selectedRight"), "Right");
});

test("match participates in component reactivity and scoped case bindings", () => {
  const result = compile(`
component Badge:
    state status = "ready"

    def label() -> string:
        match status:
            case "ready":
                const message = "Ready"
                return message
            case "failed":
                const message = "Failed"
                return message
            case _:
                return "Unknown"

    return <p>{label()}</p>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarMatchValue\d+ = status\.get\(\);/u);
});
