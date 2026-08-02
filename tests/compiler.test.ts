import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, describeType, formatSource, inspectModule, MAX_VELAR_SOURCE_CODE_UNITS, semanticVisibleSymbolsAt } from "@velarscript/compiler";
import { parseType } from "../packages/compiler/src/types.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";
import {
  projectCompletionsAt,
  projectCompletionContextAt,
  projectDefinitionAt,
  projectExpressionAt,
  projectMemberSymbolAt,
  projectPrepareRenameAt,
  projectReferencesAt,
  projectRenameAt,
  projectSignatureAt,
  projectSymbolAt,
} from "../packages/cli/src/project-semantic.ts";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { moduleOutput } from "../packages/cli/src/web.ts";
import { npmAsset } from "../packages/cli/src/npm.ts";
import { standardModuleApi, standardModuleInterface, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { loadTypeScriptDeclarations, parseTypeScriptDeclarations } from "../packages/cli/src/typescript-declarations.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";
import { startProductionPreview } from "../packages/cli/src/preview-server.ts";
import { verifyRemoteDeployment, type DeploymentFetch } from "../packages/cli/src/deployment-verifier.ts";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", code], { encoding: "utf8" });
}

test("compiles bindings, functions, and strict equality", () => {
  const result = compile(`
export def double(value: number) -> number:
    return value * 2

const start = 2
let result = double(start)
result += 1

if result == 5:
    print("ok")
else:
    print("bad")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /export function double\(value\)/);
  assert.match(result.code ?? "", /const start = 2;/);
  assert.match(result.code ?? "", /result \+= 1;/);
  assert.match(result.code ?? "", /if \(\(result === 5\)\)/);
});

test("else if chains preserve rejected facts, complete returns, and readable JavaScript", () => {
  const result = compile(`
def describe(value: number?, fallback: string?) -> string:
    if value == none:
        return fallback ?? "missing"
    else if value > 10:
        return f"high:{value}"
    else if fallback != none:
        return f"{fallback}:{value}"
    else:
        return f"low:{value}"

print(describe(none, none))
print(describe(12, none))
print(describe(4, "steady"))
print(describe(2, none))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\} else if \(\(value > 10\)\) \{/u);
  assert.match(result.code ?? "", /\} else if \(\(fallback !== null\)\) \{/u);
  assert.doesNotMatch(result.code ?? "", /else \{\s+if/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "missing\nhigh:12\nsteady:4\nlow:2\n");
});

test("is checks subtract simple union members across chains, assertions, fields, and JSX", () => {
  const result = compile(`
type DisplayValue = string | number | bool

type Payload:
    value: string | number

def display(value: DisplayValue) -> string:
    if value is string:
        return f"text:{value.length}"
    else if value is number:
        return f"number:{value + 1}"
    else:
        return value ? "yes" : "no"

def increment(value: string | number) -> number:
    assert not (value is string), "Expected a number"
    return value + 1

def incrementField(payload: Payload) -> number:
    if payload.value is string:
        return payload.value.length
    else:
        return payload.value + 1

def optionalIncrement(value: number?) -> number:
    if value is none:
        return 0
    else:
        return value + 1

component Preview(value: DisplayValue):
    return <div><p if={value is string}>{value.length}</p><p else-if={value is number}>{value + 1}</p><p else>{value ? "yes" : "no"}</p></div>

print(display("velar"))
print(display(4))
print(display(true))
print(increment(4))
print(incrementField({value: 9}))
print(optionalIncrement(none))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "text:5\nnumber:5\nyes\n5\n10\n0\n");

  const unsafeContinuation = compile(`
def invalid(value: string | number):
    if value is string:
        print(value.length)
    print(value + 1)
`.trimStart());
  assert.ok(unsafeContinuation.diagnostics.some((item) => /Cannot assign string \| number to number/u.test(item.message)));
});

test("supports typed rest parameters in functions, methods, arrows, and spread calls", () => {
  const result = compile(`
def total(first: number, ...values: number) -> number:
    let result = first
    for value in values:
        result += value
    return result

class Calculator:
    def total(first: number, ...values: number) -> number:
        let result = first
        for value in values:
            result += value
        return result

const tail = [2, 3]
const count = (...values: string) => values.length
print(total(1, ...tail))
print(total(1, 2, 3))
print(Calculator().total(1, ...tail))
print(count("a", "b"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function total\(first, \.\.\.values\)/u);
  assert.match(result.code ?? "", /total\(first, \.\.\.values\)/u);
  assert.match(result.code ?? "", /const count = \(\.\.\.values\) => values\.length;/u);
  const restSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "values" && symbol.kind === "parameter");
  assert.equal(restSymbol?.type, "List<number>");
  const totalSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "total" && symbol.kind === "function");
  assert.equal(totalSymbol?.type, "(number, ...number) -> number");
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "6\n6\n6\n2\n");
});

test("async arrows preserve concise callbacks without leaking await across function boundaries", () => {
  const result = compile(`
async def next(value: number) -> number:
    return value + 1

type Result:
    value: number

async def result() -> Result:
    return {value: 10}

const load: (number) -> Promise<number> = async value => await next(value)
const combine = async (left: number, right: number) => next(left + right)
const member = (await result()).value
const immediate = await (async () => next(8))()
print(await load(2))
print(await combine(3, 4))
print(member)
print(immediate)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "load")?.type, "(number) -> Promise<number>");
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "combine")?.type, "(number, number) -> Promise<number>");
  assert.match(result.code ?? "", /const load = async value => await next\(value\);/u);
  assert.match(result.code ?? "", /const combine = async \(left, right\) => next\(\(left \+ right\)\);/u);
  assert.match(result.code ?? "", /const member = \(await result\(\)\)\.value;/u);
  assert.match(result.code ?? "", /const immediate = await \(async \(\) => next\(8\)\)\(\);/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\n8\n10\n9\n");

  const synchronousAwait = compile(`
async def task() -> number:
    return 1
const invalid = () => await task()
`.trimStart());
  assert.ok(synchronousAwait.diagnostics.some((item) => item.code === "VEL4007" && /async function/u.test(item.message)));

  const incompatible = compile("const invalid: (number) -> number = async value => value\n");
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign \(number\) -> Promise<number> to \(number\) -> number/u.test(item.message)));
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
`.trimStart(), { analysis: { imports: new Map([["logger", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "none" } }]]) } });

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "add")?.type, "(number, number) -> Promise<number>");
  assert.match(result.code ?? "", /const add = async \(first, second\) => total\(first, second\);/u);
});

test("async arrows infer standard async workers and Promises cannot leak into JSX", () => {
  const asyncModule = standardModuleInterface("velar/async")!;
  const result = compile(`
import {map} from "velar/async"

async def double(value: number) -> number:
    return value * 2

const labels = await map([1, 2], async value => f"item:{await double(value)}")
`.trimStart(), { analysis: { imports: new Map([["map", asyncModule.exports.get("map")!]]) } });

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
  assert.match(result.code ?? "", /async value => \(\{ value: value, squared: \(value \*\* 2\) \}\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "9\n16\n");
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
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "forward")?.type, "(number) -> Promise<number>");
  assert.equal(result.semanticIndex.symbols.find((item) => item.kind === "action" && item.name === "save")?.type, "action () -> Promise<number?>");
  assert.match(result.code ?? "", /async function forward\(value\) \{\s*return inner\(value\);/u);
  assert.match(result.code ?? "", /async load\(value\) \{\s*const self = this;\s*return inner\(value\);/u);
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
    `async def inner() -> number:\n    return 1\nclass Invalid(value: number = await inner()):\n    pass\n`,
    `async def inner() -> number:\n    return 1\ncomponent Invalid(value: number = await inner()):\n    return <p>{value}</p>\n`,
  ]) {
    const invalid = compile(source);
    assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL4007" && /parameter default value/u.test(item.message)).length, 1, JSON.stringify(invalid.diagnostics));
    assert.equal(invalid.code, null);
  }
});

test("async declarations annotate the resolved value instead of a nested Promise", () => {
  for (const source of [
    `async def invalid() -> Promise<number>:\n    return 1\n`,
    `class Invalid:\n    async def load() -> Promise<number>:\n        return 1\n`,
    `component Invalid:\n    action save() -> Promise<number>:\n        return 1\n    return <p>Invalid</p>\n`,
    `extern module "library":\n    export async def load() -> Promise<number>\n`,
    `async def invalid() -> Promise<number> | string:\n    return 1\n`,
    `async def invalid() -> Promise<number>?:\n    return none\n`,
    `type LaterNumber = Promise<number>\nasync def invalid() -> LaterNumber:\n    return 1\n`,
  ]) {
    const invalid = compile(source);
    assert.ok(invalid.diagnostics.some((item) => item.code === "VEL4018" && /resolved value/u.test(item.message)), JSON.stringify(invalid.diagnostics));
  }
});

test("async arrow contracts cross module and editor boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-async-arrow-editor-"));
  const servicePath = join(directory, "service.vel");
  const callbacksPath = join(directory, "callbacks.vel");
  const consumerPath = join(directory, "consumer.vel");
  const callbacksSource = `
import {metricValue} from "./service.vel"

export const load: (string) -> Promise<number> = async id => await metricValue(id)
`.trimStart();
  const consumerSource = `
import {load} from "./callbacks.vel"

const result = await load("visitors")
print(result)
`.trimStart();
  await writeFile(servicePath, `
async def rawMetricValue(id: string) -> number:
    return id == "visitors" ? 12840 : 0

export async def metricValue(id: string) -> number:
    return rawMetricValue(id)
`.trimStart(), "utf8");
  await writeFile(callbacksPath, callbacksSource, "utf8");
  await writeFile(consumerPath, consumerSource, "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols.find((item) => item.name === "result")?.type, "number");
  assert.equal(project.modules.find((module) => module.inputPath === callbacksPath)?.result.semanticIndex.symbols.find((item) => item.kind === "parameter" && item.name === "id")?.type, "string");

  const callOffset = consumerSource.indexOf('load("visitors")') + "load(".length;
  assert.deepEqual(projectSignatureAt(project, consumerPath, callOffset), {
    label: "load(string) -> Promise<number>",
    activeParameter: 0,
  });
  const definition = projectDefinitionAt(project, consumerPath, consumerSource.indexOf("load(\"visitors\")") + 1);
  assert.deepEqual(definition, {
    path: callbacksPath,
    span: { start: callbacksSource.indexOf("load:"), end: callbacksSource.indexOf("load:") + "load".length },
  });
  assert.ok(projectCompletionsAt(project, consumerPath, consumerSource.indexOf("const result")).some((item) => item.label === "load" && item.detail === "(string) -> Promise<number>"));
});

test("rest parameters fail closed on ambiguous declarations and invalid calls", () => {
  for (const [source, message] of [
    ["def collect(...values):\n    pass\n", /requires an element type/u],
    ["def collect(...values: number = [1]):\n    pass\n", /cannot have a default value/u],
    ["def collect(...values: number, label: string):\n    pass\n", /must be the final parameter/u],
    ["component Items(...values: string):\n    return <p>Items</p>\n", /Components use named props/u],
    ["class Items(...values: string):\n    pass\n", /Class constructors do not support/u],
  ] as const) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2016" && message.test(item.message)), JSON.stringify(result.diagnostics));
  }

  const wrongElement = compile(`
def total(...values: number) -> number:
    return values.length

total(1, "two")
`.trimStart());
  assert.ok(wrongElement.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));

  const missingFixed = compile(`
def total(first: number, ...values: number) -> number:
    return first

const values = [1, 2]
total(...values)
`.trimStart());
  assert.ok(missingFixed.diagnostics.some((item) => /required fixed argument before a call spread/u.test(item.message)));

  const incompatibleOverride = compile(`
abstract class Reporter:
    abstract def report(...values: string)

class NumberReporter extends Reporter:
    override def report(...values: number):
        pass
`.trimStart());
  assert.ok(incompatibleOverride.diagnostics.some((item) => /must keep the base method signature/u.test(item.message)));
});

test("function types make component callbacks explicit without a second type system", () => {
  const result = compile(`
component Choice(label: string, onChoose: (string) -> none):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>

component App:
    state selected = "none"

    def choose(label: string) -> none:
        selected = label
        return none

    return <main><Choice label="Velar" onChoose={choose} /><p>{selected}</p></main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /onChoose\(label\)/u);
  const callback = result.semanticIndex.symbols.find((item) => item.kind === "parameter" && item.name === "onChoose");
  assert.equal(callback?.type, "(string) -> none");
  assert.equal(describeType({
    kind: "function",
    parameters: [{ kind: "string" }],
    requiredParameters: 1,
    rest: { kind: "number" },
    result: { kind: "bool" },
  }), "(string, ...number) -> bool");
  assert.equal(describeType(parseType("(() -> none)?")), "(() -> none)?");
  assert.equal(describeType(parseType("(string | number)?")), "(string | number)?");

  const grouped = compile(`
type MaybeValue = (string | number)?
const callback: (() -> none)? = none
const value: MaybeValue = "ready"
`.trimStart());
  assert.deepEqual(grouped.diagnostics, []);

  const invalid = compile(`
component Choice(onChoose: (string) -> none):
    return <button type="button" on:click={() => onChoose("value")}>Choose</button>

component App:
    return <Choice onChoose={(value: number) => none} />
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign \(number\) -> none to \(string\) -> none/u.test(item.message)));

  const malformed = compile("const callback: (...string, number) -> none = (value, next) => none\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2016" && /rest function type parameter must be final/u.test(item.message)));

  const runtime = compile(`
type Handler:
    run: (string) -> none

const handler = Handler.parse({run: value => print(value)})
print(handler is Handler)
handler.run("checked")
`.trimStart());
  assert.deepEqual(runtime.diagnostics, []);
  const execution = executeModule(runtime.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nchecked\n");
});

test("omitted results mean none and end naturally while value functions stay explicit", () => {
  const result = compile(`
export def record(value: string):
    print(value)

component SaveButton:
    state saved = false

    action save():
        saved = true

    return <button type="button" on:click={save}>{saved ? "Saved" : "Save"}</button>

print(record("saved") == none)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(describeType(result.moduleInterface.exports.get("record")!), "(string) -> none");
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "record")?.type, "(string) -> none");
  assert.match(result.code ?? "", /function record\(value\) \{\s*console\.log\(value\);\s*return null;\s*\}/u);
  assert.match(result.code ?? "", /__velarAction\(async \(\) => \{\s*saved\.set\(true\);\s*return null;\s*\}/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "saved\ntrue\n");

  const incomplete = compile(`
def title(ready: bool) -> string:
    if ready:
        return "ready"
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => item.code === "VEL4006"));

  const implicitValue = compile(`
def answer():
    return 42
`.trimStart());
  assert.ok(implicitValue.diagnostics.some((item) => /Cannot assign number to none/u.test(item.message)));

  const asynchronous = compile(`
async def save():
    print("saved")
`.trimStart());
  assert.deepEqual(asynchronous.diagnostics, []);
  assert.equal(asynchronous.semanticIndex.symbols.find((item) => item.name === "save")?.type, "() -> Promise<none>");
});

test("assertions enforce runtime invariants and narrow following stable values", () => {
  const source = `
type Draft:
    estimate: number?
    label: string?
    enabled: bool?

def message() -> string:
    print("message-evaluated")
    return "unused"

def submit(draft: Draft):
    assert draft.estimate, "Estimate is required"
    assert draft.label
    assert draft.enabled
    const estimate = draft.estimate
    const label: string = draft.label
    const enabled: bool = draft.enabled
    print(f"{estimate}:{label.length}:{enabled}")

submit({estimate: 0, label: "", enabled: false})
assert true, message()

try:
    assert false, "Broken invariant"
catch error:
    print(f"{error.name}:{error.message}")
`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.kind === "variable" && item.name === "estimate")?.type, "number");
  assert.match(result.code ?? "", /draft\.estimate \?\? null\) != null/u);
  assert.match(result.code ?? "", /__velarAssertionError\.name = "AssertionError"/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0:0:false\nAssertionError:Broken invariant\n");

  const invalid = compile(`
assert 1
assert true, 42
`);
  assert.ok(invalid.diagnostics.some((item) => /Condition must be bool or optional/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));

  const scoped = compile(`
let value: number? = 1
if true:
    assert value
    const inside: number = value
const outside: number = value
`);
  assert.ok(scoped.diagnostics.some((item) => /Cannot assign number\? to number/u.test(item.message)));

  const deferred = compile(`
let value: number? = 1
assert value
def later() -> number:
    return value
const callback: () -> number = () => value
`);
  assert.equal(deferred.diagnostics.filter((item) => /number\?/u.test(item.message)).length, 2);

  const malformed = compile("assert\nassert true,\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2017" && /requires a condition/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2017" && /requires a message/u.test(item.message)));
});

test("transparent type aliases improve names without changing assignability", () => {
  const result = compile(`
type Identifier = string
type Handler = (Identifier) -> none

type User:
    name: string

type Users = List<User>

const handle: Handler = value => print(value)
const parsed = Handler.parse(handle)
const users = Users.parse([{name: "Ada"}])
print("id" is Identifier)
print(users is Users)
parsed("checked")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const Handler = __velarRegisterType\(Object\.freeze/u);
  assert.match(result.code ?? "", /const Users = __velarRegisterType\(Object\.freeze/u);
  assert.match(result.code ?? "", /const User = __velarRegisterType\(Object\.freeze/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\nchecked\n");

  const erased = compile("type Label = string\nconst label: Label = \"Velar\"\n");
  assert.deepEqual(erased.diagnostics, []);
  assert.doesNotMatch(erased.code ?? "", /const Label =/u);

  const incompatible = compile("type Identifier = string\nconst id: Identifier = 42\n");
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));

  const recursive = compile("type Loop = List<Loop>\n");
  assert.ok(recursive.diagnostics.some((item) => item.code === "VEL4017" && /recursive/u.test(item.message)));

  const unknown = compile("type MissingValue = Missing\nconst value: MissingValue = none\n");
  assert.ok(unknown.diagnostics.some((item) => /Unknown type 'Missing'/u.test(item.message)));
});

test("lowers none and readable logical operators", () => {
  const result = compile(`
const missing = none
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
const scores = Map()
scores.set("Ada", 9)
print("Ada" in names)
print("web" in tags)
print("Ada" in scores)
print("Script" in "VelarScript")
print(not ("missing" in names))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /names\.includes\("Ada"\)/u);
  assert.match(result.code ?? "", /scores\.has\("Ada"\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\ntrue\n");

  const invalid = compile("print(1 in \"123\")\nprint(\"x\" in {x: 1})\n");
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Membership requires a List, Set, Map, or string/u.test(item.message)));
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
  assert.match(result.code ?? "", /const awaited = \(\(await two\(\)\) \*\* 2\)/u);
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
const equality = value("g", 4) == value("h", 4) != value("i", 5)
print(ascending)
print(stopped)
print(lexical)
print(equality)
print(await inRange())
print(order.length)
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
  assert.match(result.code ?? "", /\$velarCompare/u);
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

test("match selects strict literal branches without fallthrough", () => {
  const result = compile(`
def describe(value: string) -> string:
    match value:
        case "ready", "done":
            const prefix = "ok"
            return prefix
        case "failed":
            const prefix = "bad"
            return prefix
        else:
            return "unknown"

def numeric(value: number?) -> string:
    match value:
        case -1:
            return "negative"
        case none:
            return "missing"
        else:
            return "number"

print(describe("ready"))
print(describe("failed"))
print(describe("other"))
print(numeric(-1))
print(numeric(none))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /switch \(value\)/u);
  assert.match(result.code ?? "", /case "ready":\n\s+case "done":/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ok\nbad\nunknown\nnegative\nmissing\n");
});

test("match validates literals, duplicates, structure, and complete returns", () => {
  const incompatible = compile(`
match 1:
    case "1":
        print("wrong")
    case 1, 1:
        print("duplicate")
`.trimStart());
  assert.ok(incompatible.diagnostics.some((item) => /Cannot match number against string/u.test(item.message)));
  assert.ok(incompatible.diagnostics.some((item) => item.code === "VEL4013" && /more than once/u.test(item.message)));

  const incomplete = compile(`
def label(value: string) -> string:
    match value:
        case "known":
            return "known"
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => /finish without returning/u.test(item.message)));

  for (const source of [
    "case \"orphan\":\n    pass\n",
    "match \"value\":\n    case selected:\n        pass\n",
    "match \"value\":\n    else:\n        pass\n",
    "match \"value\":\n    else:\n        pass\n    case \"late\":\n        pass\n",
  ]) {
    const result = compile(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2001" || item.code === "VEL2015"), source);
  }
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
            else:
                return "Unknown"

    return <p>{label()}</p>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /switch \(status\.get\(\)\)/u);
});

test("string-backed enums model finite application states and match qualified members", () => {
  const result = compile(`
export enum TaskStatus:
    todo
    doing
    done

export type Task:
    title: string
    status: TaskStatus

def label(status: TaskStatus) -> string:
    match status:
        case TaskStatus.todo:
            return "To do"
        case TaskStatus.doing:
            return "In progress"
        case TaskStatus.done:
            return "Done"

def persist(value: string) -> none:
    print(value)
    return none

component StatusFilter:
    state selected: TaskStatus = TaskStatus.todo
    return <select bind:value={selected}><option value={TaskStatus.todo}>To do</option><option value={TaskStatus.done}>Done</option></select>

const task: Task = {title: "Ship app", status: TaskStatus.doing}
const parsed: TaskStatus = TaskStatus.parse("done")
persist(task.status)
print(label(parsed))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.moduleInterface.enums.get("TaskStatus")?.members.has("doing"), true);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "TaskStatus")?.kind, "enum");
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "parsed")?.type, "TaskStatus");
  assert.match(result.code ?? "", /export const TaskStatus = __velarRegisterType\(Object\.freeze/u);
  assert.match(result.code ?? "", /case TaskStatus\.doing:/u);
  assert.match(result.code ?? "", /TaskStatus\.is\(value\["status"\]\)/u);
  assert.match(result.code ?? "", /__velarBindValue\([^\n]+TaskStatus\.parse\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "doing\nDone\n");
});

test("enums reject open strings, foreign members, duplicates, and reserved runtime names", () => {
  const openString = compile(`
enum Status:
    ready
    done

const status: Status = "ready"
`.trimStart());
  assert.ok(openString.diagnostics.some((item) => /Cannot assign string to Status/u.test(item.message)));

  const foreign = compile(`
enum Status:
    ready

enum Priority:
    high

match Status.ready:
    case Priority.high:
        pass
`.trimStart());
  assert.ok(foreign.diagnostics.some((item) => /Cannot match Status against Priority/u.test(item.message)));

  const malformed = compile(`
enum Status:
    ready
    ready
    parse
`.trimStart());
  assert.ok(malformed.diagnostics.some((item) => /declared more than once/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => /reserved for runtime validation/u.test(item.message)));

  const incomplete = compile(`
enum Status:
    ready
    done

def label(status: Status) -> string:
    match status:
        case Status.ready:
            return "Ready"
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => item.code === "VEL4015" && /missing: done/u.test(item.message)));
});

test("throws only Error values, normalizes JavaScript failures, and preserves remainder semantics", () => {
  const result = compile(`
import js unsafe {explode} from "data:text/javascript,export function explode(){throw 'raw failure'}"

class ValidationError(const code: string, const message: string) extends Error(message):
    pass

def bucket(value: number) -> number:
    if value < 0:
        throw ValidationError("negative", "Value must be positive")
    else:
        return value % 4

async def failLater() -> number:
    throw ValidationError("async", "Async failure")

let remainder = 11
remainder %= 4
print(remainder)

try:
    print(bucket(-1))
catch error:
    print(error is ValidationError)
    print(error.message)
finally:
    print("finalized")

try:
    await failLater()
catch error:
    print(error.message)

try:
    explode()
catch:
    print(error.name)
    print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /throw new ValidationError/);
  assert.match(result.code ?? "", /remainder %= 4/);
  assert.match(result.code ?? "", /new Error\(String\(error\), \{ cause: error \}\)/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\ntrue\nValue must be positive\nfinalized\nAsync failure\nError\nraw failure\n");
});

test("rejects missing, non-Error, and non-numeric throw/remainder operands", () => {
  const missing = compile("throw\n");
  assert.ok(missing.diagnostics.some((item) => item.code === "VEL2009" && /requires an Error/.test(item.message)));

  const nonError = compile('throw "failure"\n');
  assert.ok(nonError.diagnostics.some((item) => item.code === "VEL4001" && /Only Error values.*string/.test(item.message)));

  const remainder = compile('const value = "left" % "right"\n');
  assert.ok(remainder.diagnostics.some((item) => item.code === "VEL4001" && /string to number/.test(item.message)));
});

test("strict number parsing returns optional finite decimals without JavaScript coercion", () => {
  const result = compile(`
def label(value: number?) -> string:
    if value:
        return f"value:{value}"
    return "missing"

print(label(number("0")))
print(label(number("  -12.5e1  ")))
print(label(number(".5")))
print(number("") == none)
print(number("0x10") == none)
print(number("12px") == none)
print(number("Infinity") == none)
print(number("1e999") == none)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function __velarNumber/u);
  assert.match(result.code ?? "", /Number\.isFinite\(parsed\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "value:0\nvalue:-125\nvalue:0.5\ntrue\ntrue\ntrue\ntrue\ntrue\n");

  const wrongArgument = compile("const value = number(42)\n");
  assert.ok(wrongArgument.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  const shadowed = compile("const number = value => value\n");
  assert.ok(shadowed.diagnostics.some((item) => /'number' is a reserved Core binding/u.test(item.message)));
  assert.doesNotMatch(compile("const value = 1\n").code ?? "", /__velarNumber/u);
});

test("rejects ambient JavaScript coercion globals with intentional replacements", () => {
  const cases = new Map([
    ["const value = Boolean([])\n", /explicit boolean comparison.*truthiness conversion/u],
    ["const value = Number(\"\")\n", /number\(text\).*Number coercion/u],
    ["const value = String(42)\n", /str\(value\).*String global/u],
  ]);
  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3008" && message.test(item.message)), JSON.stringify(result.diagnostics));
  }
});

test("rejects legacy and discarded design surface with intentional diagnostics", () => {
  const cases = new Map([
    ["var value = 1\n", /let.*const.*var/],
    ["const value = undefined\n", /none.*undefined/],
    ["const value = null\n", /none.*null/],
    ["const value = this\n", /self.*this/],
    ["const value = new Player()\n", /directly.*new/],
    ["eval(\"1\")\n", /does not expose 'eval'/],
    ["with value\n", /does not expose 'with'/],
    ["const value = arguments\n", /named parameters.*arguments/],
    ["const value = Player.prototype\n", /prototype manipulation/],
    ["const value = item.__proto__\n", /prototype manipulation/],
    ["const value = 1 === 1\n", /equality is already strict/],
    ["const value = 1 !== 2\n", /inequality is already strict/],
    ["schema User:\n    name: string\n", /Use 'type'.*no separate schema/],
    ["effect count:\n    print(count)\n", /compiler-internal.*watch.*mounted.*cleanup/],
    ["onMounted()\n", /component-level 'mounted:'/],
  ]);

  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.ok(
      result.diagnostics.some((item) => item.code === "VEL1005" && message.test(item.message)),
      `${source}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test("rejects untyped browser globals with official module guidance", () => {
  const cases = new Map([
    ["fetch(\"/api\")\n", /velar\/http.*raw fetch/],
    ["const body = document.body\n", /JSX.*refs.*velar\/browser/],
    ["const value = JSON.parse(\"{}\")\n", /velar\/json/],
    ["const value = Date.now()\n", /velar\/time/],
  ]);
  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3008" && message.test(item.message)));
  }
});

test("rejects reassignment of const bindings", () => {
  const result = compile(`
const name = "Velar"
name = "Other"
`.trimStart());

  assert.equal(result.code, null);
  assert.equal(result.diagnostics[0]?.code, "VEL3002");
  assert.match(result.diagnostics[0]?.message ?? "", /Cannot assign to const/);
});

test("enforces parameter, condition, coercion, and object-shape contracts", () => {
  const parameter = compile("def change(value: number):\n    value = 2\n");
  assert.ok(parameter.diagnostics.some((item) => item.code === "VEL3002"));

  const truthiness = compile("if 1:\n    print(1)\n");
  assert.ok(truthiness.diagnostics.some((item) => /Condition must be bool or optional/.test(item.message)));

  const logical = compile("const visible = 1 and true\n");
  assert.ok(logical.diagnostics.some((item) => /number to bool/.test(item.message)));

  const coercion = compile("const label = \"Score: \" + 10\n");
  assert.ok(coercion.diagnostics.some((item) => /f-string or str\(value\)/.test(item.message)));

  const shape = compile("const user = {name: \"Ada\"}\nuser.age = 24\n");
  assert.ok(shape.diagnostics.some((item) => /Object has no field 'age'/.test(item.message)));
});

test("reports unknown names", () => {
  const result = compile("const answer = missing\n");

  assert.equal(result.code, null);
  assert.equal(result.diagnostics[0]?.code, "VEL3001");
});

test("reports indentation that does not match an outer block", () => {
  const result = compile(`
def value():
    const first = 1
  return first
`.trimStart());

  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => item.code === "VEL1004"));
});

test("compiler and CLI reject oversized source modules before parsing", async () => {
  const oversized = " ".repeat(MAX_VELAR_SOURCE_CODE_UNITS + 1);
  const result = compile(oversized, { path: "oversized.vel" });
  assert.equal(result.code, null);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "VEL1003");
  assert.match(result.diagnostics[0]?.message ?? "", /cannot exceed 4 MiB/u);
  assert.throws(() => formatSource(oversized), /cannot exceed 4 MiB/u);

  const unaryNesting = compile(`${"not ".repeat(10000)}true\n`);
  assert.equal(unaryNesting.code, null);
  assert.ok(unaryNesting.diagnostics.some((item) => item.code === "VEL2008"));
  const delimiterNesting = compile(`${"(".repeat(513)}1${")".repeat(513)}\n`);
  assert.equal(delimiterNesting.code, null);
  assert.ok(delimiterNesting.diagnostics.some((item) => item.code === "VEL1006"));

  const directory = await mkdtemp(join(tmpdir(), "velar-source-limit-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, oversized, "utf8");
  const execution = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "check", entry], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /exceeds the 4 MiB Velar source-module limit/u);
});

test("compiler APIs contain deterministic malformed input without escaping internal exceptions", () => {
  let state = 0x5eed1234;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_ \t\n\r()[]{}<>:,.?+-*/%=!|\\\"'😀\0";
  for (let sample = 0; sample < 2_000; sample += 1) {
    let source = "";
    const length = next() % 500;
    for (let index = 0; index < length; index += 1) source += alphabet[next() % alphabet.length];
    const path = `malformed-${sample}.vel`;
    assert.ok(Array.isArray(compile(source, { path }).diagnostics));
    assert.ok(Array.isArray(inspectModule(source, { path }).diagnostics));
    assert.equal(typeof formatSource(source), "string");
  }
});

test("CLI builds a real .vel file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-compiler-"));
  const sourcePath = join(directory, "main.vel");
  const outputPath = join(directory, "main.js");
  await writeFile(sourcePath, "const answer = 40 + 2\n", "utf8");

  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts",
    "build",
    sourcePath,
    "--out",
    outputPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(await readFile(outputPath, "utf8"), "const answer = (40 + 2);\n//# sourceMappingURL=main.js.map\n");
  const map = JSON.parse(await readFile(`${outputPath}.map`, "utf8")) as { version: number; sourcesContent: string[] };
  assert.equal(map.version, 3);
  assert.deepEqual(map.sourcesContent, ["const answer = 40 + 2\n"]);
});

test("dev server exits cleanly after browser requests", async () => {
  const child = spawn(process.execPath, [
    "packages/cli/src/cli.ts",
    "dev",
    "examples/todo/main.vel",
    "--port",
    "42879",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 5_000;
  while (!output.includes("Velar dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /Velar dev server:/);
  const html = await (await fetch("http://127.0.0.1:42879/")).text();
  assert.match(html, /data-velar-error-overlay/);
  assert.match(html, /Velar runtime error/);
  assert.match(html, /update\.errors\.length/);
  const javascript = await (await fetch("http://127.0.0.1:42879/main.js")).text();
  const generatedLines = javascript.split("\n");
  const mountLine = generatedLines.findLastIndex((line) => line.includes("__velarMount(")) + 1;
  assert.ok(mountLine > 0);
  const mapped = await (await fetch(`http://127.0.0.1:42879/__velar/map?file=%2Fmain.js&line=${mountLine}&column=1`)).json() as {
    path: string;
    line: number;
  };
  assert.equal(mapped.path, "main.vel");
  assert.ok(mapped.line > 0);
  const rejectedMethod = await fetch("http://127.0.0.1:42879/main.js", { method: "POST", body: "ignored" });
  assert.equal(rejectedMethod.status, 405);
  assert.equal(rejectedMethod.headers.get("allow"), "GET, HEAD");
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Dev server did not stop")), 2_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, String(child.stderr.read() ?? ""));
});

test("dev server keeps the last good app behind compile-error overlays", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-overlay-"));
  const mainPath = join(directory, "main.vel");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ entry: "main.vel" }), "utf8");
  await writeFile(mainPath, "component App:\n    return <main>Ready</main>\n\nmount(<App />, \"#app\")\n", "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "42880"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/Velar dev server:/u);
  const first = await fetch("http://127.0.0.1:42880/");
  assert.equal(first.status, 200);
  await writeFile(mainPath, "component App:\n    return <img />\n", "utf8");
  await waitForOutput(/Velar app has \d+ error/u);
  const retained = await fetch("http://127.0.0.1:42880/");
  assert.equal(retained.status, 200);
  assert.match(await retained.text(), /data-velar-error-overlay/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, String(child.stderr.read() ?? ""));
});

test("dev server contains unexpected rebuild failures and recovers on the next edit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-rebuild-recovery-"));
  const mainPath = join(directory, "main.vel");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ entry: "main.vel" }), "utf8");
  const validSource = (label: string): string => `component App:\n    return <main>${label}</main>\n\nmount(<App />, \"#app\")\n`;
  await writeFile(mainPath, validSource("Ready"), "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "42881"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp, source: () => string = () => output): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!pattern.test(source()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(source(), pattern);
  };

  try {
    await waitForOutput(/Velar dev server:/u);
    const excessiveImports = Array.from(
      { length: 4_097 },
      (_, index) => `import js unsafe {value as value${index}} from "overflow-${index}"`,
    ).join("\n");
    await writeFile(mainPath, `${excessiveImports}\n${validSource("Too many")}`, "utf8");
    await waitForOutput(/Velar rebuild failed: A browser project cannot import more than 4096 JavaScript packages/u, () => errors);
    await waitForOutput(/Velar app has 1 error/u);
    assert.equal(child.exitCode, null);
    const failed = await (await fetch("http://127.0.0.1:42881/__velar/status")).json() as {
      ready: boolean;
      errors: string[];
    };
    assert.equal(failed.ready, false);
    assert.equal(failed.errors.length, 1);
    assert.match(failed.errors[0]!, /cannot import more than 4096 JavaScript packages/u);
    const retained = await (await fetch("http://127.0.0.1:42881/main.js")).text();
    assert.match(retained, /Ready/u);

    await writeFile(mainPath, validSource("Recovered"), "utf8");
    await waitForOutput(/Velar app rebuilt in/u);
    const recovered = await (await fetch("http://127.0.0.1:42881/__velar/status")).json() as {
      ready: boolean;
      errors: string[];
    };
    assert.equal(recovered.ready, true);
    assert.deepEqual(recovered.errors, []);
    const rebuilt = await (await fetch("http://127.0.0.1:42881/main.js")).text();
    assert.match(rebuilt, /Recovered/u);

    for (let index = 0; index < 64; index += 1) {
      await writeFile(mainPath, validSource(`Burst ${index}`), "utf8");
    }
    const finalDeadline = Date.now() + 10_000;
    let finalModule = "";
    while (!/Burst 63/u.test(finalModule) && Date.now() < finalDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finalModule = await (await fetch("http://127.0.0.1:42881/main.js")).text();
    }
    assert.match(finalModule, /Burst 63/u);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill("SIGTERM");
  }
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, errors);
});

