import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAssignable, sameType, type ValueType } from "../../../packages/compiler/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("generic def functions infer type arguments at call sites", () => {
  const result = compile(`
def identity<T>(value: T) -> T:
    return value

def first<T>(items: List<T>) -> T?:
    return items.get(0)

def hold<T>(value: T) -> T?:
    let stored: T? = null
    stored = value
    return stored

def collect<T>(value: T) -> List<T>:
    const items: List<T> = []
    items.append(value)
    return items

const chosen: number = identity(21)
const firstName: string? = first(["Ada", "Grace"])
const held: number? = hold(chosen)
const collected: List<number> = collect(3)
print(identity("ready"))
print(firstName)
print(held)
print(collected)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\nAda\n21\n[ 3 ]\n");

  const mismatched = compile("def identity<T>(value: T) -> T:\n    return value\n\nconst wrong: string = identity(5)\n");
  assert.deepEqual(mismatched.diagnostics.map((item) => item.message), ["Cannot assign number to string"]);
});

test("generic call-site inference solves callbacks, named arguments, spreads, and async results", async () => {
  const result = compile(`
def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)

def gather<T>(...values: T) -> List<T>:
    return values

async def wrap<T>(value: T) -> T:
    return value

const doubled: List<number> = mapValues([1, 2, 3], value => value * 2)
const named: List<number> = mapValues(transform = value => value == "a" ? 1 : 2, items = ["a", "bb"])
const collected: List<number> = gather(1, 2, 3)
const source = [4, 5]
const spreadOut: List<number> = gather(...source)
const wrapped: number = await wrap(8)
print(doubled)
print(named)
print(collected)
print(spreadOut)
print(wrapped)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 2, 4, 6 ]\n[ 1, 2 ]\n[ 1, 2, 3 ]\n[ 4, 5 ]\n8\n");

  const mismatched = compile(`
def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)

const wrong: List<string> = mapValues([1], value => value * 2)
`.trimStart());
  assert.deepEqual(mismatched.diagnostics.map((item) => item.message), ["Cannot assign List<number> to List<string>"]);
});

test("generic inference merges bindings to unions and defaults unsolved parameters to unknown", () => {
  const merged = compile(`
def pair<T>(left: T, right: T) -> List<T>:
    return [left, right]

const mixed: List<number | string> = pair(1, "two")
print(mixed)
`.trimStart());
  assert.deepEqual(merged.diagnostics, []);
  const execution = executeModule(merged.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 1, 'two' ]\n");

  const narrowed = compile(`
def pair<T>(left: T, right: T) -> List<T>:
    return [left, right]

const wrong: List<number> = pair(1, "two")
`.trimStart());
  assert.deepEqual(narrowed.diagnostics.map((item) => item.message), ["Cannot assign List<number | string> to List<number>"]);

  // D114 item ①: an annotated binding is a contextual position and now solves
  // `T` from it, so the parameter stays unsolved only where no position offers
  // a type. tests/compiler/types/generic-contextual-inference.test.ts owns the seeded side.
  const unsolved = compile(`
def make<T>() -> List<T>:
    return []

const values = make()
const wrong: List<number> = values
`.trimStart());
  assert.deepEqual(unsolved.diagnostics.map((item) => item.message), ["Cannot assign List<unknown> to List<number>"]);
});

