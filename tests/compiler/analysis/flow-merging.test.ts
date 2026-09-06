import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("mutually exclusive branches isolate and merge narrowing facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def guardLabel(user: User?) -> string:
    if user == null:
        return "missing"
    return user.name

def explicitElseLabel(user: User?) -> string:
    if user == null:
        return "missing"
    else:
        pass
    return user.name

def inverseElseLabel(user: User?) -> string:
    if user != null:
        pass
    else:
        return "missing"
    return user.name

def bindingLabel(initial: User?, change: bool) -> string:
    let user = initial
    assert user != null
    if change:
        user = null
    else:
        return user.name
    return "changed"

def memberLabel(box: Box, change: bool) -> string:
    assert box.user != null
    if change:
        box.user = null
    else:
        return box.user.name
    return "changed"

def returningMutation(initial: User?, change: bool) -> string:
    let user = initial
    assert user != null
    if change:
        user = null
        return "changed"
    return user.name

const ada: User = {name: "Ada"}
print(guardLabel(ada))
print(guardLabel(null))
print(explicitElseLabel(ada))
print(inverseElseLabel(ada))
print(bindingLabel(ada, false))
print(bindingLabel(ada, true))
print(memberLabel({user: ada}, false))
print(memberLabel({user: ada}, true))
print(returningMutation(ada, false))
print(returningMutation(ada, true))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nmissing\nAda\nAda\nAda\nchanged\nAda\nchanged\nAda\nchanged\n");

  const merged = compile(`
type User:
    name: string

def invalid(initial: User?, change: bool):
    let user = initial
    assert user != null
    if change:
        user = null
    const stale: User = user
`.trimStart());
  assert.equal(merged.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);

  const reassignedContinuation = compile(`
type User:
    name: string

def invalid(initial: User?) -> string:
    let user = initial
    if user == null:
        return "missing"
    else:
        user = null
    return user.name
`.trimStart());
  assert.equal(reassignedContinuation.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);
});

