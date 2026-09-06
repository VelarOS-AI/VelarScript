import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { compile as compileCore, type CompilerExtension } from "@velarscript/compiler";
import { type ExtensionValueType, type TypeSyntax } from "@velarscript/compiler/extension";
import { type ValueType } from "../../../packages/compiler/src/types.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("compiles bindings, functions, and strict equality", () => {
  const result = compile(`
export def double(value: number) -> number:
    return value * 2

const start = 2
let result = double(start)
result += 1

if result == 5:
    print("ok")
else:
    print("bad")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /export function double\(value\)/);
  assert.match(result.code ?? "", /const start = 2;/);
  assert.match(result.code ?? "", /result \+= 1;/);
  assert.match(result.code ?? "", /if \(\(result === 5\)\)/);
});

test("bare returns preserve null at direct JavaScript and asynchronous boundaries", () => {
  const result = compileCore(`
def stop():
    return

async def stopLater():
    return

class Controller:
    def stop():
        return
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /return;/u);
  assert.match(result.code ?? "", /return null;/u);
  const execution = executeModule(`${result.code ?? ""}
console.log(stop() === null);
console.log((await stopLater()) === null);
console.log(new Controller().stop() === null);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n");
});

test("named arguments are checked, reordered, and evaluated in source order", () => {
  const result = compileCore(`
def describe(name: string, count: number = 1, excited: bool = false) -> string:
    return name

def mark(value: string) -> string:
    print(value)
    return value

const label = describe(excited=true, name=mark("name"), count=2)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /describe\(\.\.\.\(\(__velarNamedArguments\) => \[__velarNamedArguments\[1\], __velarNamedArguments\[2\], __velarNamedArguments\[0\]\]\)\(\[true, mark\("name"\), 2\]\)\)/u);
  const signature = result.moduleInterface.exports.get("describe");
  assert.equal(signature, undefined);

  const unknown = compileCore(`
def greet(name: string, count: number = 1):
    print(name)

greet(missing="Velar")
`.trimStart());
  assert.match(unknown.diagnostics.map((item) => item.message).join("\n"), /Unknown named argument 'missing'/u);
  const duplicate = compileCore(`def greet(name: string):\n    print(name)\n\ngreet(name="Velar", name="Again")\n`);
  assert.match(duplicate.diagnostics.map((item) => item.message).join("\n"), /more than once/u);
  const positional = compileCore(`def greet(name: string, count: number = 1):\n    print(name)\n\ngreet(name="Velar", 2)\n`);
  assert.match(positional.diagnostics.map((item) => item.message).join("\n"), /Positional arguments must appear before named arguments/u);
  const colon = compileCore(`def greet(name: string):\n    print(name)\n\ngreet(name: "Velar")\n`);
  assert.match(colon.diagnostics.map((item) => item.message).join("\n"), /Write '=' between the name and value for named argument 'name'/u);
});