test("dev server exposes incremental compilation status and reuses unaffected modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-incremental-"));
  const mainPath = join(directory, "main.vel");
  const storePath = join(directory, "store.vel");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ entry: "main.vel" }), "utf8");
  await writeFile(storePath, "export const label = \"Ready\"\n", "utf8");
  await writeFile(join(directory, "banner.vel"), "export component Banner:\n    return <strong>Banner</strong>\n", "utf8");
  await writeFile(mainPath, `
import {label} from "./store.vel"
import {Banner} from "./banner.vel"

component App:
    return <main><Banner />{label}</main>

mount(<App />, "#app")
`.trimStart(), "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "42883"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/Velar dev server:/u);
  const initial = await (await fetch("http://127.0.0.1:42883/__velar/status")).json() as {
    apiVersion: string;
    compilation: { moduleCount: number; compiledModules: number; reusedModules: number };
  };
  assert.equal(initial.apiVersion, "0.6");
  assert.deepEqual(initial.compilation, { ...initial.compilation, moduleCount: 3, compiledModules: 3, reusedModules: 0 });

  await writeFile(storePath, "export const label = \"Updated\"\n", "utf8");
  await waitForOutput(/Velar app rebuilt in .*\(2 compiled, 1 reused\)/u);
  const updated = await (await fetch("http://127.0.0.1:42883/__velar/status")).json() as {
    compilation: { compiledModules: number; reusedModules: number; affectedModules: number };
  };
  assert.equal(updated.compilation.compiledModules, 2);
  assert.equal(updated.compilation.reusedModules, 1);
  assert.equal(updated.compilation.affectedModules, 2);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, String(child.stderr.read() ?? ""));
});

test("dev server watches installed Velar source package roots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-package-"));
  const projectRoot = join(directory, "app");
  const packageRoot = join(directory, "library");
  await mkdir(join(projectRoot, "node_modules"), { recursive: true });
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "external-velar-kit",
    velar: { entry: "src/index.vel" },
  }), "utf8");
  const packageEntry = join(packageRoot, "src", "index.vel");
  await writeFile(packageEntry, "export const label = \"Library\"\n", "utf8");
  await symlink(packageRoot, join(projectRoot, "node_modules", "external-velar-kit"), "dir");
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ entry: "main.vel" }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
import {label} from "external-velar-kit"
component App:
    return <main>{label}</main>
mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "42884"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/Velar dev server:/u);
  await writeFile(packageEntry, "export const label = \"Updated library\"\n", "utf8");
  await waitForOutput(/Velar app rebuilt in .*\(2 compiled, 0 reused\)/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, String(child.stderr.read() ?? ""));
});

test("dev server watches JavaScript package subpath declarations and reanalyzes safe imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-js-types-"));
  const projectRoot = join(directory, "app");
  const packageRoot = join(directory, "typed-library");
  await mkdir(join(projectRoot, "node_modules"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "typed-library",
    type: "module",
    exports: {
      "./format": { types: "./index.d.mts", default: "./index.js" },
    },
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const format = value => String(value)\n", "utf8");
  const declarationPath = join(packageRoot, "index.d.mts");
  await writeFile(declarationPath, "export declare function format(value: number): string;\n", "utf8");
  await symlink(packageRoot, join(projectRoot, "node_modules", "typed-library"), "dir");
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel" }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
import js {format} from "typed-library/format"
component App:
    return <main>{format(42)}</main>
mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "42885"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/Velar dev server:/u);
  await writeFile(declarationPath, "export declare function format(value: string): string;\n", "utf8");
  await waitForOutput(/Velar app has 1 error/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, String(child.stderr.read() ?? ""));
});

test("compiles the Core language contract", async () => {
  const source = await readFile("examples/core.vel", "utf8");
  const result = compile(source, { path: "examples/core.vel" });

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const User = __velarRegisterType\(Object\.freeze/);
  assert.match(result.code ?? "", /class Player/);
  assert.match(result.code ?? "", /new Player\(user\.name\)/);
  assert.match(result.code ?? "", /User\.is\(raw\)/);
  assert.match(result.code ?? "", /__velarIndex\(names, 0\)/);
  assert.match(result.code ?? "", /for \(const/);
});

test("checks runtime type declarations and optional access", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

const raw = {name: "Ada", avatar: none}
const user = User.parse(raw)
const avatar = user?.avatar ?? "default.png"
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /User\.parse\(raw\)/);
  assert.match(result.code ?? "", /user\?\.avatar \?\? null\) \?\? "default\.png"/);
});

test("type checker rejects incompatible assignments", () => {
  const result = compile(`
let score: number = 1
score = "wrong"
`.trimStart());

  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => item.code === "VEL4001" && /string/.test(item.message)));
});

test("emits explicit JavaScript imports without leaking import markers", () => {
  const result = compile(`
import js unsafe {randomUUID} from "node:crypto"

const id = randomUUID()
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /import \{ randomUUID \} from "node:crypto";/);
  assert.doesNotMatch(result.code ?? "", /import js/);
});

test("type-checks literal dynamic Velar imports and lazy components", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dynamic-import-"));
  const mainPath = join(directory, "main.vel");
  const pagePath = join(directory, "page.vel");
  const stablePath = join(directory, "stable.vel");
  await writeFile(pagePath, `
export def label(value: number) -> string:
    return f"Page {value}"

export component Page(title: string):
    return <main><h1>{title}</h1></main>
`.trimStart(), "utf8");
  await writeFile(stablePath, "export const stable = \"stable\"\n", "utf8");
  await writeFile(mainPath, `
import {lazy} from "velar/web"
import {stable} from "./stable.vel"

component Loading:
    return <p>Loading</p>

const Page = lazy(() => import("./page.vel"), "Page", Loading)

async def loadLabel() -> string:
    const feature = await import("./page.vel")
    return feature.label(42)

component App:
    return <section><Page title={stable} /></section>

mount(<App />, "#app")
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.equal(project.modules.length, 3);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.match(main.result.code ?? "", /import\("\.\/page\.js"\)/u);
  assert.ok(main.result.dependencies.some((dependency) => dependency.dynamic && dependency.source === "./page.vel"));
  const dynamicPathOffset = main.result.source.text.indexOf("./page.vel") + 3;
  assert.deepEqual(projectDefinitionAt(project, mainPath, dynamicPathOffset), { path: pagePath, span: { start: 0, end: 0 } });

  const rebuilt = await compileProject(mainPath, new Map(), {}, project, new Set([pagePath]));
  assert.equal(rebuilt.stats.compiledModules, 2);
  assert.equal(rebuilt.stats.reusedModules, 1);
});

test("dynamic imports fail closed for unchecked paths, missing exports, and reactive modules", async () => {
  for (const source of [
    'const module = import("feature-package")\n',
    'const module = import("./feature.js")\n',
    'const path = "./feature.vel"\nconst module = import(path)\n',
  ]) {
    const result = compile(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2014" || /literal relative \.vel path/u.test(item.message)), source);
  }

  const directory = await mkdtemp(join(tmpdir(), "velar-dynamic-refusal-"));
  const mainPath = join(directory, "main.vel");
  await writeFile(join(directory, "feature.vel"), "export const value = 42\n", "utf8");
  await writeFile(mainPath, `
import {lazy} from "velar/web"
const Missing = lazy(() => import("./feature.vel"), "Missing")
`.trimStart(), "utf8");
  const missing = await compileProject(mainPath);
  assert.ok(missing.modules.some((module) => module.inputPath === mainPath
    && module.result.diagnostics.some((item) => /no export named 'Missing'/u.test(item.message))));

  await writeFile(join(directory, "feature.vel"), "export component Feature:\n    return <p>Feature</p>\n", "utf8");
  await writeFile(mainPath, `
import {lazy} from "velar/web"
component BadLoading(label: string):
    return <p>{label}</p>
component BadFailure(message: string):
    return <p>{message}</p>
const Feature = lazy(() => import("./feature.vel"), "Feature", BadLoading, BadFailure)
`.trimStart(), "utf8");
  const fallbacks = await compileProject(mainPath);
  const fallbackDiagnostics = fallbacks.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics ?? [];
  assert.ok(fallbackDiagnostics.some((item) => /loading fallback cannot require props/u.test(item.message)));
  assert.ok(fallbackDiagnostics.some((item) => /failure fallback must accept error: Error/u.test(item.message)));

  await writeFile(join(directory, "feature.vel"), "export state value = 42\nexport component Feature:\n    return <p>Feature</p>\n", "utf8");
  await writeFile(mainPath, 'const module = import("./feature.vel")\n', "utf8");
  const reactive = await compileProject(mainPath);
  assert.ok(reactive.failures.some((failure) => /exports reactive values/u.test(failure.message)));
});

test("production builds emit separately verified chunks for lazy Velar components", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dynamic-build-"));
  const output = join(directory, "dist");
  await writeFile(join(directory, "page.vel"), `
export component Page:
    return <main><h1>Split page</h1></main>
`.trimStart(), "utf8");
  await writeFile(join(directory, "main.vel"), `
import {lazy} from "velar/web"
const Page = lazy(() => import("./page.vel"), "Page")
component App:
    return <Page />
mount(<App />, "#app")
`.trimStart(), "utf8");
  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts", "build", join(directory, "main.vel"), "--out-dir", output,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  const assets = await readdir(join(output, "assets"));
  const entry = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  const chunk = assets.find((name) => /^chunk-page-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(entry && chunk, JSON.stringify(assets));
  assert.doesNotMatch(await readFile(join(output, "assets", entry), "utf8"), /Split page/u);
  assert.match(await readFile(join(output, "assets", chunk), "utf8"), /Split page/u);
  const manifest = JSON.parse(await readFile(join(output, "velar-build.json"), "utf8")) as {
    modules: { total: number };
    assets: Array<{ path: string; role: string }>;
  };
  assert.equal(manifest.modules.total, 2);
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${chunk}` && asset.role === "asset"));
  await verifyProductionBuild(output);
});

test("module state, computed values, and watches form a reactive module", () => {
  const result = compile(`
export state count: number = 0
export computed doubled = count * 2

export def increment():
    count += 1

watch count as current, previous:
    print(f"{previous} -> {current}")

component Counter:
    return <button on:click={increment}>{count} / {doubled}</button>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.moduleInterface.reactiveExports.get("count"), "state");
  assert.equal(result.moduleInterface.reactiveExports.get("doubled"), "computed");
  assert.equal(describeType(result.moduleInterface.exports.get("increment")!), "() -> none");
  assert.match(result.code ?? "", /export const count = __velarState\(0\)/);
  assert.match(result.code ?? "", /export const doubled = __velarComputed\(\(\) => \(count\.get\(\) \* 2\)/);
  assert.match(result.code ?? "", /count\.set\(count\.get\(\) \+ 1\)/);
  assert.match(result.code ?? "", /__velarWatch\(\(\) => count\.get\(\)/);
});

test("reactive module imports lower reads and reject ambiguous access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-reactive-modules-"));
  const storePath = join(directory, "store.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(storePath, `
export state count = 0
export computed doubled = count * 2
export def increment():
    count += 1
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {count, doubled, increment} from "./store.vel"

component App:
    return <button on:click={increment}>{count} / {doubled}</button>
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.match(main.result.code ?? "", /count\.get\(\)/);
  assert.match(main.result.code ?? "", /doubled\.get\(\)/);

  await writeFile(mainPath, "import * as store from \"./store.vel\"\nprint(store.count)\n", "utf8");
  const namespace = await compileProject(mainPath);
  assert.ok(namespace.failures.some((failure) => /import them by name/.test(failure.message)));

  await writeFile(mainPath, "import {count} from \"./store.vel\"\ncount = 2\n", "utf8");
  const assignment = await compileProject(mainPath);
  assert.ok(assignment.modules.some((module) => module.inputPath === mainPath
    && module.result.diagnostics.some((diagnostic) => diagnostic.code === "VEL3002")));
});

test("semantic index preserves lexical shadowing and typed call signatures", () => {
  const source = `
def show(value: number) -> number:
    const outer = value
    if true:
        const value = 4
        print(value)
    return outer

const result = show(2)
`.trimStart();
  const result = compile(source, { path: "/tmp/semantic.vel" });
  assert.deepEqual(result.diagnostics, []);
  const values = result.semanticIndex.symbols.filter((symbol) => symbol.name === "value");
  assert.equal(values.length, 2);
  const inner = values.find((symbol) => symbol.kind === "variable");
  const parameter = values.find((symbol) => symbol.kind === "parameter");
  assert.ok(inner && parameter);
  const references = result.semanticIndex.references.filter((reference) => reference.name === "value");
  assert.equal(references.length, 2);
  assert.notEqual(references[0]?.symbolId, references[1]?.symbolId);
  assert.equal(parameter.type, "number");
  const show = result.semanticIndex.symbols.find((symbol) => symbol.name === "show");
  assert.equal(show?.type, "(number) -> number");
  const innerOffset = source.indexOf("print(value)") + "print(".length;
  const innerVisible = semanticVisibleSymbolsAt(result.semanticIndex, innerOffset);
  assert.deepEqual(innerVisible.filter((symbol) => symbol.name === "value").map((symbol) => symbol.kind), ["variable"]);
  assert.ok(innerVisible.some((symbol) => symbol.name === "outer" && symbol.kind === "variable"));
  assert.ok(innerVisible.some((symbol) => symbol.name === "show" && symbol.kind === "function"));
  assert.ok(!innerVisible.some((symbol) => symbol.name === "result"), "later ordinary declarations are not visible early");
  const returnOffset = source.indexOf("return outer") + "return ".length;
  const returnVisible = semanticVisibleSymbolsAt(result.semanticIndex, returnOffset);
  assert.deepEqual(returnVisible.filter((symbol) => symbol.name === "value").map((symbol) => symbol.kind), ["parameter"]);
});

test("documentation comments cross declarations, aliases, members, hover targets, and completion", async () => {
  const direct = compile(`
/// Formats a visible label.
///
/// Accepts **plain text**.
export def formatLabel(value: string) -> string:
    return value

/// Not attached because a blank source line follows.

const detached = "value"

/// Owns a mutable count.
class Counter:
    /// Current accumulated value.
    let value: number = 0

    /// Adds one checked amount.
    def add(amount: number):
        self.value += amount
`.trimStart(), { path: "/tmp/documented.vel" });
  assert.deepEqual(direct.diagnostics, []);
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "formatLabel")?.documentation,
    "Formats a visible label.\n\nAccepts **plain text**.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "Counter")?.documentation,
    "Owns a mutable count.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "value" && symbol.kind === "field")?.documentation,
    "Current accumulated value.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "add")?.documentation,
    "Adds one checked amount.");
  assert.equal(direct.semanticIndex.symbols.find((symbol) => symbol.name === "detached")?.documentation, null);
  assert.doesNotMatch(direct.code ?? "", /Formats a visible label|Owns a mutable count/u);

  const oversized = compile(`/// ${"x".repeat(17_000)}\nconst documented = true\n`);
  const boundedDocumentation = oversized.semanticIndex.symbols.find((symbol) => symbol.name === "documented")?.documentation ?? "";
  assert.equal(boundedDocumentation.length, 16_384);
  assert.ok(boundedDocumentation.endsWith("…"));

  const directory = await mkdtemp(join(tmpdir(), "velar-documentation-"));
  const apiPath = join(directory, "api.vel");
  const mainPath = join(directory, "main.vel");
  const apiSource = `
/// Represents a public profile.
export type Profile:
    /// Stable display name.
    name: string

/// Builds the greeting shown in the header.
export def greet(profile: Profile) -> string:
    return f"Hello, {profile.name}"

/// Counts completed operations.
export class Meter:
    let total: number = 0

    /// Records one completed operation.
    def add():
        self.total += 1
`.trimStart();
  const mainSource = `
import {Profile, greet as welcome, Meter as Counter} from "./api.vel"

const profile: Profile = {name: "Ada"}
const counter = Counter()
counter.add()
print(welcome(profile))
print(profile.name)
`.trimStart();
  await writeFile(apiPath, apiSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const welcomeOffset = mainSource.indexOf("welcome(profile)") + 1;
  assert.equal(projectSymbolAt(project, mainPath, welcomeOffset)?.documentation,
    "Builds the greeting shown in the header.");
  const addOffset = mainSource.indexOf("counter.add") + "counter.".length + 1;
  assert.equal(projectMemberSymbolAt(project, mainPath, addOffset)?.documentation,
    "Records one completed operation.");
  const memberCompletions = projectCompletionsAt(project, mainPath,
    mainSource.indexOf("counter.add") + "counter.".length);
  assert.equal(memberCompletions.find((item) => item.label === "add")?.documentation,
    "Records one completed operation.");
  const nameOffset = mainSource.indexOf("profile.name") + "profile.".length + 1;
  assert.equal(projectMemberSymbolAt(project, mainPath, nameOffset)?.documentation,
    "Stable display name.");
  const completions = projectCompletionsAt(project, mainPath, mainSource.length);
  assert.equal(completions.find((item) => item.label === "welcome")?.documentation,
    "Builds the greeting shown in the header.");
  assert.equal(completions.find((item) => item.label === "Counter")?.documentation,
    "Counts completed operations.");
});

test("project semantics resolve imports and keep alias rename fail-closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-semantics-"));
  const modelsPath = join(directory, "models.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(modelsPath, `
export type User:
    name: string

export def greet(user: User) -> string:
    return user.name

export const sample: User = {name: "Sample"}
const {name: sampleName} = sample
print(sample.name)

export def copy(source: User) -> User:
    const name = source.name
    const result: User = {name}
    return result

export def pick(source: User) -> string:
    const {name} = source
    return name
`.trimStart(), "utf8");
  const mainSource = `
import {User as Person, greet} from "./models.vel"

const ada = Person.parse({name: "Ada"})
print(ada.name)
print(Person.parse({name: "Grace"}).name)
const page = [1, 2, 3].slice(0, 2)
const label = greet(ada)
`.trimStart();
  await writeFile(mainPath, mainSource, "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const personUse = mainSource.indexOf("Person.parse");
  const definition = projectDefinitionAt(project, mainPath, personUse + 1);
  assert.equal(definition?.path, modelsPath);
  assert.equal((await readFile(modelsPath, "utf8")).slice(definition?.span.start, definition?.span.end), "User");

  const localRename = projectRenameAt(project, mainPath, personUse + 1, "Account");
  assert.notEqual(typeof localRename, "string");
  if (typeof localRename !== "string") {
    assert.equal(localRename.edits.length, 3);
    assert.ok(localRename.edits.every((edit) => edit.path === mainPath));
  }

  const importedUser = mainSource.indexOf("User as");
  const exportedRename = projectRenameAt(project, mainPath, importedUser + 1, "Member");
  assert.notEqual(typeof exportedRename, "string");
  if (typeof exportedRename !== "string") {
    assert.ok(exportedRename.edits.some((edit) => edit.path === modelsPath));
    assert.ok(exportedRename.edits.some((edit) => edit.path === mainPath && edit.span.start === importedUser));
    assert.ok(!exportedRename.edits.some((edit) => edit.path === mainPath && mainSource.slice(edit.span.start, edit.span.end) === "Person"));
  }

  const references = projectReferencesAt(project, modelsPath, (await readFile(modelsPath, "utf8")).indexOf("greet") + 1, true);
  assert.equal(references.filter((item) => item.path === mainPath).length, 2);
  assert.equal(projectRenameAt(project, modelsPath, (await readFile(modelsPath, "utf8")).indexOf("greet") + 1, "User"), "The new name collides with another declaration");
  assert.deepEqual(projectSignatureAt(project, mainPath, mainSource.indexOf("greet(ada)") + "greet(".length), {
    label: "greet(User) -> string",
    activeParameter: 0,
  });
  const ordinaryCompletions = projectCompletionsAt(project, mainPath, mainSource.indexOf("const label"));
  assert.ok(ordinaryCompletions.some((item) => item.label === "Person" && item.kind === "import" && item.detail === "Person"));
  assert.ok(ordinaryCompletions.some((item) => item.label === "greet" && item.kind === "import" && /\(Person\) -> string/u.test(item.detail)));
  assert.ok(ordinaryCompletions.some((item) => item.label === "ada" && item.kind === "variable" && item.detail === "Person"));
  assert.ok(!ordinaryCompletions.some((item) => item.label === "label"), "the binding being declared must not complete itself");
  assert.deepEqual(projectCompletionsAt(project, mainPath, personUse + "Person.".length), [
    { label: "parse", detail: "(unknown) -> User", kind: "method" },
  ]);
  const adaMember = mainSource.indexOf("ada.name") + "ada.".length;
  assert.deepEqual(projectCompletionsAt(project, mainPath, adaMember), [
    { label: "name", detail: "string", kind: "field" },
  ]);
  const userField = (await readFile(modelsPath, "utf8")).indexOf("name: string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, adaMember + 1), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  const parsedMember = mainSource.indexOf("}).name") + "}).".length;
  assert.deepEqual(projectCompletionsAt(project, mainPath, parsedMember), [
    { label: "name", detail: "string", kind: "field" },
  ]);
  assert.deepEqual(projectExpressionAt(project, mainPath, parsedMember + 1), {
    span: {
      start: mainSource.indexOf("Person.parse({name: \"Grace\"}).name"),
      end: mainSource.indexOf("Person.parse({name: \"Grace\"}).name") + "Person.parse({name: \"Grace\"}).name".length,
    },
    type: "string",
    members: [{ name: "length", kind: "field", type: "number" }],
    memberName: "name",
    selectionSpan: { start: parsedMember, end: parsedMember + "name".length },
    ownerType: "Person",
    ownerKind: "named",
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, parsedMember + 1), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  const modelsSource = await readFile(modelsPath, "utf8");
  const sampleKey = modelsSource.indexOf("{name: \"Sample\"") + 1;
  assert.equal(projectCompletionContextAt(project, modelsPath, sampleKey), "object-field");
  assert.deepEqual(projectCompletionsAt(project, modelsPath, sampleKey), [
    { label: "name", detail: "string", kind: "field" },
  ]);
  assert.equal(projectCompletionContextAt(project, modelsPath, sampleKey + "name: ".length), "ordinary");
  const memberReferences = projectReferencesAt(project, modelsPath, userField + 1, true);
  assert.equal(memberReferences.length, 12);
  assert.ok(memberReferences.every((location) => project.modules
    .find((module) => module.inputPath === location.path)?.result.source.text.slice(location.span.start, location.span.end) === "name"));
  assert.deepEqual(projectDefinitionAt(project, modelsPath, modelsSource.indexOf("{name: \"Sample\"") + 2), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  assert.deepEqual(projectDefinitionAt(project, modelsPath, modelsSource.indexOf("{name: sampleName") + 2), {
    path: modelsPath,
    span: { start: userField, end: userField + "name".length },
  });
  const sliceCall = mainSource.indexOf(".slice(0, 2)") + ".slice(0, ".length;
  assert.deepEqual(projectSignatureAt(project, mainPath, sliceCall), {
    label: "slice(number, number) -> List<number>",
    activeParameter: 1,
  });
  assert.equal(projectExpressionAt(project, mainPath, mainSource.indexOf(".slice") + 2)?.type,
    "(number, number) -> List<number>");
  const preparedFieldRename = projectPrepareRenameAt(project, modelsPath, modelsSource.indexOf("{name}\n") + 2);
  assert.equal(preparedFieldRename?.placeholder, "name");
  const fieldRename = projectRenameAt(project, modelsPath, userField + 1, "fullName");
  assert.notEqual(typeof fieldRename, "string");
  if (typeof fieldRename !== "string") {
    assert.equal(fieldRename.edits.length, 12);
    assert.equal(fieldRename.edits.filter((edit) => edit.replacement === "fullName: name").length, 2);
    const editsByPath = new Map<string, typeof fieldRename.edits[number][]>();
    for (const edit of fieldRename.edits) {
      const edits = editsByPath.get(edit.path) ?? [];
      edits.push(edit);
      editsByPath.set(edit.path, edits);
    }
    for (const [editPath, edits] of editsByPath) {
      let updated = await readFile(editPath, "utf8");
      for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
        updated = `${updated.slice(0, edit.span.start)}${edit.replacement ?? "fullName"}${updated.slice(edit.span.end)}`;
      }
      await writeFile(editPath, updated, "utf8");
    }
    const renamedProject = await compileProject(mainPath);
    assert.deepEqual(renamedProject.failures, []);
    assert.deepEqual(renamedProject.modules.flatMap((module) => module.result.diagnostics), []);
  }
});

test("project sessions reuse unaffected modules and invalidate reverse dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-session-"));
  await writeFile(join(directory, "velar.json"), JSON.stringify({ entry: "main.vel", outDir: "dist" }), "utf8");
  const storePath = join(directory, "store.vel");
  const mainPath = join(directory, "main.vel");
  const otherPath = join(directory, "other.vel");
  await writeFile(storePath, "export const value = 1\n", "utf8");
  await writeFile(mainPath, "import {value} from \"./store.vel\"\nprint(value)\n", "utf8");
  await writeFile(otherPath, "export const untouched = 2\n", "utf8");

  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  assert.deepEqual(first.project.stats, {
    moduleCount: 3,
    compiledModules: 3,
    reusedModules: 0,
    affectedModules: 3,
    durationMs: first.project.stats.durationMs,
  });
  const second = await sessions.snapshot(mainPath);
  assert.equal(second.project, first.project);
  const firstOther = first.project.modules.find((module) => module.inputPath === otherPath)?.result;
  const firstMain = first.project.modules.find((module) => module.inputPath === mainPath)?.result;
  await writeFile(storePath, "export const value = 3\n", "utf8");
  const third = await sessions.snapshot(mainPath);
  assert.deepEqual([...third.changedPaths], [storePath]);
  assert.equal(third.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.notEqual(third.project.modules.find((module) => module.inputPath === mainPath)?.result, firstMain);
  assert.equal(third.project.stats.compiledModules, 2);
  assert.equal(third.project.stats.reusedModules, 1);
  assert.equal(third.project.stats.affectedModules, 2);

  await unlink(storePath);
  const missing = await sessions.snapshot(mainPath);
  assert.ok(missing.project.failures.some((failure) => failure.path === storePath && /ENOENT|no such file/u.test(failure.message)));
  assert.equal(missing.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.equal(missing.project.modules.some((module) => module.inputPath === storePath), false);

  await writeFile(storePath, "export const value = 4\n", "utf8");
  const restored = await sessions.snapshot(mainPath);
  assert.deepEqual(restored.project.failures, []);
  assert.deepEqual(restored.project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(restored.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.match(restored.project.modules.find((module) => module.inputPath === storePath)?.result.code ?? "", /const value = 4/u);
});

test("0.6 Web APIs have one versioned typed compiler/runtime contract", async () => {
  const api = standardModuleApi();
  assert.equal(api.standardVersion, "0.4");
  assert.equal(api.webVersion, "0.6");
  assert.deepEqual(api.modules["velar/app"], ["onError", "reportError"]);
  assert.deepEqual(api.modules["velar/config"], ["has", "keys", "publicConfig"]);
  assert.deepEqual(api.modules["velar/web"], ["Head", "Link", "NavLink", "RouteContext", "Router", "announce", "back", "currentRoute", "forward", "lazy", "navigate", "redirect", "reload", "route"]);
  assert.deepEqual(api.modules["velar/forms"], ["checkedValue", "clearError", "clearErrors", "errors", "fieldValue", "fieldValues", "focusFirstError", "numberValue", "read", "reset", "setError", "setPending", "textValue", "values"]);
  assert.deepEqual(api.modules["velar/http"], ["HttpAbortError", "HttpError", "formBody", "http"]);
  assert.deepEqual(api.modules["velar/storage"], ["database", "session", "storage"]);
  assert.deepEqual(api.modules["velar/browser"], ["after", "blur", "closeDialog", "copyText", "dialogResult", "environment", "every", "focus", "frame", "location", "measure", "media", "open", "readClipboardText", "scrollIntoView", "scrollTo", "showDialog", "watchMedia", "watchOnline", "watchVisibility"]);
  assert.deepEqual(api.modules["velar/files"], ["download", "pick", "readDataUrl", "readText"]);
  assert.deepEqual(api.modules["velar/realtime"], ["eventStream", "socket"]);
  assert.deepEqual(api.modules["velar/test"], ["browser", "expect"]);
  const webRuntime = standardModuleSource("velar/web", { base: "/studio/" }) ?? "";
  assert.match(webRuntime, /const appBase = "\/studio\/"/u);
  assert.doesNotMatch(webRuntime, /__VELAR_WEB_BASE__/u);
  const configRuntime = standardModuleSource("velar/config", { base: "/", publicConfig: { apiBase: "https://api.example.com" } }) ?? "";
  assert.match(configRuntime, /const source = \{"apiBase":"https:\/\/api\.example\.com"\}/u);
  assert.doesNotMatch(configRuntime, /__VELAR_PUBLIC_CONFIG__/u);

  const directory = await mkdtemp(join(tmpdir(), "velar-web-api-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {Head, RouteContext, Router, Link, NavLink, announce, back, currentRoute, forward, navigate, redirect, reload, route} from "velar/web"
import {checkedValue, clearError, clearErrors, errors, fieldValue, fieldValues, focusFirstError, numberValue, read, reset, setError, setPending, textValue, values} from "velar/forms"
import {HttpAbortError, formBody, http} from "velar/http"
import {database, session, storage} from "velar/storage"
import {after, blur, closeDialog, dialogResult, environment, every, focus, frame, location as browserLocation, measure, media, scrollIntoView, showDialog, watchMedia, watchOnline, watchVisibility} from "velar/browser"
import {download, pick} from "velar/files"
import {eventStream, socket} from "velar/realtime"
import {onError, reportError} from "velar/app"
import {has as hasConfig, keys as configKeys, publicConfig} from "velar/config"

type Item:
    name: string

type AppSettings:
    apiBase: string

enum FormMode:
    create
    update

type FormDraft:
    name: string
    count: number?
    selected: bool
    labels: List<string>
    mode: FormMode

component Missing:
    return <main>Missing</main>

component ItemPage(route: RouteContext):
    return <main>{route.params.get("id") ?? "missing"}</main>

component App:
    let form: Element? = none
    let dialog: DialogElement? = none
    const request = http.request("GET", "/api/items", {timeout: 100})
    const abortError = HttpAbortError("cancelled")
    const known = storage.has("items")
    const keys = storage.keys()
    const routeInfo = currentRoute()
    const browserInfo = browserLocation()
    const browserEnvironment = environment()
    const dark = media("(prefers-color-scheme: dark)")

    def inspect():
        if form:
            const typed = read(form, FormDraft)
            const data = values(form)
            const name = fieldValue(form, "name")
            const title = textValue(form, "name", "Untitled")
            const count = numberValue(form, "count")
            const selected = checkedValue(form, "selected")
            const labels = fieldValues(form, "label")
            setError(form, "name", "Required")
            const currentErrors = errors(form)
            focusFirstError(form)
            setPending(form, true)
            setPending(form, false)
            reset(form)
            clearError(form, "name")
            clearErrors(form)
            const bounds = measure(form)
            scrollIntoView(form)
            focus(form, true)
            blur(form)
            announce("Checked")
        if dialog:
            showDialog(dialog)
            closeDialog(dialog, dialogResult(dialog))

    return <><Head title="API" description="Typed Web" canonical="https://example.com/" robots="index,follow" image="/share.png" themeColor="#111827" /><form ref={form}><input name="name" /><input name="count" type="number" /><input name="selected" type="checkbox" /><input name="labels" /><select name="mode"><option value={FormMode.create}>Create</option></select></form><dialog ref={dialog}>Confirm</dialog><Router routes={[route("/", Missing), route("/items/:id", ItemPage)]} fallback={Missing} /></>

const link = <Link to="/items" replace={true}>Items</Link>
const navLink = <NavLink to="/items" exact={true}>Items</NavLink>
const settings = publicConfig(AppSettings)
const configured = hasConfig("apiBase")
const configuredKeys = configKeys()
const stopErrors = onError(report => print(report.error.message))
reportError(Error("reported"), "manual", "contract")
const local = storage.scope("app")
const stopStorage = local.watch("item", Item, (next, previous) => print(next?.name ?? "none"))
const cached = await database("app").get("item", Item)
const stopSession = session.watch("item", Item, (next, previous) => print(previous?.name ?? "none"))
const stopMedia = watchMedia("(prefers-color-scheme: dark)", matches => print(matches))
const stopOnline = watchOnline(online => print(online))
const stopVisibility = watchVisibility(visible => print(visible))
const stopAfter = after(10, () => print("after"))
const stopEvery = every(10, () => print("every"))
const response = await http.head("/api/items").response()
const parsed = await http.get("/api/items").parse(Item)
const selected = await pick()
const upload = formBody()
upload.field("label", "items")
upload.files("attachments", selected)
if selected.length > 0:
    upload.file("primary", selected[0], "primary.txt")
const uploadNames = upload.names()
const hasUpload = upload.has("label")
upload.remove("unused")
const uploadRequest = http.post("/api/upload", {body: upload})
const nextFrame = await frame()
download("items.txt", "items")
const channel = socket("wss://example.com/socket", {message: value => print(value.length)})
const stream = eventStream("/events", {message: (value, id) => print(f"{id}:{value}")})
channel.close()
stream.close()
stopAfter()
stopEvery()
back()
forward()
navigate("/items", {scroll: false})
redirect("/items")
reload()
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const compiled = project.modules[0]?.result;
  assert.match(compiled?.code ?? "", /http\.request/u);
  assert.match(compiled?.code ?? "", /read\(form, FormDraft, \[\{"name":"name","kind":"string","optional":false\}/u);
  assert.match(compiled?.code ?? "", /"name":"mode","kind":"enum","optional":false,"enumValues":\["create","update"\]/u);
  assert.equal(compiled?.semanticIndex.symbols.find((item) => item.name === "typed")?.type, "FormDraft");
});

test("browser timers are cancellable, non-overlapping, and report failures", async () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`${source}
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
let afterCount = 0;
let cancelledCount = 0;
let everyCount = 0;
const cancelAfter = after(20, () => { cancelledCount += 1; });
cancelAfter();
cancelAfter();
after(5, () => { afterCount += 1; });
let activeWorkers = 0;
let maxWorkers = 0;
const stopEvery = every(5, async () => {
  activeWorkers += 1;
  maxWorkers = Math.max(maxWorkers, activeWorkers);
  await new Promise((resolve) => setTimeout(resolve, 12));
  everyCount += 1;
  activeWorkers -= 1;
});
after(1, () => { throw new Error("sync failure"); });
after(1, async () => { throw new Error("async failure"); });
await new Promise((resolve) => setTimeout(resolve, 48));
stopEvery();
await new Promise((resolve) => setTimeout(resolve, 20));
const stoppedCount = everyCount;
await new Promise((resolve) => setTimeout(resolve, 24));
console.log([afterCount, cancelledCount, everyCount >= 2, everyCount === stoppedCount, maxWorkers].join(":"));
console.log(reports.sort().join("|"));
try { every(0, () => null); } catch (error) { console.log(error.name); }
try { after(-1, () => null); } catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1:0:true:true:1\ntimer:after:async failure|timer:after:sync failure\nRangeError\nRangeError\n");
});

test("owned browser, storage, and realtime callbacks report sync and async failures", () => {
  const browserSource = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
const windowListeners = new Map();
globalThis.addEventListener = (name, callback) => windowListeners.set(name, callback);
globalThis.removeEventListener = (name, callback) => { if (windowListeners.get(name) === callback) windowListeners.delete(name); };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
const documentListeners = new Map();
globalThis.document = { visibilityState: "visible", addEventListener(name, callback) { documentListeners.set(name, callback); }, removeEventListener(name, callback) { if (documentListeners.get(name) === callback) documentListeners.delete(name); } };
const mediaListeners = new Map();
globalThis.matchMedia = () => ({ matches: true, addEventListener(name, callback) { mediaListeners.set(name, callback); }, removeEventListener(name, callback) { if (mediaListeners.get(name) === callback) mediaListeners.delete(name); } });
${browserSource}
const stopMedia = watchMedia("screen", () => { throw new Error("media failed"); });
const stopOnline = watchOnline(async () => { throw new Error("online failed"); });
const stopVisibility = watchVisibility(() => { throw "visibility failed"; });
mediaListeners.get("change")({ matches: true });
windowListeners.get("online")();
documentListeners.get("visibilitychange")();
await new Promise((resolve) => setTimeout(resolve, 0));
stopMedia(); stopOnline(); stopVisibility();
console.log(reports.sort().join("|"));
console.log([mediaListeners.size, windowListeners.size, documentListeners.size].join(":"));
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "observer:media:media failed|observer:online:online failed|observer:visibility:visibility failed\n0:0:0\n");

  const storageSource = standardModuleSource("velar/storage") ?? "";
  const storageExecution = executeModule(`
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
const data = new Map(), listeners = new Map();
globalThis.localStorage = { get length() { return data.size; }, key(index) { return [...data.keys()][index] ?? null; }, getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); }, removeItem(key) { data.delete(key); } };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.addEventListener = (name, callback) => listeners.set(name, callback);
globalThis.removeEventListener = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
globalThis.dispatchEvent = (event) => { listeners.get(event.type)?.(event); return true; };
${storageSource}
const Item = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
const stop = storage.watch("item", Item, async () => { throw new Error("storage failed"); });
storage.set("item", { value: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
stop();
storage.set("item", { value: 2 });
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(reports.join("|"));
console.log(listeners.size);
`);
  assert.equal(storageExecution.status, 0, String(storageExecution.stderr));
  assert.equal(storageExecution.stdout, "storage:watch:storage failed\n0\n");

  const realtimeSource = standardModuleSource("velar/realtime") ?? "";
  const realtimeExecution = executeModule(`
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
class FakeSocket {
  static OPEN = 1; static CLOSING = 2; static last;
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); FakeSocket.last = this; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  send() {} close() { this.readyState = 3; }
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
}
class FakeEventSource {
  static last;
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); FakeEventSource.last = this; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  close() { this.readyState = 2; }
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
}
globalThis.WebSocket = FakeSocket;
globalThis.EventSource = FakeEventSource;
${realtimeSource}
socket("wss://example.test", { message: async () => { throw new Error("socket failed"); } });
FakeSocket.last.emit("message", { data: "hello" });
eventStream("https://example.test/events", { message: () => { throw new Error("stream failed"); } });
FakeEventSource.last.emit("message", { data: "hello", lastEventId: "1" });
await new Promise((resolve) => setTimeout(resolve, 0));
try { socket("wss://example.test", { message: "invalid" }); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(reports.sort().join("|"));
`);
  assert.equal(realtimeExecution.status, 0, String(realtimeExecution.stderr));
  assert.equal(realtimeExecution.stdout, "TypeError\nrealtime:event-stream:message:stream failed|realtime:socket:message:socket failed\n");
});

