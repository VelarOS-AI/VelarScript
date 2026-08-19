import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile, formatSource } from "@velarscript/compiler";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function diagnostics(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

async function runProject(files: Readonly<Record<string, string>>, entry = "main.vel"): Promise<ReturnType<typeof spawnSync>> {
  const directory = await mkdtemp(join(tmpdir(), "velar-type-inheritance-"));
  try {
    for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source.trimStart(), "utf8");
    return spawnSync(process.execPath, [cliPath, "run", join(directory, entry)], {
      encoding: "utf8",
      timeout: 120_000,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("type inheritance extends the static record surface and runtime validator", () => {
  const output = run(`
type Entity:
    readonly id: string
    createdAt: number

type User extends Entity:
    name: string

const user = User.parse({ id: "u1", createdAt: 1, name: "Ada" })
const entity: Entity = user
print(entity.id + ":" + user.name)
print(f"{User.is({ id: "u2", createdAt: 2, name: "Lin" })}")
print(f"{User.is({ name: "missing base" })}")
try:
    const invalid = User.parse({ createdAt: 3, name: "missing id" })
    print(invalid.name)
catch error:
    if error is ValidationError:
        print(error.path ?? "missing path")
`);
  assert.equal(output, "u1:Ada\ntrue\nfalse\nUser.id\n");
});

test("a generic record may extend one applied generic record", () => {
  const output = run(`
type Box<T>:
    readonly value: T

type LabelledBox<T> extends Box<T>:
    label: string

type StringLabelledBox = LabelledBox<string>
const item = StringLabelledBox.parse({ value: "kept", label: "name" })
print(item.value + ":" + item.label)
print(f"{StringLabelledBox.is({ value: 1, label: "wrong" })}")
`);
  assert.equal(output, "kept:name\nfalse\n");
});

test("inherited fields cannot be redeclared", () => {
  assert.deepEqual(diagnostics(`
type Entity:
    id: string

type User extends Entity:
    id: string
`), ["VEL4004 Type 'User' cannot redeclare inherited field 'id'; inherited record fields keep their original contract"]);
});

test("a forward alias may name the base and inherited readonly fields remain readonly", () => {
  const output = run(`
type User extends EntityAlias:
    name: string

type EntityAlias = Entity

type Entity:
    readonly id: string

const user = User.parse({ id: "u1", name: "Ada" })
print(user.id + ":" + user.name)
`);
  assert.equal(output, "u1:Ada\n");

  assert.deepEqual(diagnostics(`
type Entity:
    readonly id: string

type User extends Entity:
    name: string

def mutate(user: User):
    user.id = "changed"
`), ["VEL3002 Cannot assign to read-only field 'id'"]);
});

test("a type base must be one concrete mutable record declaration", () => {
  assert.match(diagnostics(`
class Entity:
    const id: string = "entity"

type User extends Entity:
    name: string
`).join("\n"), /can only extend one concrete record type; Entity is not a record declaration/u);

  assert.match(diagnostics(`
type Entity:
    id: string

type User extends readonly Entity:
    name: string
`).join("\n"), /can only extend one concrete record type; readonly Entity is not a record declaration/u);
});

test("direct, indirect, and alias-mediated inheritance cycles are rejected", () => {
  const direct = diagnostics(`
type Node extends Node:
    value: string
`);
  assert.equal(direct.length, 1);
  assert.match(direct[0]!, /Type inheritance is cyclic: Node -> Node/u);

  const indirect = diagnostics(`
type A extends B:
    a: string

type Link = A

type B extends Link:
    b: string
`);
  assert.equal(indirect.filter((item) => item.includes("Type inheritance is cyclic")).length, 2);
});

test("the formatter preserves record inheritance and generic base applications", () => {
  assert.equal(formatSource(`type Child<T>  extends   Base<List<T>>:\n  value:T\n`), `type Child<T> extends Base<List<T>>:\n    value: T\n`);
});

test("record inheritance crosses renamed imports and validates inherited fields", async () => {
  const execution = await runProject({
    "base.vel": `
export type Entity:
    readonly id: string

export type Envelope<T>:
    data: T
`,
    "model.vel": `
import {Entity as BaseEntity, Envelope} from "./base.vel"

export type User extends BaseEntity:
    name: string

export type UserEnvelope extends Envelope<User>:
    requestedBy: string
`,
    "main.vel": `
import {User, UserEnvelope} from "./model.vel"

const user = User.parse({ id: "u1", name: "Ada" })
const envelope = UserEnvelope.parse({ data: user, requestedBy: "test" })
print(envelope.data.id + ":" + envelope.requestedBy)
print(f"{User.is({ name: "missing id" })}")
`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(String(execution.stdout), "u1:test\nfalse\n");
});

test("an inheritance cycle that crosses modules is rejected", async () => {
  const execution = await runProject({
    "a.vel": `
import {B} from "./b.vel"

export type A extends B:
    a: string
`,
    "b.vel": `
import {A} from "./a.vel"

export type B extends A:
    b: string
`,
    "main.vel": `
import {A} from "./a.vel"

const value: A = { a: "a", b: "b" }
print(value.a)
`,
  });
  assert.notEqual(execution.status, 0);
  assert.match(String(execution.stderr), /Type inheritance is cyclic/u);
});
