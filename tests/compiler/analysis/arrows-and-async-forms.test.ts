import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("override implementations keep parameter names local while declarations own named-call labels", () => {
  const result = compile(`
class Base:
    def render(request: string) -> string:
        return request

class Child extends Base:
    override def render(_request: string) -> string:
        return _request

const base: Base = Child()
print(base.render(request="base"))
print(Child().render(_request="child"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "base\nchild\n");

  const external = compileCore(`
extern module "named-sdk":
    export class Base:
        def render(request: string) -> string

    export class Child extends Base:
        def render(_request: string) -> string
`.trimStart());
  assert.deepEqual(external.diagnostics, []);
});

test("multiline declarations and calls accept the trailing commas shared by Python and JavaScript", () => {
  const result = compile(`
import {logger,} from "./log.vel"

def total(
    first: number,
    second: number,
) -> number:
    return first + second

const add: (
    number,
    number,
) -> Promise<number> = async (
    first: number,
    second: number,
) => total(
    first,
    second,
)
`.trimStart(), { analysis: { imports: new Map([["logger", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }]]) } });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "add")?.type, "(number, number) -> Promise<number>");
  assert.match(result.code ?? "", /const add = async \(first, second\) => total\(first, second\);/u);
});

test("async arrows infer standard async workers and Promises cannot leak into JSX", () => {
  const result = compile(`
async def double(value: number) -> number:
    return value * 2

const labels = await Promise.map([1, 2], async value => f"item:{await double(value)}")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "labels")?.type, "List<string>");
  assert.equal(result.semanticIndex.symbols.find((item) => item.kind === "parameter" && item.name === "value")?.type, "number");

  const jsx = compile(`
component App:
    const items = [1]
    return <ul>{items.map(async item => <li key={item}>{item}</li>)}</ul>
`.trimStart());
  assert.ok(jsx.diagnostics.some((item) => item.code === "VEL5031" && /cannot render a Promise/u.test(item.message)));
});