test("lazy components recover from post-load construction and fallback failures", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
class FakeNode {
  constructor(tag = "node") { this.tag = tag; this.style = {}; this.children = []; this.textContent = ""; }
  append(value) { this.children.push(value); }
  replaceChildren(...values) { this.children = values; }
  setAttribute(name, value) { this[name] = value; }
  insertBefore(value) { this.children.push(value); }
  remove() { this.removed = true; }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement(tag) { return new FakeNode(tag); },
  createElementNS(namespace, tag) { const node = new FakeNode(tag); node.namespace = namespace; return node; },
  createComment(text) { return new FakeNode(text); },
  createTextNode(text) { const node = new FakeNode("text"); node.textContent = String(text); return node; },
};
globalThis[Symbol.for("velar.runtime.v1")] = {
  report(error, options) { console.log(options.phase + ":" + options.detail + ":" + error.message); },
};
${source}
const LazyPage = lazy(
  () => Promise.resolve({ Page: () => { throw new Error("Page construction failed"); } }),
  "Page",
  null,
  () => { throw new Error("Fallback construction failed"); },
);
const instance = LazyPage();
await new Promise((resolve) => setTimeout(resolve, 0));
const alert = instance.node.children[0];
console.log(alert.role + ":" + alert.textContent);
const InvalidLoading = lazy(() => new Promise(() => {}), "Page", () => new FakeNode("invalid"));
try { InvalidLoading(); console.log("accepted"); } catch (error) { console.log(error.name); }
let resolvedNamespace = "";
const LazyGraphic = lazy(
  () => Promise.resolve({ Graphic: (props, namespace) => {
    resolvedNamespace = namespace;
    return component(new FakeNode("circle:" + namespace));
  } }),
  "Graphic",
);
const graphic = LazyGraphic({}, "svg");
console.log(graphic.node.tag + ":" + graphic.node.namespace);
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(resolvedNamespace + ":" + graphic.node.children[0].tag);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "resource:lazy:Page:Page construction failed",
    "render:lazy-fallback:Page:Fallback construction failed",
    "alert:Unable to render Page",
    "TypeError",
    "g:http://www.w3.org/2000/svg",
    "svg:circle:svg",
    "",
  ].join("\n"));
});

test("Router renders an accessible default 404 and validates targets before commit", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
class FakeNode {
  constructor(tag = "node") { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ""; this.removed = false; }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  insertBefore(value) { this.children.push(value); }
  remove() { this.removed = true; }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement(tag) { return new FakeNode(tag); },
  createComment(text) { return new FakeNode(text); },
  createTextNode(text) { const node = new FakeNode("text"); node.textContent = String(text); return node; },
};
globalThis.location = { pathname: "/missing", search: "", hash: "" };
const listeners = new Map();
globalThis.addEventListener = (name, listener) => listeners.set(name, listener);
globalThis.removeEventListener = (name) => listeners.delete(name);
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = {
  report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); },
};
${source}
for (const path of ["/items?view=all", "/items/", "/items//detail", "/items/file*", "/:wildcard/*"]) {
  try { route(path, () => component(new FakeNode("main"))); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
const missing = Router({ routes: [] });
const page = missing.node.children[0];
console.log(page.attributes["data-velar-not-found"] + ":" + page.children[0].textContent + ":" + page.children[1].textContent);

location.pathname = "/items/%E0%A4%A";
const malformed = Router({ routes: [route("/items/:id", () => component(new FakeNode("main")))] });
console.log(malformed.node.children[0].children[0].textContent);

const home = new FakeNode("main");
home.textContent = "Home";
location.pathname = "/";
const routed = Router({
  routes: [
    route("/", () => component(home)),
    route("/invalid", () => new FakeNode("invalid")),
  ],
});
routed.__mount();
location.pathname = "/invalid";
listeners.get("popstate")();
console.log(String(routed.node.children[0] === home) + ":" + String(home.removed));
console.log(reports.join("|"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    ":Page not found:No route matches /missing",
    "Page not found",
    "true:false",
    "render:router:A Velar Router target must render a component",
    "",
  ].join("\n"));
});

test("Router caps route tables before creating browser nodes", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
let domCalls = 0;
globalThis.document = { createElement() { domCalls += 1; return {}; } };
${source}
const item = route("/", () => null);
try { Router({ routes: new Array(10001).fill(item) }); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(domCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\n0\n");
});

test("Web records reject accessors and invalid fields before DOM or history effects", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
let getterReads = 0;
let domCalls = 0;
let historyCalls = 0;
let frameCalls = 0;
class FakeNode {}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement() { domCalls += 1; return new FakeNode(); },
  createComment() { domCalls += 1; return new FakeNode(); },
  createTextNode() { domCalls += 1; return new FakeNode(); },
  querySelector() { domCalls += 1; return null; },
  body: { append() { domCalls += 1; } },
};
globalThis.location = { pathname: "/", search: "", hash: "", href: "https://example.test/", origin: "https://example.test" };
globalThis.history = {
  pushState() { historyCalls += 1; },
  replaceState() { historyCalls += 1; },
  back() { historyCalls += 1; },
  forward() { historyCalls += 1; },
};
globalThis.dispatchEvent = () => true;
globalThis.PopStateEvent = class {};
globalThis.requestAnimationFrame = () => { frameCalls += 1; };
${source}
const accessor = (key, value) => Object.defineProperty({}, key, { enumerable: true, get() { getterReads += 1; return value; } });
const routeAccessor = Object.defineProperty({ component: () => null }, "path", { enumerable: true, get() { getterReads += 1; return "/"; } });
const operations = [
  () => navigate("/", accessor("replace", true)),
  () => navigate("/", { unknown: true }),
  () => navigate("/", { scroll: "yes" }),
  () => Head(accessor("title", "Title")),
  () => Head({ title: 42 }),
  () => Router(accessor("routes", [])),
  () => Router({ routes: new Array(1) }),
  () => Router({ routes: [routeAccessor] }),
  () => Router({ routes: [], fallback: "missing" }),
  () => Link({ to: 42 }),
  () => Link({ to: "/", replace: 1 }),
  () => Link(accessor("to", "/")),
  () => NavLink({ to: "/", exact: 1 }),
  () => announce(42),
];
const failures = [];
for (const operation of operations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log([getterReads, domCalls, historyCalls, frameCalls].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(14).fill("TypeError").join(",")}\n0:0:0:0\n`);
});

test("form boundaries validate descriptors before reading or mutating a form", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`
let getterReads = 0;
let formDataCalls = 0;
globalThis.HTMLFormElement = class {};
globalThis.FormData = class {
  constructor() { formDataCalls += 1; }
  get() { return null; }
  getAll() { return []; }
  has() { return false; }
  *[Symbol.iterator]() {}
};
${source}
const form = new HTMLFormElement();
const RuntimeType = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
const typeAccessor = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { getterReads += 1; return value => value; } });
const fieldsAccessor = [];
Object.defineProperty(fieldsAccessor, 0, { enumerable: true, get() { getterReads += 1; return { name: "title", kind: "string", optional: false }; } });
fieldsAccessor.length = 1;
const fieldAccessor = Object.defineProperty({ kind: "string", optional: false }, "name", { enumerable: true, get() { getterReads += 1; return "title"; } });
const operations = [
  () => fieldValue(form, 42),
  () => textValue(form, "title", 42),
  () => checkedValue(form, 42),
  () => read(form, typeAccessor, []),
  () => read(form, RuntimeType, fieldsAccessor),
  () => read(form, RuntimeType, [fieldAccessor]),
  () => read(form, RuntimeType, [{ name: "title", kind: "object", optional: false }]),
  () => setError(form, "title", 42),
  () => setPending(form, "yes"),
];
const failures = [];
for (const operation of operations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(getterReads + ":" + formDataCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(9).fill("TypeError").join(",")}\n0:0\n`);
});

test("form helpers cap submitted fields and avoid full scans for one field", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`
let iterations = 0;
let gets = 0;
globalThis.HTMLFormElement = class { constructor() { this.elements = []; } };
globalThis.FormData = class {
  get() { gets += 1; return "first"; }
  *[Symbol.iterator]() {
    for (let index = 0; index <= 100000; index += 1) {
      iterations += 1;
      yield ["field", "value"];
    }
  }
};
${source}
const form = new HTMLFormElement();
console.log(fieldValue(form, "field"));
console.log(iterations + ":" + gets);
try { values(form); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(iterations + ":" + gets);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first\n0:1\nRangeError\n100001:1\n");
});

test("form helpers bound field names, fallback text, and returned error records", () => {
  const source = (standardModuleSource("velar/forms") ?? "").replace(
    "const maxFormTextCodeUnits = 16 * 1024 * 1024;",
    "const maxFormTextCodeUnits = 16;",
  );
  const execution = executeModule(`
globalThis.HTMLFormElement = class {
  constructor() { this.elements = []; this.errorNodes = []; }
  querySelectorAll() { return this.errorNodes; }
};
globalThis.FormData = class {
  *[Symbol.iterator]() { yield ["x".repeat(1025), "value"]; }
  get() { return null; }
  getAll() { return []; }
  has() { return false; }
};
${source}
const form = new HTMLFormElement();
for (const operation of [
  () => values(form),
  () => textValue(form, "field", "x".repeat(17)),
  () => setError(form, "field", "x".repeat(65537)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
form.errorNodes = [{ getAttribute() { return "field"; }, textContent: "x".repeat(65537) }];
try { errors(form); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\nRangeError\nRangeError\nRangeError\n");
});

test("browser helpers reject invalid values before invoking browser capabilities", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
let clipboardReads = 0;
let browserCalls = 0;
class FakeElement {
  scrollIntoView() { browserCalls += 1; }
}
class FakeDialog extends FakeElement {
  constructor() { super(); this.open = true; this.isConnected = true; }
  close() { browserCalls += 1; }
}
globalThis.Element = FakeElement;
globalThis.HTMLDialogElement = FakeDialog;
globalThis.isSecureContext = true;
const navigatorValue = {};
Object.defineProperty(navigatorValue, "clipboard", { get() { clipboardReads += 1; return { writeText() { browserCalls += 1; } }; } });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
globalThis.open = () => { browserCalls += 1; };
globalThis.scrollTo = () => { browserCalls += 1; };
globalThis.matchMedia = () => { browserCalls += 1; return { matches: false, addEventListener() { browserCalls += 1; } }; };
${source}
const dialog = new FakeDialog();
const element = new FakeElement();
const operations = [
  async () => copyText(42),
  () => open(42),
  () => scrollTo(Number.NaN, 0),
  () => scrollTo(0, 0, "fast"),
  () => scrollIntoView(element, "fast"),
  () => media(42),
  () => watchMedia("screen", 42),
  () => closeDialog(dialog, 42),
];
const failures = [];
for (const operation of operations) {
  try { await operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(clipboardReads + ":" + browserCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(8).fill("TypeError").join(",")}\n0:0\n`);
});

test("browser focus helpers use validated HTML elements and native prototype operations", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
const calls = [];
class FakeElement {}
class FakeHTMLElement extends FakeElement {
  focus(options) { calls.push("prototype-focus:" + options.preventScroll); }
  blur() { calls.push("prototype-blur"); }
}
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
${source}
const element = new FakeHTMLElement();
element.focus = () => calls.push("instance-focus");
element.blur = () => calls.push("instance-blur");
focus(element, true);
blur(element);
const failures = [];
for (const operation of [
  () => focus(new FakeElement()),
  () => focus(element, "yes"),
  () => blur(new FakeElement()),
]) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(calls.join(","));
console.log(failures.join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "prototype-focus:true,prototype-blur\nTypeError,TypeError,TypeError\n");
});

test("browser snapshots and asynchronous host results stay inside typed bounds", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
class FakeElement { getBoundingClientRect() { return { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1, top: 0, right: 1, bottom: 1, left: 0 }; } }
class FakeDialog extends FakeElement { constructor() { super(); this.returnValue = 42; } }
globalThis.Element = FakeElement;
globalThis.HTMLDialogElement = FakeDialog;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "x".repeat(257), languages: ["en"] } });
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = callback => callback(Number.NaN);
${source}
for (const operation of [
  () => environment(),
  () => measure(new FakeElement()),
  () => dialogResult(new FakeDialog()),
  () => frame(),
]) {
  try { await operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\nTypeError\nTypeError\nTypeError\n");
});

test("file helpers reject forged files and hostile options before native effects", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let getterReads = 0;
let nativeCalls = 0;
globalThis.document = {
  createElement() { nativeCalls += 1; return {}; },
  body: { append() { nativeCalls += 1; } },
};
globalThis.Blob = class { constructor() { nativeCalls += 1; } };
globalThis.FileReader = class { constructor() { nativeCalls += 1; } };
globalThis.URL = { createObjectURL() { nativeCalls += 1; return "blob:test"; } };
${source}
const pickerAccessor = Object.defineProperty({}, "accept", { enumerable: true, get() { getterReads += 1; return "text/plain"; } });
const forged = Object.freeze({ name: "fake.txt", size: 1, type: "text/plain", modified: 0 });
const operations = [
  () => pick(pickerAccessor),
  () => pick({ unknown: true }),
  () => pick({ accept: 42 }),
  () => pick({ multiple: "yes" }),
  () => download(42, "data"),
  () => download("file.txt", 42),
  () => download("file.txt", "data", 42),
  () => readText(forged),
  () => readDataUrl(forged),
];
const failures = [];
for (const operation of operations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(getterReads + ":" + nativeCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(9).fill("TypeError").join(",")}\n0:0\n`);
});

test("file reads enforce explicit byte budgets before allocating browser readers", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let textReads = 0;
let readerCalls = 0;
let blobCalls = 0;
const listeners = new Map();
const selected = { name: "large.txt", size: 16 * 1024 * 1024 + 1, type: "text/plain", lastModified: 0, text() { textReads += 1; return Promise.resolve("data"); } };
const input = {
  files: [selected],
  addEventListener(name, listener) { listeners.set(name, listener); },
  remove() {},
  click() { listeners.get("change")(); },
};
globalThis.document = { createElement() { return input; }, body: { append() {} } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.FileReader = class { constructor() { readerCalls += 1; } };
globalThis.Blob = class { constructor() { blobCalls += 1; } };
globalThis.URL = { createObjectURL() { return "blob:test"; } };
${source}
const [file] = await pick();
const failures = [];
for (const operation of [
  () => readText(file),
  () => readText(file, 0),
  () => readDataUrl(file),
  () => download("", "data"),
]) {
  try { await operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log([textReads, readerCalls, blobCalls].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError,RangeError,RangeError,RangeError\n0:0:0\n");
});

test("file picker and reader host results reject instead of hanging or escaping budgets", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let selectedFile = { name: "invalid.txt", size: Number.NaN, type: "text/plain", lastModified: 0 };
let removals = 0;
globalThis.document = {
  createElement() {
    const listeners = new Map();
    return {
      get files() { return [selectedFile]; },
      addEventListener(name, listener) { listeners.set(name, listener); },
      remove() { removals += 1; },
      click() { listeners.get("change")(); },
    };
  },
  body: { append() {} },
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.FileReader = class {
  readAsDataURL() { this.result = "x".repeat(5000); this.onload(); }
};
${source}
try { await pick(); console.log("accepted"); } catch (error) { console.log(error.name); }
selectedFile = { name: "valid.txt", size: 1, type: "text/plain", lastModified: 0, text() { return Promise.resolve("xx"); } };
const [file] = await pick();
try { await readText(file, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
try { await readDataUrl(file, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(removals);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nRangeError\nRangeError\n2\n");
});

test("realtime validates handlers, payloads, and close metadata before native effects", () => {
  const source = standardModuleSource("velar/realtime") ?? "";
  const execution = executeModule(`
let getterReads = 0;
let constructed = 0;
let sent = 0;
let closed = 0;
class FakeSocket {
  static OPEN = 1;
  static CLOSING = 2;
  constructor(url) { constructed += 1; this.url = url; this.readyState = 1; }
  addEventListener() {}
  send() { sent += 1; }
  close() { closed += 1; this.readyState = 3; }
}
class FakeEventSource {
  constructor(url) { constructed += 1; this.url = url; this.readyState = 1; }
  addEventListener() {}
  close() { closed += 1; }
}
globalThis.WebSocket = FakeSocket;
globalThis.EventSource = FakeEventSource;
${source}
const handlerAccessor = Object.defineProperty({}, "message", { enumerable: true, get() { getterReads += 1; return () => null; } });
const invalidOperations = [
  () => socket(42),
  () => socket("wss://example.test", handlerAccessor),
  () => socket("wss://example.test", { unknown() {} }),
  () => eventStream(42),
  () => eventStream("https://example.test", {}, "yes"),
];
const failures = [];
for (const operation of invalidOperations) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
const channel = socket("wss://example.test");
for (const operation of [
  () => channel.send(42),
  () => channel.sendJson(new Map([["value", 1]])),
  () => channel.close(2000),
  () => channel.close(1000, "x".repeat(124)),
]) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log([getterReads, constructed, sent, closed].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,RangeError,RangeError\n0:1:0:0\n");
});

test("realtime closes oversized inbound messages and rejects oversized sends", () => {
  const source = standardModuleSource("velar/realtime") ?? "";
  const execution = executeModule(`
let socketValue;
let streamValue;
let sent = 0;
let socketClosed = "";
let streamClosed = 0;
class FakeSocket {
  static OPEN = 1;
  static CLOSING = 2;
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); socketValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  send() { sent += 1; }
  close(code, reason) { socketClosed = code + ":" + reason; this.readyState = 3; }
}
class FakeEventSource {
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); streamValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  close() { streamClosed += 1; this.readyState = 2; }
}
globalThis.WebSocket = FakeSocket;
globalThis.EventSource = FakeEventSource;
${source}
let socketErrors = 0;
let socketMessages = 0;
const channel = socket("wss://example.test", { message() { socketMessages += 1; }, error() { socketErrors += 1; } });
const tooLarge = "x".repeat(16 * 1024 * 1024 + 1);
try { channel.send(tooLarge); console.log("accepted"); } catch (error) { console.log(error.name); }
socketValue.listeners.get("message")({ data: tooLarge });
let streamErrors = 0;
const stream = eventStream("https://example.test", { error() { streamErrors += 1; } });
streamValue.listeners.get("message")({ data: tooLarge, lastEventId: "" });
const metadataStream = eventStream("https://example.test", { error() { streamErrors += 1; } });
streamValue.listeners.get("message")({ data: "small", lastEventId: "x".repeat(65537) });
console.log([sent, socketErrors, socketMessages, socketClosed, streamErrors, streamClosed].join("|"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\n0|1|0|1009:Message too large|2|2\n");
});

test("browser npm assets cannot escape a package through symbolic links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-npm-asset-"));
  const root = join(directory, "package");
  await mkdir(root);
  await writeFile(join(root, "inside.js"), "export const safe = true\n", "utf8");
  await writeFile(join(directory, "outside.js"), "export const escaped = true\n", "utf8");
  await symlink(join(root, "inside.js"), join(root, "inside-link.js"));
  await symlink(join(directory, "outside.js"), join(root, "outside-link.js"));
  const packages = [{ name: "package", root, route: "/@npm/package/", entryRoute: "/@npm/package/inside.js" }];
  assert.equal((await npmAsset(packages, "/@npm/package/inside-link.js"))?.path, await realpath(join(root, "inside.js")));
  assert.equal(await npmAsset(packages, "/@npm/package/outside-link.js"), null);
});

test("List boundaries reject accessor elements without invoking them", () => {
  const collections = standardModuleSource("velar/collections") ?? "";
  const collectionsExecution = executeModule(`
let reads = 0;
const values = [];
Object.defineProperty(values, 0, { enumerable: true, get() { reads += 1; return 1; } });
values.length = 1;
${collections}
try { sum(values); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(reads);
`);
  assert.equal(collectionsExecution.status, 0, String(collectionsExecution.stderr));
  assert.equal(collectionsExecution.stdout, "TypeError\n0\n");

  const result = compile(`
export type Payload:
    values: List<number>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const typeExecution = executeModule(`${result.code}
let reads = 0;
const values = [];
Object.defineProperty(values, 0, { enumerable: true, get() { reads += 1; return 1; } });
values.length = 1;
console.log(Payload.is({ values }));
console.log(reads);
`);
  assert.equal(typeExecution.status, 0, String(typeExecution.stderr));
  assert.equal(typeExecution.stdout, "false\n0\n");
});

test("0.6 Web APIs reject invalid typed boundaries before browser execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-web-api-invalid-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {formBody, http} from "velar/http"
import {storage} from "velar/storage"
import {after, blur, every, focus, showDialog, scrollTo} from "velar/browser"
import {readText} from "velar/files"
import {socket} from "velar/realtime"
import {onError, reportError} from "velar/app"
import {publicConfig} from "velar/config"
import {RouteContext, Router as WebRouter, route} from "velar/web"
import {read, textValue} from "velar/forms"

type NestedValue:
    label: string

type UnsupportedForm:
    nested: NestedValue

def numericMessage(value: number):
    print(value)

component WrongRoute(route: number, required: string):
    return <p>{route}</p>

component GoodRoute(route: RouteContext):
    return <p>{route.path}</p>

component Router(fallback: string):
    return <p>{fallback}</p>

component BrokenRouterFallbacks:
    return <><WebRouter routes={[route("/", GoodRoute)]} fallback="missing" /><WebRouter routes={[route("/", GoodRoute)]} fallback={WrongRoute} /><Router fallback="local" /></>

component WrongDialog:
    let dialog: DialogElement? = none
    let form: Element? = none
    def inspect():
        if form:
            const unsupported = read(form, UnsupportedForm)
    return <div ref={dialog}>Not a dialog</div>

def openWrongDialog(element: Element):
    showDialog(element)

const response = await http.get("/items").parse(42)
const saved = storage.get("item", 42)
scrollTo("left", 0)
const content = await readText({name: "missing"})
const channel = socket("wss://example.com", {message: numericMessage})
const config = publicConfig(42)
const stop = onError(numericMessage)
reportError("failure")
const upload = formBody()
upload.field("count", 1)
upload.file("file", {name: "fake"})
const invalidPattern = route("items/:id/*/more", WrongRoute)
const invalidQueryPattern = route("/items?view=all", GoodRoute)
const invalidHashPattern = route("/items#top", GoodRoute)
const invalidTrailingPattern = route("/items/", GoodRoute)
const invalidEmptySegment = route("/items//detail", GoodRoute)
const invalidPartialWildcard = route("/items/file*", GoodRoute)
const invalidWildcardName = route("/:wildcard/*", GoodRoute)
const invalidComponent = route("/items", 42)
const invalidFallback = textValue({name: "form"}, "name", 42)
const invalidAfter = after("soon", () => none)
const invalidEvery = every(1, 42)
focus("missing")
blur("missing")
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message).join("\n");
  assert.match(messages, /Runtime parsing requires a Velar runtime type/u);
  assert.match(messages, /Cannot assign string to number/u);
  assert.match(messages, /Cannot assign \{ name: string \} to \{ name: string, size: number, type: string, modified: number \}/u);
  assert.match(messages, /Cannot assign Element to DialogElement/u);
  assert.match(messages, /A <div> ref requires Element/u);
  assert.match(messages, /A route path must start with/u);
  assert.match(messages, /route wildcard must be the final segment/u);
  assert.match(messages, /route path describes only a pathname/u);
  assert.match(messages, /route path cannot end with/u);
  assert.match(messages, /route path cannot contain an empty segment/u);
  assert.match(messages, /route wildcard must occupy its whole final segment/u);
  assert.match(messages, /parameter named 'wildcard' conflicts/u);
  assert.match(messages, /cannot require props other than route/u);
  assert.match(messages, /route prop must accept RouteContext/u);
  assert.match(messages, /A route requires a component/u);
  assert.match(messages, /A Router fallback requires a component, received string/u);
  assert.match(messages, /A Router fallback component cannot require props other than route: required/u);
  assert.match(messages, /A Router fallback component's route prop must accept RouteContext/u);
  assert.match(messages, /Cannot assign.*message.*number.*message.*string/u);
  assert.match(messages, /Runtime parsing requires a Velar runtime type/u);
  assert.match(messages, /Cannot assign.*number.*error.*Error/u);
  assert.match(messages, /Cannot assign string to Error/u);
  assert.match(messages, /Cannot assign number to string/u);
  assert.match(messages, /Cannot assign \{ name: string \} to \{ name: string, size: number, type: string, modified: number \}/u);
  assert.match(messages, /Form field 'nested' cannot decode NestedValue/u);
  assert.match(messages, /Cannot assign number to \(\) -> unknown/u);
});

test("typed form reads preserve record aliases and enum fields across modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-form-record-"));
  const typesPath = join(directory, "form-types.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(typesPath, `
export enum AccessLevel:
    member
    admin

export type SignupDraft:
    name: string
    age: number?
    subscribed: bool
    roles: List<string>
    access: AccessLevel

export type SignupForm = SignupDraft
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {SignupForm} from "./form-types.vel"
import {read} from "velar/forms"

component Signup:
    let form: Element? = none
    def submit():
        if form:
            const draft = read(form, SignupForm)
            print(draft.name)
    return <form ref={form} on:submit.prevent={submit}><input name="name" /></form>
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const main = project.modules.find((module) => module.inputPath === mainPath)?.result;
  assert.equal(main?.semanticIndex.symbols.find((item) => item.name === "draft")?.type, "SignupForm");
  assert.match(main?.code ?? "", /"name":"access","kind":"enum","optional":false,"enumValues":\["member","admin"\]/u);
});

