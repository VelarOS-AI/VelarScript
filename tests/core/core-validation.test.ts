import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../../packages/cli/src/project.ts";
import {
  standardModuleClosure,
  standardModuleInterface,
  standardModuleSource,
} from "../../packages/core/src/index.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(async () => {
  await removeTemporaryDirectories();
});

async function run(source: string): Promise<string> {
  const directory = await makeTemporaryDirectory("velar-core-validation-");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([[entry, source.trimStart()]]), {});
  assert.deepEqual(project.failures.map((item) => item.message), []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const compiled = project.modules[0]!.result;
  const files = new Map([...standardModuleClosure([
    ...compiled.runtimeModules,
    ...compiled.dependencies.map((dependency) => dependency.source),
  ])].map((name, index) => [name, `module-${index}.js`]));
  const link = (text: string): string => {
    let linked = text;
    for (const [name, file] of files) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(`./${file}`));
    return linked;
  };
  for (const [name, file] of files) await writeFile(join(directory, file), link(standardModuleSource(name) ?? ""), "utf8");
  await writeFile(join(directory, "main.js"), link(compiled.code ?? ""), "utf8");
  const execution = spawnSync(process.execPath, [join(directory, "main.js")], {encoding: "utf8"});
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("velar/validation is a target-neutral semantic rule surface", () => {
  const module = standardModuleInterface("velar/validation");
  assert.ok(module);
  assert.deepEqual([...module.exports.keys()], [
    "ValidationPathKind", "ValidationPath", "ValidationPathSegment", "integer", "safeInteger", "finite", "nonBlank", "refine", "field", "each", "optional", "all",
    "inspect", "validate", "parse", "safeParse", "validator",
  ]);
  const source = standardModuleSource("velar/validation");
  assert.ok(source);
  assert.doesNotMatch(source, /node:|window|document/u);
});

test("velar/validation composes structural parsing, paths, and aggregated semantic issues", async () => {
  const output = await run(`
import {all, each, field, integer, nonBlank, refine, validator} from "velar/validation"

type Limits:
    connections: number
    labels: List<string>

type Server:
    host: string
    limits: Limits

const server = validator(Server, all([
    field("host", (value: Server) => value.host, nonBlank(maximum=12)),
    field("limits", (value: Server) => value.limits, all([
        field("connections", (value: Limits) => value.connections, integer(minimum=1, maximum=4)),
        field("labels", (value: Limits) => value.labels, all([
            refine((values: List<string>) => values.size <= 2, "must contain at most 2 labels"),
            each(nonBlank(maximum=5)),
        ])),
    ])),
]))

const valid = server.safeParse({host: "local", limits: {connections: 2, labels: ["a", "b"]}})
print(str(valid.success))
print(valid.value?.host ?? "missing")

const invalidInput: Server = {host: "   ", limits: {connections: 8, labels: ["valid", ""]}}
const invalid = server.safeParse(invalidInput)
print(str(invalid.success))
for issue in invalid.issues:
    print(f"{Json.stringify(issue.path)}: {issue.message}")

try: server.validate(invalidInput)
catch error:
    if error is ValidationError: print(f"{error.name}: {error.message}")
    else: throw error

const malformed = server.safeParse({host: "local", limits: {connections: "many", labels: []}})
print(str(malformed.success))
print(str(malformed.issues.size))
`);
  assert.equal(output, [
    "true",
    "local",
    "false",
    '[{"kind":"field","name":"host"}]: must not be blank or exceed 12 code units',
    '[{"kind":"field","name":"limits"},{"kind":"field","name":"connections"}]: must be an integer from 1 through 4',
    '[{"kind":"field","name":"limits"},{"kind":"field","name":"labels"},{"kind":"listIndex","index":1}]: must not be blank or exceed 5 code units',
    "ValidationError: value.host: must not be blank or exceed 12 code units",
    "false",
    "1",
    "",
  ].join("\n"));
});

test("velar/validation rejects invalid rule construction before accepting data", async () => {
  const output = await run(`
import {integer, nonBlank} from "velar/validation"

try:
    integer(minimum=5, maximum=4)
catch error:
    print(error.message)

try:
    nonBlank(maximum=0)
catch error:
    print(error.message)
`);
  assert.equal(output, "integer minimum cannot exceed maximum\nnonBlank maximum must be a positive integer or null\n");
});

