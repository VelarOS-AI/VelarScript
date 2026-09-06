import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * The wording and dedup batch of the 0.29.0 Core audit. Each item is one
 * mistake earning one report that names the rule and the fix, beside the
 * neighbouring legal form that has to stay accepted.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[AS-I3] a 'using' at module scope reports the position, not a function that is not there", () => {
  // VEL4033's remedy — "declare the enclosing function 'async def'" — names a
  // function `@main` does not have: it is not a function (charter §3) and its
  // body is inlined at module scope.
  assert.deepEqual(messages(`
class Handle:
    @dispose:
        await Promise.sleep(1ms)

@main:
    using handle = Handle()
    print("x")
`), [
    "VEL3018 A module lives until the process ends, so a module-level 'using' has no scope to release at; own the"
    + " resource inside a function, or use 'const' and release it explicitly",
  ]);
});

test("[AS-I3] the async-scope report still stands where a function is the scope", () => {
  assert.deepEqual(messages(`
class Handle:
    @dispose:
        await Promise.sleep(1ms)

def go():
    using handle = Handle()
    print("x")

@main:
    go()
`), [
    "VEL4033 Releasing Handle awaits, so its 'using' needs an async scope; declare the enclosing function 'async def'",
  ]);
});

test("[AS-I3] the same 'using' inside an async function is legal", () => {
  assert.deepEqual(messages(`
class Handle:
    @dispose:
        await Promise.sleep(1ms)

async def go():
    using handle = Handle()
    print("x")

@main:
    await go()
`), []);
});

test("[AS-I4] a declared record's misspelled field offers the nearest name", () => {
  assert.deepEqual(messages(`
type Rec:
    alpha: number

@main:
    const r: Rec = {alpha: 1}
    print(f"{r.alpah}")
`), ["VEL4001 Type 'Rec' has no field 'alpah'; did you mean 'alpha'?"]);
});

test("[AS-I4] the structural twin is unchanged", () => {
  assert.deepEqual(messages(`
@main:
    const r = {alpha: 1}
    print(f"{r.alpah}")
`), ["VEL4001 Object has no field 'alpah'; did you mean 'alpha'?"]);
});

test("[AS-I5] a permanent namespace names itself, and the JavaScript statics name their successor", () => {
  assert.deepEqual(messages(`
@main:
    const a = Text.nosuch("x")
    print(f"{a}")
`), ["VEL4001 Text has no member 'nosuch'"]);

  assert.deepEqual(messages(`
@main:
    const a = Promise.resolve(1)
    print(f"{a}")
`), [
    "VEL4001 Promise has no member 'resolve'; an 'async def' result is already a Promise, so pass the value itself and"
    + " let the awaiting side see it",
  ]);

  assert.deepEqual(messages(`
@main:
    const a = Promise.reject(Error("x"))
    print(f"{a}")
`), ["VEL4001 Promise has no member 'reject'; throw the error inside an 'async def'; the throw is the rejection"]);
});

test("[AS-I5] a near miss still gets its nearest name, and a real member is clean", () => {
  assert.deepEqual(messages(`
@main:
    await Promise.slep(1ms)
`), ["VEL4001 Promise has no member 'slep'; did you mean 'sleep'?"]);
  assert.deepEqual(messages(`
@main:
    await Promise.sleep(1ms)
`), []);
});

test("[AS-I6] 'detach' in an expression position states the rule", () => {
  assert.deepEqual(messages(`
async def save():
    await Promise.sleep(1ms)

@main:
    const x = detach save()
    print("done")
`).slice(0, 1), [
    "VEL2002 'detach' is statement-position only; write 'detach save()' as its own statement — a detached task has no"
    + " result to bind",
  ]);
});

test("[AS-I6] the statement position is unchanged", () => {
  assert.deepEqual(messages(`
async def save():
    await Promise.sleep(1ms)

@main:
    detach save()
    print("done")
`), []);
});