test("compiler-known runtime Type identity crosses modules and accepts records, aliases, and enums", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-runtime-type-identity-"));
  const typesPath = join(directory, "types.vel");
  const mainPath = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(typesPath, `
export type Item:
    value: number

export type ItemPayload = Item

export enum ItemState:
    ready
    done
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {parse} from "velar/json"
import {ItemPayload, ItemState} from "./types.vel"

const item = parse("{\\"value\\":7}", ItemPayload)
const status = parse("\\"ready\\"", ItemState)
print(item.value)
print(status == ItemState.ready)
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(build.status, 0, String(build.stderr));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "7\ntrue\n");
});

test("0.4 Core standard library combines typed Python ergonomics with explicit JavaScript semantics", async () => {
  const api = standardModuleApi();
  assert.deepEqual(Object.keys(api.modules), [
    "velar/collections", "velar/text", "velar/math", "velar/json", "velar/async", "velar/url", "velar/time", "velar/id", "velar/log",
    "velar/app", "velar/config", "velar/web", "velar/http", "velar/storage", "velar/forms", "velar/browser", "velar/files", "velar/realtime", "velar/test",
  ]);
  assert.equal(Object.values(api.modules).reduce((total, exports_) => total + exports_.length, 0), 201);
  assert.equal(Object.values(api.modules).slice(0, 9).reduce((total, exports_) => total + exports_.length, 0), 133);
  assert.equal(api.modules["velar/collections"]?.length, 28);
  assert.equal(api.modules["velar/text"]?.length, 30);
  assert.equal(api.modules["velar/math"]?.length, 36);
  assert.deepEqual(api.modules["velar/json"], ["clone", "deepEqual", "isSerializable", "parse", "stableStringify", "stringify", "tryParse"]);
  assert.deepEqual(api.modules["velar/async"], ["all", "map", "race", "retry", "series", "sleep", "timeout"]);
  assert.deepEqual(api.modules["velar/url"], ["decode", "encode", "isExternal", "join", "normalize", "parse", "parseQuery", "query", "withHash", "withQuery"]);
  assert.deepEqual(api.modules["velar/time"], ["date", "format", "iso", "monotonic", "now", "parse", "parts", "utc"]);
  assert.deepEqual(api.modules["velar/id"], ["isUuid", "uuid"]);
  assert.deepEqual(api.modules["velar/log"], ["level", "log", "logger", "setLevel", "useSink"]);

  const directory = await mkdtemp(join(tmpdir(), "velar-standard-library-"));
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {all, chunk, compact, enumerate, find, flatten, groupBy, join as joinItems, partition, range, repeat as repeatValue, sortBy, sum, unique, zip} from "velar/collections"
import {capitalize, escapeHtml, findMatch, findMatches, isBlank, lines, lower, matches, normalizeWhitespace, replaceMatches, slug, splitPattern, title, truncate, upper, words} from "velar/text"
import {clamp, degrees, gcd, lcm, max as maxNumber, min as minNumber, pi, radians, round} from "velar/math"
import {clone as cloneJson, deepEqual, parse as parseJson, stableStringify, stringify, tryParse} from "velar/json"
import {all as allAsync, map as asyncMap, retry, series, sleep, timeout} from "velar/async"
import {decode, encode, isExternal, join as joinUrl, parse as parseUrl, parseQuery, query, withHash, withQuery} from "velar/url"
import {iso, parse as parseTime, parts, utc} from "velar/time"
import {level as logLevel, log, logger, setLevel, useSink} from "velar/log"

type User:
    name: string
    role: string

const users: List<User> = [
    {name: "Ada", role: "admin"},
    {name: "Lin", role: "member"},
    {name: "Bea", role: "admin"},
]
const values = range(1, 6)
const indexed = enumerate(values, 10)
const pairs = zip(values, repeatValue("x", 5))
const grouped = groupBy(users, user => user.role)
const ordered = sortBy(users, user => user.name)
const splitUsers = partition(users, user => user.role == "admin")
const found = find(users, user => user.name == "Lin")
const maybe: List<string?> = ["a", none, "b"]
print(sum(values))
print(indexed[0].index)
print(pairs[0].second)
print(grouped.get("admin")?.length ?? 0)
print(ordered[0].name)
print(splitUsers.rest.length)
print(found?.name ?? "missing")
print(joinItems(compact(maybe), ","))
print(flatten(chunk(values, 2)).length)
print(unique([1, 1, 2]).length)
print(all(values, value => value > 0))

print(capitalize("vELAR"))
print(title("next_generation web"))
print(slug("  Velar Web 游戏  "))
print(truncate("VelarScript", 6))
print(normalizeWhitespace("  a   b  "))
print(lines("a\\nb").length)
print(words("a  b").length)
print(lower("ABC"))
print(upper("abc"))
print(isBlank("   "))
print(escapeHtml("<velar>"))
print(matches("Velar 42", "^velar [0-9]+$", {ignoreCase: true}))
const firstPatternMatch = findMatch("ticket-42", "[0-9]+")
print(firstPatternMatch?.value ?? "missing")
print(firstPatternMatch?.index ?? -1)
const patternMatches = findMatches("a1 b22", "([a-z])([0-9]+)")
print(patternMatches.length)
print(patternMatches[1].groups[1] ?? "missing")
print(replaceMatches("a1 b22", "[0-9]+", "#"))
print(joinItems(splitPattern("a, b; c", " *[,;] *"), "|"))
print(matches("first\\nlast", "^last$", {multiline: true}))
print(matches("a\\nb", "^a.b$", {dotAll: true}))
const optionalPatternMatch = findMatch("b", "(a)?b")
print(optionalPatternMatch?.groups[0] ?? "none")
print(replaceMatches("x1", "[0-9]", "$&"))
print(joinItems(splitPattern("a1b", "([0-9])"), "|"))
try:
    matches("42", "[0-9]+", {sticky: true})
catch error:
    print(error.name)
try:
    matches("value", "[")
catch error:
    print(error.name)

print(round(pi, 2))
print(clamp(12, 0, 10))
print(minNumber(4, 2, 8))
print(maxNumber(4, 2, 8))
print(round(degrees(radians(90))))
print(gcd(18, 12))
print(lcm(6, 8))

const parsed = parseJson("{\\"name\\":\\"Nova\\",\\"role\\":\\"admin\\"}", User)
const copied = cloneJson(parsed, User)
print(copied.name)
print(tryParse("bad", User)?.name ?? "fallback")
print(stableStringify({z: 1, a: 2}))
print(stringify([1, 2]))
print(deepEqual(parsed, copied))
print(deepEqual(parsed, {name: "Nova", role: "member"}))

async def double(value: number) -> number:
    return value * 2

def ready() -> number:
    return 7

const doubled = await asyncMap([1, 2, 3], double, 2)
const waited = await allAsync([sleep(1), sleep(1)])
const retried = await retry(ready, 2)
const serial = await series([ready, ready])
await timeout(sleep(1), 100)
print(doubled[2])
print(waited.length)
print(retried)
print(serial.length)

const info = parseUrl("/items?page=1", "https://example.com/app/")
print(info.path)
print(parseQuery("?page=2").get("page") ?? "none")
print(query({page: 3}))
print(withQuery("/items", {page: 4}))
print(withHash("/items", "top"))
print(joinUrl("https://example.com", "api", "users"))
print(decode(encode("Velar 游戏")))
print(isExternal("https://other.example", "https://example.com"))
const timestamp = utc(2024, 1, 2, 3, 4, 5)
print(iso(timestamp))
print(parts(timestamp, "UTC").year)
print(parseTime("invalid") == none)
const stopLog = useSink(record => print(f"{record.level}:{record.scope}:{record.message}"))
setLevel("debug")
logger("core").info("ready")
log.debug("trace")
stopLog()
print(logLevel())
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  assert.equal(await readFile(join(output, "node_modules", "velar", "package.json"), "utf8").then((value) => JSON.parse(value).type), "module");
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "15", "10", "x", "2", "Ada", "1", "Lin", "a,b", "5", "2", "true",
    "Velar", "Next Generation Web", "velar-web-游戏", "Velar…", "a b", "2", "2", "abc", "ABC", "true", "&lt;velar&gt;",
    "true", "42", "7", "2", "22", "a# b#", "a|b|c", "true", "true", "none", "x$&", "a|b", "TypeError", "TypeError",
    "3.14", "10", "2", "8", "90", "6", "24",
    "Nova", "fallback", '{"a":2,"z":1}', "[1,2]", "true", "false",
    "6", "2", "7", "2",
    "/items", "2", "page=3", "/items?page=4", "/items#top", "https://example.com/api/users", "Velar 游戏", "true",
    "2024-01-02T03:04:05.000Z", "2024", "true", "info:core:ready", "debug::trace", "debug",
    "",
  ].join("\n"));
});

test("every declared standard-module export exists in the shipped runtime", async () => {
  const api = standardModuleApi();
  for (const [source, expected] of Object.entries(api.modules)) {
    const runtime = standardModuleSource(source);
    assert.ok(runtime, `missing runtime source for ${source}`);
    const url = `data:text/javascript;base64,${Buffer.from(runtime, "utf8").toString("base64")}`;
    const namespace = await import(url) as Record<string, unknown>;
    assert.deepEqual(Object.keys(namespace).sort(), expected, `${source} type/runtime export drift`);
  }
});

test("velar/json deepEqual compares owned structures without recursive graph failure", () => {
  const source = standardModuleSource("velar/json") ?? "";
  const execution = executeModule(`${source}
const left = { name: "Velar", nested: [1, { ready: true }] };
const right = { nested: [1, { ready: true }], name: "Velar" };
console.log(deepEqual(left, right));
console.log(deepEqual(left, { name: "Velar", nested: [1, { ready: false }] }));
console.log(deepEqual(new Map([["item", { value: 1 }]]), new Map([["item", { value: 1 }]])));
console.log(deepEqual(new Set(["a", "b"]), new Set(["b", "a"])));
class Box { constructor(value) { this.value = value; } }
const box = new Box(1);
console.log(deepEqual(box, box));
console.log(deepEqual(box, new Box(1)));
const shared = { value: 1 };
console.log(deepEqual({ first: shared, second: shared }, { first: { value: 1 }, second: { value: 1 } }));
const cycleA = {}; cycleA.self = cycleA;
const cycleB = {}; cycleB.self = cycleB;
console.log(deepEqual(cycleA, cycleB));
console.log(deepEqual(cycleA, cycleA));
const sparseA = []; sparseA.length = 1;
const sparseB = []; sparseB.length = 1;
console.log(deepEqual(sparseA, sparseB));
let getterReads = 0;
const getterA = {}, getterB = {};
Object.defineProperty(getterA, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
Object.defineProperty(getterB, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
console.log(deepEqual(getterA, getterB));
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\ntrue\ntrue\ntrue\nfalse\ntrue\nfalse\ntrue\nfalse\nfalse\n0\n");
});

test("velar/test toEqual uses the language deepEqual contract", () => {
  const source = standardModuleSource("velar/test") ?? "";
  const execution = executeModule(`${source}
function passes(callback) { try { callback(); return true; } catch { return false; } }
console.log(passes(() => expect({ value: [1, 2] }).toEqual({ value: [1, 2] })));
const sparseA = []; sparseA.length = 1;
const sparseB = []; sparseB.length = 1;
console.log(passes(() => expect(sparseA).toEqual(sparseB)));
class Box { constructor(value) { this.value = value; } }
const box = new Box(1);
console.log(passes(() => expect(box).toEqual(new Box(1))));
console.log(passes(() => expect(box).toEqual(box)));
console.log(passes(() => expect(new Map([["item", { value: 1 }]])).toEqual(new Map([["item", { value: 1 }]]))));
console.log(passes(() => expect(new Set(["a"])).toEqual(new Set(["a"]))));
console.log(passes(() => expect(new Set(["a"])).toEqual(new Set(["b"]))));
const cycleA = {}; cycleA.self = cycleA;
const cycleB = {}; cycleB.self = cycleB;
console.log(passes(() => expect(cycleA).toEqual(cycleB)));
console.log(passes(() => expect(cycleA).toEqual(cycleA)));
let getterReads = 0;
const getterA = {}, getterB = {};
Object.defineProperty(getterA, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
Object.defineProperty(getterB, "value", { enumerable: true, get() { getterReads += 1; return 1; } });
console.log(passes(() => expect(getterA).toEqual(getterB)));
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\ntrue\ntrue\ntrue\nfalse\nfalse\ntrue\nfalse\n0\n");
});

test("velar/test matchers cannot turn invalid subjects into false positives", async () => {
  const source = standardModuleSource("velar/test") ?? "";
  const execution = executeModule(`${source}
function passes(callback) { try { callback(); return true; } catch { return false; } }
async function passesAsync(callback) { try { await callback(); return true; } catch { return false; } }
console.log(passes(() => expect(-0).toBe(0)), passes(() => expect(NaN).toBe(NaN)));
console.log(passes(() => expect(true).toBeTruthy()), passes(() => expect(1).toBeTruthy()));
console.log(passes(() => expect(false).toBeFalsy()), passes(() => expect("").toBeFalsy()));
console.log(passes(() => expect([-0]).toContain(0)), passes(() => expect([NaN]).toContain(NaN)));
const sparse = []; sparse.length = 1;
console.log(passes(() => expect(sparse).toHaveLength(1)));
console.log(passes(() => expect("Velar").toMatch("^Vel")), passes(() => expect("Velar").toMatch(42)));
console.log(passes(() => expect(() => { throw new Error("expected"); }).toThrow()), passes(() => expect(42).toThrow()));
console.log(await passesAsync(() => expect(Promise.reject(new Error("expected"))).toReject()));
console.log(await passesAsync(() => expect(() => Promise.reject(new Error("expected"))).toReject()));
console.log(await passesAsync(() => expect(() => { throw new Error("sync"); }).toReject()));
console.log(await passesAsync(() => expect(Promise.resolve(1)).toReject()));
console.log(await passesAsync(() => expect(42).toReject()));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true false", "true false", "true false", "true false", "false",
    "true false", "true false", "true", "true", "false", "false", "false", "",
  ].join("\n"));

  const directory = await mkdtemp(join(tmpdir(), "velar-test-matchers-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {expect} from "velar/test"

def value() -> number:
    return 1

expect(1).toMatch("1")
expect("value").toThrow()
expect(true).toHaveLength(1)
expect(value).toReject()
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.deepEqual(invalid.failures, []);
  const matcherDiagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(matcherDiagnostics.filter((item) => /has no field/u.test(item.message)).length, 4, JSON.stringify(matcherDiagnostics));
});

test("velar/time rejects JavaScript date rollover and parses deterministic ISO input", () => {
  const source = standardModuleSource("velar/time") ?? "";
  const execution = executeModule(`${source}
console.log(iso(utc(2024, 2, 29, 3, 4, 5)));
console.log(iso(utc(24, 1, 2)));
console.log(iso(parse("2024-01-02T03:04:05.6+02:30")));
console.log(parse("2024-02-29") === utc(2024, 2, 29));
const local = parts(date(2024, 1, 2, 3, 4, 5));
console.log([local.year, local.month, local.day, local.hour, local.minute, local.second].join("-"));
for (const value of ["2023-02-29", "2024-13-01", "2024-01-02T03:04", "2024-01-02T03:04Z+01:00", "2024-01-02T03:04+24:00", "January 2 2024"]) console.log(parse(value) === null);
for (const parts of [[2024, 2, 30], [2024, 0, 1], [2024, 1, 1, 24]]) {
  try { utc(...parts); console.log("accepted"); } catch (error) { console.log(error.name); }
}
try { parse(42); console.log("accepted"); } catch (error) { console.log(error.name); }
try { format(utc(2024, 1, 1), 42); console.log("accepted"); } catch (error) { console.log(error.name); }
try { parts(utc(2024, 1, 1), 42); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "2024-02-29T03:04:05.000Z",
    "0024-01-02T00:00:00.000Z",
    "2024-01-02T00:34:05.600Z",
    "true",
    "2024-1-2-3-4-5",
    "true", "true", "true", "true", "true", "true",
    "RangeError", "RangeError", "RangeError", "TypeError", "TypeError", "TypeError", "",
  ].join("\n"));
});

test("collection ordering, predicates, equality, and List boundaries follow Velar semantics", async () => {
  const source = standardModuleSource("velar/collections") ?? "";
  const execution = executeModule(`${source}
const values = [{ id: "a", key: 1 }, { id: "b", key: 2 }, { id: "c", key: 2 }, { id: "d", key: 1 }];
console.log(sortBy(values, value => value.key).map(value => value.id).join(""));
console.log(sortBy(values, value => value.key, true).map(value => value.id).join(""));
console.log(contains([-0], 0), count([-0], 0), contains([NaN], NaN), count([NaN], NaN));
for (const operation of [
  () => any([1], () => "yes"),
  () => partition([1], () => 1),
  () => sortBy([1, 2], value => value === 1 ? "one" : 2),
  () => sortBy([1], () => NaN),
  () => range(1e20, 1e20 + 65536, 1),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
const sparse = []; sparse.length = 1;
const extended = [1]; extended.label = "hidden";
for (const list of [sparse, extended]) {
  try { take(list, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "adbc", "bcad", "true 1 false 0",
    "TypeError", "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "",
  ].join("\n"));

  const directory = await mkdtemp(join(tmpdir(), "velar-collection-keys-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {maxBy, minBy, sortBy} from "velar/collections"

const sorted = sortBy([1], value => true)
const lowest = minBy([1], value => none)
const highest = maxBy([1], value => {label: "one"})
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.deepEqual(invalid.failures, []);
  assert.equal(invalid.modules.flatMap((module) => module.result.diagnostics).filter((item) => /key must return only string or only number/u.test(item.message)).length, 3);
});

test("async and URL helpers reject malformed Lists at dynamic boundaries", () => {
  const asyncSource = standardModuleSource("velar/async") ?? "";
  const asyncExecution = executeModule(`${asyncSource}
const sparse = []; sparse.length = 1;
const extended = [Promise.resolve(1)]; extended.label = "hidden";
for (const [name, callback] of [["all", () => all(sparse)], ["race", () => race(extended)], ["map", () => map(sparse, value => value)], ["series", () => series(extended)]]) {
  try { await callback(); console.log("accepted"); } catch (error) { console.log(name, error.name); }
}
try { await timeout(Promise.resolve(1), 1, 42); console.log("accepted"); } catch (error) { console.log("timeout", error.name); }
try { await retry(() => 1, Number.MAX_SAFE_INTEGER + 1); console.log("accepted"); } catch (error) { console.log("retry", error.name); }
`);
  assert.equal(asyncExecution.status, 0, String(asyncExecution.stderr));
  assert.equal(asyncExecution.stdout, "all TypeError\nrace TypeError\nmap TypeError\nseries TypeError\ntimeout TypeError\nretry RangeError\n");

  const urlSource = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`${urlSource}
const sparse = []; sparse.length = 1;
console.log(join("https://", "example.test", "api", "items"));
console.log(query({ flag: true, page: 2, empty: null, tag: ["a", "b"] }));
for (const operation of [
  () => query({ tag: sparse }),
  () => query({ filter: { active: true } }),
  () => query(new Map([[1, "value"]])),
  () => parseQuery(42),
  () => encode(42),
  () => withHash("/items", 42),
  () => isExternal(42),
  () => join("/items", 42),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, [
    "https://example.test/api/items",
    "flag=true&page=2&tag=a&tag=b",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "",
  ].join("\n"));
});

test("velar/math never reintroduces JavaScript numeric coercion", () => {
  const source = standardModuleSource("velar/math") ?? "";
  const execution = executeModule(`${source}
console.log(round(1.005, 2));
console.log(round(1234, -2));
console.log(round(Number.MAX_VALUE, 308) === Number.MAX_VALUE);
console.log(gcd(54, 24), lcm(6, 8));
for (const operation of [
  () => abs("2"),
  () => min(1, "2"),
  () => clamp(1, "0", 2),
  () => pow(2, "3"),
  () => hypot([], 2),
  () => round(1, 309),
  () => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  () => gcd(2.5, 1),
  () => lcm(Number.MAX_SAFE_INTEGER, 2),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "1.01", "1200", "true", "6 24",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    "RangeError", "RangeError", "TypeError", "RangeError", "",
  ].join("\n"));
});

test("velar/log validates dynamic inputs and isolates sink snapshots", () => {
  const source = standardModuleSource("velar/log") ?? "";
  const execution = executeModule(`${source}
const seen = [];
const stopFirst = useSink(record => {
  seen.push("first:" + record.message + ":" + record.fields.get("source"));
  record.fields.set("source", "mutated");
});
const stopSecond = useSink(record => seen.push("second:" + record.message + ":" + record.fields.get("source")));
logger("build", new Map([["source", "compiler"]])).info("ready");
stopFirst(); stopFirst(); stopSecond();
console.log(seen.join("|"));
setLevel("DEBUG");
console.log(level());
for (const operation of [
  () => logger(42),
  () => logger("build", new Map([[1, "value"]])),
  () => setLevel(1),
  () => log.info(42),
  () => log.debug("message", new Map([[1, "value"]])),
  () => log.error("failed", "not an error"),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "first:ready:compiler|second:ready:compiler",
    "debug",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "",
  ].join("\n"));
});

test("velar/text rejects native count coercion and accessor options", () => {
  const source = standardModuleSource("velar/text") ?? "";
  const execution = executeModule(`${source}
console.log(padStart("7", 3, "0"));
console.log(truncate("VelarScript", 6));
let getterReads = 0;
const options = {};
Object.defineProperty(options, "ignoreCase", { enumerable: true, get() { getterReads += 1; return true; } });
for (const operation of [
  () => repeat("x", "2"),
  () => padStart("x", "3"),
  () => padEnd("x", -1),
  () => truncate("x", Number.MAX_SAFE_INTEGER + 1),
  () => matches("Velar", "velar", options),
  () => matches("Velar", "velar", new (class PatternOptions { constructor() { this.ignoreCase = true; } })()),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "007", "Velar…",
    "RangeError", "RangeError", "RangeError", "RangeError", "TypeError", "TypeError", "0", "",
  ].join("\n"));
});

test("standard modules bound pathological allocation and timer inputs before effects", () => {
  const collections = standardModuleSource("velar/collections") ?? "";
  const collectionExecution = executeModule(`${collections}
const oversized = []; oversized.length = 1000001;
for (const operation of [() => repeat("item", 1000001), () => sum(oversized)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(collectionExecution.status, 0, String(collectionExecution.stderr));
  assert.equal(collectionExecution.stdout, "RangeError\nRangeError\n");

  const text = standardModuleSource("velar/text") ?? "";
  const textExecution = executeModule(`${text}
for (const operation of [() => repeat("ab", 9000000), () => padStart("x", 20000000), () => split("x".repeat(1000001), "")]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(textExecution.status, 0, String(textExecution.stderr));
  assert.equal(textExecution.stdout, "RangeError\nRangeError\nRangeError\n");

  const json = standardModuleSource("velar/json") ?? "";
  const jsonExecution = executeModule(`${json}
let nested = {};
for (let index = 0; index < 129; index += 1) nested = { next: nested };
let getterReads = 0;
const accessorList = [];
Object.defineProperty(accessorList, 0, { enumerable: true, get() { getterReads += 1; return 1; } });
accessorList.length = 1;
for (const operation of [() => stringify(nested), () => stringify("\\u0000".repeat(3000000)), () => stringify(accessorList)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
`);
  assert.equal(jsonExecution.status, 0, String(jsonExecution.stderr));
  assert.equal(jsonExecution.stdout, "TypeError\nTypeError\nTypeError\n0\n");

  const url = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`${url}
let getterReads = 0;
const accessor = Object.defineProperty({}, "page", { enumerable: true, get() { getterReads += 1; return 1; } });
for (const operation of [() => query(accessor), () => query(new Map([["value", "x".repeat(300000)]]))]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, "TypeError\nRangeError\n0\n");

  const asyncModule = standardModuleSource("velar/async") ?? "";
  const asyncExecution = executeModule(`${asyncModule}
const operations = new Array(10001).fill(Promise.resolve(null));
for (const operation of [() => all(operations), () => race(operations), () => timeout(Promise.resolve(null), 1, "x".repeat(65537))]) {
  try { await operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(asyncExecution.status, 0, String(asyncExecution.stderr));
  assert.equal(asyncExecution.stdout, "RangeError\nRangeError\nRangeError\n");

  const browser = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`let timerCalls = 0;
globalThis.setTimeout = () => { timerCalls += 1; return 1; };
${browser}
try { after(2147483648, () => null); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(timerCalls);
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "RangeError\n0\n");

  const http = standardModuleSource("velar/http") ?? "";
  const httpExecution = executeModule(`${http}
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; return new Response("{}"); };
for (const operation of [
  () => http.get("/", { timeout: 2147483648 }),
  () => http.get("/", { headers: new Map([["x-large", "x".repeat(65537)]]) }),
  () => http.get("/", { maxBytes: 64 * 1024 * 1024 + 1 }),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(fetchCalls);
`);
  assert.equal(httpExecution.status, 0, String(httpExecution.stderr));
  assert.equal(httpExecution.stdout, "RangeError\nRangeError\nRangeError\n0\n");
});

test("logging, error handlers, time, and IDs keep bounded service inputs", () => {
  const logging = standardModuleSource("velar/log") ?? "";
  const loggingExecution = executeModule(`${logging}
let iteratorCalls = 0;
class HostileMap extends Map { entries() { iteratorCalls += 1; return super.entries(); } [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); } }
const records = [];
const stop = useSink(record => records.push(record));
logger("app", new HostileMap([["ready", true]])).info("started");
stop();
const oversizedFields = new Map();
for (let index = 0; index <= 1000; index += 1) oversizedFields.set("field" + index, index);
for (const operation of [
  () => logger("x".repeat(1025)),
  () => log.info("x".repeat(65537)),
  () => logger("app", oversizedFields),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(records.length + ":" + iteratorCalls);
`);
  assert.equal(loggingExecution.status, 0, String(loggingExecution.stderr));
  assert.equal(loggingExecution.stdout, "RangeError\nRangeError\nRangeError\n1:0\n");

  const app = standardModuleSource("velar/app") ?? "";
  const appExecution = executeModule(`${app}
const stops = [];
for (let index = 0; index < 1000; index += 1) stops.push(onError(() => null));
for (const operation of [
  () => onError(() => null),
  () => reportError(new Error("failure"), "x".repeat(257)),
  () => reportError(new Error("failure"), "manual", "x".repeat(65537)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
for (const stop of stops) stop();
`);
  assert.equal(appExecution.status, 0, String(appExecution.stderr));
  assert.equal(appExecution.stdout, "RangeError\nRangeError\nRangeError\n");

  const time = standardModuleSource("velar/time") ?? "";
  const id = standardModuleSource("velar/id") ?? "";
  const scalarExecution = executeModule(`${time}\n${id}
console.log(parse("x".repeat(100000)) === null);
console.log(isUuid("x".repeat(100000)));
try { format(0, "x".repeat(1025)); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(scalarExecution.status, 0, String(scalarExecution.stderr));
  assert.equal(scalarExecution.stdout, "true\nfalse\nRangeError\n");
});

test("application error and public-config entry points fail closed", () => {
  const appSource = standardModuleSource("velar/app") ?? "";
  const appExecution = executeModule(`${appSource}
const reports = [];
const stop = onError(report => reports.push(report.phase + ":" + report.detail + ":" + report.error.message));
reportError(new Error("expected"), "manual", "test");
stop(); stop();
console.log(reports.join("|"));
for (const operation of [() => reportError("failed"), () => reportError(new Error("failed"), 42), () => reportError(new Error("failed"), "manual", 42)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(appExecution.status, 0, String(appExecution.stderr));
  assert.equal(appExecution.stdout, "manual:test:expected\nTypeError\nTypeError\nTypeError\n");

  const configSource = standardModuleSource("velar/config", { base: "/", publicConfig: { apiBase: "/api" } }) ?? "";
  const configExecution = executeModule(`${configSource}
const Config = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
console.log(publicConfig(Config).apiBase, has("apiBase"));
let runtimeTypeReads = 0;
const forged = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { runtimeTypeReads += 1; return value => value; } });
for (const operation of [() => publicConfig({}), () => publicConfig(forged), () => has(42)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(runtimeTypeReads);
`);
  assert.equal(configExecution.status, 0, String(configExecution.stderr));
  assert.equal(configExecution.stdout, "/api true\nTypeError\nTypeError\nTypeError\n0\n");
});

test("JSON, storage, HTTP, and realtime reject lossy JavaScript serialization", () => {
  const json = standardModuleSource("velar/json") ?? "";
  const jsonExecution = executeModule(`${json}
const shared = { value: 1 };
const cycle = {}; cycle.self = cycle;
const sparse = []; sparse.length = 1;
class Box { constructor(value) { this.value = value; } }
let runtimeTypeReads = 0;
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { runtimeTypeReads += 1; return value => value; } });
console.log(isSerializable({ first: shared, second: shared }));
console.log(isSerializable(new Map([["value", 1]])));
console.log(isSerializable(new Set([1])));
console.log(isSerializable({ omitted() {} }));
console.log(isSerializable({ value: Infinity }));
console.log(isSerializable(cycle));
console.log(isSerializable(sparse));
console.log(isSerializable(new Box(1)));
try { parse("1e400"); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(tryParse("1e400") === null);
console.log(stableStringify(parse('{"__proto__":{"safe":true},"a":1}')));
console.log(stringify({ value: [1, 2] }, 2).replace(/\\s/gu, ""));
for (const value of [{ omitted() {} }, new Map(), { value: Infinity }]) {
  try { stringify(value); console.log("accepted"); } catch (error) { console.log(error.name); }
}
try { stringify({}, 1.5); console.log("accepted"); } catch (error) { console.log(error.name); }
for (const operation of [() => parse("{}", {}), () => tryParse("{}", {}), () => clone({}, {}), () => parse("{}", forgedType)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(runtimeTypeReads);
`);
  assert.equal(jsonExecution.status, 0, String(jsonExecution.stderr));
  assert.equal(jsonExecution.stdout, [
    "true", "false", "false", "false", "false", "false", "false", "false", "TypeError", "true",
    '{"__proto__":{"safe":true},"a":1}', '{"value":[1,2]}', "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "TypeError", "TypeError", "0", "",
  ].join("\n"));

  const storage = standardModuleSource("velar/storage") ?? "";
  const storageExecution = executeModule(`
const data = new Map();
let storageReads = 0;
globalThis.localStorage = { get length() { storageReads += 1; return data.size; }, key(index) { storageReads += 1; return [...data.keys()][index] ?? null; }, getItem(key) { storageReads += 1; return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); }, removeItem(key) { data.delete(key); } };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = () => true;
${storage}
let runtimeTypeReads = 0;
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { runtimeTypeReads += 1; return value => value; } });
storage.set("valid", { value: 1 });
console.log(globalThis.localStorage.getItem("valid"));
const beforeInvalid = storageReads;
try { storage.set("invalid", new Map([["value", 1]])); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!data.has("invalid"));
try { storage.get("missing", {}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.get("missing", forgedType); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.watch("missing", {}, () => null); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.set(42, {value: 1}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.scope(42); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(runtimeTypeReads, storageReads === beforeInvalid);
`);
  assert.equal(storageExecution.status, 0, String(storageExecution.stderr));
  assert.equal(storageExecution.stdout, '{"value":1}\nTypeError\ntrue\nTypeError\nTypeError\nTypeError\nTypeError\nTypeError\n0 true\n');

  const http = standardModuleSource("velar/http") ?? "";
  const httpExecution = executeModule(`${http}
try { await http.post("https://example.test", { body: new Map([["value", 1]]) }).response(); console.log("accepted"); }
catch (error) { console.log(error.name); }
globalThis.fetch = async () => new Response("1e400", { status: 200, headers: { "content-type": "application/json" } });
try { await http.get("https://example.test").json(); console.log("accepted"); }
catch (error) { console.log(error.name); }
`);
  assert.equal(httpExecution.status, 0, String(httpExecution.stderr));
  assert.equal(httpExecution.stdout, "TypeError\nTypeError\n");

  const realtime = standardModuleSource("velar/realtime") ?? "";
  const realtimeExecution = executeModule(`
const sent = [];
class FakeWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  constructor(url) { this.url = url; this.readyState = FakeWebSocket.OPEN; }
  addEventListener() {}
  send(value) { sent.push(value); }
  close() { this.readyState = 3; }
}
globalThis.WebSocket = FakeWebSocket;
${realtime}
const channel = socket("wss://example.test");
channel.sendJson({ value: [1, 2] });
try { channel.sendJson(new Map([["value", 1]])); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(sent.length, sent[0]);
`);
  assert.equal(realtimeExecution.status, 0, String(realtimeExecution.stderr));
  assert.equal(realtimeExecution.stdout, 'TypeError\n1 {"value":[1,2]}\n');
});

test("IndexedDB waits for transaction commit and retries a failed open", () => {
  const storage = standardModuleSource("velar/storage") ?? "";
  const execution = executeModule(`
const stored = new Map();
let openAttempts = 0;
let transactionCount = 0;
const outcomes = ["abort", "complete", "complete", "complete"];
const databaseHandle = {
  objectStoreNames: { contains() { return true; } },
  close() {},
  transaction() {
    transactionCount += 1;
    const outcome = outcomes.shift() || "complete";
    const transaction = { error: new Error("transaction aborted") };
    const request = (value, commit = () => {}) => {
      const result = {};
      queueMicrotask(() => {
        result.result = value;
        result.onsuccess?.();
        queueMicrotask(() => {
          if (outcome === "abort") transaction.onabort?.();
          else { commit(); transaction.oncomplete?.(); }
        });
      });
      return result;
    };
    transaction.objectStore = () => ({
      put(value, key) { return request(undefined, () => stored.set(key, value)); },
      get(key) { return request(stored.get(key)); },
      getKey(key) { return request(stored.has(key) ? key : undefined); },
      getAllKeys() { return request(["z", "a"]); },
      delete(key) { return request(undefined, () => stored.delete(key)); },
      clear() { return request(undefined, () => stored.clear()); },
    });
    return transaction;
  },
};
globalThis.indexedDB = {
  open() {
    openAttempts += 1;
    const request = {};
    queueMicrotask(() => {
      if (openAttempts === 1) { request.error = new Error("open failed"); request.onerror?.(); }
      else { request.result = databaseHandle; request.onsuccess?.(); }
    });
    return request;
  },
};
${storage}
const store = database("app");
try { await store.has("item"); console.log("accepted"); } catch (error) { console.log(error.message); }
try { await store.set("item", { value: 1 }); console.log("accepted"); } catch (error) { console.log(error.message); }
await store.set("item", { value: 2 });
const Item = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
console.log((await store.get("item", Item)).value);
console.log((await store.keys()).join(","));
const beforeInvalid = transactionCount;
try { await store.set(42, { value: 3 }); console.log("accepted"); } catch (error) { console.log(error.name, transactionCount === beforeInvalid); }
console.log(openAttempts);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "open failed\ntransaction aborted\n2\na,z\nTypeError true\n2\n");
});

test("runtime List validation rejects sparse and extended JavaScript arrays", () => {
  const result = compile(`
type Numbers = List<number>

def acceptsNumbers(value: unknown) -> bool:
    return value is Numbers

print(acceptsNumbers([1, 2]))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const sparse = []; sparse.length = 1;
const extended = [1]; extended.label = "hidden";
console.log(acceptsNumbers(sparse));
console.log(acceptsNumbers(extended));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\n");
});

test("runtime collection types iterate Maps and Sets without copying or invoking overrides", () => {
  const result = compile(`
type Numbers = Set<number>
type Lookup = Map<string, number>

def acceptsNumbers(value: unknown) -> bool:
    return value is Numbers

def acceptsLookup(value: unknown) -> bool:
    return value is Lookup
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
let iteratorCalls = 0;
class HostileSet extends Set {
  values() { iteratorCalls += 1; return super.values(); }
  [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); }
}
class HostileMap extends Map {
  entries() { iteratorCalls += 1; return super.entries(); }
  [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); }
}
console.log(acceptsNumbers(new HostileSet([1, 2])));
console.log(acceptsLookup(new HostileMap([["value", 1]])));
console.log(iteratorCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n0\n");
});

test("language collection construction and mutation preserve the one-million-item invariant", () => {
  const result = compile(`
const values = [1]
const spread = [...values, 2]
values.append(2)
values.extend([3])
const selected = Set(values)
selected.add(3)
const lookup = Map()
lookup.set("value", 1)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateList/u);
  assert.match(result.code ?? "", /__velarCollectionAppend/u);
  assert.match(result.code ?? "", /__velarCollectionExtend/u);
  assert.match(result.code ?? "", /__velarCreateSet/u);
  assert.match(result.code ?? "", /__velarCreateMap/u);
  const hardened = (result.code ?? "").replaceAll("1000000", "3");
  const execution = executeModule(`${hardened}
let effects = 0;
let iteratorCalls = 0;
let getterReads = 0;
class HostileSet extends Set { values() { iteratorCalls += 1; return super.values(); } [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); } }
class HostileMap extends Map { entries() { iteratorCalls += 1; return super.entries(); } [Symbol.iterator]() { iteratorCalls += 1; return super[Symbol.iterator](); } }
console.log(__velarCreateSet(new HostileSet([1])).size, __velarCreateMap(new HostileMap([["a", 1]])).size, iteratorCalls);
const extended = [1]; __velarCollectionExtend(extended, [2, 3]); console.log(extended.join(":"));
const selfExtended = [1]; __velarCollectionExtend(selfExtended, selfExtended); console.log(selfExtended.join(":"));
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, get() { getterReads += 1; return 1; } });
accessor.length = 1;
const failures = [];
const atomic = [1, 2];
for (const operation of [
  () => __velarCollectionAppend([1, 2, 3], 4),
  () => __velarCollectionExtend(atomic, [3, 4]),
  () => __velarCollectionExtend([], accessor),
  () => __velarCreateList([[true, () => [1, 2, 3]], [false, () => { effects += 1; return 4; }]]),
  () => { const value = __velarCreateSet([1, 2, 3]); __velarCollectionAdd(value, 3); __velarCollectionAdd(value, 4); },
  () => { const value = __velarCreateMap(); __velarCollectionSet(value, "a", 1); __velarCollectionSet(value, "b", 2); __velarCollectionSet(value, "c", 3); __velarCollectionSet(value, "a", 4); __velarCollectionSet(value, "d", 4); },
  () => __velarCreateSet(accessor),
]) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(atomic.join(":") + ":" + effects + ":" + getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1 1 0\n1:2:3\n1:1\nRangeError,RangeError,TypeError,RangeError,RangeError,RangeError,TypeError\n1:2:0:0\n");
});

test("lazy HTTP cancellation and timeout have stable owned semantics", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`${http}
let fetchCount = 0;
globalThis.fetch = async (_url, options) => {
  fetchCount += 1;
  return await new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason));
  });
};

const beforeStart = http.get("https://example.test/before");
beforeStart.cancel();
beforeStart.cancel();
try { await beforeStart.response(); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpAbortError, error.name, error.reason, fetchCount); }

const active = http.get("https://example.test/active");
const activeResult = active.response();
active.cancel();
try { await activeResult; console.log("accepted"); }
catch (error) { console.log(error instanceof HttpAbortError, error.reason, fetchCount); }

const timed = http.get("https://example.test/timeout", { timeout: 1 });
try { await timed.response(); console.log("accepted"); }
catch (error) { console.log(error instanceof HttpAbortError, error.reason, fetchCount); }

try { new HttpAbortError("other"); console.log("accepted"); }
catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true HttpAbortError cancelled 0",
    "true cancelled 1",
    "true timeout 2",
    "TypeError",
    "",
  ].join("\n"));
});

test("HTTP validates options, methods, bodies, headers, and runtime types before fetch", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`${http}
let fetchCount = 0;
let captured = null;
globalThis.fetch = async (url, options) => {
  fetchCount += 1;
  captured = { url, method: options.method, body: options.body, contentType: options.headers.get("content-type"), credentials: options.credentials, cache: options.cache };
  return new Response('{"value":2}', { status: 200, headers: { "content-type": "application/json" } });
};
const Result = __velarRegisterRuntimeType(Object.freeze({ is(value) { return typeof value?.value === "number"; }, parse(value) { if (!this.is(value)) throw new TypeError("invalid result"); return value; } }));
console.log((await http.post("/items", { headers: new Map([["x-test", "yes"]]), body: { value: 1 }, timeout: 10, credentials: "include", cache: "no-cache" }).parse(Result)).value);
console.log(captured.url, captured.method, captured.body, captured.contentType, captured.credentials, captured.cache, fetchCount);
let getterReads = 0;
const accessorOptions = {};
Object.defineProperty(accessorOptions, "timeout", { enumerable: true, get() { getterReads += 1; return 10; } });
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { getterReads += 1; return value => value; } });
for (const operation of [
  () => http.get(42),
  () => http.request("TRACE", "/items"),
  () => http.request("bad method", "/items"),
  () => http.get("/items", { unknown: true }),
  () => http.get("/items", accessorOptions),
  () => http.get("/items", { headers: new Map([[1, "value"]]) }),
  () => http.get("/items", { credentials: "always" }),
  () => http.get("/items", { cache: "only-if-cached" }),
  () => http.get("/items", { body: "not allowed" }),
  () => http.post("/items", { body: 42 }),
  () => new HttpError(42, 400, "/items"),
  () => new HttpError("failed", 99, "/items"),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
try { await http.get("/items").parse({}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { await http.get("/items").parse(forgedType); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(getterReads, fetchCount);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "2",
    '/items POST {"value":1} application/json include no-cache 1',
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "0 1", "",
  ].join("\n"));
});

test("HTTP response maxBytes cancels oversized streams and permits repeat typed reads", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`${http}
let fetchCalls = 0;
let cancelled = false;
globalThis.fetch = async (url) => {
  fetchCalls += 1;
  if (url === "/large") {
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("large")); },
      cancel() { cancelled = true; },
    }));
  }
  return new Response('{"value":3}', { headers: { "content-type": "application/json" } });
};
try { await http.get("/large", { maxBytes: 4 }).text(); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(cancelled);
const response = await http.get("/cached").response();
console.log(await response.text());
console.log((await response.json()).value);
try { http.get("/invalid", { maxBytes: 0 }); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(fetchCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, 'RangeError\ntrue\n{"value":3}\n3\nRangeError\n2\n');
});

test("HTTP validates response metadata and bounds returned headers", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`${http}
let mode = "headers";
globalThis.fetch = async () => {
  const headers = new Headers();
  if (mode === "headers") for (let index = 0; index <= 100; index += 1) headers.set("x-field-" + index, "value");
  const response = new Response("ok", { headers });
  if (mode === "url") Object.defineProperty(response, "url", { value: "x".repeat(2 * 1024 * 1024 + 1) });
  if (mode === "status") Object.defineProperty(response, "status", { value: Number.NaN });
  return response;
};
for (const selected of ["headers", "url", "status"]) {
  mode = selected;
  try { await http.get("/probe").response(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\nRangeError\nTypeError\n");
});

test("known lossy JSON inputs fail during checking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-json-types-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {clone, stringify} from "velar/json"
import {http} from "velar/http"
import {socket} from "velar/realtime"

type Tree:
    name: string
    children: List<Tree>

class Box(const value: number):
    pass

const tree: Tree = {name: "root", children: []}
const valid = stringify(tree)
const mapping = Map()
mapping.set("value", 1)
const unique = Set([1, 2])
const callback = () => 1
const badMap = stringify(mapping)
const badSet = clone(unique)
const badClass = stringify(Box(1))
const badFunction = stringify(callback)
const badHttp = http.post("/items", {body: mapping})
const channel = socket("wss://example.test")
channel.sendJson(unique)
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message);
  assert.equal(messages.filter((message) => message.startsWith("JSON accepts only records")).length, 4);
  assert.ok(messages.some((message) => /received Map<string, number>/u.test(message)));
  assert.ok(messages.some((message) => /received Set<number>/u.test(message)));
  assert.ok(messages.some((message) => /received Box/u.test(message)));
  assert.ok(messages.some((message) => /received \(\) -> number/u.test(message)));
  assert.ok(messages.some((message) => /HTTP JSON bodies.*received Map<string, number>/u.test(message)));
  assert.ok(messages.some((message) => /Realtime JSON.*received Set<number>/u.test(message)));
});

test("velar/id uses secure host UUIDs without an insecure fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-id-"));
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {isUuid, uuid} from "velar/id"

const first = uuid()
const second = uuid()
print(isUuid(first))
print(first != second)
print(isUuid("task-1"))
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "true\ntrue\nfalse\n");
});

test("velar/id validates the secure host result before typing it as a UUID string", () => {
  const source = standardModuleSource("velar/id") ?? "";
  const execution = executeModule(`
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID() { return "not-a-uuid"; } } });
${source}
try { uuid(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(isUuid("x".repeat(100000)));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Error\nfalse\n");
});

test("0.4 Core standard library rejects invalid typed calls before runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-standard-library-invalid-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {flatten, sum} from "velar/collections"
import {parse as parseJson} from "velar/json"
import {all as allAsync, map as asyncMap} from "velar/async"
import {matches} from "velar/text"

const total = sum(["one", "two"])
const flat = flatten([1, 2])
const parsed = parseJson("{}", 42)
const resolved = await allAsync([1, 2])
const mapped = await asyncMap([1, 2], value => value, "many")
const pattern = matches(42, "[0-9]+")
const options = matches("42", "[0-9]+", {ignoreCase: "yes"})
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message).join("\n");
  assert.match(messages, /sum expects List<number>, received List<string>/u);
  assert.match(messages, /flatten expects a List of Lists, received List<number>/u);
  assert.match(messages, /Runtime parsing requires a Velar runtime type/u);
  assert.match(messages, /Expected a List of Promises, received List<number>/u);
  assert.match(messages, /Cannot assign string to number/u);
  assert.match(messages, /Cannot assign number to string/u);
  assert.match(messages, /Cannot assign \{ ignoreCase: string \} to \{ ignoreCase: bool\?, multiline: bool\?, dotAll: bool\? \}/u);
});

test("npm packages publish Velar source through package.json velar.entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-source-package-"));
  const packageRoot = join(directory, "node_modules", "velar-greeter");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "velar-greeter",
    version: "1.0.0",
    velar: { entry: "src/index.vel" },
  }), "utf8");
  await writeFile(join(packageRoot, "src", "message.vel"), "export const greeting = \"Hello\"\n", "utf8");
  const packageEntry = join(packageRoot, "src", "index.vel");
  await writeFile(packageEntry, `
import {greeting} from "./message.vel"

export def greet(name: string) -> string:
    return f"{greeting}, {name}"
`.trimStart(), "utf8");
  const mainPath = join(directory, "main.vel");
  const mainSource = `
import {greet} from "velar-greeter"

component App:
    return <h1>{greet("Velar")}</h1>

mount(<App />, "#app")
`.trimStart();
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath, new Map(), { projectRoot: directory });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(project.velarPackages[0]?.name, "velar-greeter");
  assert.ok(project.modules.some((module) => module.relativePath === "__velar_packages__/velar-greeter/src/index.vel"));
  assert.equal(projectDefinitionAt(project, mainPath, mainSource.indexOf("greet(\"") + 1)?.path, packageEntry);
  assert.match(moduleOutput(project, "/main.js", "7")?.body ?? "", /\/__velar_packages__\/velar-greeter\/src\/index\.js\?velar=7/u);
  assert.match(moduleOutput(project, "/__velar_packages__/velar-greeter/src/index.js", "7")?.body ?? "", /\.\/message\.js\?velar=7/u);

  const output = join(directory, "dist");
  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", mainPath, "--out-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  const assets = await readdir(join(output, "assets"));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(javascript);
  assert.match(await readFile(join(output, "assets", javascript), "utf8"), /Hello/);
});

test("Velar source packages cannot escape their package root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-package-boundary-"));
  const packageRoot = join(directory, "node_modules", "unsafe-package");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "unsafe-package",
    velar: { entry: "src/index.vel" },
  }), "utf8");
  await writeFile(join(packageRoot, "src", "index.vel"), "import {secret} from \"../../secret.vel\"\nexport const value = secret\n", "utf8");
  await writeFile(join(directory, "node_modules", "secret.vel"), "export const secret = 1\n", "utf8");
  const mainPath = join(directory, "main.vel");
  await writeFile(mainPath, "import {value} from \"unsafe-package\"\nprint(value)\n", "utf8");

  const project = await compileProject(mainPath);
  assert.ok(project.failures.some((failure) => /cannot escape Velar package 'unsafe-package'/u.test(failure.message)));
});

test("reactive bindings cannot be declared in functions or shadowed", () => {
  const nested = compile("def invalid():\n    state count = 0\n");
  assert.ok(nested.diagnostics.some((diagnostic) => diagnostic.code === "VEL3010"));

  const shadowed = compile("state count = 0\ndef invalid(count: number):\n    print(count)\n");
  assert.ok(shadowed.diagnostics.some((diagnostic) => /cannot shadow a module reactive binding/.test(diagnostic.message)));
});

test("velar.json defines a self-contained Web project and standard modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-config-project-"));
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "assets"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    entry: "src/main.vel",
    outDir: "build",
    publicDir: "assets",
    web: {
      title: "Configured Velar",
      base: "/demo",
      publicConfig: { apiBase: "https://api.example.com", features: { releases: true } },
      build: { sourceMaps: true },
    },
  }), "utf8");
  await writeFile(join(directory, "assets", "message.txt"), "Velar asset\n", "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {route, Router, Link} from "velar/web"
import {http} from "velar/http"
import {storage} from "velar/storage"
import {publicConfig} from "velar/config"

type Settings:
    theme: string

type Features:
    releases: bool

type AppConfig:
    apiBase: string
    features: Features

const appConfig = publicConfig(AppConfig)

async def load() -> Settings:
    return await http.get("/api/settings").parse(Settings)

component Home:
    const saved = storage.get("settings", Settings, {theme: "system"})
    return <main><Link to="/settings">{saved.theme}:{appConfig.apiBase}</Link></main>

const routes = [route("/", Home)]

component App:
    return <Router routes={routes} />

mount(<App />, "#app")
`.trimStart(), "utf8");

  const config = await resolveVelarProject(null, directory);
  assert.equal(config.entryPath, join(directory, "src", "main.vel"));
  assert.equal(config.web.base, "/demo/");
  assert.deepEqual(config.web.publicConfig, { apiBase: "https://api.example.com", features: { releases: true } });
  assert.equal(config.web.build.sourceMaps, true);
  assert.equal(config.web.security.contentSecurityPolicy, true);
  assert.equal(config.web.deployment.spaFallback, true);
  const project = await compileProject(config.entryPath, new Map(), { projectRoot: config.root, publicRoot: config.publicDir, web: config.web });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules[0]?.result.code ?? "", /from "velar\/web"/);
  assert.match(project.modules[0]?.result.code ?? "", /const Settings = __velarRegisterType\(Object\.freeze/);

  await mkdir(join(directory, "build"));
  await writeFile(join(directory, "build", "stale.txt"), "stale\n", "utf8");
  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  const html = await readFile(join(directory, "build", "index.html"), "utf8");
  assert.match(html, /<title>Configured Velar<\/title>/);
  assert.match(html, /src="\/demo\/assets\/main-[A-Z0-9]+\.js"/);
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /script-src 'self'/u);
  assert.doesNotMatch(html, /importmap/);
  assert.equal(await readFile(join(directory, "build", "message.txt"), "utf8"), "Velar asset\n");
  await assert.rejects(readFile(join(directory, "build", "stale.txt")), /ENOENT/u);
  assert.equal(await readFile(join(directory, "build", "404.html"), "utf8"), html);
  const deployment = JSON.parse(await readFile(join(directory, "build", "velar-deploy.json"), "utf8"));
  assert.equal(deployment.kind, "velar-static-deployment");
  assert.equal(deployment.base, "/demo/");
  assert.match(deployment.headers[0].values["Content-Security-Policy"], /frame-ancestors 'none'/u);
  const assets = await readdir(join(directory, "build", "assets"));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(javascript);
  assert.match(await readFile(join(directory, "build", "assets", javascript), "utf8"), /HttpError/);
  assert.match(await readFile(join(directory, "build", "assets", javascript), "utf8"), /https:\/\/api\.example\.com/u);
  assert.ok(assets.includes(`${javascript}.map`));
  const productionManifest = JSON.parse(await readFile(join(directory, "build", "velar-build.json"), "utf8")) as { sourceMaps: boolean };
  assert.equal(productionManifest.sourceMaps, true);

  const verifiedBuild = await verifyProductionBuild(join(directory, "build"));
  const subpathPreview = await startProductionPreview(verifiedBuild, 0);
  try {
    const remote = await verifyRemoteDeployment(verifiedBuild, subpathPreview.origin);
    assert.equal(remote.url, `${subpathPreview.origin}/demo/`);
    assert.equal(remote.buildId, verifiedBuild.manifest.buildId);
  } finally {
    await subpathPreview.close();
  }

  await writeFile(join(directory, "assets", "index.html"), "unsafe public override\n", "utf8");
  const refused = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /public asset 'index\.html' is reserved/u);
  assert.equal(await readFile(join(directory, "build", "index.html"), "utf8"), html);
});

test("project configuration rejects destructive output layouts and unsafe CSP origins", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-secure-config-"));
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  const manifestPath = join(directory, "velar.json");
  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", outDir: "." }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /outDir.*project root/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", outDir: "dist", publicDir: "dist/public" }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /outDir.*publicDir.*overlap/u);

  await writeFile(manifestPath, JSON.stringify({
    entry: "main.vel",
    web: { security: { connectSources: ["https://api.example.com/path"] } },
  }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unsupported origin/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { publicConfig: ["not", "an", "object"] } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /web\.publicConfig.*JSON object/u);

  await writeFile(manifestPath, '{"entry":"main.vel","web":{"publicConfig":{"__proto__":"unsafe"}}}\n', "utf8");
  await assert.rejects(resolveVelarProject(directory), /reserved key '__proto__'/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { publicConfig: { value: "x".repeat(65_537) } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /cannot exceed 64 KiB/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { base: "/app/", deployment: { adapter: "netlify" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /netlify.*web\.base.*'\/'/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { deployment: { adapter: "unknown" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /adapter.*neutral.*netlify/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { build: { sourceMaps: "yes" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /web\.build\.sourceMaps.*boolean/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", outdir: "misspelled" }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'project' field 'outdir'/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { titel: "misspelled" } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web' field 'titel'/u);

  await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { security: { connectSource: [] } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web\.security' field 'connectSource'/u);

  for (const base of ["/double//segment/", "/../escape/", "/encoded%2Fslash/", "/query/?value=1", "/bad%ZZ/"]) {
    await writeFile(manifestPath, JSON.stringify({ entry: "main.vel", web: { base } }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /web\.base/u);
  }
});

test("Netlify adapter translates the root static deployment contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-netlify-"));
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "src", "main.vel"), `component App:\n    return <main><h1>Netlify Velar</h1></main>\n\nmount(<App />, "#app")\n`, "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 1,
    entry: "src/main.vel",
    outDir: "dist",
    web: { base: "/", build: { sourceMaps: true }, deployment: { spaFallback: true, adapter: "netlify" } },
  }), "utf8");
  await assert.rejects(verifyProductionBuild(directory), /run 'velar build' first/u);

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  const headers = await readFile(join(directory, "dist", "_headers"), "utf8");
  assert.match(headers, /^\/\*\n  Cross-Origin-Opener-Policy: same-origin/mu);
  assert.match(headers, /^\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/mu);
  assert.match(headers, /^\/velar-build\.json\n  Cache-Control: no-cache/mu);
  assert.match(headers, /^\/velar-deploy\.json\n  Cache-Control: no-cache/mu);
  assert.match(headers, /^\/404\.html\n  Cache-Control: no-cache/mu);
  assert.equal(
    await readFile(join(directory, "dist", "_redirects"), "utf8"),
    "/assets/* /404.html 404\n/* /index.html 200\n",
  );
  const deployment = JSON.parse(await readFile(join(directory, "dist", "velar-deploy.json"), "utf8")) as {
    adapter: { name: string; files: string[] };
  };
  assert.deepEqual(deployment.adapter, { name: "netlify", files: ["_headers", "_redirects"] });
  const build = JSON.parse(await readFile(join(directory, "dist", "velar-build.json"), "utf8")) as {
    buildId: string;
    deployment: { adapter: string };
    assets: Array<{ path: string; role: string }>;
  };
  assert.equal(build.deployment.adapter, "netlify");
  assert.ok(build.assets.some((asset) => asset.path === "_headers" && asset.role === "adapter"));
  assert.ok(build.assets.some((asset) => asset.path === "_redirects" && asset.role === "adapter"));

  const repeat = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", "--out-dir", "dist-repeat"], { cwd: directory, encoding: "utf8" });
  assert.equal(repeat.status, 0, repeat.stderr);
  const repeatedBuild = JSON.parse(await readFile(join(directory, "dist-repeat", "velar-build.json"), "utf8"));
  assert.deepEqual(repeatedBuild, build);
  for (const asset of build.assets) {
    assert.deepEqual(
      await readFile(join(directory, "dist-repeat", asset.path)),
      await readFile(join(directory, "dist", asset.path)),
      `non-reproducible asset ${asset.path}`,
    );
  }

  const verified = await verifyProductionBuild(join(directory, "dist"));
  assert.equal(verified.manifest.buildId, build.buildId);
  const cliVerification = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "verify", "dist"], { cwd: directory, encoding: "utf8" });
  assert.equal(cliVerification.status, 0, cliVerification.stderr);
  assert.match(cliVerification.stdout, new RegExp(build.buildId, "u"));

  const preview = await startProductionPreview(verified, 0);
  try {
    const root = await fetch(preview.url, { headers: { Accept: "text/html" } });
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-security-policy") ?? "", /script-src 'self'/u);
    assert.equal(root.headers.get("cache-control"), "no-cache");
    assert.match(await root.text(), /<div id="app"><\/div>/u);
    const deep = await fetch(new URL("deep/route", preview.url), { headers: { Accept: "text/html" } });
    assert.equal(deep.status, 200);
    assert.match(await deep.text(), /<div id="app"><\/div>/u);
    const malformedNavigation = await fetch(`${preview.url}%E0%A4%A`, { headers: { Accept: "text/html" } });
    assert.equal(malformedNavigation.status, 200);
    assert.match(await malformedNavigation.text(), /<div id="app"><\/div>/u);
    const malformedAsset = await fetch(`${preview.url}%E0%A4%A`, { headers: { Accept: "application/javascript" } });
    assert.equal(malformedAsset.status, 400);
    const missingAsset = await fetch(new URL("assets/missing.js", preview.url), { headers: { Accept: "*/*" } });
    assert.equal(missingAsset.status, 404);
    const method = await fetch(preview.url, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET, HEAD");
    const head = await fetch(preview.url, { method: "HEAD", headers: { Accept: "text/html" } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const remote = await verifyRemoteDeployment(verified, preview.origin);
    assert.equal(remote.url, preview.url);
    assert.equal(remote.buildId, build.buildId);
    assert.equal(remote.checkedRoutes, 3);
    assert.ok(remote.checkedFiles >= build.assets.length - 1);
    assert.ok(remote.checkedHeaders > remote.checkedFiles);

    const cli = spawn(process.execPath, [
      resolve("packages/cli/src/cli.ts"),
      "verify-deployment",
      "dist",
      "--url",
      preview.origin,
    ], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    let cliStdout = "";
    let cliStderr = "";
    cli.stdout.on("data", (chunk: Buffer) => { cliStdout += chunk.toString("utf8"); });
    cli.stderr.on("data", (chunk: Buffer) => { cliStderr += chunk.toString("utf8"); });
    const cliStatus = await new Promise<number | null>((resolvePromise) => cli.once("exit", resolvePromise));
    assert.equal(cliStatus, 0, cliStderr);
    assert.match(cliStdout, new RegExp(`Verified deployed Web build ${build.buildId}`, "u"));

    const jsonCli = spawn(process.execPath, [
      resolve("packages/cli/src/cli.ts"),
      "verify-deployment",
      "dist",
      "--json",
    ], {
      cwd: directory,
      env: { ...process.env, VELAR_DEPLOYMENT_URL: preview.origin },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let jsonStdout = "";
    let jsonStderr = "";
    jsonCli.stdout.on("data", (chunk: Buffer) => { jsonStdout += chunk.toString("utf8"); });
    jsonCli.stderr.on("data", (chunk: Buffer) => { jsonStderr += chunk.toString("utf8"); });
    const jsonStatus = await new Promise<number | null>((resolvePromise) => jsonCli.once("exit", resolvePromise));
    assert.equal(jsonStatus, 0, jsonStderr);
    const report = JSON.parse(jsonStdout) as {
      formatVersion: number;
      kind: string;
      verifiedAt: string;
      target: { origin: string; url: string; base: string };
      build: { buildId: string; apiVersion: string; sourceMaps: boolean };
      checks: { files: number; routes: number; headers: number };
    };
    assert.equal(report.formatVersion, 1);
    assert.equal(report.kind, "velar-deployment-verification");
    assert.ok(Number.isFinite(Date.parse(report.verifiedAt)));
    assert.deepEqual(report.target, { origin: preview.origin, url: preview.url, base: "/" });
    assert.equal(report.build.buildId, build.buildId);
    assert.equal(report.build.sourceMaps, true);
    assert.equal(report.checks.routes, 3);
    assert.ok(report.checks.files > 0);
    assert.ok(report.checks.headers > 0);

    const entryPath = verified.manifest.entry;
    const tamperedFetch: DeploymentFetch = async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input).pathname.endsWith(entryPath)) {
        await response.body?.cancel();
        return new Response("tampered", { status: response.status, headers: response.headers });
      }
      return response;
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, tamperedFetch),
      /Deployed file.*has 8 bytes|SHA-256/u,
    );

    const badCacheFetch: DeploymentFetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!new URL(input).pathname.startsWith("/assets/")) return response;
      const body = await response.arrayBuffer();
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Cache-Control", "no-cache");
      return new Response(body, { status: response.status, headers: responseHeaders });
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, badCacheFetch),
      /Deployment header 'Cache-Control'.*expected 'public, max-age=31536000, immutable'/u,
    );

    const redirectFetch: DeploymentFetch = async (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/") return new Response(null, { status: 302, headers: { Location: "/login" } });
      return fetch(input, init);
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, redirectFetch),
      /redirected '\/' with HTTP 302/u,
    );

    const fallbackAssetFetch: DeploymentFetch = async (input, init) => {
      const url = new URL(input);
      if (!url.pathname.includes("/__velar_missing_")) return fetch(input, init);
      return new Response(await readFile(join(directory, "dist", "index.html")), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, fallbackAssetFetch),
      /missing production asset returned HTTP 200.*expected 404/u,
    );

    await assert.rejects(verifyRemoteDeployment(verified, "http://example.com"), /must use HTTPS/u);
    await assert.rejects(verifyRemoteDeployment(verified, `${preview.origin}/wrong/`), /origin without a path/u);
  } finally {
    await preview.close();
  }

  const unexpected = join(directory, "dist", "unexpected.txt");
  await writeFile(unexpected, "not declared\n", "utf8");
  await assert.rejects(verifyProductionBuild(join(directory, "dist")), /undeclared file 'unexpected\.txt'/u);
  await unlink(unexpected);
  const link = join(directory, "dist", "linked.txt");
  await symlink(join(directory, "src", "main.vel"), link);
  await assert.rejects(verifyProductionBuild(join(directory, "dist")), /symbolic link 'linked\.txt'/u);
  await unlink(link);
  const entryAsset = build.assets.find((asset) => asset.role === "entry")!;
  await writeFile(join(directory, "dist", entryAsset.path), "tampered\n", "utf8");
  await assert.rejects(verifyProductionBuild(join(directory, "dist")), /size does not match|SHA-256 does not match/u);
});

test("CLI creates versioned projects and upgrades legacy manifests without overwriting user files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-lifecycle-"));
  const projectRoot = join(directory, "my-app");
  const created = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const manifest = JSON.parse(await readFile(join(projectRoot, "velar.json"), "utf8")) as { formatVersion: number };
  assert.equal(manifest.formatVersion, 1);
  const createdPackage = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(createdPackage.devDependencies["@velarscript/cli"], "^0.9.0");
  assert.equal(createdPackage.scripts.format, "velar format");
  assert.equal(createdPackage.scripts["format:check"], "velar format --check");
  assert.equal(createdPackage.scripts["test:browser"], "velar test --browser");
  assert.equal(createdPackage.scripts.verify, "velar verify");
  assert.equal(createdPackage.scripts.preview, "velar preview");
  assert.equal(createdPackage.scripts["verify:deployment"], "velar verify-deployment");
  assert.match(await readFile(join(projectRoot, "src", "main.vel"), "utf8"), /import \{App\} from "\.\/app\.vel"/u);
  const generatedApp = await readFile(join(projectRoot, "src", "app.vel"), "utf8");
  assert.match(generatedApp, /Built with VelarScript/u);
  assert.match(await readFile(join(projectRoot, "src", "app.test.vel"), "utf8"), /test_application_name/u);
  assert.match(await readFile(join(projectRoot, "src", "app.browser.test.vel"), "utf8"), /browser\.open/u);
  const config = await resolveVelarProject(projectRoot);
  assert.equal(config.formatVersion, 1);
  assert.equal(config.needsUpgrade, false);
  assert.equal(config.web.build.sourceMaps, false);
  const checked = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const coreTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(coreTest.status, 0, coreTest.stderr);
  assert.match(coreTest.stdout, /app\.test\.vel :: test_application_name/u);

  const formatCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", "--check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(formatCheck.status, 0, formatCheck.stderr);
  assert.match(formatCheck.stdout, /Checked formatting of 4 Velar source files/u);
  await writeFile(join(projectRoot, "src", "app.vel"), generatedApp.replace("\n", "  \n"), "utf8");
  const unformatted = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", projectRoot, "--check"], { cwd: directory, encoding: "utf8" });
  assert.equal(unformatted.status, 1);
  assert.match(unformatted.stderr, /src[/\\]app\.vel is not formatted/u);
  const formatted = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(formatted.status, 0, formatted.stderr);
  assert.equal(await readFile(join(projectRoot, "src", "app.vel"), "utf8"), generatedApp);

  await mkdir(join(projectRoot, "public"), { recursive: true });
  await writeFile(join(projectRoot, "public", "ignored.vel"), "const publicAsset = true", "utf8");
  const excludesPublic = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", "--check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(excludesPublic.status, 0, excludesPublic.stderr);
  assert.equal(await readFile(join(projectRoot, "public", "ignored.vel"), "utf8"), "const publicAsset = true");

  const secondCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(secondCreate.status, 1);
  assert.match(secondCreate.stderr, /not empty/u);

  const unusualRoot = join(directory, "_Hidden & App");
  const unusualCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", unusualRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(unusualCreate.status, 0, unusualCreate.stderr);
  const unusualPackage = JSON.parse(await readFile(join(unusualRoot, "package.json"), "utf8")) as { name: string };
  assert.equal(unusualPackage.name, "hidden-app");
  assert.match(await readFile(join(unusualRoot, "src", "app.vel"), "utf8"), /appName = "_Hidden & App"/u);
  const unusualCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", unusualRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(unusualCheck.status, 0, unusualCheck.stderr);

  const emptyRoot = join(directory, "existing-empty");
  await mkdir(emptyRoot);
  const emptyCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", emptyRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(emptyCreate.status, 0, emptyCreate.stderr);
  assert.equal(JSON.parse(await readFile(join(emptyRoot, "velar.json"), "utf8")).formatVersion, 1);

  const legacyRoot = join(directory, "legacy");
  await mkdir(legacyRoot);
  await writeFile(join(legacyRoot, "main.vel"), "const value = 1\n", "utf8");
  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ entry: "main.vel", web: { title: "Legacy", base: "/" } }, null, 2), "utf8");
  const before = await resolveVelarProject(legacyRoot);
  assert.equal(before.needsUpgrade, true);
  const upgradeCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "upgrade", legacyRoot, "--check"], { cwd: directory, encoding: "utf8" });
  assert.equal(upgradeCheck.status, 1);
  assert.match(upgradeCheck.stderr, /requires a formatVersion upgrade/u);
  const upgrade = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "upgrade", legacyRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(upgrade.status, 0, upgrade.stderr);
  const upgraded = JSON.parse(await readFile(join(legacyRoot, "velar.json"), "utf8")) as { formatVersion: number; web: { title: string } };
  assert.equal(upgraded.formatVersion, 1);
  assert.equal(upgraded.web.title, "Legacy");

  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ formatVersion: 99, entry: "main.vel" }), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /unsupported formatVersion 99/u);
});

