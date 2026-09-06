import assert from "node:assert/strict";
import test from "node:test";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("f-strings preserve narrowing facts across interpolation", () => {
  // Object interpolation may run a toString hook, but coercion is not an
  // invalidation point: narrowed member facts survive the f-string.
  const objectCoercion = compile(`
type User:
    name: string

type Box:
    user: User?

class Mutator:
    const box: Box

    constructor(box: Box):
        self.box = box

    def toString() -> string:
        self.box.user = null
        return "changed"

def label(box: Box) -> string:
    const mutator = Mutator(box)
    assert box.user != null
    const text = f"{mutator}"
    return box.user.name
`.trimStart());
  assert.equal(objectCoercion.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const primitiveCoercion = compile(`
type User:
    name: string

def label(initial: User?) -> string:
    let user = initial
    assert user != null
    const prefix = f"{1}:{true}:{null}"
    return f"{prefix}:{user.name}"

print(label({name: "Ada"}))
`.trimStart());
  assert.deepEqual(primitiveCoercion.diagnostics, []);
  const execution = executeModule(primitiveCoercion.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1:true:null:Ada\n");
});

test("component props preserve optimistic facts and later reads are guarded", () => {
  // Component invocation is an ordinary call: narrowed member facts survive it,
  // even when the component body assigns to the narrowed location.
  const componentInvocation = compile(`
type User:
    name: string

type Box:
    user: User?

component Clear(box: Box):
    box.user = null
    return <span>cleared</span>

def label(box: Box) -> string:
    assert box.user != null
    const view = <Clear box={box} />
    return box.user.name
`.trimStart());
  assert.equal(componentInvocation.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.deepEqual(componentInvocation.diagnostics, []);

  // Prop expressions are evaluated before children. A call in a prop may make
  // the child fact stale, so the child read carries a runtime guard.
  //
  // The element sits inside a native root because that is a child position: a
  // helper answering markup with a component element standing alone answers an
  // instance rather than a node and is VEL5075 (P2b-5). Nothing this case is
  // about changes -- the prop still runs before the children slot is built.
  const propBeforeChildren = compile(`
type User:
    name: string

type Box:
    user: User?

component Panel(label: string, children: WebNode):
    return <section>{label}{children}</section>

def clear(box: Box) -> string:
    box.user = null
    return "cleared"

def label(box: Box) -> WebNode:
    assert box.user != null
    return <div><Panel label={clear(box)}>{box.user.name}</Panel></div>
`.trimStart());
  assert.deepEqual(propBeforeChildren.diagnostics, []);
  assert.match(propBeforeChildren.code ?? "", /NarrowingError/u);

  const stableLocal = compile(`
type User:
    name: string

type Box:
    user: User?

component Clear(box: Box):
    box.user = null
    return <span>cleared</span>

def label(box: Box) -> string:
    assert box.user != null
    const user = box.user
    const view = <Clear box={box} />
    return user.name
`.trimStart());
  assert.equal(stableLocal.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
  assert.deepEqual(stableLocal.diagnostics, []);
});

test("await preserves narrowing facts across suspension", () => {
  const safe = compile(`
type User:
    name: string

type Box:
    user: User?

async def label(box: Box, pending: Promise<null>) -> string:
    assert box.user != null
    const user = box.user
    await pending
    return user.name
`.trimStart());
  assert.deepEqual(safe.diagnostics, []);

  // Suspension is not an invalidation point: only assignments to the narrowed
  // location (and branch merges carrying such assignments) drop facts.
  const aliasedMember = compile(`
type User:
    name: string

type Box:
    user: User?

async def label(box: Box, pending: Promise<null>) -> string:
    assert box.user != null
    await pending
    return box.user.name
`.trimStart());
  assert.equal(aliasedMember.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);

  const capturedBinding = compile(`
type User:
    name: string

async def label(initial: User?, pending: Promise<null>) -> string:
    let user = initial
    assert user != null
    await pending
    return user.name
`.trimStart());
  assert.equal(capturedBinding.diagnostics.filter((item) => /optional access/u.test(item.message)).length, 0);
});

test("lowering hints use exact spans across nested expressions", () => {
  const result = compile(`
type Profile:
    name: string

class Vault:
    private const profile: Profile? = {name: "Ada"}

    def label() -> string?:
        return self.profile?.name

class Runner:
    def run(value: number) -> number:
        return value

let available: bool? = false
print(not not available)
print(Vault().label())
print(Runner().run(value=3))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarReadPrivateField\(self\.#profile, "profile"\)\?\.name/u);
  assert.doesNotMatch(result.code ?? "", /\?\.#name/u);
  assert.doesNotMatch(result.code ?? "", /new Vault\(\) \?\? null/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "false\nAda\n3\n");
});

test("explicit null comparisons narrow blocks, inline expressions, assertions, and JSX sequences", () => {
  const result = compile(`
type Contact:
    email: string?

def blockLabel(contact: Contact) -> string:
    if contact.email == null:
        return "missing"
    else:
        const address: string = contact.email
        return address

def inverseLabel(contact: Contact) -> string:
    if null != contact.email:
        return contact.email
    return "missing"

def inlineLabel(contact: Contact) -> string:
    return contact.email != null ? contact.email : "missing"

def assertedLabel(contact: Contact) -> string:
    assert contact.email != null else "Email is required"
    const address: string = contact.email
    return address

def preserveZero(value: number?) -> number:
    if value != null:
        return value
    return -1

component ContactView(primary: Contact, secondary: Contact):
    def content() -> WebNode:
        if primary.email != null:
            return <p>{primary.email}</p>
        else if secondary.email == null:
            return <p>Missing</p>
        else:
            return <a href={secondary.email}>{secondary.email}</a>

    return <main>{content()}</main>

const contact: Contact = {email: "ada@example.com"}
print(blockLabel(contact))
print(inverseLabel(contact))
print(inlineLabel(contact))
print(assertedLabel(contact))
print(preserveZero(0))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ada@example.com\nada@example.com\nada@example.com\nada@example.com\n0\n");

  const outside = compile(`
type Contact:
    email: string?

const contact: Contact = {email: null}
if contact.email != null:
    print(contact.email)
const address: string = contact.email
`.trimStart());
  assert.ok(outside.diagnostics.some((item) => /Cannot assign string\? to string/u.test(item.message)));
});

test("stable optional record fields narrow in blocks, expressions, and JSX branches", () => {
  const result = compile(`
type Manager:
    email: string?

type Contact:
    email: string?
    manager: Manager?

type Fault:
    error: Error?

def label(contact: Contact) -> string:
    if contact.manager != null:
        print(contact.manager.email ?? "manager")
    if contact.email != null:
        const address: string = contact.email
        return address
    return "missing"

def inverse(contact: Contact) -> string:
    return contact.email == null ? "missing" : contact.email

def errorMessage(fault: Fault) -> string:
    if fault.error is Error:
        return fault.error.message
    return "null"

component ContactLink(contact: Contact):
    def content() -> WebNode:
        if contact.email != null:
            return <a href={contact.email}>{contact.email}</a>
        return <span>Missing</span>

    return <p>{content()}</p>

const contact: Contact = {email: "", manager: {email: "lead@example.com"}}
print(label(contact))
print(inverse(contact))
print(errorMessage({error: Error("broken")}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "lead@example.com\n\n\nbroken\n");

  const outside = compile(`
type Contact:
    email: string?

const contact: Contact = {email: null}
const address: string = contact.email
if contact.email != null:
    const contact: Contact = {email: null}
    const shadowed: string = contact.email
`.trimStart());
  assert.equal(outside.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 2);
});

test("assignments use declared types and invalidate stale narrowing facts", () => {
  const reassigned = compile(`
type Contact:
    email: string?

let name: string? = "Ada"
let contact: Contact = {email: "ada@example.com"}

if name != null:
    name = null
    print(name == null)

if contact.email != null:
    contact.email = null
    print(contact.email == null)

contact.email = "restored@example.com"
assert contact.email != null
contact = {email: null}
print(contact.email == null)

let count: number? = 1
if count != null:
    count += 1
    const current: number = count
    print(current)
`.trimStart());
  assert.deepEqual(reassigned.diagnostics, []);
  const execution = executeModule(reassigned.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n2\n");

  const stale = compile(`
type Contact:
    email: string?

let name: string? = "Ada"
let contact: Contact = {email: "ada@example.com"}

if name != null:
    name = null
    const staleName: string = name

if contact.email != null:
    contact.email = null
    const staleField: string = contact.email

contact.email = "restored@example.com"
assert contact.email != null
contact = {email: null}
const staleBase: string = contact.email
`.trimStart());
  assert.equal(stale.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 3);

  const rejectedWrites = compile(`
let mutableName: string? = "Ada"
const fixedName: string? = "Lin"

if mutableName != null:
    mutableName = 42
    const stillNarrowed: string = mutableName

if fixedName != null:
    fixedName = null
    const stillFixed: string = fixedName
`.trimStart());
  assert.equal(rejectedWrites.diagnostics.length, 2);
  assert.ok(rejectedWrites.diagnostics.some((item) => /Cannot assign number to string\?/u.test(item.message)));
  assert.ok(rejectedWrites.diagnostics.some((item) => /Cannot assign to const binding 'fixedName'/u.test(item.message)));
});
