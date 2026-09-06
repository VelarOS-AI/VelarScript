import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_NARROWING_MODULE } from "@velarscript/compiler/extension";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("const optional 副本的存在性收窄不重复执行完整运行时校验", () => {
  const stable = compileCore(`
type State:
    label: string

def requireState(states: readonly Map<number, readonly State>, key: number) -> readonly State:
    const state = states.get(key)
    if state == null: throw Error("missing")
    return state
`.trimStart());
  assert.deepEqual(stable.diagnostics, []);
  assert.doesNotMatch(stable.code ?? "", /__velarNarrow/u);

  // 可变的是 State 里的内容，不是 const 局部绑定本身。别名可以
  // 修改 label 或 values，但不可能把这次 Map.get 得到的副本改回 null。
  const mutableValue = compileCore(`
type State:
    label: string
    values: Map<string, number>

def update(states: Map<number, State>, key: number):
    const state = states.get(key)
    if state == null: throw Error("missing")
    state.values.set("seen", 1)
    state.label = "updated"
`.trimStart());
  assert.deepEqual(mutableValue.diagnostics, []);
  assert.doesNotMatch(mutableValue.code ?? "", /__velarNarrow/u);

  // 可变绑定仍可能在闭包或后续赋值中失效，继续保留原有守卫。
  const mutable = compileCore(`
type State:
    label: string

def requireState(states: readonly Map<number, readonly State>, key: number) -> readonly State:
    let state = states.get(key)
    if state == null: throw Error("missing")
    return state
`.trimStart());
  assert.deepEqual(mutable.diagnostics, []);
  assert.match(mutable.code ?? "", /__velarNarrow/u);
});