test("CLI help is command-specific and malformed top-level invocations fail cleanly", () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const help = spawnSync(process.execPath, [cli, "help", "build"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /isolated production Web output/u);

  const inlineHelp = spawnSync(process.execPath, [cli, "test", "--help"], { encoding: "utf8" });
  assert.equal(inlineHelp.status, 0, inlineHelp.stderr);
  assert.match(inlineHelp.stdout, /bare --browser defaults to Chromium/u);

  const unknownHelp = spawnSync(process.execPath, [cli, "help", "missing"], { encoding: "utf8" });
  assert.equal(unknownHelp.status, 2);
  assert.match(unknownHelp.stderr, /unknown command 'missing'/u);
  assert.doesNotMatch(unknownHelp.stderr, /at .*cli/u);

  const invalidVersion = spawnSync(process.execPath, [cli, "--version", "extra"], { encoding: "utf8" });
  assert.equal(invalidVersion.status, 2);
  assert.match(invalidVersion.stderr, /does not accept arguments/u);
});

test("velar test discovers test_* functions without requiring exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-test-project-"));
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ entry: "src/main.vel" }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export def add(left: number, right: number) -> number:\n    return left + right\n", "utf8");
  await writeFile(join(directory, "src", "math.test.vel"), `
import {expect} from "velar/test"
import {add} from "./main.vel"

def test_adds_numbers():
    expect(add(2, 3)).toEqual(5)

async def test_async_code():
    await tick()
    const value = "ready"
    expect(value).toEqual("ready")
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "ignored.browser.test.vel"), "this is intentionally not valid core test source\n", "utf8");

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(execution.stdout, /math\.test\.vel :: test_adds_numbers/);
  assert.match(execution.stdout, /2 passed, 0 failed/);
});

test("JSX fragments, declared children, form bindings, and event modifiers compose", () => {
  const result = compile(`
component Panel(children: WebNode):
    return <section>{children}</section>

component App:
    state name = "Velar"
    state age = 1
    state enabled = true

    def submit():
        print(name)

    return <>
        <Panel><strong>{name}</strong></Panel>
        <form on:submit.prevent.stop={submit}>
            <input bind:value={name} />
            <input type="number" bind:value={age} />
            <input type="checkbox" bind:checked={enabled} />
        </form>
    </>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /document\.createDocumentFragment\(\)/);
  assert.match(result.code ?? "", /Panel\(\{ children:/);
  assert.match(result.code ?? "", /__velarOn\([^\n]+"submit"[^\n]+\["prevent","stop"\]/);
  assert.match(result.code ?? "", /__velarBindValue\([^\n]+age[^\n]+true\)/);
  assert.match(result.code ?? "", /__velarBindChecked/);

  const invalid = compile(`
component App:
    state name = "Velar"
    return <form on:submit.magic={print}><input bind:checked={name} /></form>
`.trimStart());
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === "VEL5025"));
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === "VEL4001"));
});

test("native SVG JSX preserves namespaces across components, dynamics, and foreignObject", () => {
  const result = compile(`
component Point(x: number, y: number):
    return <circle cx={x} cy={y} r="4" />

component Annotation:
    return <foreignObject x="0" y="0" width="80" height="24">
        <div class="label">HTML label</div>
        <svg aria-hidden="true"><path d="M0 0 L8 8" /></svg>
    </foreignObject>

component Chart:
    state values = [12, 24]
    return <svg aria-label="Traffic trend" viewBox="0 0 100 60">
        <defs><circle id="marker" cx="0" cy="0" r="2" /></defs>
        <g>
            <Point x={12} y={20} />
            {values.map(value => <rect key={value} x={value} y="30" width="8" height="12" />)}
            {values.length > 0 ? <path d="M0 50 L100 10" /> : none}
            <use xlink:href="#marker" />
            <Annotation />
        </g>
    </svg>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateElement\("svg", "svg"\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("g", "svg"\)/u);
  assert.match(result.code ?? "", /Point\(\{ x: 12, y: 20 \}, "svg"\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("circle", __namespace\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("foreignObject", __namespace\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("div", "html"\)/u);
  assert.match(result.code ?? "", /__velarStaticAttr\([^;]+, "xlink:href", "#marker"\)/u);
  assert.match(result.code ?? "", /setAttributeNS\(__velarXlinkNamespace, name, value\)/u);
  assert.doesNotMatch(result.code ?? "", /document\.createElement\("(?:svg|g|path|circle|rect|use|foreignObject)"\)/u);

  const inaccessible = compile(`
component Icon:
    return <svg><path d="M0 0 L8 8" /></svg>
`.trimStart());
  assert.ok(inaccessible.diagnostics.some((item) => item.code === "VEL5030" && /svg element requires/u.test(item.message)));

  const titled = compile(`
component Icon:
    return <svg><title>Save changes</title><path d="M0 0 L8 8" /></svg>
`.trimStart());
  assert.deepEqual(titled.diagnostics, []);
});

test("CLI checks and builds a multi-module project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-modules-"));
  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts",
    "build",
    "examples/modules/main.vel",
    "--out-dir",
    directory,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(execution.status, 0, String(execution.stderr));
  const main = await readFile(join(directory, "main.js"), "utf8");
  const dependency = await readFile(join(directory, "lib/greeting.js"), "utf8");
  assert.match(main, /from "\.\/lib\/greeting\.js"/);
  assert.match(dependency, /export function greet/);
});

test("collection operations use Velar return and bounds semantics", () => {
  const result = compile(`
let values = [1, 2]
print(values.get(9) == none)
print(values.append(3) == none)
print(values.extend([4, 5]) == none)
print(values.length)
print(values.remove(2))

const lookup = Map()
lookup.set("answer", 42)
print(lookup.get("missing") == none)
print(lookup.remove("answer"))

try:
    print(values[20])
catch error:
    print(error.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n5\ntrue\ntrue\ntrue\nIndexError\n");

  const invalid = compile(`
const values = [1]
values.extend(["two"])
values.push(2)
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign List<string> to List<number>/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot call an unknown JavaScript value/u.test(item.message)));
});

test("empty Lists infer one element type from append or extend", () => {
  const result = compile(`
let appended = []
appended.append(1)
const first: number = appended[0]

let extended = []
extended.extend([2, 3])
const second: number = extended[0]

component Values:
    state values = []
    def addValues():
        values.append(1)
        values.extend([2, 3])
    return <div>{values.map(value => <span key={value}>{value + 1}</span>)}</div>

print(first + second)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const bindings = result.semanticIndex.symbols.filter((symbol) => symbol.name === "appended" || symbol.name === "extended" || symbol.name === "values");
  assert.ok(bindings.length >= 3);
  assert.ok(bindings.every((symbol) => symbol.type === "List<number>"));
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\n");

  const invalid = compile(`
let appended = []
appended.append(1)
appended.append("bad")

let extended = []
extended.extend([1])
extended.extend(["bad"])
`.trimStart());
  assert.equal(invalid.diagnostics.filter((item) => /Cannot assign/u.test(item.message)).length, 2);
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign List<string> to List<number>/u.test(item.message)));
});

test("List.slice returns a typed checked copy with familiar positional semantics", () => {
  const result = compile(`
const values = [1, 2, 3, 4]
const copied = values.slice()
const middle = values.slice(1, 3)
const tail = values.slice(-2)
copied[0] = 9
print(values[0])
print(middle[0])
print(tail[0])
print(values.slice(20).length)

try:
    values.slice(0.5)
catch error:
    print(error.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCollectionSlice\(values, 1, 3\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\n2\n3\n0\nTypeError\n");

  const invalid = compile(`
const values = [1, 2, 3]
values.slice("1")
values.slice(0, 1, 2)
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Expected 0-2 arguments but received 3/u.test(item.message)));
});

test("does not rewrite class methods that share collection method names", () => {
  const result = compile(`
class Box():
    def get() -> number:
        return 7

print(Box().get())
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /__velarCollectionGet/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.stdout, "7\n");
});

test("safe JavaScript imports use explicit extern declarations", () => {
  const valid = compile(`
type TextTools:
    version: string
    normalize: (string) -> string

extern module "text-tools":
    export const version: string
    export const tools: TextTools
    export def lengthOf(value: string) -> number
    export def join(...values: string) -> string

import js {lengthOf, join, tools, version} from "text-tools"
import js * as namespaceTools from "text-tools"
const size: number = lengthOf("Velar")
const label: string = join("Velar", "Script")
const current: string = version
const normalized: string = tools.normalize(label)
const mirrored: string = namespaceTools.version
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.doesNotMatch(valid.code ?? "", /extern module/);

  const invalid = compile(`
extern module "text-tools":
    export const version: string
    export def lengthOf(value: string) -> number
    export def join(...values: string) -> string

import js {lengthOf, join, version} from "text-tools"
const size = lengthOf(12)
const label = join("Velar", 2)
version = "next"
`.trimStart());
  assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL4001" && /number to string/.test(item.message)).length, 2);
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to const binding 'version'/u.test(item.message)));

  const duplicate = compile(`
extern module "text-tools":
    export const format: string
    export def format(value: string) -> string
`.trimStart());
  assert.ok(duplicate.diagnostics.some((item) => /Extern export 'format' is declared more than once/u.test(item.message)));

  const unknown = compile(`
import js {mystery} from "mystery-package"
mystery()
`.trimStart());
  assert.ok(unknown.diagnostics.some((item) => /Cannot call an unknown JavaScript value/.test(item.message)));
});

test("safe JavaScript classes keep constructors, members, aliases, and nominal package identity", () => {
  const valid = compile(`
extern module "sdk-a":
    export class BaseClient(const id: string):
        static const family: string
        def label() -> string

    export class Client(id: string, const baseUrl: string, let timeoutMs: number = 1000) extends BaseClient:
        static const version: string
        def request(path: string) -> Promise<string>
        static def connect(baseUrl: string) -> Client

import js {BaseClient, Client as Remote} from "sdk-a"
import js * as sdk from "sdk-a"
type Session:
    client: Remote
const direct: Remote = Remote("id", "/api")
const base: BaseClient = direct
const inheritedId: string = direct.id
const family: string = Remote.family
direct.timeoutMs = 2000
const connected: Remote = Remote.connect("/next")
const namespaced = sdk.Client("id", "/namespace", 500)
const pending: Promise<string> = connected.request("/status")
const version: string = Remote.version
const session = Session.parse({client: direct})
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /new Remote\("id", "\/api"\)/u);
  assert.match(valid.code ?? "", /new sdk\.Client\("id", "\/namespace", 500\)/u);
  assert.match(valid.code ?? "", /instanceof Remote/u);
  assert.ok(valid.semanticIndex.expressions.some((expression) => expression.memberName === "request" && expression.type === "(string) -> Promise<string>"));

  const invalid = compile(`
extern module "sdk-a":
    export class Client(const baseUrl: string):
        static const version: string
        def request(path: string) -> Promise<string>

extern module "sdk-b":
    export class Client(baseUrl: string):
        pass

import js {Client as FirstClient} from "sdk-a"
import js {Client as SecondClient} from "sdk-b"
const first = FirstClient("/api")
const second: SecondClient = first
first.baseUrl = "/changed"
FirstClient.version = "2"
first.request(42)
SecondClient()
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign FirstClient to SecondClient/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to read-only member 'baseUrl'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to read-only static member 'version'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Expected 1 arguments but received 0/u.test(item.message)));

  const invalidInheritance = compile(`
extern module "bad-sdk":
    export class Base:
        def label(value: string) -> string

    export class Child extends Base:
        def label(value: number) -> string
`.trimStart());
  assert.ok(invalidInheritance.diagnostics.some((item) => /Extern override 'label' must keep the base method signature/u.test(item.message)));
});

