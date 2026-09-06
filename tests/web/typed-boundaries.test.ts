import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore } from "@velarscript/compiler";
import { type ValueType } from "../../packages/compiler/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("List boundaries reject accessor elements without invoking them", () => {
  // D114 S3: the aggregation used to be `velar/collections.sum`; it is the
  // compiler-owned `List.sum` member now, so the boundary is proved through
  // emitted code rather than through a module source.
  const aggregation = compile(`
export def total(values: List<number>) -> number:
    return values.sum()
`.trimStart());
  assert.deepEqual(aggregation.diagnostics, []);
  const collectionsExecution = executeModule(`${aggregation.code}
let reads = 0;
const values = [];
Object.defineProperty(values, 0, { enumerable: true, get() { reads += 1; return 1; } });
values.length = 1;
try { total(values); console.log("accepted"); } catch (error) { console.log(error.name); }
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

test("0.14 Web APIs reject invalid typed boundaries before browser execution", async () => {
  const directory = await makeTemporaryDirectory("velar-web-api-invalid-");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {formBody, http} from "velar/http"
import {storage} from "velar/storage"
import {after, blur, every, focus, showDialog, scrollTo} from "velar/browser"
import {readText} from "velar/files"
import {eventStream} from "velar/realtime"
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
        if form != null:
            const unsupported = read(form, UnsupportedForm)
    return <div ref={dialog}>Not a dialog</div>

def openWrongDialog(element: Element):
    showDialog(element)

const response = await http.get("/items").parse(42)
const saved = storage.get("item", 42)
scrollTo("left", 0)
const content = await readText({name: "missing"})
const channel = eventStream("https://example.com/events", {message: numericMessage})
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
  assert.match(messages, /Cannot assign \(value: number\) -> null to \(\(string, string\) -> unknown\)\?/u);
  assert.match(messages, /Runtime parsing requires a VelarScript runtime type/u);
  assert.match(messages, /Cannot assign.*number.*error.*Error/u);
  assert.match(messages, /Cannot assign string to Error/u);
  assert.match(messages, /Cannot assign number to string/u);
  assert.match(messages, /Form field 'nested' cannot decode NestedValue/u);
  assert.match(messages, /Cannot assign number to \(\) -> unknown/u);
});

test("typed form reads preserve record aliases and enum fields across modules", async () => {
  const directory = await makeTemporaryDirectory("velar-form-record-");
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
        if form != null:
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
  const directory = await makeTemporaryDirectory("velar-runtime-type-identity-");
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
import {ItemPayload, ItemState} from "./types.vel"

const item = Json.parse("{\\"value\\":7}", ItemPayload)
const status = Json.parse("\\"ready\\"", ItemState)
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

test("Record<T> models dynamic JSON object keys without turning Map into wire data", async () => {
  const directory = await makeTemporaryDirectory("velar-dynamic-record-");
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
type Property:
    type: string
    description: string

export type Properties = Record<Property>

export def propertyAt(properties: Properties, key: string) -> Property?:
    return properties[key]

export def putProperty(properties: Properties, key: string, value: Property):
    properties[key] = value

const properties: Properties = {
    path: {type: "string", description: "Relative path"},
    query: {type: "string", description: "Search text"},
}
print(properties["path"]?.description ?? "missing")
print(properties["missing"] == null)
properties["limit"] = {type: "integer", description: "Result limit"}
print("limit" in properties)
properties.set("mode", {type: "string", description: "Run mode"})
print(properties.size)
print(properties.get("query")?.type ?? "missing")
print(properties.keys().join(","))
let visited = ""
for key, value in properties:
    visited = visited + key + ":" + value.type + ";"
print(visited)
const copied = properties.copy()
print(copied.remove("mode"))
print(copied.has("mode"))
print(Json.stringify(properties))

const parsed = Json.parse("{\\"name\\":{\\"type\\":\\"string\\",\\"description\\":\\"Display name\\"}}", Properties)
print(parsed["name"]?.type ?? "missing")
print(Properties.is({broken: {type: "string"}}))
`.trimStart(), "utf8");

  const project = await compileProject(entry);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(build.status, 0, String(build.stderr));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "Relative path",
    "true",
    "true",
    "4",
    "string",
    "path,query,limit,mode",
    "path:string;query:string;limit:integer;mode:string;",
    "true",
    "false",
    '{"path":{"type":"string","description":"Relative path"},"query":{"type":"string","description":"Search text"},"limit":{"type":"integer","description":"Result limit"},"mode":{"type":"string","description":"Run mode"}}',
    "string",
    "false",
    "",
  ].join("\n"));

  const probe = join(output, "record-boundary.mjs");
  await writeFile(probe, `
import { Properties, propertyAt, putProperty } from "./main.js";
const accessor = {};
Object.defineProperty(accessor, "path", { enumerable: true, get() { throw new Error("getter ran"); } });
const symbol = { path: { type: "string", description: "path" } };
symbol[Symbol("hidden")] = 1;
const inherited = Object.create({ path: { type: "string", description: "path" } });
const wrong = { path: { type: "string", description: 1 } };
const frozen = Object.freeze({ path: { type: "string", description: "path" } });
const sealed = Object.seal({ path: { type: "string", description: "path" } });
const readonly = {};
Object.defineProperty(readonly, "path", { value: { type: "string", description: "path" }, enumerable: true, configurable: true, writable: false });
const failures = [accessor, symbol, frozen, sealed, readonly].map((value) => {
  try { propertyAt(value, "path"); return false; } catch { return true; }
});
let writeFailed = false;
try { putProperty(frozen, "next", { type: "string", description: "next" }); } catch { writeFailed = true; }
console.log(Properties.is(accessor), Properties.is(symbol), Properties.is(inherited), Properties.is(wrong), Properties.is(frozen), Properties.is(sealed), Properties.is(readonly));
console.log(failures.every(Boolean), writeFailed);
`, "utf8");
  const boundary = spawnSync(process.execPath, [probe], { encoding: "utf8" });
  assert.equal(boundary.status, 0, String(boundary.stderr));
  assert.ok(boundary.stdout.endsWith("false false false false false false false\ntrue true\n"));

  const invalid = await compile(`
type Property:
    type: string
    description: string

const wrongValue: Record<number> = {count: "one"}
const missingField: Record<Property> = {path: {type: "string"}}
const wrongIndex = wrongValue[1]
const wrongMember = wrongValue.count
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Cannot assign string to number/u);
  assert.match(messages, /Object is missing required field 'description'/u);
  assert.match(messages, /Cannot assign number to string/u);
  assert.match(messages, /Record fields are dynamic; use Record<number>\["count"\]/u);

  const arity = await compile("const values: Record<string, number> = {}\n");
  assert.equal(arity.diagnostics.filter((item) => /expects 1 type argument/u.test(item.message)).length, 1);
});
