import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { asHostError, hostErrorCode, hostErrorMessage, hostErrorStack } from "../../../packages/cli/src/host-error.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("throws only Error values, normalizes JavaScript failures, and preserves remainder semantics", () => {
  const explodeSource = Buffer.from("export function explode(){throw 'raw failure'}", "utf8").toString("base64");
  // D90 R17: an undeclared import is unknown and cannot be called, so the
  // failing function is declared through an extern contract.
  const result = compile(`
extern module "data:text/javascript;base64,${explodeSource}":
    export def explode() -> null

import js {explode} from "data:text/javascript;base64,${explodeSource}"

class BucketError extends Error:
    const bucket: string

    constructor(bucket: string, message: string):
        super(message)
        self.bucket = bucket

def bucket(value: number) -> number:
    if value < 0:
        throw BucketError("negative", "Value must be positive")
    else:
        return value % 4

async def failLater() -> number:
    throw BucketError("async", "Async failure")

let remainder = 11
remainder %= 4
print(remainder)

try:
    print(bucket(-1))
catch error:
    print(error is BucketError)
    print(error.message)
finally:
    print("finalized")

try:
    await failLater()
catch error:
    print(error.message)

try:
    explode()
catch:
    print(error.name)
    print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /throw new BucketError/);
  assert.match(result.code ?? "", /remainder %= 4/);
  assert.match(result.code ?? "", /error = __velarNormalizeError\(error\)/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "3\ntrue\nValue must be positive\nfinalized\nAsync failure\nError\nraw failure\n");
});

test("catch normalization cannot execute a hostile thrown object's conversion hooks", () => {
  const source = Buffer.from([
    "export function explode(){throw {marker:'original',toString(){console.log('conversion hook ran');throw new Error('conversion failure')}}}",
    "export function explodeProxy(){throw new Proxy({marker:'proxy'},{getPrototypeOf(){console.log('prototype trap ran');throw new Error('prototype failure')}})}",
  ].join(";"), "utf8").toString("base64");
  // D90 R17: an undeclared import is unknown and cannot be called, so the
  // failing functions are declared through an extern contract.
  const result = compile(`
extern module "data:text/javascript;base64,${source}":
    export def explode() -> null
    export def explodeProxy() -> null

import js {explode, explodeProxy} from "data:text/javascript;base64,${source}"

try:
    explode()
catch error:
    print(error.name)
    print(error.message)

try:
    explodeProxy()
catch error:
    print(error.name)
    print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /if \(__velarIsError\(value\)\) return value/u);
  assert.match(result.code ?? "", /new __velarErrorNativeError\(message, \{ cause: value \}\)/u);
  assert.doesNotMatch(result.code ?? "", /Error\.isError\(value\)/u);
  assert.doesNotMatch(result.code ?? "", /String\(error\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Error\nA non-Error value was thrown by JavaScript\nError\nA non-Error value was thrown by JavaScript\n");
});

