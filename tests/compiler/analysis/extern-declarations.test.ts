import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("extern-declared imports are presence-checked at module initialization", async () => {
  // The exact W-22 shape: the declaration names an export the real module
  // lacks (process.on is an EventEmitter prototype method, not a module
  // export). The compile stays green, and the bridge refuses at load with a
  // velar-voiced error at the import site instead of binding undefined and
  // failing far from the cause.
  const missingSource = `
extern module "node:process":
    export def on(event: string) -> null

import js {on} from "node:process"

print("reached")
`.trimStart();
  const missing = compile(missingSource);
  assert.deepEqual(missing.diagnostics, []);
  // Charter section 12: "an `export let` remains a live ES-module value: the
  // exporting module can reassign it between reads". The name therefore binds
  // through a real `import`, and the presence probe runs beside it as its own
  // statement. Reading the namespace into a `const` froze the binding at its
  // initial value, which is neither what `import js * as` nor `unsafe js` nor
  // JavaScript itself does with the same declaration.
  assert.match(missing.code ?? "", /^import \{ on \} from "node:process";$/mu);
  assert.match(missing.code ?? "", /^import \* as __velarExternModule\d+ from "node:process";$/mu);
  assert.match(missing.code ?? "", /^__velarExternExport\(__velarExternModule\d+, "on", "node:process"\);$/mu);
  assert.doesNotMatch(missing.code ?? "", /const on = __velarExternExport\(/u);
  const failed = executeModule(missing.code ?? "");
  assert.notEqual(failed.status, 0);
  // Updated with the live-binding emission above: the name binds through a
  // real `import`, so a host that link-checks named exports refuses before any
  // statement runs and reports in its own voice, naming the module and the
  // export. Where the name links to `undefined` instead — bundled CommonJS
  // interop — the probe beside it is what reports, in the velar voice. Both
  // refusals are at load and name the export, which is what W-22 promises.
  assert.match(String(failed.stderr), /does not provide an export named 'on'|Extern module 'node:process' declares 'on', but the JavaScript module has no such export; prototype methods and instance members belong on a declared class or singleton const, not module exports/u);
  assert.doesNotMatch(String(failed.stdout), /reached/u);

  // Green path: a declared export that exists imports and runs unchanged.
  const valid = compile(`
extern module "node:process":
    export const version: string

import js {version} from "node:process"

print(version)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const validExecution = executeModule(valid.code ?? "");
  assert.equal(validExecution.status, 0, String(validExecution.stderr));
  assert.match(String(validExecution.stdout), /^v\d+/u);

  // A declared export that legitimately holds undefined stays importable:
  // the boundary is membership in the module namespace, not the bound value.
  const undefinedValue = compile(`
extern module "data:text/javascript,export const gap = undefined":
    export const gap: unknown

import js {gap} from "data:text/javascript,export const gap = undefined"

print("loaded")
`.trimStart());
  assert.deepEqual(undefinedValue.diagnostics, []);
  const undefinedExecution = executeModule(undefinedValue.code ?? "");
  assert.equal(undefinedExecution.status, 0, String(undefinedExecution.stderr));
  assert.equal(undefinedExecution.stdout, "loaded\n");

  // Default-export path: a module without a default export is refused with
  // the default wording, and a genuine default loads through the same bridge.
  const missingDefault = compile(`
extern module "data:text/javascript,export const value = 1":
    export const default: number

import js banner from "data:text/javascript,export const value = 1"

print(banner)
`.trimStart());
  assert.deepEqual(missingDefault.diagnostics, []);
  const defaultExecution = executeModule(missingDefault.code ?? "");
  assert.notEqual(defaultExecution.status, 0);
  // Same live-binding consequence as the named case above: the host link step
  // refuses the absent `default` first and in its own voice; the velar wording
  // reports where a name links to `undefined` instead of failing to link.
  assert.match(String(defaultExecution.stderr), /does not provide an export named 'default'|Extern module 'data:text\/javascript,export const value = 1' declares 'default', but the JavaScript module has no default export; declare the module's real named exports instead/u);

  const presentDefault = compile(`
extern module "data:text/javascript,export default 7":
    export const default: number

import js seven from "data:text/javascript,export default 7"

print(seven)
`.trimStart());
  assert.deepEqual(presentDefault.diagnostics, []);
  const presentExecution = executeModule(presentDefault.code ?? "");
  assert.equal(presentExecution.status, 0, String(presentExecution.stderr));
  assert.equal(presentExecution.stdout, "7\n");

  // The checked bridge keeps the foreign binding live: a declared name whose
  // JavaScript module reassigns it is read again at every use, exactly as the
  // namespace and `unsafe js` spellings already were.
  const liveSource = "data:text/javascript,export let counter = 1; export function bump() { counter = 2 }";
  const live = compile(`
extern module ${JSON.stringify(liveSource)}:
    export const counter: number
    export def bump() -> null

import js {counter, bump} from ${JSON.stringify(liveSource)}

print(counter)
bump()
print(counter)
`.trimStart());
  assert.deepEqual(live.diagnostics, []);
  assert.match(live.code ?? "", /^__velarExternExport\(__velarExternModule\d+, "counter", /mu);
  const liveExecution = executeModule(live.code ?? "");
  assert.equal(liveExecution.status, 0, String(liveExecution.stderr));
  assert.equal(liveExecution.stdout, "1\n2\n");

  // velar run reports the same refusal for a project entry.
  const directory = await makeTemporaryDirectory("velar-extern-presence-");
  const entryPath = join(directory, "main.vel");
  await writeFile(entryPath, missingSource, "utf8");
  const ran = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "run", entryPath], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(ran.status, 1, ran.stdout);
  assert.match(ran.stderr, /does not provide an export named 'on'|Extern module 'node:process' declares 'on', but the JavaScript module has no such export/u);
});

test("safe JavaScript classes keep constructors, members, aliases, and nominal package identity", () => {
  const valid = compile(`
extern module "sdk-a":
    export class BaseClient:
        const id: string
        constructor(id: string)
        static const family: string
        def label() -> string

    export class Client extends BaseClient:
        const baseUrl: string
        let timeoutMs: number
        constructor(id: string, baseUrl: string, timeoutMs: number = 1000)
        static const version: string
        def request(path: string) -> Promise<string>
        static def from(baseUrl: string) -> Client

import js {BaseClient, Client as Remote} from "sdk-a"
import js * as sdk from "sdk-a"
type Session:
    client: Remote
const direct: Remote = Remote("id", "/api")
const base: BaseClient = direct
const inheritedId: string = direct.id
const family: string = Remote.family
direct.timeoutMs = 2000
const connected: Remote = Remote.from("/next")
const namespaced = sdk.Client("id", "/namespace", 500)
const pending: Promise<string> = connected.request("/status")
const version: string = Remote.version
const session = Session.parse({client: direct})
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /new Remote\(__velarHostRaw\("id"\), __velarHostRaw\("\/api"\)\)/u);
  assert.match(valid.code ?? "", /new sdk\.Client\(__velarHostRaw\("id"\), __velarHostRaw\("\/namespace"\), __velarHostRaw\(500\)\)/u);
  assert.match(valid.code ?? "", /__velarValidationIsInstance\([^,]+, Remote\)/u);
  assert.ok(valid.semanticIndex.expressions.some((expression) => expression.memberName === "request" && expression.type === "(path: string) -> Promise<string>"));

  const invalid = compile(`
extern module "sdk-a":
    export class Client:
        const baseUrl: string
        constructor(baseUrl: string)
        static const version: string
        def request(path: string) -> Promise<string>

extern module "sdk-b":
    export class Client:
        constructor(baseUrl: string)
        pass

import js {Client as FirstClient} from "sdk-a"
import js {Client as SecondClient} from "sdk-b"
const first = FirstClient("/api")
const second: SecondClient = first
first.baseUrl = "/changed"
FirstClient.version = "2"
first.request(42)
SecondClient()
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign FirstClient to SecondClient/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to read-only member 'baseUrl'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to read-only static member 'version'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Expected 1 argument but received 0/u.test(item.message)));

  const invalidInheritance = compile(`
extern module "bad-sdk":
    export class Base:
        def label(value: string) -> string

    export class Child extends Base:
        def label(value: number) -> string
`.trimStart());
  assert.ok(invalidInheritance.diagnostics.some((item) => /Extern override 'label' must keep the base method signature/u.test(item.message)));

  const removedHeaderConstructor = compile(`
extern module "old-sdk":
    export class Client(const id: string):
        pass
`.trimStart());
  assert.ok(removedHeaderConstructor.diagnostics.some((item) => item.code === "VEL2022" && /constructor in the class body/u.test(item.message)));
});

test("extern class members reject readonly self contracts", () => {
  const result = compileCore(`
extern module "host-sdk":
    export class Client:
        constructor()
        readonly get label() -> string
        readonly def inspect() -> string
        def refresh() -> null
`.trimStart());
  // CLS-I5: a getter and a method are executable, so `const` is advice they
  // cannot take; the modifier belongs on the data they carry.
  assert.deepEqual(result.diagnostics.map((item) => item.message), [
    "'readonly' is a data-type modifier, not a class member modifier; a method, getter, or constructor is executable and has no readonly contract — mark the data it works with, as in 'readonly List<number>'",
    "'readonly' is a data-type modifier, not a class member modifier; a method, getter, or constructor is executable and has no readonly contract — mark the data it works with, as in 'readonly List<number>'",
  ]);
});

test("extern class identities unify across extern module blocks", () => {
  // The W-21 shape: node:stream/consumers consumes node:http's request class.
  // The reference from another block resolves to the declaring source's
  // nominal identity instead of freezing into a structural named type.
  const shared = compile(`
extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

    export def createServer(handler: (request: IncomingMessage) -> null) -> unknown

extern module "node:stream/consumers":
    export async def text(stream: IncomingMessage) -> string

import js {IncomingMessage, createServer} from "node:http"
import js {text} from "node:stream/consumers"

async def readBody(request: IncomingMessage) -> string:
    return await text(request)

const server = createServer(request => print(request.url))
print(server)
`.trimStart());
  assert.deepEqual(shared.diagnostics, []);

  // An 'import js' alias carries the same identity under its local name.
  const aliased = compile(`
extern module "node:http":
    export class IncomingMessage:
        const url: string
        pass

extern module "node:stream/consumers":
    export async def text(stream: Message) -> string

import js {IncomingMessage as Message} from "node:http"
import js {text} from "node:stream/consumers"

async def readBody(request: Message) -> string:
    return await text(request)
`.trimStart());
  assert.deepEqual(aliased.diagnostics, []);

  // A bare name declared by more than one extern module stays ambiguous and
  // says so instead of freezing silently or picking a winner.
  const ambiguous = compile(`
extern module "sdk-a":
    export class Client:
        pass

extern module "sdk-b":
    export class Client:
        pass

extern module "sdk-c":
    export def connect(client: Client) -> null
`.trimStart());
  assert.ok(ambiguous.diagnostics.some((item) =>
    /Extern class 'Client' is declared by more than one extern module \("sdk-a", "sdk-b"\); import the intended class with 'import js' to name it here/u.test(item.message)));
});
