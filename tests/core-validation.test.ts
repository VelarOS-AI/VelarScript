import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import {
  standardModuleClosure,
  standardModuleInterface,
  standardModuleSource,
} from "../packages/core/src/index.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

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
    "integer", "finite", "nonBlank", "refine", "field", "each", "optional", "all",
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
    print(f"{issue.path.map((segment) => str(segment)).join("/")}: {issue.message}")

try: server.validate(invalidInput)
catch error:
    if error is ValidationError: print(f"{error.name}: {error.path}: {error.reason}")
    else: throw error

const malformed = server.safeParse({host: "local", limits: {connections: "many", labels: []}})
print(str(malformed.success))
print(str(malformed.issues.size))
`);
  assert.equal(output, [
    "true",
    "local",
    "false",
    "host: must not be blank or exceed 12 code units",
    "limits/connections: must be an integer from 1 through 4",
    "limits/labels/1: must not be blank or exceed 5 code units",
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
import {all, inspect, integer, nonBlank} from ${JSON.stringify(`./${validationPath}`)};
const numeric = all([integer(1, 4)]);
const text = nonBlank(8);
Reflect.apply = () => { throw new Error("poisoned apply"); };
Number.isSafeInteger = () => false;
Number.isFinite = () => false;
String.prototype.trim = () => "";
Object.freeze = () => { throw new Error("poisoned freeze"); };
Array.prototype.push = () => { throw new Error("poisoned push"); };
console.log(inspect(3, numeric).length);
console.log(inspect(8, numeric)[0].message);
console.log(inspect("ready", text).length);
`, "utf8");
  const execution = spawnSync(process.execPath, [join(directory, "host.mjs")], {encoding: "utf8"});
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\nmust be an integer from 1 through 4\n0\n");
});
