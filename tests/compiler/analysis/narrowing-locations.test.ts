import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { type ValueType } from "../../../packages/compiler/src/types.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("external class checks account for JavaScript Symbol.hasInstance hooks", () => {
  // An 'is' check against an extern class may run a hasInstance hook, but the
  // check is an ordinary read: facts on unrelated locations survive it.
  const external = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user != null
    const matches = value is Client
    return user.name
`.trimStart());
  assert.equal(external.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const externalMatch = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user != null
    match value:
        case Client:
            return "client"
        case _:
            return user.name
`.trimStart());
  assert.equal(externalMatch.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const externalExhaustiveness = compile(`
extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def label(value: Client) -> string:
    match value:
        case Client:
            return "client"
`.trimStart());
  assert.ok(externalExhaustiveness.diagnostics.some((item) => item.code === "VEL4006"));

  const externalGuard = compile(`
type User:
    manager: User?

extern module "host-sdk":
    export class Client:
        constructor()

import js {Client} from "host-sdk"

def absent(value: null) -> string:
    return "none"

def invalid(client: Client, user: User) -> string:
    match client:
        case Client if user.manager != null:
            return "managed"
        case _:
            return absent(user.manager)
`.trimStart());
  assert.ok(externalGuard.diagnostics.some((item) => /Cannot assign User\? to null/u.test(item.message)));

  const local = compile(`
type User:
    name: string

class Client:
    pass

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user != null
    const matches = value is Client
    return user.name
`.trimStart());
  assert.deepEqual(local.diagnostics, []);
});

