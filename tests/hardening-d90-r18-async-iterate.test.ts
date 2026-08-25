import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";

// D90 R18 — asynchronous iteration aligns with synchronous iteration: a
// declaration, not duck typing.
//
// `@iterate:` has two forms, told apart by the answer's shape. The
// synchronous form answers a List, Set, Map, or Record and the eight plain
// consumers read it once; the asynchronous pull form answers `T?` — `async
// for` drives it once per element, it may await, and null is exhaustion. The
// structural `next() -> Promise<T?>` pull remains the contract of the
// declared foreign shapes only: capability handles and extern classes whose
// own contract declares the pull as a function-valued field.

function messages(source: string): string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function execute(source: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: result.code ?? "", timeout: 10_000 });
  return { status: execution.status, stdout: String(execution.stdout), stderr: String(execution.stderr) };
}

const pull = `
class Pull:
    const values: List<string> = ["a", "b", "c"]
    let position: number = 0

    @iterate:
        if self.position >= self.values.size:
            return null
        const value = self.values[self.position]
        self.position += 1
        return value
`.trimStart();

test("[D90 R18] a declared asynchronous '@iterate:' streams under 'async for'", () => {
  const run = execute(`${pull}
async def drain() -> string:
    let output = ""
    async for value, index in Pull():
        output += f"{index}:{value};"
    return output

print(await drain())
`);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0:a;1:b;2:c;\n");
});

test("[D90 R18] the pull form may await, and per-pull state is the instance's", () => {
  const run = execute(`
async def tick(n: number) -> number:
    return n * 10

class Pull:
    let position: number = 0

    @iterate:
        const beat = await tick(self.position)
        if self.position >= 2:
            return null
        self.position += 1
        return f"{beat}"

async def drain() -> string:
    const stream = Pull()
    let output = ""
    async for value in stream:
        output += f"{value};"
    return f"{output}|{stream.position}"

print(await drain())
`);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "0;10;|2\n");
});

test("[D90 R18] falling off the end of the pull block is exhaustion", () => {
  const run = execute(`
class Once:
    let sent: bool = false

    @iterate:
        if not self.sent:
            self.sent = true
            const value: string? = "only"
            return value

async def drain() -> string:
    let output = ""
    async for value in Once():
        output += value
    return output

print(await drain())
`);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "only\n");
});

