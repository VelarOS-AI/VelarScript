import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile as compileCore, describeType, formatSource } from "@velarscript/compiler";
import { compileProject as compileProjectCore } from "../../../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

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
  assert.match(result.code ?? "", /const count = \(\.\.\.values\) => __velarListSize\(values\);/u);
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

async def supply() -> number:
    return 5

async def use(value: number) -> number:
    return value * 3

const load: (number) -> Promise<number> = async value => await next(value)
const combine = async (left: number, right: number) => next(left + right)
const member = (await result()).value
const immediate = await (async () => next(8))()
const nested = await use(await supply())
print(await load(2))
print(await combine(3, 4))
print(member)
print(immediate)
print(nested)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "load")?.type, "(number) -> Promise<number>");
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "combine")?.type, "(left: number, right: number) -> Promise<number>");
  assert.match(result.code ?? "", /const load = async value => await __velarNormalizePromiseValue\(next\(value\)\);/u);
  assert.match(result.code ?? "", /const combine = async \(left, right\) => __velarNormalizePromiseValue\(next\(\(left \+ right\)\)\);/u);
  assert.match(result.code ?? "", /const member = \(await __velarNormalizePromiseValue\(result\(\)\)\)\.value;/u);
  // The wrapper covers exactly the value it wraps, so an inner async arrow
  // body keeps its own boundary instead of inheriting the outer call's
  // suppression: the concise `next(8)` is normalized where it is produced.
  assert.match(result.code ?? "", /const immediate = await __velarNormalizePromiseValue\(\(async \(\) => __velarNormalizePromiseValue\(next\(8\)\)\)\(\)\);/u);
  // A nested await produces a *different* Promise from the one the outer call
  // returns, so both boundaries are checked rather than only the outer one.
  assert.match(result.code ?? "", /const nested = await __velarNormalizePromiseValue\(use\(await __velarNormalizePromiseValue\(supply\(\)\)\)\);/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\n8\n10\n9\n15\n");

  const synchronousAwait = compile(`
async def task() -> number:
    return 1
const invalid = () => await task()
`.trimStart());
  assert.ok(synchronousAwait.diagnostics.some((item) => item.code === "VEL4007" && /async function/u.test(item.message)));

  const incompatible = compile("const invalid: (number) -> number = async value => value\n");
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign \(value: number\) -> Promise<number> to \(number\) -> number/u.test(item.message)));
});

test("local def declarations are visible throughout their lexical block", () => {
  const source = `
def parity(value: number) -> string:
    const result = even(value)

    def even(current: number) -> string:
        if current == 0:
            return "even"
        return odd(current - 1)

    def odd(current: number) -> string:
        if current == 0:
            return "odd"
        return even(current - 1)

    return result

print(parity(6))
print(parity(7))
`.trimStart();
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "even\nodd\n");

  const collisionSource = "def outer():\n    const value = 1\n    def value():\n        pass\n";
  const collision = compile(collisionSource);
  assert.equal(collision.diagnostics.filter((item) => item.code === "VEL3004").length, 1);
  assert.equal(collision.diagnostics.find((item) => item.code === "VEL3004")?.span.start, collisionSource.indexOf("def value"));
});

test("callback parameter names do not constrain structural function assignability", () => {
  const result = compile(`
type Handler = (request: string) -> string

def handle(_request: string) -> string:
    return _request

const handler: Handler = handle
print(handler(request="ok"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ok\n");
});

// D114 ③ retired the `Function<...>` family, so this test keeps only the
// shorthand that survives — bare `Promise`, a default type argument rather than
// a second syntax. The retirement itself is covered in
// tests/compiler/types/function-type-shorthand-retired.test.ts.
test("the bare Promise wrapper normalizes to the existing Core promise type", async () => {
  const result = compileCore(`
type Done = Promise
type Cleanup = () -> null
type Reader = () -> string
type Writer = (string) -> null
type Compare = (string, number) -> bool

def apply<T, U>(value: T, transform: (T) -> U) -> U:
    return transform(value)

async def save():
    pass

const pending: Promise = save()
const cleanup: Cleanup = () => null
const reader: Reader = () => "ready"
const writer: Writer = value => print(value)
const compare: Compare = (value, size) => value.size == size
const canonical: (string) -> null = writer
const wrapped: (string) -> null = canonical

print(reader())
writer("written")
print(compare("ok", 2))
print(apply(4, value => f"number:{value}"))
await pending
cleanup()
wrapped("wrapped")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const symbols = result.semanticIndex.symbols;
  assert.equal(symbols.find((item) => item.name === "pending")?.type, "Promise<null>");
  assert.equal(symbols.find((item) => item.name === "cleanup")?.type, "() -> null");
  assert.equal(symbols.find((item) => item.name === "reader")?.type, "() -> string");
  assert.equal(symbols.find((item) => item.name === "writer")?.type, "(string) -> null");
  assert.equal(symbols.find((item) => item.name === "compare")?.type, "(string, number) -> bool");
  assert.equal(symbols.find((item) => item.name === "canonical")?.type, "(string) -> null");
  assert.equal(symbols.find((item) => item.name === "wrapped")?.type, "(string) -> null");
  assert.equal(describeType(result.moduleInterface.typeAliases.get("Done")!), "Promise<null>");
  assert.equal(describeType(result.moduleInterface.typeAliases.get("Cleanup")!), "() -> null");
  assert.equal(describeType(result.moduleInterface.typeAliases.get("Reader")!), "() -> string");
  assert.equal(describeType(result.moduleInterface.typeAliases.get("Writer")!), "(string) -> null");
  assert.equal(describeType(result.moduleInterface.typeAliases.get("Compare")!), "(string, number) -> bool");
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\nwritten\ntrue\nnumber:4\nwrapped\n");

  const directory = await makeTemporaryDirectory("velar-type-wrapper-contract-");
  const libraryPath = join(directory, "library.vel");
  const consumerPath = join(directory, "consumer.vel");
  await writeFile(libraryPath, `
export type Done = Promise
export type Transform = (string) -> number

export async def finish():
    pass

export const transform: Transform = value => value.size
`.trimStart(), "utf8");
  await writeFile(consumerPath, `
import {Done, finish, transform, Transform} from "./library.vel"

const pending: Done = finish()
const canonical: (string) -> number = transform
const wrapped: Transform = canonical
await pending
print(wrapped("Velar"))
`.trimStart(), "utf8");
  const project = await compileProjectCore(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const consumerSymbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(consumerSymbols?.find((item) => item.name === "pending")?.type, "Promise<null>");
  assert.equal(consumerSymbols?.find((item) => item.name === "wrapped")?.type, "(string) -> number");

  const invalidPromise = compileCore("const pending: Promise<string, number> = null\n");
  assert.ok(invalidPromise.diagnostics.some((item) => /Type 'Promise' expects 1 type argument/u.test(item.message)));
  const nestedPromise = compileCore("async def invalid() -> Promise:\n    pass\n");
  assert.ok(nestedPromise.diagnostics.some((item) => item.code === "VEL4018" && /not '-> Promise<T>'/u.test(item.message)));
  const runtimePromise = compileCore("Promise()\n");
  // D51 rule 106: a permanent namespace is not a value, so calling one is
  // rejected as the position it is, before "not callable" can be asked.
  assert.ok(runtimePromise.diagnostics.some((item) => /'Promise' is a namespace, not a value/u.test(item.message)));

  const formatted = formatSource("const pending: Promise < string > = null\n");
  assert.equal(formatted, "const pending: Promise<string> = null\n");
  assert.equal(formatSource(formatted), formatted);
});