test("[ER-I2] an Error contract member redeclared as a method or getter gets the contract sentence", () => {
  const subclass = `
class Bad extends Error:
    constructor(message: string):
        super(message)
`;
  assert.deepEqual(messages(`${subclass}
    def code() -> string:
        return "x"
`), [
    "VEL4001 'code' is the Error contract's own member: both report the declared class name, so a subclass cannot"
    + " redeclare either — rename this method, or rename the class",
  ]);
  assert.deepEqual(messages(`${subclass}
    get name() -> string:
        return "x"
`), [
    "VEL4001 'name' is the Error contract's own member: both report the declared class name, so a subclass cannot"
    + " redeclare either — rename this getter, or rename the class",
  ]);
  assert.deepEqual(messages(`${subclass}
    let message: string = "x"
`), ["VEL4001 'message' is the Error contract's own member; pass the text to 'super(...)' instead of redeclaring it as a field"]);
});

test("[ER-I2] a member the Error contract does not own is unchanged", () => {
  assert.deepEqual(messages(`
class Bad extends Error:
    constructor(message: string):
        super(message)

    def detail() -> string:
        return "x"

@main:
    print("x")
`), []);
});

test("[ER-I3] a bare 'try' over a null-on-success expression reports the try/catch sentence only", () => {
  assert.deepEqual(messages(`
def go():
    throw Error("x")

@main:
    try go()
`), [
    "VEL4034 This expression produces null on success, so a 'try' result cannot tell success from failure; use try/catch"
    + " to handle the failure",
  ]);
});

test("[ER-I3] a bare 'try' over a value keeps the consume-the-result sentence", () => {
  assert.deepEqual(messages(`
def go() -> number:
    return 1

@main:
    try go()
`), [
    "VEL4034 A 'try' result must be consumed — bind it, test it, or supply a fallback with '??'; to run something and"
    + " ignore its failure on purpose, use a try/catch block",
  ]);
});

test("[RE-I8] an empty record literal in a '??' right arm gets the Map guidance", () => {
  assert.deepEqual(messages(`
def maybeMap() -> Map<string, number>?:
    return null

@main:
    const c: Map<string, number> = maybeMap() ?? {}
    print(f"{c.size}")
`), ["VEL4001 Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map"]);
});

test("[RE-I8] the direct and ternary positions still answer the same way, and a List arm is clean", () => {
  assert.deepEqual(messages(`
@main:
    const direct: Map<string, number> = {}
    const tern: Map<string, number> = true ? {} : {}
    print(f"{direct.size + tern.size}")
`), [
    "VEL4001 Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map",
    "VEL4001 Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map",
  ]);
  assert.deepEqual(messages(`
def maybeList() -> List<number>?:
    return null

@main:
    const c: List<number> = maybeList() ?? []
    print(f"{c.size}")
`), []);
});

test("[CO-I8] a refused record literal in a '??' right arm reports once", () => {
  // 0.30.0 gave the right arm the expected type, and the arm answered against
  // it — but the old report stayed, printing a union nobody wrote and nobody
  // can keep (`Config | {  }`), whose right half stops existing the moment the
  // arm's own report is answered.
  assert.deepEqual(messages(`
type Config:
    name: string

def make() -> Config?:
    return null

def use(value: Config) -> string:
    return value.name

@main:
    const c = make()
    const d: Config = c ?? {}
    print(use(c ?? {}) + d.name)
`), [
    "VEL4001 Object is missing required field 'name'",
    "VEL4001 Object is missing required field 'name'",
  ]);
  // A right arm that satisfies the expected type is still clean.
  assert.deepEqual(messages(`
type Config:
    name: string

def make() -> Config?:
    return null

@main:
    const d: Config = make() ?? {name: "x"}
    print(d.name)
`), []);
});