test("limited TypeScript declarations bridge safe JavaScript imports without importing TypeScript's type system", async () => {
  const declarations = parseTypeScriptDeclarations(`
export interface FormatOptions {
  prefix?: string;
  precision: number;
}
export interface BaseClient {
  readonly version: string;
}
export interface Client extends BaseClient {
  request(path: string, timeoutMs?: number): Promise<string>;
  close?(): void;
}
export interface RecursiveClient extends RecursiveClient {
  value: string;
}
export interface GenericClient extends GenericBase<string> {
  value: string;
}
export declare function format(value: number, options?: FormatOptions): Promise<string>;
export declare function join(first: string, ...parts: readonly string[]): string;
export declare function unique(values: readonly string[]): ReadonlySet<string>;
export declare function visit(handler: (value: string) => void): void;
export declare const version: string;
export declare const client: Client;
export declare const recursiveClient: RecursiveClient;
export declare const genericClient: GenericClient;
export declare class BaseFormatter {
  readonly locale: string;
  static readonly family: string;
}
export declare class Formatter extends BaseFormatter {
  constructor(readonly prefix: string, precision?: number);
  precision: number;
  static readonly version: string;
  format(value: number, suffix?: string): string;
  setPrecision(value: number): this;
  visit(visitor: (label: string) => void): void;
  static create(prefix: string): Formatter;
}
export declare class GenericFormatter<T> {
  format(value: T): string;
}
export declare class BrokenFormatter extends BaseFormatter {
  readonly locale: number;
}
export declare function overloaded(value: string): string;
export declare function overloaded(value: number): number;
export declare function identity<T>(value: T): T;
`, "fixture/index.d.ts");
  assert.equal(describeType(declarations.exports.get("format")!), "(number, { prefix: string?, precision: number }?) -> Promise<string>");
  assert.equal(describeType(declarations.exports.get("join")!), "(string, ...string) -> string");
  assert.equal(describeType(declarations.exports.get("unique")!), "(List<string>) -> Set<string>");
  assert.equal(describeType(declarations.exports.get("visit")!), "((string) -> none) -> none");
  assert.equal(describeType(declarations.exports.get("version")!), "string");
  assert.equal(describeType(declarations.exports.get("client")!), "{ version: string, request: (string, number?) -> Promise<string>, close: (() -> none)? }");
  assert.equal(describeType(declarations.exports.get("recursiveClient")!), "unknown");
  assert.equal(describeType(declarations.exports.get("genericClient")!), "unknown");
  assert.equal(describeType(declarations.exports.get("Formatter")!), "Formatter");
  assert.equal(describeType(declarations.exports.get("GenericFormatter")!), "unknown");
  assert.equal(describeType(declarations.exports.get("BrokenFormatter")!), "unknown");
  assert.equal(declarations.classes.get("Formatter")?.requiredParameters, 1);
  assert.equal(declarations.classes.get("Formatter")?.base, declarations.classes.get("BaseFormatter")?.identity);
  assert.equal(declarations.classes.get("Formatter")!.fields.get("prefix")?.mutable, false);
  assert.equal(describeType(declarations.classes.get("Formatter")!.methods.get("format")!), "(number, string?) -> string");
  assert.equal(describeType(declarations.classes.get("Formatter")!.methods.get("setPrecision")!), "(number) -> Formatter");
  assert.equal(describeType(declarations.classes.get("Formatter")!.staticMethods.get("create")!), "(string) -> Formatter");
  assert.equal(describeType(declarations.classes.get("Formatter")!.staticFields.get("version")!.type), "string");
  assert.equal(describeType(declarations.exports.get("overloaded")!), "unknown");
  assert.equal(describeType(declarations.exports.get("identity")!), "unknown");
  assert.ok(declarations.warnings.some((warning) => /Overloaded export 'overloaded'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Recursive interface 'RecursiveClient'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Generic or complex interface base 'GenericBase<string>'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Generic function 'identity'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /GenericFormatter/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /incompatible inherited member contract/u.test(warning)));

  const directory = await mkdtemp(join(tmpdir(), "velar-dts-"));
  const packageRoot = join(directory, "node_modules", "typed-format");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "typed-format",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export class Formatter { static version = '1'; constructor(prefix) { this.prefix = prefix; this.precision = 1; } format(value) { return this.prefix + value.toFixed(this.precision); } static create(prefix) { return new Formatter(prefix); } }\nexport const format = value => String(value)\nexport const join = (first, ...parts) => [first, ...parts].join('')\nexport const visit = handler => handler('ready')\nexport const client = { version: '1', request: async path => path }\nexport const identity = value => value\n", "utf8");
  await writeFile(join(packageRoot, "core.d.ts"), "export declare class Formatter { constructor(prefix: string); readonly prefix: string; precision: number; static readonly version: string; format(value: number): string; static create(prefix: string): Formatter; }\nexport interface Client { readonly version: string; request(path: string, timeoutMs?: number): Promise<string>; }\nexport declare function format(value: number): string;\nexport declare function join(first: string, ...parts: readonly string[]): string;\nexport declare const client: Client;\nexport declare function identity<T>(value: T): T;\n", "utf8");
  await writeFile(join(packageRoot, "callbacks.d.ts"), "export declare function visit(handler: (value: string) => void): void;\n", "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), "export {Formatter, client, format, identity, join} from \"./core.js\";\nexport * from \"./callbacks\";\n", "utf8");
  const alternateRoot = join(directory, "node_modules", "typed-format-alt");
  await mkdir(alternateRoot, { recursive: true });
  await writeFile(join(alternateRoot, "package.json"), JSON.stringify({
    name: "typed-format-alt",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(alternateRoot, "index.js"), "export class Formatter { constructor(prefix) { this.prefix = prefix; } }\n", "utf8");
  await writeFile(join(alternateRoot, "index.d.ts"), "export declare class Formatter { constructor(prefix: string); readonly prefix: string; }\n", "utf8");

  const validPath = join(directory, "valid.vel");
  await writeFile(validPath, "import js {Formatter as NumberFormatter, client, format, join, visit} from \"typed-format\"\nconst formatter: NumberFormatter = NumberFormatter(\">\")\nformatter.precision = 2\nconst formatted: string = formatter.format(42)\nconst restored: NumberFormatter = NumberFormatter.create(\"~\")\nconst version: string = NumberFormatter.version\nconst label: string = format(42)\nconst joined: string = join(\"Velar\", \"Script\")\nconst requested: Promise<string> = client.request(\"/status\", 1000)\nvisit(value => print(value))\n", "utf8");
  const valid = await compileProject(validPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);

  const invalidPath = join(directory, "invalid.vel");
  await writeFile(invalidPath, "import js {Formatter, client, format, join, identity, visit} from \"typed-format\"\nimport js {Formatter as ForeignFormatter} from \"typed-format-alt\"\nconst formatter = Formatter(1)\nconst foreign: ForeignFormatter = formatter\nformatter.prefix = \"changed\"\nFormatter.version = \"2\"\nformatter.format(\"wrong\")\nconst label = format(\"wrong\")\nconst joined = join(\"Velar\", 2)\nclient.request(2)\nvisit(value => value + 1)\nidentity(1)\n", "utf8");
  const invalid = await compileProject(invalidPath);
  const invalidDiagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalidDiagnostics.filter((item) => /Cannot assign number to string/u.test(item.message)).length >= 3);
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only member 'prefix'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only static member 'version'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign Formatter to ForeignFormatter/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /String concatenation requires two strings/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot call an unknown JavaScript value/u.test(item.message)));
  assert.ok(invalid.notices.some((notice) => /Generic function 'identity'/u.test(notice.message)));
});

test("TypeScript declaration re-exports stay package-confined, bounded, and identity-preserving", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dts-graph-"));
  const sourceRoot = join(directory, "src");
  const packageRoot = join(directory, "node_modules", "graph-sdk");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "graph-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "class Base { constructor() { this.kind = 'client'; } }\nclass Client extends Base { constructor(id) { super(); this.id = id; } configure(options) { return options.prefix + this.id; } }\nexport {Client, Client as SameClient};\n", "utf8");
  await writeFile(join(packageRoot, "model.d.ts"), "export interface Options { prefix: string; }\nexport declare class Base { readonly kind: string; }\n", "utf8");
  await writeFile(join(packageRoot, "client.d.ts"), "import {Base, type Options} from \"./model\";\nexport declare class Client extends Base { constructor(readonly id: string); configure(options: Options): string; }\n", "utf8");
  await writeFile(join(packageRoot, "left.d.ts"), "export declare const version: string;\n", "utf8");
  await writeFile(join(packageRoot, "right.d.ts"), "export declare const version: number;\n", "utf8");
  await writeFile(join(packageRoot, "cycle-a.d.ts"), "export declare const local: string;\nexport * from \"./cycle-b\";\n", "utf8");
  await writeFile(join(packageRoot, "cycle-b.d.ts"), "export declare const remote: string;\nexport * from \"./cycle-a\";\n", "utf8");
  for (let index = 0; index < 18; index += 1) {
    await writeFile(
      join(packageRoot, `depth-${index}.d.ts`),
      index === 17 ? "export declare const tooDeep: string;\n" : `export * from "./depth-${index + 1}";\n`,
      "utf8",
    );
  }
  const outside = join(directory, "outside.d.ts");
  await writeFile(outside, "export declare const leaked: string;\n", "utf8");
  await symlink(outside, join(packageRoot, "leak.d.ts"));
  await writeFile(join(packageRoot, "index.d.ts"), `
export {Client, Client as SameClient, missing as Missing} from "./client.js";
export * from "./left";
export * from "./right";
export * from "./cycle-a";
export * from "./depth-0";
export {leaked} from "./leak";
`.trimStart(), "utf8");

  const bridge = await loadTypeScriptDeclarations("graph-sdk", join(sourceRoot, "main.vel"));
  assert.ok(bridge);
  const client = bridge.exports.get("Client");
  const sameClient = bridge.exports.get("SameClient");
  assert.equal(client?.kind, "classConstructor");
  assert.equal(sameClient?.kind, "classConstructor");
  assert.equal(
    client?.kind === "classConstructor" ? client.identity : null,
    sameClient?.kind === "classConstructor" ? sameClient.identity : null,
  );
  assert.equal(bridge.exports.get("Missing")?.kind, "unknown");
  assert.equal(bridge.exports.get("version")?.kind, "unknown");
  assert.equal(bridge.exports.get("local")?.kind, "string");
  assert.equal(bridge.exports.get("remote")?.kind, "string");
  assert.equal(bridge.exports.get("leaked")?.kind, "unknown");
  assert.equal(bridge.exports.has("tooDeep"), false);
  assert.ok(bridge.warnings.some((warning) => /Ambiguous declaration star export 'version'/u.test(warning)));
  assert.ok(bridge.warnings.some((warning) => /Cyclic TypeScript declaration re-export/u.test(warning)));
  assert.ok(bridge.warnings.some((warning) => /not a package-local \.d\.ts file/u.test(warning)));
  assert.ok(bridge.warnings.some((warning) => /re-export depth exceeds 16/u.test(warning)));

  const entry = join(sourceRoot, "main.vel");
  await writeFile(entry, "import js {Client as Primary, SameClient as Alias} from \"graph-sdk\"\nconst first = Primary(\"one\")\nconst same: Alias = first\nconst kind: string = first.kind\nconst configured: string = first.configure({prefix: \"ready:\"})\n", "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});

test("TypeScript declaration local export tables preserve runtime and type boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dts-local-exports-"));
  const sourceRoot = join(directory, "src");
  const packageRoot = join(directory, "node_modules", "bundled-sdk");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "bundled-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), `
class BundledClient {
  constructor(id) { this.id = id; this._timeout = 1000; }
  get label() { return "client:" + this.id; }
  get timeout() { return this._timeout; }
  set timeout(value) { this._timeout = value; }
  request(path) { return this.id + ":" + path; }
  static get standard() { return new BundledClient("standard"); }
}
function createClient(id) { return new BundledClient(id); }
const version = "1";
export {BundledClient, BundledClient as BundledAlias, createClient, version};
export default BundledClient;
`.trimStart(), "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), `
declare class BundledClient {
  constructor(readonly id: string);
  get label(): string;
  get timeout(): number;
  set timeout(value: number);
  request(path: string): string;
  static get standard(): BundledClient;
}
declare function createClient(id: string): BundledClient;
declare const version: string;
interface BundledOptions { prefix: string; }
export {BundledClient, BundledClient as BundledAlias, createClient, version};
export type {BundledOptions};
export default BundledClient;
`.trimStart(), "utf8");

  const entry = join(sourceRoot, "main.vel");
  const bridge = await loadTypeScriptDeclarations("bundled-sdk", entry);
  assert.ok(bridge);
  const client = bridge.exports.get("BundledClient");
  const alias = bridge.exports.get("BundledAlias");
  const defaultClient = bridge.exports.get("default");
  assert.equal(client?.kind, "classConstructor");
  assert.equal(alias?.kind, "classConstructor");
  assert.equal(defaultClient?.kind, "classConstructor");
  assert.equal(client?.kind === "classConstructor" ? client.identity : null, alias?.kind === "classConstructor" ? alias.identity : null);
  assert.equal(client?.kind === "classConstructor" ? client.identity : null, defaultClient?.kind === "classConstructor" ? defaultClient.identity : null);
  assert.equal(bridge.exports.get("createClient")?.kind, "function");
  assert.equal(bridge.exports.get("version")?.kind, "string");
  assert.equal(bridge.exports.has("BundledOptions"), false);
  assert.equal(bridge.typeExports.get("BundledOptions")?.kind, "object");
  assert.equal(bridge.classes.get("BundledClient")?.fields.get("label")?.mutable, false);
  assert.equal(bridge.classes.get("BundledClient")?.fields.get("timeout")?.mutable, true);
  assert.equal(bridge.classes.get("BundledClient")?.staticFields.get("standard")?.mutable, false);
  assert.deepEqual(bridge.warnings, []);

  await writeFile(entry, `
import js {BundledClient as Client, BundledAlias, createClient, version} from "bundled-sdk"
const direct = Client("one")
const same: BundledAlias = direct
const created = createClient("two")
created.timeout = 250
const directLabel: string = direct.request("status")
const createdLabel: string = created.request(version)
const id: string = created.id
const label: string = created.label
const standardLabel: string = Client.standard.label
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  await writeFile(entry, "import js {BundledClient as Client} from \"bundled-sdk\"\nconst client = Client(\"one\")\nclient.label = \"changed\"\nClient.standard = client\n", "utf8");
  const readonly = await compileProject(entry);
  const diagnostics = readonly.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(diagnostics.some((item) => /read-only member 'label'/u.test(item.message)));
  assert.ok(diagnostics.some((item) => /read-only static member 'standard'/u.test(item.message)));

  const unsupported = parseTypeScriptDeclarations("export declare class Broken { set value(next: string); get mixed(): string; set mixed(next: number); }\n");
  assert.equal(unsupported.exports.get("Broken")?.kind, "unknown");
  assert.ok(unsupported.warnings.some((warning) => /Setter-only class accessor 'value'/u.test(warning)));
  assert.ok(unsupported.warnings.some((warning) => /incompatible getter and setter types/u.test(warning)));
});

test("TypeScript declarations follow package export subpaths without losing identity or confinement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dts-subpaths-"));
  const sourceRoot = join(directory, "src");
  const packageRoot = join(directory, "node_modules", "subpath-sdk");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(join(packageRoot, "dist", "feature"), { recursive: true });
  await mkdir(join(packageRoot, "types", "feature"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "subpath-sdk",
    type: "module",
    exports: {
      ".": { types: "./types/index.d.ts", default: "./dist/index.js" },
      "./client": { types: "./types/client.d.mts", default: "./dist/client.js" },
      "./feature/*": { types: "./types/feature/*.d.cts", default: "./dist/feature/*.cjs" },
      "./escaped": { types: "../outside.d.ts", default: "./dist/escaped.js" },
    },
  }), "utf8");
  await writeFile(join(packageRoot, "dist", "package.json"), JSON.stringify({ type: "module" }), "utf8");
  const clientRuntime = "export class Client { constructor(id) { this.id = id; } label() { return this.id; } }\n";
  await writeFile(join(packageRoot, "dist", "client.js"), clientRuntime, "utf8");
  await writeFile(join(packageRoot, "dist", "index.js"), "export {Client} from './client.js';\n", "utf8");
  await writeFile(join(packageRoot, "dist", "feature", "math.cjs"), "exports.scale = (value, factor) => value * factor;\n", "utf8");
  await writeFile(join(packageRoot, "dist", "escaped.js"), "export const escaped = true;\n", "utf8");
  await writeFile(join(packageRoot, "types", "client.d.mts"), "declare class Client { constructor(readonly id: string); label(): string; }\nexport {Client};\n", "utf8");
  await writeFile(join(packageRoot, "types", "index.d.ts"), "export {Client} from './client.mjs';\n", "utf8");
  await writeFile(join(packageRoot, "types", "feature", "math.d.cts"), "export declare function scale(value: number, factor: number): number;\n", "utf8");
  await writeFile(join(directory, "outside.d.ts"), "export declare const escaped: boolean;\n", "utf8");

  const entry = join(sourceRoot, "main.vel");
  const root = await loadTypeScriptDeclarations("subpath-sdk", entry);
  const direct = await loadTypeScriptDeclarations("subpath-sdk/client", entry);
  const feature = await loadTypeScriptDeclarations("subpath-sdk/feature/math", entry);
  assert.ok(root);
  assert.ok(direct);
  assert.ok(feature);
  const rootClient = root.exports.get("Client");
  const directClient = direct.exports.get("Client");
  assert.equal(rootClient?.kind, "classConstructor");
  assert.equal(directClient?.kind, "classConstructor");
  assert.equal(rootClient?.kind === "classConstructor" ? rootClient.identity : null, directClient?.kind === "classConstructor" ? directClient.identity : null);
  assert.equal(feature.exports.get("scale")?.kind, "function");
  assert.equal(await loadTypeScriptDeclarations("subpath-sdk/escaped", entry), null);

  await writeFile(entry, `
import js {Client as RootClient} from "subpath-sdk"
import js {Client as DirectClient} from "subpath-sdk/client"
import js {scale} from "subpath-sdk/feature/math"
const client = RootClient("ready")
const same: DirectClient = client
const label: string = same.label()
const value: number = scale(2, 3)
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});

test("supports safe object shorthand plus object and list destructuring with spread", () => {
  const result = compile(`
const base = {name: "Ada", score: 1}
const score = 2
const merged = {...base, score}
const {name, ...details} = merged
const source = [1, 2]
const [first, ...rest] = [0, ...source]
print(f"{name}:{details.score}:{first}:{rest.length}")
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

test("uses native Set with list construction, inference, mutation, and iteration", () => {
  const result = compile(`
type TagBucket:
    values: Set<string>

const tags = Set(["velar", "web", "velar"])
tags.add("game")
print(tags.size)
print(tags.has("web"))
print(tags.remove("web"))
for tag in tags:
    print(tag)

const inferred = Set()
inferred.add(7)
print(inferred.has(7))

const parsed = TagBucket.parse({values: Set(["typed"])})
print(parsed.values.size)
tags.clear()
print(tags.size)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const tags = __velarCreateSet\(\["velar", "web", "velar"\]\);/u);
  assert.match(result.code ?? "", /__velarCollectionAdd\(tags, "game"\)/u);
  assert.match(result.code ?? "", /__velarSetTypeIs\(value\["values"\]/u);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "inferred")?.type, "Set<number>");
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\ntrue\ntrue\nvelar\ngame\ntrue\n1\n0\n");
});

test("Set rejects invalid construction, element mutation, annotations, and shadowing", () => {
  const result = compile(`
const invalid = Set(1)
const names: Set<string> = Set([1])
const inferred = Set()
inferred.add(1)
inferred.add("wrong")
const Set = "shadow"
`.trimStart());

  assert.ok(result.diagnostics.some((item) => /Set construction requires a List or Set/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => /Cannot assign Set<number> to Set<string>/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && /reserved Core binding/u.test(item.message)));

  const arity = compile("const values: Set<string> = Set()\n");
  assert.deepEqual(arity.diagnostics, []);
  assert.equal(arity.semanticIndex.symbols.find((symbol) => symbol.name === "values")?.type, "Set<string>");

  const malformedType = compile("const values: Set<string, number> = Set()\n");
  assert.ok(malformedType.diagnostics.some((item) => item.code === "VEL2012" && /expects 1 type argument/u.test(item.message)));
});

test("Map and Set expose typed ordered snapshots without iterator leakage", () => {
  const result = compile(`
const scores = Map()
scores.set("Ada", 9)
scores.set("Lin", 7)
const names = scores.keys()
const values = scores.values()
const entries = scores.entries()
const copiedScores = Map(scores)
const tags = Set(["web", "game"])
const copied = tags.values()
print(f"{names[0]}:{values[1]}:{entries[0].key}:{entries[0].value}:{copied[1]}")
print(copiedScores.get("Ada") ?? 0)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "entries")?.type, "List<{ key: string, value: number }>");
  assert.match(result.code ?? "", /__velarCollectionEntries\(scores\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada:7:Ada:9:game\n9\n");

  const invalid = compile("const bad = Map(1)\n");
  assert.ok(invalid.diagnostics.some((item) => /Map construction requires another Map/u.test(item.message)));
});

test("predeclares top-level functions and rejects incomplete typed returns", () => {
  const forward = compile(`
def first() -> number:
    return second()

def second() -> number:
    return 2
`.trimStart());
  assert.deepEqual(forward.diagnostics, []);

  const incomplete = compile(`
def choose(flag: bool) -> number:
    if flag:
        return 1
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => item.code === "VEL4006"));
});

test("formatter is conservative and idempotent", () => {
  const source = "type ChooseHandler = (string) -> none  \r\ncomponent App:  \r\n\t// keep me\r\n\tresource label: string = loadLabel()   \r\n\tconst choose: ChooseHandler = value => none\r\n\taction refresh() -> none:\r\n\t\tawait label.reload()\r\n\t\treturn none\r\n\treturn <main>{label.value}</main>\r\n";
  const formatted = formatSource(source);
  assert.equal(formatted, "type ChooseHandler = (string) -> none\ncomponent App:\n    // keep me\n    resource label: string = loadLabel()\n    const choose: ChooseHandler = value => none\n    action refresh() -> none:\n        await label.reload()\n        return none\n    return <main>{label.value}</main>\n");
  assert.equal(formatSource(formatted), formatted);
});

test("CLI format supports write and check modes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-format-"));
  const sourcePath = join(directory, "main.vel");
  await writeFile(sourcePath, "def main():  \n  return none  \n", "utf8");

  const before = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath, "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(before.status, 1);
  const write = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(write.status, 0, write.stderr);
  const after = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath, "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(await readFile(sourcePath, "utf8"), "def main():\n    return none\n");
});

test("project builds enforce imported Velar signatures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-module-types-"));
  const library = join(directory, "models.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export type User:
    name: string

export def greet(user: User) -> string:
    return user.name
`.trimStart(), "utf8");
  await writeFile(entry, `
import {User as Person, greet} from "./models.vel"
const person: Person = {name: 42}
print(greet(person))
`.trimStart(), "utf8");

  const execution = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "check", entry], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /Cannot assign .* to Person/);
});

test("component callback types cross module and editor boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-callback-props-"));
  const domainPath = join(directory, "domain.vel");
  const itemPath = join(directory, "item.vel");
  const validPath = join(directory, "valid.vel");
  const invalidPath = join(directory, "invalid.vel");
  const childrenPath = join(directory, "children.vel");
  const svgPath = join(directory, "svg.vel");
  await writeFile(domainPath, `
export type ChooseHandler = (string) -> none
`.trimStart(), "utf8");
  await writeFile(itemPath, `
import {ChooseHandler} from "./domain.vel"

export component Item(label: string, onChoose: ChooseHandler):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>
`.trimStart(), "utf8");
  await writeFile(validPath, `
import {ChooseHandler as Handler} from "./domain.vel"
import {Item as Choice} from "./item.vel"
const choose: Handler = Handler.parse(label => none)
component App:
    return <Choice label="Velar" onChoose={choose} />
`.trimStart(), "utf8");
  await writeFile(invalidPath, `
import {Item} from "./item.vel"
def choose(value: number) -> none:
    return none
component App:
    return <Item label="Velar" onChoose={choose} />
`.trimStart(), "utf8");
  const childrenSource = `
component Wrapper(children: WebNode):
    return <section>{children}</section>
component App:
    return <Wrapper><p>Content</p></Wrapper>
`.trimStart();
  await writeFile(childrenPath, childrenSource, "utf8");
  const svgSource = `
component Chart:
    return <svg aria-label="Traffic" viewBox="0 0 100 40"><rect x="4" y="4" width="20" height="30" /><foreignObject x="30" y="4" width="60" height="30"><div>Summary</div></foreignObject></svg>
`.trimStart();
  await writeFile(svgPath, svgSource, "utf8");

  const valid = await compileProject(validPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  const invalid = await compileProject(invalidPath);
  assert.ok(invalid.modules.flatMap((module) => module.result.diagnostics).some((item) => /Cannot assign \(number\) -> none to \(string\) -> none/u.test(item.message)));
  const childrenProject = await compileProject(childrenPath);
  assert.deepEqual(childrenProject.modules.flatMap((module) => module.result.diagnostics), []);
  const svgProject = await compileProject(svgPath);
  assert.deepEqual(svgProject.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(projectRenameAt(childrenProject, childrenPath, childrenSource.indexOf("children: WebNode") + 1, "content"),
    "The JSX children prop cannot be renamed");
  const itemSource = await readFile(itemPath, "utf8");
  const validSource = await readFile(validPath, "utf8");
  const labelDeclaration = itemSource.indexOf("label: string");
  const labelAttribute = validSource.indexOf("label=\"Velar\"");
  const validModule = valid.modules.find((module) => module.inputPath === validPath)!;
  assert.deepEqual(validModule.result.semanticIndex.memberReferences.find((reference) => reference.span.start === labelAttribute), {
    name: "label",
    path: validPath,
    span: { start: labelAttribute, end: labelAttribute + "label".length },
    ownerType: "Choice",
    ownerKind: "componentConstructor",
    syntax: "jsx-prop",
    shorthand: false,
  });
  assert.equal(projectCompletionContextAt(valid, validPath, labelAttribute), "component-attribute");
  const propCompletions = projectCompletionsAt(valid, validPath, labelAttribute);
  assert.ok(propCompletions.some((item) => item.label === "label" && item.detail === "string"));
  assert.ok(propCompletions.some((item) => item.label === "onChoose" && item.detail === "(string) -> none"));
  assert.ok(propCompletions.some((item) => item.label === "key"));
  assert.ok(!propCompletions.some((item) => item.label === "const"));
  const nativeAttribute = itemSource.indexOf("type=\"button\"");
  assert.equal(projectCompletionContextAt(valid, itemPath, nativeAttribute), "native-attribute");
  const nativeCompletions = projectCompletionsAt(valid, itemPath, nativeAttribute);
  assert.ok(nativeCompletions.some((item) => item.label === "aria-label"));
  assert.ok(nativeCompletions.some((item) => item.label === "on:click"));
  assert.ok(!nativeCompletions.some((item) => item.label === "while"));
  const componentTag = validSource.indexOf("<Choice") + "<Ch".length;
  assert.equal(projectCompletionContextAt(valid, validPath, componentTag), "jsx-tag");
  const componentTags = projectCompletionsAt(valid, validPath, componentTag);
  assert.ok(componentTags.some((item) => item.label === "Choice" && item.detail?.startsWith("component ")));
  assert.deepEqual(componentTags.map((item) => item.label), ["Choice"]);
  assert.ok(!componentTags.some((item) => item.label === "while"));
  const nativeClosingTag = itemSource.indexOf("</button>") + "</bu".length;
  assert.equal(projectCompletionContextAt(valid, itemPath, nativeClosingTag), "jsx-tag");
  assert.ok(projectCompletionsAt(valid, itemPath, nativeClosingTag).some((item) => item.label === "button"));
  const svgTag = svgSource.indexOf("<svg") + "<sv".length;
  assert.deepEqual(projectCompletionsAt(svgProject, svgPath, svgTag).map((item) => item.label), ["svg"]);
  const foreignObjectTag = svgSource.indexOf("<foreignObject") + "<foreignO".length;
  assert.deepEqual(projectCompletionsAt(svgProject, svgPath, foreignObjectTag).map((item) => item.label), ["foreignObject"]);
  const svgAttribute = svgSource.indexOf("viewBox");
  const svgCompletions = projectCompletionsAt(svgProject, svgPath, svgAttribute);
  assert.ok(svgCompletions.some((item) => item.label === "viewBox" && item.detail === "native SVG attribute"));
  assert.ok(svgCompletions.some((item) => item.label === "stroke-width"));
  assert.deepEqual(projectDefinitionAt(valid, validPath, labelAttribute + 1), {
    path: itemPath,
    span: { start: labelDeclaration, end: labelDeclaration + "label".length },
  });
  assert.equal(projectMemberSymbolAt(valid, validPath, labelAttribute + 1)?.type, "string");
  const labelReferences = projectReferencesAt(valid, itemPath, labelDeclaration + 1, true);
  assert.equal(labelReferences.length, 4);
  assert.equal(projectRenameAt(valid, itemPath, labelDeclaration + 1, "onChoose"), "The new name collides with another declaration");
  const labelRename = projectRenameAt(valid, validPath, labelAttribute + 1, "text");
  assert.notEqual(typeof labelRename, "string");
  if (typeof labelRename !== "string") {
    assert.equal(labelRename.edits.length, 4);
    const editsByPath = new Map<string, typeof labelRename.edits[number][]>();
    for (const edit of labelRename.edits) {
      const edits = editsByPath.get(edit.path) ?? [];
      edits.push(edit);
      editsByPath.set(edit.path, edits);
    }
    for (const [editPath, edits] of editsByPath) {
      let updated = await readFile(editPath, "utf8");
      for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
        updated = `${updated.slice(0, edit.span.start)}${edit.replacement ?? "text"}${updated.slice(edit.span.end)}`;
      }
      await writeFile(editPath, updated, "utf8");
    }
    const renamed = await compileProject(validPath);
    assert.deepEqual(renamed.failures, []);
    assert.deepEqual(renamed.modules.flatMap((module) => module.result.diagnostics), []);
  }
});

test("project builds preserve enum identities and aliases across modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-enum-module-"));
  const library = join(directory, "workflow.vel");
  const otherLibrary = join(directory, "other-workflow.vel");
  const store = join(directory, "store.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export enum TaskStatus:
    todo
    doing
    done

export def advance(status: TaskStatus) -> TaskStatus:
    match status:
        case TaskStatus.todo:
            return TaskStatus.doing
        case TaskStatus.doing, TaskStatus.done:
            return TaskStatus.done
`.trimStart(), "utf8");
  await writeFile(store, `
import {TaskStatus} from "./workflow.vel"
export state current: TaskStatus = TaskStatus.todo
`.trimStart(), "utf8");
  await writeFile(otherLibrary, `
export enum TaskStatus:
    todo
    doing
    done
`.trimStart(), "utf8");
  await writeFile(entry, `
import {TaskStatus as Status, advance} from "./workflow.vel"
import {current} from "./store.vel"

const initial: Status = Status.todo
const next: Status = advance(current)
const parsed: Status = Status.parse("todo")
print(next)
`.trimStart(), "utf8");

  const valid = await compileProject(entry);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(valid.modules.find((module) => module.inputPath === entry)?.result.semanticIndex.symbols.find((symbol) => symbol.name === "next")?.type, "Status");
  const validSource = await readFile(entry, "utf8");
  const enumMember = validSource.indexOf("Status.todo") + "Status.".length;
  const definition = projectDefinitionAt(valid, entry, enumMember);
  assert.equal(definition?.path, library);
  assert.equal((await readFile(library, "utf8")).slice(definition?.span.start, definition?.span.end), "todo");
  assert.equal(projectSymbolAt(valid, entry, enumMember)?.kind, "enum-member");
  assert.deepEqual(projectCompletionsAt(valid, entry, enumMember).map((item) => item.label), ["todo", "doing", "done", "is", "parse"]);
  const parseCall = validSource.indexOf("Status.parse(") + "Status.parse(".length;
  assert.deepEqual(projectSignatureAt(valid, entry, parseCall), {
    label: "parse(unknown) -> Status",
    activeParameter: 0,
  });
  const memberReferences = projectReferencesAt(valid, entry, enumMember, true);
  assert.equal(memberReferences.length, 4);
  assert.ok(memberReferences.every((location) => valid.modules
    .find((module) => module.inputPath === location.path)?.result.source.text.slice(location.span.start, location.span.end) === "todo"));
  const memberRename = projectRenameAt(valid, entry, enumMember, "pending");
  assert.notEqual(typeof memberRename, "string");
  if (typeof memberRename !== "string") {
    assert.equal(memberRename.placeholder, "todo");
    assert.deepEqual(memberRename.edits, memberReferences);
  }
  assert.equal(projectRenameAt(valid, entry, enumMember, "doing"), "The new name collides with another declaration");

  await writeFile(entry, `
import {TaskStatus as Status, advance} from "./workflow.vel"
const current: Status = "todo"
print(advance(current))
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.ok(invalid.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign string to Status/u.test(item.message))));

  await writeFile(entry, `
import {TaskStatus as WorkflowStatus} from "./workflow.vel"
import {TaskStatus as OtherStatus} from "./other-workflow.vel"
const current: WorkflowStatus = OtherStatus.todo
`.trimStart(), "utf8");
  const foreignIdentity = await compileProject(entry);
  assert.ok(foreignIdentity.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign OtherStatus to WorkflowStatus/u.test(item.message))));
});

test("rest signatures retain class element types across module and editor boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-rest-module-"));
  const library = join(directory, "items.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export class Item(const name: string):
    pass

export def count(first: Item, ...others: Item) -> number:
    return others.length + 1
`.trimStart(), "utf8");
  const validSource = `
import {Item as Product, count} from "./items.vel"
const first = Product("first")
const amount = count(first, Product("second"), Product("third"))
print(amount)
`.trimStart();
  await writeFile(entry, validSource, "utf8");

  const valid = await compileProject(entry);
  assert.deepEqual(valid.failures, []);
  assert.ok(valid.modules.every((module) => module.result.diagnostics.length === 0));
  const signatureOffset = validSource.indexOf("Product(\"second\")") + 2;
  const signature = projectSignatureAt(valid, entry, signatureOffset);
  assert.equal(signature?.label, "count(Item, ...Item) -> number");
  assert.equal(signature?.activeParameter, 1);

  await writeFile(entry, `
import {Item as Product, count} from "./items.vel"
const first = Product("first")
print(count(first, "wrong"))
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.ok(invalid.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign string to Product/u.test(item.message))));
});

test("Set element contracts cross module aliases and signature help", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-set-module-"));
  const library = join(directory, "tags.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export class Tag(const name: string):
    pass

export def count(tags: Set<Tag>) -> number:
    return tags.size
`.trimStart(), "utf8");
  const validSource = `
import {Tag as Label, count} from "./tags.vel"
const tags: Set<Label> = Set([Label("velar")])
print(count(tags))
`.trimStart();
  await writeFile(entry, validSource, "utf8");

  const valid = await compileProject(entry);
  assert.deepEqual(valid.failures, []);
  assert.ok(valid.modules.every((module) => module.result.diagnostics.length === 0));
  const signature = projectSignatureAt(valid, entry, validSource.indexOf("tags))") + 2);
  assert.equal(signature?.label, "count(Set<Tag>) -> number");

  await writeFile(entry, `
import {count} from "./tags.vel"
const tags = Set(["wrong"])
print(count(tags))
`.trimStart(), "utf8");
  const invalid = await compileProject(entry);
  assert.ok(invalid.modules.some((module) => module.inputPath === entry
    && module.result.diagnostics.some((item) => /Cannot assign Set<string> to Set<Tag>/u.test(item.message))));
});

test("supports reduce callbacks, map key iteration, and friendly core builtins", () => {
  const result = compile(`
const values = [1, 2, 3]
const total = values.reduce((sum, value) => sum + value, 0)
const lookup = Map()
lookup.set("first", total)
for key in lookup:
    print(f"{key}:{str(total)}")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /of lookup\.keys\(\)/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:6\n");
});

test("CLI source maps lead runtime stacks back to .vel source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-source-map-"));
  const sourcePath = join(directory, "main.vel");
  const outputPath = join(directory, "main.js");
  await writeFile(sourcePath, "const values = [1]\nprint(values[4])\n", "utf8");
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", sourcePath, "--out", outputPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);

  const execution = spawnSync(process.execPath, ["--enable-source-maps", outputPath], { encoding: "utf8" });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, new RegExp(`${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:2:`));
});

test("imported classes preserve construction, aliases, and nominal checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-module-class-"));
  const output = join(directory, "dist");
  await writeFile(join(directory, "models.vel"), `
export class Player(const name: string):
    def label() -> string:
        return self.name
`.trimStart(), "utf8");
  await writeFile(join(directory, "main.vel"), `
import {Player as Hero} from "./models.vel"
const player = Hero("Nova")
print(player.label())
print(player is Hero)
`.trimStart(), "utf8");
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", join(directory, "main.vel"), "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Nova\ntrue\n");
});

test("Velar classes use module identities instead of colliding display names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-class-identity-"));
  await writeFile(join(directory, "first.vel"), "export class Session(const id: string):\n    pass\n", "utf8");
  await writeFile(join(directory, "second.vel"), "export class Session(const id: string):\n    pass\n", "utf8");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {Session as FirstSession} from "./first.vel"
import {Session as SameSession} from "./first.vel"
import {Session as SecondSession} from "./second.vel"
const first = FirstSession("one")
const same: SameSession = first
const wrong: SecondSession = first
`.trimStart(), "utf8");

  const result = await compileProject(entry);
  const diagnostics = result.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(diagnostics.filter((item) => /Cannot assign/u.test(item.message)).length, 1);
  assert.ok(diagnostics.some((item) => /Cannot assign FirstSession to SecondSession/u.test(item.message)));
});

test("class inheritance, abstract contracts, super, static methods, and Error remain native JavaScript", () => {
  const result = compile(`
abstract class Shape:
    abstract def area() -> number

class Circle(const radius: number) extends Shape:
    override def area() -> number:
        return self.radius * self.radius

class Entity(const id: string):
    def describe() -> string:
        return self.id

class Player(const id: string, let score: number = 0) extends Entity(id):
    override def describe() -> string:
        return f"{super.describe()}:{self.score}"

    static def guest() -> Player:
        return Player("guest", 1)

class ValidationError(const field: string, const message: string) extends Error(message):
    pass

const shape: Shape = Circle(3)
const entity: Entity = Player.guest()
const error: Error = ValidationError("name", "Required")
print(shape.area())
print(entity.describe())
print(entity is Entity)
print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /class Circle extends Shape/);
  assert.match(result.code ?? "", /super\(\);/);
  assert.match(result.code ?? "", /class Player extends Entity/);
  assert.match(result.code ?? "", /super\(id\);/);
  assert.match(result.code ?? "", /static guest\(\)/);
  assert.match(result.code ?? "", /class ValidationError extends Error/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "9\nguest:1\ntrue\nRequired\n");
});

