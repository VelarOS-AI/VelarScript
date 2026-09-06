import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectCompletionsAt, projectDefinitionAt, projectSignatureAt } from "../../../packages/cli/src/project-semantic.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("Promises reject statically known callable then result shapes before JavaScript can assimilate them", () => {
  const declarationCases = [
    `type Box:\n    then: () -> number\n\nasync def load() -> Box:\n    return {then: () => 7}\n`,
    `class Box:\n    def then() -> number:\n        return 7\n\nasync def load() -> Box:\n    return Box()\n`,
    `class Box:\n    get then() -> string:\n        return "data"\n\nasync def load() -> Box:\n    return Box()\n`,
    `class Box:\n    const then: () -> number = () => 7\n\nasync def load() -> Box:\n    return Box()\n`,
    `type Box:\n    then: () -> number\n\ncomponent SaveButton:\n    action save() -> Box:\n        return {then: () => 7}\n    return <button type="button" on:click={save}>Save</button>\n`,
    `type Box:\n    then: () -> number\n\nextern module "host":\n    export async def load() -> Box\n`,
    `type Box:\n    then: () -> number\n\ndef forward(value: Promise<Box>) -> Promise<Box>:\n    return value\n`,
    `type Box:\n    then: () -> number\n\nextern module "host":\n    export def load() -> Promise<Box>\n`,
    `type Box:\n    then: () -> number\n\nclass Loader:\n    def forward(value: Promise<Box>) -> Promise<Box>:\n        return value\n`,
    `type Box:\n    then: () -> number\n\ntype LaterBox = Promise<Box>\n`,
    `type Box:\n    then: () -> number\n\ndef consume(value: Promise<Box>):\n    return null\n`,
    `async def load() -> unknown:\n    return {then: () => 7}\n`,
    `class Base:\n    def value() -> number:\n        return 1\n\nclass Hazard extends Base:\n    def then() -> number:\n        return 7\n\nasync def load() -> Base:\n    return Hazard()\n`,
    `class Loader:\n    async def load() -> unknown:\n        return {then: () => 7}\n`,
    `component SaveButton:\n    action save() -> unknown:\n        return {then: () => 7}\n    return <button type="button" on:click={save}>Save</button>\n`,
  ];
  for (const source of declarationCases) {
    const invalid = compile(source);
    assert.ok(
      invalid.diagnostics.some((item) => item.code === "VEL4024" && /magic thenable/u.test(item.message)),
      JSON.stringify(invalid.diagnostics),
    );
    assert.equal(invalid.code, null);
  }

  const arrow = compile(`
type Box:
    then: () -> number

const load: () -> Promise<Box> = async () => {then: () => 7}
`.trimStart());
  assert.ok(arrow.diagnostics.some((item) => item.code === "VEL4024"), JSON.stringify(arrow.diagnostics));

  const inferredArrow = compile("const load = async () => {then: () => 7}\n");
  assert.ok(inferredArrow.diagnostics.some((item) => item.code === "VEL4024"), JSON.stringify(inferredArrow.diagnostics));

  const generic = compile(`
type Box:
    then: () -> number

async def hold<T>(value: T) -> T:
    return value

const box: Box = {then: () => 7}
const loaded = await hold(box)
`.trimStart());
  assert.ok(generic.diagnostics.some((item) => item.code === "VEL4024"), JSON.stringify(generic.diagnostics));

  const retrying = compile(`
type Box:
    then: () -> number

const loaded = await Promise.retry(() => {then: () => 7})
`.trimStart());
  assert.ok(retrying.diagnostics.some((item) => item.code === "VEL4024"), JSON.stringify(retrying.diagnostics));

  const mapping = compile(`
type Box:
    then: () -> number

const mapped = await Promise.map([1], value => {then: () => value})
const sequenced = await Promise.series([() => {then: () => 2}])
print(mapped[0].then())
print(sequenced[0].then())
`.trimStart());
  assert.deepEqual(mapping.diagnostics, []);
  assert.equal(mapping.semanticIndex.symbols.find((item) => item.name === "mapped")?.type, "List<{ then: () -> number }>");
  assert.equal(mapping.semanticIndex.symbols.find((item) => item.name === "sequenced")?.type, "List<{ then: () -> number }>");

  const widened = compile(`
let getterReads = 0

class Base:
    def value() -> number:
        return 1

class Hidden extends Base:
    get then() -> string:
        getterReads += 1
        return "unsafe"

const hidden: Base = Hidden()

async def loadNamed() -> Base:
    return hidden

const loadArrow: () -> Promise<Base> = async () => hidden
`.trimStart());
  assert.deepEqual(widened.diagnostics, []);
  assert.match(widened.code ?? "", /return __velarAsyncResolvedValue\(hidden\);/u);
  assert.match(widened.code ?? "", /async \(\) => __velarAsyncResolvedValue\(hidden\)/u);
  const widenedExecution = executeModule(`${widened.code ?? ""}
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new Error("late host mutation"); };
Reflect.apply = poison;
Object.getOwnPropertyDescriptor = poison;
Object.getPrototypeOf = poison;
for (const load of [loadNamed, loadArrow]) {
  try { console.log((await load()).value()); }
  catch (error) { console.log(error.name); }
}
console.log(getterReads, poisonCalls);
`);
  assert.equal(widenedExecution.status, 0, String(widenedExecution.stderr));
  assert.equal(widenedExecution.stdout, "TypeError\nTypeError\n0 0\n");

  const safe = compile(`
type SafeBox:
    then: string

type InnerBox:
    then: () -> number

type OuterBox:
    inner: InnerBox

async def loadSafe() -> SafeBox:
    return {then: "data"}

async def loadOuter() -> OuterBox:
    return {inner: {then: () => 7}}

print((await loadSafe()).then)
print((await loadOuter()).inner.then())
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);
  const execution = executeModule(safe.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "data\n7\n");
});

test("async result guards survive cross-module contract widening without invoking then getters", async () => {
  const directory = await makeTemporaryDirectory("velar-async-result-widening-");
  const modelsPath = join(directory, "models.vel");
  const servicePath = join(directory, "service.vel");
  const mainPath = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(modelsPath, `
let getterReads = 0

export class Base:
    def value() -> number:
        return 1

class Hidden extends Base:
    get then() -> string:
        getterReads += 1
        return "unsafe"

export const hidden: Base = Hidden()

export def reads() -> number:
    return getterReads
`.trimStart(), "utf8");
  await writeFile(servicePath, `
import {Base, hidden} from "./models.vel"

export async def load() -> Base:
    return hidden
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {reads} from "./models.vel"
import {load} from "./service.vel"

try:
    print((await load()).value())
catch error:
    print(error.name)
print(reads())
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules.find((module) => module.inputPath === servicePath)?.result.code ?? "", /return __velarAsyncResolvedValue\(hidden\);/u);
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", mainPath, "--out-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(build.status, 0, String(build.stderr));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\n0\n");
});

test("async arrow contracts cross module and editor boundaries", async () => {
  const directory = await makeTemporaryDirectory("velar-async-arrow-editor-");
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
