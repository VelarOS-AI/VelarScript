import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleSource } from "../packages/cli/src/standard-modules.ts";

// D41 item 61 — closed-vocabulary type bounds `<T: Text>`.

function execute(code: string): ReturnType<typeof spawnSync> {
  const linked = code.replaceAll(
    JSON.stringify("velar/json"),
    JSON.stringify(`data:text/javascript;base64,${Buffer.from(standardModuleSource("velar/json")!).toString("base64")}`),
  );
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 5_000 });
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function diagnostics(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[D41 61] a Text bound unlocks interpolation and admits every text-convertible argument", () => {
  const output = run(`
enum Status:
    active
    done

def label<T: Text>(value: T) -> string:
    return f"[{value}]"

print(label(5))
print(label("x"))
print(label(Status.active))
print(label(true))
print(label(null))
`);
  assert.equal(output, "[5]\n[x]\n[active]\n[true]\n[null]\n");
});

test("[D41 61] an unbounded type parameter still cannot be interpolated", () => {
  const reported = diagnostics(`
def label<T>(value: T) -> string:
    return f"{value}"
`);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /^VEL4026 /u);
  assert.match(reported[0]!, /format T explicitly/u);
});

test("[D41 61] a rejected type argument is reported at the argument that caused the binding", () => {
  const source = `
type User:
    name: string

def label<T: Text>(value: T) -> string:
    return f"{value}"

const user: User = { name: "ada" }
print(label(user))
`.trimStart();
  const result = compile(source);
  assert.equal(result.diagnostics.length, 1);
  const [reported] = result.diagnostics;
  assert.equal(reported!.code, "VEL4031");
  assert.match(reported!.message, /Type parameter 'T' is bound by Text, so this argument cannot be User/u);
  assert.equal(source.slice(reported!.span.start, reported!.span.end), "user");
  assert.equal(result.code, null);
});

test("[D41 61] a List argument is rejected by Text just as a record is", () => {
  const reported = diagnostics(`
def label<T: Text>(value: T) -> string:
    return f"{value}"

print(label([1, 2]))
`);
  assert.deepEqual(reported.map((item) => item.split(" ")[0]), ["VEL4031"]);
  assert.match(reported[0]!, /cannot be List<number>/u);
});

test("[D41 61] the merged-parameter exception reports at the call and names the solved type", () => {
  const source = `
type User:
    name: string

def pick<T: Text>(first: T, second: T) -> T:
    return first

const user: User = { name: "ada" }
print(pick(1, user))
`.trimStart();
  const result = compile(source);
  assert.equal(result.diagnostics.length, 1);
  const [reported] = result.diagnostics;
  assert.equal(reported!.code, "VEL4031");
  assert.match(reported!.message, /the arguments solve it to number \| User/u);
  // No single argument caused the binding, so the span is the call itself.
  assert.equal(source.slice(reported!.span.start, reported!.span.end), "pick(1, user)");
});

test("[D41 61] Comparable unlocks every ordering site and keeps code-point order at runtime", () => {
  const output = run(`
def top<T: Comparable>(first: T, second: T) -> T:
    if first < second:
        return second
    return first

def ranked<T: Comparable>(values: List<T>) -> List<T>:
    return values.sorted()

def biggest<T: Comparable>(values: List<T>) -> T?:
    return values.max()

def byKey<T: Comparable>(values: List<string>, key: (string) -> T) -> List<string>:
    return values.sorted(by=key)

def smallest<T: Comparable>(values: List<T>) -> T?:
    return values.min()

print(top(2, 7))
print(top("a", "b"))
print(ranked([3, 1, 2]).map(str).join(","))
print(biggest(["a", "z", "m"]))
print(smallest([4, 2, 9]))
print(byKey(["bb", "a", "ccc"], value => value.size).join(","))
// TXT-D1: an astral character sorts after a BMP one by code point, which is
// the opposite of JavaScript's UTF-16 relational order.
print(top("\u{1F600}", "\u{FF00}"))
`);
  assert.equal(output, "7\nb\n1,2,3\nz\n2\na,bb,ccc\n\u{1F600}\n");
});

test("[D41 61] Comparable rejects a type with no runtime order, at the argument", () => {
  const reported = diagnostics(`
type User:
    name: string

def ranked<T: Comparable>(values: List<T>) -> List<T>:
    return values.sorted()

const users: List<User> = []
print(ranked(users).size)
`);
  assert.deepEqual(reported.map((item) => item.split(" ")[0]), ["VEL4031"]);
  assert.match(reported[0]!, /bound by Comparable/u);
  assert.match(reported[0]!, /numbers and strings/u);
});

test("[D41 61] the grant table gives Text no ordering and Data no text form", () => {
  assert.deepEqual(diagnostics(`
def ranked<T: Text>(values: List<T>) -> List<T>:
    return values.sorted()
`).map((item) => item.split(" ")[0]), ["VEL4001"]);
  assert.deepEqual(diagnostics(`
def label<T: Data>(value: T) -> string:
    return f"{value}"
`).map((item) => item.split(" ")[0]), ["VEL4026"]);
});

test("[D41 61] Data unlocks JSON serialization and Comparable inherits it through the chain", () => {
  const output = run(`
def encode<T: Data>(value: T) -> string:
    return Json.stringify(value)

def encodeKey<T: Comparable>(value: T) -> string:
    return Json.stringify(value)

print(encode([1, 2]))
print(encode({ name: "ada" }))
print(encodeKey("ada"))
`);
  assert.equal(output, "[1,2]\n{\"name\":\"ada\"}\n\"ada\"\n");
});

