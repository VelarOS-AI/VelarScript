import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describeType } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { compile, inspectModule, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("component resources own typed asynchronous loading, retry, errors, and stale completion", () => {
  const result = compile(`
async def loadLabel() -> string:
    return "ready"

component App:
    resource label: string = loadLabel()

    def content() -> WebNode:
        const failure = label.error
        const value = label.value
        if failure != null:
            return <p role="alert">{failure.message}</p>
        if value != null:
            return <p>{value}</p>
        return <p>Loading…</p>

    return <main>{content()}<button type="button" on:click={label.reload}>Reload</button></main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const label = __velarResource\(\(\) => __velarNormalizePromiseValue\(loadLabel\(\)\), __velarComponentScope, "label"\)/u);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "extension:variable:web-resource" && item.name === "label");
  assert.match(symbol?.type ?? "", /value: string\?/u);
  assert.match(symbol?.type ?? "", /reload: \(\) -> Promise<null>/u);

  const execution = executeModule(`${result.code ?? ""}
const pending = [];
const scope = __velarScope("Probe");
const resource = __velarResource(() => new Promise((resolve) => pending.push(resolve)), scope, "probe");
__velarMountScope(scope);
await Promise.resolve();
console.log(resource.loading + ":" + resource.ready + ":" + resource.value);
const latest = resource.reload();
await Promise.resolve();
pending[0](1);
await Promise.resolve();
await Promise.resolve();
console.log(resource.loading + ":" + resource.ready + ":" + resource.value);
pending[1](2);
await latest;
console.log(resource.loading + ":" + resource.ready + ":" + resource.value);
const stale = resource.reload();
await Promise.resolve();
__velarDestroyScope(scope);
pending[2](3);
await stale;
await resource.reload();
console.log(resource.value + ":" + pending.length);

__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message));
const failedScope = __velarScope("FailureView");
const failed = __velarResource(() => Promise.reject(Error("Load failed")), failedScope, "catalog");
__velarMountScope(failedScope);
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(failed.loading + ":" + failed.ready + ":" + failed.error.message);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "true:false:null",
    "true:false:null",
    "false:true:2",
    "2:3",
    "resource:catalog:Load failed",
    "false:true:Load failed",
    "",
  ].join("\n"));
});