test("integer rules agree with Number members and keep explicit bounds independent", async () => {
  const output = await run(`
import {inspect, integer, safeInteger} from "velar/validation"

for value in [9007199254740991, -9007199254740991, 9007199254740992, -9007199254740992, 0, -0, 1.5, 0 / 0, 1 / 0, -1 / 0]:
    assert (inspect(value, integer()).size == 0) == value.isInteger()
    assert (inspect(value, safeInteger()).size == 0) == value.isSafeInteger()
print("predicates agree")
print(inspect(1, integer(minimum=0.1, maximum=1.9)).size)
print(inspect(1, safeInteger(minimum=0.1, maximum=1.9)).size)
print(inspect(2, integer(minimum=0.1, maximum=1.9)).size)
print(inspect(2, safeInteger(minimum=0.1, maximum=1.9)).size)
print(inspect(1, integer(minimum=0.1, maximum=0.9)).size)
print(inspect(9007199254740992, integer(minimum=9007199254740992)).size)
print(inspect(9007199254740992, safeInteger())[0].message)
print(inspect(1.5, safeInteger(message="whole safe count required"))[0].message)
for rule in [integer, safeInteger]:
    try:
        rule(minimum=2, maximum=1)
    catch error: print(error.name)
    try:
        rule(minimum=1 / 0)
    catch error: print(error.name)
`);
  assert.equal(output, [
    "predicates agree", "0", "0", "1", "1", "1", "0",
    "must be a safe integer within -9007199254740991 through 9007199254740991",
    "whole safe count required", "RangeError", "TypeError", "RangeError", "TypeError", "",
  ].join("\n"));
});

test("velar/validation retains its initialized host operations", async () => {
  const directory = await makeTemporaryDirectory("velar-core-validation-host-");
  const files = new Map([...standardModuleClosure(["velar/validation"])]
    .map((name, index) => [name, `module-${index}.js`]));
  const link = (text: string): string => {
    let linked = text;
    for (const [name, file] of files) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(`./${file}`));
    return linked;
  };
  for (const [name, file] of files) await writeFile(join(directory, file), link(standardModuleSource(name) ?? ""), "utf8");
  const validationPath = files.get("velar/validation");
  assert.ok(validationPath);
  await writeFile(join(directory, "host.mjs"), `
import {all, inspect, integer, safeInteger, nonBlank} from ${JSON.stringify(`./${validationPath}`)};
const numeric = all([integer(1, 4)]);
const safe = safeInteger();
const text = nonBlank(8);
Reflect.apply = () => { throw new Error("poisoned apply"); };
Number.isInteger = () => false;
Number.isSafeInteger = () => false;
Number.isFinite = () => false;
String.prototype.trim = () => "";
Object.freeze = () => { throw new Error("poisoned freeze"); };
Array.prototype.push = () => { throw new Error("poisoned push"); };
console.log(inspect(3, numeric).length);
console.log(inspect(8, numeric)[0].message);
console.log(inspect("ready", text).length);
console.log(inspect(9007199254740992, integer()).length, inspect(9007199254740991, safe).length, inspect(9007199254740992, safe).length);
`, "utf8");
  const execution = spawnSync(process.execPath, [join(directory, "host.mjs")], {encoding: "utf8"});
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\nmust be an integer from 1 through 4\n0\n0 0 1\n");
});

test("structural, JSON, semantic and bound validators share the published readonly path types", async () => {
  const output = await run(`
import {ValidationPathKind, ValidationPath, ValidationPathSegment, field, each, nonBlank, validator} from "velar/validation"

type Item:
    name: string

type Options:
    items: List<Item>

const checked = validator(Options, field("items", (value: Options) => value.items, each(field("name", (value: Item) => value.name, nonBlank()))))
const structural = checked.safeParse({items: [{name: 4}]})
const semantic = checked.safeParse({items: [{name: ""}]})
const path: ValidationPath = structural.issues[0].path
const segment: ValidationPathSegment = path[0]
assert segment.kind == ValidationPathKind.field
assert ValidationPathSegment.parse(segment).kind == ValidationPathKind.field
assert ValidationPath.parse(path).size == 3
assert Json.stringify(path) == Json.stringify(semantic.issues[0].path)
print(Json.stringify(path))
try:
    Json.parse(\`{"items":[{"name":4}]}\`, Options)
catch error:
    if error is ValidationError: assert Json.stringify(error.path) == Json.stringify(path)
    else: throw error
try:
    checked.parse({items: [{name: 4}]})
catch error:
    if error is ValidationError: assert Json.stringify(error.path) == Json.stringify(path)
    else: throw error
print("paths agree")
`);
  assert.equal(output, '[{"kind":"field","name":"items"},{"kind":"listIndex","index":0},{"kind":"field","name":"name"}]\npaths agree\n');
});

test("path metadata prevents mutation of the list and each discriminated segment", async () => {
  const directory = await makeTemporaryDirectory("velar-validation-readonly-");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([[entry, `
import {ValidationPath, ValidationPathKind} from "velar/validation"
def mutate(path: ValidationPath):
    path.append({kind: ValidationPathKind.field, name: "next"})
    const segment = path[0]
    if segment.kind == ValidationPathKind.field:
        segment.name = "changed"
`]]), {});
  const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(diagnostics.some((item) => /read.?only.*append|append.*read.?only/u.test(item.message)));
  assert.ok(diagnostics.some((item) => /read.?only.*name|name.*read.?only/u.test(item.message)));
});
