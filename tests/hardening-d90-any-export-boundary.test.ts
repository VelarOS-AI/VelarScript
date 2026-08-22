import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D90 R12: `any` may not appear at an export position, written or inferred.
//
// The written spelling was already refused — `export const leaked: any = thing`
// reports "'any' is reserved for explicit unsafe JavaScript boundaries" — while
// the inferred `export const leaked = thing` published `leaked: any` with zero
// diagnostics. That asymmetry was the whole defect: the spelling that got
// refused is the honest one. This file pins the completed rule, not a new one —
// same diagnostic code, no contagious unsafe marker.
//
// D90 R17 closed the boundary's entry: `import js unsafe` now arrives as
// `unknown` (pinned in hardening-d90-r17-unknown-boundary.test.ts), so a
// module-internal `any` can only enter through a host-injected import — the
// same channel a compiler extension uses. Every case below injects one under
// the name `thing`, which keeps R12's export boundary pinned while the R17
// producer change stands.

const injectedAny = () => ({ analysis: { imports: new Map([["thing", { kind: "any" } as const]]) } });

function diagnostics(source: string): string[] {
  return compile(source.trimStart(), injectedAny()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

// The Web extension is the only owner of an extension type whose `properties`
// are non-empty, so the prop spelling of an input position can only be written
// through it.
function webDiagnostics(source: string): string[] {
  return compile(source.trimStart(), { ...injectedAny(), extensions: [velarCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

const wayOut = "validate the value into a declared type in this module first";

test("an inferred any at an export position is refused", () => {
  const direct = diagnostics(`
import {thing} from "./x.js"

export const leaked = thing
`);
  assert.deepEqual(direct, [
    `VEL4001 Export 'leaked' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // Vel has no bare `export {a}`, so the indirect spelling is a second
  // declaration whose inferred type is the same `any`.
  const indirect = diagnostics(`
import {thing} from "./x.js"

const a = thing

export const b = a
`);
  assert.ok(indirect.some((item) => item.includes("Export 'b' is 'any'")), indirect.join("\n"));

  // A container of `any` is read out of by the consumer exactly as a bare one is.
  const inList = diagnostics(`
import {thing} from "./x.js"

export const items = [thing]
`);
  assert.ok(inList.some((item) => item.includes("Export 'items' is 'any'")), inList.join("\n"));
});

test("the refusal names every binding a pattern exports", () => {
  // Checking the settled type at statement level, before the pattern is
  // declared, covers every pattern shape in one place; both names used to be
  // published as `any`.
  const destructured = diagnostics(`
import {thing} from "./x.js"

export const {a, b} = thing
`);
  assert.ok(destructured.some((item) => item.includes("Exports 'a', 'b' are 'any'")), destructured.join("\n"));

  const mutable = diagnostics(`
import {thing} from "./x.js"

export let held = thing
`);
  assert.ok(mutable.some((item) => item.includes("Export 'held' is 'any'")), mutable.join("\n"));
});

test("an exported function with an omitted result annotation is refused", () => {
  // This module has no other omitted result, so the driver never runs the
  // converge-and-finalize loop: the report is deliberately not gated on
  // `finalizeFunctionResultInference`, and a probe pass is discarded whole,
  // which is why an ungated report cannot duplicate.
  const inferred = diagnostics(`
import {thing} from "./x.js"

export def get():
    return thing
`);
  assert.deepEqual(inferred, [
    `VEL4001 Export 'get' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // An async result is a Promise of the inferred value, and the predicate
  // visits what the promise resolves to.
  const asynchronous = diagnostics(`
import {thing} from "./x.js"

export async def get():
    return thing
`);
  assert.ok(asynchronous.some((item) => item.includes("Export 'get' is 'any'")), asynchronous.join("\n"));
});

test("the refusal teaches the way out instead of only announcing itself", () => {
  const reported = diagnostics(`
import {thing} from "./x.js"

export const leaked = thing
`);
  assert.equal(reported.length, 1);
  // The escape the ruling names, in the repository's own spelling
  // (examples/tour/core/13-javascript-boundary.vel writes `Config.parse`).
  assert.match(reported[0]!, /Config\.parse\(candidate\)/u);
  assert.match(reported[0]!, /cannot cross a module boundary/u);
});

test("an any that never leaves the module is untouched", () => {
  // The boundary block itself, and every internal use of what it imports.
  const internal = diagnostics(`
import {thing} from "./x.js"

const kept = thing

def read() -> string:
    const settled: string = kept
    return settled
`);
  assert.deepEqual(internal, []);

  // A function that infers `any` but is not exported publishes nothing.
  const privateFunction = diagnostics(`
import {thing} from "./x.js"

def get():
    return thing

const used = get()
`);
  assert.deepEqual(privateFunction, []);
});

test("a value validated into a declared type exports cleanly", () => {
  const validated = diagnostics(`
import {thing} from "./x.js"

type Config:
    retries: number

export const settled = Config.parse(thing)
`);
  assert.deepEqual(validated, []);

  const annotatedResult = diagnostics(`
import {thing} from "./x.js"

export def get() -> string:
    return thing
`);
  assert.deepEqual(annotatedResult, []);
});

test("an any in a callable input position leaks nothing and is allowed", () => {
  // The rule exists so a consumer never *receives* a value the compiler makes
  // no promise about; an input position accepts a value from the consumer
  // instead. `Json.stringify` is the repository's own case — an `any` first
  // parameter and a `string` result — and it is re-exported from
  // examples/tour/core/08-collections-and-math.vel today.
  const reexported = diagnostics(`
export const encode = Json.stringify
`);
  assert.deepEqual(reexported, []);

  const inRecord = diagnostics(`
export const chapter = {encode: Json.stringify}
`);
  assert.deepEqual(inRecord, []);
});

test("the written spelling is still refused by the rule this completes", () => {
  // Unchanged, and quoted here so the two halves of one rule stay visible
  // together: the point of R12 is that these two now agree.
  const written = diagnostics(`
import {thing} from "./x.js"

export const leaked: any = thing
`);
  assert.deepEqual(written, [
    "VEL4001 'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript",
  ]);
});

// An export position is a property of the declaration a consumer can reach,
// not of the `def` keyword. R12 read `statement.exported` — the function's own
// flag — and a class member has none, so the whole rule was dead for every
// method of an exported class: `export class Box:` / `def leak(): return thing`
// compiled with zero diagnostics while the same body as `export def leak()`
// was refused. The boundary is unchanged: `private` members and members of a
// class this module keeps to itself are module-internal `any`, which is legal.

test("a public method of an exported class is at an export position", () => {
  const instance = diagnostics(`
import {thing} from "./x.js"

export class Box:
    def leak():
        return thing
`);
  assert.deepEqual(instance, [
    `VEL4001 Export 'Box.leak' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // A static method is reached through the class object rather than an
  // instance, and is published the same way.
  const staticMethod = diagnostics(`
import {thing} from "./x.js"

export class Box:
    static def leak():
        return thing
`);
  assert.ok(staticMethod.some((item) => item.includes("Export 'Box.leak' is 'any'")), staticMethod.join("\n"));

  // A container of `any`, as for an exported `const`.
  const inList = diagnostics(`
import {thing} from "./x.js"

export class Box:
    def leak():
        return [thing]
`);
  assert.ok(inList.some((item) => item.includes("Export 'Box.leak' is 'any'")), inList.join("\n"));

  // The member is named so the author can find it; the class alone would not
  // say which of its members to fix.
  assert.match(instance[0]!, /'Box\.leak'/u);
});

test("an exported subclass publishes the members of the base it names", () => {
  // `Base` carries no `export` keyword, but a consumer holding a `Box` calls
  // `leak()` on it, so the base's inferred `any` crosses the boundary too. The
  // report names `Base.leak`, which is the declaration that has to change.
  const inherited = diagnostics(`
import {thing} from "./x.js"

class Base:
    def leak():
        return thing

export class Box extends Base:
    pass
`);
  assert.deepEqual(inherited, [
    `VEL4001 Export 'Base.leak' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // Reachability is transitive, and it does not depend on declaration order.
  const twoDeep = diagnostics(`
import {thing} from "./x.js"

export class Box extends Middle:
    pass

class Middle extends Base:
    pass

class Base:
    def leak():
        return thing
`);
  assert.ok(twoDeep.some((item) => item.includes("Export 'Base.leak' is 'any'")), twoDeep.join("\n"));
});

test("'@iterate:' is the class's other inferred public contract", () => {
  // `for item in box` reads the element straight out of this block, so an
  // element the compiler makes no promise about leaves the module exactly as a
  // method result does. The block has no annotation to refuse and no `private`
  // spelling, so the class's own reachability is the whole question.
  const exported = diagnostics(`
import {thing} from "./x.js"

export class Box:
    @iterate:
        return [thing]
`);
  assert.deepEqual(exported, [
    `VEL4001 Export 'Box.@iterate' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  const internal = diagnostics(`
import {thing} from "./x.js"

class Box:
    @iterate:
        return [thing]

for item in Box():
    print("kept")
`);
  assert.deepEqual(internal, []);
});

test("a class member the module keeps to itself is untouched", () => {
  // `private` is not reachable from a consuming module, so it is the same
  // module-internal `any` an unexported `def` holds.
  const hidden = diagnostics(`
import {thing} from "./x.js"

export class Box:
    private def leak():
        return thing

    private static def alsoLeak():
        return thing
`);
  assert.deepEqual(hidden, []);

  // A class this module never publishes cannot hand anything across.
  const unexported = diagnostics(`
import {thing} from "./x.js"

class Box:
    def leak():
        return thing

const box = Box()
`);
  assert.deepEqual(unexported, []);

  // An exported class whose members are annotated exports nothing inferred.
  const annotated = diagnostics(`
import {thing} from "./x.js"

export class Box:
    def read() -> string:
        const settled: string = "ok"
        return settled
`);
  assert.deepEqual(annotated, []);
});

test("the class member positions that can never infer are already refused", () => {
  // Confirmed rather than re-checked: each of these is closed by a rule that
  // predates R12, so a second check here would be dead code.
  //
  // A getter has no inferred result to publish at all.
  assert.deepEqual(diagnostics(`
import {thing} from "./x.js"

export class Box:
    get leak():
        return thing
`), ["VEL2023 A getter requires an explicit result type"]);

  // A field always writes its type, and the written `any` is refused.
  assert.deepEqual(diagnostics(`
import {thing} from "./x.js"

export class Box:
    const held = thing
`), ["VEL2021 Class fields require an explicit type"]);
  assert.deepEqual(diagnostics(`
import {thing} from "./x.js"

export class Box:
    const held: any = thing
`), ["VEL4001 'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript"]);

  // Including the constructor-parameter spelling of a field.
  assert.deepEqual(diagnostics(`
import {thing} from "./x.js"

export class Box:
    constructor(let held: any):
        pass
`), ["VEL4001 'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript"]);

  // An abstract method has no body to infer from.
  assert.deepEqual(diagnostics(`
import {thing} from "./x.js"

export abstract class Box:
    abstract def leak()
`), ["VEL4023 Abstract method 'leak' requires an explicit result annotation because it has no body to infer"]);

  // And a written `-> any` on a method is the same refusal an exported `const`
  // annotation gets.
  assert.deepEqual(diagnostics(`
import {thing} from "./x.js"

export class Box:
    def leak() -> any:
        return thing
`), ["VEL4001 'any' is reserved for explicit unsafe JavaScript boundaries; use 'unknown' in VelarScript"]);
});

test("a class a published type names is reachable even when it is not exported", () => {
  // The class carries no `export` keyword, but a consumer that receives an
  // instance can call every public member on it, so its inferred `any` crosses
  // the boundary. Reachability, not the keyword, is the question — which is
  // why the report waits for the whole module.
  const inner = `
import {thing} from "./x.js"

class Inner:
    def deep():
        return thing
`;
  const leaked = "Export 'Inner.deep' is 'any'";

  const result = diagnostics(`${inner}
export def make() -> Inner:
    return Inner()
`);
  assert.deepEqual(result, [
    `VEL4001 Export 'Inner.deep' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // The same class through every other output position a module publishes.
  const held = diagnostics(`${inner}
export const box = Inner()
`);
  assert.ok(held.some((item) => item.includes(leaked)), held.join("\n"));

  const inContainer = diagnostics(`${inner}
export def make() -> List<Inner>:
    return [Inner()]
`);
  assert.ok(inContainer.some((item) => item.includes(leaked)), inContainer.join("\n"));

  const inRecordField = diagnostics(`${inner}
export type Wrapper:
    inner: Inner
`);
  assert.ok(inRecordField.some((item) => item.includes(leaked)), inRecordField.join("\n"));

  const throughAnotherClass = diagnostics(`${inner}
export class Box:
    get held() -> Inner:
        return Inner()
`);
  assert.ok(throughAnotherClass.some((item) => item.includes(leaked)), throughAnotherClass.join("\n"));

  const throughStaticField = diagnostics(`${inner}
export class Box:
    static const held: Inner = Inner()
`);
  assert.ok(throughStaticField.some((item) => item.includes(leaked)), throughStaticField.join("\n"));
});

test("a class no export can hand across stays module-internal", () => {
  const inner = `
import {thing} from "./x.js"

class Inner:
    def deep():
        return thing
`;

  // Nothing published mentions it.
  assert.deepEqual(diagnostics(`${inner}
const box = Inner()

export const label = "kept"
`), []);

  // An input position accepts an instance *from* the consumer, who had to get
  // it from an output position first; following inputs would refuse a program
  // that hands nothing across. This is the same boundary `typeContainsAnyOutput`
  // draws for the `any` itself.
  assert.deepEqual(diagnostics(`${inner}
export def take(box: Inner) -> string:
    return "kept"
`), []);

  // Reached only through a private member of an exported class.
  assert.deepEqual(diagnostics(`${inner}
export class Box:
    private def held() -> Inner:
        return Inner()
`), []);

  // A record type that names itself does not stall the walk.
  assert.deepEqual(diagnostics(`
type Node:
    next: Node?

export const head: Node = {next: null}
`), []);
});

test("the deferred class-member report cannot duplicate across the converge loop", () => {
  // The `def` above needs the converge-and-finalize loop, so this module is
  // analyzed more than once. Deferring the member report to the end of one
  // analysis pass — rather than across passes — keeps the reasoning the
  // module-level report already relies on: a probe pass is discarded whole.
  const reported = diagnostics(`
import {thing} from "./x.js"

def countdown(n: number):
    if n <= 0:
        return 0
    return countdown(n - 1)

export class Box:
    def leak():
        return thing

    def use() -> number:
        return countdown(3)
`);
  assert.deepEqual(reported, [
    `VEL4001 Export 'Box.leak' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);
});

test("a parameter is an input position in every spelling it has", () => {
  // The reachability walk followed an extension type's `properties`, which are
  // that family's *named parameters*: a Web component's props are supplied by
  // whoever renders it. So `export component Panel(inner: Inner)` reported
  // `Inner`'s inferred member while `export def take(box: Inner)` — the same
  // position, spelled as a `def` — stayed silent. One question, two answers.
  //
  // A consumer cannot name `Inner`, so it can never supply the prop and can
  // never obtain the instance; there is nothing to refuse.
  const inner = `
import {thing} from "./x.js"

class Inner:
    def deep():
        return thing
`;

  assert.deepEqual(webDiagnostics(`${inner}
export component Panel(inner: Inner):
    return <div>{"x"}</div>
`), []);

  // Optional, defaulted, and inside a container — the prop position, not one
  // prop spelling.
  assert.deepEqual(webDiagnostics(`${inner}
export component Panel(inner: Inner? = null, items: List<Inner> = []):
    return <div>{"x"}</div>
`), []);

  // The contract spelling holds the same props in the same `properties` map.
  // A consumer that *implements* this contract does receive `inner`, which is
  // the contravariant output R12 does not model in any spelling: the plain
  // `export type Slot: pick: (Inner) -> null` below is silent for exactly the
  // same reason, and both belong to one rule, not to the extension case.
  assert.deepEqual(webDiagnostics(`${inner}
export type PanelView = Component<(inner: Inner) -> WebNode>
`), []);

  assert.deepEqual(diagnostics(`${inner}
export type Slot:
    pick: (Inner) -> null
`), []);
});

test("an extension type's payload is still an output position", () => {
  // `arguments` carry what the family hands back — a component's exposed
  // Handle — so dropping `properties` from the walk must not drop these.
  const inner = `
import {thing} from "./x.js"

class Inner:
    def deep():
        return thing
`;

  const exposed = webDiagnostics(`${inner}
type Handle:
    inner: Inner

export component Panel() exposes Handle:
    expose {inner: Inner()}
    return <div>{"x"}</div>
`);
  assert.deepEqual(exposed, [
    `VEL4001 Export 'Inner.deep' is 'any', which cannot cross a module boundary; ${wayOut} — 'const settled = Config.parse(candidate)' — and export that`,
  ]);

  // And the rule itself still reaches every core output position with the Web
  // extension active, so the change narrowed one position rather than the walk.
  const returned = webDiagnostics(`${inner}
export def make() -> Inner:
    return Inner()
`);
  assert.ok(returned.some((item) => item.includes("Export 'Inner.deep' is 'any'")), returned.join("\n"));
});