test("[D41 61] Data rejects a value JSON cannot carry", () => {
  const reported = diagnostics(`
def encode<T: Data>(value: T) -> string:
    return Json.stringify(value)

print(encode(value => value))
`);
  assert.deepEqual(reported.map((item) => item.split(" ")[0]), ["VEL4031"]);
  assert.match(reported[0]!, /bound by Data/u);
});

test("[D41 61] the bound vocabulary is closed: unknown names and user types are each refused directly", () => {
  const unknown = diagnostics(`
def label<T: Unknown>(value: T) -> string:
    return "x"
`);
  assert.deepEqual(unknown, ["VEL4021 Unknown type parameter bound 'Unknown'; the bounds are Comparable, Text, Data"]);

  const userType = diagnostics(`
type User:
    name: string

def label<T: User>(value: T) -> string:
    return "x"
`);
  assert.equal(userType.length, 1);
  assert.match(userType[0]!, /^VEL4021 'User' cannot bound a type parameter/u);
  assert.match(userType[0]!, /never an arbitrary type/u);
});

test("[D41 61 / D55 124] a bound is legal on both declaration forms that take a type parameter", () => {
  // D55 rule 124: the 4x3 grant table is a pure function of the bound, so a
  // `type` carries one with exactly the meaning a `def` gives it — and the
  // forms that take no type parameter still refuse the whole list.
  assert.deepEqual(diagnostics(`
type Box<T: Text>:
    value: T

const box: Box<number> = { value: 1 }
print(f"{box.value}")
`), []);
  assert.ok(diagnostics(`
type Box<T: Text>:
    value: T

type Bad = Box<Box<string>>
`).some((item) => item.startsWith("VEL4031")));
  assert.ok(diagnostics(`
class Box<T: Text>:
    let value: string = ""
`).some((item) => item.startsWith("VEL2023") || item.startsWith("VEL2025")));
});

test("[D41 61] a class method and an extern declaration both carry their bound", () => {
  const method = diagnostics(`
type User:
    name: string

class Printer:
    def label<T: Text>(value: T) -> string:
        return f"{value}"

const printer = Printer()
const user: User = { name: "ada" }
print(printer.label(user))
`);
  assert.deepEqual(method.map((item) => item.split(" ")[0]), ["VEL4031"]);

  assert.equal(run(`
class Printer:
    def label<T: Text>(value: T) -> string:
        return f"[{value}]"

const printer = Printer()
print(printer.label(9))
`), "[9]\n");
});

test("[D41 61] the first-class value path checks the bound the erasure would hide", () => {
  const rejected = diagnostics(`
type User:
    name: string

def label<T: Text>(value: T) -> string:
    return f"{value}"

const render: (User) -> string = label
`);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0]!, /^VEL4031 /u);
  assert.match(rejected[0]!, /this \(User\) -> string contract solves it to User/u);

  const throughMap = diagnostics(`
type User:
    name: string

def label<T: Text>(value: T) -> string:
    return f"{value}"

const users: List<User> = []
print(users.map(label).size)
`);
  assert.equal(throughMap.length, 1);
  assert.match(throughMap[0]!, /^VEL4031 /u);

  // The accepted shape still runs, which is what makes the rejection a check
  // rather than a blanket refusal of generic values.
  assert.equal(run(`
def label<T: Text>(value: T) -> string:
    return f"[{value}]"

const render: (number) -> string = label
print(render(4))
print([1, 2].map(label).join(","))
`), "[4]\n[1],[2]\n");
});

test("[D41 61] a bounded callable is not the same type as an unbounded one", () => {
  // Without the bound in the callable identity the two would share an
  // identity and the assignment would go unchecked.
  const reported = diagnostics(`
type User:
    name: string

def label<T: Text>(value: T) -> string:
    return f"{value}"

def apply(transform: (User) -> string, value: User) -> string:
    return transform(value)

const user: User = { name: "ada" }
print(apply(label, user))
`);
  assert.deepEqual(reported.map((item) => item.split(" ")[0]), ["VEL4031"]);
});

test("[D41 61] an unsolved bounded parameter is not reported as a violation", () => {
  const output = run(`
def describe<T: Text>(value: T?) -> string:
    if value == null:
        return "none"
    return f"{value}"

print(describe(null))
print(describe(3))
`);
  assert.equal(output, "none\n3\n");
});

test("[D41 61] an exported bounded def keeps its bound across a module boundary", async () => {
  const directory = join(tmpdir(), "velar-wave-m-bounds");
  const entry = join(directory, "main.vel");
  const helper = join(directory, "text.vel");
  const project = await compileProject(entry, new Map([
    [helper, `
export def label<T: Text>(value: T) -> string:
    return f"{value}"
`.trimStart()],
    [entry, `
import {label} from "./text.vel"

type User:
    name: string

const user: User = { name: "ada" }
print(label(4))
print(label(user))
`.trimStart()],
  ]), { sourceRoot: directory, projectRoot: directory });
  const reported = project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`));
  assert.deepEqual(project.failures, []);
  assert.equal(reported.length, 1);
  assert.match(reported[0]!, /^VEL4031 Type parameter 'T' is bound by Text/u);
});