test("[D90 R18] the emitted pull is the declared member, not a structural capture", () => {
  const result = compile(`${pull}
async def drain():
    async for value in Pull():
        print(value)
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /async \["__velar:iterateAsync"\]\(\)/u);
  assert.match(result.code ?? "", /await __velarNormalizePromiseValue\(__velarAsyncForSource\d+\["__velar:iterateAsync"\]\(\)\)/u);
  assert.doesNotMatch(result.code ?? "", /__velarAsyncPullNext/u);
});

test("[D90 R18] the two forms refuse each other's loop by name", () => {
  // The plain `for` refuses the pull form and names `async for`.
  assert.deepEqual(messages(`${pull}
for value in Pull():
    print(value)
`), [
    "VEL4001 Cannot iterate over Pull; '@iterate' on this class is the asynchronous pull form, which 'async for' drives — use 'async for', or answer a List, Set, Map, or Record to iterate here",
  ]);

  // `async for` refuses the synchronous form and names the declaration.
  assert.deepEqual(messages(`
class Bag:
    let items: List<string> = ["a"]

    @iterate:
        return self.items

async def drain():
    async for value in Bag():
        print(value)
`), [
    "VEL4001 async for pulls a declared asynchronous '@iterate:'; '@iterate' on Bag answers List<string> to the plain 'for' — declare the asynchronous form instead: a block that answers 'T?', one element per pull, null as exhaustion",
  ]);
});

test("[D90 R18] a bare async next() method is steered to the declaration", () => {
  // The duck path is closed for user classes: a structural resemblance is
  // not a contract, and the refusal names the move that declares one.
  assert.deepEqual(messages(`
class Duck:
    async def next() -> string?:
        return null

async def drain():
    async for value in Duck():
        print(value)
`), [
    "VEL4001 async for pulls a declared asynchronous '@iterate:'; Duck does not declare one — a block that answers 'T?' (it may await; one element per pull, null is exhaustion); 'next()' is a method of the author's namespace, not the contract — move its body into the '@iterate:' block",
  ]);
});

test("[D90 R18] a block that awaits but answers a collection is refused where it is written", () => {
  assert.deepEqual(messages(`
async def load() -> List<number>:
    return [1]

class Eager:
    @iterate:
        return await load()
`), [
    "VEL4038 '@iterate' in 'Eager' awaits but answers List<number>; the synchronous form is read whole by the plain consumers, so await the work before construction and hold the finished collection — or answer 'T?' to be the asynchronous pull form 'async for' drives once per element",
  ]);
});

test("[D90 R18] an answer that is neither form names both forms", () => {
  assert.deepEqual(messages(`
class Odd:
    @iterate:
        return 5
`), [
    "VEL4038 '@iterate' says what iterating 'Odd' means: the synchronous form returns a List, Set, Map, or Record — the shapes the language already knows how to iterate — and the asynchronous pull form answers 'T?', one element per pull with null as exhaustion; this block returns number",
  ]);
});

test("[D90 R18] a derived class inherits the pull form, and an override keeps the form and answer", () => {
  // Inheritance carries the declaration exactly as the synchronous form's.
  const inherited = execute(`${pull}
class Derived extends Pull:
    pass

async def drain() -> string:
    let output = ""
    async for value in Derived():
        output += value
    return output

print(await drain())
`);
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.equal(inherited.stdout, "abc\n");

  // An override that changes the element answer is refused.
  const changedAnswer = messages(`${pull}
class Renumbered extends Pull:
    @iterate:
        const done: number? = null
        return done
`);
  assert.ok(changedAnswer.some((item) => /'@iterate' override in 'Renumbered' must keep the base answer string\?/u.test(item)), changedAnswer.join("\n"));

  // An override that changes the form is refused in both directions.
  const toSync = messages(`${pull}
class Collected extends Pull:
    @iterate:
        return ["x"]
`);
  assert.ok(toSync.some((item) => /'@iterate' override in 'Collected' must keep the base form/u.test(item)), toSync.join("\n"));

  const toAsync = messages(`
class Bag:
    let items: List<string> = ["a"]

    @iterate:
        return self.items

class Streamed extends Bag:
    @iterate:
        const done: string? = null
        return done
`);
  assert.ok(toAsync.some((item) => /'@iterate' override in 'Streamed' must keep the base form/u.test(item)), toAsync.join("\n"));
});

test("[D90 R18] the declared foreign shapes keep the structural pull contract", () => {
  // A capability-handle shape (an object with a function-valued `next`
  // field) is a declaration in its own contract, and still streams.
  const handle = compile(`
import {source} from "pull-host"

async def drain():
    async for value in source:
        print(value)
`.trimStart(), { analysis: { imports: new Map([["source", {
    kind: "object",
    fields: new Map([["next", {
      kind: "function",
      parameters: [],
      requiredParameters: 0,
      result: { kind: "promise", value: { kind: "optional", inner: { kind: "string" } } },
    }]]),
  } as never]]) } });
  assert.deepEqual(handle.diagnostics, []);
  assert.match(handle.code ?? "", /__velarAsyncPullNext/u);

  // An extern class may declare the pull as a function-valued field.
  assert.deepEqual(messages(`
extern module "pull-host":
    export class DataPull:
        const next: () -> Promise<string?>

import js {DataPull} from "pull-host"

async def drain():
    async for value in DataPull():
        print(value)
`), []);

  // An extern class method is never captured, exactly as before the ruling.
  const externMethod = messages(`
extern module "pull-host":
    export class PrototypePull:
        async def next() -> string?

import js {PrototypePull} from "pull-host"

async def drain():
    async for value in PrototypePull():
        print(value)
`);
  assert.ok(externMethod.some((item) => /async for requires next\(\) -> Promise<T\?>/u.test(item)), externMethod.join("\n"));
});

test("[D90 R18] the pull form round-trips through the formatter", () => {
  const source = `class Pull:
    let position: number = 0

    @iterate:
        const beat = await tick(self.position)
        if self.position >= 2: return null
        self.position += 1
        return self.position
`;
  assert.equal(formatSource(source), source);
});
