import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { VELAR_ERROR_NORMALIZATION_MODULE } from "@velarscript/compiler/extension";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("assertions enforce runtime invariants and narrow following stable values", () => {
  const source = `
type Draft:
    estimate: number?
    label: string?
    enabled: bool?

def message() -> string:
    print("message-evaluated")
    return "unused"

def submit(draft: Draft):
    assert draft.estimate != null else "Estimate is required"
    assert draft.label != null
    assert draft.enabled
    const estimate = draft.estimate
    const label: string = draft.label
    const enabled: bool = draft.enabled
    print(f"{estimate}:{label}:{enabled}")

submit({estimate: 0, label: "", enabled: true})
assert true else message()

try:
    assert false else "Broken invariant"
catch error:
    print(f"{error.name}:{error.message}")
`;
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((item) => item.kind === "variable" && item.name === "estimate")?.type, "number");
  assert.match(result.code ?? "", /\(\(draft\.estimate \?\? null\) !== null\)/u);
  // D50 rule 89: `assert` raises a compiler-owned class that carries its name
  // on the constructor through defineProperty, exactly as NarrowingError and
  // IndexError do. The former lowering built a plain Error and wrote `name`
  // onto the instance, which made `code` answer "Error".
  assert.match(result.code ?? "", /class __VelarAssertionError extends __velarAssertionNativeError \{/u);
  assert.match(result.code ?? "", /__velarAssertionDefineProperty\(__VelarAssertionError, "name", \{ value: "AssertionError", writable: false, enumerable: false, configurable: true \}\);/u);
  assert.match(result.code ?? "", /throw new __VelarAssertionError\("Broken invariant"\);/u);
  assert.doesNotMatch(result.code ?? "", /__velarAssertionError\.name = "AssertionError"/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0::true\nAssertionError:Broken invariant\n");

  // The class is one identity across a project, so a shared-runtime build
  // imports it from the shared error module rather than inlining a second
  // class every module would compare unequal against.
  const sharedAssertion = compile(source, { sharedRuntimeModules: true });
  assert.deepEqual(sharedAssertion.diagnostics, []);
  assert.ok(sharedAssertion.runtimeModules.includes(VELAR_ERROR_NORMALIZATION_MODULE), JSON.stringify(sharedAssertion.runtimeModules));
  assert.match(sharedAssertion.code ?? "", /^import \{ AssertionError as __VelarAssertionError \} from "velar\/compiler-runtime-errors-v1";$/mu);
  assert.doesNotMatch(sharedAssertion.code ?? "", /class __VelarAssertionError/u);

  const invalid = compile(`
assert 1
assert true else 42
`);
  assert.ok(invalid.diagnostics.some((item) => /Condition must be bool, received number/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));

  const messageFlow = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "failed"

def keep(box: Box) -> string:
    assert box.user != null
    assert true else clear(box)
    return box.user.name

def failureMessage(user: User?) -> string:
    assert user == null else user.name
    return "empty"

print(keep({user: {name: "Ada"}}))
print(failureMessage(null))
`.trimStart());
  assert.deepEqual(messageFlow.diagnostics, []);
  const messageExecution = executeModule(messageFlow.code ?? "");
  assert.equal(messageExecution.status, 0, String(messageExecution.stderr));
  assert.equal(messageExecution.stdout, "Ada\nempty\n");

  // D44 rule 71: a literal initializer would itself establish the fact, so
  // the initializer stays opaque to isolate the assert's block scoping.
  const scoped = compile(`
def maybe() -> number?:
    return 1

let value: number? = maybe()
if true:
    assert value != null
    const inside: number = value
const outside: number = value
`);
  assert.ok(scoped.diagnostics.some((item) => /Cannot assign number\? to number/u.test(item.message)));

  const deferred = compile(`
let value: number? = 1
assert value != null
def later() -> number:
    return value
const callback: () -> number = () => value
`);
  assert.equal(deferred.diagnostics.filter((item) => /number\?/u.test(item.message)).length, 2);

  const malformed = compile("assert\nassert true else\n");
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2017" && /requires a condition/u.test(item.message)));
  assert.ok(malformed.diagnostics.some((item) => item.code === "VEL2017" && /requires a message/u.test(item.message)));

  const legacySeparator = compile('assert true, "legacy"\n');
  assert.ok(legacySeparator.diagnostics.some((item) => item.code === "VEL2017" && /assert condition else message/u.test(item.message)));
  assert.equal(legacySeparator.code, null);
});

test("the required-value unwrap checks, reports, and never claims", () => {
  // D86 rule 212: `value!` takes `T?` to `T` and raises AssertionError where
  // the value is absent — a check, not a TypeScript-style claim.
  const result = compile(`
type Contact:
    email: string

type Owner:
    profile: Contact?

def address(owner: Owner) -> string:
    return owner.profile!.email

const lookup: Map<string, number> = Map()
lookup.set("a", 1)
print(str(lookup.get("a")!))
print(address({profile: {email: "ada@example.com"}}))
try:
    print(str(lookup.get("missing")!))
catch error:
    print(error.name)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1\nada@example.com\nAssertionError\n");

  // The failure is a bug, so `try` passes it through exactly as it passes a
  // failed `assert` through.
  const swallowed = compile("def find() -> string?:\n    return null\n\nconst v = try find()!\nprint(str(v))\n");
  assert.deepEqual(swallowed.diagnostics, []);
  const failed = executeModule(swallowed.code ?? "");
  assert.notEqual(failed.status, 0);
  assert.match(String(failed.stderr), /AssertionError/u);

  const rejected = compile(`
def redundant(name: string) -> number:
    return name!.size

def opaque(value: unknown):
    print(value!)

async def loaded() -> string?:
    return "a"

async def early() -> number:
    return (await loaded())!.size
`.trimStart());
  const messages = rejected.diagnostics.map((item) => `${item.code}: ${item.message}`);
  assert.ok(messages.some((message) => /VEL4040.*already string; remove the '!'/u.test(message)), messages.join("\n"));
  assert.ok(messages.some((message) => /VEL4040.*unknown is not one; validate it/u.test(message)), messages.join("\n"));
  assert.equal(messages.length, 2);

  // A parser diagnostic gates analysis, so the write target stands alone.
  const written = compile("let held: string? = \"a\"\nheld! = \"b\"\n");
  assert.deepEqual(written.diagnostics.map((item) => item.code), ["VEL2005"]);
  assert.match(written.diagnostics[0]?.message ?? "", /cannot stand on an assignment target/u);
  assert.deepEqual(written.diagnostics[0]?.fix?.edits.map((edit) => edit.text), [""]);

  const promised = compile("async def loaded() -> string?:\n    return \"a\"\n\nasync def early() -> number:\n    return await loaded()!.size\n");
  assert.ok(promised.diagnostics.some((item) => /VEL4040/u.test(item.code) && /write '\(await \.\.\.\)!'/u.test(item.message)));
});

test("'!' reads as negation before a value and as the unwrap after one", () => {
  // D54 rule 118 stands for the prefix reading: it stays a teaching
  // diagnostic, now reported by the parser because only position decides.
  const prefix = compile("const ready: bool = true\nif !ready:\n    print(\"no\")\n");
  assert.deepEqual(prefix.diagnostics.map((item) => item.code), ["VEL1005"]);
  assert.match(prefix.diagnostics[0]?.message ?? "", /Use 'not'/u);
  assert.deepEqual(prefix.diagnostics[0]?.fix?.edits.map((edit) => edit.text), ["not "]);

  // `!=` keeps winning by longest match, so `!==` stays the inequality
  // guidance and names the other reading rather than guessing between them.
  const tight = compile("def check(a: number?) -> bool:\n    return a!==1\n");
  assert.ok(tight.diagnostics.some((item) => item.code === "VEL1005" && /give '==' its space/u.test(item.message)));
  const spaced = compile("def check(a: number?) -> bool:\n    return a! == 1\n");
  assert.deepEqual(spaced.diagnostics, []);
  const inequality = compile("def check(a: number) -> bool:\n    return a != 1\n");
  assert.deepEqual(inequality.diagnostics, []);

  // The unwrap is part of the postfix chain, and the formatter writes it tight.
  assert.equal(formatSource("const v = lookup.get(key) !\n"), "const v = lookup.get(key)!\n");
  assert.equal(formatSource("print(a ! == 1)\n"), "print(a! == 1)\n");
  assert.equal(formatSource("print(owner.profile ! .email)\n"), "print(owner.profile!.email)\n");
});