test("continuing branches preserve facts established on every path", () => {
  const result = compile(`
type User:
    name: string

def label(user: User?, alternate: bool) -> string:
    if alternate:
        assert user != null
    else:
        assert user != null
    return user.name

print(label({name: "Ada"}, false))
print(label({name: "Lin"}, true))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nLin\n");
});

test("try catch and finally merge only paths that can continue", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def normalOrCaught(box: Box, fail: bool) -> string:
    assert box.user != null
    try:
        if fail:
            throw Error("stop")
    catch error:
        box.user = null
        return "caught"
    return box.user.name

def assertedOnBothPaths(initial: User?, fail: bool) -> string:
    let user = initial
    try:
        if fail:
            throw Error("stop")
        assert user != null
    catch error:
        assert user != null
    return user.name

def assertedInFinally(user: User?) -> string:
    try:
        pass
    finally:
        assert user != null
    return user.name

print(normalOrCaught({user: {name: "Ada"}}, false))
print(normalOrCaught({user: {name: "Ada"}}, true))
print(assertedOnBothPaths({name: "Mira"}, false))
print(assertedOnBothPaths({name: "Mira"}, true))
print(assertedInFinally({name: "Kai"}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\ncaught\nMira\nMira\nKai\n");

  const invalidCatch = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box) -> string:
    assert box.user != null
    try:
        box.user = null
        throw Error("stop")
    catch error:
        return box.user.name
`.trimStart());
  assert.equal(invalidCatch.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);

  const invalidFinally = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box) -> string:
    assert box.user != null
    try:
        pass
    finally:
        box.user = null
    return box.user.name
`.trimStart());
  assert.equal(invalidFinally.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);
});

test("unreachable writes do not corrupt continuing flow facts", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def caught(box: Box, failure: Error) -> string:
    assert box.user != null
    try:
        throw failure
        box.user = null
    catch error:
        return box.user.name

def stoppedLoop(box: Box) -> string:
    assert box.user != null
    for value in [1]:
        break
        box.user = null
    return box.user.name

print(caught({user: {name: "Ada"}}, Error("stop")))
print(stoppedLoop({user: {name: "Lin"}}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\nLin\n");

  const reachable = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box):
    assert box.user != null
    try:
        box.user = null
        throw Error("stop")
    catch error:
        const stale: User = box.user
`.trimStart());
  assert.equal(reachable.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("terminating loop bodies preserve facts on the skipped path", () => {
  const result = compile(`
type User:
    name: string

type Box:
    user: User?

def firstOrOwner(box: Box, values: List<number>) -> string:
    assert box.user != null
    for value in values:
        box.user = null
        return str(value)
    return box.user.name

def waitOrRead(user: User?) -> string:
    while user == null:
        return "missing"
    return user.name

print(firstOrOwner({user: {name: "Ada"}}, []))
print(firstOrOwner({user: {name: "Ada"}}, [7]))
print(waitOrRead({name: "Lin"}))
print(waitOrRead(null))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n7\nLin\nmissing\n");

  const continuing = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box, values: List<number>):
    assert box.user != null
    for value in values:
        box.user = null
    const stale: User = box.user
`.trimStart());
  assert.equal(continuing.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("member receivers are analyzed once across calls and assignments", () => {
  // AS-I7: an unresolved receiver answers with the error type, so the member
  // step behind it adds nothing to the one report the name already earned.
  const call = compile("missing.run()\n");
  assert.deepEqual(
    call.diagnostics.map((item) => item.message),
    ["Unknown name 'missing'"],
  );

  const assignment = compile("missing.field = 1\n");
  assert.deepEqual(
    assignment.diagnostics.map((item) => item.message),
    ["Unknown name 'missing'"],
  );
});

test("calls preserve optimistic narrowing and guarded reads enforce it at runtime", () => {
  const readonlyParameter = compile(`
type User:
    name: string

type Box:
    user: User?

def observe(box: readonly Box) -> string:
    return box.user?.name ?? "missing"

def label(box: Box) -> string:
    assert box.user != null
    observe(box)
    return box.user.name
`.trimStart());
  assert.deepEqual(readonlyParameter.diagnostics, []);

  const receiverCapabilities = compile(`
type User:
    name: string

class Box:
    let user: User? = {name: "Ada"}

    def observe() -> string:
        return self.user?.name ?? "missing"

    def clear():
        self.user = null

def safe(box: Box) -> string:
    assert box.user != null
    box.observe()
    return box.user.name

def stale(box: Box) -> string:
    assert box.user != null
    box.clear()
    return box.user.name
`.trimStart());
  assert.deepEqual(receiverCapabilities.diagnostics, []);
  assert.match(receiverCapabilities.code ?? "", /NarrowingError/u);

  const optionalCallable = compile(`
type User:
    name: string

type Box:
    user: User?

type Mutator = (Box) -> null
type Observer = (readonly Box) -> null

def stale(callback: Mutator?, box: Box) -> string:
    assert box.user != null
    callback?.(box)
    return box.user.name

def safe(callback: Observer?, box: Box) -> string:
    assert box.user != null
    callback?.(box)
    return box.user.name
`.trimStart());
  assert.deepEqual(optionalCallable.diagnostics, []);
  assert.match(optionalCallable.code ?? "", /NarrowingError/u);

  const externalAndUnknown = compileCore(`
type User:
    name: string

type Box:
    user: User?

extern module "host-sdk":
    export def inspect(box: readonly Box) -> null

// D90 R17: calling through the boundary needs a declared signature, so the
// second boundary call is declared too.
extern module "unknown-sdk":
    export def inspectUnknown(box: readonly Box) -> null

import js {inspect} from "host-sdk"
import js {inspectUnknown} from "unknown-sdk"

def external(box: Box) -> string:
    assert box.user != null
    inspect(box)
    return box.user.name

def unknown(box: Box) -> string:
    assert box.user != null
    inspectUnknown(box)
    return box.user.name
`.trimStart());
  assert.deepEqual(externalAndUnknown.diagnostics, []);
  assert.match(externalAndUnknown.code ?? "", /NarrowingError/u);

  const unrelated = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box):
    box.user = null

def label(left: Box, right: Box) -> string:
    assert left.user != null
    assert right.user != null
    clear(left)
    return right.user.name
`.trimStart());
  assert.deepEqual(unrelated.diagnostics, []);

  const nestedReceiver = compile(`
type User:
    name: string

type Box:
    user: User?

type Holder:
    box: Box?
    values: List<string>?

def clear(box: Box):
    box.user = null

def label(holder: Holder) -> string:
    assert holder.box != null
    assert holder.box.user != null
    assert holder.values != null
    clear(holder.box)
    holder.values.clear()
    const box: Box = holder.box
    const size: number = holder.values.size
    return holder.box.user.name + str(size)
`.trimStart());
  assert.ok(!nestedReceiver.diagnostics.some((item) => /optional access/u.test(item.message)));
  assert.match(nestedReceiver.code ?? "", /NarrowingError/u);
  assert.ok(!nestedReceiver.diagnostics.some((item) => /Cannot assign Box\? to Box/u.test(item.message)));
  assert.ok(!nestedReceiver.diagnostics.some((item) => /Cannot access 'size' through/u.test(item.message)));
});

test("copied values stay stable while narrowed locations are revalidated after calls", () => {
  const safe = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box):
    box.user = null

def label(box: Box) -> string:
    assert box.user != null
    const user = box.user
    clear(box)
    return user.name

print(label({user: {name: "Ada"}}))
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);
  const execution = executeModule(safe.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");

  // Passing the narrowed owner through a mutable parameter keeps the source
  // easy to write; the later read carries a runtime narrowing guard.
  const aliasedMember = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box):
    box.user = null

def label(box: Box) -> string:
    assert box.user != null
    clear(box)
    return box.user.name
`.trimStart());
  assert.deepEqual(aliasedMember.diagnostics, []);
  assert.match(aliasedMember.code ?? "", /NarrowingError/u);

  // Captured bindings use the same guard instead of interprocedural effects.
  const capturedBinding = compile(`
type User:
    name: string

def label(initial: User?) -> string:
    let user = initial

    def clear():
        user = null

    assert user != null
    clear()
    return user.name
`.trimStart());
  assert.deepEqual(capturedBinding.diagnostics, []);
  assert.match(capturedBinding.code ?? "", /NarrowingError/u);

  // A call in the right operand executes before the body and invalidates the
  // left-side member fact.
  const shortCircuit = compile(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> bool:
    box.user = null
    return true

def label(box: Box) -> string:
    if box.user != null and clear(box):
        return box.user.name
    return "missing"
`.trimStart());
  assert.deepEqual(shortCircuit.diagnostics, []);
  assert.match(shortCircuit.code ?? "", /NarrowingError/u);

  const deferredClosure = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box) -> string:
    assert box.user != null

    def clearLater():
        print("later")
        box.user = null

    return box.user.name

print(label({user: {name: "Ada"}}))
`.trimStart());
  assert.deepEqual(deferredClosure.diagnostics, []);
  const deferredExecution = executeModule(deferredClosure.code ?? "");
  assert.equal(deferredExecution.status, 0, String(deferredExecution.stderr));
  assert.equal(deferredExecution.stdout, "Ada\n");

  const invokedClosure = compile(`
type User:
    name: string

type Box:
    user: User?

def label(box: Box) -> string:
    assert box.user != null

    def clearLater():
        box.user = null

    clearLater()
    return box.user.name
`.trimStart());
  assert.deepEqual(invokedClosure.diagnostics, []);
  assert.match(invokedClosure.code ?? "", /NarrowingError/u);
});