test("class init runs once after base construction, fields, and method binding", () => {
  const result = compile(`
def invoke(callback: () -> none):
    callback()

class Base(let steps: List<string>):
    init:
        self.steps.append("base")

class Child(steps: List<string>, const value: number) extends Base(steps):
    let doubled: number = value * 2

    def record():
        self.steps.append(f"value:{self.doubled}")

    init:
        assert value > 0, "Value must be positive"
        invoke(self.record)

const steps: List<string> = []
const child = Child(steps, 3)
print(steps[0])
print(steps[1])
print(child.doubled)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /this\.doubled = \(value \* 2\);\s+this\.record = this\.record\.bind\(this\);\s+const self = this;/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "base\nvalue:6\n6\n");
});

test("class init owns one synchronous non-returning execution boundary", () => {
  const valid = compile(`
async def ready() -> number:
    return 1

class Scheduler:
    init:
        async def later() -> number:
            return await ready()
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);

  const direct = compile(`
async def ready() -> number:
    return 1

class Invalid:
    init:
        const value = await ready()
        return none
`.trimStart());
  assert.ok(direct.diagnostics.some((item) => item.code === "VEL4007" && /class init block/u.test(item.message)));
  assert.ok(direct.diagnostics.some((item) => item.code === "VEL3014" && /class init block/u.test(item.message)));

  const duplicate = compile("class Invalid:\n    init:\n        pass\n    init:\n        pass\n");
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL2022" && /more than one init block/u.test(item.message)));

  for (const modifier of ["async", "static", "override", "abstract"]) {
    const modified = compile(`class Invalid:\n    ${modifier} init:\n        pass\n`);
    assert.ok(modified.diagnostics.some((item) => item.code === "VEL2022" && /does not accept modifiers/u.test(item.message)), JSON.stringify(modified.diagnostics));
  }
});

test("init remains a contextual class word instead of a reserved identifier", () => {
  const result = compile(`
type Options:
    init: string

class Worker(const label: string):
    init:
        assert label.length > 0

    def init(suffix: string) -> string:
        return self.label + suffix

const init: string = "ready"
const options: Options = {init}
const worker = Worker("Velar")
print(options.init)
print(worker.init("!"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\nVelar!\n");
});

test("class body fields keep body-owned instance state out of constructor signatures", () => {
  const result = compile(`
class Ledger(const label: string):
    static const kind: string = "ledger"
    static let created: number = 0
    const display: string = f"{label} ledger"
    const entries: List<number> = []
    let total: number = 0

    def add(value: number):
        self.entries.append(value)
        self.total += value

    def summary() -> string:
        return f"{self.display}:{self.total}:{self.entries.length}"

const ledger = Ledger("main")
Ledger.created += 1
ledger.add(4)
ledger.add(7)
print(Ledger.kind)
print(Ledger.created)
print(ledger.summary())
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /static kind = "ledger";/u);
  assert.match(result.code ?? "", /constructor\(label\) \{\s+this\.label = label;\s+this\.display = `\$\{label\} ledger`;\s+this\.entries = \[\];\s+this\.total = 0;/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ledger\n1\nmain ledger:11:2\n");

  const invalidSyntax = compile(`
class Broken:
    const missing = 1
    async const delayed: number = 1
`.trimStart());
  assert.ok(invalidSyntax.diagnostics.some((item) => item.code === "VEL2021" && /require an explicit type/u.test(item.message)));
  assert.ok(invalidSyntax.diagnostics.some((item) => /Class fields support only the 'private' and 'static' modifiers/u.test(item.message)));

  const invalidSemantics = compile(`
class Broken:
    const code: string = "broken"
    let count: number = "one"
    const delayed: number = await load()
    static const name: string = "broken"
    static def name() -> string:
        return "duplicate"

const value = Broken()
value.code = "changed"
Broken.name = "changed"
`.trimStart());
  assert.ok(invalidSemantics.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /'await' cannot be used in a class field initializer/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /conflicts with a static field/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /Cannot assign to const field 'code'/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /Cannot assign to read-only static member 'name'/u.test(item.message)));
});

test("class getters expose native read-only derived properties with explicit inheritance", () => {
  const result = compile(`
abstract class Metric:
    abstract get label() -> string

class BaseMetric(const name: string):
    get label() -> string:
        return self.name

class Score(const name: string, private const points: number) extends BaseMetric(name):
    private static get internalUnit() -> string:
        return "pt"

    private get doubled() -> number:
        return self.points * 2

    override get label() -> string:
        return f"{super.label}:{self.doubled}"

    static get unit() -> string:
        return Score.internalUnit

    def same(other: Score) -> bool:
        return self.doubled == other.doubled

const metric: BaseMetric = Score("Velar", 21)
const score = Score("Velar", 21)
print(metric.label)
print(Score.unit)
print(score.same(Score("Velar", 21)))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /get label\(\)/u);
  assert.match(result.code ?? "", /get #doubled\(\)/u);
  assert.match(result.code ?? "", /static get #internalUnit\(\)/u);
  assert.match(result.code ?? "", /static get unit\(\)/u);
  assert.match(result.code ?? "", /super\.label/u);
  const info = result.moduleInterface.classes.get("Score");
  assert.equal(info?.fields.get("label")?.mutable, false);
  assert.equal(info?.getters.has("label"), true);
  assert.equal(info?.staticGetters.has("unit"), true);
  assert.equal(info?.fields.has("doubled"), false);
  assert.equal(info?.staticFields.has("internalUnit"), false);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Velar:42\npt\ntrue\n");

  const invalid = compile(`
abstract class Contract:
    abstract get value() -> number

class Missing extends Contract:
    pass

class Wrong extends Contract:
    get value() -> number:
        return 1

class WrongType extends Contract:
    override get value() -> string:
        return "wrong"

class Mutable:
    let value: number = 1
    get value() -> number:
        return 2

class Secret:
    private get hidden() -> string:
        return "hidden"
    static get kind() -> string:
        return "secret"

const wrong = WrongType()
wrong.value = "changed"
const secret = Secret()
print(secret.hidden)
Secret.kind = "changed"
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /must implement abstract method: value/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /must use 'override'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /must keep the base result number/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /conflicts with a field/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to getter 'value'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /is private to class 'Secret'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to read-only static member 'kind'/u.test(item.message)));

  const asynchronous = compile("class AsyncValue:\n    async get value() -> number:\n        return 1\n");
  assert.ok(asynchronous.diagnostics.some((item) => /getter cannot be async/u.test(item.message)));
  const malformed = compile("class Broken:\n    get value(input: number):\n        return input\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2023" && /cannot accept parameters/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2023" && /requires an explicit result type/u.test(item.message)));

  const propertyNames = compile(`
type Flags:
    get: bool

class Box:
    const get: string = "field"

class Label:
    def get() -> string:
        return "method"

const get: string = "binding"
const flags: Flags = {get: true}
print(get)
print(flags.get)
print(Box().get)
print(Label().get())
`.trimStart());
  assert.deepEqual(propertyNames.diagnostics, []);
});

test("private class members preserve native encapsulation without a visibility hierarchy", () => {
  const result = compile(`
class Vault(private const secret: string):
    private static const category: string = "vault"
    private static const fullCategory: string = Vault.category + "-store"
    private const prefix: string = "token"
    private let reads: number = 0

    private def reveal(suffix: string) -> string:
        self.reads += 1
        return f"{self.prefix}:{self.secret}:{suffix}:{self.reads}"

    private static def label() -> string:
        return Vault.fullCategory

    private async def revealLater() -> string:
        return self.reveal("async")

    private static async def labelLater() -> string:
        return Vault.category

    def open(suffix: string) -> string:
        return self.reveal(suffix)

    def matches(other: Vault) -> bool:
        return self.secret == other.secret

    async def openLater() -> string:
        return self.revealLater()

    static def kind() -> string:
        return Vault.label()

    static async def kindLater() -> string:
        return Vault.labelLater()

const vault = Vault("safe")
print(vault.open("one"))
print(vault.open("two"))
print(Vault.kind())
print(await vault.openLater())
print(await Vault.kindLater())
print(vault.matches(Vault("safe")))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /#secret;/u);
  assert.match(result.code ?? "", /#prefix;/u);
  assert.match(result.code ?? "", /#reveal = \(suffix\) =>/u);
  assert.match(result.code ?? "", /static #category = "vault";/u);
  assert.match(result.code ?? "", /static #label\(\)/u);
  assert.match(result.code ?? "", /#revealLater = async \(\) =>/u);
  assert.match(result.code ?? "", /static async #labelLater\(\)/u);
  assert.doesNotMatch(result.code ?? "", /this\.secret/u);
  const info = result.moduleInterface.classes.get("Vault");
  assert.equal(info?.fields.has("secret"), false);
  assert.equal(info?.fields.has("prefix"), false);
  assert.equal(info?.methods.has("reveal"), false);
  assert.equal(info?.staticFields.has("category"), false);
  assert.equal(info?.staticMethods.has("label"), false);
  assert.equal(info?.methods.has("open"), true);
  assert.equal(info?.staticMethods.has("kind"), true);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "token:safe:one:1\ntoken:safe:two:2\nvault-store\ntoken:safe:async:3\nvault\ntrue\n");

  const inaccessible = compile(`
class Vault(private const secret: string):
    private static const category: string = "vault"
    private let reads: number = 0
    private def reveal() -> string:
        return self.secret

const vault = Vault("safe")
print(vault.secret)
print(vault.reads)
print(vault.reveal())
print(Vault.category)
`.trimStart());
  assert.equal(inaccessible.diagnostics.filter((item) => /is private to class 'Vault'/u.test(item.message)).length, 4);

  const invalid = compile(`
abstract class Base:
    private abstract def hidden() -> string

class Child extends Base:
    private override def hidden() -> string:
        return "child"
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Private method 'hidden' cannot be abstract/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Private method 'hidden' cannot use 'override'/u.test(item.message)));

  const reserved = compile("const private = 'reserved'\n");
  assert.ok(reserved.diagnostics.length > 0);

  const memberNames = compile(`
type Flags:
    private: bool

enum Visibility:
    private
    public

class Label:
    def private() -> string:
        return "method"

class Box:
    const private: string = "field"

const flags: Flags = {private: true}
print(flags.private)
print(Visibility.private)
print(Label().private())
print(Box().private)
`.trimStart());
  assert.deepEqual(memberNames.diagnostics, []);
  const memberExecution = executeModule(memberNames.code ?? "");
  assert.equal(memberExecution.status, 0, String(memberExecution.stderr));
  assert.equal(memberExecution.stdout, "true\nprivate\nmethod\nfield\n");
});

test("private members stay inside their class across project and editor semantics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-private-members-"));
  const modelPath = join(directory, "model.vel");
  const mainPath = join(directory, "main.vel");
  const modelSource = `
export class Vault(private const secret: string):
    private static const category: string = "vault"
    /// Tracks how often the secret was opened.
    private let reads: number = 0

    /// Produces the internal display value.
    private def reveal() -> string:
        self.reads += 1
        return f"{self.secret}:{self.reads}"

    def open() -> string:
        return self.reveal()

    static def kind() -> string:
        return Vault.category
`.trimStart();
  const mainSource = `
import {Vault} from "./model.vel"
const vault = Vault("safe")
print(vault.open())
print(Vault.kind())
`.trimStart();
  await writeFile(modelPath, modelSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const outsideOffset = mainSource.indexOf("vault.open") + "vault.".length;
  const outside = projectCompletionsAt(project, mainPath, outsideOffset);
  assert.ok(outside.some((item) => item.label === "open"));
  assert.ok(!outside.some((item) => item.label === "secret" || item.label === "reads" || item.label === "reveal"));
  const outsideStaticOffset = mainSource.indexOf("Vault.kind") + "Vault.".length;
  const outsideStatic = projectCompletionsAt(project, mainPath, outsideStaticOffset);
  assert.ok(outsideStatic.some((item) => item.label === "kind"));
  assert.ok(!outsideStatic.some((item) => item.label === "category"));

  const insideOffset = modelSource.indexOf("self.reveal") + "self.".length;
  const inside = projectCompletionsAt(project, modelPath, insideOffset);
  assert.ok(inside.some((item) => item.label === "secret" && item.detail === "string"));
  assert.ok(inside.some((item) => item.label === "reads" && item.detail === "number"));
  assert.match(inside.find((item) => item.label === "reveal")?.documentation ?? "", /internal display value/u);
  const insideStaticOffset = modelSource.indexOf("Vault.category") + "Vault.".length;
  assert.ok(projectCompletionsAt(project, modelPath, insideStaticOffset)
    .some((item) => item.label === "category" && item.detail === "string"));
  const revealDeclaration = modelSource.indexOf("reveal() -> string");
  assert.deepEqual(projectDefinitionAt(project, modelPath, insideOffset + 1), {
    path: modelPath,
    span: { start: revealDeclaration, end: revealDeclaration + "reveal".length },
  });
  assert.equal(projectReferencesAt(project, modelPath, revealDeclaration + 1, true).length, 2);
  const rename = projectRenameAt(project, modelPath, revealDeclaration + 1, "renderSecret");
  assert.notEqual(typeof rename, "string");
  if (typeof rename !== "string") assert.equal(rename.edits.length, 2);
});

test("class getters cross module and editor boundaries as documented properties", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-class-getters-"));
  const modelPath = join(directory, "model.vel");
  const mainPath = join(directory, "main.vel");
  const modelSource = `
export class ScoreCard(const label: string, private const values: List<number>):
    /// Number of recorded values.
    get count() -> number:
        return self.values.length

    /// Internal doubled count used by the summary.
    private get doubledCount() -> number:
        return self.count * 2

    /// Stable display text for the card.
    get summary() -> string:
        return f"{self.label}:{self.doubledCount}"
`.trimStart();
  const mainSource = `
import {ScoreCard} from "./model.vel"
const card = ScoreCard("Velar", [1, 2, 3])
print(card.count)
print(card.summary)
`.trimStart();
  await writeFile(modelPath, modelSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const memberOffset = mainSource.indexOf("card.summary") + "card.".length;
  const completion = projectCompletionsAt(project, mainPath, memberOffset);
  assert.ok(completion.some((item) => item.label === "count" && item.detail === "number"));
  assert.match(completion.find((item) => item.label === "summary")?.documentation ?? "", /Stable display text/u);
  assert.ok(!completion.some((item) => item.label === "doubledCount"));
  const summaryDeclaration = modelSource.indexOf("summary() -> string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, memberOffset + 1), {
    path: modelPath,
    span: { start: summaryDeclaration, end: summaryDeclaration + "summary".length },
  });
  const privateOffset = modelSource.indexOf("self.doubledCount") + "self.".length;
  assert.match(projectCompletionsAt(project, modelPath, privateOffset)
    .find((item) => item.label === "doubledCount")?.documentation ?? "", /Internal doubled count/u);
  const rename = projectRenameAt(project, modelPath, summaryDeclaration + 1, "display");
  assert.notEqual(typeof rename, "string");
  if (typeof rename !== "string") assert.equal(rename.edits.length, 2);
});

test("abstract getter contracts retain identity across Velar modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-inherited-getters-"));
  const basePath = join(directory, "base.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(basePath, `
export abstract class Display:
    abstract get label() -> string
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {Display} from "./base.vel"

class Badge extends Display:
    override get label() -> string:
        return "Velar"

const item: Display = Badge()
print(item.label)
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.equal(main?.result.moduleInterface.classes.get("Badge")?.getters.has("label"), true);
});

test("class body fields cross module and editor boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-class-fields-"));
  const modelPath = join(directory, "model.vel");
  const mainPath = join(directory, "main.vel");
  const modelSource = `
export class ScoreCard(const label: string):
    static const category: string = "score"
    const history: List<number> = []
    let total: number = 0

    init:
        assert label.length > 0, "ScoreCard label cannot be empty"

    def add(value: number):
        self.history.append(value)
        self.total += value

export class TeamCard extends ScoreCard("Team"):
    pass
`.trimStart();
  const mainSource = `
import {ScoreCard as Card, TeamCard} from "./model.vel"
const card = Card("Team")
card.add(5)
const team = TeamCard()
team.add(3)
print(Card.category)
print(card.total)
print(card.history.length)
print(TeamCard.category)
print(team.total)
`.trimStart();
  await writeFile(modelPath, modelSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const totalUse = mainSource.indexOf("card.total") + "card.".length;
  const categoryUse = mainSource.indexOf("Card.category") + "Card.".length;
  const inheritedCategoryUse = mainSource.indexOf("TeamCard.category") + "TeamCard.".length;
  const totalDeclaration = modelSource.indexOf("total: number");
  const categoryDeclaration = modelSource.indexOf("category: string");
  const labelDeclaration = modelSource.indexOf("label: string");
  const labelInitUse = modelSource.indexOf("label.length");
  assert.ok(projectCompletionsAt(project, mainPath, totalUse).some((item) => item.label === "total" && item.detail === "number"));
  assert.ok(projectCompletionsAt(project, mainPath, categoryUse).some((item) => item.label === "category" && item.detail === "string"));
  assert.ok(!projectCompletionsAt(project, mainPath, categoryUse).some((item) => item.label === "total"));
  assert.deepEqual(projectDefinitionAt(project, mainPath, totalUse + 1), {
    path: modelPath,
    span: { start: totalDeclaration, end: totalDeclaration + "total".length },
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, categoryUse + 1), {
    path: modelPath,
    span: { start: categoryDeclaration, end: categoryDeclaration + "category".length },
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, inheritedCategoryUse + 1), {
    path: modelPath,
    span: { start: categoryDeclaration, end: categoryDeclaration + "category".length },
  });
  assert.deepEqual(projectDefinitionAt(project, modelPath, labelInitUse + 1), {
    path: modelPath,
    span: { start: labelDeclaration, end: labelDeclaration + "label".length },
  });
  assert.equal(projectReferencesAt(project, mainPath, inheritedCategoryUse + 1, true).length, 3);
  const categoryRename = projectRenameAt(project, mainPath, inheritedCategoryUse + 1, "kind");
  assert.notEqual(typeof categoryRename, "string");
  if (typeof categoryRename !== "string") assert.equal(categoryRename.edits.length, 3);
  const totalReferences = projectReferencesAt(project, modelPath, totalDeclaration + 1, true);
  assert.equal(totalReferences.length, 4);
  const totalRename = projectRenameAt(project, mainPath, totalUse + 1, "sum");
  assert.notEqual(typeof totalRename, "string");
  if (typeof totalRename !== "string") assert.equal(totalRename.edits.length, 4);
  const contextualRename = projectRenameAt(project, mainPath, totalUse + 1, "init");
  assert.notEqual(typeof contextualRename, "string");
  if (typeof contextualRename !== "string") assert.equal(contextualRename.edits.length, 4);

  const output = join(directory, "dist");
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "score\n5\n1\nscore\n3\n");
});

test("class inheritance rejects unsafe or incomplete object contracts", () => {
  const abstractConstruction = compile("abstract class Shape:\n    abstract def area() -> number\n\nShape()\n");
  assert.ok(abstractConstruction.diagnostics.some((item) => /Cannot instantiate abstract class 'Shape'/.test(item.message)));

  const missingImplementation = compile("abstract class Shape:\n    abstract def area() -> number\n\nclass Circle extends Shape:\n    pass\n");
  assert.ok(missingImplementation.diagnostics.some((item) => /must implement abstract method: area/.test(item.message)));

  const implicitOverride = compile("class Base:\n    def label() -> string:\n        return \"base\"\n\nclass Child extends Base:\n    def label() -> string:\n        return \"child\"\n");
  assert.ok(implicitOverride.diagnostics.some((item) => /must use 'override'/.test(item.message)));

  const missingBaseMethod = compile("class Base:\n    pass\n\nclass Child extends Base:\n    override def label() -> string:\n        return \"child\"\n");
  assert.ok(missingBaseMethod.diagnostics.some((item) => /no base method exists/.test(item.message)));

  const incompatibleOverride = compile("class Base:\n    def label(value: string) -> string:\n        return value\n\nclass Child extends Base:\n    override def label(value: number) -> string:\n        return str(value)\n");
  assert.ok(incompatibleOverride.diagnostics.some((item) => /must keep the base method signature/.test(item.message)));

  const inheritedConst = compile("class Base(const id: string):\n    pass\n\nclass Child extends Base(\"fixed\"):\n    def change():\n        self.id = \"other\"\n");
  assert.ok(inheritedConst.diagnostics.some((item) => /Cannot assign to const field 'id'/.test(item.message)));

  const localFieldMethodCollision = compile("class User(const name: string):\n    def name() -> string:\n        return self.name\n");
  assert.ok(localFieldMethodCollision.diagnostics.some((item) => /conflicts with a field declared by class 'User'/.test(item.message)));

  const inheritedFieldMethodCollision = compile("class Base:\n    def name() -> string:\n        return \"base\"\n\nclass Child(const name: string) extends Base:\n    pass\n");
  assert.ok(inheritedFieldMethodCollision.diagnostics.some((item) => /Field 'name' conflicts with an inherited method/.test(item.message)));
});

test("inheritance metadata crosses Velar module boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-module-inheritance-"));
  const output = join(directory, "dist");
  const basePath = join(directory, "base.vel");
  const playerPath = join(directory, "player.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(basePath, `
export abstract class Entity(const id: string):
    def label() -> string:
        return self.id
`.trimStart(), "utf8");
  await writeFile(playerPath, `
import {Entity} from "./base.vel"
export class Player(const id: string) extends Entity(id):
    def score() -> number:
        return 1

    static def score(id: string) -> Player:
        return Player(id)

export class NamedPlayer(const id: string) extends Player(id):
    override def label() -> string:
        return f"named:{super.label()}"
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {NamedPlayer, Player as Hero} from "./player.vel"
const player = Hero("Nova")
const named = NamedPlayer("Nova")
const scored = Hero.score("Other")
print(player.label())
print(named.label())
print(player.score())
print(scored.score())
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const playerText = await readFile(playerPath, "utf8");
  const baseUse = playerText.indexOf("Entity(id)");
  const definition = projectDefinitionAt(project, playerPath, baseUse + 1);
  assert.equal(definition?.path, basePath);
  const mainText = await readFile(mainPath, "utf8");
  const inheritedMethod = mainText.indexOf("player.label") + "player.".length;
  const baseText = await readFile(basePath, "utf8");
  const baseLabel = baseText.indexOf("label() -> string");
  const baseId = baseText.indexOf("id: string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, inheritedMethod + 1), {
    path: basePath,
    span: { start: baseLabel, end: baseLabel + "label".length },
  });
  const overrideMethod = mainText.indexOf("named.label") + "named.".length;
  const namedLabel = playerText.indexOf("label() -> string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, overrideMethod + 1), {
    path: playerPath,
    span: { start: namedLabel, end: namedLabel + "label".length },
  });
  const instanceScore = mainText.indexOf("player.score") + "player.".length;
  const staticScore = mainText.indexOf("Hero.score") + "Hero.".length;
  const instanceScoreDeclaration = playerText.indexOf("score() -> number");
  const staticScoreDeclaration = playerText.indexOf("score(id: string)");
  assert.deepEqual(projectDefinitionAt(project, mainPath, instanceScore + 1), {
    path: playerPath,
    span: { start: instanceScoreDeclaration, end: instanceScoreDeclaration + "score".length },
  });
  assert.deepEqual(projectDefinitionAt(project, mainPath, staticScore + 1), {
    path: playerPath,
    span: { start: staticScoreDeclaration, end: staticScoreDeclaration + "score".length },
  });
  const staticRename = projectRenameAt(project, playerPath, staticScoreDeclaration + 1, "create");
  assert.notEqual(typeof staticRename, "string");
  if (typeof staticRename !== "string") {
    assert.equal(staticRename.edits.length, 2);
    assert.ok(staticRename.edits.every((edit) => project.modules
      .find((module) => module.inputPath === edit.path)?.result.source.text.slice(edit.span.start, edit.span.end) === "score"));
  }
  const methodReferences = projectReferencesAt(project, basePath, baseLabel + 1, true);
  assert.equal(methodReferences.length, 5);
  const fieldReferences = projectReferencesAt(project, basePath, baseId + 1, true);
  assert.equal(fieldReferences.length, 6);
  const fieldRename = projectRenameAt(project, basePath, baseId + 1, "identifier");
  assert.notEqual(typeof fieldRename, "string");
  if (typeof fieldRename !== "string") assert.equal(fieldRename.edits.length, 6);
  assert.equal(projectRenameAt(project, basePath, baseLabel + 1, "score"), "The new name collides with another declaration");
  const methodRename = projectRenameAt(project, basePath, baseLabel + 1, "title");
  assert.notEqual(typeof methodRename, "string");
  if (typeof methodRename !== "string") {
    assert.equal(methodRename.edits.length, 5);
    const editsByPath = new Map<string, typeof methodRename.edits[number][]>();
    for (const edit of methodRename.edits) {
      const edits = editsByPath.get(edit.path) ?? [];
      edits.push(edit);
      editsByPath.set(edit.path, edits);
    }
    for (const [editPath, edits] of editsByPath) {
      let updated = await readFile(editPath, "utf8");
      for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
        updated = `${updated.slice(0, edit.span.start)}${edit.replacement ?? "title"}${updated.slice(edit.span.end)}`;
      }
      await writeFile(editPath, updated, "utf8");
    }
    const renamed = await compileProject(mainPath);
    assert.deepEqual(renamed.failures, []);
    assert.deepEqual(renamed.modules.flatMap((module) => module.result.diagnostics), []);
  }

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Nova\nnamed:Nova\n1\n1\n");
});

test("runtime data validation composes nested data types and class identity", () => {
  const result = compile(`
type Profile:
    name: string

class Player(const name: string):
    def label() -> string:
        return self.name

type Session:
    profile: Profile
    player: Player

const raw = {profile: {name: "Ada"}, player: Player("Nova")}
const session = Session.parse(raw)
print(session.profile.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarTypeCheck_Profile/u);
  assert.match(result.code ?? "", /instanceof Player/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");
});

test("recursive record types validate finite trees and reject cyclic or excessive graphs", () => {
  const result = compile(`
type TreeNode:
    label: string
    children: List<TreeNode>

type Forest = List<TreeNode>

type LinkedNode:
    label: string
    next: LinkedNode | string

type Folder:
    name: string
    entries: List<FolderEntry>

type FolderEntry:
    name: string
    folder: Folder?

const tree = TreeNode.parse({label: "root", children: [{label: "leaf", children: []}]})
const forest = Forest.parse([tree])
const linked = LinkedNode.parse({label: "root", next: {label: "leaf", next: "end"}})
const folder = Folder.parse({name: "docs", entries: [{name: "guide.md", folder: none}]})
print(tree.children[0].label)
print(forest[0].label)
print(linked.label)
print(folder.entries[0].name)
print(tree is TreeNode)
try:
    TreeNode.parse({label: "broken", children: [{label: 42, children: []}]})
catch error:
    print(error.name)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function __velarTypeCheck_TreeNode/u);
  assert.match(result.code ?? "", /__active\?\.has\(__velarTypeCheck_TreeNode\)/u);
  const runtimeProbe = [
    result.code ?? "",
    'const cyclic = { label: "cycle", children: [] };',
    'cyclic.children.push(cyclic);',
    'console.log(TreeNode.is(cyclic));',
    'const cyclicFolder = { name: "cycle", entries: [] };',
    'cyclicFolder.entries.push({ name: "loop", folder: cyclicFolder });',
    'console.log(Folder.is(cyclicFolder));',
    'const leaf = { label: "shared", children: [] };',
    'console.log(TreeNode.is({ label: "dag", children: [leaf, leaf] }));',
    'console.log(TreeNode.is([]));',
    'let deep = { label: "leaf", children: [] };',
    'for (let index = 0; index < 1001; index += 1) deep = { label: "deep", children: [deep] };',
    'console.log(TreeNode.is(deep));',
  ].join("\n");
  const execution = executeModule(runtimeProbe);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "leaf\nroot\nroot\nguide.md\ntrue\nValidationError\nfalse\nfalse\ntrue\nfalse\nfalse\n");

  const structural = compile(`
type Alpha:
    label: string
    children: List<Alpha>

type Mirror:
    label: string
    children: List<Mirror>

type Wrong:
    label: number
    children: List<Wrong>

const mirror: Mirror = {label: "ok", children: []}
const compatible: Alpha = mirror
const wrong: Wrong = {label: 1, children: []}
const incompatible: Alpha = wrong
`.trimStart());
  assert.equal(structural.diagnostics.filter((item) => /Cannot assign Wrong to Alpha/u.test(item.message)).length, 1);

  const unproductive = compile(`
type Loop:
    next: Loop

type Left:
    right: Right

type Right:
    left: Left

type AliasLoop = AliasRecord

type AliasRecord:
    next: AliasLoop

type UnionLeft:
    next: UnionLeft | UnionRight

type UnionRight:
    next: UnionLeft | UnionRight
`.trimStart());
  assert.equal(unproductive.diagnostics.filter((item) => /cannot construct a finite value/u.test(item.message)).length, 6);
});

test("nested method closures capture self without dynamic this", () => {
  const result = compile(`
class Counter(const value: number):
    def show():
        def nested():
            print(self.value)
        nested()

Counter(8).show()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const self = this/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "8\n");
});

test("rejects await in sync functions and loop control crossing function boundaries", () => {
  const awaitResult = compile(`
async def request() -> number:
    return 1

def load():
    const response = await request()
`.trimStart());
  assert.ok(awaitResult.diagnostics.some((item) => item.code === "VEL4007"));

  const breakResult = compile(`
while true:
    def stop():
        break
    break
`.trimStart());
  assert.ok(breakResult.diagnostics.some((item) => item.code === "VEL3005"));
});

test("supports primitive runtime checks and protects compiler-owned bindings", () => {
  const checks = compile(`
const value = "Velar"
print(value is string)
`.trimStart());
  assert.deepEqual(checks.diagnostics, []);
  assert.match(checks.code ?? "", /typeof value === "string"/);

  const reserved = compile("const print = 1\n");
  assert.ok(reserved.diagnostics.some((item) => item.code === "VEL3007"));
});

test("normalizes optional members and calls to none", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

class Box(const value: string):
    def label() -> string:
        return self.value

const user = User.parse({name: "Ada"})
let box: Box? = none
print(user.avatar == none)
print(box?.label() == none)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /user\.avatar \?\? null/);
  assert.match(result.code ?? "", /box\?\.label\?\.\(\) \?\? null/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n");
});

test("optional access safely continues through reads, indexes, calls, and collection helpers", () => {
  const result = compile(`
type Details:
    groups: List<string?>
    format: () -> string

type Envelope:
    details: Details?

const absent: Envelope? = none
const present: Envelope = {details: {groups: [none, "42"], format: () => "ready"}}
let loads = 0
let indexes = 0

def loadAbsent() -> Envelope?:
    loads += 1
    return none

def nextIndex() -> number:
    indexes += 1
    return 0

print(absent?.details.groups[0] ?? "missing")
print(present?.details.groups[1] ?? "missing")
print(absent?.details.format() ?? "missing")
print(present?.details.format() ?? "missing")
print(absent?.details.groups.slice(1).length ?? -1)
print(present?.details.groups.slice(1).length ?? -1)
print(loadAbsent()?.details.groups[0] ?? "missing")
print(loads)
print(absent?.details.groups[nextIndex()] ?? "missing")
print(indexes)
print(present?.details.groups[nextIndex()] ?? "missing")
print(indexes)
try:
    print(present?.details.groups[9] ?? "missing")
catch error:
    print(error.name)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarOptionalIndex/u);
  assert.match(result.code ?? "", /__velarOptionalCollection/u);
  assert.match(result.code ?? "", /\.format\?\.\(\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "missing\n42\nmissing\nready\n-1\n1\nmissing\n1\nmissing\n0\nmissing\n1\nIndexError\n");

  const invalid = compile(`
type Details:
    groups: List<string?>

type Envelope:
    details: Details?

type Handler = () -> string

type Hooks:
    handler: Handler?

let value: Envelope? = none
const hooks: Hooks = {handler: none}
value?.details = none
value?.details.groups[0] = "changed"
const indexed = value.details.groups[0]
const called = hooks.handler()
`.trimStart());
  assert.ok(invalid.diagnostics.filter((item) => /Optional chains cannot be assignment targets/u.test(item.message)).length >= 2);
  assert.ok(invalid.diagnostics.some((item) => /Use optional access '\?\.'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /presence check or an optional access chain/u.test(item.message)));
});

test("conditional expressions narrow optional values in their owned branch", () => {
  const result = compile(`
type User:
    name: string

def label(user: User?) -> string:
    return user ? user.name : "Guest"

def inverse(user: User?) -> string:
    return not user ? "Guest" : user.name

def numberLabel(value: number?) -> string:
    return value ? "present" : "none"

def inverseNumberLabel(value: number?) -> string:
    return not value ? "none" : "present"

print(numberLabel(0))
print(inverseNumberLabel(0))
`);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "present\npresent\n");
});

