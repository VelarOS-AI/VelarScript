import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("match selects strict literal branches without fallthrough", () => {
  const result = compile(`
def describe(value: string) -> string:
    match value:
        case "ready", "done":
            const prefix = "ok"
            return prefix
        case "failed":
            const prefix = "bad"
            return prefix
        case _:
            return "unknown"

def numeric(value: number?) -> string:
    match value:
        case -1:
            return "negative"
        case null:
            return "missing"
        case _:
            return "number"

print(describe("ready"))
print(describe("failed"))
print(describe("other"))
print(numeric(-1))
print(numeric(null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarMatchValue\d+ = value;/u);
  assert.match(result.code ?? "", /__velarMatchValue\d+ === "ready" \|\| __velarMatchValue\d+ === "done"/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ok\nbad\nunknown\nnegative\nmissing\n");
});

test("match validates literals, duplicates, structure, and complete returns", () => {
  const incompatible = compile(`
match 1:
    case "1":
        print("wrong")
    case 1, 1:
        print("duplicate")
`.trimStart());
  assert.ok(incompatible.diagnostics.some((item) => /Cannot match number against string/u.test(item.message)));
  assert.ok(incompatible.diagnostics.some((item) => item.code === "VEL4013" && /more than once/u.test(item.message)));

  const incomplete = compile(`
def label(value: string) -> string:
    match value:
        case "known":
            return "known"
`.trimStart());
  assert.ok(incomplete.diagnostics.some((item) => /finish without returning/u.test(item.message)));

  for (const source of [
    "case \"orphan\":\n    pass\n",
    "match \"value\":\n    case selected:\n        pass\n",
  ]) {
    const result = compile(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2001" || item.code === "VEL2015" || item.code === "VEL4001"), source);
  }

  // D28 item 4: 'case _:' is the only fallback; 'else:' recovers as the
  // wildcard case with guidance so the rest of the match keeps analyzing.
  for (const source of [
    "match \"value\":\n    else:\n        pass\n",
    "match \"value\":\n    else:\n        pass\n    case \"late\":\n        pass\n",
  ]) {
    const result = compile(source);
    assert.equal(result.code, null, source);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL2035"
      && /Use 'case _:' for the fallback case; 'match' has no 'else' clause/u.test(item.message)), source);
  }
});

test("match supports type patterns, bindings, guards, and single evaluation", () => {
  const result = compile(`
type User:
    name: string

class Animal:
    pass

class Dog extends Animal:
    pass

let evaluations = 0

def source() -> string | number | User | null:
    evaluations += 1
    return "ready"

def describe(value: string | number | User | null) -> string:
    match value:
        case string as text if text == "ready":
            return "ready text"
        case string as text:
            return text
        case number as amount if amount > 10:
            return "large"
        case number as amount:
            return str(amount)
        case User as user:
            return user.name
        case null:
            return "missing"

def animalKind(value: Animal) -> string:
    match value:
        case Dog as dog:
            return "dog"
        case Animal:
            return "animal"

const user: User = {name: "Ada"}
print(describe(source()))
print(evaluations)
print(describe(user))
print(animalKind(Dog()))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const text = __velarMatchCase\d+\[0\];/u);
  assert.match(result.code ?? "", /typeof __velarMatchValue\d+ === "string"/u);
  assert.match(result.code ?? "", /__velarValidationIsInstance\(__velarMatchValue\d+, Dog\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready text\n1\nAda\ndog\n");

  const impossible = compile(`
def inspect(value: number):
    match value:
        case string as text:
            print(text)
    return null
`.trimStart());
  assert.ok(impossible.diagnostics.some((item) => /can never match number/u.test(item.message)));
});

test("match patterns narrow stable locations on success and fallthrough", () => {
  const result = compileCore(`
type User:
    name: string

class Animal:
    pass

class Dog extends Animal:
    def sound() -> string:
        return "woof"

def label(user: User?) -> string:
    match user:
        case User if user.name != "":
            return user.name
        case User:
            return "empty"
        case null:
            return "missing"

def fallback(user: User?) -> string:
    match user:
        case null:
            return "missing"
        case _:
            return user.name

def afterMatch(user: User?) -> string:
    match user:
        case null:
            return "missing"
        case _: pass
    return user.name

def increment(value: string | number) -> number:
    match value:
        case string:
            return 0
        case _:
            return value + 1

def first(values: List<string>?) -> string:
    match values:
        case [item, ...rest]:
            return values[0]
        case []:
            return "empty"
        case null:
            return "missing"

def sound(animal: Animal) -> string:
    match animal:
        case Dog:
            return animal.sound()
        case Animal:
            return "unknown"

print(label({name: "Ada"}))
print(label(null))
print(fallback({name: "Lin"}))
print(afterMatch({name: "Mira"}))
print(increment(4))
print(first(["Velar"]))
print(first([]))
print(sound(Dog()))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nmissing\nLin\nMira\n5\nVelar\nempty\nwoof\n");

  // Guard calls keep the source concise; narrowed reads are checked at runtime.
  const guardCallKeepsFacts = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> bool:
    box.user = null
    return true

def clearAndReject(box: Box) -> bool:
    box.user = null
    return false

def guarded(box: Box) -> string:
    match box.user:
        case User if clear(box):
            return box.user.name
        case _:
            return "missing"

def guardedElse(box: Box) -> string:
    match box.user:
        case null:
            return "missing"
        case User if clearAndReject(box):
            return "unreachable"
        case _:
            return box.user.name
`.trimStart());
  assert.deepEqual(guardCallKeepsFacts.diagnostics, []);
  assert.match(guardCallKeepsFacts.code ?? "", /NarrowingError/u);

  // Matching against an extern class may run a hasInstance hook, but the
  // check is an ordinary read: the matched member fact survives it.
  const externTypeCheckKeepsFacts = compileCore(`
extern module "sdk":
    export class Remote:
        const name: string
        constructor()

import js {Remote} from "sdk"

type Holder:
    value: Remote?

def label(holder: Holder) -> string:
    match holder.value:
        case Remote:
            return holder.value.name
        case null:
            return "missing"
`.trimStart());
  assert.equal(externTypeCheckKeepsFacts.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("match guards narrow the successful branch", () => {
  const result = compile(`
type User:
    name: string
    manager: User?

def managerName(value: User?) -> string:
    match value:
        case User as user if user.manager != null:
            return user.manager.name
        case _:
            return "missing"

const managed: User = {
    name: "Ada",
    manager: {name: "Lin", manager: null},
}
print(managerName(managed))
print(managerName(null))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Lin\nmissing\n");
});

test("match guards preserve negative facts only when their pattern always matches", () => {
  const result = compile(`
type User:
    name: string
    manager: User?

def absent(value: null) -> string:
    return "none"

def managerName(value: User) -> string:
    match value:
        case User if value.manager != null:
            return value.manager.name
        case _:
            return absent(value.manager)

const unmanaged: User = {name: "Ada", manager: null}
print(managerName(unmanaged))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "none\n");

  const partialPattern = compile(`
type User:
    manager: User?

def invalid(value: User?) -> string:
    match value:
        case User if value.manager != null:
            return value.manager.manager?.manager == null ? "managed" : "deep"
        case _:
            return value.manager == null ? "missing" : "unexpected"
`.trimStart());
  assert.ok(partialPattern.diagnostics.some((item) => /optional access/u.test(item.message)));
});

test("match cases isolate and merge outer narrowing facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box, kind: string) -> string:
    assert box.user != null
    match kind:
        case "drop":
            box.user = null
        case "keep":
            return box.user.name
        case _:
            return "other"
    return "dropped"

print(label({user: {name: "Ada"}}, "keep"))
print(label({user: {name: "Ada"}}, "drop"))
print(label({user: {name: "Ada"}}, "other"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\ndropped\nother\n");

  const merged = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box, kind: string):
    assert box.user != null
    match kind:
        case "drop":
            box.user = null
        case _:
            pass
    const stale: User = box.user
`.trimStart());
  assert.equal(merged.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("match fallthrough preserves narrowing facts across guards and pattern keys", () => {
  const common = compile(`
type User:
    name: string

def label(user: User?, kind: string) -> string:
    match kind:
        case "first":
            assert user != null
        case _:
            assert user != null
    return user.name

print(label({name: "Ada"}, "first"))
print(label({name: "Lin"}, "other"))
`.trimStart());
  assert.deepEqual(common.diagnostics, []);
  const execution = executeModule(common.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nLin\n");

  // A rejected guard may have mutated the value; the later read revalidates it.
  const guarded = compile(`
type User:
    name: string

type Box:
    user: User?

def clearAndReject(box: Box) -> bool:
    box.user = null
    return false

def label(box: Box, kind: string) -> string:
    assert box.user != null
    match kind:
        case "first" if clearAndReject(box):
            return "matched"
        case _:
            return box.user.name
`.trimStart());
  assert.deepEqual(guarded.diagnostics, []);
  assert.match(guarded.code ?? "", /NarrowingError/u);

  // Reading a static getter as a match-pattern key executes its body, so a
  // later case cannot reuse a module fact that body may have changed.
  const patternEffect = compile(`
type User:
    name: string

type Box:
    user: User?

const shared: Box = {user: {name: "Ada"}}

class Keys:
    static get first() -> string:
        shared.user = null
        return "first"

def label(kind: string) -> string:
    assert shared.user != null
    match kind:
        case Keys.first:
            return "matched"
        case _:
            return shared.user.name
`.trimStart());
  assert.deepEqual(patternEffect.diagnostics, []);
  assert.match(patternEffect.code ?? "", /NarrowingError/u);

  const unreachable = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box, kind: string) -> string:
    assert box.user != null
    match kind:
        case _:
            pass
        case "never":
            box.user = null
    return box.user.name
`.trimStart());
  assert.equal(unreachable.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok(unreachable.diagnostics.some((item) => /already covered/u.test(item.message)));
});
