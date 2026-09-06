import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("supports object shorthand plus controlled object and List binding patterns", () => {
  const result = compile(`
const base = {name: "Ada", score: 1}
const score = 2
const merged = {...base, score}
const {name, ...details} = merged
const source = [1, 2]
const [first, ...rest] = [0, ...source]
print(f"{name}:{details.score}:{first}:{rest.size}")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada:2:0:2\n");

  const duplicate = compile("const value = {name: \"Ada\", name: \"Lin\"}\n");
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL4004" && /declared more than once/u.test(item.message)));

  const quoted = compile("const value = {\"name\"}\n");
  assert.ok(quoted.diagnostics.some((item) => item.code === "VEL2020" && /requires ':' and a value/u.test(item.message)));
});

test("controlled List and Record construction thunks return object literals", () => {
  const result = compileCore(`
const base = [{value: 1}]
const rows = [...base, {value: 2}]
const row = {...{value: 3}}
print(rows[1].value + row.value)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\(\) => \(\{ value: 2 \}\)/u);
  assert.match(result.code ?? "", /\(\) => \(\{ value: 3 \}\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "5\n");
});

test("record construction preserves source order without native object magic or accessor reads", () => {
  const ordinary = compile(`
const value = {"__proto__": "owned", constructor: "field"}
print(value.constructor)
`.trimStart());
  assert.deepEqual(ordinary.diagnostics, []);
  assert.match(ordinary.code ?? "", /__velarCreateRecord/u);
  const ordinaryExecution = executeModule(`${ordinary.code ?? ""}\nconsole.log(Object.getPrototypeOf(value) === Object.prototype, Object.prototype.hasOwnProperty.call(value, "__proto__"), Object.getOwnPropertyDescriptor(value, "__proto__").value);\n`);
  assert.equal(ordinaryExecution.status, 0, String(ordinaryExecution.stderr));
  assert.equal(ordinaryExecution.stdout, "field\ntrue true owned\n");

  const unsafeSource = Buffer.from([
    "export const accessor=Object.defineProperty({},'name',{enumerable:true,get(){console.log('getter called');return 'Ada'}})",
    "export const symbol=Object.assign({name:'Ada'},{[Symbol('private')]:'hidden'})",
    "export const nullish={name:undefined}",
  ].join(";"), "utf8").toString("base64");
  for (const [name, message] of [
    ["accessor", /cannot copy accessor field 'name'/u],
    ["symbol", /cannot copy symbol fields/u],
  ] as const) {
    // D90 R17: a spread operand needs a declared shape; the lie about what
    // the module really exports is exactly what the runtime copy guards
    // under test exist to catch.
    const rejected = compile(`
type Payload:
    name: string

extern module "data:text/javascript;base64,${unsafeSource}":
    export const accessor: Payload
    export const symbol: Payload
    export const nullish: Payload

import js {${name} as payload} from "data:text/javascript;base64,${unsafeSource}"
const copied = {...payload}
print(copied)
`.trimStart());
    assert.deepEqual(rejected.diagnostics, []);
    const execution = executeModule(rejected.code ?? "");
    assert.notEqual(execution.status, 0);
    assert.equal(execution.stdout, "");
    assert.match(String(execution.stderr), message);
  }

  const nullish = compile(`
type Payload:
    name: string

extern module "data:text/javascript;base64,${unsafeSource}":
    export const nullish: Payload

import js {nullish as payload} from "data:text/javascript;base64,${unsafeSource}"
const copied = {...payload}
`.trimStart());
  assert.deepEqual(nullish.diagnostics, []);
  const nullishExecution = executeModule(`${nullish.code ?? ""}\nconsole.log(copied.name === null);\n`);
  assert.equal(nullishExecution.status, 0, String(nullishExecution.stderr));
  assert.equal(nullishExecution.stdout, "true\n");

  const promiseSource = Buffer.from("export const promise=Promise.resolve(5)", "utf8").toString("base64");
  const asynchronous = compile(`
import js unsafe {promise} from "data:text/javascript;base64,${promiseSource}"

type Payload:
    name: string

async def read(value: number) -> number:
    print(f"read:{value}")
    return value

async def load() -> Payload:
    print("load")
    return {name: "Ada"}

const record = {first: await read(1), ...await load(), promise, last: await read(2)}
print(record.promise == promise)
`.trimStart());
  assert.deepEqual(asynchronous.diagnostics, []);
  assert.match(asynchronous.code ?? "", /await __velarCreateRecordAsync/u);
  const asynchronousExecution = executeModule(asynchronous.code ?? "");
  assert.equal(asynchronousExecution.status, 0, String(asynchronousExecution.stderr));
  assert.equal(asynchronousExecution.stdout, "read:1\nload\nread:2\ntrue\n");
});

test("record construction and binding patterns retain their initialization-owned host ABI", () => {
  const result = compile(`
type Sides:
    a: number
    b: number

export def create(source: Record<number>) -> Record<number>:
    return {"__proto__": 1, ...source, a: 4}

export async def createAsync(source: Promise<Record<number>>) -> Record<number>:
    return {"__proto__": 1, ...await source, a: 5}

export def bindObject(source: Sides) -> List<number>:
    const {a, ...rest} = source
    return [a, rest.b]

export def bindList(source: List<number>) -> List<number>:
    const [first, ...rest] = source
    return [first, rest[0], rest.size]
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const code = (result.code ?? "").replaceAll("1000000", "3");
  const recordHelpers = code.slice(code.indexOf("function __velarSetRecordField"), code.indexOf("const __velarMaxBindingFields"));
  const objectBindingHelpers = code.slice(code.indexOf("function __velarRequireBindingObject"), code.indexOf("function __velarRequireBindingList"));
  const listBindingStart = code.indexOf("function __velarRequireBindingList");
  const listBindingHelpers = code.slice(listBindingStart, code.indexOf("\n\nexport ", listBindingStart));
  assert.doesNotMatch(recordHelpers, /Object\.|Array\.|Reflect\.|\.call\s*\(|for \(const|new (?:TypeError|RangeError)/u);
  assert.doesNotMatch(objectBindingHelpers, /Object\.|Array\.|Reflect\.|for \(const|new (?:TypeError|RangeError)/u);
  assert.doesNotMatch(listBindingHelpers, /Object\.|Array\.|Reflect\.|\.push\s*\(|for \(const|new (?:TypeError|RangeError)/u);

  const execution = executeModule(`${code}
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const NativeRangeError = globalThis.RangeError;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned host intrinsic"); };
globalThis.Array = poison;
globalThis.Object = poison;
globalThis.Reflect = { apply: poison, deleteProperty: poison };
globalThis.TypeError = poison;
globalThis.RangeError = poison;
NativeArray.isArray = poison;
NativeArray.prototype.push = poison;
NativeArray.prototype[Symbol.iterator] = poison;
NativeObject.getOwnPropertyDescriptor = poison;
NativeObject.getOwnPropertyNames = poison;
NativeObject.getOwnPropertySymbols = poison;
NativeObject.defineProperty = poison;
NativeObject.is = poison;
NativeObject.prototype.hasOwnProperty = poison;
NativeReflect.apply = poison;
NativeReflect.deleteProperty = poison;

const record = create({a: 2, b: 3});
const asynchronous = await createAsync(Promise.resolve({a: 2, b: 3}));
const objectItems = bindObject({a: 2, b: 3});
const listItems = bindList([7, 8, 9]);
const typeFailure = (() => { try { create([]); return null; } catch (error) { return error; } })();
const objectBindingFailure = (() => { try { bindObject([]); return null; } catch (error) { return error; } })();
const listBindingFailure = (() => { try { bindList({0: 1, length: 1}); return null; } catch (error) { return error; } })();
const rangeFailure = (() => { try { create({a: 1, b: 2, c: 3, d: 4}); return null; } catch (error) { return error; } })();
console.log(record["__proto__"], record.a, record.b, asynchronous["__proto__"], asynchronous.a, asynchronous.b);
console.log(objectItems[0], objectItems[1], listItems[0], listItems[1], listItems[2]);
console.log(typeFailure instanceof NativeTypeError, objectBindingFailure instanceof NativeTypeError, listBindingFailure instanceof NativeTypeError, rangeFailure instanceof NativeRangeError, poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1 4 3 1 5 3\n2 3 7 8 2\ntrue true true true 0\n");
});

test("binding patterns reject ambiguous shapes without leaking JavaScript undefined or accessors", () => {
  const optional = compile(`
type Profile:
    name: string
    nickname: string?

const profile = Profile.parse({name: "Ada"})
export const {name, nickname, ...details} = profile
`.trimStart());
  assert.deepEqual(optional.diagnostics, []);
  assert.match(optional.code ?? "", /export const nickname = __velarReadBindingField\([^\n]+, "nickname", true,/u);
  const optionalExecution = executeModule(`${optional.code ?? ""}\nconsole.log(name, nickname === null, Object.keys(details).length);\n`);
  assert.equal(optionalExecution.status, 0, String(optionalExecution.stderr));
  assert.equal(optionalExecution.stdout, "Ada true 0\n");

  const shortList = compile(`
const values: List<number> = []
const [first] = values
print(first + 1)
`.trimStart());
  assert.deepEqual(shortList.diagnostics, []);
  const shortExecution = executeModule(shortList.code ?? "");
  assert.notEqual(shortExecution.status, 0);
  assert.match(String(shortExecution.stderr), /Variable List binding requires exactly 1 item, received 0/u);

  const literalMismatch = compile("const [only] = [1, 2]\n");
  assert.ok(literalMismatch.diagnostics.some((item) => item.code === "VEL4020" && /requires exactly 1 item, but this literal contains 2/u.test(item.message)));

  const longList = compile("const values: List<number> = [1, 2]\nconst [only] = values\nprint(only)\n");
  assert.deepEqual(longList.diagnostics, []);
  const longExecution = executeModule(longList.code ?? "");
  assert.notEqual(longExecution.status, 0);
  assert.match(String(longExecution.stderr), /Variable List binding requires exactly 1 item, received 2/u);

  const pairs = compile(`
def loadPairs() -> List<List<number>>:
    return [[1, 2], [3]]

for [left, right] in loadPairs():
    print(left + right)
`.trimStart());
  assert.deepEqual(pairs.diagnostics, []);
  const pairExecution = executeModule(pairs.code ?? "");
  assert.notEqual(pairExecution.status, 0);
  assert.equal(pairExecution.stdout, "3\n");
  assert.match(String(pairExecution.stderr), /For List binding requires exactly 2 items, received 1/u);

  const getterSource = Buffer.from([
    "export const payload=Object.defineProperty({},'name',{enumerable:true,get(){console.log('getter called');return 'Ada'}})",
    "export const inherited=Object.create({name:'Inherited'})",
    "export const restPayload=Object.defineProperty({name:'Ada'},'secret',{enumerable:true,get(){console.log('rest getter called');return 'hidden'}})",
  ].join(";"), "utf8").toString("base64");
  // D90 R17: a destructured operand needs a declared shape; the contract's
  // lie about the fields is exactly what the runtime binding guards under
  // test exist to catch.
  const accessor = compile(`
type Shape:
    name: string

extern module "data:text/javascript;base64,${getterSource}":
    export const payload: Shape
    export const inherited: Shape
    export const restPayload: Shape

import js {payload} from "data:text/javascript;base64,${getterSource}"
const {name} = payload
print(name)
`.trimStart());
  assert.deepEqual(accessor.diagnostics, []);
  const accessorExecution = executeModule(accessor.code ?? "");
  assert.notEqual(accessorExecution.status, 0);
  assert.equal(accessorExecution.stdout, "");
  assert.match(String(accessorExecution.stderr), /Variable object binding requires enumerable data field 'name'/u);

  const inherited = compile(`
type Shape:
    name: string

extern module "data:text/javascript;base64,${getterSource}":
    export const payload: Shape
    export const inherited: Shape
    export const restPayload: Shape

import js {inherited} from "data:text/javascript;base64,${getterSource}"
const {name} = inherited
print(name)
`.trimStart());
  assert.deepEqual(inherited.diagnostics, []);
  const inheritedExecution = executeModule(inherited.code ?? "");
  assert.notEqual(inheritedExecution.status, 0);
  assert.match(String(inheritedExecution.stderr), /Variable object binding requires own data field 'name'/u);

  const restAccessor = compile(`
type Shape:
    name: string

extern module "data:text/javascript;base64,${getterSource}":
    export const payload: Shape
    export const inherited: Shape
    export const restPayload: Shape

import js {restPayload} from "data:text/javascript;base64,${getterSource}"
const {name, ...rest} = restPayload
print(name)
`.trimStart());
  assert.deepEqual(restAccessor.diagnostics, []);
  const restExecution = executeModule(restAccessor.code ?? "");
  assert.notEqual(restExecution.status, 0);
  assert.equal(restExecution.stdout, "");
  assert.match(String(restExecution.stderr), /Variable object rest cannot copy accessor field 'secret'/u);

  const duplicateField = compile(`
const value = {name: "Ada"}
const {name: first, name: second} = value
`.trimStart());
  assert.ok(duplicateField.diagnostics.some((item) => item.code === "VEL4019" && /binding field 'name' is declared more than once/u.test(item.message)));
});