test("named calls evaluate the callee first and preserve optional short-circuiting", () => {
  const result = compileCore(`
let events: List<string> = []

def mark(value: string) -> string:
    events.append(value)
    return value

class Service:
    def describe(first: string, second: string) -> string:
        return f"{first}:{second}"

class Host:
    get service() -> Service:
        events.append("callee")
        return Service()

const host = Host()
print(host.service.describe(second=mark("second"), first=mark("first")))
const absent: Service? = null
print(absent?.describe(first=mark("skipped"), second="unused") == null)
print(events.join(","))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "first:second\ntrue\ncallee,second,first\n");
});

test("calls keep optimistic narrowing syntax and revalidate later reads", () => {
  const named = compileCore(`
type User:
    name: string

type Box:
    user: User?

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def consume(first: string, second: string) -> string:
    return first

def label(box: Box) -> string:
    assert box.user != null
    return consume(second=clear(box), first=box.user.name)
`.trimStart());
  assert.deepEqual(named.diagnostics, []);
  assert.match(named.code ?? "", /NarrowingError/u);

  const getter = compileCore(`
type User:
    name: string

class Service:
    def describe(name: string) -> string:
        return name

class Host:
    let user: User? = {name: "Ada"}

    get service() -> Service:
        self.user = null
        return Service()

def label(host: Host) -> string:
    assert host.user != null
    return host.service.describe(name=host.user.name)
`.trimStart());
  assert.deepEqual(getter.diagnostics, []);
  assert.match(getter.code ?? "", /NarrowingError/u);
});

test("keeps Web syntax outside the Core language unless the project loads the Web extension", () => {
  const core = compileCore("component App:\n    return <main>Core must reject this</main>\n");
  assert.ok(core.diagnostics.length > 0);
  assert.deepEqual(core.extensions, []);

  const web = compile("component App:\n    return <main>Web owns this</main>\n");
  assert.deepEqual(web.diagnostics, []);
  assert.deepEqual(web.extensions, ["@velarscript/web"]);
});

test("target-owned types compose through one extension contract without Core target changes", () => {
  const entityType: ValueType = {
    kind: "extension",
    extensionId: "@example/game",
    family: "entity",
    role: "value",
    properties: new Map([["name", { kind: "string" }]]),
    requiredProperties: new Set(["name"]),
    arguments: [],
    metadata: { semanticSymbolKind: "extension:class:game-entity" },
    display: { kind: "named", name: "Entity" },
  };
  const gameExtension: CompilerExtension = Object.freeze({
    id: "@example/game",
    contract: Object.freeze({ protocolVersion: 1, apiVersion: "1.0", kind: "application", extends: Object.freeze({}) }),
    capabilities: Object.freeze(["game"]),
    analysis: Object.freeze({
      primitiveTypes: new Set(["Entity"]),
      globals: new Map([[
        "spawnEntity",
        { kind: "function", parameters: [{ kind: "string" }], requiredParameters: 1, result: entityType } satisfies ValueType,
      ]]),
      resolveTypeSyntax(syntax: TypeSyntax) {
        return syntax.kind === "NamedTypeSyntax" && syntax.name === "Entity" ? entityType : undefined;
      },
      memberType(type: ExtensionValueType, property: string) {
        return type.extensionId === "@example/game" ? type.properties.get(property) ?? null : undefined;
      },
    }),
  });

  const core = compileCore("const player: Entity = spawnEntity(\"Ada\")\nprint(player.name)\n");
  assert.ok(core.diagnostics.some((item) => /Unknown type 'Entity'/u.test(item.message)));
  const game = compileCore("const player: Entity = spawnEntity(\"Ada\")\nprint(player.name)\n", { extensions: [gameExtension] });
  assert.deepEqual(game.diagnostics, []);
  assert.deepEqual(game.extensions, ["@example/game"]);
  assert.match(game.code ?? "", /spawnEntity\("Ada"\)/u);
  const execution = executeModule(`globalThis.spawnEntity = name => ({name});\n${game.code ?? ""}`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");
});

test("else if chains preserve rejected facts, complete returns, and readable JavaScript", () => {
  const result = compile(`
def describe(value: number?, fallback: string?) -> string:
    if value == null:
        return fallback ?? "missing"
    else if value > 10:
        return f"high:{value}"
    else if fallback != null:
        return f"{fallback}:{value}"
    else:
        return f"low:{value}"

print(describe(null, null))
print(describe(12, null))
print(describe(4, "steady"))
print(describe(2, null))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /\} else if \(\(\(__velarValue => __velarNarrow/u);
  assert.match(result.code ?? "", /\} else if \(\(\(fallback \?\? null\) !== null\)\) \{/u);
  assert.doesNotMatch(result.code ?? "", /else \{\s+if/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "missing\nhigh:12\nsteady:4\nlow:2\n");
});

test("is checks subtract simple union members across chains, assertions, fields, and JSX", () => {
  const result = compile(`
type DisplayValue = string | number | bool

type Payload:
    value: string | number

def display(value: DisplayValue) -> string:
    if value is string:
        return f"text:{value}"
    else if value is number:
        return f"number:{value + 1}"
    else:
        return value ? "yes" : "no"

def increment(value: string | number) -> number:
    assert value is not string else "Expected a number"
    return value + 1

def incrementField(payload: Payload) -> number:
    if payload.value is string:
        return payload.value == "" ? 0 : 1
    else:
        return payload.value + 1

def optionalIncrement(value: number?) -> number:
    if value == null:
        return 0
    else:
        return value + 1

let typeTestReads = 0

def dynamicValue() -> unknown:
    typeTestReads += 1
    return "velar"

component Preview(value: DisplayValue):
    def content() -> WebNode:
        if value is string:
            return <p>{value}</p>
        else if value is number:
            return <p>{value + 1}</p>
        else:
            return <p>{value ? "yes" : "no"}</p>

    return <div>{content()}</div>

print(display("velar"))
print(display(4))
print(display(true))
print(increment(4))
print(incrementField({value: 9}))
print(optionalIncrement(null))
print(dynamicValue() is not string | number)
print(typeTestReads)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /!\(\(__velarIs\d+ =>/u);
  assert.match(result.code ?? "", /dynamicValue\(\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "text:velar\nnumber:5\nyes\n5\n10\n0\nfalse\n1\n");

  const unsafeContinuation = compile(`
def invalid(value: string | number):
    if value is string:
        print(value)
    print(value + 1)
`.trimStart());
  assert.ok(unsafeContinuation.diagnostics.some((item) => /Cannot assign string \| number to number/u.test(item.message)));
});
