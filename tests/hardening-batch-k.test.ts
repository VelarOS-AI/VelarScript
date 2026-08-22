import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleSource } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleInterfaces, standardModuleSource } from "../packages/cli/src/standard-modules.ts";

function moduleUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function execute(code: string, web = false) {
  const modules = new Map([
    ["velar/async", standardModuleSource("velar/async")!],
    ["velar/collections", standardModuleSource("velar/collections")!],
    ["velar/json", standardModuleSource("velar/json")!],
    ["velar/look", webModuleSource("velar/look", { base: "/" })!],
  ]);
  let linked = code;
  for (const [name, source] of modules) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(moduleUrl(source)));
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: web ? 10_000 : 5_000 });
}

test("[D35] permanent namespaces and range compile, execute, and share Promise's type spelling", () => {
  const result = compile(`
async def name() -> string:
    await Promise.sleep(1ms)
    return "Ada"

async def count() -> number:
    return 2

const pending: Promise<string> = name()
const values = await Promise.all({name: pending, count: count()})
const text = Json.stableStringify({name: values.name, count: values.count})
print(text)
print(range(3))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // D90 promise normalization: every value handed to `Promise.all` now passes
  // through `__velarNormalizePromiseValue` first, so the record's fields carry
  // the wrapper. The assertion is updated rather than loosened — it still pins
  // that the two fields reach the namespace call in written order, under the
  // permanent-namespace binding.
  assert.match(
    result.code ?? "",
    /__velarPromiseNamespace\.all\(\{ name: __velarNormalizePromiseValue\(pending\), count: __velarNormalizePromiseValue\(count\(\)\) \}\)/u,
  );
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, '{"count":2,"name":"Ada"}\n[ 0, 1, 2 ]\n');

  // D57 rule 135 retires this wave's shadowing clause: a local named after a
  // permanent namespace or a prelude name used to take the name over silently.
  const shadowed = compile(`
const Json = {stringify: (value: string) => value}
const Promise = {all: (value: string) => value}
const range = (value: number) => [value]
`.trimStart());
  assert.deepEqual(shadowed.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL3007 'Json' is a reserved Core binding",
    "VEL3007 'Promise' is a reserved Core binding",
    "VEL3007 'range' is a reserved Core binding",
  ]);
  assert.equal(shadowed.code, null);
});

test("[D35] Promise.all records preserve per-field types and mixed Lists teach named fields", () => {
  const typed = compile(`
async def text() -> string:
    return "ok"
async def numberValue() -> number:
    return 7
const result = await Promise.all({text: text(), number: numberValue()})
const exactText: string = result.text
const exactNumber: number = result.number
print(f"{exactText}:{exactNumber}")
`.trimStart());
  assert.deepEqual(typed.diagnostics, []);
  const execution = execute(typed.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "ok:7\n");

  const empty = compile("const value = await Promise.all({})\nprint(value)\n");
  assert.deepEqual(empty.diagnostics, []);
  assert.equal(execute(empty.code ?? "").status, 0);

  const mixed = compile(`
async def text() -> string:
    return "ok"
async def numberValue() -> number:
    return 7
const values = await Promise.all([text(), numberValue()])
`.trimStart());
  assert.ok(mixed.diagnostics.some((item) => /Mixed result types need named fields; use Promise\.all/u.test(item.message)), JSON.stringify(mixed.diagnostics));

  const rejected = compile(`
async def fail() -> string:
    throw Error("record failed")
try:
    await Promise.all({name: fail()})
catch error:
    print(error.message)
`.trimStart());
  assert.deepEqual(rejected.diagnostics, []);
  const rejectedExecution = execute(rejected.code ?? "");
  assert.equal(rejectedExecution.status, 0, rejectedExecution.stderr);
  assert.equal(rejectedExecution.stdout, "record failed\n");
});

test("[D35/D41] retired pure imports teach permanent spellings while capability imports remain", async () => {
  const entry = join(tmpdir(), "velar-batch-k-imports", "main.vel");
  const project = await compileProject(entry, new Map([[entry, `
import {parse} from "velar/json"
import {sleep} from "velar/async"
import {sqrt} from "velar/math"
import {range} from "velar/collections"
import {isFinite, isInteger} from "velar/math"
import {http} from "velar/http"
import {rgb} from "velar/look"
`.trimStart()]]), { extensions: [velarCompilerExtension] });
  const failures = project.failures.map((item) => item.message);
  const messages = project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message);
  for (const message of [
    "Use Json.parse directly; VelarScript's pure namespaces need no import",
    "Use Promise.sleep directly; VelarScript's pure namespaces need no import",
    // D52 rule 116: velar/math joined the roster.
    "Use Math.sqrt directly; VelarScript's pure namespaces need no import",
    "Use range(...) directly; the Core prelude needs no import",
  ]) assert.ok(messages.includes(message), messages.join("\n"));
  // D52 rule 114: velar/look left it, so its named import is ordinary again.
  assert.ok(!messages.some((message) => /rgb/u.test(message) && /need no import/u.test(message)), messages.join("\n"));
  assert.ok(failures.some((message) => /Use 'value\.isFinite\(\)'/u.test(message)), failures.join("\n"));
  assert.ok(failures.some((message) => /Use 'value\.isInteger\(\)'/u.test(message)), failures.join("\n"));
  assert.ok(!failures.some((message) => message.includes("velar/http")), failures.join("\n"));

  const math = standardModuleInterfaces().get("velar/math")?.exports;
  assert.equal(math?.has("isFinite"), false);
  assert.equal(math?.has("isInteger"), false);
});

test("[D35] race resolves a mixed Promise List to a usable union", () => {
  const result = compile(`
async def text() -> string:
    return "ok"
async def numberValue() -> number:
    return 7
const value = await Promise.race([text(), numberValue()])
if value is string:
    print(value.upper())
else:
    print(value + 1)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "OK\n");
});