test("runtime record type checks are ordinary reads over any value source", () => {
  const sourcePrefix = `
type User:
    name: string

extern module "host-sdk":
    export def load() -> User

import js {load} from "host-sdk"
`;
  // Running a record validator on a host-returned value is an ordinary read:
  // it does not drop facts narrowed on unrelated locations.
  const checked = compile(`${sourcePrefix}
def label(initial: User?) -> string:
    const remote = load()
    let user = initial
    assert user != null
    const matches = remote is User
    return user.name
`);
  assert.equal(checked.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const matched = compile(`${sourcePrefix}
def label(initial: User?) -> string:
    const remote = load()
    let user = initial
    assert user != null
    match remote:
        case User:
            return "remote"
        case _:
            return user.name
`);
  assert.equal(matched.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // 'case User' on a User-typed value is exhaustive regardless of where the
  // value came from.
  const exhaustive = compile(`${sourcePrefix}
def label() -> string:
    const remote = load()
    match remote:
        case User:
            return remote.name
`);
  assert.deepEqual(exhaustive.diagnostics, []);

  const unknownCheck = compile(`
type User:
    name: string

def label(value: unknown, initial: User?) -> string:
    let user = initial
    assert user != null
    const matches = value is User
    return user.name
`.trimStart());
  assert.equal(unknownCheck.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("conditional expression calls preserve guarded narrowing at branch merges", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def choose(box: Box, changed: bool) -> string:
    assert box.user != null
    return changed ? clear(box) : box.user.name

print(choose({user: {name: "Ada"}}, false))
print(choose({user: {name: "Ada"}}, true))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\ncleared\n");

  // A call on one continuing branch keeps the fact optimistic; the merged read
  // revalidates it if that branch actually changed the value.
  const merged = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def label(box: Box, changed: bool) -> string:
    assert box.user != null
    const status = changed ? clear(box) : "kept"
    return box.user.name
`.trimStart());
  assert.deepEqual(merged.diagnostics, []);
  assert.match(merged.code ?? "", /NarrowingError/u);
});

test("getter results are not stable narrowing locations", () => {
  const safe = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get current() -> User?:
        const result = self.user
        self.user = null
        return result

def label(box: Box) -> string:
    const current = box.current
    if current != null:
        return current.name
    return "missing"

print(label(Box()))
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);
  const execution = executeModule(safe.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");

  // A getter may mutate its receiver, so the later narrowed read is guarded.
  const getterReadKeepsFacts = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get current() -> User?:
        const result = self.user
        self.user = null
        return result

def label(box: Box) -> string:
    assert box.user != null
    const current = box.current
    return box.user.name
`.trimStart());
  assert.deepEqual(getterReadKeepsFacts.diagnostics, []);
  assert.match(getterReadKeepsFacts.code ?? "", /NarrowingError/u);

  // A getter itself is still not a narrowable location: each read may produce
  // a different value, so checking box.current cannot guard a second read.
  // FLW-S2: both the useless check and the read now name the const binding
  // instead of teaching '?.', which would compute the getter a second time.
  const repeatedGetter = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    get current() -> User?:
        const result = self.user
        self.user = null
        return result

def invalid(box: Box) -> string:
    if box.current != null:
        return box.current.name
    return "missing"
`.trimStart());
  assert.equal(repeatedGetter.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.deepEqual(repeatedGetter.diagnostics.map((item) => item.message), [
    "'current' is a getter, so it is computed again on every read and this check narrows nothing"
    + "; bind it once with 'const current = box.current' and check that name instead",
    "'current' is a getter, so '?.' would compute it a second time"
    + "; bind it once with 'const current = box.current' and read that name instead",
  ]);

  // Extern declarations are trusted ABI contracts: a member declared as a
  // field is a stable narrowing location, exactly like a local class field.
  const externField = compile(`
extern module "host-sdk":
    export class Client:
        const label: List<string>?
        constructor()

import js {Client} from "host-sdk"

def read(client: Client) -> number:
    if client.label != null:
        return client.label.size
    return 0
`.trimStart());
  assert.equal(externField.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const stableExternalValue = compile(`
extern module "host-sdk":
    export class Client:
        const label: List<string>?
        constructor()

import js {Client} from "host-sdk"

def size(client: Client) -> number:
    const label = client.label
    if label != null:
        return label.size
    return 0
`.trimStart());
  assert.deepEqual(stableExternalValue.diagnostics, []);
});

test("host and owned values narrow alike after copies, collection reads, and runtime validation", () => {
  const hostRecordType: ValueType = {
    kind: "object",
    fields: new Map([
      ["label", { kind: "optional", inner: { kind: "string" } }],
    ]),
    readonlyFields: new Set(["label"]),
  };
  const stableRecordCopy = compileCore(`
import js {payload} from "host-sdk"

const label = payload.label
if label != null:
    const stable: string = label
`.trimStart(), { analysis: { imports: new Map([["payload", hostRecordType]]) } });
  assert.deepEqual(stableRecordCopy.diagnostics, []);

  const internalList = compile(`
const values = [1]
let current: string? = "ready"

if current != null:
    const first = values[0]
    const copied = [...values, current == "" ? 0 : 1]
    const [bound] = values
    for item in values:
        const seen = item
    match values:
        case [matched]:
            const seen = matched
    const stable: string = current
`.trimStart());
  assert.deepEqual(internalList.diagnostics, []);

  // Runtime validation narrows regardless of where the value came from:
  // host-provided unknowns validate exactly like owned values.
  const runtimeValidatedHostValues = compileCore(`
type Profile:
    label: string?

class LocalProfile:
    let label: string?

    constructor(label: string):
        self.label = label

import js {raw} from "host-sdk"

const parsed = Profile.parse(raw)
if parsed.label != null:
    const narrowed: string = parsed.label

if raw is Profile:
    if raw.label != null:
        const narrowed: string = raw.label

match raw:
    case Profile as matched:
        if matched.label != null:
            const narrowed: string = matched.label

if raw is LocalProfile:
    if raw.label != null:
        const narrowed: string = raw.label
`.trimStart(), { analysis: { imports: new Map([["raw", { kind: "unknown" }]]) } });
  assert.equal(runtimeValidatedHostValues.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 0);

  const runtimeValidatedOwnedValues = compile(`
type Profile:
    label: string?

class LocalProfile:
    let label: string?

    constructor(label: string):
        self.label = label

const parsed = Profile.parse({label: "owned"})
if parsed.label != null:
    const repeated: string = parsed.label

const local = LocalProfile("owned")
if local.label != null:
    const repeated: string = local.label
`.trimStart());
  assert.deepEqual(runtimeValidatedOwnedValues.diagnostics, []);
});