test("caught JavaScript failures retain initialization-time Error and String operations", () => {
  const explodeSource = Buffer.from("export function explode(){throw 42}", "utf8").toString("base64");
  // D90 R17: an undeclared import is unknown and cannot be called, so the
  // failing function is declared through an extern contract.
  const result = compile(`
extern module "data:text/javascript;base64,${explodeSource}":
    export def explode() -> null

import js {explode} from "data:text/javascript;base64,${explodeSource}"

export def exercise() -> string:
    try:
        explode()
    catch error:
        return error.name + ":" + error.message
    return "missing"
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const NativeError = globalThis.Error;
const NativeString = globalThis.String;
const nativeIsError = NativeError.isError;
const nativeApply = Reflect.apply;
let ambientReads = 0;
function AmbientError(...arguments_) { ambientReads += 1; return Reflect.construct(NativeError, arguments_); }
AmbientError.isError = (...arguments_) => { ambientReads += 1; return nativeApply(nativeIsError, NativeError, arguments_); };
globalThis.Error = AmbientError;
globalThis.String = (...arguments_) => { ambientReads += 1; return nativeApply(NativeString, globalThis, arguments_); };
Reflect.apply = (...arguments_) => { ambientReads += 1; return nativeApply(...arguments_); };
console.log(exercise());
console.log(ambientReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Error:42\n0\n");
});

test("host tooling reports foreign failures without invoking object hooks", () => {
  let traps = 0;
  const hostile = new Proxy({}, {
    get() { traps += 1; throw new Error("get trap ran"); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error("descriptor trap ran"); },
    getPrototypeOf() { traps += 1; throw new Error("prototype trap ran"); },
    has() { traps += 1; throw new Error("has trap ran"); },
  });
  assert.equal(hostErrorMessage(hostile), "A non-Error value was thrown by JavaScript");
  assert.equal(hostErrorStack(hostile), "A non-Error value was thrown by JavaScript");
  assert.equal(hostErrorCode(hostile), null);
  const wrapped = asHostError(hostile);
  assert.equal(wrapped.message, "A non-Error value was thrown by JavaScript");
  assert.equal(wrapped.cause, hostile);
  assert.equal(traps, 0);

  let getterReads = 0;
  const poisoned = new Error("original");
  Object.defineProperty(poisoned, "message", { configurable: true, get() { getterReads += 1; throw new Error("message getter ran"); } });
  assert.equal(hostErrorMessage(poisoned), "An Error was thrown without a message");
  assert.equal(getterReads, 0);

  const foreign = runInNewContext('Object.assign(new Error("foreign failure"), {code: "ENOENT"})') as unknown;
  assert.equal(hostErrorMessage(foreign), "foreign failure");
  assert.equal(hostErrorCode(foreign), "ENOENT");
  assert.equal(asHostError(foreign), foreign);

  const bounded = hostErrorMessage("x".repeat(70_000));
  assert.equal(bounded.length, 65_537);
  assert.ok(bounded.endsWith("…"));
});

test("finally cannot silently override return or leave an outer loop", () => {
  const invalid = compile(`
def replacedReturn() -> number:
    try:
        return 1
    finally:
        return 2

for value in [1]:
    try:
        pass
    finally:
        break

for value in [1]:
    try:
        pass
    finally:
        continue
`.trimStart());
  assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL3015").length, 3);
  assert.ok(invalid.diagnostics.some((item) => /'return' cannot leave a finally block/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /'break' cannot leave a finally block/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /'continue' cannot leave a finally block/u.test(item.message)));

  const valid = compile(`
def cleaned() -> number:
    let result = 0
    try:
        result = 2
    finally:
        for value in [1]:
            if value == 1:
                break
        def localResult() -> number:
            return result
        print(localResult())
    return result

print(cleaned())
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n2\n");
});

test("rejects missing, non-Error, and non-numeric throw/remainder operands", () => {
  const missing = compile("throw\n");
  assert.ok(missing.diagnostics.some((item) => item.code === "VEL2009" && /requires an Error/.test(item.message)));

  const nonError = compile('throw "failure"\n');
  assert.ok(nonError.diagnostics.some((item) => item.code === "VEL4001" && /Only Error values.*string/.test(item.message)));

  const remainder = compile('const value = "left" % "right"\n');
  assert.ok(remainder.diagnostics.some((item) => item.code === "VEL4001" && /string to number/.test(item.message)));
});

test("strict number parsing returns optional finite decimals without JavaScript coercion", () => {
  const result = compile(`
def label(value: number?) -> string:
    if value != null:
        return f"value:{value}"
    return "missing"

print(label(number("0")))
print(label(number("  -12.5e1  ")))
print(label(number(".5")))
print(number("") == null)
print(number("0x10") == null)
print(number("12px") == null)
print(number("Infinity") == null)
print(number("1e999") == null)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function __velarNumber/u);
  assert.match(result.code ?? "", /Number\.isFinite\(parsed\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "value:0\nvalue:-125\nvalue:0.5\ntrue\ntrue\ntrue\ntrue\ntrue\n");

  const wrongArgument = compile("const value = number(42)\n");
  assert.ok(wrongArgument.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  const shadowed = compile("const number = value => value\n");
  assert.ok(shadowed.diagnostics.some((item) => /'number' is a reserved Core binding/u.test(item.message)));
  assert.doesNotMatch(compile("const value = 1\n").code ?? "", /__velarNumber/u);
});

test("rejects ambient JavaScript coercion globals with intentional replacements", () => {
  const cases = new Map([
    ["const value = Boolean([])\n", /explicit boolean comparison.*truthiness conversion/u],
    ["const value = Number(\"\")\n", /number\(text\).*Number coercion/u],
    ["const value = String(42)\n", /str\(value\).*String global/u],
  ]);
  for (const [source, message] of cases) {
    const result = compile(source);
    assert.equal(result.code, null);
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3008" && message.test(item.message)), JSON.stringify(result.diagnostics));
  }
});