test("generic callable identities are alpha-equivalent and satisfy concrete contracts by instantiation", () => {
  const parameterT: ValueType = { kind: "parameter", name: "T", index: 0 };
  const parameterU: ValueType = { kind: "parameter", name: "U", index: 0 };
  assert.equal(sameType(parameterT, parameterU), true);
  assert.equal(sameType(parameterT, { kind: "parameter", name: "T", index: 1 }), false);
  const genericIdentity: ValueType = { kind: "function", typeParameterNames: ["T"], parameters: [parameterT], requiredParameters: 1, result: parameterT };
  const renamedIdentity: ValueType = { kind: "function", typeParameterNames: ["U"], parameters: [parameterU], requiredParameters: 1, result: parameterU };
  assert.equal(sameType(genericIdentity, renamedIdentity), true);
  const widerArity: ValueType = { kind: "function", typeParameterNames: ["T", "U"], parameters: [parameterT], requiredParameters: 1, result: parameterT };
  assert.equal(sameType(genericIdentity, widerArity), false);
  const structuralEnvironment = { fieldsOf: () => null, isSubclassOf: () => false, isPrimitiveType: () => false, isPrimitiveSubtype: () => false };
  const numberToNumber: ValueType = { kind: "function", parameters: [{ kind: "number" }], requiredParameters: 1, result: { kind: "number" } };
  const stringToNumber: ValueType = { kind: "function", parameters: [{ kind: "string" }], requiredParameters: 1, result: { kind: "number" } };
  assert.equal(isAssignable(genericIdentity, numberToNumber, structuralEnvironment), true);
  assert.equal(isAssignable(numberToNumber, genericIdentity, structuralEnvironment), false);
  assert.equal(isAssignable(genericIdentity, stringToNumber, structuralEnvironment), false);

  const contract = compile(`
def identity<T>(value: T) -> T:
    return value

const typed: (number) -> number = identity
const alias = identity
print(typed(4))
print(alias("threaded"))
const same: List<number> = [4, 5].map(identity)
print(same)
`.trimStart());
  assert.deepEqual(contract.diagnostics, []);
  const execution = executeModule(contract.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4\nthreaded\n[ 4, 5 ]\n");

  const invalid = compile(`
def identity<T>(value: T) -> T:
    return value

const wrong: (string) -> number = identity
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), ["Cannot assign <T>(value: T) -> T to (string) -> number"]);
});

test("generic methods and extern functions share the def machinery", () => {
  const result = compile(`
class Box:
    def wrap<T>(value: T) -> List<T>:
        return [value]

    static def pairOf<T>(left: T, right: T) -> List<T>:
        return [left, right]

const box = Box()
const wrapped: List<number> = box.wrap(5)
const paired: List<string> = Box.pairOf("a", "b")
print(wrapped)
print(paired)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "[ 5 ]\n[ 'a', 'b' ]\n");

  const extern = compile(`
extern module "helpers":
    export def pick<T>(items: List<T>) -> T?

import js { pick } from "helpers"

const value: number? = pick([1, 2, 3])
`.trimStart());
  assert.deepEqual(extern.diagnostics, []);

  const externMismatch = compile(`
extern module "helpers":
    export def pick<T>(items: List<T>) -> T?

import js { pick } from "helpers"

const value: string? = pick([1, 2, 3])
`.trimStart());
  assert.deepEqual(externMismatch.diagnostics.map((item) => item.message), ["Cannot assign number? to string?"]);
});

test("generic functions cross module boundaries with renamed imports", async () => {
  const directory = await makeTemporaryDirectory("velar-generic-modules-");
  const libraryPath = join(directory, "library.vel");
  const consumerPath = join(directory, "consumer.vel");
  await writeFile(libraryPath, `
export def pick<T>(items: List<T>) -> T?:
    return items.get(0)

export def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)
`.trimStart(), "utf8");
  await writeFile(consumerPath, `
import {pick, mapValues as remap} from "./library.vel"

const chosen: number? = pick([1, 2, 3])
const lengths: List<number> = remap(["a", "bb"], value => value == "a" ? 1 : 2)
print(chosen)
print(lengths)
`.trimStart(), "utf8");

  const project = await compileProject(consumerPath);
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const symbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(symbols?.find((item) => item.name === "chosen")?.type, "number?");
  assert.equal(symbols?.find((item) => item.name === "lengths")?.type, "List<number>");
});

test("runtime Type values expose is and parse through generic package contracts", async () => {
  const direct = compile(`
def decode<T>(value: unknown, target: Type<T>) -> T:
    return target.parse(value)

def accepts<T>(value: unknown, target: Type<T>) -> bool:
    return target.is(value)

type User:
    name: string

type Names = List<string>

enum Role:
    admin
    member

const user: User = decode({name: "Ada"}, User)
const names: Names = decode(["Lin"], Names)
const role: Role = decode("admin", Role)
print(f"{str(User.is(user))}:{user.name}:{names[0]}:{role == Role.admin ? "yes" : "no"}:{str(accepts(user, User))}")
`.trimStart());
  assert.deepEqual(direct.diagnostics, []);
  const execution = executeModule(direct.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true:Ada:Lin:yes:true\n");

  const mismatch = compile(`
def decode<T>(value: unknown, target: Type<T>) -> T:
    return target.parse(value)

type User:
    name: string

type Count:
    value: number

const user: User = decode({value: 1}, Count)
`.trimStart());
  assert.deepEqual(mismatch.diagnostics.map((item) => item.message), ["Cannot assign Count to User"]);

  const forged = compile(`
type User:
    name: string

class Decoder:
    def is(value: unknown) -> bool:
        return true

    def parse(value: unknown) -> User:
        return {name: "forged"}

const target: Type<User> = Decoder()
`.trimStart());
  assert.deepEqual(forged.diagnostics.map((item) => item.message), ["Cannot assign Decoder to Type<User>"]);

  const arity = compile("type User:\n    name: string\n\nconst target: Type<User, string> = User\n");
  assert.ok(arity.diagnostics.some((item) => item.code === "VEL2012" && /expects 1 type argument/u.test(item.message)));

  const libraryPath = join(tmpdir(), "velar-runtime-type-package", "library.vel");
  const consumerPath = join(tmpdir(), "velar-runtime-type-package", "consumer.vel");
  const project = await compileProject(consumerPath, new Map([
    [libraryPath, `
export def decode<T>(value: unknown, target: Type<T>) -> T:
    return target.parse(value)

export def accepts<T>(value: unknown, target: Type<T>) -> bool:
    return target.is(value)
`.trimStart()],
    [consumerPath, `
import {accepts, decode} from "./library.vel"

type User:
    name: string

type Names = List<string>

enum Role:
    admin
    member

const user: User = decode({name: "Ada"}, User)
const names: Names = decode(["Lin"], Names)
const role: Role = decode("admin", Role)
const accepted: bool = accepts(user, User)
`.trimStart()],
  ]), { extensions: [] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const symbols = project.modules.find((module) => module.inputPath === consumerPath)?.result.semanticIndex.symbols;
  assert.equal(symbols?.find((item) => item.name === "user")?.type, "User");
  assert.equal(symbols?.find((item) => item.name === "names")?.type, "List<string>");
  assert.equal(symbols?.find((item) => item.name === "role")?.type, "Role");
  assert.equal(symbols?.find((item) => item.name === "accepted")?.type, "bool");

  const renamedLibraryPath = join(tmpdir(), "velar-runtime-type-renamed-package", "library.vel");
  const renamedConsumerPath = join(tmpdir(), "velar-runtime-type-renamed-package", "consumer.vel");
  const renamedProject = await compileProject(renamedConsumerPath, new Map([
    [renamedLibraryPath, `
export type User:
    name: string

export def schema() -> Type<User>:
    return User
`.trimStart()],
    [renamedConsumerPath, `
import {User as Person, schema} from "./library.vel"

const target: Type<Person> = schema()
const user: Person = target.parse({name: "Ada"})
`.trimStart()],
  ]), { extensions: [] });
  assert.deepEqual(renamedProject.failures, []);
  assert.deepEqual(renamedProject.modules.flatMap((module) => module.result.diagnostics), []);
  const renamedSymbols = renamedProject.modules.find((module) => module.inputPath === renamedConsumerPath)?.result.semanticIndex.symbols;
  const targetSymbol = renamedSymbols?.find((item) => item.name === "target");
  assert.equal(targetSymbol?.type, "Type<Person>");
  assert.ok(targetSymbol?.members.some((member) => member.name === "is" && member.type === "(value: unknown) -> bool"));
  assert.ok(targetSymbol?.members.some((member) => member.name === "parse" && member.type === "(value: unknown) -> Person"));
  assert.equal(renamedSymbols?.find((item) => item.name === "user")?.type, "Person");

  const namespaceConsumerPath = join(tmpdir(), "velar-runtime-type-renamed-package", "namespace-consumer.vel");
  const namespaceProject = await compileProject(namespaceConsumerPath, new Map([
    [renamedLibraryPath, `
export type User:
    name: string

export def decode<T>(value: unknown, target: Type<T>) -> T:
    return target.parse(value)
`.trimStart()],
    [namespaceConsumerPath, `
import * as model from "./library.vel"

const user = model.decode({name: "Ada"}, model.User)
const name: string = user.name
`.trimStart()],
  ]), { extensions: [] });
  assert.deepEqual(namespaceProject.failures, []);
  assert.deepEqual(namespaceProject.modules.flatMap((module) => module.result.diagnostics), []);
  const namespaceSymbols = namespaceProject.modules.find((module) => module.inputPath === namespaceConsumerPath)?.result.semanticIndex.symbols;
  assert.equal(namespaceSymbols?.find((item) => item.name === "user")?.type, "User");
  assert.equal(namespaceSymbols?.find((item) => item.name === "name")?.type, "string");

  const runtimeCheck = compile(`
type User:
    name: string

def check(value: unknown) -> bool:
    return value is Type<User>
`.trimStart());
  assert.equal(runtimeCheck.code, null);
  assert.deepEqual(runtimeCheck.diagnostics.map((item) => item.code), ["VEL4022"]);
  assert.match(runtimeCheck.diagnostics[0]?.message ?? "", /cannot itself be checked at runtime/u);

  const recordCarrier = compile(`
type User:
    name: string

type Schema:
    target: Type<User>
`.trimStart());
  assert.equal(recordCarrier.code, null);
  assert.ok(recordCarrier.diagnostics.some((item) => item.code === "VEL4022" && /cannot be embedded/u.test(item.message)));

  const aliasCarrier = compile(`
type User:
    name: string

type Schemas = List<Type<User>>
`.trimStart());
  assert.equal(aliasCarrier.code, null);
  assert.ok(aliasCarrier.diagnostics.some((item) => item.code === "VEL4022" && /cannot be embedded/u.test(item.message)));
});