test("[TX-I1] string repetition names the member the language has", () => {
  assert.deepEqual(messages(`
@main:
    print(f"{"ab" * 3}")
`), ["VEL4001 Use '.repeat(3)'; strings do not multiply"]);
  assert.deepEqual(messages(`
def times() -> number:
    return 3

@main:
    print(f"{"ab" * times()}")
`), ["VEL4001 Use '.repeat(count)'; strings do not multiply"]);
});

test("[TX-I1] the member itself and ordinary arithmetic are unchanged", () => {
  assert.deepEqual(messages(`
@main:
    print("ab".repeat(3))
    print(f"{2 * 3}")
`), []);
});

test("[TX-U1] the unterminated layout string states the indentation relation", () => {
  assert.deepEqual(messages(`
@main:
    const layout = "
    line one
    "
    print(layout)
`).slice(0, 1), [
    "VEL1003 Unterminated layout string; its content lines must be indented deeper than the opening line, and a quote"
    + " back at the opening line's indentation is what closes it",
  ]);
});

test("[TX-U1] a layout string whose content is deeper closes normally", () => {
  assert.deepEqual(messages(`
@main:
    const layout = "
        line one
    "
    print(layout)
`), []);
});

test("[F6b/c] importing a Core prelude name says the name is already yours", () => {
  // "'range' is a reserved Core binding" is true and useless: the author who
  // wrote the import needs to be told the name needs no import at all.
  assert.deepEqual(messages(`
import {range, print} from "./lib.vel"

@main:
    print("x")
`).filter((item) => item.startsWith("VEL3007")), [
    "VEL3007 'range' is a Core prelude name and needs no import; delete it from the import",
    "VEL3007 'print' is a Core prelude name and needs no import; delete it from the import",
  ]);
});

test("[F6b/c] a local spelled with a prelude name keeps the reserved-binding sentence", () => {
  assert.deepEqual(messages(`
@main:
    const range = 1
    print(str(range))
`), ["VEL3007 'range' is a reserved Core binding"]);
});

test("[F6b/d] 'detach' in an expression position reports once", () => {
  // AS-I6 gave the rule its sentence; the word was still left standing, so a
  // statement-boundary report followed it about a boundary nobody crossed.
  assert.deepEqual(messages(`
def save() -> string:
    return "a"

@main:
    const x = detach save()
    print(x)
`), [
    "VEL2002 'detach' is statement-position only; write 'detach save()' as its own statement"
    + " — a detached task has no result to bind",
  ]);
});

test("[F6b/d] 'detach' as a statement is unaffected", () => {
  assert.deepEqual(messages(`
async def save():
    await Promise.sleep(1ms)

@main:
    detach save()
`), []);
});

test("[F6b/e] a class refused for its missing constructor is not refused again at every construction", () => {
  assert.deepEqual(messages(`
class Boom extends Error:
    pass

@main:
    throw Boom("bad")
`), [
    "VEL4001 Class 'Boom' requires a constructor that calls 'super(...)'; a derived class without one takes no"
    + " construction arguments, so 'Error' would lose its message — write 'constructor(message: string): super(message)'",
  ]);
});

test("[F6b/e] the ordinary-base twin answers the same way", () => {
  assert.deepEqual(messages(`
class Base:
    constructor(label: string):
        pass

class Derived extends Base:
    pass

@main:
    const value = Derived("x")
    print("ok")
`), ["VEL4001 Class 'Derived' requires a constructor that calls 'super(...)'"]);
});

test("[F6b/e] what is wrong inside the arguments is still reported", () => {
  assert.deepEqual(messages(`
class Boom extends Error:
    pass

@main:
    throw Boom(missing)
`), [
    "VEL4001 Class 'Boom' requires a constructor that calls 'super(...)'; a derived class without one takes no"
    + " construction arguments, so 'Error' would lose its message — write 'constructor(message: string): super(message)'",
    "VEL3001 Unknown name 'missing'",
  ]);
});