test("managed Web async primitives retain captured Promise and Object operations", () => {
  const result = compile(`
async def loadValue() -> number:
    return 1

component App:
    resource value: number = loadValue()

    action save(input: number) -> number:
        return input + 1

    return <main>{value.value}</main>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const NativePromise = globalThis.Promise;
const NativeObject = globalThis.Object;
const NativeError = globalThis.Error;
const nativeApply = Reflect.apply;
const nativeDefine = NativeObject.defineProperty;
const nativeResolve = NativeObject.getOwnPropertyDescriptor(NativePromise, "resolve").value;
const nativeThenDescriptor = NativeObject.getOwnPropertyDescriptor(NativePromise.prototype, "then");
const resolveValue = (value) => nativeApply(nativeResolve, NativePromise, [value]);
let poisoned = 0;
const poison = () => { poisoned += 1; throw new NativeError("poisoned managed async host"); };
nativeDefine(NativePromise, "resolve", { configurable: true, writable: true, value: poison });
nativeDefine(NativePromise, "reject", { configurable: true, writable: true, value: poison });
nativeDefine(NativePromise.prototype, "then", { configurable: true, writable: true, value: poison });
NativeObject.freeze = poison;
NativeObject.defineProperty = poison;
NativeObject.defineProperties = poison;
globalThis.Promise = class PoisonedPromise { constructor() { poison(); } };

const scope = __velarScope("ManagedAsyncProbe");
let loads = 0;
const resource = __velarResource(() => resolveValue(++loads), scope, "catalog");
const action = __velarAction((value) => resolveValue(value + 1), scope, "save");
__velarMountScope(scope);
const tickPromise = __velarTick();
const reloadPromise = resource.reload();
const actionPromise = action(4);
nativeDefine(NativePromise.prototype, "then", nativeThenDescriptor);
await tickPromise;
await reloadPromise;
console.log("resource:" + resource.value + ":" + resource.loading + ":" + resource.ready);
console.log("action:" + await actionPromise);
nativeDefine(NativePromise.prototype, "then", { configurable: true, writable: true, value: poison });
__velarDestroyScope(scope);
const disposedPromise = resource.reload();
const destroyedPromise = action(4);
nativeDefine(NativePromise.prototype, "then", nativeThenDescriptor);
console.log("disposed:" + await disposedPromise);
try { await destroyedPromise; }
catch (error) { console.log("destroyed:" + (error instanceof NativeError) + ":" + error.message); }
console.log("poisoned:" + poisoned);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "resource:2:false:true",
    "action:5",
    "disposed:null",
    "destroyed:true:Action 'save' cannot run after its component is destroyed",
    "poisoned:0",
    "",
  ].join("\n"));
});

test("resources reject synchronous, incompatible, exported, and non-component declarations", () => {
  const outside = compile(`
async def numericLabel() -> number:
    return 1

resource moduleValue = numericLabel()
`.trimStart());
  assert.ok(outside.diagnostics.some((item) => item.code === "VEL3012" && /only valid at component scope; a module-scope async operation belongs in a module 'action'/u.test(item.message)));

  const exported = compile(`
async def numericLabel() -> number:
    return 1

export resource exportedValue = numericLabel()
`.trimStart());
  assert.ok(exported.diagnostics.some((item) => item.code === "VEL2018" && /component-owned and cannot be exported/u.test(item.message)));

  const synchronous = compile(`
def syncLabel() -> string:
    return "ready"

component App:
    resource synchronous = syncLabel()
    return <main>Invalid</main>
`.trimStart());
  assert.ok(synchronous.diagnostics.some((item) => item.code === "VEL4016" && /initializer must return Promise<T>, received string/u.test(item.message)));

  const incompatible = compile(`
async def numericLabel() -> number:
    return 1

component App:
    resource wrong: string = numericLabel()
    return <main>Invalid</main>
`.trimStart());
  assert.ok(incompatible.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
});

test("component actions own pending state, recoverable errors, concurrency, and destruction", () => {
  const result = compile(`
component App:
    state label = "idle"

    action refresh() -> string:
        label = "ready"
        return label

    async def runRefresh():
        try:
            await refresh()
        catch error:
            label = error.message

    computed failure = refresh.error

    return <main><button type="button" disabled={refresh.pending} on:click={runRefresh}>Refresh</button>{failure != null ? <p role="alert">{failure?.message}</p> : null}</main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const refresh = __velarAction\(async \(\) =>/u);
  assert.equal(result.code?.match(/function __velarNormalizeError\(value\)/gu)?.length, 1);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "extension:function:web-action" && item.name === "refresh");
  assert.match(symbol?.type ?? "", /action \(\) -> Promise<string>/u);

  const execution = executeModule(`${result.code ?? ""}
const pending = [];
const scope = __velarScope("ActionProbe");
__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message));
const save = __velarAction((value) => new Promise((resolve, reject) => pending.push({ value, resolve, reject })), scope, "save");
console.log(save.pending + ":" + (save.error?.message ?? "null"));
const older = save("old");
const latest = save("new");
await Promise.resolve();
console.log(save.pending + ":" + (save.error?.message ?? "null"));
pending[1].resolve("new");
console.log((await latest) + ":" + save.pending + ":" + (save.error?.message ?? "null"));
pending[0].reject(Error("Stale failure"));
try { await older; }
catch (error) { console.log(error.message + ":" + save.pending + ":" + (save.error?.message ?? "null")); }
const failed = save("broken");
await Promise.resolve();
pending[2].reject(Error("Save failed"));
try { await failed; }
catch (error) { console.log(error.message + ":" + save.pending + ":" + save.error.message); }
const eventTarget = new EventTarget();
const eventScope = __velarScope("EventProbe");
const ownedFailure = __velarAction(() => Promise.reject(Error("Owned failure")), eventScope, "owned");
__velarOn(eventTarget, "owned", () => ownedFailure, eventScope);
__velarOn(eventTarget, "plain", () => () => Promise.reject(Error("Plain failure")), eventScope);
let eventThenReads = 0;
const fakeThenable = Object.defineProperty({}, "then", { get() { eventThenReads += 1; return () => null; } });
__velarOn(eventTarget, "ordinary", () => () => fakeThenable, eventScope);
eventTarget.dispatchEvent(new Event("owned"));
eventTarget.dispatchEvent(new Event("plain"));
eventTarget.dispatchEvent(new Event("ordinary"));
console.log("event-then:" + eventThenReads);
await new Promise((resolve) => setTimeout(resolve, 0));
const hostile = __velarAction(() => Promise.reject({ toString() { console.log("action conversion hook ran"); throw Error("conversion failure"); } }), scope, "hostile");
try { await hostile(); }
catch (error) { console.log("hostile-catch:" + error.message); }
__velarDestroyScope(eventScope);
__velarDestroyScope(scope);
try { await save("ignored"); }
catch (error) { console.log(error.message + ":" + pending.length); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "false:null",
    "true:null",
    "new:true:null",
    // The superseded older call still reports -- exactly once, through the
    // action phase, carrying the action's name -- while only the newest
    // generation owns the public error field (it stays null here).
    "action:save:Stale failure",
    "Stale failure:false:null",
    "action:save:Save failed",
    "Save failed:false:Save failed",
    "event-then:0",
    "event:plain:Plain failure",
    "action:owned:Owned failure",
    "action:hostile:A non-Error value was thrown by JavaScript",
    "hostile-catch:A non-Error value was thrown by JavaScript",
    "Action 'save' cannot run after its component is destroyed:3",
    "",
  ].join("\n"));
});

test("actions reject nested ownership, bad returns, and unknown state fields", () => {
  const nested = compile(`
def prepare():
    action save():
        return null
`.trimStart());
  assert.ok(nested.diagnostics.some((item) => item.code === "VEL3013" && /only valid at module or component scope/u.test(item.message)));

  const invalid = compile(`
component App:
    action save() -> string:
        return 1
    computed unsupported = save.reload
    return <main>Invalid</main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign number to string/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Action has no member 'reload'/u.test(item.message)));
});

