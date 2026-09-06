import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { compile as compileCore, describeType } from "@velarscript/compiler";
import { VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY } from "@velarscript/compiler/extension";
import { type ValueType } from "../../../packages/compiler/src/types.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("explicit null results end naturally while omitted results are inferred", () => {
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

  const inferredValueResult = compile(`
def answer():
    return 42
`.trimStart());
  assert.deepEqual(inferredValueResult.diagnostics, []);
  assert.equal(inferredValueResult.semanticIndex.symbols.find((item) => item.name === "answer")?.type, "() -> number");

  const asynchronous = compile(`
async def save():
    print("saved")
`.trimStart());
  assert.deepEqual(asynchronous.diagnostics, []);
  assert.equal(asynchronous.semanticIndex.symbols.find((item) => item.name === "save")?.type, "() -> Promise<null>");
});

test("literal true loops without a reachable break cannot fall through a function result", () => {
  const accepted = compileCore(`
def waitForever(ready: bool) -> number:
    while true:
        if ready:
            return 1

def nestedBreakDoesNotEscape() -> number:
    while true:
        while true:
            break

def deadBreakDoesNotEscape() -> number:
    while true:
        return 2
        break
`.trimStart());
  assert.deepEqual(accepted.diagnostics, []);

  const fallthrough = compileCore(`
def conditionCanFail(ready: bool) -> number:
    while ready:
        return 1

def reachableBreakCanExit(ready: bool) -> number:
    while true:
        if ready:
            break
        return 1
`.trimStart());
  assert.equal(fallthrough.diagnostics.filter((item) => item.code === "VEL4006").length, 2);
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
  // BRG-U10: module-initialization calls across the JavaScript boundary
  // rethrow through the owned Error normalization, so each shape carries the
  // guard around the same undefined-normalization contract as before.
  const guarded = (call: string): string => `\\(\\(\\) => \\{ try \\{ return ${call}; \\} catch \\(__velarThrown\\) \\{ throw __velarNormalizeError\\(__velarThrown\\); \\} \\}\\)\\(\\)`;
  assert.match(result.code ?? "", new RegExp(`\\(${guarded("external\\(\\)")}, null\\)`, "u"));
  assert.match(result.code ?? "", new RegExp(`await __velarNormalizePromiseValue\\(${guarded("externalAsync\\(\\)")}\\)`, "u"));
  assert.match(result.code ?? "", new RegExp(guarded("\\(externalOptional\\(\\) \\?\\? null\\)"), "u"));
  assert.match(result.code ?? "", new RegExp(`await __velarNormalizePromiseValue\\(${guarded("externalOptionalAsync\\(\\)")}\\)`, "u"));
  assert.match(result.code ?? "", new RegExp(`\\(${guarded("externalUnknown\\(\\)")} \\?\\? null\\)`, "u"));
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
Object.defineProperty(globalThis, Symbol.for(${JSON.stringify(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY)}), {
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

test("List.reduce evaluates getter callbacks before later arguments", () => {
  // The getter that supplies the callback executes before the initial value;
  // the later narrowed read is revalidated at runtime.
  const result = compileCore(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get combine() -> (string, string) -> string:
        self.user = null
        return (left, value) => left

def label(box: Box) -> string:
    assert box.user != null
    return ["value"].reduce(box.combine, box.user.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /NarrowingError/u);

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
    let cursor = 0
    while true:
        const chunk = chunks.get(cursor)
        if chunk == null:
            break
        assembled += chunk
        cursor += 1
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