test("explicit none comparisons narrow blocks, inline expressions, assertions, and JSX sequences", () => {
  const result = compile(`
type Contact:
    email: string?

def blockLabel(contact: Contact) -> string:
    if contact.email == none:
        return "missing"
    else:
        const address: string = contact.email
        return address

def inverseLabel(contact: Contact) -> string:
    if none != contact.email:
        return contact.email
    return "missing"

def inlineLabel(contact: Contact) -> string:
    return contact.email != none ? contact.email : "missing"

def assertedLabel(contact: Contact) -> string:
    assert contact.email != none, "Email is required"
    const address: string = contact.email
    return address

def preserveZero(value: number?) -> number:
    if value != none:
        return value
    return -1

component ContactView(primary: Contact, secondary: Contact):
    return <main>
        <p if={primary.email != none}>{primary.email}</p>
        <p else-if={secondary.email == none}>Missing</p>
        <a else href={secondary.email}>{secondary.email}</a>
    </main>

const contact: Contact = {email: "ada@example.com"}
print(blockLabel(contact))
print(inverseLabel(contact))
print(inlineLabel(contact))
print(assertedLabel(contact))
print(preserveZero(0))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ada@example.com\nada@example.com\nada@example.com\nada@example.com\n0\n");

  const outside = compile(`
type Contact:
    email: string?

const contact: Contact = {email: none}
if contact.email != none:
    print(contact.email)
const address: string = contact.email
`.trimStart());
  assert.ok(outside.diagnostics.some((item) => /Cannot assign string\? to string/u.test(item.message)));
});

test("stable optional record fields narrow in blocks, expressions, and JSX branches", () => {
  const result = compile(`
type Manager:
    email: string?

type Contact:
    email: string?
    manager: Manager?

type Fault:
    error: Error?

def label(contact: Contact) -> string:
    if contact.manager:
        print(contact.manager.email ?? "manager")
    if contact.email:
        const address: string = contact.email
        return address
    return "missing"

def inverse(contact: Contact) -> string:
    return not contact.email ? "missing" : contact.email

def errorMessage(fault: Fault) -> string:
    if fault.error is Error:
        return fault.error.message
    return "none"

component ContactLink(contact: Contact):
    return <p><a if={contact.email} href={contact.email}>{contact.email}</a><span else>Missing</span></p>

const contact: Contact = {email: "", manager: {email: "lead@example.com"}}
print(label(contact))
print(inverse(contact))
print(errorMessage({error: Error("broken")}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "lead@example.com\n\n\nbroken\n");

  const outside = compile(`
type Contact:
    email: string?

const contact: Contact = {email: none}
const address: string = contact.email
if contact.email:
    const contact: Contact = {email: none}
    const shadowed: string = contact.email
`.trimStart());
  assert.equal(outside.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 2);
});

test("validates annotations and keeps any behind unsafe boundaries", () => {
  const missing = compile("const value: Missing = none\n");
  assert.ok(missing.diagnostics.some((item) => /Unknown type 'Missing'/.test(item.message)));

  const any = compile("def escape(value: any) -> any:\n    return value\n");
  assert.ok(any.diagnostics.some((item) => /'any' is reserved/.test(item.message)));

  const arity = compile("const values: Map<string> = Map()\n");
  assert.ok(arity.diagnostics.some((item) => item.code === "VEL2012"));

  const recursive = compile("type Node:\n    next: Node?\n");
  assert.deepEqual(recursive.diagnostics, []);
});

test("compiles Web components to owned DOM and extracted scoped CSS", () => {
  const result = compile(`
component Counter(start: number = 0):
    state count = start
    computed doubled = count * 2

    def increment():
        count += 1

    watch count as current, previous:
        print(f"{previous} -> {current}")

    mounted:
        print("mounted")

    cleanup:
        print("cleanup")

    style:
        .counter:hover {
            color: blue;
        }

    return <button class="counter" class:active={count > 0} on:click={increment}>{count} / {doubled}</button>

mount(<Counter start={1} />, "#app")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.web, true);
  assert.match(result.code ?? "", /const count = __velarState\(start\)/);
  assert.match(result.code ?? "", /const doubled = __velarComputed/);
  assert.match(result.code ?? "", /__velarWatch/);
  assert.match(result.code ?? "", /count\.set\(count\.get\(\) \+ 1\)/);
  assert.match(result.code ?? "", /__velarCreateElement\("button", __namespace\)/);
  assert.match(result.css ?? "", /\.counter\[data-velar-[a-z0-9]+\]:hover/);
  assert.doesNotMatch(result.code ?? "", /\bProxy\b/);
  assert.match(result.code ?? "", /if \(initialized && !Object\.is\(next, current\)\) callback/);
  assert.match(result.code ?? "", /if \(destroyed\) return null;[\s\S]*__velarCleanupStep/);
  const domCommit = (result.code ?? "").indexOf("for (const observer of [...__velarRuntime.domQueue])");
  const watchCommit = (result.code ?? "").indexOf("for (const observer of [...__velarRuntime.watchQueue])");
  assert.ok(domCommit >= 0 && watchCommit > domCommit);
});

test("component resources own typed asynchronous loading, retry, errors, and stale completion", () => {
  const result = compile(`
async def loadLabel() -> string:
    return "ready"

component App:
    resource label: string = loadLabel()

    def content() -> WebNode:
        const failure = label.error
        const value = label.value
        if failure:
            return <p role="alert">{failure.message}</p>
        if value:
            return <p>{value}</p>
        return <p>Loading…</p>

    return <main>{content()}<button type="button" on:click={label.reload}>Reload</button></main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const label = __velarResource\(\(\) => loadLabel\(\), __scope, "label"\)/u);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "resource" && item.name === "label");
  assert.match(symbol?.type ?? "", /value: string\?/u);
  assert.match(symbol?.type ?? "", /reload: \(\) -> Promise<none>/u);

  const execution = executeModule(`${result.code ?? ""}
const pending = [];
const scope = __velarScope("Probe");
const resource = __velarResource(() => new Promise((resolve) => pending.push(resolve)), scope, "probe");
__velarMountScope(scope);
await Promise.resolve();
console.log(resource.loading + ":" + resource.ready + ":" + resource.value);
const latest = resource.reload();
await Promise.resolve();
pending[0](1);
await Promise.resolve();
await Promise.resolve();
console.log(resource.loading + ":" + resource.ready + ":" + resource.value);
pending[1](2);
await latest;
console.log(resource.loading + ":" + resource.ready + ":" + resource.value);
const stale = resource.reload();
await Promise.resolve();
__velarDestroyScope(scope);
pending[2](3);
await stale;
await resource.reload();
console.log(resource.value + ":" + pending.length);

__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message));
const failedScope = __velarScope("FailureView");
const failed = __velarResource(() => Promise.reject(Error("Load failed")), failedScope, "catalog");
__velarMountScope(failedScope);
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(failed.loading + ":" + failed.ready + ":" + failed.error.message);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true:false:null",
    "true:false:null",
    "false:true:2",
    "2:3",
    "resource:catalog:Load failed",
    "false:true:Load failed",
    "",
  ].join("\n"));
});

test("resources reject synchronous, incompatible, exported, and non-component declarations", () => {
  const outside = compile(`
async def numericLabel() -> number:
    return 1

resource moduleValue = numericLabel()
`.trimStart());
  assert.ok(outside.diagnostics.some((item) => item.code === "VEL3012" && /only valid at component scope/u.test(item.message)));

  const exported = compile(`
async def numericLabel() -> number:
    return 1

export resource exportedValue = numericLabel()
`.trimStart());
  assert.ok(exported.diagnostics.some((item) => item.code === "VEL2018" && /component-owned and cannot be exported/u.test(item.message)));

  const synchronous = compile(`
def syncLabel() -> string:
    return "ready"

component App:
    resource synchronous = syncLabel()
    return <main>Invalid</main>
`.trimStart());
  assert.ok(synchronous.diagnostics.some((item) => item.code === "VEL4016" && /initializer must return Promise<T>, received string/u.test(item.message)));

  const incompatible = compile(`
async def numericLabel() -> number:
    return 1

component App:
    resource wrong: string = numericLabel()
    return <main>Invalid</main>
`.trimStart());
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
});

test("component actions own pending state, recoverable errors, concurrency, and destruction", () => {
  const result = compile(`
component App:
    state label = "idle"

    action refresh() -> string:
        label = "ready"
        return label

    computed failure = refresh.error

    return <main><button type="button" disabled={refresh.pending} on:click={refresh}>Refresh</button>{failure ? <p role="alert">{failure.message}</p> : none}</main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const refresh = __velarAction\(async \(\) =>/u);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "action" && item.name === "refresh");
  assert.match(symbol?.type ?? "", /action \(\) -> Promise<string\?>/u);

  const execution = executeModule(`${result.code ?? ""}
const pending = [];
const scope = __velarScope("ActionProbe");
__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message));
const save = __velarAction((value) => new Promise((resolve, reject) => pending.push({ value, resolve, reject })), scope, "save");
console.log(save.pending + ":" + (save.error?.message ?? "none"));
const older = save("old");
const latest = save("new");
await Promise.resolve();
console.log(save.pending + ":" + (save.error?.message ?? "none"));
pending[1].resolve("new");
console.log((await latest) + ":" + save.pending + ":" + (save.error?.message ?? "none"));
pending[0].reject(Error("Stale failure"));
console.log((await older) + ":" + save.pending + ":" + (save.error?.message ?? "none"));
const failed = save("broken");
await Promise.resolve();
pending[2].reject(Error("Save failed"));
console.log((await failed) + ":" + save.pending + ":" + save.error.message);
__velarDestroyScope(scope);
console.log((await save("ignored")) + ":" + pending.length);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "false:none",
    "true:none",
    "new:true:none",
    "null:false:none",
    "action:save:Save failed",
    "null:false:Save failed",
    "null:3",
    "",
  ].join("\n"));
});

test("actions reject exports, non-component ownership, bad returns, and unknown state fields", () => {
  const outside = compile(`
action save() -> none:
    return none
`.trimStart());
  assert.ok(outside.diagnostics.some((item) => item.code === "VEL3013" && /only valid at component scope/u.test(item.message)));

  const exported = compile(`
export action save() -> none:
    return none
`.trimStart());
  assert.ok(exported.diagnostics.some((item) => item.code === "VEL2019" && /component-owned and cannot be exported/u.test(item.message)));

  const invalid = compile(`
component App:
    action save() -> string:
        return 1
    computed unsupported = save.reload
    return <main>Invalid</main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Action has no member 'reload'/u.test(item.message)));
});

test("enforces component lifecycle cardinality", () => {
  const duplicate = compile(`
component App:
    mounted:
        print("first")
    mounted:
        print("second")
    cleanup:
        print("first")
    cleanup:
        print("second")
    return <main></main>
`.trimStart());

  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL5009"));
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL5010"));

  const nested = compile(`
component App:
    mounted:
        cleanup:
            print("nested")
    return <main></main>
`.trimStart());
  assert.equal(nested.code, null);
  assert.ok(nested.diagnostics.length > 0);

  const asynchronousMount = compile(`
async def prepare():
    return none

component App:
    mounted:
        await prepare()
    return <main>ready</main>
`.trimStart());
  assert.deepEqual(asynchronousMount.diagnostics, []);
  assert.match(asynchronousMount.code ?? "", /async \(\) => \{[\s\S]*await prepare\(\)/u);

  const asynchronousCleanup = compile(`
async def dispose():
    return none

component App:
    cleanup:
        await dispose()
    return <main>ready</main>
`.trimStart());
  assert.ok(asynchronousCleanup.diagnostics.some((item) => item.code === "VEL4007"));
});

test("runs mounted and cleanup exactly once", () => {
  const result = compile(`
component App:
    mounted:
        print("mounted")
    cleanup:
        print("cleanup")
    return <main></main>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  const dom = `
class FakeNode {
  insertBefore(node) { this.child = node; }
  remove() { this.removed = true; }
  setAttribute() {}
}
const target = new FakeNode();
globalThis.Node = FakeNode;
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode() { return new FakeNode(); },
  createComment() { return new FakeNode(); },
  querySelector() { return target; },
};
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}\nconst app = App();\napp.mount("#app");\napp.destroy();\napp.destroy();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "mounted\ncleanup\n");
});

test("Web runtime reports mount failures with a fatal fallback and continues cleanup steps", () => {
  const failedMount = compile(`
let activeHandles = 0

def acquireHandle() -> () -> none:
    activeHandles += 1
    def stop():
        activeHandles -= 1
    return stop

component Broken:
    const stopHandle = acquireHandle()
    cleanup:
        print("construction-cleanup")
        throw Error("Construction cleanup failed")
        stopHandle()
    throw Error("Boot failed")
    return <main>unreachable</main>

mount(<Broken />, "#app")
print(activeHandles)
`.trimStart());
  assert.deepEqual(failedMount.diagnostics, []);

  const cleanup = compile(`
component Recovering:
    cleanup:
        print("cleanup-before")
        throw Error("Cleanup failed")
        print("cleanup-after")
    return <main>ready</main>
`.trimStart());
  assert.deepEqual(cleanup.diagnostics, []);

  const dom = `
class FakeNode {
  constructor() { this.textContent = ""; }
  insertBefore(node) { this.child = node; }
  replaceChildren(node) { this.replaced = node; }
  remove() { this.removed = true; }
  setAttribute(name, value) { this[name] = value; }
  append() {}
}
const target = new FakeNode();
globalThis.Node = FakeNode;
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode() { return new FakeNode(); },
  createComment() { return new FakeNode(); },
  querySelector() { return target; },
};
const runtime = globalThis[Symbol.for("velar.runtime.v1")] = { errorHandlers: new Set([report => console.log(report.phase + ":" + report.error.message)]) };
`;
  const execution = executeModule(`${dom}\n${failedMount.code ?? ""}\nconsole.log(target.replaced.role + ":" + target.replaced.textContent);\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "construction-cleanup\ncleanup:Construction cleanup failed\nmount:Boot failed\n0\nalert:The application could not start: Boot failed\n");

  const cleanupExecution = executeModule(`${dom}\n${cleanup.code ?? ""}\nconst app = Recovering();\napp.mount("#app");\napp.destroy();\n`);
  assert.equal(cleanupExecution.status, 0, String(cleanupExecution.stderr));
  assert.equal(cleanupExecution.stdout, "cleanup-before\ncleanup:Cleanup failed\ncleanup-after\n");
});

test("checks component props and Web directive targets", () => {
  const reactiveProps = compile(`
component Badge(label: string):
    return <span>{label}</span>

component App:
    state label = "ready"
    return <main><Badge label={label} /></main>
`.trimStart());
  assert.deepEqual(reactiveProps.diagnostics, []);
  assert.match(reactiveProps.code ?? "", /__velarDynamic\(__el\d+, \(__childScope\) => __velarUseComponent\(Badge\(\{ label: label\.get\(\) \}, __namespace\)/u);

  const props = compile(`
component Badge(label: string):
    return <span>{label}</span>

component App:
    return <main><Badge missing="value" /></main>
`.trimStart());
  assert.ok(props.diagnostics.some((item) => item.code === "VEL5012" && /label/.test(item.message)));
  assert.ok(props.diagnostics.some((item) => item.code === "VEL5013" && /missing/.test(item.message)));

  const directives = compile(`
component Form:
    const name = "Ada"
    return <div>
        <input bind:value={name} />
        <span on:click={name}>Wrong</span>
        <img src="avatar.png" />
    </div>
`.trimStart());
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5019"));
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5021"));
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5023"));
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5016"));

  const correctRef = compile(`
component CanvasView:
    let canvas: CanvasElement? = none
    return <canvas ref={canvas}></canvas>

component DialogView:
    let dialog: DialogElement? = none
    return <dialog ref={dialog}>Confirm</dialog>
`.trimStart());
  assert.deepEqual(correctRef.diagnostics, []);
  assert.match(correctRef.code ?? "", /cleanups\.push\(\(\) => \{ if \(canvas === __el\d+\) canvas = null; \}\)/u);

  const wrongRef = compile(`
component CanvasView:
    let canvas: InputElement? = none
    return <canvas ref={canvas}></canvas>
`.trimStart());
  assert.ok(wrongRef.diagnostics.some((item) => item.code === "VEL5024"));

  const nonOptionalRef = compile(`
component CanvasView:
    let canvas: CanvasElement = none
    return <canvas ref={canvas}></canvas>
`.trimStart());
  assert.ok(nonOptionalRef.diagnostics.some((item) => item.code === "VEL5024" && /cleanup can restore none/u.test(item.message)));
});

test("JSX conditional branches stay readable, narrowed, and ownership-safe", () => {
  const result = compile(`
type User:
    name: string

component Badge(label: string):
    return <strong>{label}</strong>

component Profile(user: User?, failed: Error?, loading: bool):
    return <main>
        <p if={loading} aria-busy="true">Loading…</p>
        <p else-if={failed} role="alert">{failed.message}</p>
        <Badge else-if={user} label={user.name} />
        <p else>Guest</p>
    </main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarDynamic\(__el\d+, \(__childScope\) => \(loading \?/u);
  assert.match(result.code ?? "", /failed != null/u);
  assert.match(result.code ?? "", /user != null/u);
  assert.doesNotMatch(result.code ?? "", /__velarStaticAttr\([^\n]+"(?:if|else-if|else)"/u);

  const invalid = compile(`
component Broken:
    return <main>
        <p else>Orphan</p>
        <p if="yes">Missing expression</p>
        <p if={true} else>Two controls</p>
        <p if={true}>First</p>
        <p else={true}>Bad else</p>
        <span>Break adjacency</span>
        <p else-if={true}>Late branch</p>
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.filter((item) => item.code === "VEL5029").length >= 5);

  const badCondition = compile("component Broken:\n    return <main><p if={\"yes\"}>Wrong</p></main>\n");
  assert.ok(badCondition.diagnostics.some((item) => /Condition must be bool or optional/u.test(item.message)));
});

test("native JSX events provide checked browser payloads without wrappers", () => {
  const result = compile(`
type KeyPayload = KeyboardEvent

def isKeyPayload(value: unknown) -> bool:
    return value is KeyPayload

component Controls:
    def handleAny(event: Event) -> none:
        print(event.type)

    def handleKey(event: KeyboardEvent) -> none:
        print(event.key)

    return <main>
        <input on:keydown={handleKey} on:keyup={event => print(event.code)} on:input={event => print(event.inputType)} />
        <button type="button" on:click={event => print(event.clientX)}>Point</button>
        <button type="button" on:click={handleAny}>Any event</button>
    </main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const contextual = result.semanticIndex.symbols.filter((item) => item.kind === "parameter" && item.name === "event");
  assert.ok(contextual.some((item) => item.type === "KeyboardEvent"));
  assert.ok(contextual.some((item) => item.type === "InputEvent"));
  assert.ok(contextual.some((item) => item.type === "PointerEvent"));
  assert.match(result.code ?? "", /__velarOn\(__el\d+, "keydown"/u);
  assert.match(result.code ?? "", /typeof KeyboardEvent !== "undefined"/u);
  assert.doesNotMatch(result.code ?? "", /new (?:Keyboard|Pointer|Input)Event/u);

  const structural = compile(`
type Summary:
    label: string

type Detailed:
    label: string
    count: number

def show(value: Summary) -> none:
    print(value.label)

const detail: Detailed = {label: "ready", count: 1}
show(detail)
`.trimStart());
  assert.deepEqual(structural.diagnostics, []);

  const invalid = compile(`
component Broken:
    def pointerOnly(event: PointerEvent) -> none:
        print(event.clientX)

    def tooMany(first: Event, second: Event) -> none:
        print(first.type)

    return <main>
        <input on:keydown={pointerOnly} />
        <button type="button" on:click={tooMany}>Wrong</button>
        <input on:keydown={event => print(event.missing)} />
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5021" && /provides KeyboardEvent, not PointerEvent/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5021" && /zero parameters or one PointerEvent/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /KeyboardEvent.*no field 'missing'/u.test(item.message)));
});

test("requires and lowers stable keys for dynamic JSX lists", () => {
  const missing = compile(`
component ListView:
    state names = ["Ada"]
    return <ul>{names.map(name => <li>{name}</li>)}</ul>
`.trimStart());
  assert.ok(missing.diagnostics.some((item) => item.code === "VEL5017"));

  const keyed = compile(`
component ListView:
    state names = ["Ada"]
    return <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(keyed.diagnostics, []);
  assert.match(keyed.code ?? "", /__velarKeyed/);
  assert.match(keyed.code ?? "", /Duplicate JSX key/);
});

test("checks accessible button names and safe native links", () => {
  const invalid = compile(`
component App:
    return <main>
        <button></button>
        <a>Missing href</a>
        <a href="https://example.com" target="_blank">Unsafe target</a>
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5026"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5027"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5028"));

  const valid = compile(`
component App:
    return <main>
        <button aria-label="Save"></button>
        <a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>
    </main>
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
});

test("CLI emits complete Web application assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-web-build-"));
  const execution = spawnSync(process.execPath, [
    "packages/cli/src/cli.ts",
    "build",
    "examples/api-dashboard",
    "--out-dir",
    directory,
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(execution.status, 0, String(execution.stderr));
  const html = await readFile(join(directory, "index.html"), "utf8");
  assert.match(html, /<script type="module" src="\/assets\/main-[A-Z0-9]+\.js">/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.match(html, /Content-Security-Policy/u);
  const assets = await readdir(join(directory, "assets"));
  const stylesheet = assets.find((name) => /^styles-[a-f0-9]+\.css$/u.test(name));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  const trafficChunk = assets.find((name) => /^chunk-traffic-bar-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(stylesheet && javascript && trafficChunk);
  assert.match(await readFile(join(directory, "assets", stylesheet), "utf8"), /data-velar-/);
  assert.match(await readFile(join(directory, "assets", javascript), "utf8"), /Intl\.NumberFormat/);
  assert.ok(assets.includes(`${javascript}.map`));
  assert.match(await readFile(join(directory, "data/dashboard.json"), "utf8"), /Friday/);
  assert.match(await readFile(join(directory, "data/metrics-primary.json"), "utf8"), /Visitors/);
  assert.match(await readFile(join(directory, "data/metrics-secondary.json"), "utf8"), /API latency/);
  const manifest = JSON.parse(await readFile(join(directory, "velar-build.json"), "utf8")) as {
    formatVersion: number;
    kind: string;
    apiVersion: string;
    compiler: { name: string; version: string };
    buildId: string;
    sourceMaps: boolean;
    entry: string;
    modules: { total: number; application: number; packages: Array<{ name: string; modules: number }> };
    dependencies: { velar: string[]; javascript: string[] };
    deployment: { manifest: string; fallback: string | null; contentSecurityPolicy: boolean; adapter: string };
    assets: Array<{ path: string; sizeBytes: number; sha256: string; role: string }>;
  };
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.kind, "velar-web-build");
  assert.equal(manifest.apiVersion, "0.6");
  assert.deepEqual(manifest.compiler, { name: "velar", version: "0.9.0-dev" });
  assert.match(manifest.buildId, /^[a-f0-9]{64}$/u);
  assert.equal(manifest.sourceMaps, true);
  assert.equal(manifest.entry, `assets/${javascript}`);
  assert.equal(manifest.modules.total, 3);
  assert.equal(manifest.modules.application, 3);
  assert.deepEqual(manifest.modules.packages, []);
  assert.deepEqual(manifest.dependencies, { velar: [], javascript: ["@velarscript/demo-format"] });
  assert.deepEqual(manifest.deployment, { manifest: "velar-deploy.json", fallback: "404.html", contentSecurityPolicy: true, adapter: "neutral" });
  assert.ok(manifest.assets.some((asset) => asset.path === "index.html" && asset.role === "html" && asset.sizeBytes > 0 && asset.sha256.length === 64));
  assert.ok(manifest.assets.some((asset) => asset.path === "404.html" && asset.role === "html"));
  assert.ok(manifest.assets.some((asset) => asset.path === "velar-deploy.json" && asset.role === "deployment"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${javascript}` && asset.role === "entry"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${javascript}.map` && asset.role === "source-map"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${trafficChunk}` && asset.role === "asset"));
  assert.ok(manifest.assets.some((asset) => asset.path === `assets/${trafficChunk}.map` && asset.role === "source-map"));
});

test("language server publishes diagnostics, hover, and completion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-lsp-project-"));
  const modelsPath = join(directory, "models.vel");
  const mainPath = join(directory, "main.vel");
  const mainText = [
    "import {greet} from \"./models.vel\"",
    "const label = greet(\"Ada\")",
    "const explicit: string = \"ready\"",
    "async def loadLabel() -> string:",
    "    return \"remote\"",
    "component Summary:",
    "    state count = 1",
    "    computed doubled = count * 2",
    "    resource remote = loadLabel()",
    "    return <><p>{remote.loading ? \"Loading\" : doubled}</p><button type=\"button\" on:click={() => remote.reload()}>Reload</button></>",
    "",
  ].join("\n");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ entry: "main.vel" }), "utf8");
  await writeFile(modelsPath, "/// Greets one visible user.\nexport def greet(name: string) -> string:\n    return name\n", "utf8");
  await writeFile(mainPath, mainText, "utf8");
  const mainUri = pathToFileURL(mainPath).href;
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = Buffer.alloc(0);
  const messages: Array<Record<string, unknown>> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    output = Buffer.concat([output, chunk]);
    while (true) {
      const boundary = output.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const header = output.subarray(0, boundary).toString("ascii");
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match) break;
      const size = Number(match[1]);
      const end = boundary + 4 + size;
      if (output.length < end) break;
      messages.push(JSON.parse(output.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      output = output.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for LSP message. stderr: ${String(child.stderr.read() ?? "")}`);
  };

  child.stdin.write("Content-Length: 1\r\n\r\n{");
  const parseFailure = await waitFor((message) => message.id === null
    && (message.error as { code?: number } | undefined)?.code === -32700);
  assert.match(JSON.stringify(parseFailure), /Invalid JSON/u);

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const initialized = await waitFor((message) => message.id === 1);
  const initializeResult = initialized.result as {
    capabilities: {
      definitionProvider: boolean;
      completionProvider: { triggerCharacters: string[] };
      documentHighlightProvider: boolean;
      inlayHintProvider: boolean;
      renameProvider: { prepareProvider: boolean };
      semanticTokensProvider: { legend: { tokenTypes: string[]; tokenModifiers: string[] }; full: boolean };
      codeActionProvider: { codeActionKinds: string[] };
      experimental: { velar: { protocolVersion: number } };
    };
    serverInfo: { name: string };
  };
  assert.equal(initializeResult.serverInfo.name, "Velar Language Server");
  assert.equal(initializeResult.capabilities.experimental.velar.protocolVersion, 1);
  assert.equal(initializeResult.capabilities.definitionProvider, true);
  assert.deepEqual(initializeResult.capabilities.completionProvider.triggerCharacters, [".", "<", " ", "{", ",", ":"]);
  assert.equal(initializeResult.capabilities.documentHighlightProvider, true);
  assert.equal(initializeResult.capabilities.inlayHintProvider, true);
  assert.equal(initializeResult.capabilities.renameProvider.prepareProvider, true);
  assert.deepEqual(initializeResult.capabilities.semanticTokensProvider.legend.tokenTypes,
    ["type", "class", "enum", "enumMember", "function", "method", "property", "variable", "parameter"]);
  assert.deepEqual(initializeResult.capabilities.semanticTokensProvider.legend.tokenModifiers,
    ["declaration", "readonly", "static"]);
  assert.equal(initializeResult.capabilities.semanticTokensProvider.full, true);
  assert.deepEqual(initializeResult.capabilities.codeActionProvider.codeActionKinds, ["quickfix"]);
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: "file:///tmp/velar-lsp-test.vel", languageId: "velar", version: 1, text: "component App:\n    let dialog: DialogElement? = none\n    return <img />\n" } },
  });
  const published = await waitFor((message) => message.method === "textDocument/publishDiagnostics");
  const diagnostics = (published.params as { diagnostics: Array<{ code: string }> }).diagnostics;
  assert.ok(diagnostics.some((item) => item.code === "VEL5016"));

  const fixUri = "file:///tmp/velar-lsp-fix.vel";
  const fixText = "const same = 1 === 1\n\tprint(same)\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: fixUri, languageId: "velar", version: 1, text: fixText } },
  });
  const fixPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === fixUri);
  const fixDiagnostics = (fixPublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  assert.ok(fixDiagnostics.some((item) => item.code === "VEL1005"));
  assert.ok(fixDiagnostics.some((item) => item.code === "VEL1002"));
  send({
    jsonrpc: "2.0",
    id: 30,
    method: "textDocument/codeAction",
    params: {
      textDocument: { uri: fixUri },
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } },
      context: { diagnostics: fixDiagnostics, only: ["quickfix"] },
    },
  });
  const fixed = await waitFor((message) => message.id === 30);
  const fixes = fixed.result as Array<{ title: string; kind: string; isPreferred: boolean; edit: { changes: Record<string, Array<{ newText: string }>> } }>;
  assert.deepEqual(fixes.map((item) => item.edit.changes[fixUri]![0]!.newText).sort(), ["    ", "=="]);
  assert.ok(fixes.every((item) => item.kind === "quickfix" && item.isPreferred));

  send({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: { textDocument: { uri: "file:///tmp/velar-lsp-test.vel" }, position: { line: 0, character: 2 } } });
  const hovered = await waitFor((message) => message.id === 2);
  assert.match(JSON.stringify(hovered.result), /compiler-managed Web component/);
  send({ jsonrpc: "2.0", id: 3, method: "textDocument/completion", params: { textDocument: { uri: "file:///tmp/velar-lsp-test.vel" }, position: { line: 0, character: 0 } } });
  const completed = await waitFor((message) => message.id === 3);
  assert.match(JSON.stringify(completed.result), /bind:value/);
  assert.match(JSON.stringify(completed.result), /abstract/);
  assert.match(JSON.stringify(completed.result), /override/);
  assert.match(JSON.stringify(completed.result), /"label":"get"/);
  assert.match(JSON.stringify(completed.result), /init/);
  assert.match(JSON.stringify(completed.result), /super/);
  assert.match(JSON.stringify(completed.result), /throw/);
  assert.match(JSON.stringify(completed.result), /assert/);
  assert.match(JSON.stringify(completed.result), /velar\/collections/);
  assert.match(JSON.stringify(completed.result), /velar\/async/);
  assert.match(JSON.stringify(completed.result), /velar\/time/);
  assert.match(JSON.stringify(completed.result), /velar\/log/);
  assert.match(JSON.stringify(completed.result), /velar\/app/);
  assert.match(JSON.stringify(completed.result), /velar\/config/);
  assert.match(JSON.stringify(completed.result), /velar\/browser/);
  assert.match(JSON.stringify(completed.result), /velar\/realtime/);
  assert.match(JSON.stringify(completed.result), /DialogElement/);
  assert.match(JSON.stringify(completed.result), /resource/);
  assert.match(JSON.stringify(completed.result), /action/);
  send({ jsonrpc: "2.0", id: 20, method: "textDocument/hover", params: { textDocument: { uri: "file:///tmp/velar-lsp-test.vel" }, position: { line: 1, character: 18 } } });
  const dialogTypeHover = await waitFor((message) => message.id === 20);
  assert.match(JSON.stringify(dialogTypeHover.result), /native dialog reference/);

  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: mainUri, languageId: "velar", version: 1, text: mainText } },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === mainUri);
  const greetColumn = mainText.split("\n")[1]!.indexOf("greet") + 1;
  const callColumn = mainText.split("\n")[1]!.indexOf("greet(") + "greet(".length;
  send({ jsonrpc: "2.0", id: 32, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const documentedHover = await waitFor((message) => message.id === 32);
  assert.match(JSON.stringify(documentedHover.result), /Greets one visible user/u);
  send({ jsonrpc: "2.0", id: 4, method: "textDocument/definition", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const definition = await waitFor((message) => message.id === 4);
  assert.equal((definition.result as { uri: string }).uri, pathToFileURL(modelsPath).href);
  send({ jsonrpc: "2.0", id: 5, method: "textDocument/references", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn }, context: { includeDeclaration: true } } });
  const references = await waitFor((message) => message.id === 5);
  assert.equal((references.result as unknown[]).length, 3);
  send({ jsonrpc: "2.0", id: 22, method: "textDocument/documentHighlight", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const documentHighlights = await waitFor((message) => message.id === 22);
  const highlightedRanges = documentHighlights.result as Array<{ range: Range; kind: number }>;
  assert.equal(highlightedRanges.length, 2, "document highlights must not include the declaration in another module");
  assert.ok(highlightedRanges.every((highlight) => highlight.kind === 1));
  send({ jsonrpc: "2.0", id: 6, method: "textDocument/rename", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn }, newName: "welcome" } });
  const renamed = await waitFor((message) => message.id === 6);
  const changes = (renamed.result as { changes: Record<string, unknown[]> }).changes;
  assert.equal(changes[mainUri]?.length, 2);
  assert.equal(changes[pathToFileURL(modelsPath).href]?.length, 1);
  send({ jsonrpc: "2.0", id: 7, method: "textDocument/documentSymbol", params: { textDocument: { uri: mainUri } } });
  const symbols = await waitFor((message) => message.id === 7);
  assert.match(JSON.stringify(symbols.result), /label/);
  send({ jsonrpc: "2.0", id: 8, method: "textDocument/signatureHelp", params: { textDocument: { uri: mainUri }, position: { line: 1, character: callColumn } } });
  const signature = await waitFor((message) => message.id === 8);
  assert.match(JSON.stringify(signature.result), /greet\(string\) -&gt; string|greet\(string\) -> string/u);
  send({ jsonrpc: "2.0", id: 21, method: "textDocument/inlayHint", params: { textDocument: { uri: mainUri }, range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } } } });
  const inlayHints = await waitFor((message) => message.id === 21);
  const typeHints = inlayHints.result as Array<{ position: { line: number; character: number }; label: string; kind: number; paddingRight: boolean }>;
  assert.ok(typeHints.some((hint) => hint.position.line === 1 && hint.label === ": string"));
  assert.ok(typeHints.some((hint) => hint.position.line === 6 && hint.label === ": number"));
  assert.ok(typeHints.some((hint) => hint.position.line === 7 && hint.label === ": number"));
  assert.ok(!typeHints.some((hint) => hint.position.line === 2), "explicit annotations must not receive duplicate hints");
  assert.ok(!typeHints.some((hint) => hint.position.line === 8), "resource handle types must not masquerade as source annotations");
  send({ jsonrpc: "2.0", id: 31, method: "textDocument/semanticTokens/full", params: { textDocument: { uri: mainUri } } });
  const semanticTokens = await waitFor((message) => message.id === 31);
  const semanticData = (semanticTokens.result as { data: number[] }).data;
  assert.equal(semanticData.length % 5, 0);
  const decodedTokens: Array<{ text: string; type: number; modifiers: number }> = [];
  let semanticLine = 0;
  let semanticCharacter = 0;
  for (let index = 0; index < semanticData.length; index += 5) {
    const deltaLine = semanticData[index]!;
    semanticLine += deltaLine;
    semanticCharacter = deltaLine === 0 ? semanticCharacter + semanticData[index + 1]! : semanticData[index + 1]!;
    decodedTokens.push({
      text: mainText.split("\n")[semanticLine]!.slice(semanticCharacter, semanticCharacter + semanticData[index + 2]!),
      type: semanticData[index + 3]!,
      modifiers: semanticData[index + 4]!,
    });
  }
  assert.ok(decodedTokens.some((token) => token.text === "Summary" && token.type === 4 && (token.modifiers & 1) === 1));
  assert.ok(decodedTokens.some((token) => token.text === "label" && token.type === 7 && (token.modifiers & 3) === 3));
  assert.ok(decodedTokens.some((token) => token.text === "loading" && token.type === 6));
  assert.ok(decodedTokens.some((token) => token.text === "reload" && token.type === 5));
  send({ jsonrpc: "2.0", id: 25, method: "textDocument/completion", params: { textDocument: { uri: mainUri }, position: { line: 9, character: mainText.split("\n")[9]!.indexOf("doubled") } } });
  const semanticCompletion = await waitFor((message) => message.id === 25);
  const semanticItems = (semanticCompletion.result as { items: Array<{ label: string; kind: number; detail?: string; documentation?: { value?: string } }> }).items;
  assert.ok(semanticItems.some((item) => item.label === "count" && item.kind === 6 && item.detail === "number"));
  assert.ok(semanticItems.some((item) => item.label === "doubled" && item.kind === 6 && item.detail === "number"));
  assert.ok(semanticItems.some((item) => item.label === "Summary" && item.kind === 7));
  assert.ok(semanticItems.some((item) => item.label === "greet" && item.kind === 6
    && /Greets one visible user/u.test(item.documentation?.value ?? "")));
  const remoteMemberColumn = mainText.split("\n")[9]!.indexOf("remote.loading") + "remote.".length;
  send({ jsonrpc: "2.0", id: 26, method: "textDocument/completion", params: { textDocument: { uri: mainUri }, position: { line: 9, character: remoteMemberColumn } } });
  const memberCompletion = await waitFor((message) => message.id === 26);
  const memberItems = (memberCompletion.result as { items: Array<{ label: string; kind: number; detail?: string }> }).items;
  assert.ok(memberItems.some((item) => item.label === "value" && item.kind === 5 && item.detail === "string?"));
  assert.ok(memberItems.some((item) => item.label === "loading" && item.kind === 5 && item.detail === "bool"));
  assert.ok(memberItems.some((item) => item.label === "reload" && item.kind === 2 && item.detail === "() -> Promise<none>"));
  const reloadCallColumn = mainText.split("\n")[9]!.indexOf("remote.reload(") + "remote.reload(".length;
  send({ jsonrpc: "2.0", id: 27, method: "textDocument/signatureHelp", params: { textDocument: { uri: mainUri }, position: { line: 9, character: reloadCallColumn } } });
  const memberSignature = await waitFor((message) => message.id === 27);
  assert.deepEqual(memberSignature.result, {
    signatures: [{ label: "reload() -> Promise<none>" }],
    activeSignature: 0,
    activeParameter: 0,
  });
  send({ jsonrpc: "2.0", id: 28, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 9, character: remoteMemberColumn } } });
  const memberHover = await waitFor((message) => message.id === 28);
  assert.match(JSON.stringify(memberHover.result), /field remote\.loading|field loading: bool/u);

  const recordRenameText = [
    "type User:",
    "    name: string",
    "def make(name: string) -> User:",
    "    return {name}",
    "const user = make(\"Ada\")",
    "print(user.name)",
    "",
  ].join("\n");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: mainUri, version: 2 },
      contentChanges: [{ text: recordRenameText }],
    },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === mainUri
    && (message.params as { version?: number }).version === 2);
  send({ jsonrpc: "2.0", id: 29, method: "textDocument/rename", params: { textDocument: { uri: mainUri }, position: { line: 1, character: 5 }, newName: "fullName" } });
  const recordRename = await waitFor((message) => message.id === 29);
  const recordChanges = (recordRename.result as { changes: Record<string, Array<{ newText: string }>> }).changes[mainUri] ?? [];
  assert.equal(recordChanges.length, 3);
  assert.equal(recordChanges.filter((edit) => edit.newText === "fullName").length, 2);
  assert.equal(recordChanges.filter((edit) => edit.newText === "fullName: name").length, 1);

  const referenceHeavyText = `const value = 1\n${"print(value)\n".repeat(10_050)}`;
  send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: mainUri, version: 3 },
      contentChanges: [{ text: referenceHeavyText }],
    },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === mainUri
    && (message.params as { version?: number }).version === 3);
  send({ jsonrpc: "2.0", id: 23, method: "textDocument/references", params: { textDocument: { uri: mainUri }, position: { line: 0, character: 7 }, context: { includeDeclaration: true } } });
  const boundedReferences = await waitFor((message) => message.id === 23);
  assert.equal((boundedReferences.result as unknown[]).length, 10_000);
  send({ jsonrpc: "2.0", id: 24, method: "textDocument/rename", params: { textDocument: { uri: mainUri }, position: { line: 0, character: 7 }, newName: "nextValue" } });
  const boundedRename = await waitFor((message) => message.id === 24);
  assert.match(String((boundedRename.error as { message?: string }).message), /more than 10000 locations/u);

  send({ jsonrpc: "2.0", id: 9, method: "shutdown", params: null });
  await waitFor((message) => message.id === 9);
  send({ jsonrpc: "2.0", id: 10, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 0, character: 0 } } });
  const shuttingDown = await waitFor((message) => message.id === 10);
  assert.equal((shuttingDown.error as { code: number }).code, -32600);
  send({ jsonrpc: "2.0", method: "exit", params: null });
  child.stdin.end();
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
});
