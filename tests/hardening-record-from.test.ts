import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

function compiled(source: string) {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [], source);
  assert.notEqual(result.code, null, source);
  return result;
}

function diagnostics(source: string): string[] {
  return compile(source.trimStart()).diagnostics.map((item) => item.message);
}

function run(source: string): string {
  const result = compiled(source);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("a concrete record Type.from projects only target fields and applies explicit overrides", () => {
  const output = run(`
type Source:
    id: string
    name: string
    secret: string

type Response:
    id: string
    name: string
    worldId: string

const source: Source = {id: "1", name: "Ada", secret: "hidden"}
const response = Response.from(source, {worldId: "world-1"})
print(response)
`);
  assert.equal(output, "{ id: '1', name: 'Ada', worldId: 'world-1' }\n");
});

test("Type.from follows inherited and instantiated-alias field tables", () => {
  const inherited = compiled(`
type Source:
    id: string

type Base:
    id: string

type Response extends Base:
    worldId: string

const source: Source = {id: "1"}
const response: Response = Response.from(source, {worldId: "world-1"})
print(response)
`);
  assert.match(inherited.code ?? "", /\[\["id",false\],\["worldId",false\]\]/u);

  const generic = compiled(`
type Box<T>:
    value: T

type StringBox = Box<string>

const source = {value: "text", ignored: 1}
const box: StringBox = StringBox.from(source)
print(box)
`);
  assert.match(generic.code ?? "", /__velarRecordFrom\(source, null, \[\["value",false\]\], "StringBox"\)/u);
});

test("Type.from permits an absent optional target field and preserves target declaration order", () => {
  const output = run(`
type Source:
    second: number
    first: number

type Target:
    first: number
    optionalLabel: string?
    second: number

const source: Source = {second: 2, first: 1}
print(Target.from(source))
`);
  assert.equal(output, "{ first: 1, second: 2 }\n");
});

test("Type.from diagnoses missing, incompatible, unchecked, and hidden override shapes", () => {
  assert.deepEqual(diagnostics(`
type Source:
    id: string
type Target:
    id: string
    name: string
const source: Source = {id: "1"}
const target = Target.from(source)
`), ["Target.from cannot fill required field 'name' from Source; provide 'name' in the overrides literal"]);

  assert.deepEqual(diagnostics(`
type Source:
    id: number
type Target:
    id: string
const source: Source = {id: 1}
const target = Target.from(source)
`), ["Target.from cannot fill field 'id': Source provides number, but the target requires string; override 'id' explicitly"]);

  assert.deepEqual(diagnostics(`
type Target:
    id: string
def convert(raw: unknown) -> Target:
    return Target.from(raw)
`), ["Cannot build Target from unknown; validate untrusted data with 'Type.parse' before projecting a typed record"]);

  assert.deepEqual(diagnostics(`
type Source:
    id: string
type Target:
    id: string
const source: Source = {id: "1"}
const overrides = {id: "2"}
const target = Target.from(source, overrides)
`), ["Overrides for Target.from must be a record literal so every replacement field is visible"]);

  assert.deepEqual(diagnostics(`
type Source:
    id: string
type Target:
    id: string
const source: Source = {id: "1"}
const target = Target.from(source, {extra: 1})
`), ["Object has no field 'extra'"]);
});

test("Type.from overrides repair incompatible source fields and named calls keep source evaluation order", () => {
  const output = run(`
type Source:
    id: number

type Target:
    id: string
    worldId: string

const events: List<string> = []

def source() -> Source:
    events.append("source")
    return {id: 1}

def overrideId() -> string:
    events.append("id")
    return "1"

const target = Target.from(
    overrides={id: overrideId(), worldId: "world-1"},
    source=source(),
)
print(events.join(","))
print(target)
`);
  assert.equal(output, "id,source\n{ id: '1', worldId: 'world-1' }\n");
});

test("Type.from does not erase a readonly nested-data boundary", () => {
  assert.deepEqual(diagnostics(`
type Child:
    value: string
type Source:
    child: Child
type Target:
    child: Child
def convert(source: readonly Source) -> Target:
    return Target.from(source)
`), ["Target.from cannot fill field 'child': readonly Source provides readonly Child, but the target requires Child; override 'child' explicitly"]);
});

test("only concrete record type names own the compiler-only from operation", () => {
  assert.deepEqual(diagnostics(`
type UserId = string
const id = UserId.from("user-1")
`), ["Type 'UserId' is not a concrete record, so it cannot use '.from'; declare a record type whose fields define the projection"]);

  assert.deepEqual(diagnostics(`
type Box<T>:
    value: T
const box = Box.from({value: "text"})
`), ["'Box' is a generic type, not a value; name one instantiation first — type BoxOfT = Box<T> with concrete types — and read that"]);
});

test("Type.from remains ordinary call syntax for formatting and round trips", () => {
  const canonical = `
type Source:
    id: string

type Target:
    id: string
    worldId: string

const source: Source = {id: "1"}
const target = Target.from(
    source,
    {worldId: "world-1"},
)
`.trimStart();
  assert.equal(formatSource(canonical), canonical);
  assert.equal(formatSource(formatSource(canonical)), canonical);
  assert.deepEqual(compiled(canonical).diagnostics, []);
});

test("imported concrete record Types keep their exact projection field table", async () => {
  const directory = join(tmpdir(), "velar-record-from-project");
  const model = join(directory, "model.vel");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([
    [model, `
export type Source:
    id: string
    secret: string

export type Target:
    id: string
`.trimStart()],
    [entry, `
import {Source, Target} from "./model.vel"

const source: Source = {id: "1", secret: "hidden"}
print(Target.from(source))
`.trimStart()],
  ]), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const emitted = project.modules.find((module) => module.inputPath === entry)?.result.code ?? "";
  assert.match(emitted, /__velarRecordFrom\(source, null, \[\["id",false\]\], "Target"\)/u);
});

test("Type.mapFrom converts every same-name field once and preserves target declaration order", () => {
  const output = run(`
type IdentitySlots<T>:
    water: T
    air: T

type IdentityKeys = IdentitySlots<string>
type RuntimeIds = IdentitySlots<number>

const keys: IdentityKeys = {water: "water", air: "air"}
const visited: List<string> = []

def resolve(key: string) -> number:
    visited.append(key)
    return key.size

const runtimeIds: RuntimeIds = RuntimeIds.mapFrom(keys, resolve)
print(visited.join(","))
print(runtimeIds)
`);
  assert.equal(output, "water,air\n{ water: 5, air: 3 }\n");
});

test("Type.mapFrom accepts named arguments without changing authored evaluation order", () => {
  const output = run(`
type Source:
    value: string

type Target:
    value: number

const events: List<string> = []

def source() -> Source:
    events.append("source")
    return {value: "four"}

def transform() -> (value: string) -> number:
    events.append("transform")
    return value => value.size

const target = Target.mapFrom(transform=transform(), source=source())
print(events.join(","))
print(target.value)
`);
  assert.equal(output, "transform,source\n4\n");
});

test("Type.mapFrom diagnoses incomplete sources and incompatible transforms", () => {
  assert.deepEqual(diagnostics(`
type Source:
    first: string
type Target:
    first: number
    second: number
const source: Source = {first: "1"}
const target = Target.mapFrom(source, value => value.size)
`), ["Target.mapFrom cannot fill required field 'second' from Source"]);

  assert.deepEqual(diagnostics(`
type Source:
    value: string
type Target:
    value: number
const source: Source = {value: "1"}
const target = Target.mapFrom(source, value => value)
`), ["Target.mapFrom transform returns string, but target fields require number"]);

  assert.deepEqual(diagnostics(`
type Target:
    value: number
def convert(source: unknown) -> Target:
    return Target.mapFrom(source, value => 1)
`), ["Cannot build Target from unknown; validate untrusted data with 'Type.parse' before mapping a typed record"]);
});

test("Type.mapFrom remains ordinary call syntax for formatting and emits one mapped projection", () => {
  const canonical = `
type Source:
    value: string

type Target:
    value: number

const source: Source = {value: "1"}
const target = Target.mapFrom(
    source,
    value => value.size,
)
`.trimStart();
  assert.equal(formatSource(canonical), canonical);
  const result = compiled(canonical);
  assert.match(result.code ?? "", /__velarRecordMapFrom\(source, value => __velarStringSize\(value\), \[\["value",false\]\], "Target"\)/u);
});

test("an exported generic record alias keeps its field table through another module", async () => {
  const directory = join(tmpdir(), "velar-record-map-from-forwarded-alias");
  const slots = join(directory, "slots.vel");
  const palette = join(directory, "palette.vel");
  const entry = join(directory, "main.vel");
  const project = await compileProject(entry, new Map([
    [slots, `
export type Slots<T>:
    air: T
    water: T
`.trimStart()],
    [palette, `
import {Slots} from "./slots.vel"

export type RuntimeSlots = Slots<number>
`.trimStart()],
    [entry, `
import {RuntimeSlots} from "./palette.vel"

def sum(slots: readonly RuntimeSlots) -> number:
    return slots.air + slots.water

const source = {air: "1", water: "22"}
const runtime = RuntimeSlots.mapFrom(source, value => value.size)
print(sum(runtime))
`.trimStart()],
  ]), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const emitted = project.modules.find((module) => module.inputPath === entry)?.result.code ?? "";
  assert.match(emitted, /__velarRecordMapFrom/u);
});

test("a generic record alias nested in another record delegates runtime validation to its Type object", () => {
  const output = run(`
type Slots<T>:
    air: T
    water: T

type IdentitySlots = Slots<string>

type Palette:
    blocks: IdentitySlots

const palette = Palette.parse({blocks: {air: "air", water: "water"}})
print(palette.blocks.water)
`);
  assert.equal(output, "water\n");
});
