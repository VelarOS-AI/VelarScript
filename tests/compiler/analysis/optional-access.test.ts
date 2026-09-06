import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("nested method closures capture self without dynamic this", () => {
  const result = compile(`
class Counter:
    const value: number

    constructor(value: number):
        self.value = value

    def show():
        def nested():
            print(self.value)
        nested()

Counter(8).show()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const self = this/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "8\n");
});

test("rejects await in sync functions and loop control crossing function boundaries", () => {
  const awaitResult = compile(`
async def request() -> number:
    return 1

def load():
    const response = await request()
`.trimStart());
  assert.ok(awaitResult.diagnostics.some((item) => item.code === "VEL4007"));

  const breakResult = compile(`
while true:
    def stop():
        break
    break
`.trimStart());
  assert.ok(breakResult.diagnostics.some((item) => item.code === "VEL3005"));
});

test("supports primitive runtime checks and protects compiler-owned bindings", () => {
  const checks = compile(`
const value = "Velar"
print(value is string)
`.trimStart());
  assert.deepEqual(checks.diagnostics, []);
  assert.match(checks.code ?? "", /typeof value === "string"/);

  const reserved = compile("const print = 1\n");
  assert.ok(reserved.diagnostics.some((item) => item.code === "VEL3007"));
});

test("normalizes optional members and calls to null", () => {
  const result = compile(`
type User:
    name: string
    avatar: string?

class Box:
    const value: string

    constructor(value: string):
        self.value = value

    def label() -> string:
        return self.value

const user = User.parse({name: "Ada"})
let box: Box? = null
print(user.avatar == null)
print(box?.label() == null)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /user\.avatar \?\? null/);
  assert.match(result.code ?? "", /\(box \?\? null\)\?\.label\?\.\(\) \?\? null/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\n");
});

test("compiler temporaries cannot capture user bindings during optional lowering", () => {
  const result = compileCore(`
let __value = 1
let text: string? = "abc"
let values: List<string>? = ["zero", "one"]
print(text?.char(__value))
print(values?.get(__value))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarValue/u);
  assert.doesNotMatch(result.code ?? "", /\(__value =>/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "b\none\n");
});

test("optional access safely continues through reads, indexes, calls, and collection helpers", () => {
  const result = compile(`
type Details:
    groups: List<string?>
    format: () -> string

type Envelope:
    details: Details?

const absent: Envelope? = null
const present: Envelope = {details: {groups: [null, "42"], format: () => "ready"}}
let loads = 0
let indexes = 0

def loadAbsent() -> Envelope?:
    loads += 1
    return null

def nextIndex() -> number:
    indexes += 1
    return 0

print(absent?.details?.groups?.[0] ?? "missing")
print(present.details?.groups?.[1] ?? "missing")
print(absent?.details?.format?.() ?? "missing")
print(present.details?.format?.() ?? "missing")
print(absent?.details?.groups?.slice(1)?.size ?? -1)
print(present.details?.groups?.slice(1)?.size ?? -1)
print(loadAbsent()?.details?.groups?.[0] ?? "missing")
print(loads)
print(absent?.details?.groups?.[nextIndex()] ?? "missing")
print(indexes)
print(present.details?.groups?.[nextIndex()] ?? "missing")
print(indexes)
try:
    print(present.details?.groups?.[9] ?? "missing")
catch error:
    print(error.name)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarOptionalIndex/u);
  assert.match(result.code ?? "", /__velarOptionalCollection/u);
  assert.match(result.code ?? "", /\.format\?\.\(\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "missing\n42\nmissing\nready\n-1\n1\nmissing\n1\nmissing\n0\nmissing\n1\nIndexError\n");

  const invalid = compile(`
type Details:
    groups: List<string?>

type Envelope:
    details: Details?

type Handler = () -> string

type Hooks:
    handler: Handler?

let value: Envelope? = null
const hooks: Hooks = {handler: null}
value?.details = null
value?.details.groups[0] = "changed"
const indexed = value.details.groups[0]
const called = hooks.handler()
`.trimStart());
  assert.ok(invalid.diagnostics.filter((item) => /Optional chains cannot be assignment targets/u.test(item.message)).length >= 2);
  assert.ok(invalid.diagnostics.some((item) => /Use optional access '\?\.'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /presence check or an optional access chain/u.test(item.message)));
});

test("web extension reports optional-access diagnostics on '+' operands exactly once", () => {
  const source = `
type Person:
    name: string
    age: number

let person: Person? = null
const message = person.name + "!" + person.name
const negated = -person.age
`.trimStart();
  const core = compileCore(source);
  const web = compile(source);
  assert.ok(core.diagnostics.length > 0);
  assert.deepEqual(
    web.diagnostics.map((item) => ({ code: item.code, message: item.message, span: item.span })),
    core.diagnostics.map((item) => ({ code: item.code, message: item.message, span: item.span })),
  );
});

test("optional calls and indexes carry successful-chain facts into deferred expressions", () => {
  const result = compileCore(`
class Service:
    const name: string

    constructor(name: string):
        self.name = name

    def format(value: string) -> string:
        return f"{self.name}:{value}"

def use(service: Service?) -> string?:
    return service?.format(service.name)

def invoke(callback: ((string) -> string)?) -> string?:
    return callback?.(callback("inner"))

def last(values: List<string>?) -> string?:
    return values?.[values.size - 1]

def first(callbacks: List<() -> string>?) -> string?:
    return callbacks?.[0]()

const service: Service? = Service("Ada")
const shout: ((string) -> string)? = value => value
const callbacks: List<() -> string> = [() => "ready"]
const noCallbacks: List<() -> string>? = null
print(use(null) == null)
print(use(service))
print(invoke(null) == null)
print(invoke(shout))
print(last(null) == null)
print(last(["a", "b"]))
print(first(noCallbacks) == null)
print(first(callbacks))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nAda:Ada\ntrue\ninner\ntrue\nb\ntrue\nready\n");

  const skippedIndex = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> number:
    box.user = null
    return 0

def keep(box: Box) -> string:
    assert box.user != null
    const skipped = null?.[clear(box)]
    return box.user.name

print(keep({user: {name: "Ada"}}))
`.trimStart());
  assert.deepEqual(skippedIndex.diagnostics, []);
  const skippedExecution = executeModule(skippedIndex.code ?? "");
  assert.equal(skippedExecution.status, 0, String(skippedExecution.stderr));
  assert.equal(skippedExecution.stdout, "Ada\n");
});

test("conditional expressions narrow optional values in their owned branch", () => {
  const result = compile(`
type User:
    name: string

def label(user: User?) -> string:
    return user != null ? user.name : "Guest"

def inverse(user: User?) -> string:
    return user == null ? "Guest" : user.name

def numberLabel(value: number?) -> string:
    return value != null ? "present" : "null"

def inverseNumberLabel(value: number?) -> string:
    return value == null ? "null" : "present"

print(numberLabel(0))
print(inverseNumberLabel(0))
`);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "present\npresent\n");
});

test("short-circuit conditions and while bodies preserve optional narrowing", () => {
  const result = compile(`
type User:
    name: string
    active: bool
    manager: User?

let probes = 0

def probe() -> bool:
    probes += 1
    return true

def managerName(user: User?) -> string:
    if user != null and user.manager != null and user.manager.active:
        return user.manager.name
    return "missing"

def status(user: User?) -> string:
    if user == null or not user.active:
        return "inactive"
    else:
        return user.name

const absent: User? = null
const present: User? = {
    name: "Ada",
    active: true,
    manager: {name: "Lin", active: true, manager: null},
}

print(absent != null and probe())
print(probes)
print(present != null and probe())
print(probes)
print(present != null or probe())
print(probes)
print(absent != null or probe())
print(probes)
print(managerName(present))
print(managerName(absent))
print(status(present))

let current: User? = present
while current != null:
    print(current.name)
    current = null
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\(\(absent \?\? null\) !== null\) && probe/u);
  assert.match(result.code ?? "", /\(\(present \?\? null\) !== null\) \|\| probe/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "false\n0\ntrue\n1\ntrue\n1\ntrue\n2\nLin\nmissing\nAda\nAda\n");

  const stale = compile(`
type User:
    active: bool

let current: User? = {active: true}
if current != null and current.active:
    current = null
    const invalid: User = current
`.trimStart());
  assert.equal(stale.diagnostics.filter((item) => /Cannot assign User\? to User/u.test(item.message)).length, 1);
});

test("condition narrowing reuses analyzed types without inventing bindings", () => {
  const missingEquality = compile(`
if missing() == null:
    pass
else:
    pass
`.trimStart());
  assert.deepEqual(
    missingEquality.diagnostics.map((item) => item.message),
    ["Unknown name 'missing'"],
  );

  const missingMember = compile(`
if unknown.field == null:
    pass
else:
    pass
`.trimStart());
  // AS-I7: the name was refused, so the member read on it says nothing —
  // one mistake, one report.
  assert.deepEqual(
    missingMember.diagnostics.map((item) => item.message),
    ["Unknown name 'unknown'"],
  );

  const missingTypeCheck = compile(`
if missing is string:
    print(missing)
`.trimStart());
  assert.equal(
    missingTypeCheck.diagnostics.filter((item) => item.message === "Unknown name 'missing'").length,
    2,
  );

  const missingMemberTypeCheck = compile(`
if unknown.field is string:
    pass
else:
    pass
`.trimStart());
  assert.deepEqual(
    missingMemberTypeCheck.diagnostics.map((item) => item.message),
    ["Unknown name 'unknown'"],
  );
});
