import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SourceMap } from "node:module";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { type ValueType } from "../../../packages/compiler/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject, standardModuleSource } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

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

const inferred: Set<number> = Set()
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

test("async for consumes the explicit Velar pull contract without JavaScript iterator magic", async () => {
  // D90 R18: a user class declares itself an asynchronous stream through the
  // asynchronous `@iterate:` form — the block is pulled once per element, may
  // await, answers `T?`, and null is exhaustion.
  const result = compileCore(`
let sourceReads = 0

class Pull:
    const values: List<string>
    let position: number
    let reads: number

    constructor(values: List<string>):
        self.values = values
        self.position = 0
        self.reads = 0

    @iterate:
        self.reads += 1
        if self.position >= self.values.size:
            return null
        const value = self.values[self.position]
        self.position += 1
        return value

def openPull() -> Pull:
    sourceReads += 1
    return Pull(["a", "skip", "stop", "after"])

async def drain() -> string:
    const stream = openPull()
    let output = ""
    async for value, index in stream:
        if value == "skip":
            continue
        output += f"{index}:{value};"
        if value == "stop":
            break
    return f"{output}|{stream.reads}|{sourceReads}"

print(await drain())
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarAsyncForSource\d+ = stream;/u);
  assert.match(result.code ?? "", /await __velarNormalizePromiseValue\(__velarAsyncForSource\d+\["__velar:iterateAsync"\]\(\)\)/u);
  // The structural capture helpers serve the capability-handle shapes; a
  // declared contract never needs them.
  assert.doesNotMatch(result.code ?? "", /__velarAsyncPullNext/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0:a;2:stop;|3|1\n");

  const invalidContext = compileCore(`
class Pull:
    @iterate:
        const done: string? = null
        return done

def drain(source: Pull):
    async for value in source:
        print(value)
`.trimStart());
  assert.ok(invalidContext.diagnostics.some((item) => item.code === "VEL4007" && /async function/u.test(item.message)), JSON.stringify(invalidContext.diagnostics));

  // A class without the declared form is refused with the declaration to
  // write; a non-class source without the structural pull keeps the
  // capability-handle refusal.
  const invalidContracts = [
    "async for value in [1]:\n    pass\n",
    "class Missing:\n    pass\n\nasync for value in Missing():\n    pass\n",
    "class RequiredArgument:\n    async def next(value: number) -> string?:\n        return null\n\nasync for value in RequiredArgument():\n    pass\n",
    "class Synchronous:\n    def next() -> string?:\n        return null\n\nasync for value in Synchronous():\n    pass\n",
    "class NeverExhausts:\n    async def next() -> string:\n        return \"value\"\n\nasync for value in NeverExhausts():\n    pass\n",
    "class GenericPull:\n    async def next<T>() -> T?:\n        return null\n\nasync for value in GenericPull():\n    pass\n",
    "extern module \"pull-host\":\n    export class PrototypePull:\n        async def next() -> string?\n\nimport js {PrototypePull} from \"pull-host\"\n\nasync for value in PrototypePull():\n    pass\n",
  ];
  for (const source of invalidContracts) {
    const invalid = compileCore(source);
    assert.ok(invalid.diagnostics.some((item) =>
      /async for requires next\(\) -> Promise<T\?>/u.test(item.message)
      || /async for pulls a declared asynchronous '@iterate:'/u.test(item.message)), JSON.stringify(invalid.diagnostics));
  }

  const migrated = compileCore("for await value in source:\n    pass\n", {
    analysis: { imports: new Map([["source", { kind: "any" }]]) },
  });
  assert.ok(migrated.diagnostics.some((item) => /Use 'async for value in source'/u.test(item.message)));

  const formatted = formatSource("async for value,index in source:\n  print(value)\n");
  assert.equal(formatted, "async for value, index in source: print(value)\n");
  assert.equal(formatSource(formatted), formatted);

  const invalidConstructor = compileCore(`
class Pull:
    async def next() -> string?:
        return null

class Owner:
    constructor(source: Pull):
        async for value in source:
            print(value)
`.trimStart());
  assert.ok(invalidConstructor.diagnostics.some((item) => item.code === "VEL4007" && /constructor/u.test(item.message)));

  const externDataMethod = compileCore(`
extern module "pull-host":
    export class DataPull:
        const next: () -> Promise<string?>

import js {DataPull} from "pull-host"

async for value in DataPull():
    print(value)
`.trimStart());
  assert.deepEqual(externDataMethod.diagnostics, []);

  const pullContract: ValueType = {
    kind: "object",
    fields: new Map([["next", {
      kind: "function",
      parameters: [],
      requiredParameters: 0,
      result: { kind: "promise", value: { kind: "optional", inner: { kind: "string" } } },
    }]]),
  };
  const optionalPull = compileCore(`
import {source} from "pull-host"

async for value in source:
    print(value)
`.trimStart(), { analysis: { imports: new Map([["source", { ...pullContract, optionalFields: new Set(["next"]) }]]) } });
  assert.ok(optionalPull.diagnostics.some((item) => /does not expose that pull contract/u.test(item.message)));
  const hostLoop = compileCore(`
import {source} from "pull-host"

async for value in source:
    print(value)
`.trimStart(), { analysis: { imports: new Map([["source", pullContract]]) } });
  assert.deepEqual(hostLoop.diagnostics, []);

  const accessorExecution = executeModule((hostLoop.code ?? "").replace(/^import .*pull-host.*;$/mu, `
const source = {};
Object.defineProperty(source, "next", {
  get() { console.log("getter-ran"); return () => Promise.resolve(null); }
});
`));
  assert.notEqual(accessorExecution.status, 0);
  assert.equal(accessorExecution.stdout, "");
  assert.match(String(accessorExecution.stderr), /async for requires a data-valued next method/u);

  const thenableExecution = executeModule((hostLoop.code ?? "").replace(/^import .*pull-host.*;$/mu, `
const source = { next() { return { then() { return null; } }; } };
`));
  assert.notEqual(thenableExecution.status, 0);
  assert.match(String(thenableExecution.stderr), /Expected an actual Promise/u);

  const capturedAbiExecution = executeModule((hostLoop.code ?? "").replace(/^import .*pull-host.*;$/mu, `
const source = {
  reads: 0,
  next() {
    this.reads += 1;
    return Promise.resolve(this.reads === 1 ? "safe" : null);
  }
};
Object.getOwnPropertyDescriptor = () => { throw new Error("poisoned descriptor"); };
Reflect.apply = () => { throw new Error("poisoned apply"); };
WeakMap.prototype.get = () => { throw new Error("poisoned weak get"); };
WeakMap.prototype.set = () => { throw new Error("poisoned weak set"); };
Promise.prototype.then = () => { throw new Error("poisoned then"); };
`));
  assert.equal(capturedAbiExecution.status, 0, String(capturedAbiExecution.stderr));
  assert.equal(capturedAbiExecution.stdout, "safe\n");

  const projectRoot = await makeTemporaryDirectory("velar-async-pull-");
  const producerPath = join(projectRoot, "producer.vel");
  const mainPath = join(projectRoot, "main.vel");
  await writeFile(producerPath, `
export class Pull:
    let sent: bool

    constructor():
        self.sent = false

    @iterate:
        if self.sent:
            return null
        self.sent = true
        return "cross-module"
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {Pull} from "./producer.vel"

async for value in Pull():
    print(value)
`.trimStart(), "utf8");
  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  for (const module of project.modules) assert.deepEqual(module.result.diagnostics, []);
});

test("range named signatures and collection constructors keep checked Core boundaries", () => {
  const result = compileCore(`
const forward = range(end = 4)
const descending = range(start = 5, end = 0, step = -2)
const pairs = Map([["Ada", 9], ["Lin", 7]])
const record = Map({first: 1, second: 2})
print(f"{forward.size}:{forward[0]}:{forward[3]}")
print(f"{descending.size}:{descending[0]}:{descending[2]}")
print(pairs.get("Lin") ?? 0)
print(record.get("second") ?? 0)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "pairs")?.type, "Map<string, number>");
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "record")?.type, "Map<string, number>");
  // D114 S3: the prelude `range` lowers to an import of its own compiler-owned
  // runtime module. The concatenated runtime already defines `__velarRange`, so
  // the import line is dropped rather than aliased.
  const rangeRuntime = standardModuleSource("velar/compiler-runtime-range-v1") ?? "";
  const execution = executeModule(`${rangeRuntime}\n${(result.code ?? "").replace(/^import .*compiler-runtime-range-v1.*;\n/mu, "")}`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4:0:3\n3:5:1\n7\n2\n");

  const invalid = compileCore(`
const missing = range(start = 1)
const malformed = Map([["only"]])
`.trimStart());
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

  const blankLayout = formatSource('if true:\n  const text="\n      first\n      \n      second\n  "\n  print(text)\n');
  assert.equal(blankLayout, 'if true:\n    const text = "\n        first\n\n        second\n    "\n    print(text)\n');
  assert.doesNotMatch(blankLayout, /[ \t]+$/mu);
  assert.equal(formatSource(blankLayout), blankLayout);
  assert.equal(executeModule(compileCore(blankLayout).code ?? "").stdout, "first\n\nsecond\n");

  // D46: backticks are a real delimiter, not a guided-away spelling. A backtick
  // string is the same value a double-quoted literal makes; only the escaping
  // differs, which is the JSON-in-string case it exists for.
  const backtick = String.fromCharCode(96);
  const backticked = compileCore([
    `const payload = ${backtick}{"name":"Nova","role":"admin"}${backtick}`,
    'const escaped = "{\\"name\\":\\"Nova\\",\\"role\\":\\"admin\\"}"',
    "print(payload)",
    "print(payload == escaped)",
    "",
  ].join("\n"));
  assert.deepEqual(backticked.diagnostics, []);
  assert.equal(executeModule(backticked.code ?? "").stdout, '{"name":"Nova","role":"admin"}\ntrue\n');
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
const inferred: Set<number> = Set()
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

test("Map and Set expose typed ordered snapshots without exposing host iterators", () => {
  const result = compile(`
const scores: Map<string, number> = Map()
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
  assert.match(result.code ?? "", /__velarMapEntries\(scores\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada:7:Ada:9:game\n9\n");

  const invalid = compile("const bad = Map(1)\n");
  assert.ok(invalid.diagnostics.some((item) => /Map construction requires a Map, a List of \[key, value\] Lists, or a record/u.test(item.message)));
});