test("aliases callbacks methods and getters use runtime narrowing guards without effect summaries", () => {
  const result = compileCore(`
type User:
    name: string

let user: User? = {name: "Ada"}
let other: User? = {name: "Lin"}

def clear():
    user = null

def forward():
    later()

def later():
    clear()

def run(callback: () -> null):
    callback()

def makeClearer() -> () -> null:
    return clear

class Worker:
    def touch():
        clear()

    get value() -> string:
        clear()
        return "done"

class Builder:
    constructor():
        clear()

class DerivedBuilder extends Builder:
    constructor():
        super()

def throughDirect() -> string:
    assert user != null
    clear()
    return user.name

def throughForwardCall() -> string:
    assert user != null
    forward()
    return user.name

def throughAlias() -> string:
    const action: () -> null = clear
    assert user != null
    action()
    return user.name

def throughReturnedCallable() -> string:
    const action = makeClearer()
    assert user != null
    action()
    return user.name

def throughArrow() -> string:
    const action: () -> null = () => clear()
    assert user != null
    action()
    return user.name

def throughCallback() -> string:
    assert user != null
    run(clear)
    return user.name

def throughReadonlyMethod(worker: Worker) -> string:
    assert user != null
    worker.touch()
    return user.name

def throughReadonlyGetter(worker: Worker) -> string:
    assert user != null
    const value = worker.value
    return user.name + value

def throughConstructor() -> string:
    assert user != null
    const builder = Builder()
    return user.name

def throughDerivedConstructor() -> string:
    assert user != null
    const builder = DerivedBuilder()
    return user.name

def unrelated() -> string:
    assert other != null
    clear()
    return other.name
`.trimStart());
  assert.equal(result.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.match(result.code ?? "", /NarrowingError/u);
  assert.ok(!result.diagnostics.some((item) => /other.*optional|optional.*other/u.test(item.message)));
});

test("runtime narrowing guards cross direct and namespace module calls", async () => {
  const directory = await makeTemporaryDirectory("velar-call-effects-");
  const storePath = join(directory, "store.vel");
  const namespaceStorePath = join(directory, "namespace-store.vel");
  const directPath = join(directory, "direct.vel");
  const namespacePath = join(directory, "namespace.vel");
  await writeFile(storePath, `
export type User:
    name: string

export type State:
    user: User?

export let user: User? = {name: "Ada"}
export const storeState: State = {user: {name: "Lin"}}

export def clear():
    user = null

export def clearState():
    storeState.user = null
`.trimStart(), "utf8");
  await writeFile(directPath, `
import {user, clear} from "./store.vel"

assert user != null
clear()
print(user.name)
`.trimStart(), "utf8");
  await writeFile(namespaceStorePath, `
export type User:
    name: string

export type State:
    user: User?

export const storeState: State = {user: {name: "Lin"}}

export def clearState():
    storeState.user = null
`.trimStart(), "utf8");
  await writeFile(namespacePath, `
import * as store from "./namespace-store.vel"

assert store.storeState.user != null
store.clearState()
print(store.storeState.user.name)
`.trimStart(), "utf8");

  const direct = await compileProject(directPath);
  assert.deepEqual(direct.failures, []);
  assert.equal(direct.modules.flatMap((module) => module.result.diagnostics)
    .filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok((direct.modules.find((module) => module.inputPath === directPath)?.result.code ?? "").includes(VELAR_NARROWING_MODULE));

  const namespace = await compileProject(namespacePath);
  assert.deepEqual(namespace.failures, []);
  const namespaceMain = namespace.modules.find((module) => module.inputPath === namespacePath);
  assert.equal(namespaceMain?.result.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.ok((namespaceMain?.result.code ?? "").includes(VELAR_NARROWING_MODULE));
});

test("narrowed reads stay guarded across calls await interpolation and getters", () => {
  const persistent = compileCore(`
type User:
    name: string

type Box:
    user: User?

class Host:
    get status() -> string:
        return "ready"

def touch(box: Box) -> string:
    return "touched"

async def label(box: Box, initial: User?, pending: Promise<null>, host: Host) -> string:
    let user = initial
    assert user != null
    assert box.user != null
    const afterCall = touch(box)
    const viaCall: string = box.user.name + user.name
    await pending
    const viaAwait: string = box.user.name + user.name
    const text = f"{touch(box)}"
    const viaInterpolation: string = box.user.name + user.name
    const status = host.status
    const viaGetter: string = box.user.name + user.name
    return viaGetter
`.trimStart());
  assert.equal(persistent.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.match(persistent.code ?? "", /NarrowingError/u);

  const assignmentStillInvalidates = compileCore(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box, initial: User?) -> string:
    let user = initial
    assert user != null
    assert box.user != null
    box.user = null
    user = null
    return box.user.name + user.name
`.trimStart());
  assert.equal(assignmentStillInvalidates.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 2);
});

test("member writes invalidate aliased facts but unrelated locations keep facts", () => {
  const aliased = compile(`
type User:
    name: string

type Box:
    user: User?

def invalid(box: Box) -> string:
    const alias = box
    assert box.user != null
    alias.user = null
    return box.user.name
`.trimStart());
  assert.equal(aliased.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 1);

  // Writing to an extern member is an assignment to THAT location: facts
  // narrowed on unrelated locations survive it.
  const externalSetter = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        let value: number
        constructor()

import js {Client} from "host-sdk"

def label(client: Client, initial: User?) -> string:
    let user = initial
    assert user != null
    client.value = 1
    return user.name
`.trimStart());
  assert.equal(externalSetter.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const setterReadsNarrowed = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        let value: number
        constructor()

import js {Client} from "host-sdk"

def label(client: Client, initial: User?) -> string:
    let user = initial
    assert user != null
    client.value = user.name.length
    return user.name
`.trimStart());
  assert.equal(setterReadsNarrowed.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  // A compound write on an unsafe host value targets client.value only; the
  // narrowed local binding keeps its fact through both read and write.
  const unsafeCompoundRead = compileCore(`
type User:
    name: string

import js unsafe {client} from "host-sdk"

def label(initial: User?) -> string:
    let user = initial
    assert user != null
    client.value += user.name.length
    return user.name
`.trimStart());
  assert.equal(unsafeCompoundRead.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const stableLocal = compile(`
type User:
    name: string

extern module "host-sdk":
    export class Client:
        let value: number
        constructor()

import js {Client} from "host-sdk"

def label(client: Client, initial: User?) -> string:
    const user = initial
    assert user != null
    client.value = 1
    return user.name
`.trimStart());
  assert.deepEqual(stableLocal.diagnostics, []);
});