test("[D39-52] Core Duration literals feed sleep/timeout/retry and preserve Web Look arithmetic", () => {
  const result = compile(`
const duration: Duration = 1ms + 2ms
await Promise.sleep(duration)
print(duration)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "3ms\n");

  const lookRgb = velarCompilerExtension.modules!.interfaces.get("velar/look")!.exports.get("rgb")!;
  const web = compile("import {rgb} from \"velar/look\"\nconst delay: Duration = 1s + 200ms\nconst paint: Color = rgb(1, 2, 3)\nprint(delay)\n", {
    extensions: [velarCompilerExtension],
    analysis: { imports: new Map([["rgb", lookRgb]]) },
  });
  assert.deepEqual(web.diagnostics, []);
  assert.match(web.code ?? "", /rgb\(1, 2, 3\)/u);
  assert.equal(execute(web.code ?? "", true).stdout, "1200ms\n");

  const bare = compile("await Promise.sleep(2)\n");
  assert.ok(bare.diagnostics.some((item) => /Cannot assign number to Duration/u.test(item.message)), JSON.stringify(bare.diagnostics));
});

test("[D39-52] Web timers consume Core Duration", async () => {
  const entry = join(tmpdir(), "velar-batch-k-timers", "main.vel");
  const valid = await compileProject(entry, new Map([[entry, `
import {after, every} from "velar/browser"
const stopAfter = after(1ms, () => null)
const stopEvery = every(1s, () => null)
stopAfter()
stopEvery()
`.trimStart()]]), { extensions: [velarCompilerExtension] });
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);

  const invalid = await compileProject(entry, new Map([[entry, `
import {after} from "velar/browser"
const stop = after(1, () => null)
`.trimStart()]]), { extensions: [velarCompilerExtension] });
  assert.ok(invalid.modules.flatMap((module) => module.result.diagnostics)
    .some((item) => /Cannot assign number to Duration/u.test(item.message)));
});

test("[ASY-D1] race/all losers report and map stops taking new work after its first failure", () => {
  const result = compile(`
async def failAfter(delay: Duration, message: string) -> string:
    await Promise.sleep(delay)
    throw Error(message)

async def win() -> string:
    return "winner"

print(await Promise.race([win(), failAfter(10ms, "race loser")]))
await Promise.sleep(20ms)
try:
    await Promise.all([failAfter(1ms, "all first"), failAfter(10ms, "all loser")])
catch error:
    await Promise.sleep(20ms)

try:
    await Promise.timeout(failAfter(10ms, "timeout loser"), 1ms)
catch error:
    await Promise.sleep(20ms)

let started = 0
async def work(value: number) -> number:
    started += 1
    if value == 1:
        throw Error("map first")
    await Promise.sleep(20ms)
    return value
try:
    await Promise.map([1, 2, 3, 4], work, 2)
catch error:
    await Promise.sleep(30ms)
print(started)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "winner\n2\n");
  assert.match(execution.stderr, /race loser/u);
  assert.match(execution.stderr, /all loser/u);
  assert.match(execution.stderr, /timeout loser/u);
});

test("[MIG-1(ii)] enum and record validators establish true-branch narrowing", () => {
  const result = compile(`
enum Kind:
    ready = "ready"

type User:
    name: string

def describeKind(raw: unknown) -> string:
    if Kind.is(raw):
        match raw:
            case Kind.ready:
                return "ready"
    return "future"

def describeUser(raw: unknown) -> string:
    if User.is(raw):
        return raw.name
    return "invalid"

print(describeKind("future"))
print(describeKind("ready"))
print(describeUser({name: "Ada"}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "future\nready\nAda\n");
});

// [MIG-2] The exported-contract rule (VEL4025) is gone with the construct it
// guarded: D90 R15(b) removed `cached`, so there is no annotated reader left to
// require an annotation of. The exported derived value is `export computed`,
// which infers its own type; tests/hardening-d90-r15-watch-subject.test.ts pins
// that the migrated export reports the migration and no boundary rule of its own.