test("expression arrows return object values instead of JavaScript blocks", () => {
  const result = compile(`
type Entry:
    value: number
    squared: number

const make: (number) -> Entry = value => {value, squared: value ** 2}
const makeAsync: (number) -> Promise<Entry> = async value => {value, squared: value ** 2}

print(make(3).squared)
print((await makeAsync(4)).squared)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /value => \(\{ value: value, squared: \(value \*\* 2\) \}\)/u);
  assert.match(result.code ?? "", /async value => \(__velarAsyncResolvedValue\(\{ value: value, squared: \(value \*\* 2\) \}\)\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "9\n16\n");
});

test("a JavaScript statement block after '=>' receives one expression-arrow diagnostic", () => {
  // The reflexive JavaScript shape: braces holding statements after '=>'.
  // One targeted diagnostic replaces the record-literal error cascade.
  const multiStatement = compile(`
def register(handler: () -> null):
    pass

register(() => {
    print("closing")
    print("done")
})
`.trimStart());
  assert.deepEqual(multiStatement.diagnostics.map((item) => item.code), ["VEL2030"]);
  assert.match(
    multiStatement.diagnostics[0]?.message ?? "",
    /An arrow body is a single expression; write the expression directly or move multi-statement logic into a named 'def'/u,
  );

  const returning = compile("const load = () => { return 1 }\n");
  assert.deepEqual(returning.diagnostics.map((item) => item.code), ["VEL2030"]);

  const declaring = compile("const worker = value => { let doubled = value * 2 }\n");
  assert.deepEqual(declaring.diagnostics.map((item) => item.code), ["VEL2030"]);

  // Record-literal arrow bodies keep parsing: spread and field syntax decide
  // for a record, with or without wrapping parentheses.
  const legal = compile(`
type Todo:
    id: number
    done: bool

const finish = (t: Todo) => {...t, done: true}
const make = (value: number) => ({id: value, done: false})
const plain = (value: number) => {id: value, done: value == 0}
print(finish({id: 1, done: false}))
print(make(2))
print(plain(3))
`.trimStart());
  assert.deepEqual(legal.diagnostics, []);
});

test("all async function forms adopt returned Promises without requiring return await", () => {
  const result = compile(`
async def inner(value: number) -> number:
    return value + 1

async def forward(value: number) -> number:
    return inner(value)

type LaterNumber = Promise<number>

async def forwardAlias(value: LaterNumber) -> number:
    return value

class Loader:
    async def load(value: number) -> number:
        return inner(value)

component SaveButton:
    action save() -> number:
        return inner(4)
    return <button type="button" on:click={save}>Save</button>

print(await forward(1))
print(await Loader().load(2))
const delayed: LaterNumber = inner(3)
print(await forwardAlias(delayed))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "forward")?.type, "(value: number) -> Promise<number>");
  assert.equal(result.semanticIndex.symbols.find((item) => item.kind === "extension:function:web-action" && item.name === "save")?.type, "action () -> Promise<number>");
  assert.match(result.code ?? "", /async function forward\(value\) \{\s*return __velarNormalizePromiseValue\(inner\(value\)\);/u);
  assert.match(result.code ?? "", /async load\(value\) \{\s*const self = this;\s*return __velarNormalizePromiseValue\(inner\(value\)\);/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n3\n4\n");
});

test("parameter defaults reject direct await but allow a nested async callback", () => {
  const valid = compile(`
async def inner() -> number:
    return 7

async def task(worker: () -> Promise<number> = async () => await inner()) -> number:
    return worker()

print(await task())
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "7\n");

  for (const source of [
    `async def inner() -> number:\n    return 1\nasync def invalid(value: number = await inner()) -> number:\n    return value\n`,
    `async def inner() -> number:\n    return 1\nconst invalid = (value: number = await inner()) => value\n`,
    `async def inner() -> number:\n    return 1\nclass Invalid:\n    const value: number\n\n    constructor(value: number = await inner()):\n        self.value = value\n`,
    `async def inner() -> number:\n    return 1\ncomponent Invalid(value: number = await inner()):\n    return <p>{value}</p>\n`,
  ]) {
    const invalid = compile(source);
    assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL4007" && /parameter default value/u.test(item.message)).length, 1, JSON.stringify(invalid.diagnostics));
    assert.equal(invalid.code, null);
  }

  for (const source of [
    `def choose(first: number = 1, second: number) -> number:\n    return second\n`,
    `class Sides:\n    const second: number\n\n    constructor(first: number = 1, second: number):\n        self.second = second\n`,
    `class Picker:\n    def choose(first: number = 1, second: number) -> number:\n        return second\n`,
    `const choose = (first: number = 1, second: number) => second\n`,
    `extern module "library":\n    export def choose(first: number = 1, second: number) -> number\n`,
  ]) {
    const invalidOrder = compile(source);
    assert.equal(
      invalidOrder.diagnostics.filter((item) => item.code === "VEL2016" && /required parameter cannot follow/u.test(item.message)).length,
      1,
      JSON.stringify(invalidOrder.diagnostics),
    );
  }

  const namedDefault = compile(`
def choose(first: number, second: number = 2) -> number:
    return first + second

print(choose(first=3))
`.trimStart());
  assert.deepEqual(namedDefault.diagnostics, []);
  const namedExecution = executeModule(namedDefault.code ?? "");
  assert.equal(namedExecution.status, 0, String(namedExecution.stderr));
  assert.equal(namedExecution.stdout, "5\n");
});

test("async declarations annotate the resolved value instead of a nested Promise", () => {
  for (const source of [
    `async def invalid() -> Promise<number>:\n    return 1\n`,
    `class Invalid:\n    async def load() -> Promise<number>:\n        return 1\n`,
    `component Invalid:\n    action save() -> Promise<number>:\n        return 1\n    return <p>Invalid</p>\n`,
    `extern module "library":\n    export async def load() -> Promise<number>\n`,
    `async def invalid() -> Promise<number> | string:\n    return 1\n`,
    `async def invalid() -> Promise<number>?:\n    return null\n`,
    `type LaterNumber = Promise<number>\nasync def invalid() -> LaterNumber:\n    return 1\n`,
  ]) {
    const invalid = compile(source);
    assert.ok(invalid.diagnostics.some((item) => item.code === "VEL4018" && /resolved value/u.test(item.message)), JSON.stringify(invalid.diagnostics));
  }
});