test("module actions own reactive pending state, preserve rejections, and update module state", () => {
  const result = compile(`
state message = "idle"

action deliver(text: string) -> string:
    message = text
    return message

component App:
    return <button type="button" disabled={deliver.pending} on:click={() => deliver("clicked")}>{message}</button>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const deliver = __velarAction\(async \(text\) => \{[\s\S]*?\}, __velarGlobalScope, "deliver"\)/u);
  assert.match(result.code ?? "", /message\.set\(text\)/u);
  const symbol = result.semanticIndex.symbols.find((item) => item.kind === "extension:function:web-action" && item.name === "deliver");
  assert.match(symbol?.type ?? "", /action \(text: string\) -> Promise<string>/u);

  const execution = executeModule(`${result.code ?? ""}
__velarRuntime.errorHandlers.add((report) => console.log(report.phase + ":" + report.detail + ":" + report.error.message + ":" + report.component));
console.log(deliver.pending + ":" + (deliver.error?.message ?? "null") + ":" + message.get());
const call = deliver("ready");
console.log(deliver.pending + ":" + message.get());
console.log((await call) + ":" + deliver.pending + ":" + message.get());
const failing = __velarAction(() => Promise.reject(Error("Module failure")), __velarGlobalScope, "failing");
try { await failing(); }
catch (error) { console.log("caught:" + error.message + ":" + failing.pending + ":" + failing.error.message); }
const late = failing("again");
console.log("still-runnable:" + failing.pending);
try { await late; } catch {}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "false:null:idle",
    "true:idle",
    "ready:false:ready",
    "action:failing:Module failure:",
    "caught:Module failure:false:Module failure",
    "still-runnable:true",
    "action:failing:Module failure:",
    "",
  ].join("\n"));
});

test("exported module actions travel through the module interface without reactive lowering", async () => {
  const result = compile(`
export action save(note: string) -> string:
    return note
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /export const save = __velarAction\(async \(note\) =>/u);
  assert.match(describeType(result.moduleInterface.exports.get("save")!), /^action \(note: string\) -> Promise<string>$/u);
  assert.equal(result.moduleInterface.reactiveExports.has("save"), false);

  const syntaxInterface = inspectModule(`
export action save(note: string) -> string:
    return note
`.trimStart()).moduleInterface;
  assert.match(describeType(syntaxInterface.exports.get("save")!), /^action \(note: string\) -> Promise<string>$/u);

  const directory = await makeTemporaryDirectory("velar-module-actions-");
  const storePath = join(directory, "store.vel");
  const mainPath = join(directory, "main.vel");
  await writeFile(storePath, `
export state status = "idle"

export action ship(item: string) -> string:
    status = item
    return status
`.trimStart(), "utf8");
  await writeFile(mainPath, `
import {ship, status} from "./store.vel"

component App:
    return <button type="button" disabled={ship.pending} on:click={() => ship("crate")}>{status}</button>
`.trimStart(), "utf8");

  const project = await compileProject(mainPath);
  assert.deepEqual(project.failures, []);
  const main = project.modules.find((module) => module.inputPath === mainPath);
  assert.ok(main);
  assert.deepEqual(main.result.diagnostics, []);
  assert.match(main.result.code ?? "", /ship\.pending/u);
  assert.doesNotMatch(main.result.code ?? "", /ship\.get\(\)/u);
  assert.match(main.result.code ?? "", /status\.get\(\)/u);
});
