import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { formatSource } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("transparent type aliases improve names without changing assignability", () => {
  const result = compile(`
type Identifier = string
type Handler = (Identifier) -> null

type User:
    name: string

type Users = List<readonly User>

const handle: Handler = value => print(value)
const parsed = Handler.parse(handle)
const users = Users.parse([{name: "Ada"}])
print("id" is Identifier)
print(users is Users)
parsed("checked")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const Handler = __velarRegisterRuntimeType\(__velarValidationFreeze/u);
  assert.match(result.code ?? "", /const Users = __velarRegisterRuntimeType\(__velarValidationFreeze/u);
  assert.match(result.code ?? "", /const User = __velarRegisterRuntimeType\(__velarValidationFreeze/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\nchecked\n");

  const erased = compile("type Label = string\nconst label: Label = \"Velar\"\n");
  assert.deepEqual(erased.diagnostics, []);
  assert.doesNotMatch(erased.code ?? "", /const Label =/u);

  const incompatible = compile("type Identifier = string\nconst id: Identifier = 42\n");
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));

  const recursive = compile("type Loop = List<Loop>\n");
  assert.ok(recursive.diagnostics.some((item) => item.code === "VEL4017" && /recursive/u.test(item.message)));

  const unknown = compile("type MissingValue = Missing\nconst value: MissingValue = null\n");
  assert.ok(unknown.diagnostics.some((item) => /Unknown type 'Missing'/u.test(item.message)));
});

test("readonly type declarations protect their own and inherited field slots", () => {
  const valid = compile(`
type Located:
    position: readonly List<number>

readonly type Snapshot extends Located:
    name: string
    metadata: Record<string>

const value: Snapshot = {position: [1, 2], name: "spawn", metadata: {kind: "safe"}}
print(value.name + ":" + str(value.position.size))
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "spawn:2\n");

  const invalid = compile(`
type Located:
    position: readonly List<number>

readonly type Snapshot extends Located:
    name: string

const value: Snapshot = {position: [1, 2], name: "spawn"}
value.name = "changed"
value.position.append(3)
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), [
    "Cannot assign to read-only field 'name'",
    "Cannot call mutating method 'append' through readonly List<number>; it is a read-only view",
  ]);

  const alias = compile("readonly type Names = List<string>\n");
  assert.deepEqual(alias.diagnostics.map((item) => item.code), ["VEL2025"]);
  assert.match(alias.diagnostics[0]?.message ?? "", /type Name = readonly Other/u);

  const formatted = "export readonly type Snapshot:\n    name: string\n";
  assert.equal(formatSource(formatted), formatted);
});

test("explicit readonly layers are compile-time contracts without runtime freezing", () => {
  const valid = compile(`
type Meta:
    label: string

type User:
    readonly id: string
    meta: readonly Meta
    tags: readonly List<readonly Meta>

type Users = List<readonly User>

def label(user: readonly User) -> string:
    return user.id + user.meta.label

def first(users: readonly Users) -> readonly User?:
    return users.get(0)

const mutable: User = {id: "u", meta: {label: "A"}, tags: []}
let current: readonly User = mutable
const reader: (User) -> string = label
print(reader(mutable))
current = {id: "v", meta: {label: "B"}, tags: []}
const users: Users = [mutable]
const viewed: readonly Users = users
const contains = users.has(current)
const membership = current in users
const selected: Set<User> = Set([mutable])
const selectedContains = selected.has(current)
const lookup: Map<User, string> = Map([[mutable, "u"]])
const lookupContains = lookup.has(current)
const copy = viewed.copy()
const item = first(viewed)
if item != null:
    copy.append(item)
print(current.id + ":" + str(copy.size))
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.doesNotMatch(valid.code ?? "", /freeze\(mutable\)|freeze\(users\)|freeze\(viewed\)/u);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "uA\nv:2\n");

  const invalid = compile(`
type Meta:
    label: string

type User:
    readonly id: string
    meta: readonly Meta
    tags: readonly List<readonly Meta>

def mutate(user: User):
    user.meta = {label: "changed"}

def reject(user: readonly User, users: readonly List<readonly User>, lookup: readonly Map<string, readonly User>, selected: readonly Set<readonly User>, records: readonly Record<readonly User>):
    user.id = "x"
    user.meta.label = "x"
    user.tags.append({label: "x"})
    users[0].tags.append({label: "x"})
    const found = lookup.get("x")
    if found != null:
        found.meta.label = "x"
    const values = selected.values()
    values[0].meta.label = "x"
    const record = records.get("x")
    if record != null:
        record.meta.label = "x"
    mutate(user)
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.code), [
    "VEL3002",
    "VEL3002",
    "VEL4001",
    "VEL4001",
    "VEL3002",
    "VEL3002",
    "VEL3002",
    "VEL4001",
  ]);
  assert.ok(invalid.diagnostics.some((item) => /through readonly User/u.test(item.message)));
  assert.equal(invalid.diagnostics.filter((item) => /through readonly Meta/u.test(item.message)).length, 4);
  assert.equal(invalid.diagnostics.filter((item) => /mutating method 'append' through readonly List<readonly Meta>/u.test(item.message)).length, 2);
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign readonly User to User/u.test(item.message)));

  const field = compile(`
type User:
    readonly id: string

const user: User = {id: "u"}
user.id = "changed"
`.trimStart());
  assert.ok(field.diagnostics.some((item) => /read-only field 'id'/u.test(item.message)));

  const callable = compile(`
type User:
    name: string

def read(user: readonly User) -> string:
    return user.name

def mutate(user: User):
    user.name = "x"

const reader: (User) -> string = read
const mutator: (readonly User) -> null = mutate
`.trimStart());
  assert.deepEqual(callable.diagnostics.map((item) => item.message), [
    "Cannot assign (user: User) -> null to (readonly User) -> null",
  ]);

  for (const [source, message] of [
    ["const value: readonly string = \"x\"\n", /string is outside that boundary/u],
    ["const value: readonly null = null\n", /null is outside that boundary/u],
  ] as const) {
    assert.ok(compile(source).diagnostics.some((item) => message.test(item.message)));
  }

  const formatted = `type User:\n    readonly id: string\n    meta: string\ndef read(user: readonly User) -> readonly User: return user\n`;
  assert.equal(formatSource(formatted), formatted);
});

test("readonly projections stop at generic and class capability boundaries", () => {
  const generic = compile(`
type User:
    name: string

def keep<T>(value: readonly T) -> readonly T:
    return value

def view<T>(value: T) -> readonly T:
    return value

def leak<T>(value: readonly T) -> T:
    return value

def first<T>(items: readonly List<T>) -> T?:
    return items.get(0)

def inspect<T>(items: readonly List<T>, visit: (T) -> null):
    items.map(item => visit(item))
`.trimStart());
  assert.equal(generic.diagnostics.filter((item) => /T is outside that boundary/u.test(item.message)).length, 4);

  // The container protects its slots; class values retain their behavior.
  const classBoundary = compile(`
class Box:
    let title: string

    constructor(title: string):
        self.title = title

    def retitle():
        self.title = "method"

type Wrapper:
    box: Box

def allowed(boxes: readonly List<Box>, wrapper: readonly Wrapper):
    boxes[0].title = "field"
    boxes[0].retitle()
    wrapper.box.title = "nested"
`.trimStart());
  assert.deepEqual(classBoundary.diagnostics, []);

  const directClass = compile("class Box:\n    pass\nconst box: readonly Box = Box()\n");
  assert.ok(directClass.diagnostics.some((item) => /Box is outside that boundary/u.test(item.message)));

  const deepField = compile(`
type Inner:
    name: string

type Holder:
    readonly inner: readonly Inner

const holder: Holder = {inner: {name: "Ada"}}
holder.inner.name = "blocked deeply"
holder.inner = {name: "blocked"}
`.trimStart());
  assert.deepEqual(deepField.diagnostics.map((item) => item.message), [
    "Cannot assign through readonly Inner; it is a read-only view",
    "Cannot assign to read-only field 'inner'",
  ]);
});

test("readonly collection views are covariant while mutable collections remain invariant", () => {
  const accepted = compile(`
const names: List<string> = ["Ada"]
const nameSet: Set<string> = Set(names)
const nameMap: Map<string, string> = Map([["Ada", "Lin"]])
const nameRecord: Record<string> = {favorite: "Ada"}
const readonlyNames: readonly List<string> = names

const widened: readonly List<string | number> = names
const readonlyWidened: readonly List<string | number> = readonlyNames
const widenedSet: readonly Set<string | number> = nameSet
const widenedMap: readonly Map<string | number, string | number> = nameMap
const widenedRecord: readonly Record<string | number> = nameRecord
`.trimStart());
  assert.deepEqual(accepted.diagnostics, []);

  const rejected = compile(`
const names: List<string> = ["Ada"]
const nameSet: Set<string> = Set(names)
const nameMap: Map<string, string> = Map([["Ada", "Lin"]])
const nameRecord: Record<string> = {favorite: "Ada"}
const widenedNames: List<string | number> = names
const widenedSet: Set<string | number> = nameSet
const widenedMap: Map<string | number, string | number> = nameMap
const widenedRecord: Record<string | number> = nameRecord

const wide: readonly List<string | number> = ["Ada", 1]
const narrowed: readonly List<string> = wide
`.trimStart());
  assert.equal(rejected.diagnostics.filter((item) => /Cannot assign/u.test(item.message)).length, 5);
});
