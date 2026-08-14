import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { compile } from "@velarscript/compiler";

test("readonly is limited to deep data views", () => {
  const invalidMember = compile(`
class Box:
    const value: number = 1

    readonly def read() -> number:
        return self.value
`.trimStart());

  const invalidGeneric = compile(`
def generic<T>(value: readonly T) -> null:
    return null
`.trimStart());

  const invalidClass = compile(`
class Box:
    pass

def inspect(box: readonly Box) -> null:
    return null
`.trimStart());

  const invalidPromise = compile(`
def inspect(pending: readonly Promise<List<number>>) -> null:
    return null
`.trimStart());

  assert.deepEqual([
    ...invalidMember.diagnostics,
    ...invalidGeneric.diagnostics,
    ...invalidClass.diagnostics,
    ...invalidPromise.diagnostics,
  ].map((item) => item.message), [
    // CLS-I5: the advice differs by member kind — `const` is a field's
    // read-only spelling and means nothing on a method.
    "'readonly' is a data-type modifier, not a class member modifier; a method, getter, or constructor is executable and has no readonly contract — mark the data it works with, as in 'readonly List<number>'",
    "'readonly' applies only to data records, structural objects, List, Set, Map, and Record values; T is outside that boundary",
    "'readonly' applies only to data records, structural objects, List, Set, Map, and Record values; Box is outside that boundary",
    "'readonly' applies only to data records, structural objects, List, Set, Map, and Record values; Promise<List<number>> is outside that boundary",
  ]);
});

test("readonly data fields and views propagate deeply without changing runtime identity", () => {
  const result = compile(`
type Profile:
    readonly tags: List<string>

type User:
    profile: Profile

def expose(user: User) -> readonly User:
    return user

def mutateField(user: User) -> null:
    user.profile.tags.append("blocked")

def mutateView(user: readonly User) -> null:
    user.profile.tags.append("blocked")
`.trimStart());

  assert.deepEqual(result.diagnostics.map((item) => item.message), [
    "Cannot call mutating method 'append' through readonly List<string>; it is a read-only view",
    "Cannot call mutating method 'append' through readonly List<string>; it is a read-only view",
  ]);
  assert.equal(result.code, null);

  const valid = compile(`
type User:
    tags: List<string>

def expose(user: User) -> readonly User:
    return user
`.trimStart());
  assert.equal(valid.diagnostics.length, 0);
  assert.doesNotMatch(valid.code!, /Object\.freeze|Proxy/u);
});

test("stale optimistic narrowing fails with NarrowingError at the narrowed read", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> null:
    box.user = null

def read(box: Box) -> string:
    if box.user != null:
        clear(box)
        return box.user.name
    return "missing"

print(read({user: {name: "Ada"}}))
`.trimStart());

  assert.equal(result.diagnostics.length, 0);
  assert.match(result.code!, /NarrowingError/u);
  assert.throws(
    () => runInNewContext(result.code!, { console }),
    (error: unknown) => typeof error === "object"
      && error !== null
      && "name" in error
      && error.name === "NarrowingError"
      && "message" in error
      && typeof error.message === "string"
      && /Flow narrowing for '\.user' no longer holds/u.test(error.message),
  );
});

test("erased generic narrowings recheck presence without inventing a runtime type", () => {
  const result = compile(`
def present<T>(value: T?, callback: () -> null) -> T:
    assert value != null
    callback()
    return value

print(present("ready", () => null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code!, /T\.is/u);
  assert.match(result.code!, /__velarValue != null/u);
  assert.doesNotThrow(() => runInNewContext(result.code!, { console }));
});
