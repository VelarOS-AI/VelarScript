import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { SourceMap } from "node:module";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { compile as compileCore, describeType, formatDiagnostic, formatSource, inspectModule as inspectCoreModule, MAX_VELAR_SOURCE_CODE_UNITS, semanticVisibleSymbolsAt, SourceText, type CompilerExtension } from "@velarscript/compiler";
import { VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION } from "@velarscript/compiler/framework-host";
import { isAssignable, sameType, type ValueType } from "../packages/compiler/src/types.ts";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { compileProject as compileProjectCore, moduleInterfaceIdentity, type CompileProjectOptions, type ProjectResult } from "../packages/cli/src/project.ts";
import { projectStyles } from "../packages/cli/src/framework-host.ts";
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
import { moduleOutput } from "../packages/cli/src/module-assets.ts";
import { npmAsset } from "../packages/cli/src/npm.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleInterface as standardModuleInterfaceCore, standardModuleSource as standardModuleSourceCore } from "../packages/cli/src/standard-modules.ts";
import { VELAR_WEB_API_VERSION, VELAR_WEB_MODULES, velarWebFramework } from "../packages/web/src/index.ts";
import { velarCompilerExtension, webModuleInterfaces, webModuleSource, webModuleSources } from "../packages/web/src/compiler.ts";
import { velarFrameworkHost } from "../packages/web/src/host.ts";
import type { VelarWebConfig } from "../packages/web/src/project-config.ts";
import { loadTypeScriptDeclarations, parseTypeScriptDeclarations } from "../packages/cli/src/typescript-declarations.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";
import { startProductionPreview } from "../packages/cli/src/preview-server.ts";
import { verifyRemoteDeployment, type DeploymentFetch } from "../packages/cli/src/deployment-verifier.ts";
import { parseDependencyArguments, runDependencyCommand } from "../packages/cli/src/package-manager.ts";
import { asHostError, hostErrorCode, hostErrorMessage, hostErrorStack } from "../packages/cli/src/host-error.ts";

const webCompilerExtensions = Object.freeze([velarCompilerExtension]);
const unavailableOfficialParameterNames = new Set([
  ...Object.keys(keywordKinds),
  ...Object.keys(velarCompilerExtension.lexical?.keywords ?? {}),
  ...Object.keys(velarCompilerExtension.lexical?.forbiddenIdentifiers ?? {}),
]);

function compile(text: string, options: Parameters<typeof compileCore>[1] = {}) {
  return compileCore(text, { ...options, extensions: options.extensions ?? webCompilerExtensions });
}

function inspectModule(text: string, options: Parameters<typeof inspectCoreModule>[1] = {}) {
  return inspectCoreModule(text, { ...options, extensions: options.extensions ?? webCompilerExtensions });
}

function compileProject(
  entry: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  options: CompileProjectOptions = {},
  previous: ProjectResult | null = null,
  changedPaths: ReadonlySet<string> = new Set(),
) {
  return compileProjectCore(entry, overrides, { ...options, extensions: options.extensions ?? webCompilerExtensions }, previous, changedPaths);
}

function standardModuleApi() {
  return standardModuleApiCore(webCompilerExtensions);
}

function standardModuleInterface(source: string) {
  return standardModuleInterfaceCore(source, webCompilerExtensions);
}

function standardModuleSource(source: string, web: { readonly base: string; readonly publicConfig?: Readonly<Record<string, unknown>> } = { base: "/" }) {
  return standardModuleSourceCore(source, web, webCompilerExtensions);
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function assertDevServerExit(exitCode: number | null, stderr: string): void {
  assert.ok(exitCode === 0 || (process.platform === "win32" && exitCode === null), stderr || `Unexpected dev-server exit code ${String(exitCode)}`);
}

async function stopDevServer(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Dev server did not stop"));
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function linkWorkspaceWebExtension(projectRoot: string): Promise<void> {
  const scope = join(projectRoot, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/web"), join(scope, "web"), "dir");
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

test("bare returns preserve null at direct JavaScript and asynchronous boundaries", () => {
  const result = compileCore(`
def stop():
    return

async def stopLater():
    return

class Controller:
    def stop():
        return
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /return;/u);
  assert.match(result.code ?? "", /return null;/u);
  const execution = executeModule(`${result.code ?? ""}
console.log(stop() === null);
console.log((await stopLater()) === null);
console.log(new Controller().stop() === null);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n");
});

test("named arguments are checked, reordered, and evaluated in source order", () => {
  const result = compileCore(`
def describe(name: string, count: number = 1, excited: bool = false) -> string:
    return name

def mark(value: string) -> string:
    print(value)
    return value

const label = describe(excited=true, name=mark("name"), count=2)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /describe\(\.\.\.\(\(__namedArguments\) => \[__namedArguments\[1\], __namedArguments\[2\], __namedArguments\[0\]\]\)\(\[true, mark\("name"\), 2\]\)\)/u);
  const signature = result.moduleInterface.exports.get("describe");
  assert.equal(signature, undefined);

  const unknown = compileCore(`
def greet(name: string, count: number = 1):
    print(name)

greet(missing="Velar")
`.trimStart());
  assert.match(unknown.diagnostics.map((item) => item.message).join("\n"), /Unknown named argument 'missing'/u);
  const duplicate = compileCore(`def greet(name: string):\n    print(name)\n\ngreet(name="Velar", name="Again")\n`);
  assert.match(duplicate.diagnostics.map((item) => item.message).join("\n"), /more than once/u);
  const positional = compileCore(`def greet(name: string, count: number = 1):\n    print(name)\n\ngreet(name="Velar", 2)\n`);
  assert.match(positional.diagnostics.map((item) => item.message).join("\n"), /Positional arguments must appear before named arguments/u);
  const colon = compileCore(`def greet(name: string):\n    print(name)\n\ngreet(name: "Velar")\n`);
  assert.match(colon.diagnostics.map((item) => item.message).join("\n"), /uses ':' rather than '='/u);
});

test("named calls evaluate the callee first and preserve optional short-circuiting", () => {
  const result = compileCore(`
let events: List<string> = []

def mark(value: string) -> string:
    events.append(value)
    return value

class Service:
    def describe(first: string, second: string) -> string:
        return f"{first}:{second}"

class Host:
    get service() -> Service:
        events.append("callee")
        return Service()

const host = Host()
print(host.service.describe(second=mark("second"), first=mark("first")))
const absent: Service? = null
print(absent?.describe(first=mark("skipped"), second="unused") == null)
print(events.join(","))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:second\ntrue\ncallee,second,first\n");
});

test("calls in argument positions and getter callees preserve narrowing facts", () => {
  // A call in an earlier named argument does not drop facts read by a later
  // argument: calls are not invalidation points.
  const named = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def consume(first: string, second: string) -> string:
    return first

def label(box: Box) -> string:
    assert box.user
    return consume(second=clear(box), first=box.user.name)
`.trimStart());
  assert.equal(named.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // Reading a getter to obtain the callee is an ordinary read; argument
  // expressions may still rely on facts narrowed before the call.
  const getter = compileCore(`
type User:
    name: string

class Service:
    def describe(name: string) -> string:
        return name

class Host:
    let user: User? = {name: "Ada"}

    get service() -> Service:
        self.user = null
        return Service()

def label(host: Host) -> string:
    assert host.user
    return host.service.describe(name=host.user.name)
`.trimStart());
  assert.equal(getter.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("keeps Web syntax outside the Core language unless the project loads the Web extension", () => {
  const core = compileCore("component App:\n    return <main>Core must reject this</main>\n");
  assert.ok(core.diagnostics.length > 0);
  assert.deepEqual(core.extensions, []);

  const web = compile("component App:\n    return <main>Web owns this</main>\n");
  assert.deepEqual(web.diagnostics, []);
  assert.deepEqual(web.extensions, ["@velarscript/web"]);
});

test("else if chains preserve rejected facts, complete returns, and readable JavaScript", () => {
  const result = compile(`
def describe(value: number?, fallback: string?) -> string:
    if value == null:
        return fallback ?? "missing"
    else if value > 10:
        return f"high:{value}"
    else if fallback != null:
        return f"{fallback}:{value}"
    else:
        return f"low:{value}"

print(describe(null, null))
print(describe(12, null))
print(describe(4, "steady"))
print(describe(2, null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\} else if \(\(value > 10\)\) \{/u);
  assert.match(result.code ?? "", /\} else if \(\(\(fallback \?\? null\) !== null\)\) \{/u);
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
        return f"text:{value}"
    else if value is number:
        return f"number:{value + 1}"
    else:
        return value ? "yes" : "no"

def increment(value: string | number) -> number:
    assert not (value is string) else "Expected a number"
    return value + 1

def incrementField(payload: Payload) -> number:
    if payload.value is string:
        return payload.value == "" ? 0 : 1
    else:
        return payload.value + 1

def optionalIncrement(value: number?) -> number:
    if value is null:
        return 0
    else:
        return value + 1

component Preview(value: DisplayValue):
    def content() -> WebNode:
        if value is string:
            return <p>{value}</p>
        else if value is number:
            return <p>{value + 1}</p>
        else:
            return <p>{value ? "yes" : "no"}</p>

    return <div>{content()}</div>

print(display("velar"))
print(display(4))
print(display(true))
print(increment(4))
print(incrementField({value: 9}))
print(optionalIncrement(null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "text:velar\nnumber:5\nyes\n5\n10\n0\n");

  const unsafeContinuation = compile(`
def invalid(value: string | number):
    if value is string:
        print(value)
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
const count = (...values: string) => values.size
print(total(1, ...tail))
print(total(1, 2, 3))
print(Calculator().total(1, ...tail))
print(count("a", "b"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function total\(first, \.\.\.values\)/u);
  assert.match(result.code ?? "", /total\(first, \.\.\.values\)/u);
  assert.match(result.code ?? "", /\.\.\.__velarCopyList\(tail, "Call spread"\)/u);
  assert.match(result.code ?? "", /const count = \(\.\.\.values\) => __velarCollectionSize\(values\);/u);
  const restSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "values" && symbol.kind === "parameter");
  assert.equal(restSymbol?.type, "List<number>");
  const totalSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "total" && symbol.kind === "function");
  assert.equal(totalSymbol?.type, "(first: number, ...number) -> number");
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "6\n6\n6\n2\n");

  const hostile = compileCore(`
import js {tail} from "fixture"

def total(first: number, ...values: number) -> number:
    return first + values[0] + values[1]

print(total(1, ...tail))
`.trimStart(), { analysis: { imports: new Map([
    ["tail", { kind: "list", element: { kind: "number" } }],
  ]) } });
  assert.deepEqual(hostile.diagnostics, []);
  const hostileExecution = executeModule((hostile.code ?? "").replace(/^import .*?;\n+/mu, `
class HostileList extends Array {
  [Symbol.iterator]() { throw new Error("iterator override"); }
}
const tail = new HostileList(2, 3);
`));
  assert.equal(hostileExecution.status, 0, String(hostileExecution.stderr));
  assert.equal(hostileExecution.stdout, "6\n");

  const asynchronousSpread = compileCore(`
async def read(value: number) -> number:
    print(f"read:{value}")
    return value

async def readTail() -> List<number>:
    print("tail")
    return [2, 3]

const values = [await read(1), ...await readTail(), await read(4)]
print(f"{values[0]}:{values[3]}")
`.trimStart());
  assert.deepEqual(asynchronousSpread.diagnostics, []);
  assert.match(asynchronousSpread.code ?? "", /await __velarCreateListAsync/u);
  const asynchronousExecution = executeModule(asynchronousSpread.code ?? "");
  assert.equal(asynchronousExecution.status, 0, String(asynchronousExecution.stderr));
  assert.equal(asynchronousExecution.stdout, "read:1\ntail\nread:4\n1:4\n");
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
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "combine")?.type, "(left: number, right: number) -> Promise<number>");
  assert.match(result.code ?? "", /const load = async value => await __velarNormalizePromiseValue\(next\(value\)\);/u);
  assert.match(result.code ?? "", /const combine = async \(left, right\) => __velarNormalizePromiseValue\(next\(\(left \+ right\)\)\);/u);
  assert.match(result.code ?? "", /const member = \(await __velarNormalizePromiseValue\(result\(\)\)\)\.value;/u);
  assert.match(result.code ?? "", /const immediate = await __velarNormalizePromiseValue\(\(async \(\) => next\(8\)\)\(\)\);/u);
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
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign \(value: number\) -> Promise<number> to \(number\) -> number/u.test(item.message)));
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

test("a JavaScript statement block after '=>' receives one expression-arrow diagnostic", () => {
  // The reflexive JavaScript shape: braces holding statements after '=>'.
  // One targeted diagnostic replaces the record-literal error cascade.
  const multiStatement = compile(`
def register(handler: () -> null) -> null:
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
  assert.equal(result.semanticIndex.symbols.find((item) => item.kind === "action" && item.name === "save")?.type, "action () -> Promise<number>");
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
    `class Pair:\n    const second: number\n\n    constructor(first: number = 1, second: number):\n        self.second = second\n`,
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
  assert.ok(missingFixed.diagnostics.some((item) => /all 1 fixed argument before a call spread/u.test(item.message)));

  const fixedArity = compile(`
def format(value: number = 0) -> number:
    return value

const values = [1]
format(...values)
`.trimStart());
  assert.ok(fixedArity.diagnostics.some((item) => /requires a callable with a rest parameter/u.test(item.message)));

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
component Choice(label: string, onChoose: (string) -> null):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>

component App:
    state selected = "null"

    def choose(label: string) -> null:
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
    { kind: "componentConstructor", name: "Card", props: new Map([["title", { kind: "string" }]]), requiredProps: new Set(["title"]) },
    { kind: "componentConstructor", name: "Card", props: new Map([["count", { kind: "number" }]]), requiredProps: new Set(["count"]) },
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
def collect(...values: number) -> null:
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
def one(value: number) -> null:
    return null

const variadic: (...number) -> null = one
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign \(value: number\) -> null to \(\.\.\.number\) -> null/u.test(item.message)));
});

test("generic def functions infer type arguments at call sites", () => {
  const result = compile(`
def identity<T>(value: T) -> T:
    return value

def first<T>(items: List<T>) -> T?:
    return items.get(0)

def hold<T>(value: T) -> T?:
    let stored: T? = null
    stored = value
    return stored

def collect<T>(value: T) -> List<T>:
    const items = []
    items.append(value)
    return items

const chosen: number = identity(21)
const firstName: string? = first(["Ada", "Grace"])
const held: number? = hold(chosen)
const collected: List<number> = collect(3)
print(identity("ready"))
print(firstName)
print(held)
print(collected)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\nAda\n21\n[ 3 ]\n");

  const mismatched = compile("def identity<T>(value: T) -> T:\n    return value\n\nconst wrong: string = identity(5)\n");
  assert.deepEqual(mismatched.diagnostics.map((item) => item.message), ["Cannot assign number to string"]);
});

test("generic call-site inference solves callbacks, named arguments, spreads, and async results", async () => {
  const result = compile(`
def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)

def gather<T>(...values: T) -> List<T>:
    return values

async def wrap<T>(value: T) -> T:
    return value

const doubled: List<number> = mapValues([1, 2, 3], value => value * 2)
const named: List<number> = mapValues(transform = value => value == "a" ? 1 : 2, items = ["a", "bb"])
const collected: List<number> = gather(1, 2, 3)
const source = [4, 5]
const spreadOut: List<number> = gather(...source)
const wrapped: number = await wrap(8)
print(doubled)
print(named)
print(collected)
print(spreadOut)
print(wrapped)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 2, 4, 6 ]\n[ 1, 2 ]\n[ 1, 2, 3 ]\n[ 4, 5 ]\n8\n");

  const mismatched = compile(`
def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)

const wrong: List<string> = mapValues([1], value => value * 2)
`.trimStart());
  assert.deepEqual(mismatched.diagnostics.map((item) => item.message), ["Cannot assign List<number> to List<string>"]);
});

test("generic inference merges bindings to unions and defaults unsolved parameters to unknown", () => {
  const merged = compile(`
def pair<T>(left: T, right: T) -> List<T>:
    return [left, right]

const mixed: List<number | string> = pair(1, "two")
print(mixed)
`.trimStart());
  assert.deepEqual(merged.diagnostics, []);
  const execution = executeModule(merged.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 1, 'two' ]\n");

  const narrowed = compile(`
def pair<T>(left: T, right: T) -> List<T>:
    return [left, right]

const wrong: List<number> = pair(1, "two")
`.trimStart());
  assert.deepEqual(narrowed.diagnostics.map((item) => item.message), ["Cannot assign List<number | string> to List<number>"]);

  const unsolved = compile(`
def make<T>() -> List<T>:
    return []

const wrong: List<number> = make()
`.trimStart());
  assert.deepEqual(unsolved.diagnostics.map((item) => item.message), ["Cannot assign List<unknown> to List<number>"]);
});

test("generic callable identities are alpha-equivalent and satisfy concrete contracts by instantiation", () => {
  const parameterT: ValueType = { kind: "parameter", name: "T", index: 0 };
  const parameterU: ValueType = { kind: "parameter", name: "U", index: 0 };
  assert.equal(sameType(parameterT, parameterU), true);
  assert.equal(sameType(parameterT, { kind: "parameter", name: "T", index: 1 }), false);
  const genericIdentity: ValueType = { kind: "function", typeParameterNames: ["T"], parameters: [parameterT], requiredParameters: 1, result: parameterT };
  const renamedIdentity: ValueType = { kind: "function", typeParameterNames: ["U"], parameters: [parameterU], requiredParameters: 1, result: parameterU };
  assert.equal(sameType(genericIdentity, renamedIdentity), true);
  const widerArity: ValueType = { kind: "function", typeParameterNames: ["T", "U"], parameters: [parameterT], requiredParameters: 1, result: parameterT };
  assert.equal(sameType(genericIdentity, widerArity), false);
  const structuralEnvironment = { fieldsOf: () => null, isSubclassOf: () => false, isPrimitiveType: () => false, isPrimitiveSubtype: () => false };
  const numberToNumber: ValueType = { kind: "function", parameters: [{ kind: "number" }], requiredParameters: 1, result: { kind: "number" } };
  const stringToNumber: ValueType = { kind: "function", parameters: [{ kind: "string" }], requiredParameters: 1, result: { kind: "number" } };
  assert.equal(isAssignable(genericIdentity, numberToNumber, structuralEnvironment), true);
  assert.equal(isAssignable(numberToNumber, genericIdentity, structuralEnvironment), false);
  assert.equal(isAssignable(genericIdentity, stringToNumber, structuralEnvironment), false);

  const contract = compile(`
def identity<T>(value: T) -> T:
    return value

const typed: (number) -> number = identity
const alias = identity
print(typed(4))
print(alias("threaded"))
const same: List<number> = [4, 5].map(identity)
print(same)
`.trimStart());
  assert.deepEqual(contract.diagnostics, []);
  const execution = executeModule(contract.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4\nthreaded\n[ 4, 5 ]\n");

  const invalid = compile(`
def identity<T>(value: T) -> T:
    return value

const wrong: (string) -> number = identity
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), ["Cannot assign <T>(value: T) -> T to (string) -> number"]);
});

test("generic methods and extern functions share the def machinery", () => {
  const result = compile(`
class Box:
    def wrap<T>(value: T) -> List<T>:
        return [value]

    static def pairOf<T>(left: T, right: T) -> List<T>:
        return [left, right]

const box = Box()
const wrapped: List<number> = box.wrap(5)
const paired: List<string> = Box.pairOf("a", "b")
print(wrapped)
print(paired)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 5 ]\n[ 'a', 'b' ]\n");

  const extern = compile(`
extern module "helpers":
    export def pick<T>(items: List<T>) -> T?

import js { pick } from "helpers"

const value: number? = pick([1, 2, 3])
`.trimStart());
  assert.deepEqual(extern.diagnostics, []);

  const externMismatch = compile(`
extern module "helpers":
    export def pick<T>(items: List<T>) -> T?

import js { pick } from "helpers"

const value: string? = pick([1, 2, 3])
`.trimStart());
  assert.deepEqual(externMismatch.diagnostics.map((item) => item.message), ["Cannot assign number? to string?"]);
});

test("generic functions cross module boundaries with renamed imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-generic-modules-"));
  const libraryPath = join(directory, "library.vel");
  const consumerPath = join(directory, "consumer.vel");
  await writeFile(libraryPath, `
export def pick<T>(items: List<T>) -> T?:
    return items.get(0)

export def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)
`.trimStart(), "utf8");
  await writeFile(consumerPath, `
import {pick, mapValues as remap} from "./library.vel"

const chosen: number? = pick([1, 2, 3])
const lengths: List<number> = remap(["a", "bb"], value => value == "a" ? 1 : 2)
print(chosen)
print(lengths)
`.trimStart(), "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const symbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(symbols?.find((item) => item.name === "chosen")?.type, "number?");
  assert.equal(symbols?.find((item) => item.name === "lengths")?.type, "List<number>");
});

test("type parameter declarations fail closed", () => {
  for (const [source, code, message] of [
    ["def repeat<T, T>(value: T) -> T:\n    return value\n", "VEL4021", /declared more than once/u],
    ["type User:\n    name: string\n\ndef load<User>(value: User) -> User:\n    return value\n", "VEL4021", /shadows an existing type name/u],
    ["def outer<T>(value: T) -> T:\n    def inner(other: T) -> T:\n        return other\n    return value\n", "VEL4021", /belongs to the enclosing function; declare '<T>' on this def/u],
    ["def broken<>() -> null:\n    return null\n", "VEL2025", /requires at least one name/u],
    ["type Pair<T>:\n    left: number\n", "VEL2025", /only 'def' functions take '<T>'/u],
    ["class Holder<T>:\n    pass\n", "VEL2025", /only 'def' functions take '<T>'/u],
    ["class Panel:\n    get title<T>() -> string:\n        return \"top\"\n", "VEL2023", /cannot declare type parameters/u],
  ] as const) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === code && message.test(item.message)), JSON.stringify(result.diagnostics));
  }

  const unused = compile(`
def tagged<T, U>(value: T) -> T:
    return value

print(tagged("kept"))
`.trimStart());
  assert.deepEqual(unused.diagnostics, []);
});

test("type parameters are erased and fenced out of runtime checks before emission", () => {
  // Without the analyzer fence these programs would emit 'T.is(value)' and
  // crash at runtime; the fence must keep the emitter from ever seeing T.
  const isFence = compile("def check<T>(value: T) -> bool:\n    return value is T\n");
  assert.equal(isFence.code, null);
  assert.deepEqual(isFence.diagnostics.map((item) => item.code), ["VEL4022"]);
  assert.match(isFence.diagnostics[0]?.message ?? "", /Type parameter 'T' is erased at runtime and cannot be checked/u);

  const containedFence = compile("def check<T>(value: T) -> bool:\n    return value is List<T>\n");
  assert.equal(containedFence.code, null);
  assert.deepEqual(containedFence.diagnostics.map((item) => item.code), ["VEL4022"]);

  const caseFence = compile(`
def check<T>(value: T) -> bool:
    match value:
        case T:
            return true
        else:
            return false
`.trimStart());
  assert.equal(caseFence.code, null);
  assert.deepEqual(caseFence.diagnostics.map((item) => item.code), ["VEL4022"]);
});

test("generic declarations format idiomatically without touching comparisons", () => {
  const canonical = "def first<T>(items: List<T>) -> T?:\n    return items.get(0)\n";
  assert.equal(formatSource(canonical), canonical);
  assert.equal(formatSource("def first < T > (items: List<T>) -> T?:\n    return items.get(0)\n"), canonical);
  const multiple = "def swap<T, U>(a: T, b: U) -> null:\n    return null\n";
  assert.equal(formatSource(multiple), multiple);
  assert.equal(formatSource("const smaller = a < b\n"), "const smaller = a < b\n");
  assert.equal(formatSource("const chained = a < b > c\n"), "const chained = a < b > c\n");
});

test("contextual record returns preserve positional callable contracts", () => {
  const result = compile(`
type Composer:
    text: (string, string) -> string
    update: (string) -> null

def createComposer() -> Composer:
    return {
        text: (english, chinese) => english + chinese,
        update: value => print(value),
    }

const composer = createComposer()
print(composer.text("Velar", "Script"))
composer.update("ready")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "VelarScript\nready\n");
});

test("compound index assignment evaluates its receiver and key once", () => {
  const result = compile(`
let receiverCalls = 0
let keyCalls = 0
let values = [10]

def receiver() -> List<number>:
    receiverCalls += 1
    return values

def key() -> number:
    keyCalls += 1
    return 0

receiver()[key()] += 5
print(receiverCalls)
print(keyCalls)
print(values[0])
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\n1\n15\n");
});

test("numeric literals support familiar exponents and reject non-finite overflow", () => {
  const valid = compileCore(`
print(1e3)
print(2.5E-2)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1000\n0.025\n");
  assert.equal(formatSource("const value=1e3\n"), "const value = 1e3\n");

  const overflow = compileCore(`const value = ${"9".repeat(400)}\n`);
  assert.ok(overflow.diagnostics.some((item) => item.code === "VEL2017" && item.message === "Numeric literals must be finite"));
  assert.equal(overflow.code, null);
});

test("interpolated strings balance nested expressions and keep escapes in text", () => {
  const result = compile(`
const name = "Ada"
print(f"{({name: name}).name} {{ready}} {'}'}\\nnext")
print(f"same quote: {"ready"}")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada {ready} }\nnext\nsame quote: ready\n");

  const unmatched = compile("print(f\"value }\")\n");
  assert.ok(unmatched.diagnostics.some((item) => item.message === "Unmatched '}' in interpolated string"));

  const formattedSource = 'print(f"{"x"}tail")\n';
  assert.equal(formatSource(formattedSource), formattedSource);
  const formattedExecution = executeModule(compile(formatSource(formattedSource)).code ?? "");
  assert.equal(formattedExecution.status, 0, String(formattedExecution.stderr));
  assert.equal(formattedExecution.stdout, "xtail\n");

  const spacedSource = 'const left = "Velar"\nconst right = "Script"\nprint(f"{left+right}: {({name:right}).name} {{ready}}")\n';
  const spacedFormatted = formatSource(spacedSource);
  assert.equal(spacedFormatted, 'const left = "Velar"\nconst right = "Script"\nprint(f"{left + right}: {({name: right}).name} {{ready}}")\n');
  assert.equal(formatSource(spacedFormatted), spacedFormatted);
  const spacedExecution = executeModule(compile(spacedFormatted).code ?? "");
  assert.equal(spacedExecution.status, 0, String(spacedExecution.stderr));
  assert.equal(spacedExecution.stdout, "VelarScript: Script {ready}\n");
});

test("inline strings recover at newlines while layout strings recover at dedent", () => {
  for (const literal of ['"unfinished', 'f"unfinished', 'r"unfinished', 'rf"unfinished']) {
    const result = compile(`const broken = ${literal}\r\nconst recovered = 7\r\n`);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL1003"));
    assert.ok(result.semanticIndex.symbols.some((item) => item.name === "recovered"));
  }

  const brokenLayout = compile('const broken = "\n    unfinished\nconst recovered = 7\n');
  assert.ok(brokenLayout.diagnostics.some((item) => item.code === "VEL1003" && /layout string/u.test(item.message)));
  assert.ok(brokenLayout.semanticIndex.symbols.some((item) => item.name === "recovered"));
});

test("omitted results mean null and end naturally while value functions stay explicit", () => {
  const result = compile(`
export def record(value: string):
    print(value)

component SaveButton:
    state saved = false

    action save():
        saved = true

    return <button type="button" on:click={save}>{saved ? "Saved" : "Save"}</button>

print(record("saved") == null)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(describeType(result.moduleInterface.exports.get("record")!), "(value: string) -> null");
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "record")?.type, "(value: string) -> null");
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
  assert.ok(implicitValue.diagnostics.some((item) => item.message === "This function has no result annotation, so it returns null; declare '-> number' to return a value"));

  const asynchronous = compile(`
async def save():
    print("saved")
`.trimStart());
  assert.deepEqual(asynchronous.diagnostics, []);
  assert.equal(asynchronous.semanticIndex.symbols.find((item) => item.name === "save")?.type, "() -> Promise<null>");
});

test("statically null calls and awaits normalize JavaScript undefined at the boundary", () => {
  const result = compileCore(`
import js {external, externalAsync, externalOptional, externalOptionalAsync, externalUnknown, maybeValue} from "fixture"

const direct = external()
const asynchronous = await externalAsync()
const optional = externalOptional()
const optionalAsync = await externalOptionalAsync()
const opaque = externalUnknown()
print(direct == null)
print(asynchronous == null)
print(optional == null)
print(optionalAsync == null)
print(opaque == null)
print(maybeValue == null)
`.trimStart(), { analysis: { imports: new Map<string, ValueType>([
    ["external", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "null" } }],
    ["externalAsync", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: { kind: "null" } } }],
    ["externalOptional", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "optional", inner: { kind: "string" } } }],
    ["externalOptionalAsync", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: { kind: "optional", inner: { kind: "string" } } } }],
    ["externalUnknown", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "unknown" } }],
    ["maybeValue", { kind: "optional", inner: { kind: "string" } }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\(external\(\), null\)/u);
  assert.match(result.code ?? "", /await __velarNormalizePromiseValue\(externalAsync\(\)\)/u);
  assert.match(result.code ?? "", /externalOptional\(\) \?\? null/u);
  assert.match(result.code ?? "", /await __velarNormalizePromiseValue\(externalOptionalAsync\(\)\)/u);
  assert.match(result.code ?? "", /externalUnknown\(\) \?\? null/u);
  assert.match(result.code ?? "", /maybeValue \?\? null/u);
  const executable = (result.code ?? "").replace(/import .*?;\n+/u, `function external() {}
async function externalAsync() {}
function externalOptional() {}
async function externalOptionalAsync() {}
function externalUnknown() {}
const maybeValue = undefined;
`);
  const execution = executeModule(executable);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\ntrue\ntrue\n");
});

test("host Promises normalize undefined before composition without losing identity or rejection", () => {
  const promiseNull = { kind: "promise", value: { kind: "null" } } as const;
  const promiseNumber = { kind: "promise", value: { kind: "number" } } as const;
  const promiseOptional = { kind: "promise", value: { kind: "optional", inner: { kind: "string" } } } as const;
  const result = compileCore(`
import js {client, collect, collectMaybe, externalAsync, maybeAsync, ready, rejected} from "fixture"

const first = externalAsync()
const values = await collect([first, ready])
const maybeValues = await collectMaybe([maybeAsync()])
const service = client
const {flush} = client
const memberValues = await collect([service.flush(), flush()])
print(first == first)
print(ready == ready)
print(values[0] == null)
print(values[1] == null)
print(maybeValues[0] == null)
print(memberValues[0] == null)
print(memberValues[1] == null)

try:
    await rejected
catch error:
    print(error.message)
`.trimStart(), { analysis: { imports: new Map<string, ValueType>([
    ["client", { kind: "object", fields: new Map([["flush", { kind: "function", parameters: [], requiredParameters: 0, result: promiseNull }]]) }],
    ["collect", { kind: "function", parameters: [{ kind: "list", element: promiseNull }], requiredParameters: 1, result: { kind: "promise", value: { kind: "list", element: { kind: "null" } } } }],
    ["collectMaybe", { kind: "function", parameters: [{ kind: "list", element: promiseOptional }], requiredParameters: 1, result: { kind: "promise", value: { kind: "list", element: { kind: "optional", inner: { kind: "string" } } } } }],
    ["externalAsync", { kind: "function", parameters: [], requiredParameters: 0, result: promiseNull }],
    ["maybeAsync", { kind: "function", parameters: [], requiredParameters: 0, result: promiseOptional }],
    ["ready", promiseNull],
    ["rejected", promiseNull],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarNormalizePromiseValue/u);
  const executable = (result.code ?? "").replace(/import .*?;\n+/u, `
const collect = values => Promise.all(values);
const collectMaybe = values => Promise.all(values);
const client = { flush: async () => undefined };
const externalAsync = async () => undefined;
const maybeAsync = async () => undefined;
const ready = Promise.resolve(undefined);
const rejected = Promise.reject(new Error("failed"));
`);
  const execution = executeModule(executable);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\nfailed\n");

  const forged = compileCore(`
import js {hostile, reads} from "fixture"

try:
    await hostile
    print("accepted")
catch error:
    print(error.name)
print(reads())
`.trimStart(), { analysis: { imports: new Map<string, ValueType>([
    ["hostile", promiseNumber],
    ["reads", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "number" } }],
  ]) } });
  assert.deepEqual(forged.diagnostics, []);
  const forgedExecutable = (forged.code ?? "").replace(/import .*?;\n+/u, `
let thenReads = 0;
const hostile = Object.defineProperty({}, "then", { get() { thenReads += 1; return resolve => resolve(undefined); } });
const reads = () => thenReads;
`);
  const forgedExecution = executeModule(forgedExecutable);
  assert.equal(forgedExecution.status, 0, String(forgedExecution.stderr));
  assert.equal(forgedExecution.stdout, "TypeError\n0\n");

  const poisonedRegistry = executeModule(`
Object.defineProperty(globalThis, Symbol.for("velar.promise.normalization.v1"), {
  value: new WeakMap(),
  enumerable: true,
  configurable: false,
  writable: false,
});
${forgedExecutable}
`);
  assert.notEqual(poisonedRegistry.status, 0);
  assert.match(String(poisonedRegistry.stderr), /Promise normalization registry ownership is invalid/u);
});

test("collection callbacks cannot return JavaScript undefined into VelarScript values", () => {
  const result = compileCore(`
import js {combine, initial, transform} from "fixture"

const mapped = [1].map(transform)
const reduced = [1].reduce(combine, initial)
print(mapped[0] == null)
print(reduced == null)
`.trimStart(), { analysis: { imports: new Map<string, ValueType>([
    ["transform", { kind: "function", parameters: [{ kind: "number" }], requiredParameters: 1, result: { kind: "optional", inner: { kind: "string" } } }],
    ["combine", { kind: "function", parameters: [{ kind: "unknown" }, { kind: "number" }], requiredParameters: 2, result: { kind: "unknown" } }],
    ["initial", { kind: "unknown" }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  const executable = (result.code ?? "").replace(/import .*?;\n+/u, `
const transform = () => undefined;
const combine = () => undefined;
const initial = null;
`);
  const execution = executeModule(executable);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n");
});

test("List.reduce arguments preserve narrowing facts", () => {
  // Reading the getter that supplies the callback does not drop the fact the
  // initial-value argument relies on: getter reads are ordinary reads.
  const result = compileCore(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

class Callbacks:
    const box: Box

    constructor(box: Box):
        self.box = box

    get combine() -> (string, string) -> string:
        self.box.user = null
        return (left, value) => left

def label(box: Box) -> string:
    assert box.user
    const callbacks = Callbacks(box)
    return ["value"].reduce(callbacks.combine, box.user.name)
`.trimStart());

  assert.equal(result.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const contextualArrow = compileCore(`
const total = [1, 2, 3].reduce((sum, value) => sum + value, 0)
print(total)
`.trimStart());
  assert.deepEqual(contextualArrow.diagnostics, []);
  const execution = executeModule(contextualArrow.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "6\n");
});

test("break and continue guards narrow the loop fall-through path like return", () => {
  const pullLoop = compileCore(`
def drain(chunks: List<string>) -> string:
    let assembled = ""
    while true:
        const chunk = chunks.pop(0)
        if chunk == null:
            break
        assembled += chunk
    return assembled

print(drain(["stream", "ing", " works"]))
`.trimStart());
  assert.deepEqual(pullLoop.diagnostics, []);
  const pullExecution = executeModule(pullLoop.code ?? "");
  assert.equal(pullExecution.status, 0, String(pullExecution.stderr));
  assert.equal(pullExecution.stdout, "streaming works\n");

  const continueGuard = compileCore(`
def total(values: List<number?>) -> number:
    let sum = 0
    for value in values:
        if value == null:
            continue
        sum += value
    return sum

print(total([1, null, 2, null, 3]))
`.trimStart());
  assert.deepEqual(continueGuard.diagnostics, []);
  const continueExecution = executeModule(continueGuard.code ?? "");
  assert.equal(continueExecution.status, 0, String(continueExecution.stderr));
  assert.equal(continueExecution.stdout, "6\n");

  // A break in the inner loop narrows only the inner fall-through and leaves
  // the outer loop's established facts alone.
  const nestedLoops = compileCore(`
def flatten(rows: List<List<string?>>, separator: string?) -> string:
    let out = ""
    if separator == null:
        return out
    for row in rows:
        for cell in row:
            if cell == null:
                break
            out += cell
        out += separator
    return out

print(flatten([["a", "b", null, "c"], ["d"]], "|"))
`.trimStart());
  assert.deepEqual(nestedLoops.diagnostics, []);
  const nestedExecution = executeModule(nestedLoops.code ?? "");
  assert.equal(nestedExecution.status, 0, String(nestedExecution.stderr));
  assert.equal(nestedExecution.stdout, "ab|d|\n");

  const matchArm = compileCore(`
def compact(values: List<string?>) -> string:
    let out = ""
    for value in values:
        match value:
            case null:
                continue
        out += value
    return out

print(compact(["a", null, "b"]))
`.trimStart());
  assert.deepEqual(matchArm.diagnostics, []);
  const matchExecution = executeModule(matchArm.code ?? "");
  assert.equal(matchExecution.status, 0, String(matchExecution.stderr));
  assert.equal(matchExecution.stdout, "ab\n");
});

test("break and continue still carry loop-body writes to the after-loop merge", () => {
  // A write in a break arm escapes the loop, so the outer fact cannot survive.
  const breakCarriesWrite = compileCore(`
def leak(flag: bool) -> string:
    let value: string? = "seed"
    if value != null:
        while flag:
            if flag:
                value = null
                break
        return value
    return ""
`.trimStart());
  assert.ok(
    breakCarriesWrite.diagnostics.some((item) => /Cannot assign string\? to string/u.test(item.message)),
    breakCarriesWrite.diagnostics.map((item) => item.message).join("\n"),
  );

  // A write in a continue arm reaches the next iteration and the loop exit.
  const continueCarriesWrite = compileCore(`
def carry(flag: bool) -> string:
    let value: string? = "seed"
    if value != null:
        while flag:
            if flag:
                value = null
                continue
            return ""
        return value
    return ""
`.trimStart());
  assert.ok(
    continueCarriesWrite.diagnostics.some((item) => /Cannot assign string\? to string/u.test(item.message)),
    continueCarriesWrite.diagnostics.map((item) => item.message).join("\n"),
  );

  // A reachable break can leave the loop while the condition still holds, so
  // the condition's negated facts must not persist past the loop.
  const breakSkipsConditionFacts = compileCore(`
def guard(value: string?) -> string:
    while value == null:
        if true:
            break
        return ""
    return value
`.trimStart());
  assert.ok(
    breakSkipsConditionFacts.diagnostics.some((item) => /Cannot assign string\? to string/u.test(item.message)),
    breakSkipsConditionFacts.diagnostics.map((item) => item.message).join("\n"),
  );

  // A break without writes leaves the outer fact intact after the loop.
  const cleanBreak = compileCore(`
def keep(flag: bool) -> string:
    let value: string? = "seed"
    if value != null:
        while flag:
            if flag:
                break
            return ""
        return value
    return ""
`.trimStart());
  assert.deepEqual(cleanBreak.diagnostics, []);

  // Writes and breaks behind an unconditional return stay off reachable flow.
  const deadTail = compileCore(`
def dead(flag: bool) -> string:
    let value: string? = "seed"
    if value != null:
        while flag:
            return ""
            value = null
            break
        return value
    return ""
`.trimStart());
  assert.deepEqual(deadTail.diagnostics, []);
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
    assert draft.estimate else "Estimate is required"
    assert draft.label
    assert draft.enabled
    const estimate = draft.estimate
    const label: string = draft.label
    const enabled: bool = draft.enabled
    print(f"{estimate}:{label}:{enabled}")

submit({estimate: 0, label: "", enabled: false})
assert true else message()

try:
    assert false else "Broken invariant"
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
  assert.equal(execution.stdout, "0::false\nAssertionError:Broken invariant\n");

  const invalid = compile(`
assert 1
assert true else 42
`);
  assert.ok(invalid.diagnostics.some((item) => /Condition must be bool or optional/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));

  const messageFlow = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "failed"

def keep(box: Box) -> string:
    assert box.user
    assert true else clear(box)
    return box.user.name

def failureMessage(user: User?) -> string:
    assert user == null else user.name
    return "empty"

print(keep({user: {name: "Ada"}}))
print(failureMessage(null))
`.trimStart());
  assert.deepEqual(messageFlow.diagnostics, []);
  const messageExecution = executeModule(messageFlow.code ?? "");
  assert.equal(messageExecution.status, 0, String(messageExecution.stderr));
  assert.equal(messageExecution.stdout, "Ada\nempty\n");

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

  const malformed = compile("assert\nassert true else\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2017" && /requires a condition/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2017" && /requires a message/u.test(item.message)));

  const legacySeparator = compile('assert true, "legacy"\n');
  assert.ok(legacySeparator.diagnostics.some((item) => item.code === "VEL2017" && /assert condition else message/u.test(item.message)));
  assert.equal(legacySeparator.code, null);
});

test("transparent type aliases improve names without changing assignability", () => {
  const result = compile(`
type Identifier = string
type Handler = (Identifier) -> null

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

  const unknown = compile("type MissingValue = Missing\nconst value: MissingValue = null\n");
  assert.ok(unknown.diagnostics.some((item) => /Unknown type 'Missing'/u.test(item.message)));
});

test("type annotations guide familiar JavaScript and Python spellings without parser cascades", () => {
  const spellings = [
    ["const values: Array<number> = []\n", /Use 'List<T>'/u],
    ["const value: str = \"text\"\n", /Use 'string'/u],
    ["const value: String = \"text\"\n", /wrapper-object types are not exposed/u],
    ["const value: boolean = true\n", /Use 'bool'/u],
    ["const value: void = null\n", /Use 'null'/u],
    ["const value: object = {}\n", /Declare a named 'type'/u],
    ["const callback: Function = value => value\n", /explicit function type/u],
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
    return <p key={broken()}>{broken()}</p>
`.trimStart());
  assert.equal(webPropagation.diagnostics.length, 1);
  assert.equal(webPropagation.diagnostics[0]?.message, "Unknown type 'Missing'");
});

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
const scores = Map()
scores.set("Ada", 9)
print("Ada" in names)
print("web" in tags)
print("Ada" in scores)
print("Script" in "VelarScript")
print(not ("missing" in names))

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
  assert.match(result.code ?? "", /__velarContains\("Ada", names\)/u);
  assert.match(result.code ?? "", /__velarContains\("Ada", scores\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\ntrue\ntrue\ntrue\nneedle,haystack\ntrue\nasync needle,async haystack\n");

  const invalid = compile("print(1 in \"123\")\nprint(\"x\" in {x: 1})\n");
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Membership requires a List, Set, Map, or string/u.test(item.message)));

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

  // A call as the left operand of 'in' does not drop the fact the list
  // literal on the right relies on: calls are not invalidation points.
  const effects = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "Ada"

def contains(box: Box) -> bool:
    assert box.user
    return clear(box) in [box.user.name]
`.trimStart());
  assert.equal(effects.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
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
const equality = value("g", 4) == value("h", 4) != value("i", 5)
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

test("comparison chains carry successful-link facts into later operands and bodies", () => {
  const result = compileCore(`
type User:
    name: string

def hasName(user: User?) -> bool:
    return user != null != user.name

def label(user: User?) -> string:
    if user != null != user.name:
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
        case null:
            return "missing"
        else:
            return "number"

print(describe("ready"))
print(describe("failed"))
print(describe("other"))
print(numeric(-1))
print(numeric(null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarMatchValue\d+ = value;/u);
  assert.match(result.code ?? "", /__velarMatchValue\d+ === "ready" \|\| __velarMatchValue\d+ === "done"/u);
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
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2001" || item.code === "VEL2015" || item.code === "VEL4001"), source);
  }
});

test("match supports type patterns, bindings, guards, and single evaluation", () => {
  const result = compile(`
type User:
    name: string

class Animal:
    pass

class Dog extends Animal:
    pass

let evaluations = 0

def source() -> string | number | User | null:
    evaluations += 1
    return "ready"

def describe(value: string | number | User | null) -> string:
    match value:
        case string as text if text == "ready":
            return "ready text"
        case string as text:
            return text
        case number as amount if amount > 10:
            return "large"
        case number as amount:
            return str(amount)
        case User as user:
            return user.name
        case null:
            return "missing"

def animalKind(value: Animal) -> string:
    match value:
        case Dog as dog:
            return "dog"
        case Animal:
            return "animal"

const user: User = {name: "Ada"}
print(describe(source()))
print(evaluations)
print(describe(user))
print(animalKind(Dog()))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const text = __velarMatchCase\d+\[0\];/u);
  assert.match(result.code ?? "", /typeof __velarMatchValue\d+ === "string"/u);
  assert.match(result.code ?? "", /__velarMatchValue\d+ instanceof Dog/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready text\n1\nAda\ndog\n");

  const impossible = compile(`
def inspect(value: number) -> null:
    match value:
        case string as text:
            print(text)
    return null
`.trimStart());
  assert.ok(impossible.diagnostics.some((item) => /can never match number/u.test(item.message)));
});

test("match patterns narrow stable locations on success and fallthrough", () => {
  const result = compileCore(`
type User:
    name: string

class Animal:
    pass

class Dog extends Animal:
    def sound() -> string:
        return "woof"

def label(user: User?) -> string:
    match user:
        case User if user.name != "":
            return user.name
        case User:
            return "empty"
        case null:
            return "missing"

def fallback(user: User?) -> string:
    match user:
        case null:
            return "missing"
        else:
            return user.name

def afterMatch(user: User?) -> string:
    match user:
        case null:
            return "missing"
    return user.name

def increment(value: string | number) -> number:
    match value:
        case string:
            return 0
        else:
            return value + 1

def first(values: List<string>?) -> string:
    match values:
        case [item, ...rest]:
            return values[0]
        case []:
            return "empty"
        case null:
            return "missing"

def sound(animal: Animal) -> string:
    match animal:
        case Dog:
            return animal.sound()
        case Animal:
            return "unknown"

print(label({name: "Ada"}))
print(label(null))
print(fallback({name: "Lin"}))
print(afterMatch({name: "Mira"}))
print(increment(4))
print(first(["Velar"]))
print(first([]))
print(sound(Dog()))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nmissing\nLin\nMira\n5\nVelar\nempty\nwoof\n");

  // A guard call keeps the pattern-established fact: calls are not
  // invalidation points, so the case body and the else fallthrough may both
  // rely on the pattern's narrowing.
  const guardCallKeepsFacts = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> bool:
    box.user = null
    return true

def clearAndReject(box: Box) -> bool:
    box.user = null
    return false

def guarded(box: Box) -> string:
    match box.user:
        case User if clear(box):
            return box.user.name
        else:
            return "missing"

def guardedElse(box: Box) -> string:
    match box.user:
        case null:
            return "missing"
        case User if clearAndReject(box):
            return "unreachable"
        else:
            return box.user.name
`.trimStart());
  assert.equal(guardCallKeepsFacts.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // Matching against an extern class may run a hasInstance hook, but the
  // check is an ordinary read: the matched member fact survives it.
  const externTypeCheckKeepsFacts = compileCore(`
extern module "sdk":
    export class Remote:
        const name: string
        constructor()

import js {Remote} from "sdk"

type Holder:
    value: Remote?

def label(holder: Holder) -> string:
    match holder.value:
        case Remote:
            return holder.value.name
        case null:
            return "missing"
`.trimStart());
  assert.equal(externTypeCheckKeepsFacts.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("match guards narrow the successful branch", () => {
  const result = compile(`
type User:
    name: string
    manager: User?

def managerName(value: User?) -> string:
    match value:
        case User as user if user.manager:
            return user.manager.name
        else:
            return "missing"

const managed: User = {
    name: "Ada",
    manager: {name: "Lin", manager: null},
}
print(managerName(managed))
print(managerName(null))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Lin\nmissing\n");
});

test("match guards preserve negative facts only when their pattern always matches", () => {
  const result = compile(`
type User:
    name: string
    manager: User?

def absent(value: null) -> string:
    return "none"

def managerName(value: User) -> string:
    match value:
        case User if value.manager:
            return value.manager.name
        else:
            return absent(value.manager)

const unmanaged: User = {name: "Ada", manager: null}
print(managerName(unmanaged))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "none\n");

  const partialPattern = compile(`
type User:
    manager: User?

def invalid(value: User?) -> string:
    match value:
        case User if value.manager:
            return value.manager.manager?.manager == null ? "managed" : "deep"
        else:
            return value.manager == null ? "missing" : "unexpected"
`.trimStart());
  assert.ok(partialPattern.diagnostics.some((item) => /optional access/u.test(item.message)));
});

test("match cases isolate and merge outer narrowing facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box, kind: string) -> string:
    assert box.user
    match kind:
        case "drop":
            box.user = null
        case "keep":
            return box.user.name
        else:
            return "other"
    return "dropped"

print(label({user: {name: "Ada"}}, "keep"))
print(label({user: {name: "Ada"}}, "drop"))
print(label({user: {name: "Ada"}}, "other"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\ndropped\nother\n");

  const merged = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box, kind: string):
    assert box.user
    match kind:
        case "drop":
            box.user = null
        else:
            pass
    const stale: User = box.user
`.trimStart());
  assert.equal(merged.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("match fallthrough preserves narrowing facts across guards and pattern keys", () => {
  const common = compile(`
type User:
    name: string

def label(user: User?, kind: string) -> string:
    match kind:
        case "first":
            assert user
        else:
            assert user
    return user.name

print(label({name: "Ada"}, "first"))
print(label({name: "Lin"}, "other"))
`.trimStart());
  assert.deepEqual(common.diagnostics, []);
  const execution = executeModule(common.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nLin\n");

  // A guard call in an earlier case does not drop the outer fact for later
  // cases: calls are not invalidation points.
  const guarded = compile(`
type User:
    name: string

type Box:
    user: User?

def clearAndReject(box: Box) -> bool:
    box.user = null
    return false

def label(box: Box, kind: string) -> string:
    assert box.user
    match kind:
        case "first" if clearAndReject(box):
            return "matched"
        case _:
            return box.user.name
`.trimStart());
  assert.equal(guarded.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // Reading a static getter as a match-pattern key is an ordinary read; the
  // outer fact survives into later cases.
  const patternEffect = compile(`
type User:
    name: string

type Box:
    user: User?

const shared: Box = {user: {name: "Ada"}}

class Keys:
    static get first() -> string:
        shared.user = null
        return "first"

def label(kind: string) -> string:
    assert shared.user
    match kind:
        case Keys.first:
            return "matched"
        else:
            return shared.user.name
`.trimStart());
  assert.equal(patternEffect.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const unreachable = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box, kind: string) -> string:
    assert box.user
    match kind:
        case _:
            pass
        case "never":
            box.user = null
    return box.user.name
`.trimStart());
  assert.equal(unreachable.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok(unreachable.diagnostics.some((item) => /already covered/u.test(item.message)));
});

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
  assert.match(result.code ?? "", /Object\.getOwnPropertyDescriptor\(__velarMatchValue\d+, "kind"\)/u);
  assert.match(result.code ?? "", /Object\.getOwnPropertyNames/u);
  assert.match(result.code ?? "", /Array\.isArray/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "user:Ada:7:2\nempty\none:4\npair:9:2\nmany:4:2\n");
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

  const unreachableElse = compile(`
match true:
    case _:
        pass
    else:
        pass
`.trimStart());
  assert.ok(unreachableElse.diagnostics.some((item) => item.code === "VEL4014" && /else branch is already covered/u.test(item.message)));
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
            else:
                return "Unknown"

    return <p>{label()}</p>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarMatchValue\d+ = status\.get\(\);/u);
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

def persist(value: string) -> null:
    print(value)
    return null

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
  assert.match(result.code ?? "", /__velarMatchValue\d+ === TaskStatus\.doing/u);
  assert.match(result.code ?? "", /TaskStatus\.is\(__velarField\d+\.value\)/u);
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
    prototype
    __proto__
`.trimStart());
  assert.ok(malformed.diagnostics.some((item) => /declared more than once/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => /reserved for runtime validation/u.test(item.message)));
  assert.equal(malformed.diagnostics.filter((item) => /does not expose prototype manipulation/u.test(item.message)).length, 2);

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

class ValidationError extends Error:
    const code: string

    constructor(code: string, message: string):
        super(message)
        self.code = code

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
  assert.match(result.code ?? "", /error = __velarNormalizeError\(error\)/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\ntrue\nValue must be positive\nfinalized\nAsync failure\nError\nraw failure\n");
});

test("catch normalization cannot execute a hostile thrown object's conversion hooks", () => {
  const source = Buffer.from([
    "export function explode(){throw {marker:'original',toString(){console.log('conversion hook ran');throw new Error('conversion failure')}}}",
    "export function explodeProxy(){throw new Proxy({marker:'proxy'},{getPrototypeOf(){console.log('prototype trap ran');throw new Error('prototype failure')}})}",
  ].join(";"), "utf8").toString("base64");
  const result = compile(`
import js unsafe {explode, explodeProxy} from "data:text/javascript;base64,${source}"

try:
    explode()
catch error:
    print(error.name)
    print(error.message)

try:
    explodeProxy()
catch error:
    print(error.name)
    print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /Error\.isError\(value\)/u);
  assert.match(result.code ?? "", /new Error\(message, \{ cause: value \}\)/u);
  assert.doesNotMatch(result.code ?? "", /String\(error\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Error\nA non-Error value was thrown by JavaScript\nError\nA non-Error value was thrown by JavaScript\n");
});

test("host tooling reports foreign failures without invoking object hooks", () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    get() { traps += 1; throw new Error("get trap ran"); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error("descriptor trap ran"); },
    getPrototypeOf() { traps += 1; throw new Error("prototype trap ran"); },
    has() { traps += 1; throw new Error("has trap ran"); },
  });
  assert.equal(hostErrorMessage(hostile), "A non-Error value was thrown by JavaScript");
  assert.equal(hostErrorStack(hostile), "A non-Error value was thrown by JavaScript");
  assert.equal(hostErrorCode(hostile), null);
  const wrapped = asHostError(hostile);
  assert.equal(wrapped.message, "A non-Error value was thrown by JavaScript");
  assert.equal(wrapped.cause, hostile);
  assert.equal(traps, 0);

  let getterReads = 0;
  const poisoned = new Error("original");
  Object.defineProperty(poisoned, "message", { configurable: true, get() { getterReads += 1; throw new Error("message getter ran"); } });
  assert.equal(hostErrorMessage(poisoned), "An Error was thrown without a message");
  assert.equal(getterReads, 0);

  const foreign = runInNewContext('Object.assign(new Error("foreign failure"), {code: "ENOENT"})') as unknown;
  assert.equal(hostErrorMessage(foreign), "foreign failure");
  assert.equal(hostErrorCode(foreign), "ENOENT");
  assert.equal(asHostError(foreign), foreign);

  const bounded = hostErrorMessage("x".repeat(70_000));
  assert.equal(bounded.length, 65_537);
  assert.ok(bounded.endsWith("…"));
});

test("finally cannot silently override return or leave an outer loop", () => {
  const invalid = compile(`
def replacedReturn() -> number:
    try:
        return 1
    finally:
        return 2

for value in [1]:
    try:
        pass
    finally:
        break

for value in [1]:
    try:
        pass
    finally:
        continue
`.trimStart());
  assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL3015").length, 3);
  assert.ok(invalid.diagnostics.some((item) => /'return' cannot leave a finally block/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /'break' cannot leave a finally block/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /'continue' cannot leave a finally block/u.test(item.message)));

  const valid = compile(`
def cleaned() -> number:
    let result = 0
    try:
        result = 2
    finally:
        for value in [1]:
            if value == 1:
                break
        def localResult() -> number:
            return result
        print(localResult())
    return result

print(cleaned())
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n2\n");
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
print(number("") == null)
print(number("0x10") == null)
print(number("12px") == null)
print(number("Infinity") == null)
print(number("1e999") == null)
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

test("compiler host capabilities stay protected while extension conveniences follow lexical scope", () => {
  const hostBindings = [
    "Array", "Boolean", "Error", "JSON", "Map", "Math", "Number", "Object", "Promise", "RangeError", "Reflect", "Set", "String",
    "Symbol", "TypeError", "WeakMap", "WeakSet", "console", "document", "globalThis", "queueMicrotask",
  ];
  for (const name of hostBindings) {
    const result = compileCore(`const ${name} = 1\n`);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && item.message === `'${name}' is a reserved Core binding`), name);
  }

  const extension = compile("const mount = 1\n");
  assert.ok(extension.diagnostics.some((item) => item.code === "VEL3007" && /reserved extension binding/u.test(item.message)));
  assert.deepEqual(compileCore("const mount = 1\n").diagnostics, []);
  assert.deepEqual(compile("const color = \"brand\"\ntype Node:\n    id: string\n").diagnostics, []);

  for (const source of ["const __velarIndex = 1\n", "def run(__velarScope: number):\n    pass\n", "type __VelarRecord:\n    id: string\n"]) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && /reserved compiler prefix '__velar'/u.test(item.message)));
  }

  const hygienicIndex = compileCore("class IndexError:\n    constructor():\n        pass\n\nconst values = [1]\nprint(values[0])\n");
  assert.deepEqual(hygienicIndex.diagnostics, []);
  assert.match(hygienicIndex.code ?? "", /class __VelarIndexError extends RangeError/u);
  assert.match(hygienicIndex.code ?? "", /class IndexError \{/u);
});

test("JavaScript reserved words stay data names but cannot become emitted bindings", () => {
  const reserved = [
    "debugger", "default", "delete", "do", "function", "implements", "instanceof", "interface", "package", "protected", "public", "typeof", "void", "yield",
  ];
  for (const name of reserved) {
    const result = compileCore(`const ${name} = 1\n`);
    assert.equal(result.code, null);
    assert.ok(
      result.diagnostics.some((item) => item.code === "VEL3007" && item.message === `'${name}' is reserved by JavaScript and cannot be used as a VelarScript binding`),
      `${name}: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  for (const source of [
    `def run(yield: number) -> number:\n    return yield\n`,
    `const {default} = {default: 1}\n`,
    `for public in [1]:\n    print(public)\n`,
  ]) {
    const result = compileCore(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3007" && /reserved by JavaScript/u.test(item.message)), JSON.stringify(result.diagnostics));
  }

  const dataNames = compileCore(`
class Operations:
    def delete() -> string:
        return "member"

const value = {default: "record"}
print(value.default)
print(Operations().delete())
`.trimStart());
  assert.deepEqual(dataNames.diagnostics, []);
  const execution = executeModule(dataNames.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "record\nmember\n");
});

test("rejects legacy and discarded design surface with intentional diagnostics", () => {
  const cases = new Map([
    ["var value = 1\n", /let.*const.*var/],
    ["const value = undefined\n", /null.*undefined/],
    ["const value = this\n", /self.*this/],
    ["const value = new Player()\n", /directly.*new/],
    ["eval(\"1\")\n", /does not expose 'eval'/],
    ["with value\n", /record spread.*\{\.\.\.value, field: next\}.*does not expose 'with'/],
    ["const value = arguments\n", /named parameters.*arguments/],
    ["const value = Player.prototype\n", /prototype manipulation/],
    ["const value = item.__proto__\n", /prototype manipulation/],
    ["const value = 1 === 1\n", /equality is already strict/],
    ["const value = 1 !== 2\n", /inequality is already strict/],
    ["const value = True\n", /Use 'true'.*lowercase/],
    ["const value = False\n", /Use 'false'.*lowercase/],
    ["const value: int = 1\n", /Use 'number'.*numeric type/],
    ["if true:\n    pass\nelif false:\n    pass\n", /Use 'else if'/],
    ["const value = true && false\n", /Use 'and'.*readable logical/],
    ["const value = true || false\n", /Use 'or'.*readable logical/],
    ["const value = !false\n", /Use 'not'.*readable logical/],
    ["schema User:\n    name: string\n", /Use 'type'.*no separate schema/],
    ["effect count:\n    print(count)\n", /internal to @velarscript\/web.*watch.*mounted.*cleanup/],
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

test("guides mistyped declaration keywords to the current spelling", () => {
  const cases = new Map([
    ["fn addTask(tasks: List<number>, title: string) -> List<number>:\n    return tasks\n", /Use 'def'.*'def name\(\.\.\.\)'/u],
    ["func helper():\n    pass\n", /Use 'def'/u],
    ["function addTask(value: number) -> number:\n    return value\n", /Use 'def'/u],
    ["record Task(id: string, title: string, done: bool)\n", /Use 'type'.*'type Name:'/u],
    ["record Task:\n    id: string\n    title: string\n", /Use 'type'/u],
    ["struct Point:\n    x: number\n", /Use 'type'/u],
    ["interface Task:\n    id: string\n", /Use 'type'/u],
    ["class Player:\n    fn jump():\n        pass\n", /Use 'def'/u],
  ]);

  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.deepEqual(
      result.diagnostics.map((item) => item.code),
      ["VEL2026"],
      `${source}: ${JSON.stringify(result.diagnostics)}`,
    );
    assert.match(result.diagnostics[0]?.message ?? "", message, source);
  }
});

test("reports one unknown-declaration-keyword diagnostic instead of expression cascades", () => {
  const cases = new Map([
    ["defn helper(x: number) -> number:\n    return x\n", "defn"],
    ["myvar x: number = 5\n", "myvar"],
  ]);

  for (const [source, keyword] of cases) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2026"], source);
    assert.match(result.diagnostics[0]?.message ?? "", new RegExp(`Unknown declaration keyword '${keyword}'.*'def', 'type', 'enum', 'class', 'const', or 'let'`, "u"), source);
  }

  const legal = compile("def run(value: number) -> number:\n    return value\n\nconst result = run(2)\nprint(result)\n");
  assert.deepEqual(legal.diagnostics, []);
});

test("mistyped declaration keywords replace named-argument and reserved-binding cascades", () => {
  const result = compile(`
record Task(id: string, title: string, done: bool)

function addTask(tasks: List<number>, title: string) -> List<number>:
    return tasks
`.trimStart());

  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2026", "VEL2026"]);
  assert.match(result.diagnostics[0]?.message ?? "", /Use 'type'/u);
  assert.match(result.diagnostics[1]?.message ?? "", /Use 'def'/u);
  assert.ok(!result.diagnostics.some((item) => item.code === "VEL2024" || item.code === "VEL3007"));

  const consecutive = compile(`
function first(value: number) -> number:
    return value

function second(value: number) -> number:
    return value
`.trimStart());
  assert.deepEqual(consecutive.diagnostics.map((item) => item.code), ["VEL2026", "VEL2026"]);
});

test("guidance-token recovery co-reports lexer, parser, and analyzer guidance in one compile", () => {
  const result = compile("var values: Array<number> = []\nvalues.push(1)\n");
  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL1005", "VEL2012", "VEL4001"]);
  assert.match(result.diagnostics[0]?.message ?? "", /Use 'let' or 'const'/u);
  assert.match(result.diagnostics[1]?.message ?? "", /Use 'List<T>'/u);
  assert.match(result.diagnostics[2]?.message ?? "", /Use 'append\(value\)'/u);
});

test("recovered guidance programs still fail compilation and never emit", () => {
  const sources = [
    "const flag = True\n",
    "var count = 0\n",
    "const value = 1 if true else 2\n",
    "const accent = #f0f0f0\n",
    "const values: number[] = []\n",
    "fn helper():\n    pass\n",
    "record Task:\n    id: string\n",
  ];
  for (const source of sources) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.equal(result.sourceMap, null, source);
    assert.equal(result.css, null, source);
    assert.ok(result.diagnostics.length > 0, source);
    assert.ok(result.diagnostics.every((item) => item.recovered), source);
  }
});

test("mistyped declaration recovery surfaces body-level and semantic guidance together", () => {
  const fn = compile("fn addTask(tasks: List<number>) -> List<number>:\n    tasks.push(1)\n    return tasks\n");
  assert.equal(fn.code, null);
  assert.deepEqual(fn.diagnostics.map((item) => item.code), ["VEL2026", "VEL4001"]);
  assert.match(fn.diagnostics[0]?.message ?? "", /Use 'def'/u);
  assert.match(fn.diagnostics[1]?.message ?? "", /Use 'append\(value\)'/u);

  const record = compile("record Task:\n    id: string\n\nconst task = Task(id = \"t1\")\nprint(task.id)\n");
  assert.equal(record.code, null);
  assert.deepEqual(record.diagnostics.map((item) => item.code), ["VEL2026", "VEL4001"]);
  assert.match(record.diagnostics[0]?.message ?? "", /Use 'type'/u);
  assert.match(record.diagnostics[1]?.message ?? "", /record literal '\{field: value, \.\.\.\}'/u);

  const method = compile("class Player:\n    fn jump() -> number:\n        return 1\n\nconst player = Player()\nprint(player.jump())\n");
  assert.equal(method.code, null);
  assert.deepEqual(method.diagnostics.map((item) => item.code), ["VEL2026"]);
});

test("guidance without an unambiguous guided form keeps gating deeper stages", () => {
  const withResult = compile("const value = {a: 1}\nconst next = value with {a: 2}\nprint(missing)\n");
  assert.equal(withResult.code, null);
  assert.deepEqual(withResult.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(withResult.diagnostics[0]?.message ?? "", /does not expose 'with'/u);
});

test("guides bare hex colors to quoted strings without numeric-unit cascades", () => {
  const core = compile("const accent = #3478f6\nprint(accent)\n");
  assert.equal(core.code, null);
  assert.deepEqual(core.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.equal(
    core.diagnostics[0]?.message,
    "Use '\"#3478f6\"'; VelarScript writes hex colors as quoted strings or color builders such as rgb(...)",
  );

  const look = compile("component App:\n    look:\n        background = #f0f0f0\n    return <div>ok</div>\n");
  assert.equal(look.code, null);
  assert.deepEqual(look.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(look.diagnostics[0]?.message ?? "", /Use '"#f0f0f0"'/u);

  // A '#' that begins a line is Python-comment intuition, not a color: it is
  // guided to '//' and the commented text is skipped without a cascade.
  const comment = compile("# note\n");
  assert.deepEqual(comment.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(comment.diagnostics[0]?.message ?? "", /Use '\/\/' for comments/u);
  assert.ok(!comment.diagnostics.some((item) => item.code === "VEL1001"));
});

test("guides Python conditional expressions to the '?:' spelling", () => {
  const simple = compile("const value = 1 if true else 2\nprint(value)\n");
  assert.equal(simple.code, null);
  assert.deepEqual(simple.diagnostics.map((item) => item.code), ["VEL2027"]);
  assert.equal(
    simple.diagnostics[0]?.message,
    "Use 'cond ? x : y'; VelarScript writes conditional expressions with '?:', not 'x if cond else y'",
  );

  const nested = compile("const items = [1, 2]\nconst next = items.map(t => (t + 1 if t > 0 else t))\nprint(next)\n");
  assert.equal(nested.code, null);
  assert.deepEqual(nested.diagnostics.map((item) => item.code), ["VEL2027"]);

  const statement = compile("if true:\n    print(1)\nelse:\n    print(2)\n");
  assert.deepEqual(statement.diagnostics, []);

  const guarded = compile("match 1:\n    case 1 if true:\n        print(1)\n    else:\n        print(2)\n");
  assert.deepEqual(guarded.diagnostics, []);
});

test("postfix array annotations guide directly to the List spelling", () => {
  const postfix = compile("const values: number[] = []\nprint(values)\n");
  assert.equal(postfix.code, null);
  assert.deepEqual(postfix.diagnostics.map((item) => item.code), ["VEL2012"]);
  assert.equal(
    postfix.diagnostics[0]?.message,
    "Use 'List<number>' for ordered collections; VelarScript has no postfix '[]' array types",
  );

  const named = compile("type Task:\n    id: string\n\nconst tasks: Task[] = []\nprint(tasks)\n");
  assert.deepEqual(named.diagnostics.map((item) => item.code), ["VEL2012"]);
  assert.match(named.diagnostics[0]?.message ?? "", /Use 'List<Task>'/u);

  const optional = compile("const values: number[]? = null\nprint(values)\n");
  assert.deepEqual(optional.diagnostics.map((item) => item.code), ["VEL2012"]);

  const bracketGenerics = compile("const values: List[number] = []\nprint(values)\n");
  assert.deepEqual(bracketGenerics.diagnostics.map((item) => item.code), ["VEL2012"]);
  assert.equal(bracketGenerics.diagnostics[0]?.message, "Generic type arguments use '<...>', not '[...]'");
});

test("guides JSX for blocks to '.map(...)' rendering", () => {
  const result = compile(`
component App:
    state messages: List<string> = []

    return <div>
        {for m in messages:
            <p>{m}</p>}
    </div>
`.trimStart());
  assert.equal(result.code, null);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5049"]);
  assert.equal(
    result.diagnostics[0]?.message,
    "Use '{messages.map((m) => ...)}'; JSX has no 'for' blocks, so lists render with '.map(...)'",
  );
});

test("guides record literals against Map contracts, type-object calls, and legacy JS string methods", () => {
  const emptyMap = compile("let counts: Map<string, number> = {}\n");
  assert.equal(emptyMap.code, null);
  assert.ok(emptyMap.diagnostics.some((item) => item.code === "VEL4001"
    && /Use 'Map\(\)' to create an empty Map.*record literal '\{\}'/u.test(item.message)));

  const filledMap = compile("const counts: Map<string, number> = {a: 1}\n");
  assert.ok(filledMap.diagnostics.some((item) => item.code === "VEL4001"
    && /Use 'Map\(\{\.\.\.\}\)' to convert record fields/u.test(item.message)));

  const typeCall = compile("type Task:\n    id: string\n\nconst task = Task(id = \"t1\")\nprint(task.id)\n");
  assert.equal(typeCall.code, null);
  assert.ok(typeCall.diagnostics.some((item) => item.code === "VEL4001"
    && /Use a record literal '\{field: value, \.\.\.\}' to build a 'Task' value.*not a constructor/u.test(item.message)));

  const trim = compile("const value = \" x \".trim()\n");
  assert.deepEqual(trim.diagnostics, []);

  const upper = compile("const value = \"x\".toUpperCase()\n");
  assert.ok(upper.diagnostics.some((item) => item.code === "VEL4001"
    && /Use '\.upper\(\)'/u.test(item.message)));
});

test("guides component render-style blocks toward returning JSX directly", () => {
  for (const keyword of ["render", "show", "view"]) {
    const result = compile(`component App:\n    ${keyword}:\n        <div>hi</div>\n`);
    assert.equal(result.code, null, keyword);
    assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL5048"], keyword);
    assert.match(result.diagnostics[0]?.message ?? "", /Use 'return <\.\.\.>'/u, keyword);
    assert.match(result.diagnostics[0]?.message ?? "", new RegExp(`no '${keyword}:' block`, "u"), keyword);
  }
});

test("guides camelCase event attributes and bare bind to the Web directive spellings", () => {
  const result = compile(`
component App:
    state draft = ""

    def send():
        print(draft)

    return <div>
        <input bind={draft} onEnter={send} />
        <button onClick={send}>Send</button>
    </div>
`.trimStart());

  assert.equal(result.code, null);
  assert.ok(result.diagnostics.some((item) => item.code === "VEL5019"
    && /Use 'bind:value=\{name\}'.*bind:value or bind:checked/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => item.code === "VEL5025"
    && /Use 'on:click'.*on: directive/u.test(item.message)));
  assert.ok(result.diagnostics.some((item) => item.code === "VEL5025"
    && /Use 'on:keydown'.*event\.key == "Enter"/u.test(item.message)));
});

test("guides Look statement form, kebab-case properties, and multi-value shorthand", () => {
  const statement = compile("look bubble:\n    maxWidth = 240px\n");
  assert.equal(statement.code, null);
  assert.deepEqual(statement.diagnostics.map((item) => item.code), ["VEL5038"]);
  assert.match(statement.diagnostics[0]?.message ?? "", /Use 'const bubble = look:'.*look=\{bubble\}/u);

  const kebab = compile("export const bubble = look:\n    max-width = 240px\n    overflow-y = \"auto\"\n");
  assert.equal(kebab.code, null);
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'maxWidth'.*DOM camelCase spelling/u.test(item.message)));
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'overflowY'/u.test(item.message)));

  const shorthand = compile("export const bubble = look:\n    margin = 4px 0\n    padding = 8px 12px\n");
  assert.equal(shorthand.code, null);
  assert.ok(shorthand.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'spacing\(4px, 0px\)'.*spacing builder/u.test(item.message)));
  assert.ok(shorthand.diagnostics.some((item) => item.code === "VEL5038"
    && /Use 'spacing\(8px, 12px\)'/u.test(item.message)));

  const hexStrings = compile("export const bubble = look:\n    background = \"#eef0f3\"\n    color = \"#1a1a1a\"\n");
  assert.deepEqual(hexStrings.diagnostics, []);
  assert.notEqual(hexStrings.code, null);
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
  assert.ok(logical.diagnostics.some((item) => /Condition must be bool or optional, received number/.test(item.message)));

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

test("source locations treat LF, CRLF, and standalone CR as line boundaries", () => {
  const source = new SourceText("newlines.vel", "first\rsecond\r\nthird\nfourth");
  assert.deepEqual(source.location(source.text.indexOf("second")), { line: 2, column: 1 });
  assert.deepEqual(source.location(source.text.indexOf("third")), { line: 3, column: 1 });
  assert.deepEqual(source.location(source.text.indexOf("fourth")), { line: 4, column: 1 });
  assert.equal(source.lineText(1), "first");
  assert.equal(source.lineText(2), "second");
  assert.equal(source.lineText(3), "third");
  assert.equal(source.lineText(4), "fourth");
  const missingOffset = source.text.indexOf("second");
  const rendered = formatDiagnostic(source, { code: "VEL3001", message: "Unknown name", span: { start: missingOffset, end: missingOffset + 6 } });
  assert.match(rendered, /^newlines\.vel:2:1 error VEL3001: Unknown name\nsecond\n\^{6}$/u);

  const documented = compileCore("/// Standalone CR documentation\rconst value = 1\r", { path: "documented.vel" });
  assert.equal(documented.semanticIndex.symbols.find((item) => item.name === "value")?.documentation, "Standalone CR documentation");
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
  const powerNesting = compileCore(`${"1 ** ".repeat(1_000)}1\n`);
  assert.equal(powerNesting.code, null);
  assert.ok(powerNesting.diagnostics.some((item) => item.code === "VEL2008"));
  const typeNesting = compileCore(`type Deep = ${"List<".repeat(1_000)}number${">".repeat(1_000)}\n`);
  assert.equal(typeNesting.code, null);
  assert.ok(typeNesting.diagnostics.some((item) => item.code === "VEL2008"));
  const delimiterNesting = compile(`${"(".repeat(513)}1${")".repeat(513)}\n`);
  assert.equal(delimiterNesting.code, null);
  assert.ok(delimiterNesting.diagnostics.some((item) => item.code === "VEL1006"));
  let extensionParserCalled = false;
  const limitedBeforeExtension = compileCore(`${"(".repeat(513)}1${")".repeat(513)}\n`, {
    extensions: [{
      id: "fixture-terminal-lexer-limit",
      parser: { create() { extensionParserCalled = true; throw new Error("parser should not run"); } },
    }],
  });
  assert.ok(limitedBeforeExtension.diagnostics.some((item) => item.code === "VEL1006"));
  assert.equal(extensionParserCalled, false);

  const directory = await mkdtemp(join(tmpdir(), "velar-source-limit-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, oversized, "utf8");
  const execution = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "check", entry], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /exceeds the 4 MiB VelarScript source-module limit/u);
});

test("compiler complexity diagnostics never hide extension RangeErrors", () => {
  const lexicalFailure = new RangeError("lexical extension failed");
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{
      id: "fixture-lexical-range",
      lexical: { scan() { throw lexicalFailure; } },
    }],
  }), (error) => error === lexicalFailure);

  const parserFailure = new RangeError("parser extension failed");
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{
      id: "fixture-parser-range",
      parser: { create() { throw parserFailure; } },
    }],
  }), (error) => error === parserFailure);
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
    const compiled = compile(source, { path });
    const inspected = inspectModule(source, { path });
    assert.ok(Array.isArray(compiled.diagnostics));
    assert.ok(Array.isArray(inspected.diagnostics));
    for (const item of [...compiled.diagnostics, ...inspected.diagnostics]) {
      assert.ok(item.span.start >= 0 && item.span.start <= item.span.end && item.span.end <= source.length, `${path}: ${JSON.stringify(item)}`);
    }
    assert.equal(typeof formatSource(source), "string");
  }

  for (const source of ['const value = "unterminated\\', 'const value = f"unterminated\\']) {
    const result = compile(source);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every((item) => item.span.end <= source.length));
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

test("CLI runs Core programs on Node with forwarded arguments and propagated exit codes", async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await mkdtemp(join(tmpdir(), "velar-run-"));

  const printPath = join(directory, "printing.vel");
  await writeFile(printPath, `
import {stringify} from "velar/json"
import {clamp} from "velar/math"
import {iso} from "velar/time"

print(stringify({limit: clamp(12, 0, 10)}))
print(iso(0))
`.trimStart(), "utf8");
  const printed = spawnSync(process.execPath, [cli, "run", printPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, "{\"limit\":10}\n1970-01-01T00:00:00.000Z\n");

  const projectRun = spawnSync(process.execPath, [cli, "run", "examples/modules"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(projectRun.status, 0, projectRun.stderr);
  assert.equal(projectRun.stdout, "Hello, Velar\n");

  const failingPath = join(directory, "failing.vel");
  await writeFile(failingPath, "throw Error(\"boom\")\n", "utf8");
  const failed = spawnSync(process.execPath, [cli, "run", failingPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Error: boom/u);
  assert.match(failed.stderr, /failing\.vel:1/u);

  const exitPath = join(directory, "exits.vel");
  await writeFile(exitPath, "import js unsafe {exit} from \"node:process\"\n\nexit(7)\n", "utf8");
  const exited = spawnSync(process.execPath, [cli, "run", exitPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(exited.status, 7, exited.stderr);

  const argumentsPath = join(directory, "arguments.vel");
  await writeFile(argumentsPath, "import js unsafe {argv} from \"node:process\"\n\nprint(argv.slice(2).join(\",\"))\n", "utf8");
  const forwarded = spawnSync(process.execPath, [cli, "run", argumentsPath, "--", "alpha", "--beta=1", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(forwarded.status, 0, forwarded.stderr);
  assert.equal(forwarded.stdout, "alpha,--beta=1,--help\n");

  const optionBeforeSeparator = spawnSync(process.execPath, [cli, "run", argumentsPath, "--beta=1"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(optionBeforeSeparator.status, 2);
  assert.match(optionBeforeSeparator.stderr, /unknown option '--beta=1'; program arguments belong after '--'/u);

  const help = spawnSync(process.execPath, [cli, "run", "--help"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar run \[entry\.vel \| project-directory\] \[-- <program-arguments>\.\.\.\]/u);
});

test("CLI run rejects web framework projects and points to dev and build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-run-web-"));
  const projectRoot = join(directory, "web-app");
  await mkdir(join(projectRoot, "src"), { recursive: true });
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: ["@velarscript/web"],
    web: { title: "App", base: "/" },
  }), "utf8");
  await writeFile(join(projectRoot, "src", "main.vel"), "print(\"hello\")\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  const rejected = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "run", projectRoot], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stderr, "velar run: this project enables the '@velarscript/web' application framework; use 'velar dev' or 'velar build' instead\n");
});

test("dev server exits cleanly after browser requests", async (context) => {
  const child = spawn(process.execPath, [
    "packages/cli/src/cli.ts",
    "dev",
    "examples/todo",
    "--port",
    "42879",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 5_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/);
  const html = await (await fetch("http://127.0.0.1:42879/")).text();
  assert.match(html, /data-velar-error-overlay/);
  assert.match(html, /VelarScript runtime error/);
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
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server keeps the last good app behind compile-error overlays", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-overlay-"));
  const mainPath = join(directory, "main.vel");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(mainPath, "component App:\n    return <main>Ready</main>\n\nmount(<App />, \"#app\")\n", "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "42880"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/VelarScript dev server:/u);
  const first = await fetch("http://127.0.0.1:42880/");
  assert.equal(first.status, 200);
  await writeFile(mainPath, "component App:\n    return <img />\n", "utf8");
  await waitForOutput(/VelarScript app has \d+ error/u);
  const retained = await fetch("http://127.0.0.1:42880/");
  assert.equal(retained.status, 200);
  assert.match(await retained.text(), /data-velar-error-overlay/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server contains unexpected rebuild failures and recovers on the next edit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-rebuild-recovery-"));
  const mainPath = join(directory, "main.vel");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
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
    await waitForOutput(/VelarScript dev server:/u);
    const excessiveImports = Array.from(
      { length: 4_097 },
      (_, index) => `import js unsafe {value as value${index}} from "overflow-${index}"`,
    ).join("\n");
    await writeFile(mainPath, `${excessiveImports}\n${validSource("Too many")}`, "utf8");
    await waitForOutput(/VelarScript rebuild failed: A browser project cannot import more than 4096 JavaScript packages/u, () => errors);
    await waitForOutput(/VelarScript app has 1 error/u);
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
    await waitForOutput(/VelarScript app rebuilt in/u);
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
  assertDevServerExit(exitCode, errors);
});

test("dev server polling watcher reports project changes without native file events", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-polling-"));
  const mainPath = join(directory, "main.vel");
  const preloadPath = join(directory, "force-windows-platform.mjs");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(mainPath, "component App:\n    return <main>Before</main>\n\nmount(<App />, \"#app\")\n", "utf8");
  await writeFile(preloadPath, "Object.defineProperty(process, 'platform', {value: 'win32'});\n", "utf8");
  const child = spawn(process.execPath, [
    "--import",
    pathToFileURL(preloadPath).href,
    "packages/cli/src/cli.ts",
    "dev",
    directory,
    "--port",
    "42882",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };

  await waitForOutput(/VelarScript dev server:/u);
  await writeFile(mainPath, "component App:\n    return <main>After</main>\n\nmount(<App />, \"#app\")\n", "utf8");
  await waitForOutput(/VelarScript app rebuilt in/u);
  const javascript = await (await fetch("http://127.0.0.1:42882/main.js")).text();
  assert.match(javascript, /After/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server exposes incremental compilation status and reuses unaffected modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-incremental-"));
  const mainPath = join(directory, "main.vel");
  const storePath = join(directory, "store.vel");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
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
  try {
    await waitForOutput(/VelarScript dev server:/u);
    const initial = await (await fetch("http://127.0.0.1:42883/__velar/status")).json() as {
      apiVersion: string;
      compilation: { moduleCount: number; compiledModules: number; reusedModules: number };
    };
    assert.equal(initial.apiVersion, "0.10");
    assert.deepEqual(initial.compilation, { ...initial.compilation, moduleCount: 3, compiledModules: 3, reusedModules: 0 });

    await writeFile(storePath, "export const label = \"Updated\"\n", "utf8");
    await waitForOutput(/VelarScript app rebuilt in .*\(2 compiled, 1 reused\)/u);
    const updated = await (await fetch("http://127.0.0.1:42883/__velar/status")).json() as {
      compilation: { compiledModules: number; reusedModules: number; affectedModules: number };
    };
    assert.equal(updated.compilation.compiledModules, 2);
    assert.equal(updated.compilation.reusedModules, 1);
    assert.equal(updated.compilation.affectedModules, 2);
  } finally {
    const exit = child.exitCode === null
      ? new Promise<number | null>((resolve) => child.once("exit", resolve))
      : Promise.resolve(child.exitCode);
    child.kill("SIGTERM");
    const exitCode = await exit;
    assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
  }
});

test("dev server watches installed VelarScript source package roots", async (context) => {
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
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
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
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/VelarScript dev server:/u);
  await writeFile(packageEntry, "export const label = \"Updated library\"\n", "utf8");
  await waitForOutput(/VelarScript app rebuilt in .*\(2 compiled, 0 reused\)/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server watches JavaScript package subpath declarations and reanalyzes safe imports", async (context) => {
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
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
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
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/VelarScript dev server:/u);
  await writeFile(declarationPath, "export declare function format(value: string): string;\n", "utf8");
  await waitForOutput(/VelarScript app has 1 error/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server serves dual CJS/ESM packages through their import condition", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-dual-esm-"));
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "dual-lib"), { recursive: true });
  await mkdir(join(projectRoot, "node_modules", "dual-dep"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "dual-lib", "package.json"), JSON.stringify({
    name: "dual-lib",
    version: "1.2.3",
    exports: {
      ".": { import: "./index.mjs", require: "./index.js" },
    },
  }), "utf8");
  await writeFile(
    join(projectRoot, "node_modules", "dual-lib", "index.js"),
    "const { star } = require(\"dual-dep\");\nmodule.exports.decorate = (value) => `${star}${value}${star}`;\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "dual-lib", "index.mjs"),
    "import { star } from \"dual-dep\";\nexport const decorate = (value) => `${star}${value}${star}`;\n",
    "utf8",
  );
  await writeFile(join(projectRoot, "node_modules", "dual-dep", "package.json"), JSON.stringify({
    name: "dual-dep",
    version: "2.0.0",
    exports: {
      ".": { import: "./star.mjs", require: "./star.cjs" },
    },
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "dual-dep", "star.mjs"), "export const star = \"*\";\n", "utf8");
  await writeFile(join(projectRoot, "node_modules", "dual-dep", "star.cjs"), "module.exports.star = \"*\";\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
extern module "dual-lib":
    export def decorate(value: string) -> string

import js {decorate} from "dual-lib"

component App:
    return <main>{decorate("velar")}</main>

mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "42886"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const page = await fetch("http://127.0.0.1:42886/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.doesNotMatch(html, /Cannot resolve browser npm import/u);
  // The import map points both the direct dependency and the transitive bare
  // import of its ESM entry at their prebundled dev modules; other packages
  // stay external inside a prebundle and resolve through the import map.
  assert.match(html, /"dual-lib":"\/@npm\/dual-lib\/index\.js"/u);
  assert.match(html, /"dual-dep":"\/@npm\/dual-dep\/index\.js"/u);
  const entry = await fetch("http://127.0.0.1:42886/@npm/dual-lib/index.js");
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /from "dual-dep"/u);
  const dependency = await fetch("http://127.0.0.1:42886/@npm/dual-dep/index.js");
  assert.equal(dependency.status, 200);
  assert.match(await dependency.text(), /star/u);
  // The prebundle cache is keyed by package version under .velar/dev-deps.
  const meta = JSON.parse(await readFile(join(projectRoot, ".velar", "dev-deps", "dual-lib@1.2.3", "meta.json"), "utf8")) as {
    entries: Record<string, string>;
    externals: string[];
  };
  assert.equal(meta.entries["."], "index.js");
  assert.deepEqual(meta.externals, ["dual-dep"]);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server names genuinely CommonJS-only packages in its refusal", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-cjs-only-"));
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "legacy-lib"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "legacy-lib", "package.json"), JSON.stringify({
    name: "legacy-lib",
    main: "index.js",
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "legacy-lib", "index.js"), "module.exports.decorate = (value) => value;\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
extern module "legacy-lib":
    export def decorate(value: string) -> string

import js {decorate} from "legacy-lib"

component App:
    return <main>{decorate("velar")}</main>

mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "42887"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const page = await fetch("http://127.0.0.1:42887/");
  const html = await page.text();
  assert.match(html, /Cannot resolve browser npm import 'legacy-lib'/u);
  assert.match(html, /resolves to the CommonJS file &#39;index\.js&#39;|resolves to the CommonJS file 'index\.js'/u);
  assert.match(html, /needs an ESM build/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server prebundles dual packages whose ESM entry wraps CommonJS internals", async (context) => {
  // The npm ecosystem's standard dual-package-hazard wrapper (ledger W-20):
  // the "import"-condition entry is real ESM that default-imports the
  // package's own CommonJS internals, which native browser ESM cannot load
  // raw. The dev prebundle converts the internals exactly like 'velar build'.
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-cjs-wrapper-"));
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "wrapper-lib", "es"), { recursive: true });
  await mkdir(join(projectRoot, "node_modules", "wrapper-lib", "lib"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "wrapper-lib", "package.json"), JSON.stringify({
    name: "wrapper-lib",
    version: "2.5.0",
    type: "commonjs",
    exports: {
      ".": { import: "./es/index.js", require: "./lib/index.js" },
      "./lib/util": { import: "./es/util.js", require: "./lib/util.js" },
    },
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "wrapper-lib", "es", "package.json"), JSON.stringify({ type: "module" }), "utf8");
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "es", "index.js"),
    "import Wrapper from '../lib/index.js';\nexport default Wrapper;\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "es", "util.js"),
    "import Util from '../lib/util.js';\nexport default Util;\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "lib", "index.js"),
    "const util = require('./util.js');\nmodule.exports = { frame: (value) => util.wrap(value) };\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "lib", "util.js"),
    "module.exports = { wrap: (value) => `[${value}]` };\n",
    "utf8",
  );
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
type Wrapper:
    frame: (value: string) -> string

type Util:
    wrap: (value: string) -> string

extern module "wrapper-lib":
    export const default: Wrapper

extern module "wrapper-lib/lib/util":
    export const default: Util

import js wrapper from "wrapper-lib"
import js util from "wrapper-lib/lib/util"

component App:
    return <main>{wrapper.frame(util.wrap("velar"))}</main>

mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "42888"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const page = await fetch("http://127.0.0.1:42888/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.doesNotMatch(html, /Cannot resolve browser npm import/u);
  assert.match(html, /"wrapper-lib":"\/@npm\/wrapper-lib\/index\.js"/u);
  assert.match(html, /"wrapper-lib\/lib\/util":"\/@npm\/wrapper-lib\/lib\/util\.js"/u);
  const entry = await fetch("http://127.0.0.1:42888/@npm/wrapper-lib/index.js");
  assert.equal(entry.status, 200);
  const entryText = await entry.text();
  // The CommonJS internals were converted rather than left as raw relative
  // imports the browser would reject with a SyntaxError.
  assert.doesNotMatch(entryText, /from\s*['"]\.\.\/lib\//u);
  assert.match(entryText, /export\s*\{[^}]*default[^}]*\}|export default/u);
  const util = await fetch("http://127.0.0.1:42888/@npm/wrapper-lib/lib/util.js");
  assert.equal(util.status, 200);
  // Both entries come from one splitting build, so the shared internals load
  // as one chunk module instead of two duplicated copies.
  const chunkImport = entryText.match(/from\s*"(\.\/chunk-[^"]+\.js)"/u);
  assert.ok(chunkImport, "expected the prebundled entry to import a shared chunk");
  const chunk = await fetch(`http://127.0.0.1:42888/@npm/wrapper-lib/${chunkImport![1]!.slice(2)}`);
  assert.equal(chunk.status, 200);
  const meta = JSON.parse(await readFile(join(projectRoot, ".velar", "dev-deps", "wrapper-lib@2.5.0", "meta.json"), "utf8")) as {
    entries: Record<string, string>;
  };
  assert.equal(meta.entries["."], "index.js");
  assert.equal(meta.entries["./lib/util"], "lib/util.js");
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server names genuinely broken packages instead of serving raw module errors", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dev-broken-npm-"));
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "broken-lib"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "broken-lib", "package.json"), JSON.stringify({
    name: "broken-lib",
    version: "1.0.0",
    exports: { ".": { import: "./index.mjs" } },
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "broken-lib", "index.mjs"), "export default {\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
extern module "broken-lib":
    export def decorate(value: string) -> string

import js {decorate} from "broken-lib"

component App:
    return <main>{decorate("velar")}</main>

mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "42889"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const page = await fetch("http://127.0.0.1:42889/");
  const html = await page.text();
  // The failure is velar-voiced and names the package; the browser never
  // receives a raw module for a package that cannot be prebundled.
  assert.match(html, /VelarScript build error/u);
  assert.match(html, /Cannot resolve browser npm import &#39;broken-lib&#39;|Cannot resolve browser npm import 'broken-lib'/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
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

const raw = {name: "Ada", avatar: null}
const user = User.parse(raw)
const avatar = user?.avatar ?? "default.png"
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /User\.parse\(raw\)/);
  assert.match(result.code ?? "", /user\?\.avatar \?\? null\) \?\? "default\.png"/);
});

test("runtime record checks require own data fields without invoking accessors", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

const checked = User.parse({name: "Ada"})
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
let getterReads = 0;
const accessor = {};
Object.defineProperty(accessor, "name", { enumerable: true, get() { getterReads += 1; return "Ada"; } });
const inherited = Object.create({ name: "Ada" });
const optionalAccessor = { name: "Ada" };
Object.defineProperty(optionalAccessor, "avatar", { enumerable: true, get() { getterReads += 1; return "photo.png"; } });
console.log(User.is({ name: "Ada" }));
console.log(User.is(accessor));
console.log(User.is(inherited));
console.log(User.is(optionalAccessor));
try { User.parse(accessor); } catch (error) { console.log(error.name); }
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\nfalse\nValidationError\n0\n");
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

test("type-checks literal dynamic VelarScript imports and lazy components", async () => {
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

test("production builds emit separately verified chunks for lazy VelarScript components", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-dynamic-build-"));
  const output = join(directory, "dist");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
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
    "packages/cli/src/cli.ts", "build", directory, "--out-dir", output,
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
  assert.equal(describeType(result.moduleInterface.exports.get("increment")!), "() -> null");
  assert.match(result.code ?? "", /export const count = __velarState\(0\)/);
  assert.match(result.code ?? "", /export const doubled = __velarComputed\(\(\) => \(count\.get\(\) \* 2\)/);
  assert.match(result.code ?? "", /count\.set\(count\.get\(\) \+ 1\)/);
  assert.match(result.code ?? "", /__velarWatch\(\(\) => count\.get\(\)/);

  const asynchronousWatch = compile(`
async def later():
    return null

state ready = false
watch ready:
    await later()
`.trimStart());
  assert.equal(asynchronousWatch.code, null);
  assert.ok(asynchronousWatch.diagnostics.some((item) => item.code === "VEL4007" && /watch blocks are synchronous/u.test(item.message)));

  const asynchronousWatchRead = compile(`
async def later() -> bool:
    return true

watch await later():
    print("changed")
`.trimStart());
  assert.equal(asynchronousWatchRead.code, null);
  assert.ok(asynchronousWatchRead.diagnostics.some((item) => item.code === "VEL4007" && /watch blocks are synchronous/u.test(item.message)));

  const asynchronousComputed = compile(`
async def later() -> number:
    return 1

computed value = await later()
`.trimStart());
  assert.equal(asynchronousComputed.code, null);
  assert.ok(asynchronousComputed.diagnostics.some((item) => item.code === "VEL4007" && /Computed expressions.*synchronous/u.test(item.message)));

  const asynchronousJsx = compile(`
async def label() -> string:
    return "ready"

mount(<main>{await label()}</main>, "#app")
`.trimStart());
  assert.equal(asynchronousJsx.code, null);
  assert.ok(asynchronousJsx.diagnostics.some((item) => item.code === "VEL4007" && /JSX rendering is synchronous/u.test(item.message)));

  const asynchronousMount = compile(`
async def createRoot() -> WebNode:
    return <main>Ready</main>

mount(await createRoot(), "#app")
`.trimStart());
  assert.equal(asynchronousMount.code, null);
  assert.ok(asynchronousMount.diagnostics.some((item) => item.code === "VEL4007" && /mount constructs its root synchronously/u.test(item.message)));

  const namedMount = compile(`
def root() -> WebNode:
    print("node")
    return <main>Ready</main>

def target() -> string:
    print("target")
    return "#app"

mount(node=root(), target=target())
`.trimStart());
  assert.deepEqual(namedMount.diagnostics, []);
  assert.match(namedMount.code ?? "", /__velarMount\(\(\) => \(\(__namedArguments\) => \[__namedArguments\[0\], __namedArguments\[1\]\]\)\(\[root\(\), target\(\)\]\), null\)/u);
  const mountExecution = executeModule(`
class FakeNode {
  append(node) { this.child = node; }
  setAttribute() {}
}
const targetNode = new FakeNode();
globalThis.Node = FakeNode;
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode() { return new FakeNode(); },
  createComment() { return new FakeNode(); },
  querySelector() { return targetNode; },
};
${namedMount.code ?? ""}
`);
  assert.equal(mountExecution.status, 0, String(mountExecution.stderr));
  assert.equal(mountExecution.stdout, "node\ntarget\n");

  const reorderedMount = compile(`
component App:
    return <main>Ready</main>

mount(target="#app", node=<App />)
`.trimStart());
  assert.deepEqual(reorderedMount.diagnostics, []);
  assert.match(reorderedMount.code ?? "", /__namedArguments\[1\], __namedArguments\[0\]/u);
});

test("deep reactivity retires identity memo caches without changing derivation results", () => {
  const store = compile(`
type Session:
    id: string
    title: string

type Message:
    id: string
    sessionId: string
    text: string

def textOf(message: Message?) -> string:
    return message == null ? "No messages yet" : message.text

def previewOf(message: Message?) -> string:
    print(message == null ? "derive:none" : f"derive:{message.id}")
    return textOf(message)

state sessions: List<Session> = [{id: "s1", title: "one"}, {id: "s2", title: "two"}, {id: "s3", title: "three"}]
state messages: List<Message> = [
    {id: "m1", sessionId: "s1", text: "alpha"},
    {id: "m2", sessionId: "s2", text: "beta"},
    {id: "m3", sessionId: "s3", text: "gamma"},
]

def latestFor(list: List<Message>, sessionId: string) -> Message?:
    const own = list.filter(message => message.sessionId == sessionId)
    return own.size == 0 ? null : own[own.size - 1]

def buildEntries(sessionList: List<Session>, messageList: List<Message>) -> List<string>:
    return sessionList.map(session => previewOf(latestFor(messageList, session.id)))

computed previews: List<string> = buildEntries(sessions, messages)

watch previews as current, previous:
    print(f"previews:{current.join("|")}")

export def appendChunk(replyId: string, chunk: string):
    const message = messages.find(item => item.id == replyId)
    if message:
        message.text += chunk

export def removeSession(id: string):
    sessions = sessions.filter(session => session.id != id)

export def restoreSession(session: Session):
    sessions.append(session)
`.trimStart());
  assert.deepEqual(store.diagnostics, []);
  assert.doesNotMatch(store.code ?? "", /__velar(?:Auto)?Memo/u);
  const execution = executeModule(`
${store.code ?? ""}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("chunk:s1");
appendChunk("m1", "!");
await flush();
console.log("remove:s2");
const savedSession = sessions.get().find((session) => session.id === "s2");
removeSession("s2");
await flush();
console.log("missed-run");
appendChunk("m1", "?");
await flush();
console.log("restore:s2");
restoreSession(savedSession);
await flush();
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:m1", "derive:m2", "derive:m3",
    "chunk:s1", "derive:m1", "derive:m2", "derive:m3", "previews:alpha!|beta|gamma",
    "remove:s2", "derive:m1", "derive:m3", "previews:alpha!|gamma",
    "missed-run", "derive:m1", "derive:m3", "previews:alpha!?|gamma",
    "restore:s2", "derive:m1", "derive:m3", "derive:m2", "previews:alpha!?|gamma|beta",
    "",
  ].join("\n"));

  const direct = compile(`
type Message:
    id: string
    text: string

def textOf(message: Message) -> string:
    return message.text

def previewOf(message: Message) -> string:
    print(f"derive:{message.id}")
    return textOf(message)

state items: List<Message> = [{id: "m1", text: "alpha"}, {id: "m2", text: "beta"}]
computed previews: List<string> = items.map(previewOf)

watch previews as current, previous:
    print(f"previews:{current.join("|")}")

export def snapshot() -> List<string>:
    return items.map(previewOf)

export def touchFirst():
    items[0].text += "!"
`.trimStart());
  assert.deepEqual(direct.diagnostics, []);
  assert.doesNotMatch(direct.code ?? "", /__velar(?:Auto)?Memo/u);
  const directExecution = executeModule(`
${direct.code ?? ""}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("touch:m1");
touchFirst();
await flush();
console.log("snapshot");
snapshot();
`);
  assert.equal(directExecution.status, 0, String(directExecution.stderr));
  assert.equal(directExecution.stdout, [
    "derive:m1", "derive:m2",
    "touch:m1", "derive:m1", "derive:m2", "previews:alpha!|beta",
    "snapshot", "derive:m1", "derive:m2",
    "",
  ].join("\n"));
});

test("the retired memo surface stays absent from every derivation shape", () => {
  const plain = (source: string, label: string): void => {
    const result = compile(source);
    assert.deepEqual(result.diagnostics, [], label);
    const sites = (result.code ?? "").split("\n")
      .filter((line) => line.includes("__velarAutoMemo(") && !line.includes("function __velarAutoMemo") && !line.trimStart().startsWith("//"));
    assert.deepEqual(sites, [], label);
  };

  // (a) Reading a reactive binding anywhere in the callback graph.
  plain(`
state suffix: string = "!"

def shout(value: string) -> string:
    return value + "?"

def decorate(value: string) -> string:
    return shout(value) + suffix

state items: List<string> = []
computed labels: List<string> = items.map(decorate)
`.trimStart(), "reactive read");

  // (b) Capturing a mutable module binding.
  plain(`
let counter = 0

def shout(value: string) -> string:
    return value

def label(value: string) -> string:
    return shout(value) + str(counter)

state items: List<string> = []
computed labels: List<string> = items.map(label)
`.trimStart(), "mutable capture");

  // (c) Calling anything unproved — an async def here.
  plain(`
def shout(value: string) -> string:
    return value + "!"

async def sideEffect() -> null:
    return null

def label(value: string) -> string:
    sideEffect()
    return shout(value)

state items: List<string> = []
computed labels: List<string> = items.map(label)
`.trimStart(), "unproved callee");

  // (d) Mutating the argument through member assignment.
  plain(`
type Box:
    value: number

def helperOf(box: Box) -> number:
    return box.value

def bump(box: Box) -> number:
    box.value = box.value + 1
    return helperOf(box)

state boxes: List<Box> = []
computed values: List<number> = boxes.map(bump)
`.trimStart(), "argument mutation");

  // (e) A trivial non-delegating callback is cheaper than its cache entry.
  plain(`
def double(value: number) -> number:
    return value * 2

state items: List<number> = []
computed doubled: List<number> = items.map(double)
`.trimStart(), "non-delegating callback");

  // (f) Actions and event handlers are not derivation contexts.
  plain(`
def shout(value: string) -> string:
    return value + "!"

def polish(value: string) -> string:
    return shout(value)

state items: List<string> = []
state output: List<string> = []

export def commit():
    output = items.map(polish)
`.trimStart(), "non-derivation context");

  // The retired globals are ordinary identifiers again: the language
  // exposes no memoization or batching API.
  const freed = compile("const memo = 1\nconst batch = memo + 1\nprint(str(batch))\n");
  assert.deepEqual(freed.diagnostics, []);
  const unknown = compile("const broken = memo(3)\n");
  assert.ok(unknown.diagnostics.some((item) => item.code === "VEL3001" && /Unknown name 'memo'/u.test(item.message)));
});

test("cross-module interfaces no longer carry memo purity markers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-auto-memo-project-"));
  const domainPath = join(directory, "domain.vel");
  const barrelPath = join(directory, "barrel.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(domainPath, `
import {normalizeWhitespace, truncate} from "velar/text"

export type Message:
    id: string
    text: string

export def messagePreview(latest: Message?, limit: number = 48) -> string:
    if latest == null:
        return "No messages yet"
    return truncate(normalizeWhitespace(latest.text), limit)

export def sessionPreview(messages: List<Message>, sessionId: string) -> string:
    return str(messages.size) + sessionId
`.trimStart(), "utf8");
  await writeFile(barrelPath, "export {Message, messagePreview, sessionPreview} from \"./domain.vel\"\n", "utf8");
  await writeFile(mainPath, `
import {Message, messagePreview} from "./barrel.vel"

type Session:
    id: string

state sessions: List<Session> = []
state latestById: Map<string, Message> = Map()

def buildPreviews(sessionList: List<Session>, latest: Map<string, Message>) -> List<string>:
    return sessionList.map(session => messagePreview(latest.get(session.id)))

computed previews: List<string> = buildPreviews(sessions, latestById)

mount(<main>{previews.join("|")}</main>, "#app")
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  const domain = project.modules.find((module) => module.inputPath === domainPath);
  assert.ok(domain);
  const markers = domain.result.moduleInterface.extensionExports.get("@velarscript/web");
  assert.equal(markers, undefined);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.doesNotMatch(main.result.code ?? "", /__velar(?:Auto)?Memo/u);
});

test("consecutive synchronous state assignments publish once and reads stay fresh", () => {
  // The framework contract the scheduler owns — no API involved: assignments
  // commit immediately (a read between two assignments always sees the
  // latest value, computeds are invalidated synchronously), and every
  // affected computed, watch, and render observer re-runs once per
  // synchronous burst, delivered on the microtask flush. The contract's
  // boundary is the synchronous extent: a burst spread across awaits
  // publishes per assignment.
  const result = compile(`
state left: number = 0
state right: number = 0

def sumOf(a: number, b: number) -> number:
    print(f"sum:{a}:{b}")
    return a + b

computed total: number = sumOf(left, right)

watch total as current, previous:
    print(f"total:{current}")

export def commitBurst():
    left = left + 1
    print(f"fresh:{left}")
    right = right + 1
    left = left + 1

def nestedCommit():
    right = right + 1

export def deepBurst():
    left = left + 1
    nestedCommit()

export async def spreadBurst():
    left = left + 1
    await tick()
    right = right + 1
    await tick()
    left = left + 1

def throwingCommit():
    left = left + 100
    throw Error("burst failed")

export def throwingBurst():
    throwingCommit()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`
${result.code ?? ""}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("burst");
commitBurst();
await flush();
console.log("deep");
deepBurst();
await flush();
console.log("spread");
await spreadBurst();
await flush();
console.log("throwing");
try { throwingBurst(); console.log("missing throw"); } catch (error) { console.log("caught:" + error.message); }
await flush();
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "sum:0:0",
    // Three synchronous assignments, one publication: the read between them
    // is fresh, and the derived total recomputes once, not three times.
    "burst", "fresh:1", "sum:2:1", "total:3",
    // The burst may span helper calls; the synchronous extent is what counts.
    "deep", "sum:3:2", "total:5",
    // Spread across microtask boundaries the same three assignments publish
    // per assignment — the boundary of the contract.
    "spread", "sum:4:2", "total:6", "sum:4:3", "total:7", "sum:5:3", "total:8",
    // A throw does not tear state: what was assigned before the failure
    // still publishes once the microtask flush runs.
    "throwing", "caught:burst failed", "sum:105:3", "total:108",
    "",
  ].join("\n"));
});

test("state publishes deep record and collection mutation through aliases and calls", () => {
  const result = compile(`
type Task:
    label: string
    done: bool

type Meta:
    count: number

type Session:
    title: string
    meta: Meta

state tasks: List<Task> = [{label: "first", done: false}]
state byId: Map<string, Task> = Map()
state byTask: Map<Task, string> = Map()
state selected: Set<string> = Set()
state selectedTasks: Set<Task> = Set()
state session: Session = {title: "old", meta: {count: 0}}
computed doneCount: number = tasks.filter(task => task.done).size

watch tasks as current, previous:
    print("tasks:" + str(current.size) + ":same=" + str(current == previous))

watch session as current, previous:
    print("session:" + str(current.meta.count) + ":same=" + str(current == previous))

def mark(task: Task):
    task.done = true

export async def exercise():
    const alias = tasks
    alias.append({label: "second", done: false})
    await tick()
    print("size:" + str(tasks.size))
    mark(alias[0])
    await tick()
    print("done:" + str(doneCount))
    byTask.set(alias[0], "first")
    selectedTasks.add(alias[0])
    print("identity:" + str(byTask.get(alias[0])) + ":set=" + str(alias[0] in selectedTasks))
    byId.set("second", alias[1])
    const stored = byId.get("second")
    if stored:
        stored.done = true
        selected.add("second")
        session.meta.count += 1
        await tick()
        print("map:" + str(stored.done) + ":set=" + str("second" in selected))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /__velar(?:Auto)?Memo/u);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "tasks:2:same=true",
    "size:2",
    "tasks:2:same=true",
    "done:1",
    "identity:first:set=true",
    "tasks:2:same=true",
    "session:1:same=true",
    "map:true:set=true",
    "",
  ].join("\n"));

  const propMutation = compile(`
type Task:
    done: bool

component Child(task: Task, tasks: List<Task>):
    def mutate():
        task.done = true
        tasks.append(task)
    return <button type="button" on:click={mutate}>change</button>
`.trimStart());
  const propMessages = propMutation.diagnostics.filter((item) => item.code === "VEL5051").map((item) => item.message);
  assert.equal(propMessages.length, 2, JSON.stringify(propMutation.diagnostics));
  assert.ok(propMessages.every((message) => /read-only/u.test(message)), propMessages.join("\n"));
});

test("deep reactivity isolates record properties and Map keys", () => {
  const result = compile(`
type Pair:
    left: number
    right: number

state pair: Pair = {left: 0, right: 0}
state scores: Map<string, number> = Map()

def readLeft() -> number:
    print("derive:left")
    return pair.left

def readRight() -> number:
    print("derive:right")
    return pair.right

def readScore(key: string) -> number?:
    print("derive:" + key)
    return scores.get(key)

computed leftValue: number = readLeft()
computed rightValue: number = readRight()
computed alpha: number? = readScore("alpha")
computed beta: number? = readScore("beta")

watch leftValue as current, previous:
    print("left:" + str(current))

watch rightValue as current, previous:
    print("right:" + str(current))

watch alpha as current, previous:
    print("alpha:" + str(current))

watch beta as current, previous:
    print("beta:" + str(current))

export async def exercise():
    pair.left += 1
    await tick()
    scores.set("alpha", 7)
    await tick()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}\nawait exercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "derive:left", "derive:right", "derive:alpha", "derive:beta",
    "derive:left", "left:1",
    "derive:alpha", "alpha:7",
    "",
  ].join("\n"));
});

test("the shared runtime preserves proxy identity across Web bundles and skips host-shaped values", async () => {
  const first = compile("state first = 1\n");
  const second = compile("state second = 2\n");
  assert.deepEqual(first.diagnostics, []);
  assert.deepEqual(second.diagnostics, []);
  const directory = await mkdtemp(join(tmpdir(), "velar-reactive-bundles-"));
  const firstPath = join(directory, "first.mjs");
  const secondPath = join(directory, "second.mjs");
  const mainPath = join(directory, "main.mjs");
  await writeFile(firstPath, first.code ?? "", "utf8");
  await writeFile(secondPath, second.code ?? "", "utf8");
  await writeFile(mainPath, `
await import(${JSON.stringify(pathToFileURL(firstPath).href)});
const key = Symbol.for("velar.runtime.v1");
const firstRuntime = globalThis[key];
const raw = {nested: {value: 1}};
const proxy = firstRuntime.reactive(raw);
const descriptorChild = Object.getOwnPropertyDescriptor(proxy, "nested").value;
await import(${JSON.stringify(pathToFileURL(secondPath).href)});
const secondRuntime = globalThis[key];
class HostValue {}
const frozen = Object.freeze({value: 1});
const sealed = Object.preventExtensions({value: 1});
const list = [];
const map = new Map();
const set = new Set();
const fn = () => null;
console.log(JSON.stringify({
  runtime: firstRuntime === secondRuntime,
  proxy: proxy !== raw && secondRuntime.reactive(raw) === proxy && secondRuntime.toRaw(proxy) === raw,
  descriptor: descriptorChild === raw.nested,
  skipped: secondRuntime.reactive(new HostValue()) instanceof HostValue
    && secondRuntime.reactive(frozen) === frozen
    && secondRuntime.reactive(sealed) === sealed
    && secondRuntime.reactive(list) === list
    && secondRuntime.reactive(map) === map
    && secondRuntime.reactive(set) === set
    && secondRuntime.reactive(fn) === fn,
}));
`.trimStart(), "utf8");
  const execution = spawnSync(process.execPath, [mainPath], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(JSON.parse(execution.stdout), { runtime: true, proxy: true, descriptor: true, skipped: true });
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
  assert.equal(show?.type, "(value: number) -> number");
  assert.equal(show?.callable, true);
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

test("semantic module references retain exact literal content spans", () => {
  const source = 'import {value} from "./a\\\"b.vel"\nprint(value)\n';
  const result = compileCore(source, { analysis: { imports: new Map([
    ["value", { kind: "number" }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.moduleReferences.length, 1);
  const reference = result.semanticIndex.moduleReferences[0]!;
  assert.equal(reference.source, './a"b.vel');
  assert.equal(source.slice(reference.span.start, reference.span.end), './a\\"b.vel');
});

test("semantic type references come from the type AST instead of display text", () => {
  const source = `type User:
    name: string

type Profile = User
type Handler = (User: string, current: (User), values: List<User>) -> User
`;
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  const references = result.semanticIndex.references.filter((reference) => reference.name === "User");
  assert.equal(references.length, 4);
  assert.ok(references.every((reference) => source.slice(reference.span.start, reference.span.end) === "User"));
  assert.ok(!references.some((reference) => reference.span.start === source.indexOf("(User: string") + 1));
  const profile = result.semanticIndex.symbols.find((symbol) => symbol.name === "Profile");
  assert.equal(profile?.type, "User");
  assert.equal(profile?.typeTarget, "User");
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "Handler")?.typeTarget, undefined);
});

test("project member navigation follows explicit type-alias targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-alias-navigation-"));
  const modelsPath = join(directory, "models.vel");
  const mainPath = join(directory, "main.vel");
  const modelsSource = `export type User:
    name: string

export type Profile = User
`;
  const mainSource = `import {Profile} from "./models.vel"
const profile: Profile = {name: "Ada"}
print(profile.name)
`;
  await writeFile(modelsPath, modelsSource, "utf8");
  await writeFile(mainPath, mainSource, "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const memberOffset = mainSource.indexOf("profile.name") + "profile.".length;
  const fieldOffset = modelsSource.indexOf("name: string");
  assert.deepEqual(projectDefinitionAt(project, mainPath, memberOffset + 1), {
    path: modelsPath,
    span: { start: fieldOffset, end: fieldOffset + "name".length },
  });
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
    label: "greet(user: User) -> string",
    activeParameter: 0,
  });
  const ordinaryCompletions = projectCompletionsAt(project, mainPath, mainSource.indexOf("const label"));
  assert.ok(ordinaryCompletions.some((item) => item.label === "Person" && item.kind === "import" && item.detail === "Person"));
  assert.ok(ordinaryCompletions.some((item) => item.label === "greet" && item.kind === "import" && /\(user: Person\) -> string/u.test(item.detail)));
  assert.ok(ordinaryCompletions.some((item) => item.label === "ada" && item.kind === "variable" && item.detail === "Person"));
  assert.ok(!ordinaryCompletions.some((item) => item.label === "label"), "the binding being declared must not complete itself");
  assert.deepEqual(projectCompletionsAt(project, mainPath, personUse + "Person.".length), [
    { label: "parse", detail: "(value: unknown) -> User", kind: "method" },
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
  const parsedExpression = projectExpressionAt(project, mainPath, parsedMember + 1);
  assert.equal(parsedExpression?.type, "string");
  assert.equal(parsedExpression?.memberName, "name");
  assert.equal(parsedExpression?.ownerType, "Person");
  assert.ok(parsedExpression?.members.some((member) => member.name === "size" && member.kind === "field" && member.type === "number"));
  assert.ok(parsedExpression?.members.some((member) => member.name === "trim" && member.kind === "method" && member.type === "() -> string"));
  assert.ok(parsedExpression?.members.some((member) => member.name === "slice" && member.kind === "method"));
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
    label: "slice(start: number = default, end: number = default) -> List<number>",
    activeParameter: 1,
  });
  assert.equal(projectExpressionAt(project, mainPath, mainSource.indexOf(".slice") + 2)?.type,
    "(start: number = default, end: number = default) -> List<number>");
  assert.equal(projectExpressionAt(project, mainPath, mainSource.indexOf(".slice") + 2)?.callable, true);
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
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] }), "utf8");
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

test("project sessions invalidate safe JavaScript imports when declaration graphs change", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-session-dts-"));
  const packageRoot = join(directory, "node_modules", "session-sdk");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "session-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const value = 'ready'\n", "utf8");
  const declarationPath = join(packageRoot, "index.d.ts");
  await writeFile(declarationPath, "export declare const value: string;\n", "utf8");
  const resolvedDeclarationPath = await realpath(declarationPath);
  const mainPath = join(directory, "main.vel");
  const otherPath = join(directory, "other.vel");
  await writeFile(mainPath, "import js {value} from \"session-sdk\"\nconst label: string = value\n", "utf8");
  await writeFile(otherPath, "export const untouched = 1\n", "utf8");

  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  assert.deepEqual(first.project.failures, []);
  assert.deepEqual(first.project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(first.project.externalTypeDependencies.get(resolvedDeclarationPath)?.has(mainPath), true);
  const firstOther = first.project.modules.find((module) => module.inputPath === otherPath)?.result;

  await writeFile(declarationPath, "export declare const value: number;\n", "utf8");
  const changed = await sessions.snapshot(mainPath);
  assert.deepEqual([...changed.changedPaths], [resolvedDeclarationPath]);
  assert.ok(changed.project.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics
    .some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.equal(changed.project.modules.find((module) => module.inputPath === otherPath)?.result, firstOther);
  assert.equal(changed.project.stats.compiledModules, 1);
  assert.equal(changed.project.stats.reusedModules, 1);
});

test("project sessions surface invalid manifests instead of silently compiling standalone", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-session-config-"));
  const mainPath = join(directory, "main.vel");
  await writeFile(mainPath, "const value = 1\n", "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel", extensions: [] }), "utf8");
  await assert.rejects(new VelarProjectSessions().snapshot(mainPath), /unsupported formatVersion 1/u);
});

test("project sessions key reuse by the exact manifest identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-session-manifest-"));
  const mainPath = join(directory, "main.vel");
  const manifestPath = join(directory, "velar.json");
  const manifest = { formatVersion: 2, entry: "main.vel", outDir: "dist", extensions: [] };
  await writeFile(mainPath, "const value = 1\n", "utf8");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  const sessions = new VelarProjectSessions();
  const first = await sessions.snapshot(mainPath);
  const reused = await sessions.snapshot(mainPath);
  assert.equal(reused.project, first.project);

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const refreshed = await sessions.snapshot(mainPath);
  assert.notEqual(refreshed.project, first.project);
  assert.notEqual(refreshed.config.manifestIdentity, first.config.manifestIdentity);
  assert.equal(refreshed.project.stats.compiledModules, 1);
});

test("0.10 Web APIs have one versioned typed compiler/runtime contract", async () => {
  const api = standardModuleApi();
  assert.equal(api.standardVersion, "0.5");
  assert.equal(api.extensions["@velarscript/web"], "0.10");
  assert.deepEqual(api.modules["velar/app"], ["onError", "reportError"]);
  assert.deepEqual(api.modules["velar/config"], ["has", "keys", "publicConfig"]);
  assert.deepEqual(api.modules["velar/web"], ["Head", "Link", "NavLink", "RouteContext", "Router", "announce", "back", "currentRoute", "domId", "forward", "lazy", "navigate", "redirect", "reload", "route"]);
  assert.deepEqual(api.modules["velar/forms"], ["checkedValue", "clearError", "clearErrors", "errors", "fieldValue", "fieldValues", "focusFirstError", "numberValue", "read", "reset", "setError", "setPending", "textValue", "values"]);
  assert.deepEqual(api.modules["velar/http"], ["HttpAbortError", "HttpError", "formBody", "http"]);
  assert.deepEqual(api.modules["velar/storage"], ["database", "session", "storage"]);
  assert.deepEqual(api.modules["velar/browser"], ["after", "blur", "closeDialog", "copyText", "dialogResult", "environment", "every", "focus", "frame", "location", "measure", "media", "open", "readClipboardText", "scrollIntoView", "scrollTo", "showDialog", "watchMedia", "watchOnline", "watchVisibility"]);
  assert.deepEqual(api.modules["velar/files"], ["download", "pick", "readDataUrl", "readText"]);
  assert.deepEqual(api.modules["velar/realtime"], ["eventStream", "socket"]);
  assert.deepEqual(api.modules["velar/test"], ["expect"]);
  assert.deepEqual(api.modules["velar/web-test"], ["browser"]);
  const webRuntime = standardModuleSource("velar/web", { base: "/studio/" }) ?? "";
  assert.match(webRuntime, /const appBase = "\/studio\/"/u);
  assert.doesNotMatch(webRuntime, /__VELAR_WEB_BASE__/u);
  const routeContextExecution = executeModule(`${webRuntime}
import { runInNewContext } from "node:vm";
const params = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["id", "7"]])');
console.log(RouteContext.is({ path: "/items/7", params, query: new Map(), hash: "" }));
let getterReads = 0;
const accessor = Object.defineProperty({ params: new Map(), query: new Map(), hash: "" }, "path", { enumerable: true, get() { getterReads += 1; return "/"; } });
console.log(RouteContext.is(accessor));
console.log(RouteContext.is({ path: "/", params: new Map([["id", "x".repeat(2 * 1024 * 1024 + 1)]]), query: new Map(), hash: "" }));
console.log(getterReads);
`);
  assert.equal(routeContextExecution.status, 0, String(routeContextExecution.stderr));
  assert.equal(routeContextExecution.stdout, "true\nfalse\nfalse\n0\n");
  const configRuntime = standardModuleSource("velar/config", { base: "/", publicConfig: { apiBase: "https://api.example.com" } }) ?? "";
  assert.match(configRuntime, /const source = \{"apiBase":"https:\/\/api\.example\.com"\}/u);
  assert.doesNotMatch(configRuntime, /__VELAR_PUBLIC_CONFIG__/u);

  const directory = await mkdtemp(join(tmpdir(), "velar-web-api-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {Head, RouteContext, Router, Link, NavLink, announce, back, currentRoute, domId, forward, navigate, redirect, reload, route} from "velar/web"
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
    let form: Element? = null
    let dialog: DialogElement? = null
    const request = http.request("GET", "/api/items", {timeout: 100})
    const abortError = HttpAbortError("cancelled")
    const known = storage.has("items")
    const keys = storage.keys()
    const routeInfo = currentRoute()
    const browserInfo = browserLocation()
    const browserEnvironment = environment()
    const dark = media("(prefers-color-scheme: dark)")
    const headingId = domId("heading")

    def inspect():
        if form:
            const currentForm = form
            const typed = read(currentForm, FormDraft)
            const data = values(currentForm)
            const name = fieldValue(currentForm, "name")
            const title = textValue(currentForm, "name", "Untitled")
            const count = numberValue(currentForm, "count")
            const selected = checkedValue(currentForm, "selected")
            const labels = fieldValues(currentForm, "label")
            setError(currentForm, "name", "Required")
            const currentErrors = errors(currentForm)
            focusFirstError(currentForm)
            setPending(currentForm, true)
            setPending(currentForm, false)
            reset(currentForm)
            clearError(currentForm, "name")
            clearErrors(currentForm)
            const bounds = measure(currentForm)
            scrollIntoView(currentForm)
            focus(currentForm, true)
            blur(currentForm)
            announce("Checked")
        if dialog:
            const currentDialog = dialog
            showDialog(currentDialog)
            closeDialog(currentDialog, dialogResult(currentDialog))

    return <><Head title="API" description="Typed Web" canonical="https://example.com/" robots="index,follow" image="/share.png" themeColor="#111827" language="en-US" /><form host ref={form}><input name="name" /><input name="count" type="number" /><input name="selected" type="checkbox" /><input name="labels" /><select name="mode"><option value={FormMode.create}>Create</option></select></form><dialog ref={dialog}>Confirm</dialog><Router routes={[route("/", Missing), route("/items/:id", ItemPage)]} fallback={Missing} /></>

const link = <Link to="/items" replace={true}>Items</Link>
const navLink = <NavLink to="/items" exact={true}>Items</NavLink>
const settings = publicConfig(AppSettings)
const configured = hasConfig("apiBase")
const configuredKeys = configKeys()
const stopErrors = onError(report => print(report.error.message))
reportError(Error("reported"), "manual", "contract")
const local = storage.scope("app")
const stopStorage = local.watch("item", Item, (next, previous) => print(next?.name ?? "null"))
const cached = await database("app").get("item", Item)
const stopSession = session.watch("item", Item, (next, previous) => print(previous?.name ?? "null"))
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
if selected.size > 0:
    upload.file("primary", selected[0], "primary.txt")
const uploadNames = upload.names()
const hasUpload = upload.has("label")
upload.remove("unused")
const uploadRequest = http.post("/api/upload", {body: upload})
const nextFrame = await frame()
download("items.txt", "items")
const channel = socket("wss://example.com/socket", {message: value => print(value)})
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
  const webApiSource = await readFile(entry, "utf8");
  const domIdCall = webApiSource.indexOf('domId("heading")') + "domId(".length;
  assert.deepEqual(projectSignatureAt(project, entry, domIdCall), {
    label: "domId(prefix: string = default) -> string",
    activeParameter: 0,
  });
  const compiled = project.modules[0]?.result;
  assert.match(compiled?.code ?? "", /http\.request/u);
  assert.match(compiled?.code ?? "", /read\(currentForm, FormDraft, \[\{"name":"name","kind":"string","optional":false\}/u);
  assert.match(compiled?.code ?? "", /"name":"mode","kind":"enum","optional":false,"enumValues":\["create","update"\]/u);
  assert.equal(compiled?.semanticIndex.symbols.find((item) => item.name === "typed")?.type, "FormDraft");
});

test("the official Web package owns the framework contract and CLI only composes it", async () => {
  assert.equal(VELAR_WEB_API_VERSION, "0.10");
  assert.equal(velarWebFramework.name, "@velarscript/web");
  assert.deepEqual([...velarWebFramework.modules], [...VELAR_WEB_MODULES]);
  assert.deepEqual([...webModuleInterfaces.keys()].sort(), [...VELAR_WEB_MODULES].sort());
  assert.deepEqual([...webModuleSources.keys()].sort(), [...VELAR_WEB_MODULES].sort());
  for (const source of VELAR_WEB_MODULES) {
    assert.ok(webModuleInterfaces.has(source), `missing Web type contract for ${source}`);
    assert.ok(webModuleSource(source), `missing Web runtime for ${source}`);
  }
  assert.match(webModuleSource("velar/web", { base: "/framework/" }) ?? "", /const appBase = "\/framework\/"/u);
  assert.equal(webModuleSource("velar/collections"), null);

  const assertParameterNames = (type: Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>, path: string): void => {
    assert.equal(type.parameterNames?.length, type.parameters.length, `${path} must expose stable parameter names`);
    assert.ok(type.parameterNames?.every(Boolean), `${path} must not expose an empty parameter name`);
    for (const name of type.parameterNames ?? []) assert.ok(!unavailableOfficialParameterNames.has(name), `${path} parameter '${name}' must be writable at a call site`);
  };
  const assertNamedSurface = (type: ValueType, path: string): void => {
    if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") {
      assertParameterNames(type, path);
      assertNamedSurface(type.result, `${path} return`);
      return;
    }
    if (type.kind === "object") {
      for (const [name, field] of type.fields) assertNamedSurface(field, `${path}.${name}`);
      return;
    }
    if (type.kind === "promise") assertNamedSurface(type.value, `${path} value`);
    if (type.kind === "optional") assertNamedSurface(type.inner, `${path} value`);
    if (type.kind === "union") for (const member of type.members) assertNamedSurface(member, `${path} member`);
  };
  for (const [source, interface_] of webModuleInterfaces) {
    for (const [name, type] of interface_.exports) assertNamedSurface(type, `${source}.${name}`);
    for (const [name, info] of interface_.classes) {
      assert.equal(info.parameterNames?.length, info.parameters.length, `${source}.${name} constructor must expose stable parameter names`);
      assert.ok(info.parameterNames?.every(Boolean), `${source}.${name} constructor must not expose an empty parameter name`);
      for (const parameter of info.parameterNames ?? []) assert.ok(!unavailableOfficialParameterNames.has(parameter), `${source}.${name} constructor parameter '${parameter}' must be writable at a call site`);
    }
  }
  for (const [name, type] of velarCompilerExtension.analysis?.globals ?? []) {
    if ((type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") && !(type.parameters.length === 0 && type.rest)) {
      assertParameterNames(type, `Web global ${name}`);
    }
  }

  assert.equal(VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION, 1);
  assert.equal(velarFrameworkHost.id, "@velarscript/web");
  assert.equal(velarFrameworkHost.capability, "web");
  assert.equal(velarFrameworkHost.target, "browser");
  assert.equal(velarFrameworkHost.protocolVersion, VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION);
  assert.equal(velarFrameworkHost.apiVersion, VELAR_WEB_API_VERSION);
  assert.equal(velarFrameworkHost.browserTests?.sourceSuffix, ".browser.test.vel");

  const cliStandardModules = await readFile(resolve("packages/cli/src/standard-modules.ts"), "utf8");
  assert.doesNotMatch(cliStandardModules, /^\s*\["velar\/(?:app|config|web|forms|http|storage|browser|files|realtime|web-test)", String\.raw/gmu);
  assert.doesNotMatch(cliStandardModules, /^\s*\["velar\/(?:app|config|web|forms|http|storage|browser|files|realtime|web-test)", moduleInterface/gmu);
  assert.doesNotMatch(cliStandardModules, /@velarscript\/web/u);
  assert.match(cliStandardModules, /extension\.modules\?\.interfaces/u);
  assert.match(cliStandardModules, /extension\.modules\?\.sources/u);

  const [coreParser, coreAnalyzer, coreSemantic, coreIndex, coreEmitter, webCompiler, webParser, webAnalyzer, webSemantic, webInspection, webEmitter, webEditor] = await Promise.all([
    readFile(resolve("packages/compiler/src/parser.ts"), "utf8"),
    readFile(resolve("packages/compiler/src/analyzer.ts"), "utf8"),
    readFile(resolve("packages/compiler/src/semantic.ts"), "utf8"),
    readFile(resolve("packages/compiler/src/index.ts"), "utf8"),
    readFile(resolve("packages/compiler/src/emitter.ts"), "utf8"),
    readFile(resolve("packages/web/src/compiler.ts"), "utf8"),
    readFile(resolve("packages/web/src/parser.ts"), "utf8"),
    readFile(resolve("packages/web/src/analyzer.ts"), "utf8"),
    readFile(resolve("packages/web/src/semantic.ts"), "utf8"),
    readFile(resolve("packages/web/src/inspection.ts"), "utf8"),
    readFile(resolve("packages/web/src/emitter.ts"), "utf8"),
    readFile(resolve("packages/web/src/editor.ts"), "utf8"),
  ]);
  assert.doesNotMatch(coreParser, /parse(?:Component|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|Jsx)/u);
  assert.doesNotMatch(coreEmitter, /HTML(?:Canvas|Dialog|Input|Select|TextArea)Element|instanceof Element|instanceof (?:Keyboard|Pointer|Input)?Event/u);
  assert.doesNotMatch(coreAnalyzer, /analyzeComponent|inferJsx|case "(?:web\.|http\.|storage\.|forms\.|realtime\.|config\.)/u);
  assert.doesNotMatch(coreSemantic, /case "(?:ComponentDeclaration|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|JSXElementExpression)"/u);
  assert.doesNotMatch(coreIndex, /case "(?:ComponentDeclaration|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|JSXElementExpression)"/u);
  assert.doesNotMatch(coreEmitter, /case "(?:ComponentDeclaration|StateDeclaration|ComputedDeclaration|ResourceDeclaration|ActionDeclaration|WatchDeclaration|JSXElementExpression)"/u);
  assert.match(webParser, /class VelarWebParser extends Parser/u);
  assert.match(webAnalyzer, /class VelarWebAnalyzer extends Analyzer/u);
  assert.match(webAnalyzer, /function inferWebIntrinsic/u);
  assert.match(webSemantic, /velarWebSemanticExtension/u);
  assert.match(webInspection, /velarWebInspectionExtension/u);
  assert.match(webEmitter, /visitExtensionRuntimeExpression/u);
  assert.match(webEmitter, /visitExtensionRuntimeStatement/u);
  assert.match(webCompiler, /parser: Object\.freeze/u);
  assert.match(webCompiler, /analyzer: Object\.freeze/u);
  assert.match(webCompiler, /semantic: velarWebSemanticExtension/u);
  assert.match(webCompiler, /inspection: velarWebInspectionExtension/u);
  assert.match(webCompiler, /project: velarWebProjectEditorExtension/u);
  assert.match(webCompiler, /inferIntrinsic: inferWebIntrinsic/u);
  assert.match(webCompiler, /capabilities: Object\.freeze\(\["web"\]\)/u);
  assert.match(webEditor, /export const velarWebProjectEditorExtension/u);
  assert.match(webEditor, /nativeJsxTags/u);
  assert.match(webEditor, /nativeSvgTags/u);
  assert.match(webEditor, /The JSX children prop cannot be renamed/u);

  const [hostProtocol, webHost, ...cliFrameworkHostSources] = await Promise.all([
    readFile(resolve("packages/compiler/src/framework-host.ts"), "utf8"),
    readFile(resolve("packages/web/src/host.ts"), "utf8"),
    readFile(resolve("packages/cli/src/config.ts"), "utf8"),
    readFile(resolve("packages/cli/src/framework-host.ts"), "utf8"),
    readFile(resolve("packages/cli/src/module-assets.ts"), "utf8"),
    readFile(resolve("packages/cli/src/dev-server.ts"), "utf8"),
    readFile(resolve("packages/cli/src/production-build.ts"), "utf8"),
    readFile(resolve("packages/cli/src/browser-test-runner.ts"), "utf8"),
    readFile(resolve("packages/cli/src/project-semantic.ts"), "utf8"),
    readFile(resolve("packages/cli/src/package-manager.ts"), "utf8"),
    readFile(resolve("packages/cli/src/cli.ts"), "utf8"),
  ]);
  assert.doesNotMatch(hostProtocol, /<!doctype|EventSource|Content-Security-Policy|playwright|esbuild/u);
  assert.match(webHost, /export const velarFrameworkHost/u);
  assert.match(webHost, /Content-Security-Policy/u);
  assert.match(webHost, /new EventSource/u);
  assert.match(webHost, /createWebArtifacts/u);
  assert.match(webHost, /createWebErrorDocument/u);
  for (const source of cliFrameworkHostSources) assert.doesNotMatch(source, /@velarscript\/web/u);
  const cliFrameworkHost = cliFrameworkHostSources.join("\n");
  assert.match(cliFrameworkHost, /require\.resolve\(`\$\{name\}\/host`\)/u);
  assert.match(cliFrameworkHost, /VELAR_FRAMEWORK_HOST_PROTOCOL_VERSION/u);
  assert.match(cliFrameworkHost, /createFrameworkArtifacts/u);
  assert.doesNotMatch(cliFrameworkHost, /jsx-tag|component-attribute|native-attribute|The JSX children prop cannot be renamed|new EventSource|<!doctype html>/u);
  assert.doesNotMatch(cliFrameworkHost, /capabilities\?\.includes\("web"\)|capabilities\.has\("web"\)/u);

  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", capabilities: ["surface"] },
      { id: "example-two", capabilities: ["surface"] },
    ],
  }), /capability 'surface'.*more than one owner/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", analysis: { primitiveTypes: new Set(["Surface"]) } },
      { id: "example-two", analysis: { primitiveTypes: new Set(["Surface"]) } },
    ],
  }), /primitive 'Surface'.*more than one owner/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{
      id: "example-one",
      analysis: {
        primitiveTypes: new Set(["First", "Second"]),
        primitiveParents: new Map([["First", new Set(["Second"])], ["Second", new Set(["First"])]]),
      },
    }],
  }), /primitive inheritance contains a cycle/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", analysis: { primitiveTypes: new Set(["Surface"]) } },
      { id: "example-two", analysis: { primitiveMutableFields: new Map([["Surface", new Set(["value"])]]), primitiveTypes: new Set(["Control"]) } },
    ],
  }), /cannot make fields writable on primitive 'Surface' that it does not own/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [
      { id: "example-one", analysis: { globals: new Map([["surface", { kind: "number" }]]) } },
      { id: "example-two", analysis: { globals: new Map([["surface", { kind: "string" }]]) } },
    ],
  }), /global 'surface' has more than one owner/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{ id: "example-one", analysis: { globals: new Map([["print", { kind: "number" }]]) } }],
  }), /cannot replace reserved Core binding 'print'/u);
  assert.throws(() => compileCore("const value = 1\n", {
    extensions: [{ id: "example-one", analysis: { primitiveTypes: new Set(["string"]) } }],
  }), /cannot replace Core primitive 'string'/u);
});

test("fixed Web APIs share the language named-argument ABI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-named-web-api-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {publicConfig} from "velar/config"
import {route, navigate} from "velar/web"
import {http, HttpAbortError, HttpError} from "velar/http"
import {storage, database} from "velar/storage"
import {textValue} from "velar/forms"
import {scrollTo} from "velar/browser"
import {socket} from "velar/realtime"

type User:
    name: string

type BinaryPayload:
    data: Blob

component Page:
    return <main>Page</main>

def markText(label: string, value: string) -> string:
    return value

def markNumber(label: string, value: number) -> number:
    return value

def readName(form: Element) -> string:
    return textValue(fallback="", name="name", form=form)

def canvasContext(canvas: CanvasElement) -> unknown:
    return canvas.getContext(kind="2d")

def useElement(element: Element):
    element.focus()

def usePrimitiveSubtypes(input: InputElement, keyboard: KeyboardEvent):
    useElement(input)
    const event: Event = keyboard

async def prepare():
    const config = publicConfig(target=User)
    const itemRoute = route(view=Page, path="/items")
    navigate(options={scroll: false}, to=itemRoute.path)
    const request = http.get(options={timeout: markNumber("options", 10)}, url=markText("url", "/api/items"))
    const binary: Blob = await request.blob()
    const payload: BinaryPayload = {data: binary}
    const checked = BinaryPayload.parse(payload)
    const upload = http.post(url="/api/copy", options={body: binary})
    const loaded: User? = storage.get(target=User, key="current")
    const fallback: User = storage.get(fallback={name: "Ada"}, target=User, key="fallback")
    storage.set(value=fallback, key="current")
    const records = database(name="users")
    const pending: Promise<User?> = records.get(target=User, key="current")
    scrollTo(behavior="smooth", y=20, x=10)
    const channel = socket(handlers={}, url="wss://example.com/events")
    channel.send(data="ping")
    channel.sendJson(data={name: loaded?.name ?? config.name})
    channel.close(reason="done", code=1000)
    const aborted = HttpAbortError(reason="cancelled")
    const failed = HttpError(body=null, url="/api/items", status=500, message=aborted.message)
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.deepEqual(diagnostics, []);
  const code = project.modules[0]?.result.code ?? "";
  assert.ok(code.indexOf('markNumber("options", 10)') < code.indexOf('markText("url", "/api/items")'), code);
  const symbols = project.modules[0]?.result.semanticIndex.symbols ?? [];
  assert.match(symbols.find((symbol) => symbol.name === "itemRoute")?.type ?? "", /component: component Page/u);
  assert.match(symbols.find((symbol) => symbol.name === "request")?.type ?? "", /blob: \(\) -> Promise<Blob>/u);
  assert.match(code, /typeof Blob !== "undefined".*instanceof Blob/u);
  assert.doesNotMatch(code, /Blob\.is/u);

  const invalidPath = join(directory, "invalid.vel");
  await writeFile(invalidPath, `
import {http} from "velar/http"
import {scrollTo} from "velar/browser"

http.get(path="/items")
scrollTo(left=10, top=20)
mount(<main>invalid</main>, 42)

async def inspectBlob():
    const binary = await http.get("/data").blob()
    print(binary.size)

const forged: Blob = {}
const forgedElement: Element = {focus: () => null, remove: () => null}

def inspectCanvas(canvas: CanvasElement):
    canvas.getContext(kind="2d").fillRect(0, 0, 1, 1)
`.trimStart(), "utf8");
  const invalid = await compileProject(invalidPath);
  const messages = invalid.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message).join("\n");
  assert.match(messages, /Unknown named argument 'path'/u);
  assert.match(messages, /Unknown named argument 'left'/u);
  assert.match(messages, /Unknown named argument 'top'/u);
  assert.match(messages, /Cannot assign number to string \| Element/u);
  assert.match(messages, /Type 'Blob' has no field 'size'/u);
  assert.match(messages, /Cannot assign \{\s*\} to Blob/u);
  assert.match(messages, /Cannot assign .* to Element/u);
  assert.match(messages, /Cannot access 'fillRect' on unknown without validation/u);
});

test("Web host values are opaque and expose only intentional writable fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-opaque-web-values-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {pick, readText} from "velar/files"

type Attachment:
    file: File

async def inspect():
    const selected = await pick()
    if selected.size > 0:
        const file = selected[0]
        print(file.name)
        print(file.size)
        await readText(file)
        const checked = Attachment.parse({file: file})

def edit(input: InputElement, canvas: CanvasElement):
    input.value = "ready"
    input.checked = true
    canvas.width = 640
    canvas.height = 480
`.trimStart(), "utf8");
  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const valid = project.modules[0]!.result;
  assert.match(valid.semanticIndex.symbols.find((symbol) => symbol.name === "selected")?.type ?? "", /List<File>/u);
  assert.match(valid.code ?? "", /function __velarFileTypeIs/u);
  assert.match(valid.code ?? "", /WeakMap\.prototype\.has\.call/u);

  const forgedRuntime = compile(`
type Attachment:
    file: File

const forged = Attachment.parse({file: {name: "fake.txt", size: 1, type: "text/plain", modified: 0}})
`.trimStart());
  assert.deepEqual(forgedRuntime.diagnostics, []);
  const execution = executeModule(forgedRuntime.code ?? "");
  assert.notEqual(execution.status, 0);
  assert.match(String(execution.stderr), /Value does not match Attachment/u);

  const invalid = compile(`
const forged: File = {name: "fake.txt", size: 1, type: "text/plain", modified: 0}

def overwrite(file: File, event: KeyboardEvent, element: Element, input: InputElement):
    file.name = "changed.txt"
    event.key = "Enter"
    element.focus = () => null
    input.remove = () => null
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Cannot assign .* to File/u);
  assert.match(messages, /Cannot assign to read-only member 'name'/u);
  assert.match(messages, /Cannot assign to read-only member 'key'/u);
  assert.match(messages, /Cannot assign to read-only member 'focus'/u);
  assert.match(messages, /Cannot assign to read-only member 'remove'/u);
});

test("velar/web creates bounded application-local DOM IDs without requiring cryptographic UUIDs", async () => {
  const source = webModuleSource("velar/web") ?? "";
  const url = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
  const runtime = await import(url) as { domId(prefix?: string): string };
  assert.equal(runtime.domId(), "velar-1");
  assert.equal(runtime.domId("dialog-title"), "dialog-title-2");
  assert.throws(() => runtime.domId("bad prefix"), /DOM ID prefixes/u);
  assert.throws(() => runtime.domId("x".repeat(65)), /cannot exceed 64/u);
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
    "render:router:A VelarScript Router target must render a component",
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
  () => Head({ title: "Title", language: "not a tag!" }),
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
  assert.equal(execution.stdout, `${new Array(15).fill("TypeError").join(",")}\n0:0:0:0\n`);
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

test("form numbers use strict decimal text and pending state preserves bool controls", () => {
  const source = standardModuleSource("velar/forms") ?? "";
  const execution = executeModule(`
let current = "";
let formMutations = 0;
globalThis.HTMLFormElement = class {
  constructor() { this.elements = []; }
  setAttribute() { formMutations += 1; }
  removeAttribute() { formMutations += 1; }
  querySelectorAll() { return []; }
};
globalThis.FormData = class {
  get() { return current; }
  getAll() { return [current]; }
  has() { return false; }
};
${source}
const form = new HTMLFormElement();
for (const text of ["42", " .5 ", "1.", "1e3", "+2", "0x10", "Infinity", "1_0", "   "]) {
  current = text;
  console.log(numberValue(form, "amount"));
}
const Amount = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
current = "0x10";
try { read(form, Amount, [{ name: "amount", kind: "number", optional: false, enumValues: null }]); console.log("accepted"); }
catch (error) { console.log(error.name); }
let coercions = 0;
form.elements = [{ disabled: { valueOf() { coercions += 1; return false; } } }];
try { setPending(form, true); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(coercions + ":" + formMutations);
let controlLengthReads = 0;
let disabledReads = 0;
let disabledWrites = 0;
const field = Object.defineProperty({}, "disabled", {
  get() { disabledReads += 1; return disabledReads === 1 ? false : "changed"; },
  set() { disabledWrites += 1; },
});
form.elements = Object.defineProperty({ 0: field }, "length", { get() { controlLengthReads += 1; return controlLengthReads === 1 ? 1 : 100001; } });
setPending(form, true);
setPending(form, false);
console.log([controlLengthReads, disabledReads, disabledWrites, formMutations].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "42\n0.5\n1\n1000\n2\nnull\nnull\nnull\nnull\nTypeError\nTypeError\n0:0\n1:1:2:2\n");
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
  class FakeElement {
    scrollIntoView(options) { calls.push("prototype-scroll:" + options.behavior); }
    getBoundingClientRect() { calls.push("prototype-measure"); return { x: 0, y: 0, width: 10, height: 20, top: 0, right: 10, bottom: 20, left: 0 }; }
  }
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
element.scrollIntoView = () => calls.push("instance-scroll");
element.getBoundingClientRect = () => { calls.push("instance-measure"); return {}; };
focus(element, true);
blur(element);
scrollIntoView(element, "smooth");
console.log(measure(element).width);
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
  assert.equal(execution.stdout, "10\nprototype-focus:true,prototype-blur,prototype-scroll:smooth,prototype-measure\nTypeError,TypeError,TypeError\n");
});

test("clipboard and dialog helpers snapshot hosts and bypass instance overrides", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
const calls = [];
class FakeClipboard {
  async writeText(value) { calls.push("prototype-write:" + value); }
  async readText() { calls.push("prototype-read"); return "ready"; }
}
class FakeDialog {
  showModal() { calls.push("prototype-show"); this.open = true; }
  close(value) { calls.push("prototype-close:" + value); this.open = false; }
}
globalThis.Clipboard = FakeClipboard;
globalThis.HTMLDialogElement = FakeDialog;
let secureReads = 0;
Object.defineProperty(globalThis, "isSecureContext", { configurable: true, get() { secureReads += 1; return secureReads === 1; } });
const clipboardValue = new FakeClipboard();
let clipboardReads = 0;
const navigatorValue = {};
Object.defineProperty(navigatorValue, "clipboard", { get() { clipboardReads += 1; return clipboardReads === 1 ? clipboardValue : null; } });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
${source}
clipboardValue.writeText = () => calls.push("instance-write");
await copyText("Velar");
let openState = false;
let openReads = 0;
let connectedReads = 0;
const dialog = new FakeDialog();
Object.defineProperty(dialog, "isConnected", { get() { connectedReads += 1; return true; } });
Object.defineProperty(dialog, "open", {
  get() { openReads += 1; return openState; },
  set(value) { openState = value; },
});
dialog.showModal = () => calls.push("instance-show");
dialog.close = () => calls.push("instance-close");
showDialog(dialog);
closeDialog(dialog, "done");
console.log(calls.join(","));
console.log([secureReads, clipboardReads, connectedReads, openReads, openState].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "prototype-write:Velar,prototype-show,prototype-close:done\n1:1:1:2:false\n");
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

test("browser and router snapshots reject host coercion and accessor values", () => {
  const browserSource = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`
let coercions = 0;
let getterReads = 0;
const hostile = { toString() { coercions += 1; return ""; } };
const navigatorValue = { language: "en", languages: ["en"], onLine: true, maxTouchPoints: 0 };
const locationValue = { href: "https://example.test/", origin: "https://example.test", pathname: "/", search: hostile, hash: "" };
globalThis.document = { visibilityState: "visible" };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
Object.defineProperty(globalThis, "location", { configurable: true, value: locationValue });
globalThis.matchMedia = () => ({ matches: false });
${browserSource}
const failures = [];
try { location(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
locationValue.search = "";
const accessorLanguages = [];
Object.defineProperty(accessorLanguages, 0, { enumerable: true, configurable: true, get() { getterReads += 1; return "en"; } });
accessorLanguages.length = 1;
navigatorValue.languages = accessorLanguages;
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
navigatorValue.languages = ["en"];
navigatorValue.onLine = "yes";
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
navigatorValue.onLine = true;
globalThis.matchMedia = () => ({ matches: "yes" });
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
globalThis.matchMedia = () => ({ matches: false });
navigatorValue.maxTouchPoints = Number.NaN;
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
navigatorValue.maxTouchPoints = 0;
document.visibilityState = "unknown";
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
document.visibilityState = "visible";
navigatorValue.languages = ["en"];
let navigatorReads = 0;
let onlineReads = 0;
let visibilityReads = 0;
let touchReads = 0;
Object.defineProperty(navigatorValue, "onLine", { configurable: true, get() { onlineReads += 1; return onlineReads === 1 ? true : "changed"; } });
Object.defineProperty(navigatorValue, "maxTouchPoints", { configurable: true, get() { touchReads += 1; return touchReads === 1 ? 0 : Number.NaN; } });
Object.defineProperty(document, "visibilityState", { configurable: true, get() { visibilityReads += 1; return visibilityReads === 1 ? "visible" : "unknown"; } });
Object.defineProperty(globalThis, "navigator", { configurable: true, get() { navigatorReads += 1; return navigatorValue; } });
const snapshot = environment();
snapshot.languages.push("fr");
console.log(failures.join(","));
console.log(coercions + ":" + getterReads);
console.log(Object.isFrozen(snapshot) + ":" + Object.isFrozen(snapshot.languages) + ":" + snapshot.languages.join(","));
console.log([navigatorReads, onlineReads, visibilityReads, touchReads, snapshot.online, snapshot.visible].join(":"));
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "TypeError,TypeError,TypeError,TypeError,RangeError,TypeError\n0:0\ntrue:false:en,fr\n1:1:1:1:true:true\n");

  const webSource = standardModuleSource("velar/web") ?? "";
  const routerExecution = executeModule(`
let coercions = 0;
const hostile = { toString() { coercions += 1; return ""; } };
class FakeNode { replaceChildren() {} }
globalThis.Node = FakeNode;
globalThis.document = { createElement() { return new FakeNode(); } };
globalThis.location = { pathname: "/", search: hostile, hash: "" };
${webSource}
for (const field of ["search", "hash"]) {
  location.search = field === "search" ? hostile : "";
  location.hash = field === "hash" ? hostile : "";
  try { Router({ routes: [] }); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(coercions);
`);
  assert.equal(routerExecution.status, 0, String(routerExecution.stderr));
  assert.equal(routerExecution.stdout, "TypeError\nTypeError\n0\n");
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

  const accessorRegistry = executeModule(`
Object.defineProperty(globalThis, Symbol.for("velar.file.registry.v1"), {
  get() { console.log("accessor invoked"); return new WeakMap(); },
});
${source}
`);
  assert.notEqual(accessorRegistry.status, 0);
  assert.equal(accessorRegistry.stdout, "");
  assert.match(String(accessorRegistry.stderr), /VelarScript file registry cannot be an accessor/u);
});

test("file reads enforce explicit byte budgets before allocating browser readers", () => {
  const source = standardModuleSource("velar/files") ?? "";
  const execution = executeModule(`
let textReads = 0;
let readerCalls = 0;
let blobCalls = 0;
const listeners = new Map();
const fileState = new WeakMap();
const fileListState = new WeakMap();
class FakeBlob {
  constructor(parts = null) { if (parts !== null) blobCalls += 1; }
  get size() { return fileState.get(this).size; }
  get type() { return fileState.get(this).type; }
  text() { textReads += 1; return Promise.resolve(fileState.get(this).text); }
}
class FakeFile extends FakeBlob {
  constructor(fields) { super(); fileState.set(this, fields); }
  get name() { return fileState.get(this).name; }
  get lastModified() { return fileState.get(this).lastModified; }
}
class FakeFileList {
  constructor(files) { fileListState.set(this, files); }
  get length() { return fileListState.get(this).length; }
  item(index) { return fileListState.get(this)[index] ?? null; }
}
globalThis.Blob = FakeBlob;
globalThis.File = FakeFile;
globalThis.FileList = FakeFileList;
const selected = new FakeFile({ name: "large.txt", size: 16 * 1024 * 1024 + 1, type: "text/plain", lastModified: 0, text: "data" });
const input = {
  files: new FakeFileList([selected]),
  addEventListener(name, listener) { listeners.set(name, listener); },
  remove() {},
  click() { listeners.get("change")(); },
};
globalThis.document = { createElement() { return input; }, body: { append() {} } };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.FileReader = class { constructor() { readerCalls += 1; } };
globalThis.URL = { createObjectURL() { return "blob:test"; } };
const hostileFileRegistry = new WeakMap();
hostileFileRegistry.get = () => { throw new Error("instance get must not run"); };
hostileFileRegistry.set = () => { throw new Error("instance set must not run"); };
Object.defineProperty(globalThis, Symbol.for("velar.file.registry.v1"), { value: hostileFileRegistry });
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
let removals = 0;
let fileListLengthReads = 0;
let fileListIndexReads = 0;
const fileState = new WeakMap();
const fileListState = new WeakMap();
class FakeBlob {
  get size() { return fileState.get(this).size; }
  get type() { return fileState.get(this).type; }
  text() { return Promise.resolve(fileState.get(this).text); }
}
class FakeFile extends FakeBlob {
  constructor(fields) { super(); fileState.set(this, fields); }
  get name() { return fileState.get(this).name; }
  get lastModified() { return fileState.get(this).lastModified; }
}
class FakeFileList {
  constructor(files) { fileListState.set(this, files); }
  get length() { fileListLengthReads += 1; return fileListState.get(this).length; }
  item(index) { return fileListState.get(this)[index] ?? null; }
}
globalThis.Blob = FakeBlob;
globalThis.File = FakeFile;
globalThis.FileList = FakeFileList;
let selectedFile = new FakeFile({ name: "invalid.txt", size: Number.NaN, type: "text/plain", lastModified: 0, text: "" });
let selectedFiles = new FakeFileList([selectedFile]);
globalThis.document = {
  createElement() {
    const listeners = new Map();
    return {
      get files() { return selectedFiles; },
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
selectedFile = new FakeFile({ name: "valid.txt", size: 1, type: "text/plain", lastModified: 0, text: "xx" });
selectedFiles = null;
try { await pick(); console.log("accepted"); } catch (error) { console.log(error.name); }
selectedFiles = new FakeFileList([selectedFile]);
Object.defineProperty(selectedFiles, "0", { get() { fileListIndexReads += 1; throw new Error("Indexed FileList access must not run"); } });
const [file] = await pick();
try { await readText(file, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
try { await readDataUrl(file, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(removals, fileListLengthReads, fileListIndexReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nTypeError\nRangeError\nRangeError\n3 2 0\n");
});

test("realtime validates handlers, payloads, and close metadata before native effects", () => {
  const source = standardModuleSource("velar/realtime") ?? "";
  const execution = executeModule(`
let getterReads = 0;
let constructed = 0;
let sent = 0;
let closed = 0;
let encodedCloseReasons = 0;
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
globalThis.TextEncoder = class { encode() { encodedCloseReasons += 1; return new Uint8Array(); } };
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
console.log([getterReads, constructed, sent, closed, encodedCloseReasons].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,TypeError,RangeError,RangeError\n0:1:0:0:0\n");
});

test("realtime validates resolved URLs, states, and inbound close metadata", () => {
  const source = standardModuleSource("velar/realtime") ?? "";
  const execution = executeModule(`
let coercions = 0;
let resolvedUrl = { toString() { coercions += 1; return "wss://coerced.test"; } };
let socketValue;
let streamValue;
let invalidCloses = 0;
let receivedClose = "";
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.detail + ":" + error.name); } };
class FakeSocket {
  constructor() { this.url = resolvedUrl; this.readyState = 1; this.listeners = new Map(); socketValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  send() {}
  close() { invalidCloses += 1; this.readyState = 3; }
}
class FakeEventSource {
  constructor() { this.url = resolvedUrl; this.readyState = 1; this.listeners = new Map(); streamValue = this; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  close() { invalidCloses += 1; this.readyState = 2; }
}
globalThis.WebSocket = FakeSocket;
globalThis.EventSource = FakeEventSource;
${source}
for (const operation of [() => socket("wss://example.test"), () => eventStream("https://example.test")]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
resolvedUrl = "wss://example.test";
const channel = socket("wss://example.test", { close(code, reason) { receivedClose = code + ":" + reason; } });
let readyStateReads = 0;
Object.defineProperty(socketValue, "readyState", { configurable: true, get() { readyStateReads += 1; return readyStateReads === 1 ? 1 : 4; } });
console.log(channel.state(), readyStateReads);
Object.defineProperty(socketValue, "readyState", { configurable: true, writable: true, value: 4 });
socketValue.readyState = 4;
try { channel.state(); console.log("accepted"); } catch (error) { console.log(error.name); }
socketValue.readyState = 3;
socketValue.listeners.get("close")({ code: 1000, reason: 0 });
let closeCodeReads = 0;
let closeReasonReads = 0;
socketValue.listeners.get("close")({
  get code() { closeCodeReads += 1; return closeCodeReads === 1 ? 1000 : 70000; },
  get reason() { closeReasonReads += 1; return closeReasonReads === 1 ? "done" : 0; },
});
console.log(receivedClose, closeCodeReads, closeReasonReads);
resolvedUrl = "https://example.test";
const stream = eventStream("https://example.test");
streamValue.readyState = 2;
console.log(stream.state());
streamValue.readyState = 3;
try { stream.state(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(reports.join("|"));
console.log(coercions + ":" + invalidCloses);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nTypeError\nopen 1\nTypeError\n1000:done 1 1\nclosed\nTypeError\nsocket:close:TypeError\n0:2\n");
});

test("realtime closes oversized inbound messages and rejects oversized sends", () => {
  const source = standardModuleSource("velar/realtime") ?? "";
  const execution = executeModule(`
let socketValue;
let streamValue;
let sent = 0;
let socketClosed = "";
let streamClosed = 0;
let socketDataReads = 0;
let streamDataReads = 0;
let streamIdReads = 0;
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
socketValue.listeners.get("message")({ get data() { socketDataReads += 1; return socketDataReads === 1 ? tooLarge : "small"; } });
let streamErrors = 0;
const stream = eventStream("https://example.test", { error() { streamErrors += 1; } });
streamValue.listeners.get("message")({
  get data() { streamDataReads += 1; return streamDataReads === 1 ? tooLarge : "small"; },
  get lastEventId() { streamIdReads += 1; return ""; },
});
const metadataStream = eventStream("https://example.test", { error() { streamErrors += 1; } });
streamValue.listeners.get("message")({
  get data() { streamDataReads += 1; return "small"; },
  get lastEventId() { streamIdReads += 1; return streamIdReads === 2 ? "x".repeat(65537) : ""; },
});
console.log([sent, socketErrors, socketMessages, socketClosed, streamErrors, streamClosed].join("|"));
console.log([socketDataReads, streamDataReads, streamIdReads].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\n0|1|0|1009:Message too large|2|2\n1:2:2\n");
});

test("browser npm assets cannot escape a package through symbolic links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-npm-asset-"));
  const root = join(directory, "package");
  await mkdir(root);
  await writeFile(join(root, "inside.js"), "export const safe = true\n", "utf8");
  await writeFile(join(directory, "outside.js"), "export const escaped = true\n", "utf8");
  await symlink(join(root, "inside.js"), join(root, "inside-link.js"));
  await symlink(join(directory, "outside.js"), join(root, "outside-link.js"));
  const packages = [{ name: "package", root, route: "/@npm/package/", serveRoot: root }];
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

test("List index failures never coerce hostile dynamic values", () => {
  const result = compileCore(`
import js {hostile, reads} from "fixture"

let values = [1]
try:
    print(values[hostile])
catch error:
    print(error.name)
try:
    values[hostile] = 2
catch error:
    print(error.name)
print(reads())
`.trimStart(), { analysis: { imports: new Map<string, ValueType>([
    ["hostile", { kind: "any" }],
    ["reads", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "number" } }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  const executable = (result.code ?? "").replace(/import .*?;\n+/u, `
let coercions = 0;
const hostile = { [Symbol.toPrimitive]() { coercions += 1; return 0; } };
const reads = () => coercions;
`);
  const execution = executeModule(executable);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "IndexError\nIndexError\n0\n");
});

test("0.10 Web APIs reject invalid typed boundaries before browser execution", async () => {
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
    let dialog: DialogElement? = null
    let form: Element? = null
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
const invalidAfter = after("soon", () => null)
const invalidEvery = every(1, 42)
focus("missing")
blur("missing")
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message).join("\n");
  assert.match(messages, /Runtime parsing requires a VelarScript runtime type/u);
  assert.match(messages, /Cannot assign string to number/u);
  assert.equal(messages.match(/Cannot assign \{ name: string \} to File/gu)?.length, 2);
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
  assert.match(messages, /Cannot assign \(value: number\) -> null to \(\(string\) -> unknown\)\?/u);
  assert.match(messages, /Runtime parsing requires a VelarScript runtime type/u);
  assert.match(messages, /Cannot assign.*number.*error.*Error/u);
  assert.match(messages, /Cannot assign string to Error/u);
  assert.match(messages, /Cannot assign number to string/u);
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
    let form: Element? = null
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

test("0.5 Core standard library combines typed ergonomics with explicit platform boundaries", async () => {
  const api = standardModuleApi();
  assert.deepEqual(Object.keys(api.modules), [
    "velar/collections", "velar/text", "velar/math", "velar/json", "velar/async", "velar/url", "velar/time", "velar/id", "velar/log",
    "velar/serve", "velar/fs", "velar/env", "velar/host", "velar/test", "velar/app", "velar/config", "velar/web", "velar/http", "velar/storage", "velar/forms", "velar/browser", "velar/files", "velar/realtime", "velar/web-test",
  ]);
  assert.equal(Object.values(api.modules).reduce((total, exports_) => total + exports_.length, 0), 201);
  assert.equal(Object.values(api.modules).slice(0, 9).reduce((total, exports_) => total + exports_.length, 0), 117);
  assert.equal(api.modules["velar/collections"]?.length, 28);
  assert.equal(api.modules["velar/text"]?.length, 18);
  assert.equal(api.modules["velar/math"]?.length, 32);
  assert.deepEqual(api.modules["velar/json"], ["clone", "deepEqual", "isSerializable", "parse", "stableStringify", "stringify", "tryParse"]);
  assert.deepEqual(api.modules["velar/async"], ["all", "map", "race", "retry", "series", "sleep", "timeout"]);
  assert.deepEqual(api.modules["velar/url"], ["decode", "encode", "isExternal", "join", "normalize", "parse", "parseQuery", "query", "withHash", "withQuery"]);
  assert.deepEqual(api.modules["velar/time"], ["date", "format", "iso", "monotonic", "now", "parse", "parts", "utc"]);
  assert.deepEqual(api.modules["velar/id"], ["isUuid", "uuid"]);
  assert.deepEqual(api.modules["velar/log"], ["level", "log", "logger", "setLevel", "useSink"]);
  assert.deepEqual(api.modules["velar/serve"], ["ServeRequest", "ServeResponse", "Server", "fileResponse", "serve"]);
  assert.deepEqual(api.modules["velar/fs"], ["Blob", "exists", "list", "readBlob", "readText", "writeText"]);
  assert.deepEqual(api.modules["velar/env"], ["get", "require"]);
  assert.deepEqual(api.modules["velar/host"], ["exit", "onShutdown"]);

  const directory = await mkdtemp(join(tmpdir(), "velar-standard-library-"));
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {chunk, compact, enumerate, every, find, flatten, groupBy, join as joinItems, partition, range, repeat as repeatValue, sortBy, sum, unique, zip} from "velar/collections"
import {capitalize, escapeHtml, findMatch, findMatches, isBlank, lines, matches, normalizeWhitespace, replaceMatches, slug, splitPattern, title, truncate, words} from "velar/text"
import {clamp, degrees, gcd, lcm, max as maxNumber, min as minNumber, pi, radians} from "velar/math"
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
const maybe: List<string?> = ["a", null, "b"]
print(sum(values))
print(indexed[0].index)
print(pairs[0].second)
print(grouped.get("admin")?.size ?? 0)
print(ordered[0].name)
print(splitUsers.rest.size)
print(found?.name ?? "missing")
print(joinItems(compact(maybe), ","))
print(flatten(chunk(values, 2)).size)
print(unique([1, 1, 2]).size)
print(every(values, value => value > 0))

print(capitalize("vELAR"))
print(title("next_generation web"))
print(slug("  Velar Web 游戏  "))
print(truncate("VelarScript", 6))
print(normalizeWhitespace("  a   b  "))
print(lines("a\\nb").size)
print(words("a  b").size)
print("ABC".lower())
print("abc".upper())
print(isBlank("   "))
print(escapeHtml("<velar>"))
print(matches("Velar 42", "^velar [0-9]+$", {ignoreCase: true}))
const firstPatternMatch = findMatch("ticket-42", "[0-9]+")
print(firstPatternMatch?.value ?? "missing")
print(firstPatternMatch?.index ?? -1)
const patternMatches = findMatches("a1 b22", "([a-z])([0-9]+)")
print(patternMatches.size)
print(patternMatches[1].groups[1] ?? "missing")
print(replaceMatches("a1 b22", "[0-9]+", "#"))
print(joinItems(splitPattern("a, b; c", " *[,;] *"), "|"))
print(matches("first\\nlast", "^last$", {multiline: true}))
print(matches("a\\nb", "^a.b$", {dotAll: true}))
const optionalPatternMatch = findMatch("b", "(a)?b")
print(optionalPatternMatch?.groups?.[0] ?? "null")
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

print(pi.toFixed(2))
print(clamp(12, 0, 10))
print(minNumber(4, 2, 8))
print(maxNumber(4, 2, 8))
print(degrees(radians(90)).round())
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
print(waited.size)
print(retried)
print(serial.size)

const info = parseUrl("/items?page=1", "https://example.com/app/")
print(info.path)
print(parseQuery("?page=2").get("page") ?? "null")
print(query({page: 3}))
print(withQuery("/items", {page: 4}))
print(withHash("/items", "top"))
print(joinUrl("https://example.com", "api", "users"))
print(decode(encode("VelarScript 游戏")))
print(isExternal("https://other.example", "https://example.com"))
const timestamp = utc(2024, 1, 2, 3, 4, 5)
print(iso(timestamp))
print(parts(timestamp, "UTC").year)
print(parseTime("invalid") == null)
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
    "true", "42", "7", "2", "22", "a# b#", "a|b|c", "true", "true", "null", "x$&", "a|b", "TypeError", "TypeError",
    "3.14", "10", "2", "8", "90", "6", "24",
    "Nova", "fallback", '{"a":2,"z":1}', "[1,2]", "true", "false",
    "6", "2", "7", "2",
    "/items", "2", "page=3", "/items?page=4", "/items#top", "https://example.com/api/users", "VelarScript 游戏", "true",
    "2024-01-02T03:04:05.000Z", "2024", "true", "info:core:ready", "debug::trace", "debug",
    "",
  ].join("\n"));
});

test("Core builtins and standard modules share one named-argument ABI", async () => {
  const intentionallyPositional = new Map<string, ReadonlySet<string>>([
    ["velar/collections", new Set(["range"])],
    ["velar/math", new Set(["min", "max", "randomInt"])],
    ["velar/url", new Set(["join"])],
  ]);
  const assertNamedSurface = (type: ValueType, path: string, intentionallyUnnamed = false): void => {
    if (type.kind === "function" || type.kind === "intrinsic" || type.kind === "action") {
      if (!intentionallyUnnamed) {
        assert.equal(type.parameterNames?.length, type.parameters.length, `${path} must expose stable parameter names`);
        assert.ok(type.parameterNames?.every(Boolean), `${path} must not expose an empty parameter name`);
        for (const name of type.parameterNames ?? []) assert.ok(!unavailableOfficialParameterNames.has(name), `${path} parameter '${name}' must be writable at a call site`);
      }
      assertNamedSurface(type.result, `${path} return`);
      return;
    }
    if (type.kind === "object") {
      for (const [name, field] of type.fields) assertNamedSurface(field, `${path}.${name}`);
      return;
    }
    if (type.kind === "promise") assertNamedSurface(type.value, `${path} value`);
    if (type.kind === "optional") assertNamedSurface(type.inner, `${path} value`);
    if (type.kind === "union") for (const member of type.members) assertNamedSurface(member, `${path} member`);
  };
  for (const source of [
    "velar/collections", "velar/text", "velar/math", "velar/json", "velar/async",
    "velar/url", "velar/time", "velar/id", "velar/log", "velar/test",
  ]) {
    for (const [name, type] of standardModuleInterface(source)!.exports) {
      assertNamedSurface(type, `${source}.${name}`, intentionallyPositional.get(source)?.has(name));
    }
  }

  const directory = await mkdtemp(join(tmpdir(), "velar-named-standard-library-"));
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {enumerate, join as joinItems} from "velar/collections"
import {parse as parseJson} from "velar/json"
import {map as asyncMap} from "velar/async"
import {expect} from "velar/test"

type User:
    name: string

enum Status:
    ready
    done

def markText(label: string, value: string) -> string:
    print(value=label)
    return value

def markValues(label: string, values: List<string>) -> List<string>:
    print(value=label)
    return values

print(value=joinItems(separator=markText("separator", ","), values=markValues("values", ["a", "b"])))
print(value=enumerate(start=10, values=["x"])[0].index)
print(value=3.14159.toFixed(digits=2))
print(value=" Velar ".trim())

const parsed = parseJson(target=User, text="{\\\"name\\\":\\\"Ada\\\"}")
const typed = User.parse(value={name: "Lin"})
print(value=parsed.name)
print(value=typed.name)
print(value=Status.is(value=Status.ready))
print(value=number(text="12"))
print(value=str(value=12))
print(value=Error(message="boom").message)

const scores: Map<string, number> = Map()
scores.set("Ada", 9)
const copied = Map(source=scores)
const tags = Set(source=["web"])
print(value=copied.get("Ada") ?? 0)
print(value=tags.has("web"))

const doubled = await asyncMap(concurrency=2, worker=async value => value * 2, values=[1, 2])
expect(actual=doubled).toHaveLength(length=2)
print(value=doubled[1])
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, String(build.stderr));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "separator\nvalues\na,b\n10\n3.14\nVelar\nAda\nLin\ntrue\n12\n12\nboom\n9\ntrue\n4\n");

  const invalid = compileCore(`
print(item="wrong")
number(value="12")
Map(values=Map())
Set(values=[])
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Unknown named argument 'item'/u);
  assert.match(messages, /Unknown named argument 'value'/u);
  assert.match(messages, /Unknown named argument 'values'/u);
});

test("local platform modules are typed Core APIs and refuse browser targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-local-platform-types-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {ServeRequest, ServeResponse, fileResponse, serve} from "velar/serve"
import {Blob, exists, list, readBlob, readText, writeText} from "velar/fs"
import {get, require as requireEnv} from "velar/env"
import {exit, onShutdown} from "velar/host"

async def handle(request: ServeRequest) -> ServeResponse:
    if request.path == "/health":
        return {status: 200, json: {ok: true}}
    return fileResponse(root="dist", path=request.path, fallback="index.html")

async def cleanup() -> null:
    return null

onShutdown(cleanup)
const configured = get("PORT") ?? requireEnv("FALLBACK_PORT")
print(configured)
`.trimStart(), "utf8");

  const core = await compileProjectCore(entry, new Map(), { extensions: [] });
  assert.deepEqual(core.failures, []);
  assert.deepEqual(core.modules.flatMap((module) => module.result.diagnostics), []);

  const web = await compileProject(entry);
  assert.ok(web.failures.some((failure) => failure.message === "velar/serve is a local runtime module; web applications use the dev server and velar/http"), JSON.stringify(web.failures));
  assert.ok(web.failures.some((failure) => failure.message === "velar/fs is a local runtime module and cannot run in a web application"), JSON.stringify(web.failures));
});

test("local filesystem and environment modules keep their runtime boundaries bounded and opaque", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-local-platform-fs-"));
  const textPath = join(directory, "note.txt");
  const invalidPath = join(directory, "invalid.txt");
  const fsRuntime = standardModuleSourceCore("velar/fs") ?? "";
  const fsModule = await import(`data:text/javascript;base64,${Buffer.from(fsRuntime, "utf8").toString("base64")}`) as {
    readonly Blob: new (...arguments_: unknown[]) => unknown;
    readonly exists: (path: string) => Promise<boolean>;
    readonly list: (path: string) => Promise<readonly string[]>;
    readonly readBlob: (path: string) => Promise<unknown>;
    readonly readText: (path: string) => Promise<string>;
    readonly writeText: (path: string, text: string) => Promise<null>;
  };
  assert.equal(await fsModule.writeText(textPath, "Velar 本地运行时"), null);
  assert.equal(await fsModule.readText(textPath), "Velar 本地运行时");
  assert.equal(await fsModule.exists(textPath), true);
  assert.equal(await fsModule.exists(join(directory, "missing.txt")), false);
  assert.deepEqual(await fsModule.list(directory), ["note.txt"]);
  const blob = await fsModule.readBlob(textPath);
  assert.equal(blob instanceof fsModule.Blob, true);
  assert.throws(() => new fsModule.Blob(), /created only by velar\/fs\.readBlob/u);
  await writeFile(invalidPath, Buffer.from([0xc3, 0x28]));
  await assert.rejects(fsModule.readText(invalidPath), /valid UTF-8/u);
  await assert.rejects(fsModule.readText("x".repeat(4097)), /outside the supported bounds/u);

  const envRuntime = standardModuleSourceCore("velar/env") ?? "";
  const envModule = await import(`data:text/javascript;base64,${Buffer.from(envRuntime, "utf8").toString("base64")}`) as {
    readonly get: (name: string) => string | null;
    readonly require: (name: string) => string;
  };
  const variable = `VELAR_D18_TEST_${process.pid}`;
  process.env[variable] = "ready";
  try {
    assert.equal(envModule.get(variable), "ready");
    assert.equal(envModule.require(variable), "ready");
    assert.equal(envModule.get(`${variable}_MISSING`), null);
    assert.throws(() => envModule.require(`${variable}_MISSING`), new RegExp(`${variable}_MISSING`, "u"));
    assert.throws(() => envModule.get("invalid-name"), /Environment variable names/u);
  } finally {
    delete process.env[variable];
  }
});

test("velar run serves checked responses, bounded static files, streams, and ordered shutdown", { skip: process.platform === "win32" }, async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await mkdtemp(join(tmpdir(), "velar-local-platform-run-"));
  const publicRoot = join(directory, "public");
  await mkdir(publicRoot, { recursive: true });
  await writeFile(join(publicRoot, "index.html"), "<h1>Velar local platform</h1>\n", "utf8");
  await writeFile(join(publicRoot, "app.js"), "globalThis.ready = true;\n", "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "main.vel"), `
import {ServeRequest, ServeResponse, fileResponse, serve} from "velar/serve"
import {sleep} from "velar/async"
import {onShutdown} from "velar/host"

type Body:
    text: string

async def chunks(write: (chunk: string) -> Promise<null>) -> null:
    await write("first")
    await sleep(40)
    await write("second")
    return null

async def handle(request: ServeRequest) -> ServeResponse:
    if request.path == "/api/health":
        return {status: 200, json: {ok: true}}
    if request.path == "/api/body":
        try:
            const valid = Body.parse(await request.json())
            if valid.text.size > 0:
                return {status: 200, json: {text: valid.text}}
        catch error:
            pass
        return {status: 400, json: {error: "invalid body"}}
    if request.path == "/api/stream":
        return {status: 200, stream: chunks, headers: Map([["Cache-Control", "no-store"]])}
    if request.path == "/traversal":
        return fileResponse(root=${JSON.stringify(publicRoot)}, path="/../secret.txt")
    return fileResponse(root=${JSON.stringify(publicRoot)}, path=request.path, fallback="index.html")

const server = await serve(handle, port=0)

async def firstCleanup() -> null:
    print("cleanup:first")
    return null

async def stopServer() -> null:
    print("cleanup:server")
    await server.stop()
    return null

onShutdown(firstCleanup)
onShutdown(stopServer)
print(f"PORT:{str(server.port)}")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, [cli, "run"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    const timer = setTimeout(() => rejectPort(new Error(`velar run did not report a port\nstdout: ${stdout}\nstderr: ${stderr}`)), 5_000);
    const inspect = () => {
      const match = /(?:^|\n)PORT:(\d+)\n/u.exec(stdout);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off("data", inspect);
      resolvePort(Number(match[1]));
    };
    child.stdout.on("data", inspect);
    inspect();
  });
  const origin = `http://127.0.0.1:${port}`;

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const invalid = await fetch(`${origin}/api/body`, { method: "POST", body: JSON.stringify({ text: "" }) });
  assert.equal(invalid.status, 400);
  const valid = await fetch(`${origin}/api/body`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { text: "hello" });

  const stream = await fetch(`${origin}/api/stream`);
  const reader = stream.body!.getReader();
  const arrivals: string[] = [];
  const decoder = new TextDecoder();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    arrivals.push(decoder.decode(next.value, { stream: true }));
  }
  assert.equal(arrivals.join(""), "firstsecond");
  assert.ok(arrivals.length >= 2, JSON.stringify(arrivals));

  const script = await fetch(`${origin}/app.js`);
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  const fallback = await fetch(`${origin}/nested/route`);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /Velar local platform/u);
  const traversal = await fetch(`${origin}/traversal`);
  assert.equal(traversal.status, 404);

  const processTable = spawnSync("ps", ["ax", "-o", "pid=,ppid=,command="], { encoding: "utf8" });
  assert.equal(processTable.status, 0, processTable.stderr);
  const programPid = processTable.stdout.split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line))
    .find((match) => match && Number(match[2]) === child.pid && match[3]?.includes(".velar/run-") === true)?.[1];
  assert.ok(programPid, processTable.stdout);
  process.kill(Number(programPid), "SIGINT");
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); rejectExit(new Error(`velar run did not stop\nstdout: ${stdout}\nstderr: ${stderr}`)); }, 5_000);
    child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
  });
  assert.equal(exitCode, 0, stderr);
  assert.match(stdout, /cleanup:first\ncleanup:server\n$/u);
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
import { runInNewContext } from "node:vm";
const left = { name: "Velar", nested: [1, { ready: true }] };
const right = { nested: [1, { ready: true }], name: "Velar" };
console.log(deepEqual(left, right));
console.log(deepEqual(left, { name: "Velar", nested: [1, { ready: false }] }));
console.log(deepEqual(new Map([["item", { value: 1 }]]), new Map([["item", { value: 1 }]])));
console.log(deepEqual(new Set(["a", "b"]), new Set(["b", "a"])));
const foreignList = runInNewContext('class HostileList extends Array { every() { throw new Error("list override") } }; new HostileList(1, 2)');
const foreignMap = runInNewContext('class HostileMap extends Map { get size() { throw new Error("map size override") } entries() { throw new Error("map entries override") } has() { throw new Error("map has override") } get() { throw new Error("map get override") } }; new HostileMap([["item", 1]])');
const foreignSet = runInNewContext('class HostileSet extends Set { get size() { throw new Error("set size override") } values() { throw new Error("set values override") } has() { throw new Error("set has override") } }; new HostileSet(["a", "b"])');
console.log(deepEqual(foreignList, [1, 2]));
console.log(deepEqual(foreignMap, new Map([["item", 1]])));
console.log(deepEqual(foreignSet, new Set(["b", "a"])));
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
  assert.equal(execution.stdout, "true\nfalse\ntrue\ntrue\ntrue\ntrue\ntrue\ntrue\nfalse\ntrue\nfalse\ntrue\nfalse\nfalse\n0\n");
});

test("velar/test toEqual uses the language deepEqual contract", () => {
  const source = standardModuleSource("velar/test") ?? "";
  const execution = executeModule(`${source}
import { runInNewContext } from "node:vm";
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
const foreignMap = runInNewContext('class HostileMap extends Map { get size() { throw new Error("map size override") } entries() { throw new Error("map entries override") } }; new HostileMap([["item", 1]])');
console.log(passes(() => expect(foreignMap).toEqual(new Map([["item", 1]]))));
try { expect(foreignMap).toEqual(new Map([["item", 2]])); } catch (error) { console.log(error.message.startsWith("Expected Map(")); }
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
  assert.equal(execution.stdout, "true\nfalse\nfalse\ntrue\ntrue\ntrue\nfalse\ntrue\ntrue\nfalse\ntrue\nfalse\n0\n");
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
class HostileList extends Array { some() { throw new Error("list override"); } }
console.log(passes(() => expect(new HostileList("value")).toContain("value")));
const sparse = []; sparse.length = 1;
console.log(passes(() => expect(sparse).toHaveLength(1)));
console.log(passes(() => expect("Velar").toMatch("^Vel")), passes(() => expect("Velar").toMatch(42)));
console.log(passes(() => expect(() => { throw new Error("expected"); }).toThrow()), passes(() => expect(42).toThrow()));
console.log(await passesAsync(() => expect(Promise.reject(new Error("expected"))).toReject()));
console.log(await passesAsync(() => expect(() => Promise.reject(new Error("expected"))).toReject()));
console.log(await passesAsync(() => expect(() => { throw new Error("sync"); }).toReject()));
console.log(await passesAsync(() => expect(Promise.resolve(1)).toReject()));
console.log(await passesAsync(() => expect(42).toReject()));
let thenGetterReads = 0;
const hostileThenable = Object.defineProperty({}, "then", { get() { thenGetterReads += 1; return () => null; } });
console.log(await passesAsync(() => expect(hostileThenable).toReject()), thenGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true false", "true false", "true false", "true false", "true", "false",
    "true false", "true false", "true", "true", "false", "false", "false", "false 0", "",
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
try { iso(8_640_000_000_000_001); console.log("accepted"); } catch (error) { console.log(error.name); }
const originalDateNow = Date.now;
Date.now = () => NaN;
try { now(); console.log("accepted"); } catch (error) { console.log(error.name); }
try { iso(); console.log("accepted"); } catch (error) { console.log(error.name); }
Date.now = originalDateNow;
const originalPerformance = globalThis.performance;
globalThis.performance = { now: () => Infinity };
try { monotonic(); console.log("accepted"); } catch (error) { console.log(error.name); }
globalThis.performance = originalPerformance;
const originalDateTimeFormat = Intl.DateTimeFormat;
let timeCoercions = 0;
let timeGetterReads = 0;
Intl.DateTimeFormat = class {
  format() { return { toString() { timeCoercions += 1; return "unsafe"; } }; }
  formatToParts() {
    const part = { type: "year" };
    Object.defineProperty(part, "value", { enumerable: true, get() { timeGetterReads += 1; return "2024"; } });
    return [part];
  }
};
try { format(0); console.log("accepted"); } catch (error) { console.log(error.name); }
try { parts(0, "UTC"); console.log("accepted"); } catch (error) { console.log(error.name); }
let timePartLengthReads = 0;
const validTimeParts = [
  { type: "year", value: "1970" }, { type: "month", value: "1" }, { type: "day", value: "1" }, { type: "weekday", value: "Thu" },
  { type: "hour", value: "0" }, { type: "minute", value: "0" }, { type: "second", value: "0" }, { type: "era", value: "AD" },
];
Intl.DateTimeFormat = class {
  formatToParts() { return new Proxy(validTimeParts, { get(target, key, receiver) { if (key === "length") { timePartLengthReads += 1; return timePartLengthReads === 1 ? target.length : 100; } return Reflect.get(target, key, receiver); } }); }
};
console.log(parts(0, "UTC").year, timePartLengthReads);
Intl.DateTimeFormat = originalDateTimeFormat;
console.log(timeCoercions + ":" + timeGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "2024-02-29T03:04:05.000Z",
    "0024-01-02T00:00:00.000Z",
    "2024-01-02T00:34:05.600Z",
    "true",
    "2024-1-2-3-4-5",
    "true", "true", "true", "true", "true", "true",
    "RangeError", "RangeError", "RangeError", "TypeError", "TypeError", "TypeError",
    "RangeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "1970 1", "0:0", "",
  ].join("\n"));
});

test("collection ordering, predicates, equality, and List boundaries follow VelarScript semantics", async () => {
  const source = standardModuleSource("velar/collections") ?? "";
  const execution = executeModule(`${source}
const values = [{ id: "a", key: 1 }, { id: "b", key: 2 }, { id: "c", key: 2 }, { id: "d", key: 1 }];
console.log(sortBy(values, value => value.key).map(value => value.id).join(""));
console.log(sortBy(values, value => value.key, true).map(value => value.id).join(""));
console.log(has([-0], 0), count([-0], 0), has([NaN], NaN), count([NaN], NaN));
for (const operation of [
  () => some([1], () => "yes"),
  () => partition([1], () => 1),
  () => sortBy([1, 2], value => value === 1 ? "one" : 2),
  () => sortBy([1], () => NaN),
  () => range(1e20, 1e20 + 65536, 1),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
const sparse = []; sparse.length = 1;
const extended = [1]; extended.label = "hidden";
const frozen = Object.freeze([1]);
for (const list of [sparse, extended, frozen]) {
  try { take(list, 1); console.log("accepted"); } catch (error) { console.log(error.name); }
}
class HostileList extends Array {
  [Symbol.iterator]() { throw new Error("iterator override"); }
  map() { throw new Error("map override"); }
  slice() { throw new Error("slice override"); }
}
const hostile = new HostileList(1, 2);
for (const operation of [
  () => enumerate(hostile).length,
  () => zip(hostile, hostile).length,
  () => chunk(hostile, 1).length,
  () => partition(hostile, value => value > 0).matches.length,
  () => groupBy(hostile, value => value).size,
  () => keyBy(hostile, value => value).size,
  () => countBy(hostile, value => value).size,
  () => minBy(hostile, value => value),
]) console.log(operation());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "adbc", "bcad", "true 1 true 1",
    "TypeError", "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "TypeError",
    "2", "2", "2", "2", "2", "2", "2", "1", "",
  ].join("\n"));

  const directory = await mkdtemp(join(tmpdir(), "velar-collection-keys-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {maxBy, minBy, sortBy} from "velar/collections"

const sorted = sortBy([1], value => true)
const lowest = minBy([1], value => null)
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
let asyncThenReads = 0;
const fakePromise = Object.defineProperty({}, "then", { get() { asyncThenReads += 1; return resolve => resolve(1); } });
for (const [name, callback] of [["all-value", () => all([1])], ["race-thenable", () => race([fakePromise])], ["timeout-value", () => timeout(1, 1)]]) {
  try { await callback(); console.log("accepted"); } catch (error) { console.log(name, error.name); }
}
console.log(asyncThenReads);
console.log(
  (await all([Promise.resolve(undefined)]))[0] === null,
  await race([Promise.resolve(undefined)]) === null,
  await timeout(Promise.resolve(undefined), 1) === null,
  await retry(async () => undefined) === null,
  (await map([1], () => undefined))[0] === null,
  (await series([() => undefined]))[0] === null,
);
`);
  assert.equal(asyncExecution.status, 0, String(asyncExecution.stderr));
  assert.equal(asyncExecution.stdout, "all TypeError\nrace TypeError\nmap TypeError\nseries TypeError\ntimeout TypeError\nretry RangeError\nall-value TypeError\nrace-thenable TypeError\ntimeout-value TypeError\n0\ntrue true true true true true\n");

  const urlSource = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`${urlSource}
import { runInNewContext } from "node:vm";
const sparse = []; sparse.length = 1;
console.log(join("https://", "example.test", "api", "items"));
console.log(query({ flag: true, page: 2, empty: null, tag: ["a", "b"] }));
const foreignParams = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["page", 3]])');
console.log(query(foreignParams));
for (const operation of [
  () => query({ tag: sparse }),
  () => query({ filter: { active: true } }),
  () => query(new Map([[1, "value"]])),
  () => query({ page: Number.POSITIVE_INFINITY }),
  () => query({ page: Number.NaN }),
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
    "page=3",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "",
  ].join("\n"));
});

test("URL snapshots and test diagnostics never invoke conversion hooks", () => {
  const urlSource = standardModuleSource("velar/url") ?? "";
  const urlExecution = executeModule(`
let coercions = 0;
const hostile = { toString() { coercions += 1; return "https://coerced.test"; } };
globalThis.location = { href: hostile };
${urlSource}
try { parse("/items"); console.log("accepted"); } catch (error) { console.log(error.name); }
const NativeUrl = globalThis.URL;
globalThis.URL = class {
  constructor() {
    this.href = hostile; this.protocol = "https:"; this.host = "example.test"; this.hostname = "example.test";
    this.port = ""; this.pathname = "/"; this.search = ""; this.hash = ""; this.origin = "https://example.test";
  }
};
try { parse("/items", "https://example.test"); console.log("accepted"); } catch (error) { console.log(error.name); }
globalThis.URL = NativeUrl;
console.log(coercions);
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, "TypeError\nTypeError\n0\n");

  const testSource = standardModuleSource("velar/test") ?? "";
  const testExecution = executeModule(`${testSource}
let coercions = 0;
let getterReads = 0;
const hostileFunction = function () {};
hostileFunction[Symbol.toPrimitive] = () => { coercions += 1; return "coerced"; };
const Constructor = function () {};
Object.defineProperty(Constructor, "name", { configurable: true, get() { getterReads += 1; return "Hostile"; } });
const prototype = Object.create(null);
Object.defineProperty(prototype, "constructor", { value: Constructor });
const hostileObject = Object.create(prototype);
const large = new Array(100000).fill("x".repeat(1000));
for (const value of [hostileFunction, hostileObject, large]) {
  try { expect(value).toBe(null); console.log("accepted"); }
  catch (error) { console.log(error.message.length < 20000); }
}
const hostileThrown = { toString() { coercions += 1; return "converted"; } };
globalThis.RegExp = class { constructor() { throw hostileThrown; } };
try { expect("Velar").toMatch("Velar"); console.log("accepted"); }
catch (error) { console.log(error.message); }
try { expect("Velar").toMatch("x".repeat(4097)); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(coercions + ":" + getterReads);
`);
  assert.equal(testExecution.status, 0, String(testExecution.stderr));
  assert.equal(testExecution.stdout, "true\ntrue\ntrue\naccepted\nRangeError\n0:0\n");

  const textSource = standardModuleSource("velar/text") ?? "";
  const textExecution = executeModule(`${textSource}
let coercions = 0;
const hostile = { toString() { coercions += 1; return "converted"; } };
globalThis.RegExp = class { constructor() { throw hostile; } };
console.log(matches("Velar", "Velar"));
console.log(coercions);
`);
  assert.equal(textExecution.status, 0, String(textExecution.stderr));
  assert.equal(textExecution.stdout, "true\n0\n");
});

test("velar/math never reintroduces JavaScript numeric coercion", () => {
  const source = standardModuleSource("velar/math") ?? "";
  const execution = executeModule(`${source}
console.log(gcd(54, 24), lcm(6, 8));
for (const operation of [
  () => sign("2"),
  () => min(1, "2"),
  () => clamp(1, "0", 2),
  () => pow(2, "3"),
  () => hypot([], 2),
  () => log(1, "2"),
  () => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  () => gcd(2.5, 1),
  () => lcm(Number.MAX_SAFE_INTEGER, 2),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
const originalMathRandom = Math.random;
Math.random = () => 1;
try { random(); console.log("accepted"); } catch (error) { console.log(error.name); }
try { randomInt(10); console.log("accepted"); } catch (error) { console.log(error.name); }
Math.random = () => "0.5";
try { random(); console.log("accepted"); } catch (error) { console.log(error.name); }
Math.random = originalMathRandom;
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "6 24",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    "TypeError", "RangeError", "TypeError", "RangeError",
    "RangeError", "RangeError", "TypeError", "",
  ].join("\n"));
});

test("velar/log validates dynamic inputs and isolates sink snapshots", () => {
  const source = standardModuleSource("velar/log") ?? "";
  const execution = executeModule(`${source}
import { runInNewContext } from "node:vm";
const seen = [];
const stopFirst = useSink(record => {
  seen.push("first:" + record.message + ":" + record.fields.get("source"));
  record.fields.set("source", "mutated");
});
const stopSecond = useSink(record => seen.push("second:" + record.message + ":" + record.fields.get("source")));
const foreignFields = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["source", "runtime"]])');
logger("foreign", foreignFields).info("cross-realm");
logger("build", new Map([["source", "compiler"]])).info("ready");
stopFirst(); stopFirst(); stopSecond();
console.log(seen.join("|"));
const failures = [];
const originalError = console.error;
console.error = (message, fields, error) => failures.push(message + ":" + error.message);
const stopHostile = useSink(() => { throw { toString() { failures.push("conversion hook ran"); throw Error("conversion failure"); } }; });
log.info("hostile");
stopHostile();
console.error = originalError;
console.log(failures.join("|"));
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
const originalLogDateNow = Date.now;
let sinkThenReads = 0;
const stopThenable = useSink(() => Object.defineProperty({}, "then", { get() { sinkThenReads += 1; return () => null; } }));
log.info("non-promise sink result");
stopThenable();
console.log(sinkThenReads);
Date.now = () => NaN;
try { log.info("invalid clock"); console.log("accepted"); } catch (error) { console.log(error.name); }
Date.now = originalLogDateNow;
const originalConsoleDescriptor = Object.getOwnPropertyDescriptor(globalThis, "console");
const hostileConsole = {};
let consoleGetterReads = 0;
Object.defineProperty(hostileConsole, "info", { get() { consoleGetterReads += 1; return () => null; } });
Object.defineProperty(globalThis, "console", { ...originalConsoleDescriptor, value: hostileConsole });
let consoleBoundaryFailure = "accepted";
try { log.info("invalid console"); } catch (error) { consoleBoundaryFailure = error.name; }
Object.defineProperty(globalThis, "console", originalConsoleDescriptor);
console.log(consoleBoundaryFailure + ":" + consoleGetterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "first:cross-realm:runtime|second:cross-realm:runtime|first:ready:compiler|second:ready:compiler",
    "[velar/log] Log sink failed:A non-Error value was thrown by JavaScript",
    "debug",
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "TypeError", "0",
    "TypeError", "TypeError:0", "",
  ].join("\n"));
});

test("text methods and velar/text reject native count coercion and accessor options", () => {
  const source = standardModuleSource("velar/text") ?? "";
  const execution = executeModule(`${source}
console.log(__velarStringPadStart("7", 3, "0"));
console.log(truncate("VelarScript", 6));
let getterReads = 0;
const options = {};
Object.defineProperty(options, "ignoreCase", { enumerable: true, get() { getterReads += 1; return true; } });
for (const operation of [
  () => __velarStringRepeat("x", "2"),
  () => __velarStringPadStart("x", "3"),
  () => __velarStringPadEnd("x", -1),
  () => truncate("x", Number.MAX_SAFE_INTEGER + 1),
  () => matches("Velar", "velar", options),
  () => matches("Velar", "velar", new (class PatternOptions { constructor() { this.ignoreCase = true; } })()),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
let optionReads = 0;
const proxyOptions = new Proxy({ ignoreCase: true }, { get(target, key) { optionReads += 1; return Reflect.get(target, key); } });
console.log(matches("VELAR", "velar", proxyOptions), optionReads);
console.log(findMatches("💙", "").map(match => match.index).join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "007", "Velar…",
    "RangeError", "RangeError", "RangeError", "RangeError", "TypeError", "TypeError", "0",
    "true 0", "0,2", "",
  ].join("\n"));
});

test("standard modules bound pathological allocation and timer inputs before effects", () => {
  const collections = standardModuleSource("velar/collections") ?? "";
  const collectionExecution = executeModule(`${collections}
const oversized = []; oversized.length = 1000001;
const originalJoin = Array.prototype.join;
let nativeJoinCalls = 0;
Array.prototype.join = () => { nativeJoinCalls += 1; throw new Error("late join allocation"); };
for (const operation of [
  () => repeat("item", 1000001),
  () => sum(oversized),
  () => join(["x".repeat(8 * 1024 * 1024), "x".repeat(8 * 1024 * 1024 + 1)]),
  () => join(["left", "right"], "x".repeat(16 * 1024 * 1024)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(join(["x".repeat(8 * 1024 * 1024), "x".repeat(8 * 1024 * 1024)]).length);
console.log(join(["only"], "x".repeat(16 * 1024 * 1024 + 1)));
console.log(nativeJoinCalls);
Array.prototype.join = originalJoin;
`);
  assert.equal(collectionExecution.status, 0, String(collectionExecution.stderr));
  assert.equal(collectionExecution.stdout, "RangeError\nRangeError\nRangeError\nRangeError\n16777216\nonly\n0\n");

  const text = standardModuleSource("velar/text") ?? "";
  const textExecution = executeModule(`${text}
const originalReplace = String.prototype.replace;
const originalReplaceAll = String.prototype.replaceAll;
let replacementCalls = 0;
String.prototype.replace = () => { replacementCalls += 1; throw new Error("late replacement allocation"); };
String.prototype.replaceAll = () => { replacementCalls += 1; throw new Error("late replacement allocation"); };
for (const operation of [
  () => __velarStringRepeat("ab", 9000000),
  () => __velarStringPadStart("x", 20000000),
  () => __velarStringSplit("x".repeat(1000001), ""),
  () => indent("a\\nb", "x".repeat(9 * 1024 * 1024)),
  () => __velarStringReplace("xx", "x", "y".repeat(16 * 1024 * 1024)),
  () => __velarStringReplaceAll("xx", "x", "y".repeat(9 * 1024 * 1024)),
  () => escapeHtml("&".repeat(4 * 1024 * 1024)),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(__velarStringReplace("abc", "b", "x"));
console.log(__velarStringReplaceAll("aaa", "aa", "x"));
console.log(__velarStringReplaceAll("ab", "", "-"));
console.log(escapeHtml('<a href="x">'));
console.log(replacementCalls);
String.prototype.replace = originalReplace;
String.prototype.replaceAll = originalReplaceAll;
`);
  assert.equal(textExecution.status, 0, String(textExecution.stderr));
  assert.equal(textExecution.stdout, "RangeError\nRangeError\nRangeError\nRangeError\nRangeError\nRangeError\nRangeError\naxc\nxa\n-a-b-\n&lt;a href=&quot;x&quot;&gt;\n0\n");

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
let encodeCalls = 0;
const accessor = Object.defineProperty({}, "page", { enumerable: true, get() { getterReads += 1; return 1; } });
globalThis.encodeURIComponent = () => { encodeCalls += 1; throw new Error("late encoding allocation"); };
for (const operation of [
  () => query(accessor),
  () => query(new Map([["value", "x".repeat(300000)]])),
  () => encode(" ".repeat(700000)),
  () => join("x".repeat(2 * 1024 * 1024), "tail"),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(getterReads);
console.log(encode("Velar Script"));
console.log(encodeCalls);
`);
  assert.equal(urlExecution.status, 0, String(urlExecution.stderr));
  assert.equal(urlExecution.stdout, "TypeError\nRangeError\nRangeError\nRangeError\n0\nVelar%20Script\n0\n");

  const tinyUrl = url.replace("const maxUrlCodeUnits = 2 * 1024 * 1024;", "const maxUrlCodeUnits = 16;");
  const tinyUrlExecution = executeModule(`${tinyUrl}
const NativeUrl = globalThis.URL;
globalThis.URL = class {
  constructor() { this.href = "x:/"; this.protocol = "x:"; this.host = "host"; this.hostname = "host"; this.port = ""; this.pathname = "/123456789"; this.search = "?123456789"; this.hash = "#123456789"; this.origin = "null"; }
};
try { normalize("/"); console.log("accepted"); } catch (error) { console.log(error.name); }
globalThis.URL = NativeUrl;
`);
  assert.equal(tinyUrlExecution.status, 0, String(tinyUrlExecution.stderr));
  assert.equal(tinyUrlExecution.stdout, "RangeError\n");

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
let thenReads = 0;
const fakeThenable = Object.defineProperty({}, "then", { get() { thenReads += 1; return () => null; } });
const stopThenable = onError(() => fakeThenable);
reportError(new Error("ordinary result"));
stopThenable();
console.log(thenReads);
const runtimeDescriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.runtime.v1"));
console.log(String(runtimeDescriptor.enumerable) + ":" + String(runtimeDescriptor.configurable) + ":" + String(runtimeDescriptor.writable));
console.log(String(Object.getPrototypeOf(runtimeDescriptor.value) === null) + ":" + String(Object.isExtensible(runtimeDescriptor.value)) + ":" + runtimeDescriptor.value.version);
let coercions = 0;
let getterReads = 0;
const hostile = { toString() { coercions += 1; return "hostile"; } };
const accessor = Object.defineProperty({}, "phase", { enumerable: true, get() { getterReads += 1; return "manual"; } });
for (const operation of [() => reportError("failed"), () => reportError(new Error("failed"), 42), () => reportError(new Error("failed"), "manual", 42)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
for (const operation of [
  () => runtimeDescriptor.value.report(new Error("failed"), { phase: hostile }),
  () => runtimeDescriptor.value.report(new Error("failed"), accessor),
  () => runtimeDescriptor.value.report(new Error("failed"), { unknown: true }),
  () => runtimeDescriptor.value.report(new Error("failed"), { component: "x".repeat(1025) }),
  () => runtimeDescriptor.value.report(new Error("failed"), { unhandled: "yes" }),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(coercions + ":" + getterReads);
`);
  assert.equal(appExecution.status, 0, String(appExecution.stderr));
  assert.equal(appExecution.stdout, [
    "manual:test:expected",
    "0",
    "false:false:false",
    "true:false:0.11",
    "TypeError", "TypeError", "TypeError",
    "TypeError", "TypeError", "TypeError", "RangeError", "TypeError",
    "0:0",
    "",
  ].join("\n"));

  const forgedRuntimeExecution = executeModule(`
let getterReads = 0;
process.on("exit", () => console.log(getterReads));
Object.defineProperty(globalThis, Symbol.for("velar.runtime.v1"), {
  get() { getterReads += 1; return {}; },
  enumerable: false,
  configurable: false,
});
${appSource}
`);
  assert.notEqual(forgedRuntimeExecution.status, 0);
  assert.equal(forgedRuntimeExecution.stdout, "0\n");
  assert.match(String(forgedRuntimeExecution.stderr), /runtime registry ownership is invalid/u);

  const webResult = compile("component App:\n    return <main>Ready</main>\n");
  assert.deepEqual(webResult.diagnostics, []);
  const appUrl = `data:text/javascript;base64,${Buffer.from(appSource).toString("base64")}`;
  const webUrl = `data:text/javascript;base64,${Buffer.from(webResult.code ?? "").toString("base64")}`;
  const sharedRuntimeExecution = executeModule(`
const app = await import(${JSON.stringify(appUrl)});
const reports = [];
app.onError(report => reports.push(report.phase + ":" + report.error.message));
await import(${JSON.stringify(webUrl)});
globalThis[Symbol.for("velar.runtime.v1")].report(new Error("shared"), { phase: "manual" });
console.log(reports.join("|"));
`);
  assert.equal(sharedRuntimeExecution.status, 0, String(sharedRuntimeExecution.stderr));
  assert.equal(sharedRuntimeExecution.stdout, "manual:shared\n");

  const browserSource = standardModuleSource("velar/browser") ?? "";
  const timerExecution = executeModule(`${browserSource}
let thenReads = 0;
const fakeThenable = Object.defineProperty({}, "then", { get() { thenReads += 1; return () => null; } });
after(0, () => fakeThenable);
await new Promise((resolve) => setTimeout(resolve, 10));
console.log(thenReads);
`);
  assert.equal(timerExecution.status, 0, String(timerExecution.stderr));
  assert.equal(timerExecution.stdout, "0\n");

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
let jsonValueReads = 0;
const changingRecord = new Proxy({ value: 1 }, {
  get(target, key) { jsonValueReads += 1; return key === "value" ? 2 : Reflect.get(target, key); },
});
console.log(stringify(changingRecord));
console.log(clone(changingRecord).value);
class HostileJsonList extends Array { map() { throw new Error("List map override"); } }
console.log(stableStringify(new HostileJsonList({ z: 1, a: 2 })));
console.log(jsonValueReads);
const originalJsonStringify = JSON.stringify;
let jsonCoercions = 0;
JSON.stringify = () => ({ toString() { jsonCoercions += 1; return "{}"; } });
try { stringify({ value: 1 }); console.log("accepted"); } catch (error) { console.log(error.name); }
JSON.stringify = originalJsonStringify;
const originalJsonParse = JSON.parse;
let jsonGetterReads = 0;
JSON.parse = () => Object.defineProperty({}, "value", { enumerable: true, get() { jsonGetterReads += 1; return 1; } });
try { parse("{}"); console.log("accepted"); } catch (error) { console.log(error.name); }
JSON.parse = originalJsonParse;
console.log(jsonCoercions + ":" + jsonGetterReads);
`);
  assert.equal(jsonExecution.status, 0, String(jsonExecution.stderr));
  assert.equal(jsonExecution.stdout, [
    "true", "false", "false", "false", "false", "false", "false", "false", "TypeError", "true",
    '{"__proto__":{"safe":true},"a":1}', '{"value":[1,2]}', "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "TypeError", "TypeError", "0",
    '{"value":1}', "1", '[{"a":2,"z":1}]', "0", "TypeError", "TypeError", "0:0", "",
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
let webJsonValueReads = 0;
const changingRecord = new Proxy({ value: 1 }, {
  get(target, key) { webJsonValueReads += 1; return key === "value" ? 2 : Reflect.get(target, key); },
});
storage.set("snapshot", changingRecord);
console.log(data.get("snapshot"), webJsonValueReads);
let webJsonGetterReads = 0;
const accessorRecord = Object.defineProperty({}, "value", { enumerable: true, get() { webJsonGetterReads += 1; return 1; } });
try { storage.set("accessor", accessorRecord); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!data.has("accessor"), webJsonGetterReads);
const beforeInvalid = storageReads;
try { storage.set("invalid", new Map([["value", 1]])); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!data.has("invalid"));
try { storage.get("missing", {}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.get("missing", forgedType); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.watch("missing", {}, () => null); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.set(42, {value: 1}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.scope(42); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(runtimeTypeReads, storageReads === beforeInvalid);
let hostLengthReads = 0;
globalThis.localStorage = {
  get length() { hostLengthReads += 1; return hostLengthReads === 1 ? 1 : 100001; },
  key(index) { return index === 0 ? "safe" : null; },
};
console.log(storage.keys().join(","), hostLengthReads);
let hostileStorageKeyReads = 0;
const hostileStorageKey = Object.defineProperty({}, "startsWith", { get() { hostileStorageKeyReads += 1; throw new Error("unexpected key method read"); } });
globalThis.localStorage = { length: 1, key() { return hostileStorageKey; } };
try { storage.keys(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(hostileStorageKeyReads);
try { storage.scope("a".repeat(4095)).scope("b"); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(storageExecution.status, 0, String(storageExecution.stderr));
  assert.equal(storageExecution.stdout, '{"value":1}\n{"value":1} 0\nTypeError\ntrue 0\nTypeError\ntrue\nTypeError\nTypeError\nTypeError\nTypeError\nTypeError\n0 true\nsafe 1\nTypeError\n0\nRangeError\n');

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
let hostileKeyCalls = 0;
class HostileKeys extends Array {
  [Symbol.iterator]() { hostileKeyCalls += 1; throw new Error("iterator override"); }
  some() { hostileKeyCalls += 1; throw new Error("some override"); }
  slice() { hostileKeyCalls += 1; throw new Error("slice override"); }
  sort() { hostileKeyCalls += 1; throw new Error("sort override"); }
}
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
      getAllKeys() { return request(new HostileKeys("z", "a")); },
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
const keys = await store.keys();
keys.push("m");
console.log(keys.join(","));
console.log(hostileKeyCalls + ":" + Object.isFrozen(keys));
const beforeInvalid = transactionCount;
try { await store.set(42, { value: 3 }); console.log("accepted"); } catch (error) { console.log(error.name, transactionCount === beforeInvalid); }
console.log(openAttempts);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "open failed\ntransaction aborted\n2\na,z,m\n0:false\nTypeError true\n2\n");
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
const frozen = Object.freeze([1, 2]);
console.log(acceptsNumbers(sparse));
console.log(acceptsNumbers(extended));
console.log(acceptsNumbers(frozen));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\nfalse\nfalse\n");
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
  assert.match(result.code ?? "", /__velarListAppend/u);
  assert.match(result.code ?? "", /__velarListExtend/u);
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
const extended = [1]; __velarListExtend(extended, [2, 3]); console.log(extended.join(":"));
const selfExtended = [1]; __velarListExtend(selfExtended, selfExtended); console.log(selfExtended.join(":"));
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, get() { getterReads += 1; return 1; } });
accessor.length = 1;
const failures = [];
const atomic = [1, 2];
for (const operation of [
  () => __velarListAppend([1, 2, 3], 4),
  () => __velarListExtend(atomic, [3, 4]),
  () => __velarListExtend([], accessor),
  () => __velarCreateList([[true, () => [1, 2, 3]], [false, () => { effects += 1; return 4; }]]),
  () => { const value = __velarCreateSet([1, 2, 3]); __velarSetAdd(value, 3); __velarSetAdd(value, 4); },
  () => { const value = __velarCreateMap(); __velarMapSet(value, "a", 1); __velarMapSet(value, "b", 2); __velarMapSet(value, "c", 3); __velarMapSet(value, "a", 4); __velarMapSet(value, "d", 4); },
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
import { runInNewContext } from "node:vm";
let fetchCount = 0;
let captured = null;
globalThis.fetch = async (url, options) => {
  fetchCount += 1;
  captured = { url, method: options.method, body: options.body, contentType: options.headers.get("content-type"), credentials: options.credentials, cache: options.cache };
  return new Response('{"value":2}', { status: 200, headers: { "content-type": "application/json" } });
};
const Result = __velarRegisterRuntimeType(Object.freeze({ is(value) { return typeof value?.value === "number"; }, parse(value) { if (!this.is(value)) throw new TypeError("invalid result"); return value; } }));
const foreignHeaders = runInNewContext('class HostileMap extends Map { get size() { throw new Error("size override") } entries() { throw new Error("entries override") } }; new HostileMap([["x-test", "yes"]])');
console.log((await http.post("/items", { headers: foreignHeaders, body: { value: 1 }, timeout: 10, credentials: "include", cache: "no-cache" }).parse(Result)).value);
console.log(captured.url, captured.method, captured.body, captured.contentType, captured.credentials, captured.cache, fetchCount);
let getterReads = 0;
const accessorOptions = {};
Object.defineProperty(accessorOptions, "timeout", { enumerable: true, get() { getterReads += 1; return 10; } });
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { getterReads += 1; return value => value; } });
let forgedFileGetterReads = 0;
const forgedFileRecord = Object.freeze({ name: "forged.txt", size: 1, type: "text/plain", modified: 0 });
const forgedNativeFile = Object.defineProperty({}, "name", { get() { forgedFileGetterReads += 1; return "forged.txt"; } });
Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.file.registry.v1")).value.set(forgedFileRecord, forgedNativeFile);
try { formBody().file("upload", forgedFileRecord); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(forgedFileGetterReads);
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
    "TypeError", "0",
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
  if (url === "/wrong-chunk") {
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint16Array([1])); controller.close(); } }));
  }
  return new Response('{"value":3}', { headers: { "content-type": "application/json" } });
};
try { await http.get("/large", { maxBytes: 4 }).text(); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(cancelled);
const response = await http.get("/cached").response();
console.log(await response.text());
console.log((await response.json()).value);
try { await http.get("/wrong-chunk").text(); console.log("accepted"); }
catch (error) { console.log(error.name); }
try { http.get("/invalid", { maxBytes: 0 }); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(fetchCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, 'RangeError\ntrue\n{"value":3}\n3\nTypeError\nRangeError\n3\n');
});

test("HTTP validates response metadata and bounds returned headers", () => {
  const http = standardModuleSource("velar/http") ?? "";
  const execution = executeModule(`${http}
let mode = "headers";
let statusReads = 0;
let okReads = 0;
let headerReads = 0;
globalThis.fetch = async () => {
  const headers = new Headers();
  if (mode === "headers") for (let index = 0; index <= 100; index += 1) headers.set("x-field-" + index, "value");
  const response = new Response("ok", { headers });
  if (mode === "url") Object.defineProperty(response, "url", { value: "x".repeat(2 * 1024 * 1024 + 1) });
  if (mode === "status") Object.defineProperty(response, "status", { value: Number.NaN });
  if (mode === "snapshot") {
    const nativeHeaders = response.headers;
    Object.defineProperty(response, "ok", { get() { okReads += 1; return true; } });
    Object.defineProperty(response, "status", { get() { statusReads += 1; return statusReads === 1 ? 200 : Number.NaN; } });
    Object.defineProperty(response, "headers", { get() { headerReads += 1; return headerReads === 1 ? nativeHeaders : { get() { throw new Error("headers changed"); } }; } });
  }
  return response;
};
for (const selected of ["headers", "url", "status"]) {
  mode = selected;
  try { await http.get("/probe").response(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
mode = "snapshot";
const snapshot = await http.get("/probe").response();
console.log(snapshot.status, statusReads, okReads, headerReads);
console.log(await snapshot.text());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\nRangeError\nTypeError\n200 1 1 1\nok\n");
});

test("known lossy JSON inputs fail during checking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-json-types-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {clone, stringify} from "velar/json"
import {http} from "velar/http"
import {socket} from "velar/realtime"
import {database, storage} from "velar/storage"

type Tree:
    name: string
    children: List<Tree>

class Box:
    const value: number

    constructor(value: number):
        self.value = value

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
storage.set("mapping", mapping)
database("cache").set("unique", unique)
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
  assert.equal(messages.filter((message) => message.startsWith("Storage values accept only records")).length, 2);
  assert.ok(messages.some((message) => /Storage values.*received Map<string, number>/u.test(message)));
  assert.ok(messages.some((message) => /Storage values.*received Set<number>/u.test(message)));
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
let uuidGetterReads = 0;
Object.defineProperty(globalThis, "crypto", { configurable: true, value: Object.defineProperty({}, "randomUUID", { get() { uuidGetterReads += 1; return () => "00000000-0000-4000-8000-000000000000"; } }) });
try { uuid(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(uuidGetterReads);
let uuidCoercions = 0;
const hostileUuidFailure = { toString() { uuidCoercions += 1; return "unsafe"; } };
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID() { throw hostileUuidFailure; } } });
try { uuid(); console.log("accepted"); } catch (error) { console.log(error.name + ":" + (error.cause === hostileUuidFailure)); }
console.log(uuidCoercions);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Error\nfalse\nTypeError\n0\nError:true\n0\n");
});

test("0.5 Core standard library rejects invalid typed calls before runtime", async () => {
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
  assert.match(messages, /Runtime parsing requires a VelarScript runtime type/u);
  assert.match(messages, /Expected a List of Promises, received List<number>/u);
  assert.match(messages, /Cannot assign string to number/u);
  assert.match(messages, /Cannot assign number to string/u);
  assert.match(messages, /Cannot assign string to bool\?/u);
});

test("npm packages publish VelarScript source through package.json velar.entry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-source-package-"));
  const packageRoot = join(directory, "node_modules", "velar-greeter");
  await linkWorkspaceWebExtension(directory);
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
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");

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

test("VelarScript source packages cannot escape their package root", async () => {
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
  assert.ok(project.failures.some((failure) => /cannot escape VelarScript package 'unsafe-package'/u.test(failure.message)));
});

test("reactive bindings cannot be declared in functions", () => {
  const nested = compile("def invalid():\n    state count = 0\n");
  assert.ok(nested.diagnostics.some((diagnostic) => diagnostic.code === "VEL3010"));
});

test("locals shadow module reactive bindings with ordinary lexical semantics", () => {
  const result = compile(`
state dark: bool = false

def darkLabel(dark: bool) -> string:
    return dark ? "dark" : "light"

def localShadow() -> bool:
    let dark = true
    dark = not dark
    return dark

def toggle():
    dark = not dark

const labels = [true, false].map(dark => darkLabel(dark))

component App:
    return <p>{darkLabel(dark)} {localShadow()} {labels.join(",")}</p>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // A shadowing parameter or local is an ordinary lexical binding: reads and
  // writes inside the shadow scope never lower to reactive .get()/.set().
  assert.match(result.code ?? "", /function darkLabel\(dark\) \{\n  return \(dark \? "dark" : "light"\);/u);
  assert.match(result.code ?? "", /let dark = true;\n  dark = !\(dark\);\n  return dark;/u);
  assert.match(result.code ?? "", /dark => darkLabel\(dark\)/u);
  // Assignment that resolves to the module reactive binding still publishes.
  assert.match(result.code ?? "", /dark\.set\(!\(dark\.get\(\)\)\);/u);
  // Reads outside any shadow scope still lower reactively.
  assert.match(result.code ?? "", /darkLabel\(dark\.get\(\)\)/u);

  // Component state and computed names follow the same lexical rule.
  const component = compile(`
component App:
    state open = false
    computed title: string = open ? "open" : "closed"

    def describe(open: bool) -> string:
        return open ? "yes" : "no"

    def echo(title: string) -> string:
        return title

    action toggle():
        open = not open

    return <p>{describe(open)} {echo(title)}</p>
`.trimStart());
  assert.deepEqual(component.diagnostics, []);
  assert.match(component.code ?? "", /function describe\(open\) \{\n {6}return \(open \? "yes" : "no"\);/u);
  assert.match(component.code ?? "", /function echo\(title\) \{\n {6}return title;/u);
  assert.match(component.code ?? "", /open\.set\(!\(open\.get\(\)\)\);/u);
  assert.match(component.code ?? "", /describe\(open\.get\(\)\)/u);
  assert.match(component.code ?? "", /echo\(title\.get\(\)\)/u);
});

test("returning a value from an unannotated def is reported at the return site", async () => {
  const directive = "This function has no result annotation, so it returns null; declare '-> Pair' to return a value";
  const source = `
export type Pair:
    ink: string

const lightP: Pair = { ink: "black" }
const darkP: Pair = { ink: "white" }

export def palette(dark: bool):
    return dark ? darkP : lightP
`.trimStart();

  const intra = compile(source);
  assert.ok(intra.diagnostics.some((diagnostic) => diagnostic.code === "VEL4001" && diagnostic.message === directive),
    intra.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));

  const directory = await mkdtemp(join(tmpdir(), "velar-unannotated-return-"));
  const lookPath = join(directory, "look.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(lookPath, source, "utf8");
  await writeFile(mainPath, `
import {palette} from "./look.vel"

def crossModule() -> string:
    return palette(true).ink

crossModule()
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  const lookModule = project.modules.find((module) => module.inputPath === lookPath);
  assert.ok(lookModule);
  // The cause is named once, at the return site in the defining module.
  assert.ok(lookModule.result.diagnostics.some((diagnostic) => diagnostic.message === directive),
    lookModule.result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
});

test("actions and getters report unannotated non-null returns with their own kind", () => {
  const action = compile(`
component App:
    action submit():
        return 7

    return <p>App</p>
`.trimStart());
  assert.ok(action.diagnostics.some((diagnostic) => diagnostic.message === "This action has no result annotation, so it returns null; declare '-> number' to return a value"),
    action.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
});

test("velar.json defines a self-contained Web project and standard modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-config-project-"));
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "assets"), { recursive: true });
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "build",
    publicDir: "assets",
    extensions: ["@velarscript/web"],
    web: {
      title: "Configured Velar",
      base: "/demo",
      publicConfig: { apiBase: "https://api.example.com", features: { releases: true } },
      build: { sourceMaps: true },
    },
  }), "utf8");
  await writeFile(join(directory, "assets", "message.txt"), "VelarScript asset\n", "utf8");
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
  const web = config.extensionConfig.get("@velarscript/web") as VelarWebConfig;
  assert.equal(config.entryPath, join(directory, "src", "main.vel"));
  assert.match(config.manifestIdentity ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(web.base, "/demo/");
  assert.deepEqual(web.publicConfig, { apiBase: "https://api.example.com", features: { releases: true } });
  assert.equal(web.build.sourceMaps, true);
  assert.equal(web.security.contentSecurityPolicy, true);
  assert.equal(web.deployment.spaFallback, true);
  assert.equal(config.framework?.host.id, "@velarscript/web");
  assert.equal(config.framework?.host.protocolVersion, 1);
  const project = await compileProject(config.entryPath, new Map(), {
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
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
  assert.equal(await readFile(join(directory, "build", "message.txt"), "utf8"), "VelarScript asset\n");
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
  await linkWorkspaceWebExtension(directory);
  const manifestPath = join(directory, "velar.json");
  const manifest = (value: Record<string, unknown>): string => JSON.stringify({ formatVersion: 2, extensions: ["@velarscript/web"], ...value });
  await writeFile(manifestPath, manifest({ entry: "main.vel", outDir: "." }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /outDir.*project root/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", outDir: "dist", publicDir: "dist/public" }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /outDir.*publicDir.*overlap/u);

  await writeFile(manifestPath, manifest({
    entry: "main.vel",
    web: { security: { connectSources: ["https://api.example.com/path"] } },
  }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unsupported origin/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { publicConfig: ["not", "an", "object"] } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /web\.publicConfig.*JSON object/u);

  await writeFile(manifestPath, '{"formatVersion":2,"extensions":["@velarscript/web"],"entry":"main.vel","web":{"publicConfig":{"__proto__":"unsafe"}}}\n', "utf8");
  await assert.rejects(resolveVelarProject(directory), /reserved key '__proto__'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { publicConfig: { value: "x".repeat(65_537) } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /cannot exceed 64 KiB/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { base: "/app/", deployment: { adapter: "netlify" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /netlify.*web\.base.*'\/'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { deployment: { adapter: "unknown" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /adapter.*neutral.*netlify/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { build: { sourceMaps: "yes" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /web\.build\.sourceMaps.*boolean/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", outdir: "misspelled" }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'project' field 'outdir'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { titel: "misspelled" } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web' field 'titel'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { security: { connectSource: [] } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web\.security' field 'connectSource'/u);

  for (const base of ["/double//segment/", "/../escape/", "/encoded%2Fslash/", "/query/?value=1", "/bad%ZZ/"]) {
    await writeFile(manifestPath, manifest({ entry: "main.vel", web: { base } }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /web\.base/u);
  }
});

test("project framework hosts are versioned, capability-bound, and singular", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-framework-host-config-"));
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  const writeExtension = async (name: string, protocolVersion: number, compilerCapability: string, hostCapability = compilerCapability): Promise<void> => {
    const root = join(directory, "node_modules", name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name,
      type: "module",
      exports: { "./compiler": "./compiler.js", "./host": "./host.js" },
    }), "utf8");
    await writeFile(join(root, "compiler.js"), `
export const velarCompilerExtension = {id: ${JSON.stringify(name)}, capabilities: [${JSON.stringify(compilerCapability)}]}
export const velarProjectExtension = {id: ${JSON.stringify(name)}, manifestKey: ${JSON.stringify(name)}, parse(value) { return value ?? {} }}
`.trimStart(), "utf8");
    await writeFile(join(root, "host.js"), `
export const velarFrameworkHost = {
  protocolVersion: ${protocolVersion},
  id: ${JSON.stringify(name)},
  capability: ${JSON.stringify(hostCapability)},
  displayName: "Fixture",
  target: "browser",
  apiVersion: "1",
  artifactKind: "fixture-build",
  base() { return "/" },
  sourceMaps() { return false },
  createArtifacts() { return {entryModule: "/main.js", css: "", html: "<!doctype html>"} },
  createErrorDocument() { return "<!doctype html>" },
  staticDeployment() { return {base: "/", spaFallback: false, adapter: "neutral", contentSecurityPolicy: null} },
}
`.trimStart(), "utf8");
  };

  await writeExtension("fixture-version", 99, "fixture");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["fixture-version"] }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unsupported framework host protocol 99/u);

  await writeExtension("fixture-capability", 1, "fixture", "other");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["fixture-capability"] }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /must bind one capability owned by its compiler extension/u);

  await writeExtension("fixture-one", 1, "one");
  await writeExtension("fixture-two", 1, "two");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["fixture-one", "fixture-two"] }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /only one application framework host/u);
});

test("compiler extension loading reports hostile thrown values deterministically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hostile-extension-"));
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  const root = join(directory, "node_modules", "hostile-extension");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "hostile-extension",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
  }), "utf8");
  await writeFile(join(root, "compiler.js"), `
throw {
  toString() { throw new Error("hostile conversion hook ran") },
  [Symbol.toPrimitive]() { throw new Error("hostile primitive hook ran") },
}
`.trimStart(), "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    extensions: ["hostile-extension"],
  }), "utf8");

  await assert.rejects(
    resolveVelarProject(directory),
    /cannot load compiler extension 'hostile-extension': A non-Error value was thrown by JavaScript/u,
  );
});

test("Netlify adapter translates the root static deployment contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-netlify-"));
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "src", "main.vel"), `component App:\n    return <main><h1>Netlify Velar</h1></main>\n\nmount(<App />, "#app")\n`, "utf8");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
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
    assert.match(cliStdout, new RegExp(`Verified deployed web build ${build.buildId}`, "u"));

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

test("CLI creates explicit format-v2 projects and rejects legacy manifests without overwriting user files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-lifecycle-"));
  const projectRoot = join(directory, "my-app");
  const created = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const manifest = JSON.parse(await readFile(join(projectRoot, "velar.json"), "utf8")) as { formatVersion: number };
  assert.equal(manifest.formatVersion, 2);
  const createdPackage = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(createdPackage.dependencies["@velarscript/web"], "0.10.0-dev");
  assert.equal(createdPackage.devDependencies["@velarscript/cli"], "0.10.0-dev");
  assert.equal(createdPackage.scripts.format, "velar format");
  assert.equal(createdPackage.scripts["format:check"], "velar format --check");
  assert.equal(createdPackage.scripts["test:browser"], "velar test --browser");
  assert.equal(createdPackage.scripts.verify, "velar verify");
  assert.equal(createdPackage.scripts.preview, "velar preview");
  assert.equal(createdPackage.scripts["verify:deployment"], "velar verify-deployment");
  assert.match(await readFile(join(projectRoot, "src", "main.vel"), "utf8"), /import \{App\} from "\.\/app\.vel"/u);
  const generatedApp = await readFile(join(projectRoot, "src", "app.vel"), "utf8");
  assert.match(generatedApp, /Built with Velar/u);
  assert.match(await readFile(join(projectRoot, "src", "app.test.vel"), "utf8"), /test_application_contract/u);
  assert.match(await readFile(join(projectRoot, "src", "app.browser.test.vel"), "utf8"), /browser\.open/u);
  await linkWorkspaceWebExtension(projectRoot);
  const config = await resolveVelarProject(projectRoot);
  assert.equal(config.formatVersion, 2);
  assert.deepEqual(config.extensions, ["@velarscript/web"]);
  assert.equal((config.extensionConfig.get("@velarscript/web") as VelarWebConfig).build.sourceMaps, false);
  assert.equal(config.framework?.host.id, "@velarscript/web");
  const checked = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const coreTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(coreTest.status, 0, coreTest.stderr);
  assert.match(coreTest.stdout, /app\.test\.vel :: test_application_contract/u);

  const formatCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", "--check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(formatCheck.status, 0, formatCheck.stderr);
  assert.match(formatCheck.stdout, /Checked formatting of 4 VelarScript source files/u);
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
  await linkWorkspaceWebExtension(unusualRoot);
  const unusualCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", unusualRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(unusualCheck.status, 0, unusualCheck.stderr);

  const emptyRoot = join(directory, "existing-empty");
  await mkdir(emptyRoot);
  const emptyCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", emptyRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(emptyCreate.status, 0, emptyCreate.stderr);
  assert.equal(JSON.parse(await readFile(join(emptyRoot, "velar.json"), "utf8")).formatVersion, 2);

  const docsRoot = join(directory, "product-docs");
  const docsCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", docsRoot, "--template", "docs"], { cwd: directory, encoding: "utf8" });
  assert.equal(docsCreate.status, 0, docsCreate.stderr);
  assert.match(docsCreate.stdout, /Created VelarScript docs project/u);
  assert.match(await readFile(join(docsRoot, "src", "content.vel"), "utf8"), /export type DocPage/u);
  assert.match(await readFile(join(docsRoot, "src", "app.vel"), "utf8"), /Router routes/u);
  await linkWorkspaceWebExtension(docsRoot);
  const docsCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", docsRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(docsCheck.status, 0, docsCheck.stderr);
  const docsBuild = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", docsRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(docsBuild.status, 0, docsBuild.stderr);
  await verifyProductionBuild(join(docsRoot, "dist"));

  const libraryRoot = join(directory, "text-library");
  const libraryCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", "--template=library", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryCreate.status, 0, libraryCreate.stderr);
  assert.match(libraryCreate.stdout, /Created VelarScript library project/u);
  const libraryPackage = JSON.parse(await readFile(join(libraryRoot, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string };
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(libraryPackage.files, ["src"]);
  assert.equal(libraryPackage.velar.entry, "src/index.vel");
  assert.equal(libraryPackage.devDependencies["@velarscript/web"], undefined);
  assert.deepEqual(JSON.parse(await readFile(join(libraryRoot, "velar.json"), "utf8")).extensions, []);
  const libraryCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryCheck.status, 0, libraryCheck.stderr);
  const libraryFormat = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", libraryRoot, "--check"], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryFormat.status, 0, libraryFormat.stderr);
  const libraryTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryTest.status, 0, libraryTest.stderr);
  assert.match(libraryTest.stdout, /index\.test\.vel :: test_greeting/u);
  const libraryBuild = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryBuild.status, 0, libraryBuild.stderr);
  assert.match(await readFile(join(libraryRoot, "dist", "index.js"), "utf8"), /function greet/u);

  const componentRoot = join(directory, "info-card");
  const componentCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", componentRoot, "--template", "component"], { cwd: directory, encoding: "utf8" });
  assert.equal(componentCreate.status, 0, componentCreate.stderr);
  assert.match(componentCreate.stdout, /Created VelarScript component project/u);
  const componentPackage = JSON.parse(await readFile(join(componentRoot, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string };
    peerDependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(componentPackage.files, ["src/index.vel", "README.md"]);
  assert.equal(componentPackage.velar.entry, "src/index.vel");
  assert.equal(componentPackage.peerDependencies["@velarscript/web"], "0.10.0-dev");
  assert.equal(componentPackage.devDependencies["@velarscript/web"], "0.10.0-dev");
  assert.match(await readFile(join(componentRoot, "src", "index.vel"), "utf8"), /export component InfoCard/u);
  assert.deepEqual(JSON.parse(await readFile(join(componentRoot, "velar.json"), "utf8")).extensions, ["@velarscript/web"]);
  await linkWorkspaceWebExtension(componentRoot);
  const componentCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", componentRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(componentCheck.status, 0, componentCheck.stderr);
  const componentTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", componentRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(componentTest.status, 0, componentTest.stderr);
  assert.match(componentTest.stdout, /index\.test\.vel :: test_component_content_contract/u);
  const componentBuild = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", componentRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(componentBuild.status, 0, componentBuild.stderr);
  await verifyProductionBuild(join(componentRoot, "dist"));

  const unavailableGame = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", join(directory, "game"), "--template", "game"], { cwd: directory, encoding: "utf8" });
  assert.equal(unavailableGame.status, 2);
  assert.match(unavailableGame.stderr, /reserved for the future @velarscript\/game/u);
  const unknownTemplate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", join(directory, "unknown"), "--template=desktop"], { cwd: directory, encoding: "utf8" });
  assert.equal(unknownTemplate.status, 2);
  assert.match(unknownTemplate.stderr, /unknown template 'desktop'/u);

  const legacyRoot = join(directory, "legacy");
  await mkdir(legacyRoot);
  await writeFile(join(legacyRoot, "main.vel"), "const value = 1\n", "utf8");
  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ entry: "main.vel", web: { title: "Legacy", base: "/" } }, null, 2), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /'formatVersion' is required.*does not load legacy project formats/u);

  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel", extensions: [] }), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /unsupported formatVersion 1/u);

  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ formatVersion: 99, entry: "main.vel", extensions: [] }), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /unsupported formatVersion 99/u);
});

test("CLI help is command-specific and malformed top-level invocations fail cleanly", () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const help = spawnSync(process.execPath, [cli, "help", "build"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /isolated framework application output/u);

  const inlineHelp = spawnSync(process.execPath, [cli, "test", "--help"], { encoding: "utf8" });
  assert.equal(inlineHelp.status, 0, inlineHelp.stderr);
  assert.match(inlineHelp.stdout, /bare --browser defaults to Chromium/u);

  const createHelp = spawnSync(process.execPath, [cli, "help", "create"], { encoding: "utf8" });
  assert.equal(createHelp.status, 0, createHelp.stderr);
  assert.match(createHelp.stdout, /--template <web\|docs\|library\|component>/u);

  const addHelp = spawnSync(process.execPath, [cli, "help", "add"], { encoding: "utf8" });
  assert.equal(addHelp.status, 0, addHelp.stderr);
  assert.match(addHelp.stdout, /npm registry packages.*velar\.extension/u);
  const unsafeAdd = spawnSync(process.execPath, [cli, "add", "file:../local"], { encoding: "utf8" });
  assert.equal(unsafeAdd.status, 2);
  assert.match(unsafeAdd.stderr, /not a supported npm registry package specifier/u);

  const creator = resolve("packages/create/src/cli.ts");
  const creatorVersion = spawnSync(process.execPath, [creator, "--version"], { encoding: "utf8" });
  assert.equal(creatorVersion.status, 0, creatorVersion.stderr);
  assert.equal(creatorVersion.stdout, "create-velar 0.10.0-dev\n");
  const creatorMissing = spawnSync(process.execPath, [creator], { encoding: "utf8" });
  assert.equal(creatorMissing.status, 2);
  assert.match(creatorMissing.stderr, /expected one project directory/u);

  const unknownHelp = spawnSync(process.execPath, [cli, "help", "missing"], { encoding: "utf8" });
  assert.equal(unknownHelp.status, 2);
  assert.match(unknownHelp.stderr, /unknown command 'missing'/u);
  assert.doesNotMatch(unknownHelp.stderr, /at .*cli/u);

  const invalidVersion = spawnSync(process.execPath, [cli, "--version", "extra"], { encoding: "utf8" });
  assert.equal(invalidVersion.status, 2);
  assert.match(invalidVersion.stderr, /does not accept arguments/u);
});

test("VelarScript dependency commands keep npm authoritative and project extensions explicit", async () => {
  assert.deepEqual(parseDependencyArguments("install", []), { packages: [], packageNames: [], dev: false });
  assert.deepEqual(parseDependencyArguments("add", ["@example/feature@1.2.3", "tiny-lib", "--dev"]), {
    packages: ["@example/feature@1.2.3", "tiny-lib"],
    packageNames: ["@example/feature", "tiny-lib"],
    dev: true,
  });
  assert.match(String(parseDependencyArguments("add", ["file:../feature"])), /not a supported npm registry package specifier/u);
  assert.match(String(parseDependencyArguments("remove", ["tiny-lib@1.0.0"])), /bare npm package name/u);
  assert.match(String(parseDependencyArguments("update", ["--dev"])), /available only/u);
  assert.match(String(parseDependencyArguments("add", ["tiny-lib", "tiny-lib@next"])), /cannot be repeated/u);

  const directory = await mkdtemp(join(tmpdir(), "velar-dependency-command-"));
  const root = join(directory, "project");
  const extensionRoot = join(root, "node_modules", "@example", "feature");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "dependency-project",
    private: true,
    type: "module",
    packageManager: "npm@11.4.2",
  }, null, 2), "utf8");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2), "utf8");
  await writeFile(join(root, "src", "main.vel"), "export const answer = 42\n", "utf8");
  await writeFile(join(extensionRoot, "package.json"), JSON.stringify({
    name: "@example/feature",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { manifestKey: "feature" } },
  }, null, 2), "utf8");
  await writeFile(join(extensionRoot, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: "@example/feature", capabilities: Object.freeze(["feature"])})
export const velarProjectExtension = Object.freeze({id: "@example/feature", manifestKey: "feature", parse(value) { return value ?? Object.freeze({}) }})
`.trimStart(), "utf8");

  const npmCalls: { readonly arguments: readonly string[]; readonly cwd: string }[] = [];
  const executeNpm = async (arguments_: readonly string[], cwd: string): Promise<void> => {
    npmCalls.push({ arguments: [...arguments_], cwd });
  };
  const add = parseDependencyArguments("add", ["@example/feature@1.2.3"]);
  assert.notEqual(typeof add, "string");
  if (typeof add === "string") return;
  const added = await runDependencyCommand("add", add, { cwd: join(root, "src"), executeNpm });
  assert.deepEqual(npmCalls[0], { arguments: ["install", "--save", "--", "@example/feature@1.2.3"], cwd: root });
  assert.deepEqual(added.activatedExtensions, ["@example/feature"]);
  const activated = JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as { extensions: string[]; feature?: unknown };
  assert.deepEqual(activated.extensions, ["@example/feature"]);

  activated.feature = { enabled: true };
  await writeFile(join(root, "velar.json"), `${JSON.stringify(activated, null, 2)}\n`, "utf8");
  const remove = parseDependencyArguments("remove", ["@example/feature"]);
  assert.notEqual(typeof remove, "string");
  if (typeof remove === "string") return;
  const removed = await runDependencyCommand("remove", remove, { cwd: root, executeNpm });
  assert.deepEqual(npmCalls[1], { arguments: ["uninstall", "--", "@example/feature"], cwd: root });
  assert.deepEqual(removed.removedExtensions, ["@example/feature"]);
  const deactivated = JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(deactivated.extensions, []);
  assert.equal(deactivated.feature, undefined);

  const update = parseDependencyArguments("update", []);
  assert.notEqual(typeof update, "string");
  if (typeof update === "string") return;
  await runDependencyCommand("update", update, { cwd: root, executeNpm });
  assert.deepEqual(npmCalls[2], { arguments: ["update"], cwd: root });

  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "dependency-project",
    private: true,
    packageManager: "bun@1.3.0",
  }, null, 2), "utf8");
  await assert.rejects(runDependencyCommand("update", update, { cwd: root, executeNpm }), /package commands use npm/u);
  assert.equal(npmCalls.length, 3);
});

test("VelarScript dependency activation rolls back only the project manifest on an invalid extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-dependency-rollback-"));
  const extensionRoot = join(root, "node_modules", "invalid-extension");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "rollback-project", private: true, type: "module" }, null, 2), "utf8");
  const original = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`;
  await writeFile(join(root, "velar.json"), original, "utf8");
  await writeFile(join(root, "src", "main.vel"), "const answer = 42\n", "utf8");
  await writeFile(join(extensionRoot, "package.json"), JSON.stringify({
    name: "invalid-extension",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { manifestKey: "invalid" } },
  }, null, 2), "utf8");
  await writeFile(join(extensionRoot, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: "invalid-extension", capabilities: Object.freeze(["invalid"])})
export const velarProjectExtension = Object.freeze({id: "invalid-extension", manifestKey: "invalid", parse() { throw new Error("invalid configuration") }})
`.trimStart(), "utf8");
  const parsed = parseDependencyArguments("add", ["invalid-extension"]);
  assert.notEqual(typeof parsed, "string");
  if (typeof parsed === "string") return;
  await assert.rejects(
    runDependencyCommand("add", parsed, { cwd: root, executeNpm: async () => undefined }),
    /installed but could not be activated.*invalid configuration/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), original);
});

test("velar test discovers test_* functions without requiring exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-test-project-"));
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export def add(left: number, right: number) -> number:\n    return left + right\n", "utf8");
  await writeFile(join(directory, "src", "math.test.vel"), `
import {expect} from "velar/test"
import {sleep} from "velar/async"
import {add} from "./main.vel"

def test_adds_numbers():
    expect(add(2, 3)).toEqual(5)

async def test_async_code():
    await sleep(0)
    const value = "ready"
    expect(value).toEqual("ready")
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "ignored.browser.test.vel"), "this is intentionally not valid core test source\n", "utf8");

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(execution.stdout, /math\.test\.vel :: test_adds_numbers/);
  assert.match(execution.stdout, /2 passed, 0 failed/);
});

test("velar test executes transitive installed VelarScript source packages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-test-packages-"));
  const suffixRoot = join(directory, "node_modules", "velar-suffix");
  const greeterRoot = join(directory, "node_modules", "velar-greeter");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(suffixRoot, "src"), { recursive: true });
  await mkdir(join(greeterRoot, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export const ready = true\n", "utf8");
  await writeFile(join(suffixRoot, "package.json"), JSON.stringify({ name: "velar-suffix", velar: { entry: "src/index.vel" } }), "utf8");
  await writeFile(join(suffixRoot, "src", "index.vel"), "export const suffix = \"!\"\n", "utf8");
  await writeFile(join(greeterRoot, "package.json"), JSON.stringify({ name: "velar-greeter", velar: { entry: "src/index.vel" } }), "utf8");
  await writeFile(join(greeterRoot, "src", "index.vel"), `
import {suffix} from "velar-suffix"

export def greet(name: string) -> string:
    return name + suffix
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "package.test.vel"), `
import {expect} from "velar/test"
import {greet} from "velar-greeter"

def test_package_graph():
    expect(greet("Velar")).toBe("Velar!")
`.trimStart(), "utf8");

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(execution.stdout, /package\.test\.vel :: test_package_graph/u);
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
        <form host on:submit.prevent.stop={submit}>
            <input bind:value={name} />
            <input type="number" bind:value={age} />
            <input type="checkbox" bind:checked={enabled} />
        </form>
    </>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /document\.createDocumentFragment\(\)/);
  assert.match(result.code ?? "", /__velarChild\(Panel, \{ {2}\}, \(/);
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

test("JSX has one explicit renderable-value boundary without object coercion", () => {
  const valid = compile(`
enum Status:
    ready

component App:
    const labels: List<string> = ["Velar", "Script"]
    const accent = color("#7c5cff")
    return <main data-accent={accent}>
        {"Ready"}{42}{true}{Status.ready}{labels}{accent}{null}
        <section unsafe:html="<strong>trusted</strong>"></section>
    </main>
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /__velarHtml\([^;]+\(\) => "<strong>trusted<\/strong>"/u);
  assert.doesNotMatch(valid.code ?? "", /__velarStaticAttr\([^;]+"unsafe:html"/u);

  const invalid = compile(`
type User:
    name: string

const user: User = {name: "Ada"}

def callback() -> null:
    return null

component Broken:
    return <main data-user={user} class={user}>
        {user}
        {callback}
        <section unsafe:html={42}></section>
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5047" && /Native JSX attributes/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5040" && /JSX class/u.test(item.message)));
  assert.ok(invalid.diagnostics.filter((item) => item.code === "VEL5047" && /JSX can render/u.test(item.message)).length >= 2);
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5047" && /unsafe:html requires string/u.test(item.message)));

  const runtime = compile(`
component Shell:
    return <main>Ready</main>
`.trimStart());
  assert.deepEqual(runtime.diagnostics, []);
  const execution = executeModule(`${runtime.code ?? ""}
class FakeNode {}
globalThis.Node = FakeNode;
globalThis.document = { createTextNode(value) { return { value }; } };
const parent = { append() {}, setAttribute() {}, setAttributeNS() {} };
let coercions = 0;
let getterReads = 0;
const hostile = { toString() { coercions += 1; return "coerced"; }, valueOf() { coercions += 1; return 1; } };
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, configurable: true, get() { getterReads += 1; return "read"; } });
accessor.length = 1;
const cyclic = [];
cyclic.push(cyclic);
for (const operation of [
  () => __velarAppend(parent, hostile),
  () => __velarStaticAttr(parent, "data-value", hostile),
  () => __velarKey(hostile),
  () => __velarAppend(parent, accessor),
  () => __velarAppend(parent, cyclic),
  () => __velarAppend(parent, Infinity),
]) {
  try { operation(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(coercions + ":" + getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nTypeError\nTypeError\nTypeError\nTypeError\nTypeError\n0:0\n");

  const webRuntime = standardModuleSource("velar/web") ?? "";
  const webExecution = executeModule(`
class FakeNode {
  constructor() {
    this.classList = { add() {}, remove() {} };
  }
  append() {}
  addEventListener() {}
  removeEventListener() {}
  insertBefore() {}
  remove() {}
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return { value }; },
};
${webRuntime}
let coercions = 0;
const hostile = { toString() { coercions += 1; return "coerced"; } };
const cyclic = [];
cyclic.push(cyclic);
for (const children of [hostile, cyclic]) {
  try { Link({ to: "/", children }); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(coercions);
`);
  assert.equal(webExecution.status, 0, String(webExecution.stderr));
  assert.equal(webExecution.stdout, "TypeError\nTypeError\n0\n");
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
            {values.size > 0 ? <path d="M0 50 L100 10" /> : null}
            <use xlink:href="#marker" />
            <Annotation />
        </g>
    </svg>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateElement\("svg", "svg"\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("g", "svg"\)/u);
  assert.match(result.code ?? "", /__velarChild\(Point, \{ x: \(\) => \(12\), y: \(\) => \(20\) \}, undefined, __scope, "svg"\)/u);
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

test("collection operations use VelarScript return and bounds semantics", () => {
  const result = compile(`
let values = [1, 2]
print(values.get(9) == null)
print(values.append(3) == null)
print(values.extend([4, 5]) == null)
print(values.size)
print(values.remove(2))
print(values.pop())
print(values.some(value => value == 4))
print(values.every(value => value > 0))

const lookup = Map()
lookup.set("answer", 42)
print(lookup.get("missing") == null)
print(lookup.remove("answer"))

try:
    print(values[20])
catch error:
    print(error.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n5\ntrue\n5\ntrue\ntrue\ntrue\ntrue\nIndexError\n");

  const invalid = compile(`
const values = [1]
values.extend(["two"])
values.push(2)

const lookup = Map()
lookup.set("answer", 42)
print(lookup["answer"])
lookup["answer"] = 43
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign List<string> to List<number>/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /List has no member 'push'.*append/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Use Map\.get\(key\) instead of bracket access/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Use Map\.set\(key, value\) instead of bracket assignment/u.test(item.message)));
});

test("List, Set, and Map use familiar collection vocabulary without legacy aliases", () => {
  const result = compile(`
let values: List<number> = []
values.append(2)
values.extend([4, 6])
values.insert(1, 3)
print(values.size)
print(values.get(-1))
print(values.has(3))
print(values.remove(4))
print(values.pop())
print(values.some(value => value == 3))
print(values.every(value => value > 0))
print(values.index(3))

const words = ["beta", "alpha"]
print(words.sorted().join("|"))
print(words.map(word => f"<{word}>").filter(word => word != "<beta>").reduce((text, word) => text + word, ""))

const tags = Set(["web"])
print(tags.update(["game", "web"]) == null)
print(tags.has("game"))
print(tags.remove("web"))

const scores = Map()
scores.set("Ada", 9)
const more = Map()
more.set("Lin", 7)
print(scores.update(more) == null)
print(scores.get("Lin"))
print(scores.remove("Ada"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarListAppend/u);
  assert.match(result.code ?? "", /__velarListMap/u);
  assert.match(result.code ?? "", /__velarListFilter/u);
  assert.match(result.code ?? "", /__velarListReduce/u);
  assert.match(result.code ?? "", /__velarListJoin/u);
  assert.match(result.code ?? "", /__velarListSorted/u);
  assert.match(result.code ?? "", /__velarSetUpdate/u);
  assert.match(result.code ?? "", /__velarMapUpdate/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4\n6\ntrue\ntrue\n6\ntrue\ntrue\n1\nalpha|beta\n<alpha>\ntrue\ntrue\ntrue\ntrue\n7\ntrue\n");

  const legacy = compile(`
const values = [1]
values.add(2)
values.addAll([3])
values.deleteAt(0)
values.splice(0, 1)
values.any(value => value > 0)
values.findIndex(value => value > 0)

const tags = Set()
tags.addAll(["web"])
tags.append("game")
tags.delete("web")

const scores = Map()
scores.setAll(Map())
scores.put("Ada", 9)
scores.delete("Ada")
`.trimStart());
  const messages = legacy.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /append\(value\)/u);
  assert.match(messages, /extend\(values\)/u);
  assert.match(messages, /pop\(index\)/u);
  assert.match(messages, /insert.*remove.*pop.*slice/u);
  assert.match(messages, /some\(test\)/u);
  assert.match(messages, /find\(test\).*index\(value\)/u);
  assert.match(messages, /Set has no member 'addAll'.*update/u);
  assert.match(messages, /Set has no member 'append'.*add/u);
  assert.match(messages, /Map has no member 'setAll'.*update/u);
  assert.match(messages, /Map has no member 'put'.*set/u);
  assert.match(messages, /remove/u);
  assert.doesNotMatch(messages, /Cannot call an unknown JavaScript value/u);
  assert.doesNotMatch(messages, /Ordered comparison requires/u);
});

test("collection methods use the same named-argument contract as ordinary functions", () => {
  const result = compileCore(`
def markIndex(label: string, value: number) -> number:
    print(label)
    return value

def markText(label: string, value: string) -> string:
    print(label)
    return value

let values = ["a", "c"]
values.insert(value=markText("value", "b"), index=markIndex("index", 1))
print(values.join(separator=","))
print(values.slice(end=2, start=1).join(separator="-"))
print([1, 2, 3].reduce(initial=0, combine=(sum, value) => sum + value))

const scores: Map<string, number> = Map()
scores.set(value=2, key="b")
print(scores.get(key="b"))

const tags: Set<string> = Set()
tags.add(value="web")
print(tags.has(value="web"))

const absent: List<string>? = null
absent?.append(value=markText("skipped", "x"))
print("done")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "value\nindex\na,b,c\nb\n6\n2\ntrue\ndone\n");

  const inferred = compileCore(`
let values = []
values.append(value=1)
const first: number = values[0]

let tags = Set()
tags.add(value="web")
const tag: string = tags.values()[0]

let scores = Map()
scores.set(value=1, key="Ada")
const score: number? = scores.get(key="Ada")
`.trimStart());
  assert.deepEqual(inferred.diagnostics, []);

  const wrongTypes = compileCore(`
const values = [1]
values.get(index="zero")
values.map(transform=1)

const scores: Map<string, number> = Map()
scores.get(key=1)
`.trimStart());
  const typeMessages = wrongTypes.diagnostics.map((item) => item.message).join("\n");
  assert.match(typeMessages, /Cannot assign string to number/u);
  assert.match(typeMessages, /Cannot assign number to \(number\) -> unknown/u);
  assert.match(typeMessages, /Cannot assign number to string/u);

  const invalidNames = compileCore(`
const values = [1]
values.append(item=2)
values.insert(value=2)
values.insert(index=0, index=1, value=2)
`.trimStart());
  const nameMessages = invalidNames.diagnostics.map((item) => item.message).join("\n");
  assert.match(nameMessages, /Unknown named argument 'item'/u);
  assert.match(nameMessages, /Missing required named argument: index/u);
  assert.match(nameMessages, /Parameter 'index' is provided more than once/u);
});

test("collection methods remain callable when stored as first-class values", () => {
  const result = compileCore(`
let values = [1]
const append = values.append
const get = values.get
append(value=2)
print(get(index=-1))
let receiverReads = 0
def source() -> List<number>:
    receiverReads += 1
    return values
const appendFromSource = source().append
appendFromSource(3)
print(receiverReads)
const present: List<number>? = values
const optionalAppend = present?.append
optionalAppend?.(value=4)
const absent: List<number>? = null
print(absent?.append == null)
print(values.get(-1))

const tags: Set<string> = Set()
const add = tags.add
const has = tags.has
add(value="web")
print(has(value="web"))

const scores: Map<string, number> = Map()
const setScore = scores.set
const getScore = scores.get
setScore(value=9, key="Ada")
print(getScore(key="Ada"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /values\.append|tags\.add|scores\.set/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n1\ntrue\n4\ntrue\n9\n");
});

test("List aggregation and key sorting use checked snapshot semantics", () => {
  const result = compileCore(`
type Item:
    name: string
    rank: number

let items: List<Item> = [
    {name: "long", rank: 2},
    {name: "a", rank: 1},
    {name: "mid", rank: 2},
]
let keyCalls = 0
def rank(item: Item) -> number:
    keyCalls += 1
    if keyCalls == 1:
        items.append({name: "late", rank: 0})
    return item.rank

print([1, 2, 3].sum())
print([3, 1, 2].min())
print([3, 1, 2].max())
print([].min() == null)
print(["b", "a"].min())
print(items.sorted(by=rank).map(item => item.name).join("|"))
print(keyCalls)
print(items.size)

const sort = items.sorted
print(sort(by=item => item.name.size).get(0)?.name ?? "missing")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarListSum/u);
  assert.match(result.code ?? "", /__velarListMin/u);
  assert.match(result.code ?? "", /__velarListMax/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "6\n1\n3\ntrue\na\na|long|mid\n3\n4\na\n");

  const invalid = compileCore(`
print([true].sum())
print([true].min())
print([1, 2].sorted((left, right) => left - right, by=value => value))
print([1, 2].sorted(value => value))
const scores: Map<string, number> = Map()
print(scores.get("Ada", 0))
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /List\.sum requires List<number>/u);
  assert.match(messages, /List\.min requires List<number> or List<string>/u);
  assert.match(messages, /either a comparator or 'by=selector', not both/u);
  assert.match(messages, /Use 'sorted\(by=selector\)'/u);
  assert.match(messages, /Use 'get\(key\) \?\? fallback'/u);
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
    state values: List<number> = []
    def addValues():
        values = [...values, 1, 2, 3]
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

test("optional collection annotations contextually type empty values", () => {
  const result = compileCore(`
type Names = List<string>

const names: Names? = []
const scores: Map<string, number>? = Map()
const tags: Set<string>? = Set()
print(names?.size)
print(scores?.size)
print(tags?.size)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\n0\n0\n");
});

test("null coalescing contextually types its deferred fallback", () => {
  const result = compileCore(`
type Mapper = (string) -> string

const optionalNames: List<string>? = null
const optionalScores: Map<string, number>? = null
const optionalTags: Set<string>? = null
const optionalMapper: Mapper? = null

const names: List<string> = optionalNames ?? []
const scores: Map<string, number> = optionalScores ?? Map()
const tags: Set<string> = optionalTags ?? Set()
const mapper: Mapper = optionalMapper ?? (value => value)

print(names.size)
print(scores.size)
print(tags.size)
print(mapper("Ada"))
print((value => value) == (value => value))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\n0\n0\nAda\nfalse\n");
});

test("empty collection inference follows runtime aliases instead of individual bindings", () => {
  const valid = compile(`
const values = []
const sameValues = values
sameValues.append(1)
const first: number = values[0]

const scores = Map()
const sameScores = scores
sameScores.set("Ada", 9)
const score: number = scores.get("Ada") ?? 0

const tags = Set()
const sameTags = tags
sameTags.add("web")
print(first + score)
print(tags.has("web"))
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "10\ntrue\n");

  const invalid = compile(`
const values = []
const sameValues = values
sameValues.append(1)
values.append("wrong")

const scores = Map()
const sameScores = scores
sameScores.set("Ada", 9)
scores.set(1, "wrong")

const tags = Set()
const sameTags = tags
sameTags.add("web")
tags.add(1)

const nestedValues = []
const holder = {values: nestedValues}
nestedValues.append(1)
holder.values.append("wrong")

const inner = []
const outer = [inner]
inner.append(1)
outer[0].append("wrong")

let current = []
const previous = current
let replacement = []
current = replacement
replacement.append(1)
current.append("wrong")
previous.append("independent")
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message);
  assert.equal(messages.filter((message) => /Cannot assign string to number/u.test(message)).length, 5);
  assert.equal(messages.filter((message) => /Cannot assign number to string/u.test(message)).length, 2);

  const escaped = compile(`
type Bucket:
    values: List<unknown>

def expose(values: List<unknown>):
    print(values.size)

const objectValues = []
const bucket: Bucket = {values: objectValues}
objectValues.append(1)
bucket.values.append("mixed")
const objectNumber: number = objectValues[0]

const argumentValues = []
expose(argumentValues)
argumentValues.append(1)
const argumentNumber: number = argumentValues[0]
`.trimStart());
  assert.equal(escaped.diagnostics.filter((item) => /Cannot assign unknown to number/u.test(item.message)).length, 2);
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
print(values.slice(20).size)

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
class Box:
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

  // Extern record fields narrow like ordinary member locations, and index
  // reads on extern lists do not drop facts narrowed on unrelated bindings.
  const externalAggregates = compile(`
type Profile:
    label: string?

extern module "host-data":
    export const profile: Profile
    export const values: List<number>
    export def loadValues() -> List<number>

import js {loadValues, profile, values} from "host-data"

let current: string? = "ready"
if profile.label:
    const repeated: string = profile.label

current = "ready"
if current:
    const first = values[0]
    const afterConstant: string = current

const loaded = loadValues()
current = "ready"
if current:
    const first = loaded[0]
    const afterResult: string = current
`.trimStart());
  assert.equal(externalAggregates.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 0);

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

test("JavaScript call boundaries receive raw reactive records", () => {
  const source = "data:text/javascript,export function seesRaw(value){const runtime=globalThis[Symbol.for('velar.runtime.v1')];return runtime.toRaw(value)===value}";
  const result = compile(`
import js unsafe {seesRaw} from ${JSON.stringify(source)}

type Payload:
    value: number

state payload: Payload = {value: 1}

export def probe():
    print(seesRaw(payload) ? "raw" : "proxy")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /seesRaw\(__velarHostRaw\(payload\.get\(\)\)\)/u);
  const execution = executeModule(`${result.code ?? ""}\nprobe();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "raw\n");
});

test("extern-declared imports are presence-checked at module initialization", async () => {
  // The exact W-22 shape: the declaration names an export the real module
  // lacks (process.on is an EventEmitter prototype method, not a module
  // export). The compile stays green, and the bridge refuses at load with a
  // velar-voiced error at the import site instead of binding undefined and
  // failing far from the cause.
  const missingSource = `
extern module "node:process":
    export def on(event: string) -> null

import js {on} from "node:process"

print("reached")
`.trimStart();
  const missing = compile(missingSource);
  assert.deepEqual(missing.diagnostics, []);
  assert.match(missing.code ?? "", /import \* as __velarExternModule\d+ from "node:process";/u);
  assert.match(missing.code ?? "", /const on = __velarExternExport\(__velarExternModule\d+, "on", "node:process"\);/u);
  const failed = executeModule(missing.code ?? "");
  assert.notEqual(failed.status, 0);
  assert.match(String(failed.stderr), /Extern module 'node:process' declares 'on', but the JavaScript module has no such export; prototype methods and instance members belong on a declared class or singleton const, not module exports/u);
  assert.doesNotMatch(String(failed.stdout), /reached/u);

  // Green path: a declared export that exists imports and runs unchanged.
  const valid = compile(`
extern module "node:process":
    export const version: string

import js {version} from "node:process"

print(version)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const validExecution = executeModule(valid.code ?? "");
  assert.equal(validExecution.status, 0, String(validExecution.stderr));
  assert.match(String(validExecution.stdout), /^v\d+/u);

  // A declared export that legitimately holds undefined stays importable:
  // the boundary is membership in the module namespace, not the bound value.
  const undefinedValue = compile(`
extern module "data:text/javascript,export const gap = undefined":
    export const gap: unknown

import js {gap} from "data:text/javascript,export const gap = undefined"

print("loaded")
`.trimStart());
  assert.deepEqual(undefinedValue.diagnostics, []);
  const undefinedExecution = executeModule(undefinedValue.code ?? "");
  assert.equal(undefinedExecution.status, 0, String(undefinedExecution.stderr));
  assert.equal(undefinedExecution.stdout, "loaded\n");

  // Default-export path: a module without a default export is refused with
  // the default wording, and a genuine default loads through the same bridge.
  const missingDefault = compile(`
extern module "data:text/javascript,export const value = 1":
    export const default: number

import js banner from "data:text/javascript,export const value = 1"

print(banner)
`.trimStart());
  assert.deepEqual(missingDefault.diagnostics, []);
  const defaultExecution = executeModule(missingDefault.code ?? "");
  assert.notEqual(defaultExecution.status, 0);
  assert.match(String(defaultExecution.stderr), /Extern module 'data:text\/javascript,export const value = 1' declares 'default', but the JavaScript module has no default export; declare the module's real named exports instead/u);

  const presentDefault = compile(`
extern module "data:text/javascript,export default 7":
    export const default: number

import js seven from "data:text/javascript,export default 7"

print(seven)
`.trimStart());
  assert.deepEqual(presentDefault.diagnostics, []);
  const presentExecution = executeModule(presentDefault.code ?? "");
  assert.equal(presentExecution.status, 0, String(presentExecution.stderr));
  assert.equal(presentExecution.stdout, "7\n");

  // velar run reports the same refusal for a project entry.
  const directory = await mkdtemp(join(tmpdir(), "velar-extern-presence-"));
  const entryPath = join(directory, "main.vel");
  await writeFile(entryPath, missingSource, "utf8");
  const ran = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "run", entryPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(ran.status, 1, ran.stdout);
  assert.match(ran.stderr, /Extern module 'node:process' declares 'on', but the JavaScript module has no such export/u);
});

test("safe JavaScript classes keep constructors, members, aliases, and nominal package identity", () => {
  const valid = compile(`
extern module "sdk-a":
    export class BaseClient:
        const id: string
        constructor(id: string)
        static const family: string
        def label() -> string

    export class Client extends BaseClient:
        const baseUrl: string
        let timeoutMs: number
        constructor(id: string, baseUrl: string, timeoutMs: number = 1000)
        static const version: string
        def request(path: string) -> Promise<string>
        static def from(baseUrl: string) -> Client

import js {BaseClient, Client as Remote} from "sdk-a"
import js * as sdk from "sdk-a"
type Session:
    client: Remote
const direct: Remote = Remote("id", "/api")
const base: BaseClient = direct
const inheritedId: string = direct.id
const family: string = Remote.family
direct.timeoutMs = 2000
const connected: Remote = Remote.from("/next")
const namespaced = sdk.Client("id", "/namespace", 500)
const pending: Promise<string> = connected.request("/status")
const version: string = Remote.version
const session = Session.parse({client: direct})
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /new Remote\(__velarHostRaw\("id"\), __velarHostRaw\("\/api"\)\)/u);
  assert.match(valid.code ?? "", /new sdk\.Client\(__velarHostRaw\("id"\), __velarHostRaw\("\/namespace"\), __velarHostRaw\(500\)\)/u);
  assert.match(valid.code ?? "", /instanceof Remote/u);
  assert.ok(valid.semanticIndex.expressions.some((expression) => expression.memberName === "request" && expression.type === "(path: string) -> Promise<string>"));

  const invalid = compile(`
extern module "sdk-a":
    export class Client:
        const baseUrl: string
        constructor(baseUrl: string)
        static const version: string
        def request(path: string) -> Promise<string>

extern module "sdk-b":
    export class Client:
        constructor(baseUrl: string)
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
  assert.ok(invalid.diagnostics.some((item) => /Expected 1 argument but received 0/u.test(item.message)));

  const invalidInheritance = compile(`
extern module "bad-sdk":
    export class Base:
        def label(value: string) -> string

    export class Child extends Base:
        def label(value: number) -> string
`.trimStart());
  assert.ok(invalidInheritance.diagnostics.some((item) => /Extern override 'label' must keep the base method signature/u.test(item.message)));

  const removedHeaderConstructor = compile(`
extern module "old-sdk":
    export class Client(const id: string):
        pass
`.trimStart());
  assert.ok(removedHeaderConstructor.diagnostics.some((item) => item.code === "VEL2022" && /constructor in the class body/u.test(item.message)));
});

test("extern class identities unify across extern module blocks", () => {
  // The W-21 shape: node:stream/consumers consumes node:http's request class.
  // The reference from another block resolves to the declaring source's
  // nominal identity instead of freezing into a structural named type.
  const shared = compile(`
extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

    export def createServer(handler: (request: IncomingMessage) -> null) -> unknown

extern module "node:stream/consumers":
    export async def text(stream: IncomingMessage) -> string

import js {IncomingMessage, createServer} from "node:http"
import js {text} from "node:stream/consumers"

async def readBody(request: IncomingMessage) -> string:
    return await text(request)

const server = createServer(request => print(request.url))
print(server)
`.trimStart());
  assert.deepEqual(shared.diagnostics, []);

  // An 'import js' alias carries the same identity under its local name.
  const aliased = compile(`
extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

extern module "node:stream/consumers":
    export async def text(stream: Message) -> string

import js {IncomingMessage as Message} from "node:http"
import js {text} from "node:stream/consumers"

async def readBody(request: Message) -> string:
    return await text(request)
`.trimStart());
  assert.deepEqual(aliased.diagnostics, []);

  // A bare name declared by more than one extern module stays ambiguous and
  // says so instead of freezing silently or picking a winner.
  const ambiguous = compile(`
extern module "sdk-a":
    export class Client:
        pass

extern module "sdk-b":
    export class Client:
        pass

extern module "sdk-c":
    export def connect(client: Client) -> null
`.trimStart());
  assert.ok(ambiguous.diagnostics.some((item) =>
    /Extern class 'Client' is declared by more than one extern module \("sdk-a", "sdk-b"\); import the intended class with 'import js' to name it here/u.test(item.message)));
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
export declare function consume(values: readonly string[]): void;
export declare function supply(handler: (values: readonly string[]) => void): void;
export declare function createValues(): readonly string[];
export declare function mutableValues(): string[];
export declare function acceptValues(values: string[]): void;
export declare function dictionary(): Record<string, number>;
export declare function setMode(value: "fast" | "safe"): void;
export declare function visit(handler: (value: string) => void): void;
export declare function acceptVoid(value: void): void;
export declare function empty(): null;
export declare function absent(): undefined;
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
export declare function invalidOrder(first?: string, second: number): number;
export declare class InvalidOrder {
  constructor(first?: string, second: number);
}
`, "fixture/index.d.ts");
  assert.equal(describeType(declarations.exports.get("format")!), "(number, { prefix?: string, precision: number } = default) -> Promise<string>");
  assert.equal(describeType(declarations.exports.get("join")!), "(string, ...string) -> string");
  assert.equal(describeType(declarations.exports.get("unique")!), "(List<string>) -> unknown");
  assert.equal(describeType(declarations.exports.get("consume")!), "(List<string>) -> null");
  assert.equal(describeType(declarations.exports.get("supply")!), "((unknown) -> null) -> null");
  assert.equal(describeType(declarations.exports.get("createValues")!), "() -> unknown");
  assert.equal(describeType(declarations.exports.get("mutableValues")!), "() -> List<string>");
  assert.equal(describeType(declarations.exports.get("dictionary")!), "() -> unknown");
  assert.equal(describeType(declarations.exports.get("setMode")!), "(unknown) -> null");
  assert.equal(describeType(declarations.exports.get("visit")!), "((string) -> null) -> null");
  assert.equal(describeType(declarations.exports.get("acceptVoid")!), "(unknown) -> null");
  assert.equal(describeType(declarations.exports.get("empty")!), "() -> null");
  assert.equal(describeType(declarations.exports.get("absent")!), "() -> null");
  assert.equal(describeType(declarations.exports.get("version")!), "string");
  assert.equal(describeType(declarations.exports.get("client")!), "{ readonly version: string, request: (string, number = default) -> Promise<string>, close?: () -> null }");
  assert.equal(describeType(declarations.exports.get("recursiveClient")!), "unknown");
  assert.equal(describeType(declarations.exports.get("genericClient")!), "unknown");
  assert.equal(describeType(declarations.exports.get("Formatter")!), "Formatter");
  assert.equal(describeType(declarations.exports.get("GenericFormatter")!), "unknown");
  assert.equal(describeType(declarations.exports.get("BrokenFormatter")!), "unknown");
  assert.equal(declarations.classes.get("Formatter")?.requiredParameters, 1);
  assert.equal(declarations.classes.get("Formatter")?.base, declarations.classes.get("BaseFormatter")?.identity);
  assert.equal(declarations.classes.get("Formatter")!.fields.get("prefix")?.mutable, false);
  assert.equal(describeType(declarations.classes.get("Formatter")!.methods.get("format")!), "(number, string = default) -> string");
  assert.equal(describeType(declarations.classes.get("Formatter")!.methods.get("setPrecision")!), "(number) -> Formatter");
  assert.equal(describeType(declarations.classes.get("Formatter")!.staticMethods.get("create")!), "(string) -> Formatter");
  assert.equal(describeType(declarations.classes.get("Formatter")!.staticFields.get("version")!.type), "string");
  assert.equal(describeType(declarations.exports.get("overloaded")!), "unknown");
  assert.equal(describeType(declarations.exports.get("identity")!), "unknown");
  assert.equal(describeType(declarations.exports.get("invalidOrder")!), "unknown");
  assert.equal(describeType(declarations.exports.get("InvalidOrder")!), "unknown");
  assert.ok(declarations.warnings.some((warning) => /Overloaded export 'overloaded'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Recursive interface 'RecursiveClient'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Generic or complex interface base 'GenericBase<string>'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Generic function 'identity'/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /GenericFormatter/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /incompatible inherited member contract/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Readonly collection type/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Record is a plain JavaScript object/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /literal type/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /void cannot be supplied/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Required parameter 'second: number' follows an optional parameter/u.test(warning)));
  assert.ok(declarations.warnings.some((warning) => /Required constructor parameter 'second: number' follows an optional parameter/u.test(warning)));

  const restrictedLiteral = compileCore('import js {setMode} from "fixture"\nsetMode("fast")\n', {
    analysis: { imports: new Map([["setMode", declarations.exports.get("setMode")!]]) },
  });
  assert.ok(restrictedLiteral.diagnostics.some((item) => /Cannot assign string to unknown/u.test(item.message)));
  const restrictedVoid = compileCore('import js {acceptVoid} from "fixture"\nacceptVoid(null)\n', {
    analysis: { imports: new Map([["acceptVoid", declarations.exports.get("acceptVoid")!]]) },
  });
  assert.ok(restrictedVoid.diagnostics.some((item) => /Cannot assign null to unknown/u.test(item.message)));

  const directory = await mkdtemp(join(tmpdir(), "velar-dts-"));
  const packageRoot = join(directory, "node_modules", "typed-format");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "typed-format",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export class Formatter { static version = '1'; constructor(prefix) { this.prefix = prefix; this.precision = 1; } format(value) { return this.prefix + value.toFixed(this.precision); } static create(prefix) { return new Formatter(prefix); } }\nexport const format = value => String(value)\nexport const join = (first, ...parts) => [first, ...parts].join('')\nexport const visit = handler => handler('ready')\nexport const client = { version: '1', request: async path => path }\nexport const maybe = () => undefined\nexport const maybeAsync = async () => undefined\nexport const absent = () => undefined\nexport const maybeValue = undefined\nexport const identity = value => value\n", "utf8");
  await writeFile(join(packageRoot, "core.d.ts"), "export declare class Formatter { constructor(prefix: string); readonly prefix: string; precision: number; static readonly version: string; format(value: number): string; static create(prefix: string): Formatter; }\nexport interface Client { readonly version: string; request(path: string, timeoutMs?: number): Promise<string>; close?(): void; }\nexport interface FormatOptions { prefix?: string; precision: number; }\nexport declare function format(value: number, options?: FormatOptions): string;\nexport declare function join(first: string, ...parts: readonly string[]): string;\nexport declare const client: Client;\nexport declare function maybe(): string | undefined;\nexport declare function maybeAsync(): Promise<string | undefined>;\nexport declare function absent(): undefined;\nexport declare const maybeValue: string | undefined;\nexport declare function identity<T>(value: T): T;\n", "utf8");
  await writeFile(join(packageRoot, "callbacks.d.ts"), "export declare function visit(handler: (value: string) => void): void;\n", "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), "export {Formatter, absent, client, format, identity, join, maybe, maybeAsync, maybeValue} from \"./core.js\";\nexport * from \"./callbacks\";\n", "utf8");
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
  await writeFile(validPath, "import js {Formatter as NumberFormatter, absent, client, format, join, maybe, maybeAsync, maybeValue, visit} from \"typed-format\"\nconst formatter: NumberFormatter = NumberFormatter(\">\")\nformatter.precision = 2\nconst formatted: string = formatter.format(42)\nconst restored: NumberFormatter = NumberFormatter.create(\"~\")\nconst version: string = NumberFormatter.version\nconst label: string = format(42)\nconst configured: string = format(42, {precision: 1})\nclient.close?.()\nconst joined: string = join(\"Velar\", \"Script\")\nconst requested: Promise<string> = client.request(\"/status\", 1000)\nvisit(value => print(value))\nprint(maybe() == null)\nprint(await maybeAsync() == null)\nprint(absent() == null)\nprint(maybeValue == null)\n", "utf8");
  const valid = await compileProject(validPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  const validOutput = join(directory, "valid.js");
  const validBuild = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", validPath, "--out", validOutput], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(validBuild.status, 0, String(validBuild.stderr));
  const validExecution = spawnSync(process.execPath, [validOutput], { encoding: "utf8" });
  assert.equal(validExecution.status, 0, String(validExecution.stderr));
  assert.equal(validExecution.stdout, "ready\ntrue\ntrue\ntrue\ntrue\n");

  const invalidPath = join(directory, "invalid.vel");
  await writeFile(invalidPath, "import js {Formatter, client, format, join, identity, visit} from \"typed-format\"\nimport js {Formatter as ForeignFormatter} from \"typed-format-alt\"\nconst formatter = Formatter(1)\nconst foreign: ForeignFormatter = formatter\nformatter.prefix = \"changed\"\nFormatter.version = \"2\"\nclient.version = \"2\"\nformatter.format(\"wrong\")\nconst label = format(\"wrong\")\nformat(42, null)\nformat(42, {precision: 1, prefix: null})\nconst joined = join(\"Velar\", 2)\nclient.request(2)\nclient.request(\"/status\", null)\nvisit(value => value + 1)\nidentity(1)\n", "utf8");
  const invalid = await compileProject(invalidPath);
  const invalidDiagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalidDiagnostics.filter((item) => /Cannot assign number to string/u.test(item.message)).length >= 3);
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only member 'prefix'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only static member 'version'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign to read-only field 'version'/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign Formatter to ForeignFormatter/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /String concatenation requires two strings/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign null to \{ prefix/u.test(item.message)), JSON.stringify(invalidDiagnostics));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign null to string/u.test(item.message)));
  assert.ok(invalidDiagnostics.some((item) => /Cannot assign null to number/u.test(item.message)));
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
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "package.json"))));
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "index.d.ts"))));
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "client.d.ts"))));
  assert.ok(bridge.dependencies.includes(await realpath(join(packageRoot, "model.d.ts"))));
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
    const rejected = compile(`
import js unsafe {${name} as payload} from "data:text/javascript;base64,${unsafeSource}"
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
import js unsafe {nullish as payload} from "data:text/javascript;base64,${unsafeSource}"
const copied = {...payload}
`.trimStart());
  assert.deepEqual(nullish.diagnostics, []);
  const nullishExecution = executeModule(`${nullish.code ?? ""}\nconsole.log(copied.name === null);\n`);
  assert.equal(nullishExecution.status, 0, String(nullishExecution.stderr));
  assert.equal(nullishExecution.stdout, "true\n");

  const asynchronous = compile(`
import js unsafe {promise} from "data:text/javascript,export const promise=Promise.resolve(5)"

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
  const accessor = compile(`
import js unsafe {payload} from "data:text/javascript;base64,${getterSource}"
const {name} = payload
print(name)
`.trimStart());
  assert.deepEqual(accessor.diagnostics, []);
  const accessorExecution = executeModule(accessor.code ?? "");
  assert.notEqual(accessorExecution.status, 0);
  assert.equal(accessorExecution.stdout, "");
  assert.match(String(accessorExecution.stderr), /Variable object binding requires enumerable data field 'name'/u);

  const inherited = compile(`
import js unsafe {inherited} from "data:text/javascript;base64,${getterSource}"
const {name} = inherited
print(name)
`.trimStart());
  assert.deepEqual(inherited.diagnostics, []);
  const inheritedExecution = executeModule(inherited.code ?? "");
  assert.notEqual(inheritedExecution.status, 0);
  assert.match(String(inheritedExecution.stderr), /Variable object binding requires own data field 'name'/u);

  const restAccessor = compile(`
import js unsafe {restPayload} from "data:text/javascript;base64,${getterSource}"
const {name, ...rest} = restPayload
print(rest.size)
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
  assert.match(result.code ?? "", /__velarSetAdd\(tags, "game"\)/u);
  assert.match(result.code ?? "", /__velarSetTypeIs\(__velarField\d+\.value/u);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "inferred")?.type, "Set<number>");
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\ntrue\ntrue\nvelar\ngame\ntrue\n1\n0\n");
});

test("two-slot for loops preserve single-slot iteration and expose typed companion slots", () => {
  const result = compileCore(`
let reads = 0
def load() -> List<List<number>>:
    reads += 1
    return [[1, 2], [3, 4]]

for [left, right], index in load():
    print(f"{index}:{left + right}")

const scores = Map({Ada: 9, Lin: 7})
for name, score in scores:
    print(f"{name}:{score}")

for value, index in Set(["a", "b"]):
    print(f"{index}:{value}")

for character, index in "A😀B":
    print(f"{index}:{character}")

for name in scores:
    print(name)
print(reads)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCollectionPairIterator\(load\(\)\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0:3\n1:7\nAda:9\nLin:7\n0:a\n1:b\n0:A\n1:😀\n2:B\nAda\nLin\n1\n");

  const invalid = compileCore("for first, second, third in [1]:\n    pass\n");
  assert.ok(invalid.diagnostics.some((item) => /accepts one binding or two slots/u.test(item.message)));
});

test("range named signatures and collection constructors keep checked Core boundaries", () => {
  const rangeType = standardModuleInterface("velar/collections")!.exports.get("range")!;
  const result = compileCore(`
import {range} from "velar/collections"

const forward = range(end = 4)
const descending = range(start = 5, end = 0, step = -2)
const pairs = Map([["Ada", 9], ["Lin", 7]])
const record = Map({first: 1, second: 2})
print(f"{forward.size}:{forward[0]}:{forward[3]}")
print(f"{descending.size}:{descending[0]}:{descending[2]}")
print(pairs.get("Lin") ?? 0)
print(record.get("second") ?? 0)
`.trimStart(), { analysis: { imports: new Map([["range", rangeType]]) } });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "pairs")?.type, "Map<string, number>");
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "record")?.type, "Map<string, number>");
  const collectionRuntime = standardModuleSource("velar/collections") ?? "";
  const execution = executeModule(`${collectionRuntime}\n${(result.code ?? "").replace(/^import .*velar\/collections.*;\n/mu, "")}`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4:0:3\n3:5:1\n7\n2\n");

  const invalid = compileCore(`
import {range} from "velar/collections"
const missing = range(start = 1)
const malformed = Map([["only"]])
`.trimStart(), { analysis: { imports: new Map([["range", rangeType]]) } });
  assert.ok(invalid.diagnostics.some((item) => /Named range calls use range\(end/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /exactly \[key, value\]/u.test(item.message)));
});

test("quoted strings unify multiline, interpolation, and raw path semantics", () => {
  const source = [
    "const name = \"Velar\"",
    "const plain = \"",
    "    first",
    "    {literal} \"quote\"",
    "    last",
    "\"",
    "const rich = f\"",
    "    hello {name}",
    "    value {1 + 2}",
    "\"",
    "const windows = r\"C:\\Users\\foo\"",
    "const trailing = r\"C:\\path\\\"",
    "const quoted = r\"He said \"\"hello\"\"\"",
    "const root = r\"C:\\repo\"",
    "const asset = rf\"{root}\\assets\\main.js\"",
    "const rawLayout = r\"",
    "    C:\\one \"\"quoted\"\"",
    "    D:\\two",
    "\"",
    "const rfLayout = rf\"",
    "    {root}\\nested",
    "\"",
    "print(plain)",
    "print(rich)",
    "print(windows)",
    "print(trailing)",
    "print(quoted)",
    "print(asset)",
    "print(rawLayout)",
    "print(rfLayout)",
  ].join("\n") + "\n";
  const result = compileCore(source, { path: "multiline.vel" });
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first\n{literal} \"quote\"\nlast\nhello Velar\nvalue 3\nC:\\Users\\foo\nC:\\path\\\nHe said \"hello\"\nC:\\repo\\assets\\main.js\nC:\\one \"\"quoted\"\"\nD:\\two\nC:\\repo\\nested\n");

  const formattedSource = "const text=\"\r\n    a\r\n      b\r\n\"  \r\nprint(text)\r\n";
  const formatted = formatSource(formattedSource);
  assert.equal(formatted, "const text = \"\r\n    a\r\n      b\r\n\"\nprint(text)\n");
  assert.equal(formatSource(formatted), formatted);

  const shiftedLayout = formatSource('if true:\n  const text="\n      first\n        second\n  "\n  print(text)\n');
  assert.equal(shiftedLayout, 'if true:\n    const text = "\n        first\n          second\n    "\n    print(text)\n');
  assert.equal(formatSource(shiftedLayout), shiftedLayout);
  assert.equal(executeModule(compileCore(shiftedLayout).code ?? "").stdout, "first\n  second\n");

  const legacyDelimiter = String.fromCharCode(96);
  const legacy = compileCore(`const text = ${legacyDelimiter}legacy\ntext${legacyDelimiter}\n`);
  assert.ok(legacy.diagnostics.some((item) => item.code === "VEL1005" && /layout string/u.test(item.message)));
  const triple = compileCore('const text = """legacy\ntext"""\n');
  assert.ok(triple.diagnostics.some((item) => item.code === "VEL1005" && /layout string/u.test(item.message)));
  const noncanonical = compileCore('const path = fr"{1}\\tmp"\n');
  assert.ok(noncanonical.diagnostics.some((item) => item.code === "VEL1005" && /Use 'rf'/u.test(item.message)));

  const generatedLines = (result.code ?? "").split("\n");
  const generatedLine = generatedLines.findIndex((line) => line.includes("console.log(plain)"));
  const generatedColumn = generatedLines[generatedLine]!.indexOf("plain");
  const mapping = new SourceMap(JSON.parse(result.sourceMap ?? "{}")).findEntry(generatedLine, generatedColumn) as { originalLine: number };
  assert.equal(mapping.originalLine, 22);
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
  assert.ok(invalid.diagnostics.some((item) => /Map construction requires a Map, a List of \[key, value\] Lists, or a record/u.test(item.message)));
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

test("formatter is syntax-aware and idempotent", () => {
  const source = "type ChooseHandler=(string)->null  \r\ncomponent App:  \r\n\t// keep me\r\n\tresource label:string=loadLabel()   \r\n\tconst values:List<number>=[1,2,3]\r\n\tconst choose:ChooseHandler=value=>null\r\n\tconst result=ready?values[0]:null\r\n\taction refresh()->null:\r\n\t\tawait label.reload()\r\n\t\treturn null\r\n\treturn <main>{label.value}</main>\r\n";
  const formatted = formatSource(source);
  assert.equal(formatted, "type ChooseHandler = (string) -> null\ncomponent App:\n    // keep me\n    resource label: string = loadLabel()\n    const values: List<number> = [1, 2, 3]\n    const choose: ChooseHandler = value => null\n    const result = ready ? values[0] : null\n    action refresh() -> null:\n        await label.reload()\n        return null\n    return <main>{label.value}</main>\n");
  assert.equal(formatSource(formatted), formatted);
});

test("formatter keeps destructuring, grouped conditions, and optional parameter types unambiguous", () => {
  const source = `import js {format} from "pkg"
const {name: displayName} = user
const visible = ready and (active or pending)
const same = TaskPriority.is(TaskPriority.high)
def find(value: Ticket?, previous: Ticket?) -> Ticket?:
    return [ready ? value : previous]
`;
  const formatted = formatSource(source);
  assert.equal(formatted, `import js {format} from "pkg"
const {name: displayName} = user
const visible = ready and (active or pending)
const same = TaskPriority.is(TaskPriority.high)
def find(value: Ticket?, previous: Ticket?) -> Ticket?:
    return [ready ? value : previous]
`);
  assert.equal(formatSource(formatted), formatted);
});

test("formatter does not confuse capitalized values with generic types", () => {
  const source = `const lower = Player < score
const bounded = Player < score and score > Limit
const chained = value < Other > limit
const values: List<Player> = []
`;
  const formatted = formatSource(source);
  assert.equal(formatted, source);
  assert.deepEqual(inspectModule(formatted).diagnostics, []);
  assert.equal(formatSource(formatted), formatted);
});

test("formatter keeps structural match patterns compact and unambiguous", () => {
  const formatted = formatSource("match value:\n  case {kind:\"user\",data:[first,...rest],...details} as payload if details.active:\n    print(payload)\n");
  assert.equal(formatted, `match value:
    case {kind: "user", data: [first, ...rest], ...details} as payload if details.active:
        print(payload)
`);
  assert.deepEqual(inspectModule(formatted).diagnostics, []);
  assert.equal(formatSource(formatted), formatted);
});

test("formatter preserves multiline JSX while formatting surrounding syntax", () => {
  const formatted = formatSource(`
component App:
  const label="Ready"
  return <main>
    <button type="button">
      {label}
    </button>
  </main>
`.trimStart());
  assert.match(formatted, /const label = "Ready"/u);
  assert.match(formatted, /<\/button>\n    <\/main>/u);
  assert.deepEqual(compile(formatted).diagnostics, []);
  assert.equal(formatSource(formatted), formatted);
});

test("CLI format supports write and check modes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-format-"));
  const sourcePath = join(directory, "main.vel");
  await writeFile(sourcePath, "def main():  \n  return null  \n", "utf8");

  const before = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath, "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(before.status, 1);
  const write = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(write.status, 0, write.stderr);
  const after = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "format", sourcePath, "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(await readFile(sourcePath, "utf8"), "def main():\n    return null\n");
});

test("documentation example checker rejects invalid complete examples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-doc-example-"));
  const markdownPath = join(directory, "guide.md");
  await writeFile(markdownPath, "```velar\nconst enabled = True\n```\n", "utf8");

  const execution = spawnSync(process.execPath, ["scripts/check-documentation-examples.mjs", markdownPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /VEL1005/u);
});

test("project builds enforce imported VelarScript signatures", async () => {
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
  assert.match(execution.stderr, /Cannot assign number to string/);
});

test("module interfaces distinguish live imports from read-only local bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-live-imports-"));
  const storePath = join(directory, "store.vel");
  const entryPath = join(directory, "main.vel");
  const namespacePath = join(directory, "namespace.vel");
  const reactiveStorePath = join(directory, "reactive-store.vel");
  const reactiveEntryPath = join(directory, "reactive-main.vel");
  await writeFile(storePath, `
export type User:
    name: string

export let current: User? = {name: "Ada"}
export const fixed: User? = {name: "Lin"}

export def clear():
    current = null
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {current, fixed, clear} from "./store.vel"

def live() -> string:
    assert current
    clear()
    return current.name

def stable() -> string:
    assert fixed
    clear()
    return fixed.name
`.trimStart(), "utf8");
  await writeFile(namespacePath, `
import * as store from "./store.vel"
store.current = null
`.trimStart(), "utf8");
  await writeFile(reactiveStorePath, `
export type User:
    name: string

export state current: User? = {name: "Mira"}

export def clear():
    current = null
`.trimStart(), "utf8");
  await writeFile(reactiveEntryPath, `
import {current, clear} from "./reactive-store.vel"

def live() -> string:
    assert current
    clear()
    return current.name
`.trimStart(), "utf8");

  // Live imports narrow like ordinary bindings: a call does not drop the
  // narrowed fact even though the exporting module can reassign the binding.
  const project = await compileProject(entryPath);
  assert.deepEqual(project.failures, []);
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  const store = project.modules.find((module) => module.inputPath === storePath)?.result.moduleInterface;
  assert.equal(store?.mutableExports.has("current"), true);
  assert.equal(store?.mutableExports.has("fixed"), false);

  const namespace = await compileProject(namespacePath);
  assert.ok(namespace.failures.some((failure) => /exports live values; import them by name/u.test(failure.message)));
  assert.ok(namespace.modules.flatMap((module) => module.result.diagnostics)
    .some((item) => /Cannot assign to read-only field 'current'/u.test(item.message)));

  const reactive = await compileProject(reactiveEntryPath);
  assert.deepEqual(reactive.failures, []);
  assert.equal(reactive.modules.flatMap((module) => module.result.diagnostics)
    .filter((item) => /optional access/u.test(item.message)).length, 0);
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
export type ChooseHandler = (string) -> null
`.trimStart(), "utf8");
  await writeFile(itemPath, `
import {ChooseHandler} from "./domain.vel"

export component Item(label: string, onChoose: ChooseHandler):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>
`.trimStart(), "utf8");
  await writeFile(validPath, `
import {ChooseHandler as Handler} from "./domain.vel"
import {Item as Choice} from "./item.vel"
const choose: Handler = Handler.parse(label => null)
component App:
    return <Choice label="Velar" onChoose={choose} />
`.trimStart(), "utf8");
  await writeFile(invalidPath, `
import {Item} from "./item.vel"
def choose(value: number) -> null:
    return null
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
  assert.ok(invalid.modules.flatMap((module) => module.result.diagnostics).some((item) => /Cannot assign \(value: number\) -> null to \(string\) -> null/u.test(item.message)));
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
  assert.equal(projectCompletionContextAt(valid, validPath, labelAttribute), "extension:@velarscript/web:component-attribute");
  const propCompletions = projectCompletionsAt(valid, validPath, labelAttribute);
  assert.ok(propCompletions.some((item) => item.label === "label" && item.detail === "string"));
  assert.ok(propCompletions.some((item) => item.label === "onChoose" && item.detail === "(string) -> null"));
  assert.ok(propCompletions.some((item) => item.label === "key"));
  assert.ok(!propCompletions.some((item) => item.label === "const"));
  const nativeAttribute = itemSource.indexOf("type=\"button\"");
  assert.equal(projectCompletionContextAt(valid, itemPath, nativeAttribute), "extension:@velarscript/web:native-attribute");
  const nativeCompletions = projectCompletionsAt(valid, itemPath, nativeAttribute);
  assert.ok(nativeCompletions.some((item) => item.label === "aria-label"));
  assert.ok(nativeCompletions.some((item) => item.label === "on:click"));
  assert.ok(!nativeCompletions.some((item) => item.label === "while"));
  const componentTag = validSource.indexOf("<Choice") + "<Ch".length;
  assert.equal(projectCompletionContextAt(valid, validPath, componentTag), "extension:@velarscript/web:jsx-tag");
  const componentTags = projectCompletionsAt(valid, validPath, componentTag);
  assert.ok(componentTags.some((item) => item.label === "Choice" && item.detail?.startsWith("component ")));
  assert.deepEqual(componentTags.map((item) => item.label), ["Choice"]);
  assert.ok(!componentTags.some((item) => item.label === "while"));
  const nativeClosingTag = itemSource.indexOf("</button>") + "</bu".length;
  assert.equal(projectCompletionContextAt(valid, itemPath, nativeClosingTag), "extension:@velarscript/web:jsx-tag");
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
    label: "parse(value: unknown) -> Status",
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

test("project interfaces use analyzed export types through dependency chains and cycles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-analyzed-interface-"));
  const leaf = join(directory, "leaf.vel");
  const middle = join(directory, "middle.vel");
  const entry = join(directory, "main.vel");
  await writeFile(leaf, "export const value = 42\n", "utf8");
  await writeFile(middle, 'import {value as source} from "./leaf.vel"\nexport const forwarded = source\n', "utf8");
  await writeFile(entry, 'import {forwarded} from "./middle.vel"\nconst invalid: string = forwarded\n', "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.equal(describeType(project.modules.find((module) => module.inputPath === middle)!.result.moduleInterface.exports.get("forwarded")!), "number");
  assert.ok(project.modules.find((module) => module.inputPath === entry)!.result.diagnostics
    .some((item) => /Cannot assign number to string/u.test(item.message)));

  const first = join(directory, "cycle-a.vel");
  const second = join(directory, "cycle-b.vel");
  await writeFile(first, 'import {value} from "./cycle-b.vel"\nexport const forwarded = value\n', "utf8");
  await writeFile(second, 'import {forwarded} from "./cycle-a.vel"\nexport const value: number = 1\nexport def read() -> number:\n    return forwarded\n', "utf8");
  const cyclic = await compileProject(first);
  assert.deepEqual(cyclic.failures, []);
  assert.deepEqual(cyclic.modules.flatMap((module) => module.result.diagnostics), []);
  assert.equal(describeType(cyclic.modules.find((module) => module.inputPath === first)!.result.moduleInterface.exports.get("forwarded")!), "number");
});

test("cyclic module convergence observes the complete public class contract", () => {
  const interface_ = inspectCoreModule(`
export class Widget:
    constructor(value: string):
        pass

    get label() -> string:
        return "widget"

    def render() -> string:
        return self.label
`.trimStart(), { path: "/contracts.vel" }).moduleInterface;
  const info = interface_.classes.get("Widget")!;
  const identity = moduleInterfaceIdentity(interface_);
  const changed = (next: typeof info): string => moduleInterfaceIdentity({
    ...interface_,
    classes: new Map([["Widget", next]]),
  });

  const variants = [
    { ...info, parameters: [{ kind: "number" } as ValueType] },
    { ...info, parameterNames: ["item"] },
    { ...info, requiredParameters: 0 },
    { ...info, constructorRest: { kind: "string" } as ValueType },
    { ...info, abstract: true },
    { ...info, getters: new Set<string>() },
    { ...info, abstractGetters: new Set(["label"]) },
    { ...info, abstractMethods: new Set(["render"]) },
    { ...info, staticGetters: new Set(["label"]) },
  ];
  for (const variant of variants) assert.notEqual(changed(variant), identity);

  assert.notEqual(moduleInterfaceIdentity({
    ...interface_,
    namedTypeIdentities: new Map([["WidgetData", "velar:/other.vel#type:WidgetData"]]),
  }), identity);
  assert.notEqual(
    moduleInterfaceIdentity({ ...interface_, namedTypeIdentities: new Map([["a", "b|c:d"]]) }),
    moduleInterfaceIdentity({ ...interface_, namedTypeIdentities: new Map([["a", "b"], ["c", "d"]]) }),
  );

  const extensionInterface = (version: number) => ({
    ...interface_,
    extensionExports: new Map([["contract-test", new Map<string, unknown>([["metadata", { version }]])]]),
  });
  assert.throws(
    () => moduleInterfaceIdentity(extensionInterface(1)),
    /without an interfaceExportIdentity contract/u,
  );
  const contractExtension: CompilerExtension = {
    id: "contract-test",
    inspection: { interfaceExportIdentity: (_name, value) => JSON.stringify(value) },
  };
  assert.notEqual(
    moduleInterfaceIdentity(extensionInterface(1), [contractExtension]),
    moduleInterfaceIdentity(extensionInterface(2), [contractExtension]),
  );
});

test("record metadata keeps module identity without creating implicit type imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-record-module-"));
  const leftLibrary = join(directory, "left.vel");
  const rightLibrary = join(directory, "right.vel");
  const entry = join(directory, "main.vel");
  await writeFile(leftLibrary, `
export type Item:
    left: string

export def makeLeft() -> Item:
    return {left: "left"}
`.trimStart(), "utf8");
  await writeFile(rightLibrary, `
export type Item:
    right: number

export def makeRight() -> Item:
    return {right: 1}
`.trimStart(), "utf8");
  await writeFile(entry, `
import {makeLeft} from "./left.vel"
import {makeRight} from "./right.vel"

print(makeLeft().left)
print(makeRight().right)
`.trimStart(), "utf8");

  const collisionFree = await compileProject(entry);
  assert.deepEqual(collisionFree.failures, []);
  assert.deepEqual(collisionFree.modules.flatMap((module) => module.result.diagnostics), []);

  await writeFile(entry, `
import {makeLeft} from "./left.vel"
const value: Item = makeLeft()
`.trimStart(), "utf8");
  const hiddenName = await compileProject(entry);
  assert.ok(hiddenName.modules.find((module) => module.inputPath === entry)?.result.diagnostics
    .some((item) => /Unknown type 'Item'/u.test(item.message)));

  await writeFile(entry, `
import {Item as LeftItem, makeLeft} from "./left.vel"
import {Item as RightItem, makeRight} from "./right.vel"

const left: LeftItem = makeLeft()
const right: RightItem = makeRight()
print(left.left)
print(right.right)
`.trimStart(), "utf8");
  const explicit = await compileProject(entry);
  assert.deepEqual(explicit.failures, []);
  assert.deepEqual(explicit.modules.flatMap((module) => module.result.diagnostics), []);
});

test("same-named record types from different modules use their structural contracts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-record-contract-"));
  const consumerPath = join(directory, "consumer.vel");
  const producerPath = join(directory, "producer.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(consumerPath, `
export type Item:
    label: string

export def consume(value: Item):
    print(value.label)
`.trimStart(), "utf8");
  await writeFile(producerPath, `
export type Item:
    count: number

export def make() -> Item:
    return {count: 1}
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {consume} from "./consumer.vel"
import {make} from "./producer.vel"
consume(make())
`.trimStart(), "utf8");

  const incompatible = await compileProject(mainPath);
  assert.deepEqual(incompatible.failures, []);
  assert.ok(incompatible.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics
    .some((item) => /Cannot assign Item to a different Item contract/u.test(item.message)));

  await writeFile(producerPath, `
export type Item:
    label: string

export def make() -> Item:
    return {label: "ready"}
`.trimStart(), "utf8");
  const compatible = await compileProject(mainPath);
  assert.deepEqual(compatible.failures, []);
  assert.deepEqual(compatible.modules.flatMap((module) => module.result.diagnostics), []);
});

test("null normalization follows checked types across Velar module exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-host-reexport-"));
  const packageRoot = join(directory, "node_modules", "boundary-sdk");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "boundary-sdk",
    type: "module",
    exports: "./index.js",
    types: "./index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const client = { maybe: () => undefined };\nexport const emptyBox = { empty: undefined };\nexport const emptyValue = undefined;\nexport const maybeAsync = async () => undefined;\nexport const maybeValue = undefined;\n", "utf8");
  await writeFile(join(packageRoot, "index.d.ts"), "export interface Client { maybe(): string | undefined; }\nexport interface EmptyBox { readonly empty: undefined; }\nexport declare const client: Client;\nexport declare const emptyBox: EmptyBox;\nexport declare const emptyValue: undefined;\nexport declare function maybeAsync(): Promise<string | undefined>;\nexport declare const maybeValue: string | undefined;\n", "utf8");
  const bridge = join(directory, "bridge.vel");
  const entry = join(directory, "main.vel");
  await writeFile(bridge, 'import js {client, emptyBox, emptyValue, maybeAsync, maybeValue} from "boundary-sdk"\nexport type ClientView:\n    maybe: () -> string?\n\nexport const forwardedClient = client\nexport const forwardedEmpty = emptyValue\nexport const forwardedEmptyBox = emptyBox\nexport const forwardedPromise = maybeAsync()\nexport const forwardedValue = maybeValue\n\nexport def current() -> ClientView:\n    return client\n\nexport def relay(value: ClientView) -> ClientView:\n    return value\n\nexport class Holder:\n    constructor():\n        pass\n\n    def current() -> ClientView:\n        return client\n\n    static def shared() -> ClientView:\n        return client\n', "utf8");
  await writeFile(entry, 'import {current, forwardedClient, forwardedEmpty, forwardedEmptyBox, forwardedPromise, forwardedValue, Holder, relay} from "./bridge.vel"\nconst throughFunction = current()\nconst throughParameter = relay(forwardedClient)\nconst throughMethod = Holder().current()\nconst throughStaticMethod = Holder.shared()\nprint(forwardedEmptyBox.empty == null)\nprint(forwardedClient.maybe() == null)\nprint(throughFunction.maybe() == null)\nprint(throughParameter.maybe() == null)\nprint(throughMethod.maybe() == null)\nprint(throughStaticMethod.maybe() == null)\nprint(await forwardedPromise == null)\nprint(forwardedEmpty == null)\nprint(forwardedValue == null)\n', "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const bridgeModule = project.modules.find((module) => module.inputPath === bridge)!;
  const entryModule = project.modules.find((module) => module.inputPath === entry)!;
  assert.match(entryModule.result.code ?? "", /forwardedEmptyBox\.empty \?\? null/u);
  assert.match(entryModule.result.code ?? "", /forwardedClient\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughFunction\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughParameter\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughMethod\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /throughStaticMethod\.maybe\(\) \?\? null/u);
  assert.match(entryModule.result.code ?? "", /forwardedEmpty \?\? null/u);
  assert.match(bridgeModule.result.code ?? "", /emptyValue \?\? null/u);
  assert.match(entryModule.result.code ?? "", /__velarNormalizePromiseValue\(forwardedPromise\)/u);
  assert.match(entryModule.result.code ?? "", /Symbol\.for\("velar\.promise\.normalization\.v1"\)/u);

  const namespaceEntry = join(directory, "namespace.vel");
  await writeFile(namespaceEntry, 'import * as bridge from "./bridge.vel"\nprint(bridge.forwardedEmpty == null)\nprint(await bridge.forwardedPromise == null)\n', "utf8");
  const namespaceProject = await compileProject(namespaceEntry);
  assert.deepEqual(namespaceProject.failures, []);
  assert.deepEqual(namespaceProject.modules.flatMap((module) => module.result.diagnostics), []);
  const namespaceCode = namespaceProject.modules.find((module) => module.inputPath === namespaceEntry)!.result.code ?? "";
  assert.match(namespaceCode, /bridge\.forwardedEmpty \?\? null/u);
  assert.match(namespaceCode, /__velarNormalizePromiseValue\(bridge\.forwardedPromise\)/u);

  const dynamicEntry = join(directory, "dynamic.vel");
  await writeFile(dynamicEntry, 'const bridge = await import("./bridge.vel")\nprint(bridge.forwardedEmpty == null)\n', "utf8");
  const dynamicProject = await compileProject(dynamicEntry);
  assert.deepEqual(dynamicProject.failures, []);
  assert.deepEqual(dynamicProject.modules.flatMap((module) => module.result.diagnostics), []);
  const dynamicCode = dynamicProject.modules.find((module) => module.inputPath === dynamicEntry)!.result.code ?? "";
  assert.match(dynamicCode, /bridge\.forwardedEmpty \?\? null/u);

  const internal = join(directory, "internal.vel");
  const internalEntry = join(directory, "internal-main.vel");
  await writeFile(internal, 'export const maybe: string? = null\n', "utf8");
  await writeFile(internalEntry, 'import {maybe} from "./internal.vel"\nprint(maybe == null)\n', "utf8");
  const internalProject = await compileProject(internalEntry);
  assert.deepEqual(internalProject.failures, []);
  const internalCode = internalProject.modules.find((module) => module.inputPath === internalEntry)!.result.code ?? "";
  assert.match(internalCode, /maybe \?\? null/u);
});

test("rest signatures retain class element types across module and editor boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-rest-module-"));
  const library = join(directory, "items.vel");
  const entry = join(directory, "main.vel");
  await writeFile(library, `
export class Item:
    const name: string

    constructor(name: string):
        self.name = name

export def count(first: Item, ...others: Item) -> number:
    return others.size + 1
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
  assert.equal(signature?.label, "count(first: Item, ...Item) -> number");
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
export class Tag:
    const name: string

    constructor(name: string):
        self.name = name

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
  assert.equal(signature?.label, "count(tags: Set<Tag>) -> number");

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
  assert.match(result.code ?? "", /of __velarCollectionIterator\(lookup\)/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:6\n");
});

test("collection loops validate boundaries and ignore instance iterator overrides", () => {
  const result = compileCore(`
import js {numbers, tags, lookup} from "fixture"

type ForeignCollections:
    tags: Set<string>
    lookup: Map<string, number>

const checked = ForeignCollections.parse({tags: tags, lookup: lookup})
print(checked.tags.size)
print(checked.lookup.size)
print(numbers.size)
print(2 in numbers)
print(numbers[0])
print(numbers.copy().size)
print(numbers.sorted().get(0))
print(numbers.reversed().get(0))
numbers.append(3)
print(numbers.get(2))
print(tags.size)
print("web" in tags)
print(lookup.size)
print("Ada" in lookup)
for value in numbers:
    print(value)
for tag in tags:
    print(tag)
for key in lookup:
    print(key)
for character in "A😀":
    print(character)
`.trimStart(), { analysis: { imports: new Map([
    ["numbers", { kind: "list", element: { kind: "number" } }],
    ["tags", { kind: "set", element: { kind: "string" } }],
    ["lookup", { kind: "map", key: { kind: "string" }, value: { kind: "number" } }],
  ]) } });
  assert.deepEqual(result.diagnostics, []);
  const boundary = `
import { runInNewContext } from "node:vm";
class HostileList extends Array { static get [Symbol.species]() { throw new Error("list species override"); } set 2(value) { throw new Error("list inherited index setter"); } [Symbol.iterator]() { throw new Error("list override"); } includes() { throw new Error("list includes override"); } }
const numbers = new HostileList(1, 2);
const tags = runInNewContext('class HostileSet extends Set { get size() { throw new Error("set size override") } [Symbol.iterator]() { throw new Error("set override") } values() { throw new Error("set values override") } has() { throw new Error("set has override") } }; new HostileSet(["web"])');
const lookup = runInNewContext('class HostileMap extends Map { get size() { throw new Error("map size override") } [Symbol.iterator]() { throw new Error("map override") } keys() { throw new Error("map keys override") } has() { throw new Error("map has override") } }; new HostileMap([["Ada", 9]])');
`;
  const executable = (result.code ?? "").replace(/^import .*?;\n+/mu, boundary);
  const execution = executeModule(executable);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\n1\n2\ntrue\n1\n2\n1\n2\n3\n1\ntrue\n1\ntrue\n1\n2\n3\nweb\nAda\nA\n😀\n");

  const accessor = compileCore(`
import js {values, reads} from "fixture"
try:
    print(values[0])
catch error:
    print(error.message)
print(reads())
`.trimStart(), { analysis: { imports: new Map([
    ["values", { kind: "list", element: { kind: "number" } }],
    ["reads", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "number" } }],
  ]) } });
  assert.deepEqual(accessor.diagnostics, []);
  const accessorBoundary = `
let readCount = 0;
const values = [];
Object.defineProperty(values, "0", { enumerable: true, get() { readCount += 1; return 1; } });
const reads = () => readCount;
`;
  const accessorExecution = executeModule((accessor.code ?? "").replace(/^import .*?;\n+/mu, accessorBoundary));
  assert.equal(accessorExecution.status, 0, String(accessorExecution.stderr));
  assert.equal(accessorExecution.stdout, "List index requires ordinary mutable List data elements\n0\n");
});

test("List callback operations use a stable checked snapshot", () => {
  const result = compile(`
let values = [1, 2]

def grow(value: number) -> number:
    values.append(9)
    return value

const mapped = values.map(grow)
print(values.size)
print(mapped.size)
print(mapped.get(0))
print(mapped.get(1))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4\n2\n1\n2\n");
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

test("source maps retain nested statement and expression columns", () => {
  const result = compileCore(`
def choose(value: number) -> number:
    if value > 2:
        return value * 2
    return value + 1
`.trimStart(), { path: "mapped.vel" });
  assert.deepEqual(result.diagnostics, []);
  const map = JSON.parse(result.sourceMap ?? "{}") as { mappings?: string };
  const generatedIf = map.mappings?.split(";")[1] ?? "";
  assert.ok(generatedIf.split(",").filter(Boolean).length >= 4, generatedIf);
});

test("source maps preserve exact positions when generated child text is repeated and reordered", () => {
  const source = `
def echo(value: string) -> string:
    return value

const value = "same"
const result = echo(value=value)
`.trimStart();
  const result = compileCore(source, { path: "named-arguments.vel" });
  assert.deepEqual(result.diagnostics, []);
  const generatedLines = (result.code ?? "").split("\n");
  const generatedLine = generatedLines.findIndex((line) => line.includes("const result"));
  const generated = generatedLines[generatedLine] ?? "";
  const sourceLines = source.split("\n");
  const sourceLine = sourceLines.findIndex((line) => line.includes("const result"));
  const original = sourceLines[sourceLine] ?? "";
  const sourceMap = new SourceMap(JSON.parse(result.sourceMap ?? "{}"));

  const callee = sourceMap.findEntry(generatedLine, generated.indexOf("echo(")) as { originalLine: number; originalColumn: number };
  assert.equal(callee.originalLine, sourceLine);
  assert.equal(callee.originalColumn, original.indexOf("echo("));

  const argument = sourceMap.findEntry(generatedLine, generated.lastIndexOf("value")) as { originalLine: number; originalColumn: number };
  assert.equal(argument.originalLine, sourceLine);
  assert.equal(argument.originalColumn, original.lastIndexOf("value"));
});

test("Web source maps retain nested JSX elements, attributes, text, and expressions", () => {
  const source = `
component Child(label: string):
    return <span>{label}</span>

component App:
    const title = "ready"
    return <main><section aria-label="panel"><Child label={title} /><p>{title}</p><strong>Static</strong></section></main>
`.trimStart();
  const result = compile(source, { path: "jsx-map.vel" });
  assert.deepEqual(result.diagnostics, []);
  const generatedLines = (result.code ?? "").split("\n");
  const generatedLine = generatedLines.findIndex((line) => line.includes('__velarCreateElement("section"'));
  const generated = generatedLines[generatedLine] ?? "";
  const sourceMap = new SourceMap(JSON.parse(result.sourceMap ?? "{}"));
  const sourceText = new SourceText("jsx-map.vel", source);
  const assertMapped = (generatedNeedle: string, sourceOffset: number): void => {
    const generatedColumn = generated.indexOf(generatedNeedle);
    assert.ok(generatedColumn >= 0, generatedNeedle);
    const entry = sourceMap.findEntry(generatedLine, generatedColumn) as { originalLine: number; originalColumn: number };
    const expected = sourceText.location(sourceOffset);
    assert.equal(entry.originalLine, expected.line - 1, generatedNeedle);
    assert.equal(entry.originalColumn, expected.column - 1, generatedNeedle);
  };

  assertMapped('__velarCreateElement("main"', source.indexOf("<main"));
  assertMapped('__velarCreateElement("section"', source.indexOf("<section"));
  assertMapped("__velarStaticAttr(__el", source.indexOf("aria-label"));
  assertMapped("__velarChild(Child,", source.indexOf("<Child"));
  assertMapped("label:", source.indexOf("label={"));
  assertMapped('__velarCreateElement("p"', source.indexOf("<p>"));
  assertMapped("=> title", source.lastIndexOf("title"));
  assertMapped('__velarCreateElement("strong"', source.indexOf("<strong>"));
  assertMapped('document.createTextNode("Static")', source.indexOf("Static"));
});

test("imported classes preserve construction, aliases, and nominal checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-module-class-"));
  const output = join(directory, "dist");
  await writeFile(join(directory, "models.vel"), `
export class Player:
    const name: string

    constructor(name: string):
        self.name = name

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

test("VelarScript classes use module identities instead of colliding display names", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-class-identity-"));
  await writeFile(join(directory, "first.vel"), "export class Session:\n    const id: string\n\n    constructor(id: string):\n        self.id = id\n", "utf8");
  await writeFile(join(directory, "second.vel"), "export class Session:\n    const id: string\n\n    constructor(id: string):\n        self.id = id\n", "utf8");
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

class Circle extends Shape:
    const radius: number

    constructor(radius: number):
        super()
        self.radius = radius

    override def area() -> number:
        return self.radius * self.radius

class Entity:
    const id: string

    constructor(id: string):
        self.id = id

    def describe() -> string:
        return self.id

class Player extends Entity:
    let score: number

    constructor(id: string, score: number = 0):
        super(id)
        self.score = score

    override def describe() -> string:
        return f"{super.describe()}:{self.score}"

    static def guest() -> Player:
        return Player("guest", 1)

class ValidationError extends Error:
    const field: string

    constructor(field: string, message: string):
        super(message)
        self.field = field

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

test("super follows class-member lexical boundaries and supports checked static overrides", () => {
  const result = compile(`
class Base:
    static const prefix: string = "base"

    static get category() -> string:
        return "entity"

    static def label() -> string:
        return Base.prefix

    def instanceLabel() -> string:
        return "instance"

class Child extends Base:
    override static get category() -> string:
        return super.category + ":child"

    override static def label() -> string:
        const read = () => super.label()
        return f"{read()}:{super.prefix}"

    override def instanceLabel() -> string:
        const read = () => super.instanceLabel()
        return read() + ":child"

print(Child.category)
print(Child.label())
print(Child().instanceLabel())
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "entity:child\nbase:base\ninstance:child\n");

  const nestedFunction = compile(`
class Base:
    def label() -> string:
        return "base"

class Child extends Base:
    override def label() -> string:
        def nested() -> string:
            return super.label()
        return nested()
`.trimStart());
  assert.ok(nestedFunction.diagnostics.some((item) => /nested arrow/u.test(item.message)), JSON.stringify(nestedFunction.diagnostics));
  assert.equal(nestedFunction.code, null);

  const missingOverride = compile(`
class Base:
    static get category() -> string:
        return "base"

    static def label() -> string:
        return "base"

class Child extends Base:
    static get category() -> string:
        return "child"

    static def label() -> string:
        return "child"
`.trimStart());
  assert.equal(missingOverride.diagnostics.filter((item) => /must use 'override'/u.test(item.message)).length, 2);

  const invalid = compile(`
class Base:
    static const version: string = "1"

    static def label(value: string) -> string:
        return value

class Child extends Base:
    static const version: string = "2"

    override static def label(value: number) -> string:
        return str(value)
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /static fields cannot be overridden/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /must keep the base method signature/u.test(item.message)));
});

test("constructors initialize fields once after the base constructor and preserve bound methods", () => {
  const result = compile(`
def invoke(callback: () -> null):
    callback()

class Base:
    let steps: List<string>

    constructor(steps: List<string>):
        self.steps = steps
        self.steps.append("base")

class Child extends Base:
    const value: number
    let doubled: number

    constructor(steps: List<string>, value: number):
        super(steps)
        self.value = value
        self.doubled = value * 2
        assert value > 0 else "Value must be positive"
        invoke(self.record)

    def record():
        self.steps.append(f"value:{self.doubled}")

const steps: List<string> = []
const child = Child(steps, 3)
print(steps[0])
print(steps[1])
print(child.doubled)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /super\(steps\);/u);
  assert.match(result.code ?? "", /self\.value = value;/u);
  assert.match(result.code ?? "", /self\.doubled = \(value \* 2\);/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "base\nvalue:6\n6\n");

  for (const binding of ["const", "let"]) {
    const duplicateInitializer = compile(`class Invalid:
    ${binding} value: number = 1

    constructor():
        self.value = 2
`);
    assert.equal(duplicateInitializer.diagnostics.filter((item) => /initializes field 'value' more than once/u.test(item.message)).length, 1);
  }

  const inheritedConst = compile(`
class Base:
    const id: string

    constructor(id: string):
        self.id = id

class Child extends Base:
    constructor():
        super("fixed")
        self.id = "other"
`.trimStart());
  assert.ok(inheritedConst.diagnostics.some((item) => /Cannot assign to const field 'id'/u.test(item.message)));
});

test("constructors own one synchronous non-returning execution boundary", () => {
  const valid = compile(`
async def ready() -> number:
    return 1

class Scheduler:
    constructor():
        async def later() -> number:
            return await ready()
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);

  const direct = compile(`
async def ready() -> number:
    return 1

class Invalid:
    constructor():
        const value = await ready()
        return null
`.trimStart());
  assert.ok(direct.diagnostics.some((item) => item.code === "VEL4007" && /constructor/u.test(item.message)));
  assert.ok(direct.diagnostics.some((item) => item.code === "VEL3014" && /constructor/u.test(item.message)));

  const duplicate = compile("class Invalid:\n    constructor():\n        pass\n    constructor():\n        pass\n");
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL2022" && /more than one constructor/u.test(item.message)));

  for (const modifier of ["async", "static", "override", "abstract"]) {
    const modified = compile(`class Invalid:\n    ${modifier} constructor():\n        pass\n`);
    assert.ok(modified.diagnostics.some((item) => item.code === "VEL2022" && /does not accept method modifiers/u.test(item.message)), JSON.stringify(modified.diagnostics));
  }
});

test("init remains an ordinary identifier after the init block syntax is removed", () => {
  const result = compile(`
type Options:
    init: string

class Worker:
    const label: string

    constructor(label: string):
        self.label = label
        assert label != ""

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
class Ledger:
    static const kind: string = "ledger"
    static let created: number = 0
    const label: string
    const display: string
    const entries: List<number> = []
    let total: number = 0

    constructor(label: string):
        self.label = label
        self.display = f"{label} ledger"

    def add(value: number):
        self.entries.append(value)
        self.total += value

    def summary() -> string:
        return f"{self.display}:{self.total}:{self.entries.size}"

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
  assert.match(result.code ?? "", /constructor\(label\)/u);
  assert.match(result.code ?? "", /self\.label = label;/u);
  assert.match(result.code ?? "", /self\.display = `\$\{label\} ledger`;/u);
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

test("static fields cannot expose JavaScript initialization-order undefined", () => {
  const direct = compile(`
class Counter:
    static const first: number = Counter.second
    static const second: number = 2
`.trimStart());
  assert.ok(direct.diagnostics.some((item) => /Static field 'second' is read before it is initialized/u.test(item.message)));

  const privateDirect = compile(`
class Counter:
    private static const first: number = Counter.second
    private static const second: number = 2
`.trimStart());
  assert.ok(privateDirect.diagnostics.some((item) => /Static field 'second' is read before it is initialized/u.test(item.message)));

  const indirect = compile(`
class Counter:
    static const first: number = Counter.readSecond()
    static const second: number = 2

    static def readSecond() -> number:
        return Counter.second
`.trimStart());
  assert.deepEqual(indirect.diagnostics, []);
  assert.match(indirect.code ?? "", /__velarReadStaticField\(Counter, "second", 0\)/u);
  const failed = executeModule(indirect.code ?? "");
  assert.notEqual(failed.status, 0);
  assert.match(String(failed.stderr), /Static field 'second' was read before initialization/u);

  const compound = compile(`
class Label:
    static const first: string = Label.extend()
    static let second: string = "ready"

    static def extend() -> string:
        Label.second += "!"
        return Label.second
`.trimStart());
  assert.deepEqual(compound.diagnostics, []);
  const compoundFailure = executeModule(compound.code ?? "");
  assert.notEqual(compoundFailure.status, 0);
  assert.match(String(compoundFailure.stderr), /Static field 'second' was read before initialization/u);

  const valid = compile(`
async def next() -> number:
    return 3

class Base:
    static const value: number = 2

class Derived extends Base:
    static const copy: number = Derived.value
    static const load: () -> Promise<number> = async () => await next()

print(Derived.copy)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /__velarReadStaticField\(Derived, "value", 1\)/u);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n");
});

test("instance fields cannot expose partially initialized JavaScript values", () => {
  const direct = compile(`
class User:
    const name: string

    constructor():
        print(self.name)
        self.name = "Ada"

User()
`.trimStart());
  assert.deepEqual(direct.diagnostics, []);
  assert.match(direct.code ?? "", /__velarReadInstanceField\(self, "name"\)/u);
  const directFailure = executeModule(direct.code ?? "");
  assert.notEqual(directFailure.status, 0);
  assert.match(String(directFailure.stderr), /Field 'name' was read before initialization/u);

  const privateDirect = compile(`
class Vault:
    private const secret: string

    constructor():
        print(self.secret)
        self.secret = "token"

Vault()
`.trimStart());
  assert.deepEqual(privateDirect.diagnostics, []);
  assert.match(privateDirect.code ?? "", /__velarReadPrivateField\(self\.#secret, "secret"\)/u);
  const privateFailure = executeModule(privateDirect.code ?? "");
  assert.notEqual(privateFailure.status, 0);
  assert.match(String(privateFailure.stderr), /Private field 'secret' was read before initialization/u);

  const dynamicDispatch = compile(`
class Base:
    constructor():
        self.validate()

    def validate():
        pass

class Child extends Base:
    const name: string

    constructor():
        super()
        self.name = "Ada"

    override def validate():
        print(self.name)

Child()
`.trimStart());
  assert.deepEqual(dynamicDispatch.diagnostics, []);
  const dispatchFailure = executeModule(dynamicDispatch.code ?? "");
  assert.notEqual(dispatchFailure.status, 0);
  assert.match(String(dispatchFailure.stderr), /Field 'name' was read before initialization/u);

  const valid = compile(`
class Score:
    let value: number = 2

    def add(amount: number):
        self.value += amount

const score = Score()
score.add(3)
print(score.value)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "5\n");
});

test("class member names cannot reopen JavaScript constructor or prototype behavior", () => {
  for (const source of [
    `class Invalid:\n    const __proto__: string = "value"\n`,
    `class Invalid:\n    static const prototype: string = "value"\n`,
    `class Invalid:\n    def constructor() -> string:\n        return "value"\n`,
    `class Invalid:\n    get constructor() -> string:\n        return "value"\n`,
    `class Invalid:\n    private def constructor() -> string:\n        return "value"\n`,
    `extern module "library":\n    export class Invalid:\n        static const prototype: string\n`,
  ]) {
    const result = compile(source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL4014"), JSON.stringify(result.diagnostics));
    assert.equal(result.code, null);
  }

  const record = compile(`
type Metadata:
    constructor: string
    prototype: string
    __proto__: string

const value: Metadata = {constructor: "data", prototype: "data", "__proto__": "data"}
const {constructor, prototype, __proto__} = value
print(constructor + prototype + __proto__)
`.trimStart());
  assert.deepEqual(record.diagnostics, []);
  const execution = executeModule(record.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "datadatadata\n");
});

test("class getters expose native read-only derived properties with explicit inheritance", () => {
  const result = compile(`
abstract class Metric:
    abstract get label() -> string

class BaseMetric:
    const name: string

    constructor(name: string):
        self.name = name

    get label() -> string:
        return self.name

class Score extends BaseMetric:
    private const points: number

    constructor(name: string, points: number):
        super(name)
        self.points = points

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
class Vault:
    private const secret: string
    private static const category: string = "vault"
    private static const fullCategory: string = Vault.category + "-store"
    private const prefix: string = "token"
    private let reads: number = 0

    constructor(secret: string):
        self.secret = secret

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
class Vault:
    private const secret: string
    private static const category: string = "vault"
    private let reads: number = 0

    constructor(secret: string):
        self.secret = secret

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
export class Vault:
    private const secret: string
    private static const category: string = "vault"
    /// Tracks how often the secret was opened.
    private let reads: number = 0

    constructor(secret: string):
        self.secret = secret

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
export class ScoreCard:
    const label: string
    private const values: List<number>

    constructor(label: string, values: List<number>):
        self.label = label
        self.values = values

    /// Number of recorded values.
    get count() -> number:
        return self.values.size

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

test("abstract getter contracts retain identity across VelarScript modules", async () => {
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
export class ScoreCard:
    static const category: string = "score"
    const label: string
    const history: List<number> = []
    let total: number = 0

    constructor(label: string):
        self.label = label
        assert self.label != "" else "ScoreCard label cannot be empty"

    def add(value: number):
        self.history.append(value)
        self.total += value

export class TeamCard extends ScoreCard:
    constructor():
        super("Team")
`.trimStart();
  const mainSource = `
import {ScoreCard as Card, TeamCard} from "./model.vel"
const card = Card("Team")
card.add(5)
const team = TeamCard()
team.add(3)
print(Card.category)
print(card.total)
print(card.history.size)
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
  const labelInitUse = modelSource.indexOf("self.label !=") + "self.".length;
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

  const inheritedConst = compile("class Base:\n    const id: string\n\n    constructor(id: string):\n        self.id = id\n\nclass Child extends Base:\n    constructor():\n        super(\"fixed\")\n\n    def change():\n        self.id = \"other\"\n");
  assert.ok(inheritedConst.diagnostics.some((item) => /Cannot assign to const field 'id'/.test(item.message)));

  const localFieldMethodCollision = compile("class User:\n    const name: string\n\n    constructor(name: string):\n        self.name = name\n\n    def name() -> string:\n        return self.name\n");
  assert.ok(localFieldMethodCollision.diagnostics.some((item) => /conflicts with a field declared by class 'User'/.test(item.message)));

  const inheritedFieldMethodCollision = compile("class Base:\n    def name() -> string:\n        return \"base\"\n\nclass Child extends Base:\n    const name: string\n\n    constructor(name: string):\n        super()\n        self.name = name\n");
  assert.ok(inheritedFieldMethodCollision.diagnostics.some((item) => /Field 'name' conflicts with an inherited method/.test(item.message)));
});

test("inheritance metadata crosses VelarScript module boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-module-inheritance-"));
  const output = join(directory, "dist");
  const basePath = join(directory, "base.vel");
  const playerPath = join(directory, "player.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(basePath, `
export abstract class Entity:
    const id: string

    constructor(id: string):
        self.id = id

    def label() -> string:
        return self.id
`.trimStart(), "utf8");
  await writeFile(playerPath, `
import {Entity} from "./base.vel"
export class Player extends Entity:
    constructor(id: string):
        super(id)

    def score() -> number:
        return 1

    static def score(id: string) -> Player:
        return Player(id)

export class NamedPlayer extends Player:
    constructor(id: string):
        super(id)

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
  const baseUse = playerText.indexOf("extends Entity") + "extends ".length;
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
  assert.equal(fieldReferences.length, 3);
  const fieldRename = projectRenameAt(project, basePath, baseId + 1, "identifier");
  assert.notEqual(typeof fieldRename, "string");
  if (typeof fieldRename !== "string") assert.equal(fieldRename.edits.length, 3);
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

class Player:
    const name: string

    constructor(name: string):
        self.name = name

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
const folder = Folder.parse({name: "docs", entries: [{name: "guide.md", folder: null}]})
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
class Counter:
    const value: number

    constructor(value: number):
        self.value = value

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

test("normalizes optional members and calls to null", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

class Box:
    const value: string

    constructor(value: string):
        self.value = value

    def label() -> string:
        return self.value

const user = User.parse({name: "Ada"})
let box: Box? = null
print(user.avatar == null)
print(box?.label() == null)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /user\.avatar \?\? null/);
  assert.match(result.code ?? "", /\(box \?\? null\)\?\.label\?\.\(\) \?\? null/);
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

const absent: Envelope? = null
const present: Envelope = {details: {groups: [null, "42"], format: () => "ready"}}
let loads = 0
let indexes = 0

def loadAbsent() -> Envelope?:
    loads += 1
    return null

def nextIndex() -> number:
    indexes += 1
    return 0

print(absent?.details?.groups?.[0] ?? "missing")
print(present.details?.groups?.[1] ?? "missing")
print(absent?.details?.format?.() ?? "missing")
print(present.details?.format?.() ?? "missing")
print(absent?.details?.groups?.slice(1)?.size ?? -1)
print(present.details?.groups?.slice(1)?.size ?? -1)
print(loadAbsent()?.details?.groups?.[0] ?? "missing")
print(loads)
print(absent?.details?.groups?.[nextIndex()] ?? "missing")
print(indexes)
print(present.details?.groups?.[nextIndex()] ?? "missing")
print(indexes)
try:
    print(present.details?.groups?.[9] ?? "missing")
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

let value: Envelope? = null
const hooks: Hooks = {handler: null}
value?.details = null
value?.details.groups[0] = "changed"
const indexed = value.details.groups[0]
const called = hooks.handler()
`.trimStart());
  assert.ok(invalid.diagnostics.filter((item) => /Optional chains cannot be assignment targets/u.test(item.message)).length >= 2);
  assert.ok(invalid.diagnostics.some((item) => /Use optional access '\?\.'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /presence check or an optional access chain/u.test(item.message)));
});

test("web extension reports optional-access diagnostics on '+' operands exactly once", () => {
  const source = `
type Person:
    name: string
    age: number

let person: Person? = null
const message = person.name + "!" + person.name
const negated = -person.age
`.trimStart();
  const core = compileCore(source);
  const web = compile(source);
  assert.ok(core.diagnostics.length > 0);
  assert.deepEqual(
    web.diagnostics.map((item) => ({ code: item.code, message: item.message, span: item.span })),
    core.diagnostics.map((item) => ({ code: item.code, message: item.message, span: item.span })),
  );
});

test("optional calls and indexes carry successful-chain facts into deferred expressions", () => {
  const result = compileCore(`
class Service:
    const name: string

    constructor(name: string):
        self.name = name

    def format(value: string) -> string:
        return f"{self.name}:{value}"

def use(service: Service?) -> string?:
    return service?.format(service.name)

def invoke(callback: ((string) -> string)?) -> string?:
    return callback?.(callback("inner"))

def last(values: List<string>?) -> string?:
    return values?.[values.size - 1]

def first(callbacks: List<() -> string>?) -> string?:
    return callbacks?.[0]()

const service: Service? = Service("Ada")
const shout: ((string) -> string)? = value => value
const callbacks: List<() -> string> = [() => "ready"]
const noCallbacks: List<() -> string>? = null
print(use(null) == null)
print(use(service))
print(invoke(null) == null)
print(invoke(shout))
print(last(null) == null)
print(last(["a", "b"]))
print(first(noCallbacks) == null)
print(first(callbacks))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nAda:Ada\ntrue\ninner\ntrue\nb\ntrue\nready\n");

  const skippedIndex = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> number:
    box.user = null
    return 0

def keep(box: Box) -> string:
    assert box.user
    const skipped = null?.[clear(box)]
    return box.user.name

print(keep({user: {name: "Ada"}}))
`.trimStart());
  assert.deepEqual(skippedIndex.diagnostics, []);
  const skippedExecution = executeModule(skippedIndex.code ?? "");
  assert.equal(skippedExecution.status, 0, String(skippedExecution.stderr));
  assert.equal(skippedExecution.stdout, "Ada\n");
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
    return value ? "present" : "null"

def inverseNumberLabel(value: number?) -> string:
    return not value ? "null" : "present"

print(numberLabel(0))
print(inverseNumberLabel(0))
`);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "present\npresent\n");
});

test("short-circuit conditions and while bodies preserve optional narrowing", () => {
  const result = compile(`
type User:
    name: string
    active: bool
    manager: User?

let probes = 0

def probe() -> bool:
    probes += 1
    return true

def managerName(user: User?) -> string:
    if user and user.manager and user.manager.active:
        return user.manager.name
    return "missing"

def status(user: User?) -> string:
    if user == null or not user.active:
        return "inactive"
    else:
        return user.name

const absent: User? = null
const present: User? = {
    name: "Ada",
    active: true,
    manager: {name: "Lin", active: true, manager: null},
}

print(absent and probe())
print(probes)
print(present and probe())
print(probes)
print(present or probe())
print(probes)
print(absent or probe())
print(probes)
print(managerName(present))
print(managerName(absent))
print(status(present))

let current: User? = present
while current:
    print(current.name)
    current = null
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\(absent \?\? null\) != null\) && probe/u);
  assert.match(result.code ?? "", /\(present \?\? null\) != null\) \|\| probe/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "false\n0\ntrue\n1\ntrue\n1\ntrue\n2\nLin\nmissing\nAda\nAda\n");

  const stale = compile(`
type User:
    active: bool

let current: User? = {active: true}
if current and current.active:
    current = null
    const invalid: User = current
`.trimStart());
  assert.equal(stale.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("condition narrowing reuses analyzed types without inventing bindings", () => {
  const missingEquality = compile(`
if missing() == null:
    pass
else:
    pass
`.trimStart());
  assert.deepEqual(
    missingEquality.diagnostics.map((item) => item.message),
    ["Unknown name 'missing'"],
  );

  const missingMember = compile(`
if unknown.field == null:
    pass
else:
    pass
`.trimStart());
  assert.deepEqual(
    missingMember.diagnostics.map((item) => item.message),
    ["Unknown name 'unknown'", "Cannot access 'field' on unknown without validation"],
  );

  const missingTypeCheck = compile(`
if missing is string:
    print(missing)
`.trimStart());
  assert.equal(
    missingTypeCheck.diagnostics.filter((item) => item.message === "Unknown name 'missing'").length,
    2,
  );

  const missingMemberTypeCheck = compile(`
if unknown.field is string:
    pass
else:
    pass
`.trimStart());
  assert.deepEqual(
    missingMemberTypeCheck.diagnostics.map((item) => item.message),
    ["Unknown name 'unknown'", "Cannot access 'field' on unknown without validation"],
  );
});

test("mutually exclusive branches isolate and merge narrowing facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def guardLabel(user: User?) -> string:
    if user == null:
        return "missing"
    return user.name

def explicitElseLabel(user: User?) -> string:
    if user == null:
        return "missing"
    else:
        pass
    return user.name

def inverseElseLabel(user: User?) -> string:
    if user != null:
        pass
    else:
        return "missing"
    return user.name

def bindingLabel(initial: User?, change: bool) -> string:
    let user = initial
    assert user
    if change:
        user = null
    else:
        return user.name
    return "changed"

def memberLabel(box: Box, change: bool) -> string:
    assert box.user
    if change:
        box.user = null
    else:
        return box.user.name
    return "changed"

def returningMutation(initial: User?, change: bool) -> string:
    let user = initial
    assert user
    if change:
        user = null
        return "changed"
    return user.name

const ada: User = {name: "Ada"}
print(guardLabel(ada))
print(guardLabel(null))
print(explicitElseLabel(ada))
print(inverseElseLabel(ada))
print(bindingLabel(ada, false))
print(bindingLabel(ada, true))
print(memberLabel({user: ada}, false))
print(memberLabel({user: ada}, true))
print(returningMutation(ada, false))
print(returningMutation(ada, true))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nmissing\nAda\nAda\nAda\nchanged\nAda\nchanged\nAda\nchanged\n");

  const merged = compile(`
type User:
    name: string

def invalid(initial: User?, change: bool):
    let user = initial
    assert user
    if change:
        user = null
    const stale: User = user
`.trimStart());
  assert.equal(merged.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);

  const reassignedContinuation = compile(`
type User:
    name: string

def invalid(initial: User?) -> string:
    let user = initial
    if user == null:
        return "missing"
    else:
        user = null
    return user.name
`.trimStart());
  assert.equal(reassignedContinuation.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);
});

test("continuing branches preserve facts established on every path", () => {
  const result = compile(`
type User:
    name: string

def label(user: User?, alternate: bool) -> string:
    if alternate:
        assert user
    else:
        assert user
    return user.name

print(label({name: "Ada"}, false))
print(label({name: "Lin"}, true))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nLin\n");
});

test("try catch and finally merge only paths that can continue", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def normalOrCaught(box: Box, fail: bool) -> string:
    assert box.user
    try:
        if fail:
            throw Error("stop")
    catch error:
        box.user = null
        return "caught"
    return box.user.name

def assertedOnBothPaths(initial: User?, fail: bool) -> string:
    let user = initial
    try:
        if fail:
            throw Error("stop")
        assert user
    catch error:
        assert user
    return user.name

def assertedInFinally(user: User?) -> string:
    try:
        pass
    finally:
        assert user
    return user.name

print(normalOrCaught({user: {name: "Ada"}}, false))
print(normalOrCaught({user: {name: "Ada"}}, true))
print(assertedOnBothPaths({name: "Mira"}, false))
print(assertedOnBothPaths({name: "Mira"}, true))
print(assertedInFinally({name: "Kai"}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\ncaught\nMira\nMira\nKai\n");

  const invalidCatch = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box) -> string:
    assert box.user
    try:
        box.user = null
        throw Error("stop")
    catch error:
        return box.user.name
`.trimStart());
  assert.equal(invalidCatch.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);

  const invalidFinally = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box) -> string:
    assert box.user
    try:
        pass
    finally:
        box.user = null
    return box.user.name
`.trimStart());
  assert.equal(invalidFinally.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);
});

test("unreachable writes do not corrupt continuing flow facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def caught(box: Box, failure: Error) -> string:
    assert box.user
    try:
        throw failure
        box.user = null
    catch error:
        return box.user.name

def stoppedLoop(box: Box) -> string:
    assert box.user
    for value in [1]:
        break
        box.user = null
    return box.user.name

print(caught({user: {name: "Ada"}}, Error("stop")))
print(stoppedLoop({user: {name: "Lin"}}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nLin\n");

  const reachable = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box):
    assert box.user
    try:
        box.user = null
        throw Error("stop")
    catch error:
        const stale: User = box.user
`.trimStart());
  assert.equal(reachable.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("terminating loop bodies preserve facts on the skipped path", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def firstOrOwner(box: Box, values: List<number>) -> string:
    assert box.user
    for value in values:
        box.user = null
        return str(value)
    return box.user.name

def waitOrRead(user: User?) -> string:
    while user == null:
        return "missing"
    return user.name

print(firstOrOwner({user: {name: "Ada"}}, []))
print(firstOrOwner({user: {name: "Ada"}}, [7]))
print(waitOrRead({name: "Lin"}))
print(waitOrRead(null))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n7\nLin\nmissing\n");

  const continuing = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box, values: List<number>):
    assert box.user
    for value in values:
        box.user = null
    const stale: User = box.user
`.trimStart());
  assert.equal(continuing.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("member receivers are analyzed once across calls and assignments", () => {
  const call = compile("missing.run()\n");
  assert.deepEqual(
    call.diagnostics.map((item) => item.message),
    ["Unknown name 'missing'", "Cannot access 'run' on unknown without validation"],
  );

  const assignment = compile("missing.field = 1\n");
  assert.deepEqual(
    assignment.diagnostics.map((item) => item.message),
    ["Unknown name 'missing'", "Cannot access 'field' on unknown without validation"],
  );
});

test("ordinary calls preserve mutable flow facts and local const values stay stable", () => {
  const safe = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box):
    box.user = null

def label(box: Box) -> string:
    assert box.user
    const user = box.user
    clear(box)
    return user.name

print(label({user: {name: "Ada"}}))
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);
  const execution = executeModule(safe.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");

  // A call is not an invalidation point, even when the callee assigns to the
  // narrowed location: only assignments visible at this frame invalidate.
  const aliasedMember = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box):
    box.user = null

def label(box: Box) -> string:
    assert box.user
    clear(box)
    return box.user.name
`.trimStart());
  assert.equal(aliasedMember.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // Invoking a closure that writes a captured binding keeps the caller's fact.
  const capturedBinding = compile(`
type User:
    name: string

def label(initial: User?) -> string:
    let user = initial

    def clear():
        user = null

    assert user
    clear()
    return user.name
`.trimStart());
  assert.equal(capturedBinding.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // A call in the right operand of a short-circuit keeps the left-side fact.
  const shortCircuit = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> bool:
    box.user = null
    return true

def label(box: Box) -> string:
    if box.user and clear(box):
        return box.user.name
    return "missing"
`.trimStart());
  assert.equal(shortCircuit.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const deferredClosure = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box) -> string:
    assert box.user

    def clearLater():
        print("later")
        box.user = null

    return box.user.name

print(label({user: {name: "Ada"}}))
`.trimStart());
  assert.deepEqual(deferredClosure.diagnostics, []);
  const deferredExecution = executeModule(deferredClosure.code ?? "");
  assert.equal(deferredExecution.status, 0, String(deferredExecution.stderr));
  assert.equal(deferredExecution.stdout, "Ada\n");

  const invokedClosure = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box) -> string:
    assert box.user

    def clearLater():
        box.user = null

    clearLater()
    return box.user.name
`.trimStart());
  assert.equal(invokedClosure.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("narrowed facts persist across calls, await, interpolation, and getter reads until assignment", () => {
  // The positive statement of the narrowing rule: facts established on a let
  // binding or member location survive (a) an ordinary call, (b) await,
  // (c) f-string object interpolation, and (d) a getter read. Only a direct
  // assignment to the narrowed location drops the fact.
  const persistent = compileCore(`
type User:
    name: string

type Box:
    user: User?

class Host:
    get status() -> string:
        return "ready"

def touch(box: Box) -> string:
    return "touched"

async def label(box: Box, initial: User?, pending: Promise<null>, host: Host) -> string:
    let user = initial
    assert user
    assert box.user
    const afterCall = touch(box)
    const viaCall: string = box.user.name + user.name
    await pending
    const viaAwait: string = box.user.name + user.name
    const text = f"{box}"
    const viaInterpolation: string = box.user.name + user.name
    const status = host.status
    const viaGetter: string = box.user.name + user.name
    return viaGetter
`.trimStart());
  assert.equal(persistent.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const assignmentStillInvalidates = compileCore(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box, initial: User?) -> string:
    let user = initial
    assert user
    assert box.user
    box.user = null
    user = null
    return box.user.name + user.name
`.trimStart());
  assert.equal(assignmentStillInvalidates.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 2);
});

test("member writes invalidate aliased facts but unrelated locations keep facts", () => {
  const aliased = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box) -> string:
    const alias = box
    assert box.user
    alias.user = null
    return box.user.name
`.trimStart());
  assert.equal(aliased.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);

  // Writing to an extern member is an assignment to THAT location: facts
  // narrowed on unrelated locations survive it.
  const externalSetter = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        let value: number
        constructor()

import js {Client} from "host-sdk"

def label(client: Client, initial: User?) -> string:
    let user = initial
    assert user
    client.value = 1
    return user.name
`.trimStart());
  assert.equal(externalSetter.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const setterReadsNarrowed = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        let value: number
        constructor()

import js {Client} from "host-sdk"

def label(client: Client, initial: User?) -> string:
    let user = initial
    assert user
    client.value = user.name.length
    return user.name
`.trimStart());
  assert.equal(setterReadsNarrowed.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // A compound write on an unsafe host value targets client.value only; the
  // narrowed local binding keeps its fact through both read and write.
  const unsafeCompoundRead = compileCore(`
type User:
    name: string

import js unsafe {client} from "host-sdk"

def label(initial: User?) -> string:
    let user = initial
    assert user
    client.value += user.name.length
    return user.name
`.trimStart());
  assert.equal(unsafeCompoundRead.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const stableLocal = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        let value: number
        constructor()

import js {Client} from "host-sdk"

def label(client: Client, initial: User?) -> string:
    const user = initial
    assert user
    client.value = 1
    return user.name
`.trimStart());
  assert.deepEqual(stableLocal.diagnostics, []);
});

test("external class checks account for JavaScript Symbol.hasInstance hooks", () => {
  // An 'is' check against an extern class may run a hasInstance hook, but the
  // check is an ordinary read: facts on unrelated locations survive it.
  const external = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user
    const matches = value is Client
    return user.name
`.trimStart());
  assert.equal(external.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const externalMatch = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user
    match value:
        case Client:
            return "client"
        else:
            return user.name
`.trimStart());
  assert.equal(externalMatch.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const externalExhaustiveness = compile(`
extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def label(value: Client) -> string:
    match value:
        case Client:
            return "client"
`.trimStart());
  assert.ok(externalExhaustiveness.diagnostics.some((item) => item.code === "VEL4006"));

  const externalGuard = compile(`
type User:
    manager: User?

extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def absent(value: null) -> string:
    return "none"

def invalid(client: Client, user: User) -> string:
    match client:
        case Client if user.manager:
            return "managed"
        else:
            return absent(user.manager)
`.trimStart());
  assert.ok(externalGuard.diagnostics.some((item) => /Cannot assign User\? to null/u.test(item.message)));

  const local = compile(`
type User:
    name: string

class Client:
    pass

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user
    const matches = value is Client
    return user.name
`.trimStart());
  assert.deepEqual(local.diagnostics, []);
});

test("runtime record type checks are ordinary reads over any value source", () => {
  const sourcePrefix = `
type User:
    name: string

extern module "host-sdk":
    export def load() -> User

import js {load} from "host-sdk"
`;
  // Running a record validator on a host-returned value is an ordinary read:
  // it does not drop facts narrowed on unrelated locations.
  const checked = compile(`${sourcePrefix}
def label(initial: User?) -> string:
    const remote = load()
    let user = initial
    assert user
    const matches = remote is User
    return user.name
`);
  assert.equal(checked.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const matched = compile(`${sourcePrefix}
def label(initial: User?) -> string:
    const remote = load()
    let user = initial
    assert user
    match remote:
        case User:
            return "remote"
        else:
            return user.name
`);
  assert.equal(matched.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // 'case User' on a User-typed value is exhaustive regardless of where the
  // value came from.
  const exhaustive = compile(`${sourcePrefix}
def label() -> string:
    const remote = load()
    match remote:
        case User:
            return remote.name
`);
  assert.deepEqual(exhaustive.diagnostics, []);

  const unknownCheck = compile(`
type User:
    name: string

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user
    const matches = value is User
    return user.name
`.trimStart());
  assert.equal(unknownCheck.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("conditional expression call branches preserve narrowing facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def choose(box: Box, changed: bool) -> string:
    assert box.user
    return changed ? clear(box) : box.user.name

print(choose({user: {name: "Ada"}}, false))
print(choose({user: {name: "Ada"}}, true))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\ncleared\n");

  // A call in one branch of a conditional expression carries no invalidation
  // into the merge: only assignments in the branches themselves would.
  const merged = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def label(box: Box, changed: bool) -> string:
    assert box.user
    const status = changed ? clear(box) : "kept"
    return box.user.name
`.trimStart());
  assert.equal(merged.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("getter results are not stable narrowing locations", () => {
  const safe = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get current() -> User?:
        const result = self.user
        self.user = null
        return result

def label(box: Box) -> string:
    const current = box.current
    if current:
        return current.name
    return "missing"

print(label(Box()))
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);
  const execution = executeModule(safe.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");

  // Reading a getter is an ordinary read: it does not drop facts narrowed on
  // other locations, even when the getter body assigns to them.
  const getterReadKeepsFacts = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get current() -> User?:
        const result = self.user
        self.user = null
        return result

def label(box: Box) -> string:
    assert box.user
    const current = box.current
    return box.user.name
`.trimStart());
  assert.equal(getterReadKeepsFacts.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // A getter itself is still not a narrowable location: each read may produce
  // a different value, so checking box.current cannot guard a second read.
  const repeatedGetter = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get current() -> User?:
        const result = self.user
        self.user = null
        return result

def invalid(box: Box) -> string:
    if box.current:
        return box.current.name
    return "missing"
`.trimStart());
  assert.equal(repeatedGetter.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);

  // Extern declarations are trusted ABI contracts: a member declared as a
  // field is a stable narrowing location, exactly like a local class field.
  const externField = compile(`
extern module "host-sdk":
    export class Client:
        const label: List<string>?
        constructor()

import js {Client} from "host-sdk"

def read(client: Client) -> number:
    if client.label:
        return client.label.size
    return 0
`.trimStart());
  assert.equal(externField.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const stableExternalValue = compile(`
extern module "host-sdk":
    export class Client:
        const label: List<string>?
        constructor()

import js {Client} from "host-sdk"

def size(client: Client) -> number:
    const label = client.label
    if label:
        return label.size
    return 0
`.trimStart());
  assert.deepEqual(stableExternalValue.diagnostics, []);
});

test("host and owned values narrow alike after copies, collection reads, and runtime validation", () => {
  const hostRecordType: ValueType = {
    kind: "object",
    fields: new Map([
      ["label", { kind: "optional", inner: { kind: "string" } }],
    ]),
    readonlyFields: new Set(["label"]),
  };
  const stableRecordCopy = compileCore(`
import js {payload} from "host-sdk"

const label = payload.label
if label:
    const stable: string = label
`.trimStart(), { analysis: { imports: new Map([["payload", hostRecordType]]) } });
  assert.deepEqual(stableRecordCopy.diagnostics, []);

  const internalList = compile(`
const values = [1]
let current: string? = "ready"

if current:
    const first = values[0]
    const copied = [...values, current == "" ? 0 : 1]
    const [bound] = values
    for item in values:
        const seen = item
    match values:
        case [matched]:
            const seen = matched
    const stable: string = current
`.trimStart());
  assert.deepEqual(internalList.diagnostics, []);

  // Runtime validation narrows regardless of where the value came from:
  // host-provided unknowns validate exactly like owned values.
  const runtimeValidatedHostValues = compileCore(`
type Profile:
    label: string?

class LocalProfile:
    let label: string?

    constructor(label: string):
        self.label = label

import js {raw} from "host-sdk"

const parsed = Profile.parse(raw)
if parsed.label:
    const narrowed: string = parsed.label

if raw is Profile:
    if raw.label:
        const narrowed: string = raw.label

match raw:
    case Profile as matched:
        if matched.label:
            const narrowed: string = matched.label

if raw is LocalProfile:
    if raw.label:
        const narrowed: string = raw.label
`.trimStart(), { analysis: { imports: new Map([["raw", { kind: "unknown" }]]) } });
  assert.equal(runtimeValidatedHostValues.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 0);

  const runtimeValidatedOwnedValues = compile(`
type Profile:
    label: string?

class LocalProfile:
    let label: string?

    constructor(label: string):
        self.label = label

const parsed = Profile.parse({label: "owned"})
if parsed.label:
    const repeated: string = parsed.label

const local = LocalProfile("owned")
if local.label:
    const repeated: string = local.label
`.trimStart());
  assert.deepEqual(runtimeValidatedOwnedValues.diagnostics, []);
});

test("f-strings preserve narrowing facts across interpolation", () => {
  // Object interpolation may run a toString hook, but coercion is not an
  // invalidation point: narrowed member facts survive the f-string.
  const objectCoercion = compile(`
type User:
    name: string

type Box:
    user: User?

class Mutator:
    const box: Box

    constructor(box: Box):
        self.box = box

    def toString() -> string:
        self.box.user = null
        return "changed"

def label(box: Box) -> string:
    const mutator = Mutator(box)
    assert box.user
    const text = f"{mutator}"
    return box.user.name
`.trimStart());
  assert.equal(objectCoercion.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const primitiveCoercion = compile(`
type User:
    name: string

def label(initial: User?) -> string:
    let user = initial
    assert user
    const prefix = f"{1}:{true}:{null}"
    return f"{prefix}:{user.name}"

print(label({name: "Ada"}))
`.trimStart());
  assert.deepEqual(primitiveCoercion.diagnostics, []);
  const execution = executeModule(primitiveCoercion.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1:true:null:Ada\n");
});

test("component JSX invocations preserve narrowing facts while props stay read-only", () => {
  // Component invocation is an ordinary call: narrowed member facts survive it,
  // even when the component body assigns to the narrowed location.
  const componentInvocation = compile(`
type User:
    name: string

type Box:
    user: User?

component Clear(box: Box):
    box.user = null
    return <span>cleared</span>

def label(box: Box) -> string:
    assert box.user
    const view = <Clear box={box} />
    return box.user.name
`.trimStart());
  assert.equal(componentInvocation.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok(componentInvocation.diagnostics.some((item) => item.code === "VEL5051" && /prop 'box' is read-only/u.test(item.message)));

  // A call inside a prop expression does not invalidate facts read by children.
  const propBeforeChildren = compile(`
type User:
    name: string

type Box:
    user: User?

component Panel(label: string, children: WebNode):
    return <section>{label}{children}</section>

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def label(box: Box) -> WebNode:
    assert box.user
    return <Panel label={clear(box)}>{box.user.name}</Panel>
`.trimStart());
  assert.equal(propBeforeChildren.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const stableLocal = compile(`
type User:
    name: string

type Box:
    user: User?

component Clear(box: Box):
    box.user = null
    return <span>cleared</span>

def label(box: Box) -> string:
    assert box.user
    const user = box.user
    const view = <Clear box={box} />
    return user.name
`.trimStart());
  assert.equal(stableLocal.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok(stableLocal.diagnostics.some((item) => item.code === "VEL5051" && /prop 'box' is read-only/u.test(item.message)));
});

test("await preserves narrowing facts across suspension", () => {
  const safe = compile(`
type User:
    name: string

type Box:
    user: User?

async def label(box: Box, pending: Promise<null>) -> string:
    assert box.user
    const user = box.user
    await pending
    return user.name
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);

  // Suspension is not an invalidation point: only assignments to the narrowed
  // location (and branch merges carrying such assignments) drop facts.
  const aliasedMember = compile(`
type User:
    name: string

type Box:
    user: User?

async def label(box: Box, pending: Promise<null>) -> string:
    assert box.user
    await pending
    return box.user.name
`.trimStart());
  assert.equal(aliasedMember.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const capturedBinding = compile(`
type User:
    name: string

async def label(initial: User?, pending: Promise<null>) -> string:
    let user = initial
    assert user
    await pending
    return user.name
`.trimStart());
  assert.equal(capturedBinding.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("lowering hints use exact spans across nested expressions", () => {
  const result = compile(`
type Profile:
    name: string

class Vault:
    private const profile: Profile? = {name: "Ada"}

    def label() -> string?:
        return self.profile?.name

class Runner:
    def run(value: number) -> number:
        return value

let available: bool? = false
print(not not available)
print(Vault().label())
print(Runner().run(value=3))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarReadPrivateField\(self\.#profile, "profile"\)\?\.name/u);
  assert.doesNotMatch(result.code ?? "", /\?\.#name/u);
  assert.doesNotMatch(result.code ?? "", /new Vault\(\) \?\? null/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nAda\n3\n");
});

test("explicit null comparisons narrow blocks, inline expressions, assertions, and JSX sequences", () => {
  const result = compile(`
type Contact:
    email: string?

def blockLabel(contact: Contact) -> string:
    if contact.email == null:
        return "missing"
    else:
        const address: string = contact.email
        return address

def inverseLabel(contact: Contact) -> string:
    if null != contact.email:
        return contact.email
    return "missing"

def inlineLabel(contact: Contact) -> string:
    return contact.email != null ? contact.email : "missing"

def assertedLabel(contact: Contact) -> string:
    assert contact.email != null else "Email is required"
    const address: string = contact.email
    return address

def preserveZero(value: number?) -> number:
    if value != null:
        return value
    return -1

component ContactView(primary: Contact, secondary: Contact):
    def content() -> WebNode:
        if primary.email != null:
            return <p>{primary.email}</p>
        else if secondary.email == null:
            return <p>Missing</p>
        else:
            return <a href={secondary.email}>{secondary.email}</a>

    return <main>{content()}</main>

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

const contact: Contact = {email: null}
if contact.email != null:
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
    return "null"

component ContactLink(contact: Contact):
    def content() -> WebNode:
        if contact.email:
            return <a href={contact.email}>{contact.email}</a>
        return <span>Missing</span>

    return <p>{content()}</p>

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

const contact: Contact = {email: null}
const address: string = contact.email
if contact.email:
    const contact: Contact = {email: null}
    const shadowed: string = contact.email
`.trimStart());
  assert.equal(outside.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 2);
});

test("assignments use declared types and invalidate stale narrowing facts", () => {
  const reassigned = compile(`
type Contact:
    email: string?

let name: string? = "Ada"
let contact: Contact = {email: "ada@example.com"}

if name:
    name = null
    print(name == null)

if contact.email:
    contact.email = null
    print(contact.email == null)

contact.email = "restored@example.com"
assert contact.email
contact = {email: null}
print(contact.email == null)

let count: number? = 1
if count:
    count += 1
    const current: number = count
    print(current)
`.trimStart());
  assert.deepEqual(reassigned.diagnostics, []);
  const execution = executeModule(reassigned.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n2\n");

  const stale = compile(`
type Contact:
    email: string?

let name: string? = "Ada"
let contact: Contact = {email: "ada@example.com"}

if name:
    name = null
    const staleName: string = name

if contact.email:
    contact.email = null
    const staleField: string = contact.email

contact.email = "restored@example.com"
assert contact.email
contact = {email: null}
const staleBase: string = contact.email
`.trimStart());
  assert.equal(stale.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 3);

  const rejectedWrites = compile(`
let mutableName: string? = "Ada"
const fixedName: string? = "Lin"

if mutableName:
    mutableName = 42
    const stillNarrowed: string = mutableName

if fixedName:
    fixedName = null
    const stillFixed: string = fixedName
`.trimStart());
  assert.equal(rejectedWrites.diagnostics.length, 2);
  assert.ok(rejectedWrites.diagnostics.some((item) => /Cannot assign number to string\?/u.test(item.message)));
  assert.ok(rejectedWrites.diagnostics.some((item) => /Cannot assign to const binding 'fixedName'/u.test(item.message)));
});

test("validates annotations and keeps any behind unsafe boundaries", () => {
  const missing = compile("const value: Missing = null\n");
  assert.ok(missing.diagnostics.some((item) => /Unknown type 'Missing'/.test(item.message)));

  const any = compile("def escape(value: any) -> any:\n    return value\n");
  assert.ok(any.diagnostics.some((item) => /'any' is reserved/.test(item.message)));

  const arity = compile("const values: Map<string> = Map()\n");
  assert.ok(arity.diagnostics.some((item) => item.code === "VEL2012"));

  const recursive = compile("type Node:\n    next: Node?\n");
  assert.deepEqual(recursive.diagnostics, []);
});

test("compiles Web components to owned DOM and extracted Look rules", () => {
  const result = compile(`
const counterLook = look:
    color = rgb(36, 92, 168)

    if @hover:
        color = rgb(20, 52, 112)

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

    return <button class="counter" look={counterLook} class:active={count > 0} on:click={increment}>{count} / {doubled}</button>

mount(<Counter start={1} />, "#app")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.extensions, ["@velarscript/web"]);
  assert.match(result.code ?? "", /const count = __velarState\(start\.get\(\)\)/);
  assert.match(result.code ?? "", /const doubled = __velarComputed/);
  assert.match(result.code ?? "", /__velarWatch/);
  assert.match(result.code ?? "", /count\.set\(count\.get\(\) \+ 1\)/);
  assert.match(result.code ?? "", /__velarCreateElement\("button", __namespace\)/);
  assert.match(result.css ?? "", /\[data-velar-look~="hover:color"\]\[data-velar-look\]:where\(:hover\)\{color:var\(--velar-look-hover-color\)\}/);
  assert.match(result.code ?? "", /__velarLookBind/);
  assert.match(result.code ?? "", /proxy = new Proxy\(value/u);
  assert.match(result.code ?? "", /nextVersion !== currentVersion/u);
  assert.match(result.code ?? "", /if \(destroyed\) return null;[\s\S]*__velarCleanupStep/);
  const domCommit = (result.code ?? "").indexOf("for (const observer of [...__velarRuntime.domQueue])");
  const watchCommit = (result.code ?? "").indexOf("for (const observer of [...__velarRuntime.watchQueue])");
  assert.ok(domCommit >= 0 && watchCommit > domCommit);
});

test("Web lexical extensions share Core line-boundary semantics", () => {
  const source = [
    "const cardLook = look:",
    "    display = \"grid\"",
    "    gap = 12px",
    "",
    "component Card:",
    "    return <article look={cardLook}>Card</article>",
    "",
  ].join("\r");
  const result = compile(source, { path: "standalone-cr.vel" });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /display:var\(--velar-look-base-display\)/u);
  assert.match(result.code ?? "", /function Card/u);
});

test("Look is flat, typed as a value, responsive, state-aware, and target-aware", () => {
  const result = compile(`
const cardLook = look:
    display = "grid"
    gap = 12px
    maxWidth = 680px
    padding = 20px
    background = rgb(251, 250, 247)
    border = border(width=1px, color=rgb(217, 215, 209))
    borderRadius = 16px
    color = rgb(17, 18, 22)

    if @hover and not @disabled:
        translate = spacing(0px, -2px)

    if viewport.width <= 720px:
        padding = 16px

    width = 72 * 1%
    margin = spacing(-8px, 2px, 0px, 2px)

    @before:
        content = ""

component Card:
    return <article class="card" look={cardLook}>Card</article>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /\[data-velar-look~="base:display"\]\{display:var\(--velar-look-base-display\)\}/u);
  assert.match(result.css ?? "", /\[data-velar-look~="hover\+not-disabled:translate"\]\[data-velar-look\]:where\(:hover\):where\(:not\(:disabled\):not\(\[aria-disabled="true"\]\)\)/u);
  assert.match(result.css ?? "", /@media \(width <= 720px\)\{\[data-velar-look~="viewport-width-lte-720px:padding"\]\[data-velar-look\]/u);
  assert.match(result.css ?? "", /\[data-velar-look~="before:base:content"\]::before/u);
  assert.match(result.code ?? "", /data-velar-look/u);
  assert.match(result.code ?? "", /__velarLookMath\("\*", 72, "1%"\)/u);
  assert.match(result.code ?? "", /"-2px"/u);
  assert.match(result.code ?? "", /"-8px"/u);
  assert.doesNotMatch(result.code ?? "", /-"(?:2|8)px"/u);
  assert.doesNotMatch(result.code ?? "", /[A-Za-z0-9_-]{6,}__[A-Za-z0-9_-]{6,}/u);
});

test("Look accepts the modern text wrapping properties", () => {
  const result = compile(`
const bubbleLook = look:
    overflowWrap = "anywhere"
    wordBreak = "break-word"
    hyphens = "auto"
    textWrap = "balance"

component Bubble:
    return <p look={bubbleLook}>text</p>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /overflow-wrap:var\(--velar-look-base-overflow-wrap\)/u);
  assert.match(result.css ?? "", /hyphens:var\(--velar-look-base-hyphens\)/u);
  assert.match(result.css ?? "", /text-wrap:var\(--velar-look-base-text-wrap\)/u);
});

test("Look color-scheme conditions lower to prefers-color-scheme media queries", () => {
  const result = compile(`
const panelLook = look:
    background = rgb(255, 255, 255)

    if scheme.dark:
        background = rgb(29, 32, 41)

    if @hover:
        if scheme.dark:
            opacity = 0.7

    if scheme.dark and viewport.width <= 600px:
        padding = 4px

    if not scheme.dark:
        color = rgb(20, 20, 20)

component Panel:
    return <div look={panelLook}>panel</div>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: dark\)\{\[data-velar-look~="scheme-dark:background"\]\[data-velar-look\]\{background:var\(--velar-look-scheme-dark-background\)\}/u);
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: dark\)\{\[data-velar-look~="hover\+scheme-dark:opacity"\]\[data-velar-look\]:where\(:hover\)/u);
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: dark\) and \(width <= 600px\)\{\[data-velar-look~="scheme-dark\+viewport-width-lte-600px:padding"\]/u);
  // The schemes are complementary: 'not scheme.dark' is the light scheme.
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: light\)\{\[data-velar-look~="scheme-light:color"\]/u);
});

test("JSX interpolation braces continue expressions across physical lines", () => {
  const result = compile(`
const messages: List<string> = []

component App:
    return <div>
        {messages.size == 0
            ? <p>Empty</p>
            : messages.map(message => <span key={message}>{message}</span>)}
        <p data-note={messages.size == 0
            ? "empty"
            : "full"}>note</p>
    </div>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateElement\("div", __namespace\)/u);

  // An indentation-owned look block inside interpolation braces keeps its
  // line-sensitive form.
  const inline = compile(`
component Card:
    return <p look={look:
        color = rgb(1, 2, 3)
    }>Note</p>

mount(<Card />, "#app")
`.trimStart());
  assert.deepEqual(inline.diagnostics, []);
  assert.match(inline.css ?? "", /base:color/u);
});

test("unsafe CSS imports are explicit resources around the controlled Look segment", () => {
  const source = `
import css unsafe "./foundation.css" before look
import css unsafe "./overrides.css" after look

const cardLook = look:
    color = rgb(0, 128, 128)

component Card:
    return <article class="card" look={cardLook}>Card</article>
`.trimStart();
  const inspection = inspectModule(source);
  assert.deepEqual(inspection.resources, [
    { source: "./foundation.css", kind: "unsafe CSS" },
    { source: "./overrides.css", kind: "unsafe CSS" },
  ]);
  const result = compile(source, {
    resourceContents: new Map([
      ["./foundation.css", ".card { color: black; }"],
      ["./overrides.css", ".card { color: purple; }"],
    ]),
  });

  assert.deepEqual(result.diagnostics, []);
  const foundation = (result.css ?? "").indexOf("color: black");
  const look = (result.css ?? "").indexOf("data-velar-look");
  const override = (result.css ?? "").indexOf("color: purple");
  assert.ok(foundation >= 0 && look > foundation && override > look);

  const hiddenDependency = compile('import css unsafe "./legacy.css" before look\n', {
    resourceContents: new Map([["./legacy.css", '@import "./theme.css"; .icon { background: url("./icon.svg"); }']]),
  });
  const messages = hiddenDependency.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /contains @import/u);
  assert.match(messages, /uses relative url/u);
});

test("Look composition uses ordinary functions and named arguments", () => {
  const result = compile(`
def surface(radius: Length, color: Color) -> Look:
    return look:
        background = color
        borderRadius = radius

const interactive = look:
    cursor = "pointer"

    if @focusVisible:
        outline = border(width=2px, color=rgb(63, 115, 150))

const actionLook = look:
    ...surface(color=rgb(255, 255, 255), radius=9999px)
    ...interactive
    display = "inline-flex"
    alignItems = "center"

component ActionButton:
    return <button look={actionLook}>Continue</button>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /surface\(\.\.\.\(\(__namedArguments\) => \[__namedArguments\[1\], __namedArguments\[0\]\]/u);
  assert.match(result.code ?? "", /__velarLook\(\[/u);
  assert.match(result.css ?? "", /focus-visible:outline"\]\[data-velar-look\]:where\(:focus-visible\)/u);
});

test("Look rejects ambiguous maintenance hazards", () => {
  const result = compile(`
const broken = look:
    padding = 12px
    paddingInline = 16px
    paddingInline = 18px
    missing = 1px

    if @unknown:
        color = "red"

    @unknownTarget:
        content = "x"

component Card:
    return <article style="color:red" style:color={"red"} look={broken}>Card</article>
`.trimStart());

  const messages = result.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Look property 'paddingInline' is defined more than once/u);
  assert.match(messages, /Unknown Look property 'missing'/u);
  assert.match(messages, /Unknown Look hook '@unknown'/u);
  assert.match(messages, /Unknown Look target '@unknownTarget'/u);
  assert.equal(result.diagnostics.filter((item) => item.code === "VEL5041").length, 2);

  const nestedComposition = compile(`
const base = look:
    color = rgb(17, 18, 22)

const broken = look:
    if true:
        ...base
`.trimStart());
  assert.match(nestedComposition.diagnostics.map((item) => item.message).join("\n"), /Look composition is only valid at the outer level/u);

  const condition = Array.from({ length: 33 }, (_, index) => `ready${index}`).join(" or ");
  const state = Array.from({ length: 33 }, (_, index) => `const ready${index} = true`).join("\n");
  const expanded = compile(`${state}\n\nconst broken = look:\n    if ${condition}:\n        color = rgb(17, 18, 22)\n`);
  assert.match(expanded.diagnostics.map((item) => item.message).join("\n"), /at most 32 selector\/runtime terms/u);
});

test("Look builders reject JavaScript coercion and invalid visual ranges", () => {
  const invalidTypes = compile(`
const callback = () => null
const empty = tracks()

const broken = look:
    gridTemplateColumns = tracks(callback)
    padding = spacing(callback)
    gridTemplateRows = repeat(Error("count"), 1px)
`.trimStart());
  const messages = invalidTypes.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Cannot assign \(\) -> null to .*Track/u);
  assert.match(messages, /Cannot assign \(\) -> null to .*Length/u);
  assert.match(messages, /Cannot assign Error to number \| string/u);
  assert.match(messages, /Expected at least 1 argument but received 0/u);

  const invalidRange = compile(`
const broken = look:
    color = rgba(0, 0, 0, 2)
`.trimStart());
  assert.deepEqual(invalidRange.diagnostics, []);
  const rangeExecution = executeModule(invalidRange.code ?? "");
  assert.notEqual(rangeExecution.status, 0);
  assert.match(String(rangeExecution.stderr), /RGB alpha must be from 0 through 1/u);

  const dynamic = compile(`
import js unsafe {unsafeValue} from "data:text/javascript,export const unsafeValue={toString(){console.log('coerced');return '0.5'}}"

const broken = look:
    color = color(unsafeValue)
`.trimStart());
  assert.deepEqual(dynamic.diagnostics, []);
  const coercionExecution = executeModule(dynamic.code ?? "");
  assert.notEqual(coercionExecution.status, 0);
  assert.equal(coercionExecution.stdout, "");
  assert.match(String(coercionExecution.stderr), /Color must be text/u);
  assert.match(dynamic.code ?? "", /if \(value == null\) element\.style\.removeProperty/u);
});

test("Look diagnostics retain exact right-hand expression spans", () => {
  const source = `
const display = 10
const broken = look:
    display = display
`.trimStart();
  const result = compile(source, { path: "look-spans.vel" });
  const diagnostic = result.diagnostics.find((item) => /Cannot assign number to string/u.test(item.message));
  assert.ok(diagnostic);
  assert.equal(diagnostic.span.start, source.lastIndexOf("display"));
  assert.equal(diagnostic.span.end, source.lastIndexOf("display") + "display".length);
});

test("components expose one stable class and Look host without declaring framework props", () => {
  const result = compile(`
const callerLook = look:
    padding = 12px

component Card:
    const ownLook = look:
        color = rgb(17, 18, 22)
    return <article class="card" look={ownLook}>Card</article>

component App:
    return <Card class="featured" look={callerLook} />
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /if \(__props\.class !== undefined\) __velarClassBindRoot/u);
  assert.match(result.code ?? "", /if \(__props\.look !== undefined\) __velarLookBindRoot/u);

  const fragment = compile(`
component Broken:
    return <><header>Header</header><main>Main</main></>

component Valid:
    return <><header>Header</header><main host>Main</main></>
`.trimStart());
  assert.equal(fragment.diagnostics.filter((item) => item.code === "VEL5043").length, 1);
  assert.doesNotMatch(fragment.code ?? "", /setAttribute\("host"/u);
});

test("project CSS has one explicit before-Look-after order across module boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-look-order-"));
  const entry = join(directory, "main.vel");
  await writeFile(join(directory, "base.css"), ".base { order: 1; }", "utf8");
  await writeFile(join(directory, "base-after.css"), ".base-after { order: 4; }", "utf8");
  await writeFile(join(directory, "feature.css"), ".feature { order: 2; }", "utf8");
  await writeFile(join(directory, "feature-after.css"), ".feature-after { order: 5; }", "utf8");
  await writeFile(join(directory, "feature.vel"), `
import css unsafe "./feature.css" before look
import css unsafe "./feature-after.css" after look
export const featureLook = look:
    color = rgb(1, 2, 3)
`.trimStart(), "utf8");
  await writeFile(entry, `
import {featureLook} from "./feature.vel"
import css unsafe "./base.css" before look
import css unsafe "./base-after.css" after look
const appLook = look:
    background = rgb(4, 5, 6)
component App:
    return <main look={[featureLook, appLook]}>App</main>
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  const styles = projectStyles(project);
  const firstLook = styles.indexOf("data-velar-look");
  const lastBefore = Math.max(styles.indexOf(".base {"), styles.indexOf(".feature {"));
  const firstAfter = Math.min(styles.indexOf(".base-after {"), styles.indexOf(".feature-after {"));
  assert.ok(lastBefore >= 0 && firstLook > lastBefore && firstAfter > firstLook);
});

test("unsafe CSS has one project owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-look-owner-"));
  const entry = join(directory, "main.vel");
  await writeFile(join(directory, "shared.css"), ".shared { color: black; }", "utf8");
  await writeFile(join(directory, "feature.vel"), 'import css unsafe "./shared.css" before look\nexport const value = 1\n', "utf8");
  await writeFile(entry, 'import {value} from "./feature.vel"\nimport css unsafe "./shared.css" before look\nprint(value)\n', "utf8");
  const project = await compileProject(entry);
  assert.match(project.failures.map((failure) => failure.message).join("\n"), /each raw stylesheet must have one project owner/u);
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
  assert.match(result.code ?? "", /const label = __velarResource\(\(\) => __velarNormalizePromiseValue\(loadLabel\(\)\), __scope, "label"\)/u);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "resource" && item.name === "label");
  assert.match(symbol?.type ?? "", /value: string\?/u);
  assert.match(symbol?.type ?? "", /reload: \(\) -> Promise<null>/u);

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
  assert.ok(outside.diagnostics.some((item) => item.code === "VEL3012" && /only valid at component scope; a module-scope async operation belongs in a module 'action'/u.test(item.message)));

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

    async def runRefresh():
        try:
            await refresh()
        catch error:
            label = error.message

    computed failure = refresh.error

    return <main><button type="button" disabled={refresh.pending} on:click={runRefresh}>Refresh</button>{failure ? <p role="alert">{failure.message}</p> : null}</main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const refresh = __velarAction\(async \(\) =>/u);
  assert.equal(result.code?.match(/function __velarNormalizeError\(value\)/gu)?.length, 1);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "action" && item.name === "refresh");
  assert.match(symbol?.type ?? "", /action \(\) -> Promise<string>/u);

  const execution = executeModule(`${result.code ?? ""}
const pending = [];
const scope = __velarScope("ActionProbe");
__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message));
const save = __velarAction((value) => new Promise((resolve, reject) => pending.push({ value, resolve, reject })), scope, "save");
console.log(save.pending + ":" + (save.error?.message ?? "null"));
const older = save("old");
const latest = save("new");
await Promise.resolve();
console.log(save.pending + ":" + (save.error?.message ?? "null"));
pending[1].resolve("new");
console.log((await latest) + ":" + save.pending + ":" + (save.error?.message ?? "null"));
pending[0].reject(Error("Stale failure"));
try { await older; }
catch (error) { console.log(error.message + ":" + save.pending + ":" + (save.error?.message ?? "null")); }
const failed = save("broken");
await Promise.resolve();
pending[2].reject(Error("Save failed"));
try { await failed; }
catch (error) { console.log(error.message + ":" + save.pending + ":" + save.error.message); }
const eventTarget = new EventTarget();
const eventScope = __velarScope("EventProbe");
const ownedFailure = __velarAction(() => Promise.reject(Error("Owned failure")), eventScope, "owned");
__velarOn(eventTarget, "owned", () => ownedFailure, eventScope);
__velarOn(eventTarget, "plain", () => () => Promise.reject(Error("Plain failure")), eventScope);
let eventThenReads = 0;
const fakeThenable = Object.defineProperty({}, "then", { get() { eventThenReads += 1; return () => null; } });
__velarOn(eventTarget, "ordinary", () => () => fakeThenable, eventScope);
eventTarget.dispatchEvent(new Event("owned"));
eventTarget.dispatchEvent(new Event("plain"));
eventTarget.dispatchEvent(new Event("ordinary"));
console.log("event-then:" + eventThenReads);
await new Promise((resolve) => setTimeout(resolve, 0));
const hostile = __velarAction(() => Promise.reject({ toString() { console.log("action conversion hook ran"); throw Error("conversion failure"); } }), scope, "hostile");
try { await hostile(); }
catch (error) { console.log("hostile-catch:" + error.message); }
__velarDestroyScope(eventScope);
__velarDestroyScope(scope);
try { await save("ignored"); }
catch (error) { console.log(error.message + ":" + pending.length); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "false:null",
    "true:null",
    "new:true:null",
    "Stale failure:false:null",
    "action:save:Save failed",
    "Save failed:false:Save failed",
    "event-then:0",
    "event:plain:Plain failure",
    "action:owned:Owned failure",
    "action:hostile:A non-Error value was thrown by JavaScript",
    "hostile-catch:A non-Error value was thrown by JavaScript",
    "Action 'save' cannot run after its component is destroyed:3",
    "",
  ].join("\n"));
});

test("actions reject nested ownership, bad returns, and unknown state fields", () => {
  const nested = compile(`
def prepare():
    action save() -> null:
        return null
`.trimStart());
  assert.ok(nested.diagnostics.some((item) => item.code === "VEL3013" && /only valid at module or component scope/u.test(item.message)));

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

test("module actions own reactive pending state, preserve rejections, and update module state", () => {
  const result = compile(`
state message = "idle"

action deliver(text: string) -> string:
    message = text
    return message

component App:
    return <button type="button" disabled={deliver.pending} on:click={() => deliver("clicked")}>{message}</button>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const deliver = __velarAction\(async \(text\) => \{[\s\S]*?\}, __velarGlobalScope, "deliver"\)/u);
  assert.match(result.code ?? "", /message\.set\(text\)/u);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "action" && item.name === "deliver");
  assert.match(symbol?.type ?? "", /action \(text: string\) -> Promise<string>/u);

  const execution = executeModule(`${result.code ?? ""}
__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message + ":" + report.component));
console.log(deliver.pending + ":" + (deliver.error?.message ?? "null") + ":" + message.get());
const call = deliver("ready");
console.log(deliver.pending + ":" + message.get());
console.log((await call) + ":" + deliver.pending + ":" + message.get());
const failing = __velarAction(() => Promise.reject(Error("Module failure")), __velarGlobalScope, "failing");
try { await failing(); }
catch (error) { console.log("caught:" + error.message + ":" + failing.pending + ":" + failing.error.message); }
const late = failing("again");
console.log("still-runnable:" + failing.pending);
try { await late; } catch {}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "false:null:idle",
    "true:idle",
    "ready:false:ready",
    "action:failing:Module failure:",
    "caught:Module failure:false:Module failure",
    "still-runnable:true",
    "action:failing:Module failure:",
    "",
  ].join("\n"));
});

test("exported module actions travel through the module interface without reactive lowering", async () => {
  const result = compile(`
export action save(note: string) -> string:
    return note
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /export const save = __velarAction\(async \(note\) =>/u);
  assert.match(describeType(result.moduleInterface.exports.get("save")!), /^action \(note: string\) -> Promise<string>$/u);
  assert.equal(result.moduleInterface.reactiveExports.has("save"), false);

  const syntaxInterface = inspectModule(`
export action save(note: string) -> string:
    return note
`.trimStart()).moduleInterface;
  assert.match(describeType(syntaxInterface.exports.get("save")!), /^action \(note: string\) -> Promise<string>$/u);

  const directory = await mkdtemp(join(tmpdir(), "velar-module-actions-"));
  const storePath = join(directory, "store.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(storePath, `
export state status = "idle"

export action ship(item: string) -> string:
    status = item
    return status
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {ship, status} from "./store.vel"

component App:
    return <button type="button" disabled={ship.pending} on:click={() => ship("crate")}>{status}</button>
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.match(main.result.code ?? "", /ship\.pending/u);
  assert.doesNotMatch(main.result.code ?? "", /ship\.get\(\)/u);
  assert.match(main.result.code ?? "", /status\.get\(\)/u);
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
    return null

component App:
    mounted:
        await prepare()
    return <main>ready</main>
`.trimStart());
  assert.deepEqual(asynchronousMount.diagnostics, []);
  assert.match(asynchronousMount.code ?? "", /async \(\) => \{[\s\S]*await __velarNormalizePromiseValue\(prepare\(\)\)/u);

  const asynchronousCleanup = compile(`
async def dispose():
    return null

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

def acquireHandle() -> () -> null:
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
`;
  const failedCode = (failedMount.code ?? "").replace(
    "let activeHandles = 0;",
    '__velarRuntime.errorHandlers.add(report => console.log(report.phase + ":" + report.error.message));\nlet activeHandles = 0;',
  );
  const execution = executeModule(`${dom}\n${failedCode}\nconsole.log(target.replaced.role + ":" + target.replaced.textContent);\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "construction-cleanup\ncleanup:Construction cleanup failed\nmount:Boot failed\n0\nalert:The application could not start: Boot failed\n");

  const cleanupCode = (cleanup.code ?? "").replace(
    "function Recovering",
    '__velarRuntime.errorHandlers.add(report => console.log(report.phase + ":" + report.error.message));\nfunction Recovering',
  );
  const cleanupExecution = executeModule(`${dom}\n${cleanupCode}\nconst app = Recovering();\napp.mount("#app");\napp.destroy();\n`);
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
  assert.match(reactiveProps.code ?? "", /__velarAppend\(__el\d+, __velarChild\(Badge, \{ label: \(\) => \(label\.get\(\)\) \}, undefined, __scope, __namespace\)\)/u);

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
    let canvas: CanvasElement? = null
    return <canvas ref={canvas}></canvas>

component DialogView:
    let dialog: DialogElement? = null
    return <dialog ref={dialog}>Confirm</dialog>
`.trimStart());
  assert.deepEqual(correctRef.diagnostics, []);
  assert.match(correctRef.code ?? "", /cleanups\.push\(\(\) => \{ if \(canvas === __el\d+\) canvas = null; \}\)/u);

  const wrongRef = compile(`
component CanvasView:
    let canvas: InputElement? = null
    return <canvas ref={canvas}></canvas>
`.trimStart());
  assert.ok(wrongRef.diagnostics.some((item) => item.code === "VEL5024"));

  const nonOptionalRef = compile(`
component CanvasView:
    let canvas: CanvasElement = null
    return <canvas ref={canvas}></canvas>
`.trimStart());
  assert.ok(nonOptionalRef.diagnostics.some((item) => item.code === "VEL5024" && /cleanup can restore null/u.test(item.message)));
});

test("ordinary control flow keeps JSX branches readable, narrowed, and ownership-safe", () => {
  const result = compile(`
type User:
    name: string

component Badge(label: string):
    return <strong>{label}</strong>

component Profile(user: User?, failed: Error?, loading: bool):
    def content() -> WebNode:
        if loading:
            return <p aria-busy="true">Loading…</p>
        else if failed:
            return <p role="alert">{failed.message}</p>
        else if user:
            return <Badge label={user.name} />
        else:
            return <p>Guest</p>

    return <main>{content()}</main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  // Prop reads route through the live prop handle, so narrowed branch reads
  // lower through .get() like state and computed reads.
  assert.match(result.code ?? "", /if \(loading\.get\(\)\)/u);
  assert.match(result.code ?? "", /\(failed\.get\(\) \?\? null\) != null/u);
  assert.match(result.code ?? "", /\(user\.get\(\) \?\? null\) != null/u);
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

  const badCondition = compile("component Broken:\n    def content() -> WebNode:\n        if \"yes\":\n            return <p>Wrong</p>\n        return <p>Fallback</p>\n\n    return <main>{content()}</main>\n");
  assert.ok(badCondition.diagnostics.some((item) => /Condition must be bool or optional/u.test(item.message)));
});

test("native JSX events provide checked browser payloads without wrappers", () => {
  const result = compile(`
type KeyPayload = KeyboardEvent

def isKeyPayload(value: unknown) -> bool:
    return value is KeyPayload

component Controls:
    def handleAny(event: Event) -> null:
        print(event.type)

    def handleKey(event: KeyboardEvent) -> null:
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

def show(value: Summary) -> null:
    print(value.label)

const detail: Detailed = {label: "ready", count: 1}
show(detail)
`.trimStart());
  assert.deepEqual(structural.diagnostics, []);

  const invalid = compile(`
component Broken:
    def pointerOnly(event: PointerEvent) -> null:
        print(event.clientX)

    def tooMany(first: Event, second: Event) -> null:
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
  assert.match(keyed.code ?? "", /const source = __velarToRaw\(read\(\) \?\? \[\]\);\s+const values = __velarListSnapshot\(source, "Keyed JSX"\)/u);

  const execution = executeModule(`${keyed.code ?? ""}
let iteratorReads = 0;
let getterReads = 0;
class HostileList extends Array {
  [Symbol.iterator]() { iteratorReads += 1; throw new Error("iterator override"); }
}
const source = new HostileList("Ada", "Lin");
const snapshot = __velarListSnapshot(source, "Keyed JSX");
source[0] = "Changed";
console.log(snapshot[0] + ":" + snapshot[1] + ":" + iteratorReads);
const sparse = []; sparse.length = 1;
const extended = ["Ada"]; extended.label = "hidden";
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, configurable: true, get() { getterReads += 1; return "Ada"; } });
accessor.length = 1;
for (const value of [sparse, extended, accessor, Object.freeze([])]) {
  try { __velarListSnapshot(value, "Keyed JSX"); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada:Lin:0\nTypeError\nTypeError\nTypeError\nTypeError\n0\n");
});

test("widens the keyed fast path across conditional branches", () => {
  // The idiomatic empty-state ternary (ledger W-19): the empty branch becomes
  // a gated dynamic region and the list keeps the identity-cached keyed path,
  // both gated on the shared branch condition.
  const ternary = compile(`
type Message:
    id: string
    text: string

component Flow(messages: List<Message>):
    return <section>{messages.size == 0 ? <p>empty</p> : messages.map(message => <article key={message.id}>{message.text}</article>)}</section>
`.trimStart());
  assert.deepEqual(ternary.diagnostics, []);
  assert.match(ternary.code ?? "", /__velarDynamic\(__el\d+, \(__childScope\) => \(\(__velarCollectionSize\(messages\.get\(\)\) === 0\)\) \? \(/u);
  assert.match(ternary.code ?? "", /__velarKeyed\(__el\d+, \(\) => \(\(__velarCollectionSize\(messages\.get\(\)\) === 0\)\) \? \[\] : \(messages\.get\(\)\)/u);

  const bothKeyed = compile(`
component Flow(on: bool, alpha: List<string>, beta: List<string>):
    return <ul>{on ? alpha.map(name => <li key={name}>{name}</li>) : beta.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(bothKeyed.diagnostics, []);
  assert.equal(((bothKeyed.code ?? "").match(/__velarKeyed\(__el1,/gu) ?? []).length, 2);

  const chain = compile(`
component Flow(on: bool, alpha: List<string>, beta: List<string>):
    return <ul>{on ? alpha.map(name => <li key={name}>{name}</li>) : beta.size == 0 ? <li>none</li> : beta.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(chain.diagnostics, []);
  assert.equal(((chain.code ?? "").match(/__velarKeyed\(__el1,/gu) ?? []).length, 2);
  assert.equal(((chain.code ?? "").match(/__velarDynamic\(__el1,/gu) ?? []).length, 1);

  // A conditional without a keyed list stays one dynamic region.
  const plain = compile(`
component Flow(on: bool):
    return <div>{on ? <p>a</p> : <p>b</p>}</div>
`.trimStart());
  assert.deepEqual(plain.diagnostics, []);
  assert.doesNotMatch(plain.code ?? "", /__velarKeyed\(__el/u);
  assert.equal(((plain.code ?? "").match(/__velarDynamic\(__el1,/gu) ?? []).length, 1);
});

test("an empty-state ternary keeps keyed identity across branch flips", () => {
  const result = compile(`
type Row:
    id: string
    text: string

state rows: List<Row> = []
let stamps = 0

component Entry(row: Row):
    stamps += 1
    const stamp = stamps
    return <article data-id={row.id} data-stamp={stamp}>{row.text}</article>

component Flow:
    return <section>{rows.size == 0 ? <p>empty</p> : rows.map(row => <Entry key={row.id} row={row} />)}</section>

mount(<Flow />, "#flow")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", value = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.value = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
  }
  static detach(node) {
    if (!node.parentNode) return;
    const siblings = node.parentNode.childNodes;
    const index = siblings.indexOf(node);
    if (index !== -1) siblings.splice(index, 1);
    node.parentNode = null;
  }
  static insert(parent, node, before) {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) FakeNode.insert(parent, child, before);
      return;
    }
    FakeNode.detach(node);
    node.parentNode = parent;
    const index = before === null ? -1 : parent.childNodes.indexOf(before);
    if (index === -1) parent.childNodes.push(node);
    else parent.childNodes.splice(index, 0, node);
  }
  append(...values) { for (const value of values) FakeNode.insert(this, value, null); }
  insertBefore(node, before = null) { FakeNode.insert(this, node, before); return node; }
  before(...values) { for (const value of values) FakeNode.insert(this.parentNode, value, this); }
  remove() { FakeNode.detach(this); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
}
const flowTarget = new FakeNode(1, "root");
globalThis.Node = FakeNode;
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createTextNode(value) { return new FakeNode(3, "", String(value)); },
  createComment(value) { return new FakeNode(8, "", String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#flow" ? flowTarget : null; },
};
function dumpNode(node) {
  if (node.nodeType === 3) return node.value;
  if (node.nodeType === 8) return "";
  const attributes = [...node.attributes.entries()].map(([name, value]) => " " + name + "=" + JSON.stringify(String(value))).join("");
  return "<" + node.tagName + attributes + ">" + node.childNodes.map(dumpNode).join("") + "</" + node.tagName + ">";
}
function dump() { return flowTarget.childNodes.map(dumpNode).join(""); }
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
await flush();
console.log(dump());
rows.set([{ id: "a", text: "a0" }, { id: "b", text: "b0" }]);
await flush();
console.log(dump());
const current = rows.get();
rows.set([current[0], { ...current[1], text: "b1" }]);
await flush();
console.log(dump());
rows.set([]);
await flush();
console.log(dump());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // Empty state renders while the keyed region holds zero entries.
    "<section><p>empty</p></section>",
    // The flip destroys the empty state and populates the keyed region.
    '<section><article data-id="a" data-stamp="1">a0</article><article data-id="b" data-stamp="2">b0</article></section>',
    // A streamed-style update replaces only the changed record's instance;
    // the untouched entry keeps its component instance (same stamp).
    '<section><article data-id="a" data-stamp="1">a0</article><article data-id="b" data-stamp="3">b1</article></section>',
    // Flipping back to empty drops every entry and restores the empty state.
    "<section><p>empty</p></section>",
    "",
  ].join("\n"));
});

test("diagnoses keys the keyed fast path will ignore", () => {
  // A branch map without a key is held to the same standard as a bare map.
  const missingBranchKey = compile(`
component Flow(names: List<string>):
    return <ul>{names.size == 0 ? <li>empty</li> : names.map(name => <li>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(missingBranchKey.diagnostics.map((item) => item.code), ["VEL5017"]);

  // A keyed map that is not an interpolation leaf compiles to the rebuild-all
  // dynamic path, so the key would be silently meaningless without VEL5050.
  const wrapped = compile(`
def pick(rows: List<WebNode>) -> List<WebNode>:
    return rows

component Flow(names: List<string>):
    return <ul>{pick(names.map(name => <li key={name}>{name}</li>))}</ul>
`.trimStart());
  assert.deepEqual(wrapped.diagnostics.map((item) => item.code), ["VEL5050"]);
  assert.match(wrapped.diagnostics[0]?.message ?? "", /items\.map\(item => <Row key=\{item\.id\} \/>\)/u);
  assert.match(wrapped.diagnostics[0]?.message ?? "", /'\?:' branch/u);

  const lonelyBranchKey = compile(`
component Flow(names: List<string>):
    return <ul>{names.size == 0 ? <li key="empty">empty</li> : names.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(lonelyBranchKey.diagnostics.map((item) => item.code), ["VEL5050"]);

  // Honored shapes stay silent: a keyed leaf, a keyed branch, and a keyed
  // list nested inside another keyed body's interpolation.
  const honored = compile(`
type Row:
    id: string
    tags: List<string>

component Flow(rows: List<Row>):
    return <ul>{rows.map(row => <li key={row.id}><span>{row.tags.map(tag => <em key={tag}>{tag}</em>)}</span></li>)}</ul>
`.trimStart());
  assert.deepEqual(honored.diagnostics, []);
});

test("reactive props update child components in place without destroying their state", () => {
  const result = compile(`
type Row:
    id: string

state busy = false
state banner = "b0"
state showFirst = true
state rows: List<Row> = [{id: "a"}, {id: "b"}, {id: "c"}]
let stamps = 0

component Field(label: string, busy: bool = false):
    state draft = "d0"
    watch busy:
        draft = draft + "|" + label + ":" + (busy ? "on" : "off")
    watch draft:
        print("draft:" + draft)
    mounted:
        print("mounted:" + label)
    cleanup:
        print("cleanup:" + label)
    return <section data-busy={busy ? "yes" : "no"}>{draft}</section>

component RowView(row: Row):
    stamps += 1
    const stamp = stamps
    mounted:
        print("row-mounted:" + row.id)
    cleanup:
        print("row-cleanup:" + row.id)
    return <article data-id={row.id} data-stamp={stamp}></article>

component PropsApp:
    return <main><p>{banner}</p><Field label="alpha" busy={busy} /></main>

component BranchApp:
    return <div>{showFirst ? <Field label="one" /> : <Field label="two" />}</div>

component ListApp:
    return <ul>{rows.map(row => <RowView key={row.id} row={row} />)}</ul>

mount(<PropsApp />, "#props")
mount(<BranchApp />, "#branch")
mount(<ListApp />, "#list")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  // A component element becomes a stable child instance fed by per-prop
  // observers; the child function itself must not run inside a tracked read.
  assert.match(result.code ?? "", /__velarChild\(Field, \{ label: \(\) => \("alpha"\), busy: \(\) => \(busy\.get\(\)\) \}, undefined, __scope, __namespace\)/u);
  assert.match(result.code ?? "", /const busy = __velarProp\(__props, "busy", \(\) => \(false\)\);/u);
  assert.match(result.code ?? "", /const label = __velarRequiredProp\(__props, "label", "Field"\);/u);
  assert.doesNotMatch(result.code ?? "", /__velarDynamic\(__el\d+, \(__childScope\) => __velarChild/u);

  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", value = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.value = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
  }
  static detach(node) {
    if (!node.parentNode) return;
    const siblings = node.parentNode.childNodes;
    const index = siblings.indexOf(node);
    if (index !== -1) siblings.splice(index, 1);
    node.parentNode = null;
  }
  static insert(parent, node, before) {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) FakeNode.insert(parent, child, before);
      return;
    }
    FakeNode.detach(node);
    node.parentNode = parent;
    const index = before === null ? -1 : parent.childNodes.indexOf(before);
    if (index === -1) parent.childNodes.push(node);
    else parent.childNodes.splice(index, 0, node);
  }
  append(...values) { for (const value of values) FakeNode.insert(this, value, null); }
  insertBefore(node, before = null) { FakeNode.insert(this, node, before); return node; }
  before(...values) { for (const value of values) FakeNode.insert(this.parentNode, value, this); }
  remove() { FakeNode.detach(this); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
}
const targets = new Map([
  ["#props", new FakeNode(1, "root")],
  ["#branch", new FakeNode(1, "root")],
  ["#list", new FakeNode(1, "root")],
]);
globalThis.Node = FakeNode;
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createTextNode(value) { return new FakeNode(3, "", String(value)); },
  createComment(value) { return new FakeNode(8, "", String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return targets.get(selector) ?? null; },
};
function dumpNode(node) {
  if (node.nodeType === 3) return node.value;
  if (node.nodeType === 8) return "";
  const attributes = [...node.attributes.entries()].map(([name, value]) => " " + name + "=" + JSON.stringify(String(value))).join("");
  return "<" + node.tagName + attributes + ">" + node.childNodes.map(dumpNode).join("") + "</" + node.tagName + ">";
}
function dump(selector) { return targets.get(selector).childNodes.map(dumpNode).join(""); }
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
await flush();
console.log("props:" + dump("#props"));
console.log("branch:" + dump("#branch"));
console.log("list:" + dump("#list"));
console.log("phase:busy-on");
busy.set(true);
await flush();
console.log("props:" + dump("#props"));
console.log("phase:busy-off");
busy.set(false);
await flush();
console.log("props:" + dump("#props"));
console.log("phase:banner");
banner.set("b1");
await flush();
console.log("props:" + dump("#props"));
console.log("phase:branch-swap");
showFirst.set(false);
await flush();
console.log("branch:" + dump("#branch"));
console.log("phase:reorder");
rows.set([...rows.get()].reverse());
await flush();
console.log("list:" + dump("#list"));
console.log("phase:removal");
rows.set([rows.get()[2]]);
await flush();
console.log("list:" + dump("#list"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // Mount order: lifecycle runs once per instance.
    "mounted:alpha",
    "mounted:one",
    "row-mounted:a",
    "row-mounted:b",
    "row-mounted:c",
    'props:<main><p>b0</p><section data-busy="no">d0</section></main>',
    'branch:<div><section data-busy="no">d0</section></div>',
    'list:<ul><article data-id="a" data-stamp="1"></article><article data-id="b" data-stamp="2"></article><article data-id="c" data-stamp="3"></article></ul>',
    // (a)+(e): a reactive prop update reaches the child in place; local state
    // survives and no cleanup/mounted runs.
    "phase:busy-on",
    "draft:d0|alpha:on",
    'props:<main><p>b0</p><section data-busy="yes">d0|alpha:on</section></main>',
    "phase:busy-off",
    "draft:d0|alpha:on|alpha:off",
    'props:<main><p>b0</p><section data-busy="no">d0|alpha:on|alpha:off</section></main>',
    // (b): a parent re-render around the child leaves the instance alone.
    "phase:banner",
    'props:<main><p>b1</p><section data-busy="no">d0|alpha:on|alpha:off</section></main>',
    // (c): switching a conditional branch destroys and recreates.
    "phase:branch-swap",
    "cleanup:one",
    "mounted:two",
    'branch:<div><section data-busy="no">d0</section></div>',
    // (d): a keyed reorder moves instances without lifecycle churn.
    "phase:reorder",
    'list:<ul><article data-id="c" data-stamp="3"></article><article data-id="b" data-stamp="2"></article><article data-id="a" data-stamp="1"></article></ul>',
    "phase:removal",
    "row-cleanup:c",
    "row-cleanup:b",
    'list:<ul><article data-id="a" data-stamp="1"></article></ul>',
    "",
  ].join("\n"));
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
    framework: { id: string; capability: string; target: string; protocolVersion: number; apiVersion: string; artifactKind: string };
    compiler: { name: string; version: string };
    buildId: string;
    sourceMaps: boolean;
    entry: string;
    modules: { total: number; application: number; packages: Array<{ name: string; modules: number }> };
    dependencies: { velar: string[]; javascript: string[] };
    deployment: { manifest: string; fallback: string | null; contentSecurityPolicy: boolean; adapter: string };
    assets: Array<{ path: string; sizeBytes: number; sha256: string; role: string }>;
  };
  assert.equal(manifest.formatVersion, 3);
  assert.equal(manifest.kind, "velar-framework-build");
  assert.deepEqual(manifest.framework, {
    id: "@velarscript/web",
    capability: "web",
    target: "browser",
    protocolVersion: 1,
    apiVersion: "0.10",
    artifactKind: "velar-web-build",
  });
  assert.deepEqual(manifest.compiler, { name: "velar", version: "0.10.0-dev" });
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

test("language server publishes diagnostics, hover, and completion", async (context) => {
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
    "    return <><p host>{remote.loading ? \"Loading\" : doubled}</p><button type=\"button\" on:click={() => remote.reload()}>Reload</button></>",
    "",
  ].join("\n");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(modelsPath, "/// Greets one visible user.\nexport def greet(name: string) -> string:\n    return name\n", "utf8");
  await writeFile(mainPath, mainText, "utf8");
  const mainUri = pathToFileURL(mainPath).href;
  const scratchUri = pathToFileURL(join(directory, "scratch.vel")).href;
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
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
  assert.equal(initializeResult.serverInfo.name, "VelarScript Language Server");
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
    params: { textDocument: { uri: scratchUri, languageId: "velar", version: 1, text: "component App:\n    let dialog: DialogElement? = null\n    return <img />\n" } },
  });
  const published = await waitFor((message) => message.method === "textDocument/publishDiagnostics");
  const diagnostics = (published.params as { diagnostics: Array<{ code: string }> }).diagnostics;
  assert.ok(diagnostics.some((item) => item.code === "VEL5016"));

  const fixUri = pathToFileURL(join(directory, "fix.vel")).href;
  const fixText = "const same = 1 === 1\n\tprint(same)\nconst enabled = True && !False\n";
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
  assert.deepEqual(fixes.map((item) => item.edit.changes[fixUri]![0]!.newText).sort(), ["    ", "and", "false", "not", "true", "=="].sort());
  assert.ok(fixes.every((item) => item.kind === "quickfix" && item.isPreferred));

  const namedFixUri = pathToFileURL(join(directory, "named-fix.vel")).href;
  const namedFixText = "def greet(name: string):\n    pass\n\ngreet(name: \"Ada\")\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: namedFixUri, languageId: "velar", version: 1, text: namedFixText } },
  });
  const namedPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === namedFixUri);
  const namedDiagnostics = (namedPublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  send({
    jsonrpc: "2.0",
    id: 130,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: namedFixUri }, context: { diagnostics: namedDiagnostics, only: ["quickfix"] } },
  });
  const namedFixed = await waitFor((message) => message.id === 130);
  assert.deepEqual((namedFixed.result as Array<{ edit: { changes: Record<string, Array<{ newText: string }>> } }>).map((item) => item.edit.changes[namedFixUri]![0]!.newText), ["="]);

  const memberFixUri = pathToFileURL(join(directory, "member-fix.vel")).href;
  const memberFixText = "const values: List<number> = []\nvalues.push(1)\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: memberFixUri, languageId: "velar", version: 1, text: memberFixText } },
  });
  const memberPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === memberFixUri);
  const memberDiagnostics = (memberPublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  send({
    jsonrpc: "2.0",
    id: 131,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: memberFixUri }, context: { diagnostics: memberDiagnostics, only: ["quickfix"] } },
  });
  const memberFixed = await waitFor((message) => message.id === 131);
  assert.deepEqual((memberFixed.result as Array<{ edit: { changes: Record<string, Array<{ newText: string }>> } }>).map((item) => item.edit.changes[memberFixUri]![0]!.newText), ["append"]);

  const typeFixUri = pathToFileURL(join(directory, "type-fix.vel")).href;
  const typeFixText = "const values: Array<number> = []\nconst tags: Set[string] = Set()\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: typeFixUri, languageId: "velar", version: 1, text: typeFixText } },
  });
  const typePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === typeFixUri);
  const typeDiagnostics = (typePublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  assert.equal(typeDiagnostics.filter((item) => item.code === "VEL2012").length, 2);
  send({
    jsonrpc: "2.0",
    id: 132,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: typeFixUri }, context: { diagnostics: typeDiagnostics, only: ["quickfix"] } },
  });
  const typeFixed = await waitFor((message) => message.id === 132);
  assert.deepEqual((typeFixed.result as Array<{ edit: { changes: Record<string, Array<{ newText: string }>> } }>).map((item) => item.edit.changes[typeFixUri]![0]!.newText), ["List", "<string>"]);

  const unsafeFixUri = pathToFileURL(join(directory, "unsafe-fix.vel")).href;
  const unsafeFixText = "const values: List<number> = [1]\nvalues.findIndex(value => value > 0)\nvalues.sort()\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: unsafeFixUri, languageId: "velar", version: 1, text: unsafeFixText } },
  });
  const unsafePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === unsafeFixUri);
  const unsafeDiagnostics = (unsafePublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  assert.equal(unsafeDiagnostics.length, 2);
  send({
    jsonrpc: "2.0",
    id: 133,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: unsafeFixUri }, context: { diagnostics: unsafeDiagnostics, only: ["quickfix"] } },
  });
  const unsafeFixed = await waitFor((message) => message.id === 133);
  assert.deepEqual(unsafeFixed.result, []);

  send({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: { textDocument: { uri: scratchUri }, position: { line: 0, character: 2 } } });
  const hovered = await waitFor((message) => message.id === 2);
  assert.match(JSON.stringify(hovered.result), /compiler-managed Web component/);
  send({ jsonrpc: "2.0", id: 3, method: "textDocument/completion", params: { textDocument: { uri: scratchUri }, position: { line: 0, character: 0 } } });
  const completed = await waitFor((message) => message.id === 3);
  assert.match(JSON.stringify(completed.result), /bind:value/);
  assert.match(JSON.stringify(completed.result), /abstract/);
  assert.match(JSON.stringify(completed.result), /override/);
  assert.match(JSON.stringify(completed.result), /"label":"get"/);
  assert.match(JSON.stringify(completed.result), /constructor/);
  assert.doesNotMatch(JSON.stringify(completed.result), /"label":"init"/u);
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
  send({ jsonrpc: "2.0", id: 20, method: "textDocument/hover", params: { textDocument: { uri: scratchUri }, position: { line: 1, character: 18 } } });
  const dialogTypeHover = await waitFor((message) => message.id === 20);
  assert.match(JSON.stringify(dialogTypeHover.result), /native dialog reference/);

  const coreDirectory = join(directory, "core");
  const corePath = join(coreDirectory, "main.vel");
  const coreUri = pathToFileURL(corePath).href;
  const coreText = "const value = 1\n";
  await mkdir(coreDirectory, { recursive: true });
  await writeFile(join(coreDirectory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(corePath, coreText, "utf8");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: coreUri, languageId: "velar", version: 1, text: coreText } },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === coreUri);
  send({ jsonrpc: "2.0", id: 33, method: "textDocument/completion", params: { textDocument: { uri: coreUri }, position: { line: 0, character: 0 } } });
  const coreCompletion = await waitFor((message) => message.id === 33);
  const coreCompletionText = JSON.stringify(coreCompletion.result);
  assert.doesNotMatch(coreCompletionText, /bind:value|DialogElement|velar\/web|velar\/app|"label":"component"|"label":"resource"|"label":"mounted"/u);
  assert.match(coreCompletionText, /velar\/test/);
  assert.match(coreCompletionText, /"label":"const"/);

  const invalidDirectory = join(directory, "invalid-config");
  const invalidPath = join(invalidDirectory, "main.vel");
  const invalidUri = pathToFileURL(invalidPath).href;
  await mkdir(invalidDirectory, { recursive: true });
  await writeFile(invalidPath, "const value = 1\n", "utf8");
  await writeFile(join(invalidDirectory, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel", extensions: [] }), "utf8");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: invalidUri, languageId: "velar", version: 1, text: "const value = 1\n" } },
  });
  const invalidPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === invalidUri);
  const invalidDiagnostics = (invalidPublished.params as { diagnostics: Array<{ code: string; message: string }> }).diagnostics;
  assert.ok(invalidDiagnostics.some((item) => item.code === "VEL9001" && /unsupported formatVersion 1/u.test(item.message)));

  const carriageReturnText = "const first = 1\rconst second = first\r";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: { textDocument: { uri: coreUri, version: 2 }, contentChanges: [{ text: carriageReturnText }] },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === coreUri
    && (message.params as { version?: number }).version === 2);
  send({
    jsonrpc: "2.0",
    id: 34,
    method: "textDocument/definition",
    params: { textDocument: { uri: coreUri }, position: { line: 1, character: "const second = ".length + 1 } },
  });
  const carriageReturnDefinition = await waitFor((message) => message.id === 34);
  assert.equal((carriageReturnDefinition.result as { uri: string; range: { start: { line: number; character: number } } }).uri, coreUri);
  assert.deepEqual((carriageReturnDefinition.result as { range: { start: { line: number; character: number } } }).range.start, { line: 0, character: 6 });

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
  assert.match(JSON.stringify(signature.result), /greet\(name: string\) -&gt; string|greet\(name: string\) -> string/u);
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
  assert.ok(memberItems.some((item) => item.label === "reload" && item.kind === 2 && item.detail === "() -> Promise<null>"));
  const reloadCallColumn = mainText.split("\n")[9]!.indexOf("remote.reload(") + "remote.reload(".length;
  send({ jsonrpc: "2.0", id: 27, method: "textDocument/signatureHelp", params: { textDocument: { uri: mainUri }, position: { line: 9, character: reloadCallColumn } } });
  const memberSignature = await waitFor((message) => message.id === 27);
  assert.deepEqual(memberSignature.result, {
    signatures: [{ label: "reload() -> Promise<null>" }],
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

test("leading-dot lines continue the previous logical line across statement positions", () => {
  const returned = compile(`
def titles(items: List<string>) -> List<string>:
    return items
        .filter(value => value != "")
        .map(value => value)

let cleaned = titles(["a", "", "b"])
    .filter(value => value != "b")
print(cleaned)
print(titles(["x", ""])
    .map(value => value))
`.trimStart());
  assert.deepEqual(returned.diagnostics, []);
  const execution = executeModule(returned.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 'a' ]\n[ 'x' ]\n");

  const optionalContinuation = compile(`
def measure(values: List<string>?) -> number:
    return values
        ?.size ?? 0

print(measure(null))
`.trimStart());
  assert.deepEqual(optionalContinuation.diagnostics, []);
  const optionalExecution = executeModule(optionalContinuation.code ?? "");
  assert.equal(optionalExecution.stdout, "0\n");

  // '.5' is not a member chain, so the line does not join and still reports
  // its own expression error rather than silently becoming 'a.5'.
  const numeric = compile("let a = 1\n.5\n");
  assert.ok(numeric.diagnostics.some((item) => item.code === "VEL2002"), JSON.stringify(numeric.diagnostics));

  // Trailing-dot continuation stays unsupported.
  const trailing = compile("def broken(items: List<string>) -> List<string>:\n    return items.\n        filter(value => value != \"\")\n");
  assert.ok(trailing.diagnostics.some((item) => item.code === "VEL2001"), JSON.stringify(trailing.diagnostics));

  // A block header ending with ':' never joins with a dot line.
  const header = compile("def broken():\n    .run()\n");
  assert.ok(header.diagnostics.length > 0);
});

test("formatter normalizes multi-line chains one level past their statement and round-trips", () => {
  const formatted = formatSource([
    "def titles(items: List<string>) -> List<string>:",
    "    return items",
    "      .filter(value => value != \"\")",
    "            .map(value => value)",
    "",
  ].join("\n"));
  assert.equal(formatted, [
    "def titles(items: List<string>) -> List<string>:",
    "    return items",
    "        .filter(value => value != \"\")",
    "        .map(value => value)",
    "",
  ].join("\n"));
  assert.equal(formatSource(formatted), formatted);

  // Existing single-line chains are not reflowed.
  const single = "const kept = values.filter(value => value != \"\").map(value => value)\n";
  assert.equal(formatSource(single), single);
});

test("string and number methods are checked, bindable, and Unicode-aware", async () => {
  const api = standardModuleApi();
  assert.ok(["length", "char", "slice", "trim", "lower", "upper", "startsWith", "endsWith", "includes", "split", "replace", "replaceAll", "repeat", "padStart", "padEnd"]
    .every((name) => !api.modules["velar/text"]?.includes(name)));
  assert.ok(["abs", "round", "floor", "ceil"].every((name) => !api.modules["velar/math"]?.includes(name)));

  const result = compile(`
const sample = "VelarScript"
const decimal = 3.14159
print("héllo".size)
print("a😀b".size)
print(" a😀b ".trim().upper())
print("a😀b".char(index=1) ?? "null")
print("a😀b".char(-1) ?? "null")
print("abc".char(9) ?? "null")
print("a😀bc".slice(start=1, end=3))
print("abcdef".slice(-3))
print("abcdef".slice(end=3))
print(sample.has("Script"))
print("VelarScript".startsWith("Velar"))
print("VelarScript".endsWith(text="Script"))
print("a,b".split(",").join("|"))
print("a-a".replace("a", "x"))
print("a-a".replaceAll(from="a", to="x"))
print("7".padStart(3, "0"))
print("7".padEnd(size=3, fill="0"))
print("ab".repeat(2))
print(0.abs())
print((-2).abs())
print(1.5.round())
print(1.5.floor())
print(1.5.ceil())
print(decimal.toFixed(digits=2))

let receiverReads = 0
def title() -> string:
    receiverReads += 1
    return "Velar"
const cut = title().slice
print(cut(start=1, end=4))
print(receiverReads)
const maybe: string? = null
print(maybe?.trim() ?? "missing")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarStringSlice/u);
  assert.match(result.code ?? "", /__velarNumberToFixed/u);
  const sampleSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "sample");
  const decimalSymbol = result.semanticIndex.symbols.find((symbol) => symbol.name === "decimal");
  assert.ok(sampleSymbol?.members.some((member) => member.name === "size" && member.kind === "field"));
  assert.ok(sampleSymbol?.members.some((member) => member.name === "trim" && member.kind === "method"));
  assert.ok(decimalSymbol?.members.some((member) => member.name === "toFixed" && member.kind === "method"));
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "5", "3", "A😀B", "😀", "b", "null", "😀b", "def", "abc", "true", "true", "true", "a|b", "x-a", "x-x", "007", "700", "abab",
    "0", "2", "2", "1", "2", "3.14", "ela", "1", "missing", "",
  ].join("\n"));

  // Removed function forms and JavaScript spellings point at the one current method surface.
  const guided = compile(`
let word = "hello"
print(word.length)
print(word.substring(0, 2))
print(word.charAt(1))
print(word.at(-1))
print(word[0])
print(word.toUpperCase())
print(word.includes("e"))
print((1).toString())
print(trim(word))
print(abs(1))
`.trimStart());
  const messages = guided.diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /Use '\.size'/u.test(message)));
  assert.ok(messages.some((message) => /Use '\.slice\(start, end\)'/u.test(message)));
  assert.equal(messages.filter((message) => /Use '\.char\(index\)'/u.test(message)).length, 3);
  assert.ok(messages.some((message) => /Use '\.upper\(\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use '\.has\(text\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use 'str\(value\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use 'value\.trim\(\)'/u.test(message)));
  assert.ok(messages.some((message) => /Use 'value\.abs\(\)'/u.test(message)));

  const directory = await mkdtemp(join(tmpdir(), "velar-method-guidance-"));
  const entry = join(directory, "main.vel");
  await writeFile(entry, `import {trim} from "velar/text"\nimport {round} from "velar/math"\nprint(trim("x"))\nprint(round(1))\n`, "utf8");
  const project = await compileProject(entry);
  assert.ok(project.failures.some((failure) => failure.message.includes("Use 'value.trim()'")), JSON.stringify(project.failures));
  assert.ok(project.failures.some((failure) => failure.message.includes("Use 'value.round()'")), JSON.stringify(project.failures));
});

test("bare JSX for blocks and event-arrow assignments receive directive guidance", () => {
  const bareFor = compile(`
type Message:
    id: string
    text: string

component MessageList(messages: List<Message>):
    return <ul>
        for message in messages:
            <li key={message.id}>{message.text}</li>
    </ul>
`.trimStart());
  assert.ok(bareFor.diagnostics.some((item) => item.code === "VEL5049"
    && item.message.includes("Use '{messages.map((message) => ...)}'")), JSON.stringify(bareFor.diagnostics));

  const eventAssignment = compile(`
component Composer():
    state draft: string = ""
    return <input value={draft} onInput={event => draft = event.value} placeholder="Say hi" />
`.trimStart());
  const codes = eventAssignment.diagnostics.map((item) => item.code);
  assert.ok(codes.includes("VEL2028"), JSON.stringify(eventAssignment.diagnostics));
  assert.ok(eventAssignment.diagnostics.some((item) => item.code === "VEL5019" && item.message.includes("Use 'bind:value={draft}'")));
  assert.ok(eventAssignment.diagnostics.some((item) => item.code === "VEL5025" && item.message.includes("Use 'on:input'")));

  // The same guidance appears when the on: directive is already correct.
  const directive = compile(`
component Composer():
    state draft: string = ""
    return <input value={draft} on:input={event => draft = event.data} placeholder="Say hi" />
`.trimStart());
  assert.ok(directive.diagnostics.some((item) => item.code === "VEL5019" && item.message.includes("Use 'bind:value={draft}'")), JSON.stringify(directive.diagnostics));

  const statementGuidance = compile("component App():\n    state count: number = 0\n    return <p>{count = 4}</p>\n");
  assert.ok(statementGuidance.diagnostics.some((item) => item.code === "VEL2028" && /Assignment is a statement/u.test(item.message)));
});

test("multi-token Look shorthand strings are rejected with builder guidance", () => {
  const source = (entry: string): string => `component App():\n    const appearance = look:\n        ${entry}\n    return <div look={appearance}>ok</div>\n`;
  for (const [entry, guidance] of [
    ["padding = \"8px 12px\"", "Use 'spacing(8px, 12px)'"],
    ["margin = \"4px 0\"", "Use 'spacing(4px, 0px)'"],
    ["borderRadius = \"6px 12px\"", "Use 'spacing(6px, 12px)'"],
    ["border = \"1px solid #d9dce1\"", "Use 'border(1px, color(\"#d9dce1\"))'"],
    ["outline = \"2px dashed red\"", "Use 'border(2px, color(\"red\"), \"dashed\")'"],
    ["boxShadow = \"0 2px 4px #00000022\"", "Use the 'shadow(x, y, blur, color)' builder"],
    ["transition = \"opacity 0.3s ease\"", "Use 'transition(\"opacity\", 0.3s, \"ease\")'"],
  ] as const) {
    const rejected = compile(source(entry));
    assert.ok(rejected.diagnostics.some((item) => item.code === "VEL5038" && item.message.includes(guidance)),
      `${entry}: ${JSON.stringify(rejected.diagnostics)}`);
  }

  // Single-token keyword strings, hex colors, and out-of-family strings stay accepted.
  const accepted = compile(source("alignSelf = \"flex-start\"\n        marginInline = \"auto\"\n        fontWeight = \"bold\"\n        background = \"#eef0f3\"\n        fontFamily = \"Segoe UI, sans-serif\""));
  assert.deepEqual(accepted.diagnostics, []);

  // A kebab-case property recovers as its camelCase entry, so the shorthand
  // rejection and camelCase guidance co-report in one compile.
  const kebab = compile(source("border-radius = \"6px\"\n        padding = \"8px 12px\""));
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038" && item.message.includes("Use 'borderRadius'")));
  assert.ok(kebab.diagnostics.some((item) => item.code === "VEL5038" && item.message.includes("Use 'spacing(8px, 12px)'")));
});

test("named re-exports join the module interface with aliases and live-export flags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-re-export-"));
  const libraryPath = join(directory, "library.vel");
  const barrelPath = join(directory, "barrel.vel");
  const consumerPath = join(directory, "consumer.vel");
  await writeFile(libraryPath, `
export type Report:
    total: number

export let counter = 0

export def bump():
    counter += 1

export def greet(name: string) -> string:
    return "Hello, " + name
`.trimStart(), "utf8");
  await writeFile(barrelPath, `export {Report, counter, bump, greet as hello} from "./library.vel"\n`, "utf8");
  const consumerSource = `
import {Report, counter, bump, hello} from "./barrel.vel"

const report: Report = {total: 1}
print(hello("Velar"))
print(counter)
bump()
print(counter)
print(report.total)
`.trimStart();
  await writeFile(consumerPath, consumerSource, "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const barrel = project.modules.find((module) => module.inputPath === barrelPath);
  assert.equal(barrel?.result.code, "export { Report, counter, bump, greet as hello } from \"./library.js\";\n");
  const symbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(symbols?.find((item) => item.name === "hello")?.type, "(name: string) -> string");

  // Go-to-definition follows the re-export chain to the origin declaration.
  const definition = projectDefinitionAt(project, consumerPath, consumerSource.indexOf("hello(\"Velar\")") + 1);
  assert.equal(definition?.path, libraryPath);

  // The live export propagates: a namespace import of the barrel is rejected
  // exactly like a namespace import of the origin module.
  const namespacePath = join(directory, "namespace.vel");
  await writeFile(namespacePath, `import * as barrel from "./barrel.vel"\n\nprint(barrel.hello("Velar"))\n`, "utf8");
  const namespaceProject = await compileProject(namespacePath);
  assert.ok(namespaceProject.failures.some((failure) => /exports live values; import them by name/u.test(failure.message)),
    JSON.stringify(namespaceProject.failures));

  // End-to-end: the compiled re-export stays a live ES-module binding.
  const cli = resolve("packages/cli/src/cli.ts");
  const execution = spawnSync(process.execPath, [cli, "run", consumerPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Hello, Velar\n0\n1\n1\n");
});

test("named re-exports work from package sources and package barrels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-re-export-package-"));
  const packageRoot = join(directory, "node_modules", "velar-lib");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar-lib", velar: { entry: "src/index.vel" } }), "utf8");
  await writeFile(join(packageRoot, "src", "impl.vel"), `
export def greet(name: string) -> string:
    return "Hello, " + name
`.trimStart(), "utf8");
  // The package entry is itself a barrel of internal modules.
  await writeFile(join(packageRoot, "src", "index.vel"), `export {greet} from "./impl.vel"\n`, "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {packaged} from "./barrel.vel"

print(packaged("Velar"))
`.trimStart(), "utf8");
  // The application barrel re-exports directly from the package source.
  await writeFile(join(directory, "src", "barrel.vel"), `export {greet as packaged} from "velar-lib"\n`, "utf8");

  const project = await compileProject(join(directory, "src", "main.vel"), new Map(), {
    sourceRoot: join(directory, "src"),
    projectRoot: directory,
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const cli = resolve("packages/cli/src/cli.ts");
  const execution = spawnSync(process.execPath, [cli, "run"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Hello, Velar\n");
});

test("re-exports reject namespace form, duplicates, and missing origin names", async () => {
  const star = compile(`export * from "./library.vel"\n`);
  assert.ok(star.diagnostics.some((item) => item.code === "VEL2029"
    && item.message.includes("export {name, other as alias} from")), JSON.stringify(star.diagnostics));

  const empty = compile(`export {} from "./library.vel"\n`);
  assert.ok(empty.diagnostics.some((item) => item.code === "VEL2029" && /at least one export/u.test(item.message)),
    JSON.stringify(empty.diagnostics));

  const duplicate = compile(`export const value = 1\nexport {value} from "./library.vel"\n`);
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL3016"
    && item.message.includes("Export 'value' is declared more than once")), JSON.stringify(duplicate.diagnostics));
  const repeated = compile(`export {value} from "./a.vel"\nexport {value} from "./b.vel"\n`);
  assert.ok(repeated.diagnostics.some((item) => item.code === "VEL3016"), JSON.stringify(repeated.diagnostics));
  const aliased = compile(`export const value = 1\nexport {value as shared} from "./library.vel"\n`);
  assert.deepEqual(aliased.diagnostics, []);

  const directory = await mkdtemp(join(tmpdir(), "velar-re-export-missing-"));
  const libraryPath = join(directory, "library.vel");
  const barrelPath = join(directory, "barrel.vel");
  await writeFile(libraryPath, "export const present = 1\n", "utf8");
  await writeFile(barrelPath, `export {missing} from "./library.vel"\n`, "utf8");
  const project = await compileProject(barrelPath);
  assert.ok(project.failures.some((failure) => failure.message === "Module './library.vel' has no export named 'missing'"),
    JSON.stringify(project.failures));
});

test("extern default exports pin the class and constant contracts", () => {
  const source = `
type MarkdownItOptions:
    html: bool

type Highlighter:
    highlight: (code: string, language: string) -> string

extern module "markdown-it":
    export class default:
        constructor(options: MarkdownItOptions)
        def render(source: string) -> string

extern module "highlight.js/lib/common":
    export const default: Highlighter

import js MarkdownIt from "markdown-it"
import js hljs from "highlight.js/lib/common"

const renderer = MarkdownIt({html: false})

export def render(text: string) -> string:
    return renderer.render(text) + hljs.highlight(text, "vel")
`.trimStart();
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  // The bare import js form is the canonical default import; because the
  // source is governed by an extern module declaration, both shapes lower
  // through the presence-checked namespace bridge (W-22).
  assert.match(result.code ?? "", /const MarkdownIt = __velarExternExport\(__velarExternModule\d+, "default", "markdown-it"\);/u);
  assert.match(result.code ?? "", /const hljs = __velarExternExport\(__velarExternModule\d+, "default", "highlight\.js\/lib\/common"\);/u);
  // The declared contracts stay checked.
  const misuse = compileCore(source.replace("renderer.render(text)", "renderer.render(1)"));
  assert.ok(misuse.diagnostics.some((item) => item.code === "VEL4001"), JSON.stringify(misuse.diagnostics));
  // The explicit spelling is equivalent and lowers to the same checked bridge.
  const explicit = compileCore(`
extern module "markdown-it":
    export const default: string

import js {default as banner} from "markdown-it"

print(banner)
`.trimStart());
  assert.deepEqual(explicit.diagnostics, []);
  assert.match(explicit.code ?? "", /const banner = __velarExternExport\(__velarExternModule\d+, "default", "markdown-it"\);/u);
  // The formatter accepts both declaration shapes unchanged.
  assert.equal(formatSource(source), source);
});

test("a manual extern module silences the declaration probe for its source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-extern-probe-"));
  const packageRoot = join(directory, "node_modules", "manual-owned");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "manual-owned",
    type: "module",
    main: "index.js",
    types: "index.d.ts",
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const helper = () => \"ok\";\n", "utf8");
  // This declaration file produces a probe notice: the export table names a
  // local binding that is never declared.
  await writeFile(join(packageRoot, "index.d.ts"), "export { helper };\n", "utf8");

  const declaredPath = join(directory, "declared.vel");
  await writeFile(declaredPath, `
extern module "manual-owned":
    export def helper() -> string

import js {helper} from "manual-owned"

print(helper())
`.trimStart(), "utf8");
  const declared = await compileProject(declaredPath);
  assert.deepEqual(declared.failures, []);
  assert.deepEqual(declared.modules.flatMap((module) => module.result.diagnostics), []);
  assert.deepEqual(declared.notices, []);

  // Without the manual declaration the same probe notice still surfaces.
  const undeclaredPath = join(directory, "undeclared.vel");
  await writeFile(undeclaredPath, `import js {helper} from "manual-owned"\n\nprint(helper)\n`, "utf8");
  const undeclared = await compileProject(undeclaredPath);
  assert.ok(undeclared.notices.some((notice) => notice.message.includes("manual-owned")
    && notice.message.includes("was not found and was kept as unknown")), JSON.stringify(undeclared.notices));
});

test("extern classes share one contract across modules and conflicting redeclarations are reported", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-extern-contract-"));
  const libraryPath = join(directory, "library.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(libraryPath, `
extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

import js {IncomingMessage} from "node:http"

export def describe(request: IncomingMessage) -> string:
    return request.url
`.trimStart(), "utf8");

  // Each module declares its own extern block for the same source; matching
  // declarations of the same class are one nominal identity everywhere.
  await writeFile(mainPath, `
import {describe} from "./library.vel"

extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

    export def request(target: string) -> IncomingMessage

import js {IncomingMessage, request} from "node:http"

const message: IncomingMessage = request("/status")
print(describe(message))
`.trimStart(), "utf8");
  const unified = await compileProject(mainPath);
  assert.deepEqual(unified.failures, []);
  assert.deepEqual(unified.modules.flatMap((module) => module.result.diagnostics), []);

  // A redeclaration that disagrees structurally is reported at the later
  // declaration instead of silently forking the identity.
  await writeFile(mainPath, `
import {describe} from "./library.vel"

extern module "node:http":
    export class IncomingMessage:
        const url: number
        pass

    export def request(target: string) -> IncomingMessage

import js {IncomingMessage, request} from "node:http"

const message: IncomingMessage = request("/status")
print(describe(message))
`.trimStart(), "utf8");
  const conflicting = await compileProject(mainPath);
  assert.deepEqual(conflicting.failures, []);
  assert.ok((conflicting.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics ?? [])
    .some((item) => item.code === "VEL4005"
      && /Extern class 'IncomingMessage' from 'node:http' is already declared with a different shape/u.test(item.message)));

  // Genuinely different identities with the same class name report both
  // declaring sources instead of an unexplained "different contract".
  await writeFile(mainPath, `
import {describe} from "./library.vel"

extern module "node:http2":
    export class IncomingMessage:
        const url: string
        pass

    export def request(target: string) -> IncomingMessage

import js {IncomingMessage, request} from "node:http2"

const message: IncomingMessage = request("/status")
print(describe(message))
`.trimStart(), "utf8");
  const mismatched = await compileProject(mainPath);
  assert.deepEqual(mismatched.failures, []);
  assert.ok((mismatched.modules.find((module) => module.inputPath === mainPath)?.result.diagnostics ?? [])
    .some((item) => /Cannot assign IncomingMessage to a different IncomingMessage contract \(the value is the extern class from "node:http2" and the target is the extern class from "node:http"\)/u.test(item.message)));
});

test("velar test and velar run resolve bridged npm dependencies from the project", async () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const directory = await mkdtemp(join(tmpdir(), "velar-bridged-sandbox-"));
  const packageRoot = join(directory, "node_modules", "word-count");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel", extensions: [] }), "utf8");
  // The project's own package manifest deliberately omits "type": the compiled
  // sandbox carries its own ES-module manifest.
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "bridged-fixture", private: true }), "utf8");
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "word-count", type: "module", main: "index.js" }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export function countWords(text) { return text.split(/\\s+/u).filter(Boolean).length; }\n", "utf8");
  await writeFile(join(directory, "src", "words.vel"), `
extern module "word-count":
    export def countWords(text: string) -> number

import js {countWords} from "word-count"

export def measure(text: string) -> number:
    return countWords(text)
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {measure} from "./words.vel"

print(measure("velar test resolves bridged packages"))
`.trimStart(), "utf8");
  await writeFile(join(directory, "src", "words.test.vel"), `
import {expect} from "velar/test"
import {measure} from "./words.vel"

def test_bridged_dependency():
    expect(measure("one two three")).toBe(3)
`.trimStart(), "utf8");

  // No TMPDIR override: the compiled tree must resolve the bridged package
  // through the project's own node_modules.
  const tested = spawnSync(process.execPath, [cli, "test"], { cwd: directory, encoding: "utf8" });
  assert.equal(tested.status, 0, String(tested.stderr));
  assert.match(tested.stdout, /words\.test\.vel :: test_bridged_dependency/u);
  assert.match(tested.stdout, /1 passed, 0 failed/u);

  const ran = spawnSync(process.execPath, [cli, "run"], { cwd: directory, encoding: "utf8" });
  assert.equal(ran.status, 0, String(ran.stderr));
  assert.equal(ran.stdout, "5\n");

  // The in-project sandbox cleans up after itself.
  const entries = await readdir(directory);
  assert.ok(!entries.includes(".velar"), JSON.stringify(entries));
});

test("route components check without importing RouteContext at the call site", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-route-context-"));
  const pagePath = join(directory, "page.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(pagePath, `
import {RouteContext} from "velar/web"

export component ItemPage(route: RouteContext):
    return <p>{route.path}</p>
`.trimStart(), "utf8");
  // The importing module uses route() and Router without naming RouteContext:
  // the check must resolve the canonical identity rather than the bare name.
  await writeFile(mainPath, `
import {Router, route} from "velar/web"
import {ItemPage} from "./page.vel"

component App:
    return <Router routes={[route("/items/:id", ItemPage)]} fallback={ItemPage} />

mount(<App />, "#app")
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  for (const module of project.modules) {
    assert.deepEqual(module.result.diagnostics, []);
  }
});
