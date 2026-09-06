import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { describeType } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("local state creates one lexical cell per function execution", () => {
  const nested = compile(`
def counter(start: number) -> () -> number:
    state count = start
    def next() -> number:
        count += 1
        return count
    return next

export def exercise():
    const left = counter(0)
    const right = counter(10)
    print(str(left()) + ":" + str(left()) + ":" + str(right()))
`.trimStart());
  assert.deepEqual(nested.diagnostics, []);
  assert.match(nested.code ?? "", /const count = __velarState\(start, "count"\)/u);
  const execution = executeModule(`${nested.code ?? ""}\nexercise();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1:2:11\n");
});

test("locals shadow module reactive bindings with ordinary lexical semantics", () => {
  const result = compile(`
state dark: bool = false

def darkLabel(dark: bool) -> string:
    return dark ? "dark" : "light"

def localShadow() -> bool:
    let dark = true
    dark = not dark
    return dark

def toggle():
    dark = not dark

const labels = [true, false].map(dark => darkLabel(dark))

component App:
    return <p>{darkLabel(dark)} {localShadow()} {labels.join(",")}</p>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // A shadowing parameter or local is an ordinary lexical binding: reads and
  // writes inside the shadow scope never lower to reactive .get()/.set().
  assert.match(result.code ?? "", /function darkLabel\(dark\) \{\n  return \(dark \? "dark" : "light"\);/u);
  assert.match(result.code ?? "", /let dark = true;\n  dark = !\(dark\);\n  return dark;/u);
  assert.match(result.code ?? "", /dark => darkLabel\(dark\)/u);
  // Assignment that resolves to the module reactive binding still publishes.
  assert.match(result.code ?? "", /dark\.set\(!\(dark\.get\(\)\)\);/u);
  // Reads outside any shadow scope still lower reactively.
  assert.match(result.code ?? "", /darkLabel\(dark\.get\(\)\)/u);

  // Component state and computed accessors follow the same lexical rule.
  const component = compile(`
component App:
    state open = false
    computed title = open ? "open" : "closed"

    def describe(open: bool) -> string:
        return open ? "yes" : "no"

    def echo(title: string) -> string:
        return title

    action toggle():
        open = not open

    return <p>{describe(open)} {echo(title)}</p>
`.trimStart());
  assert.deepEqual(component.diagnostics, []);
  assert.match(component.code ?? "", /function describe\(open\) \{\n {6}return \(open \? "yes" : "no"\);/u);
  assert.match(component.code ?? "", /function echo\(title\) \{\n {6}return title;/u);
  assert.match(component.code ?? "", /open\.set\(!\(open\.get\(\)\)\);/u);
  assert.match(component.code ?? "", /describe\(open\.get\(\)\)/u);
  assert.match(component.code ?? "", /echo\(title\.get\(\)\)/u);
});

test("locals shadow later module reactive bindings independent of declaration order", () => {
  const result = compile(`
def countSaved(sessions: List<string>) -> number:
    return sessions.size

state sessions: List<string> = []

component App:
    return <p>{countSaved(["saved"])} {sessions.size}</p>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // Reactive lowering is determined by lexical binding identity, not by
  // whether the module reactive declaration appeared before the local scope.
  assert.match(result.code ?? "", /function countSaved\(sessions\) \{\n  return __velarListSize\(sessions\);\n\}/u);
  assert.match(result.code ?? "", /__velarListSize\(sessions\.get\(\)\)/u);
});

test("a shadowed name cannot be referenced in the shadow's scope before its declaration", () => {
  const initializerDirective = (name: string) =>
    `The initializer of shadowing declaration '${name}' cannot reference the outer '${name}' it shadows; rename the new binding to keep the outer '${name}' readable`;
  const earlyDirective = (name: string) =>
    `'${name}' is shadowed by a declaration later in this scope, so this reference cannot reach the outer '${name}'; rename the shadowing declaration to keep the outer '${name}' readable`;
  const reports = (source: string, expected: string) => {
    const result = compile(source.trimStart());
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3017" && item.message === expected),
      result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n") || "(no diagnostics)");
  };

  // The analyzer resolves the initializer before declaring the shadow, so its
  // scope model reads the outer binding — a resolution the emitted JavaScript
  // cannot deliver, because the emitter preserves binding names and the read
  // lands in the new binding's temporal dead zone.
  reports(`
const x = 5

def f() -> number:
    const x = x + 1
    return x

print(f())
`, initializerDirective("x"));
  reports(`
let total = 1

def f() -> number:
    let total = total * 2
    return total
`, initializerDirective("total"));

  // Destructuring patterns guard every declared name, including rests.
  reports(`
const items = [1, 2]

def f() -> number:
    const [items, second] = [items[0], 2]
    return second
`, initializerDirective("items"));
  reports(`
const user = {id: 1, tag: "a"}

def f() -> number:
    const {id, ...user} = {id: user.id, tag: "b"}
    return id
`, initializerDirective("user"));

  // Any nesting depth: a block-scoped shadow is guarded the same way.
  reports(`
const x = 5

def f(flag: bool) -> number:
    if flag:
        const x = x + 1
        return x
    return 0
`, initializerDirective("x"));

  // Inside an arrow the reference does not hit the dead zone immediately, but
  // the emitted closure captures the new binding instead of the outer one the
  // analyzer resolved, so the ambiguity is reported all the same.
  reports(`
const scale = 2

def f() -> List<number>:
    const scale = [1, 2].map(value => value * scale)
    return scale
`, initializerDirective("scale"));
  reports(`
const x = 5

def f() -> number:
    const x = ((value = x) => value)(1)
    return x
`, initializerDirective("x"));

  // The shadow owns its name for the whole emitted block, so a reference in
  // any earlier statement of that scope breaks the same way the initializer
  // does — 'const before = x; const x = 1;' reads the uninitialized shadow.
  reports(`
const x = 5

def f() -> number:
    const before = x
    const x = 1
    return before
`, earlyDirective("x"));
  reports(`
let x = 5

def f() -> number:
    x = 6
    const x = 1
    return x
`, earlyDirective("x"));
  reports(`
const x = 5

def f() -> number:
    if true:
        print(x)
    const x = 1
    return x
`, earlyDirective("x"));

  // An arrow parameter that reuses the name is an ordinary inner binding.
  const rebound = compile(`
const value = 2

def f() -> List<number>:
    const value = [1, 2].map(value => value + 1)
    return value
`.trimStart());
  assert.deepEqual(rebound.diagnostics, []);

  // A function parameter default reads the enclosing scope: JavaScript gives
  // parameters their own scope, so a body shadow never captures it.
  const parameterDefault = compile(`
const x = 5

def f(seed: number = x) -> number:
    const x = 1
    return seed + x

print(f())
`.trimStart());
  assert.deepEqual(parameterDefault.diagnostics, []);
  const parameterExecution = executeModule(parameterDefault.code ?? "");
  assert.equal(parameterExecution.status, 0, String(parameterExecution.stderr));
  assert.equal(parameterExecution.stdout, "6\n");

  // A shadow that never references the outer name stays accepted.
  const plain = compile(`
const x = 5

def f() -> number:
    const x = 10
    return x
`.trimStart());
  assert.deepEqual(plain.diagnostics, []);

  // A same-scope redeclaration stays the redeclaration error alone.
  const redeclared = compile(`
def f() -> number:
    let x = 1
    const x = x + 1
    return x
`.trimStart());
  assert.ok(redeclared.diagnostics.some((item) => item.code === "VEL3004"));
  assert.ok(!redeclared.diagnostics.some((item) => item.code === "VEL3017"));

  // Without an outer binding the read is an ordinary unknown name.
  const unknown = compile(`
def f() -> number:
    const x = x + 1
    return x
`.trimStart());
  assert.ok(unknown.diagnostics.some((item) => item.code === "VEL3001"));
  assert.ok(!unknown.diagnostics.some((item) => item.code === "VEL3017"));

  // Reading the outer value from an enclosing scope of the shadow stays legal
  // — the outer read happens before the shadow's block begins.
  const hoisted = compile(`
const x = 5

def f(flag: bool) -> number:
    const outer = x
    if flag:
        const x = outer + 1
        return x
    return outer

print(f(true))
print(f(false))
`.trimStart());
  assert.deepEqual(hoisted.diagnostics, []);
  const execution = executeModule(hoisted.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "6\n5\n");
});

test("a for-loop iterable cannot reference the name its own loop binding declares", () => {
  const loopDirective = (name: string) =>
    `The iterable of this for-loop cannot reference the outer '${name}' its loop binding shadows; rename the loop binding, or read the iterable into a differently named binding first`;
  const reports = (source: string, expected: string) => {
    const result = compile(source.trimStart());
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3017" && item.message === expected),
      result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n") || "(no diagnostics)");
  };

  // The emitted 'for (const items of ...)' evaluates the iterable inside the
  // loop binding's temporal dead zone, so the outer read the analyzer
  // resolves cannot survive emission.
  reports(`
const items = [1, 2, 3]

def f():
    for items in items:
        print(items)

f()
`, loopDirective("items"));

  // The loop binding shadows from its own head, so an iterable read that
  // resolves to the immediately enclosing scope breaks the same way.
  reports(`
def f():
    const items = [1, 2, 3]
    for items in items:
        print(items)
`, loopDirective("items"));

  // Destructuring patterns guard every declared name, including rests.
  reports(`
const pairs = [[1, 2]]

def f():
    for [first, ...pairs] in pairs:
        print(first)
`, loopDirective("pairs"));
  reports(`
const rows = [{id: 1, tag: "a"}]

def f():
    for {id, ...rows} in rows:
        print(id)
`, loopDirective("rows"));

  // An arrow inside the iterable is emitted in the loop head, so it would
  // capture the loop binding instead of the outer list the analyzer
  // resolved — reported all the same.
  reports(`
const items = [1, 2]

def pick(choose: () -> List<number>) -> List<number>:
    return choose()

def f():
    for items in pick(() => items):
        print(items)
`, loopDirective("items"));

  // An arrow parameter that reuses the name is an ordinary inner binding.
  const rebound = compile(`
const items = [9]

def f() -> number:
    let total = 0
    for items in [1, 2].map(items => items * 2):
        total += items
    return total

print(f())
`.trimStart());
  assert.deepEqual(rebound.diagnostics, []);
  const reboundExecution = executeModule(rebound.code ?? "");
  assert.equal(reboundExecution.status, 0, String(reboundExecution.stderr));
  assert.equal(reboundExecution.stdout, "6\n");

  // Unlike a declaration shadow, the loop binding owns its name only in the
  // loop head and body, so reading the iterable into a differently named
  // binding in the same scope is the directive's second fix — and it runs.
  const hoisted = compile(`
const items = [1, 2, 3]

def f():
    const source = items
    for items in source:
        print(items)

f()
`.trimStart());
  assert.deepEqual(hoisted.diagnostics, []);
  const hoistedExecution = executeModule(hoisted.code ?? "");
  assert.equal(hoistedExecution.status, 0, String(hoistedExecution.stderr));
  assert.equal(hoistedExecution.stdout, "1\n2\n3\n");

  // Renaming the loop binding is the directive's first fix — and it runs.
  const renamed = compile(`
const items = [1, 2, 3]

def f():
    for item in items:
        print(item)

f()
`.trimStart());
  assert.deepEqual(renamed.diagnostics, []);
  const renamedExecution = executeModule(renamed.code ?? "");
  assert.equal(renamedExecution.status, 0, String(renamedExecution.stderr));
  assert.equal(renamedExecution.stdout, "1\n2\n3\n");

  // Without an outer binding the read is an ordinary unknown name.
  const unknown = compile(`
def f():
    for x in x:
        print(x)
`.trimStart());
  assert.ok(unknown.diagnostics.some((item) => item.code === "VEL3001"));
  assert.ok(!unknown.diagnostics.some((item) => item.code === "VEL3017"));

  // After the loop the name resolves to the outer binding again.
  const after = compile(`
const items = [1, 2]

def f() -> number:
    for value in items:
        print(value)
    return items.size

print(f())
`.trimStart());
  assert.deepEqual(after.diagnostics, []);
});

test("reactive shadows cannot reference the reactive binding they shadow before declaring", () => {
  const initializerDirective = (name: string) =>
    `The initializer of shadowing declaration '${name}' cannot reference the outer '${name}' it shadows; rename the new binding to keep the outer '${name}' readable`;
  const earlyDirective = (name: string) =>
    `'${name}' is shadowed by a declaration later in this scope, so this reference cannot reach the outer '${name}'; rename the shadowing declaration to keep the outer '${name}' readable`;
  const reports = (source: string, expected: string) => {
    const result = compile(source.trimStart());
    assert.ok(result.diagnostics.some((item) => item.code === "VEL3017" && item.message === expected),
      result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n") || "(no diagnostics)");
  };

  // A local shadowing a module state name reads reactively in its own
  // initializer under the analyzer's model, but the emitted 'const count =
  // count.get() + 1' self-references in the dead zone.
  reports(`
state count = 1

def f() -> number:
    const count = count + 1
    return count

component App:
    return <p>{f()}</p>

mount(<App />, "#app")
`, initializerDirective("count"));

  // Component state and ordinary const declarations shadowing outer names
  // follow the same initializer rule.
  reports(`
state count = 1

component App:
    state count = count + 1
    return <p>{count}</p>

mount(<App />, "#app")
`, initializerDirective("count"));
  reports(`
computed title = "outer"

component App:
    computed title = title
    return <p>{title}</p>

mount(<App />, "#app")
`, initializerDirective("title"));

  // A component item above the shadowing state declaration is emitted inside
  // the same component body, so its outer read breaks identically.
  reports(`
state count = 1

component App:
    const early = count
    state count = 2
    return <p>{early} {count}</p>

mount(<App />, "#app")
`, earlyDirective("count"));

  // A prop default is emitted as a closure inside the component body, so a
  // later item's shadow would capture it there too.
  reports(`
state count = 1

component App(seed: number = count):
    state count = 2
    return <p>{seed} {count}</p>

mount(<App />, "#app")
`, earlyDirective("count"));

  // Shadowing a reactive name without reading it stays ordinary lexical
  // shadowing, and reading it under a different local name stays reactive —
  // including from a prop default.
  const legitimate = compile(`
state count = 1

def f(count: number) -> number:
    const doubled = count * 2
    return doubled

component App(seed: number = count):
    state local = count + seed
    return <p>{f(count)} {local}</p>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(legitimate.diagnostics, []);
});

test("body-backed declarations infer results while bodyless contracts stay explicit", () => {
  const source = `
export def local():
    return 42

export def maybe(ready: bool):
    if ready:
        return "ready"

export async def later():
    return 42

export def choose(numeric: bool):
    if numeric:
        return 1
    return "one"

export def identity<T>(value: T):
    return value

export def reachableOnly():
    return 1
    return "dead"

export def readMadeValue():
    return makeValue().value

def makeValue():
    return {value: 42}

def factorial(value: number):
    if value <= 1:
        return 1
    return value * factorial(value - 1)

export class Worker:
    constructor():
        pass

    def stop():
        pass

extern module "host-sdk":
    export def remote()
    export class Client:
        constructor()
        def close()

export action save():
    pass
`.trimStart();
  const result = compile(source);
  const migrations = result.diagnostics.filter((item) => item.code === "VEL4023");
  assert.deepEqual(migrations.map((item) => item.message), [
    "Extern function 'remote' requires an explicit result annotation; write '-> null' when it has no result",
    "Extern method 'close' requires an explicit result annotation; write '-> null' when it has no result",
  ]);
  assert.deepEqual(migrations.map((item) => source.slice(item.span.start, item.span.end)), [
    "export def remote()",
    "def close()",
  ]);
  assert.deepEqual(result.diagnostics.filter((item) => item.code !== "VEL4023"), []);
  assert.equal(describeType(result.moduleInterface.exports.get("local")!), "() -> number");
  assert.equal(describeType(result.moduleInterface.exports.get("maybe")!), "(ready: bool) -> string?");
  assert.equal(describeType(result.moduleInterface.exports.get("later")!), "() -> Promise<number>");
  assert.equal(describeType(result.moduleInterface.exports.get("choose")!), "(numeric: bool) -> number | string");
  assert.equal(describeType(result.moduleInterface.exports.get("identity")!), "<T>(value: T) -> T");
  assert.equal(describeType(result.moduleInterface.exports.get("reachableOnly")!), "() -> number");
  assert.equal(describeType(result.moduleInterface.exports.get("readMadeValue")!), "() -> number");
  assert.equal(describeType(result.moduleInterface.exports.get("save")!), "action () -> Promise<null>");
  assert.equal(describeType(result.moduleInterface.classes.get("Worker")?.methods.get("stop")!), "() -> null");
  assert.equal(result.semanticIndex.symbols.find((item) => item.name === "factorial")?.type, "(value: number) -> number");

  const unresolved = compile(`
def first():
    return second()

def second():
    return first()
`.trimStart());
  assert.deepEqual(unresolved.diagnostics.map((item) => item.code), ["VEL4025", "VEL4025"]);
  assert.ok(unresolved.diagnostics.every((item) => /add an explicit result annotation/u.test(item.message)));

  const abstract = compile(`
abstract class Base:
    abstract def value()
`.trimStart());
  assert.deepEqual(abstract.diagnostics.map((item) => item.code), ["VEL4023"]);
  assert.match(abstract.diagnostics[0]!.message, /has no body to infer/u);

  const explicit = compile(`
def local() -> number:
    return 42

class Worker:
    constructor():
        pass

    get label() -> string:
        return "ready"

    def stop():
        pass

extern module "host-sdk":
    export def remote() -> null
    export class Client:
        constructor()
        def close() -> null

component App:
    action save():
        pass

    return <p>App</p>

const callback: () -> null = () => null
`.trimStart());
  assert.deepEqual(explicit.diagnostics, []);
});
