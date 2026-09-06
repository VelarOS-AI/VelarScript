import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { VELAR_RUNTIME_SCHEMA_VERSION } from "@velarscript/compiler/extension";
import { executeModule } from "../support/execute-module.ts";
import { compile, standardModuleSource } from "../support/compiler-suite.ts";

test("application error and public-config entry points fail closed", () => {
  const appSource = standardModuleSource("velar/app") ?? "";
  const appExecution = executeModule(`${appSource}
const reports = [];
const stop = onError(report => reports.push(report.phase + ":" + report.detail + ":" + report.error.message));
reportError(new Error("expected"), "manual", "test");
stop(); stop();
console.log(reports.join("|"));
let thenReads = 0;
const fakeThenable = Object.defineProperty({}, "then", { get() { thenReads += 1; return () => null; } });
const stopThenable = onError(() => fakeThenable);
reportError(new Error("ordinary result"));
stopThenable();
console.log(thenReads);
const runtimeDescriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.runtime.v1"));
console.log(String(runtimeDescriptor.enumerable) + ":" + String(runtimeDescriptor.configurable) + ":" + String(runtimeDescriptor.writable));
console.log(String(Object.getPrototypeOf(runtimeDescriptor.value) === null) + ":" + String(Object.isExtensible(runtimeDescriptor.value)) + ":" + runtimeDescriptor.value.version);
let coercions = 0;
let getterReads = 0;
const hostile = { toString() { coercions += 1; return "hostile"; } };
const accessor = Object.defineProperty({}, "phase", { enumerable: true, get() { getterReads += 1; return "manual"; } });
for (const operation of [() => reportError("failed"), () => reportError(new Error("failed"), 42), () => reportError(new Error("failed"), "manual", 42)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
for (const operation of [
  () => runtimeDescriptor.value.report(new Error("failed"), { phase: hostile }),
  () => runtimeDescriptor.value.report(new Error("failed"), accessor),
  () => runtimeDescriptor.value.report(new Error("failed"), { unknown: true }),
  () => runtimeDescriptor.value.report(new Error("failed"), { component: "x".repeat(1025) }),
  () => runtimeDescriptor.value.report(new Error("failed"), { unhandled: "yes" }),
]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(coercions + ":" + getterReads);
`);
  assert.equal(appExecution.status, 0, String(appExecution.stderr));
  assert.equal(appExecution.stdout, [
    "manual:test:expected",
    "0",
    "false:false:false",
    `true:false:${VELAR_RUNTIME_SCHEMA_VERSION}`,
    "TypeError", "TypeError", "TypeError",
    "TypeError", "TypeError", "TypeError", "RangeError", "TypeError",
    "0:0",
    "",
  ].join("\n"));

  const forgedRuntimeExecution = executeModule(`
let getterReads = 0;
process.on("exit", () => console.log(getterReads));
Object.defineProperty(globalThis, Symbol.for("velar.runtime.v1"), {
  get() { getterReads += 1; return {}; },
  enumerable: false,
  configurable: false,
});
${appSource}
`);
  assert.notEqual(forgedRuntimeExecution.status, 0);
  assert.equal(forgedRuntimeExecution.stdout, "0\n");
  assert.match(String(forgedRuntimeExecution.stderr), /runtime registry ownership is invalid/u);

  const webResult = compile("component App:\n    return <main>Ready</main>\n");
  assert.deepEqual(webResult.diagnostics, []);
  const appUrl = `data:text/javascript;base64,${Buffer.from(appSource).toString("base64")}`;
  const webUrl = `data:text/javascript;base64,${Buffer.from(webResult.code ?? "").toString("base64")}`;
  const sharedRuntimeExecution = executeModule(`
const app = await import(${JSON.stringify(appUrl)});
const reports = [];
app.onError(report => reports.push(report.phase + ":" + report.error.message));
await import(${JSON.stringify(webUrl)});
globalThis[Symbol.for("velar.runtime.v1")].report(new Error("shared"), { phase: "manual" });
console.log(reports.join("|"));
`);
  assert.equal(sharedRuntimeExecution.status, 0, String(sharedRuntimeExecution.stderr));
  assert.equal(sharedRuntimeExecution.stdout, "manual:shared\n");

  const browserSource = standardModuleSource("velar/browser") ?? "";
  const timerExecution = executeModule(`${browserSource}
let thenReads = 0;
const fakeThenable = Object.defineProperty({}, "then", { get() { thenReads += 1; return () => null; } });
after("0ms", () => fakeThenable);
await new Promise((resolve) => setTimeout(resolve, 10));
console.log(thenReads);
`);
  assert.equal(timerExecution.status, 0, String(timerExecution.stderr));
  assert.equal(timerExecution.stdout, "0\n");

  const configSource = standardModuleSource("velar/config", { base: "/", publicConfig: { apiBase: "/api" } }) ?? "";
  const configExecution = executeModule(`${configSource}
const Config = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
console.log(publicConfig(Config).apiBase, has("apiBase"));
let runtimeTypeReads = 0;
const forged = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { runtimeTypeReads += 1; return value => value; } });
for (const operation of [() => publicConfig({}), () => publicConfig(forged), () => has(42)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(runtimeTypeReads);
`);
  assert.equal(configExecution.status, 0, String(configExecution.stderr));
  assert.equal(configExecution.stdout, "/api true\nTypeError\nTypeError\nTypeError\n0\n");
});

test("velar/app retains its error-report host after module initialization", () => {
  const appSource = standardModuleSource("velar/app") ?? "";
  const execution = executeModule(`${appSource}
const NativeSet = globalThis.Set;
const NativeObject = globalThis.Object;
const NativeNumber = globalThis.Number;
const NativePromise = globalThis.Promise;
const NativeError = globalThis.Error;
const nativeApply = Reflect.apply;
const nativeSetHas = NativeSet.prototype.has;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetDelete = NativeSet.prototype.delete;
const nativeSetSize = NativeObject.getOwnPropertyDescriptor(NativeSet.prototype, "size").get;
const nativeSymbols = NativeObject.getOwnPropertySymbols;
const nativeFreeze = NativeObject.freeze;
const nativeFinite = NativeNumber.isFinite;
const nativeThen = NativePromise.prototype.then;
const nativeIsError = NativeError.isError;
let ambientReads = 0;
const observe = (operation) => function(...arguments_) { ambientReads += 1; return nativeApply(operation, this, arguments_); };
NativeSet.prototype.has = observe(nativeSetHas);
NativeSet.prototype.add = observe(nativeSetAdd);
NativeSet.prototype.delete = observe(nativeSetDelete);
NativeObject.defineProperty(NativeSet.prototype, "size", { configurable: true, get: observe(nativeSetSize) });
NativeObject.getOwnPropertySymbols = observe(nativeSymbols);
NativeObject.freeze = observe(nativeFreeze);
NativeNumber.isFinite = observe(nativeFinite);
NativePromise.prototype.then = observe(nativeThen);
NativeError.isError = observe(nativeIsError);
globalThis.Set = () => { ambientReads += 1; return null; };
globalThis.Object = () => { ambientReads += 1; return null; };
globalThis.Number = () => { ambientReads += 1; return 0; };
globalThis.Promise = () => { ambientReads += 1; return null; };
globalThis.Error = () => { ambientReads += 1; return null; };
globalThis.Reflect = null;
const reports = [];
const stop = onError(report => { reports.push(report.phase + ":" + report.detail + ":" + report.error.message); return NativePromise.resolve(null); });
reportError(new NativeError("expected"), "manual", "captured");
stop();
console.log(reports.join("|"));
console.log(ambientReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "manual:captured:expected\n0\n");
});

test("JSON, storage, and HTTP reject lossy JavaScript serialization", () => {
  const json = standardModuleSource("velar/json") ?? "";
  const jsonExecution = executeModule(`${json}
const shared = { value: 1 };
const cycle = {}; cycle.self = cycle;
const sparse = []; sparse.length = 1;
class Box { constructor(value) { this.value = value; } }
let runtimeTypeReads = 0;
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { runtimeTypeReads += 1; return value => value; } });
console.log(isSerializable({ first: shared, second: shared }));
console.log(isSerializable(new Map([["value", 1]])));
console.log(isSerializable(new Set([1])));
console.log(isSerializable({ omitted() {} }));
console.log(isSerializable({ value: Infinity }));
console.log(isSerializable(cycle));
console.log(isSerializable(sparse));
console.log(isSerializable(new Box(1)));
try { parse("1e400"); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(tryParse("1e400") === null);
console.log(stableStringify(parse('{"__proto__":{"safe":true},"a":1}')));
console.log(stringify({ value: [1, 2] }, 2).replace(/\\s/gu, ""));
for (const value of [{ omitted() {} }, new Map(), { value: Infinity }]) {
  try { stringify(value); console.log("accepted"); } catch (error) { console.log(error.name); }
}
try { stringify({}, 1.5); console.log("accepted"); } catch (error) { console.log(error.name); }
for (const operation of [() => parse("{}", {}), () => tryParse("{}", {}), () => clone({}, {}), () => parse("{}", forgedType)]) {
  try { operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
console.log(runtimeTypeReads);
let jsonValueReads = 0;
const changingRecord = new Proxy({ value: 1 }, {
  get(target, key) { jsonValueReads += 1; return key === "value" ? 2 : Reflect.get(target, key); },
});
console.log(stringify(changingRecord));
console.log(clone(changingRecord).value);
class HostileJsonList extends Array { map() { throw new Error("List map override"); } }
console.log(stableStringify(new HostileJsonList({ z: 1, a: 2 })));
console.log(jsonValueReads);
const originalJsonStringify = JSON.stringify;
let jsonCoercions = 0;
JSON.stringify = () => ({ toString() { jsonCoercions += 1; return "{}"; } });
try { console.log(stringify({ value: 1 })); } catch (error) { console.log(error.name); }
JSON.stringify = originalJsonStringify;
const originalJsonParse = JSON.parse;
let jsonGetterReads = 0;
JSON.parse = () => Object.defineProperty({}, "value", { enumerable: true, get() { jsonGetterReads += 1; return 1; } });
try { console.log(parse('{"value":1}').value); } catch (error) { console.log(error.name); }
JSON.parse = originalJsonParse;
console.log(jsonCoercions + ":" + jsonGetterReads);
`);
  assert.equal(jsonExecution.status, 0, String(jsonExecution.stderr));
  assert.equal(jsonExecution.stdout, [
    "true", "false", "false", "false", "false", "false", "false", "false", "TypeError", "true",
    '{"__proto__":{"safe":true},"a":1}', '{"value":[1,2]}', "TypeError", "TypeError", "TypeError", "RangeError",
    "TypeError", "TypeError", "TypeError", "TypeError", "0",
    '{"value":1}', "1", '[{"a":2,"z":1}]', "0", '{"value":1}', "1", "0:0", "",
  ].join("\n"));

  const storage = standardModuleSource("velar/storage") ?? "";
const storageExecution = executeModule(`
const data = new Map();
let storageReads = 0;
let storageMode = "normal";
let hostLengthReads = 0;
let hostileStorageKey = null;
class FakeStorage {
  get length() {
    if (storageMode === "single") { hostLengthReads += 1; return 1; }
    if (storageMode === "hostile") return 1;
    storageReads += 1;
    return data.size;
  }
  key(index) {
    if (storageMode === "single") return index === 0 ? "safe" : null;
    if (storageMode === "hostile") return hostileStorageKey;
    storageReads += 1;
    return [...data.keys()][index] ?? null;
  }
  getItem(key) { storageReads += 1; return data.get(key) ?? null; }
  setItem(key, value) { data.set(key, value); }
  removeItem(key) { data.delete(key); }
}
globalThis.Storage = FakeStorage;
globalThis.localStorage = new FakeStorage();
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = () => true;
${storage}
let runtimeTypeReads = 0;
const forgedType = Object.defineProperty({ is() { return true; } }, "parse", { enumerable: true, get() { runtimeTypeReads += 1; return value => value; } });
const Item = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
storage.set("valid", { value: 1 });
console.log(globalThis.localStorage.getItem("valid"));
const beforeLarge = storageReads;
try { storage.set("too-large", { value: "游戏" }, 5); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!data.has("too-large"), storageReads === beforeLarge);
storage.set("budgeted", { value: "游戏" }, 64);
console.log(storage.get("budgeted", Item, "fallback", 5));
const beforeBudget = storageReads;
try { storage.get("valid", Item, null, 0); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(storageReads === beforeBudget);
let webJsonValueReads = 0;
const changingRecord = new Proxy({ value: 1 }, {
  get(target, key) { webJsonValueReads += 1; return key === "value" ? 2 : Reflect.get(target, key); },
});
storage.set("snapshot", changingRecord);
console.log(data.get("snapshot"), webJsonValueReads);
let webJsonGetterReads = 0;
const accessorRecord = Object.defineProperty({}, "value", { enumerable: true, get() { webJsonGetterReads += 1; return 1; } });
try { storage.set("accessor", accessorRecord); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!data.has("accessor"), webJsonGetterReads);
const beforeInvalid = storageReads;
try { storage.set("invalid", new Map([["value", 1]])); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!data.has("invalid"));
try { storage.get("missing", {}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.get("missing", forgedType); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.watch("missing", {}, () => null); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.set(42, {value: 1}); console.log("accepted"); } catch (error) { console.log(error.name); }
try { storage.scope(42); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(runtimeTypeReads, storageReads === beforeInvalid);
storageMode = "single";
console.log(storage.keys().join(","), hostLengthReads);
let hostileStorageKeyReads = 0;
hostileStorageKey = Object.defineProperty({}, "startsWith", { get() { hostileStorageKeyReads += 1; throw new Error("unexpected key method read"); } });
storageMode = "hostile";
try { storage.keys(); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(hostileStorageKeyReads);
try { storage.scope("a".repeat(4095)).scope("b"); console.log("accepted"); } catch (error) { console.log(error.name); }
`);
  assert.equal(storageExecution.status, 0, String(storageExecution.stderr));
  assert.equal(storageExecution.stdout, '{"value":1}\nRangeError\ntrue true\nfallback\nRangeError\ntrue\n{"value":1} 0\nTypeError\ntrue 0\nTypeError\ntrue\nTypeError\nTypeError\nTypeError\nTypeError\nTypeError\n0 true\nsafe 1\nTypeError\n0\nRangeError\n');

  const http = standardModuleSource("velar/http") ?? "";
  const httpExecution = executeModule(`globalThis.fetch = async () => new Response("1e400", { status: 200, headers: { "content-type": "application/json" } });
${http}
try { await http.post("https://example.test", { body: new Map([["value", 1]]) }).response(); console.log("accepted"); }
catch (error) { console.log(error.name); }
try { await http.get("https://example.test").json(); console.log("accepted"); }
catch (error) { console.log(error.name); }
`);
  assert.equal(httpExecution.status, 0, String(httpExecution.stderr));
  assert.equal(httpExecution.stdout, "TypeError\nTypeError\n");

});

test("IndexedDB waits for transaction commit and retries a failed open", () => {
  const storage = standardModuleSource("velar/storage") ?? "";
  const execution = executeModule(`
const stored = new Map();
let openAttempts = 0;
let transactionCount = 0;
let hostileKeyCalls = 0;
let failNextTransaction = false;
class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) { let values = this.listeners.get(name); if (!values) { values = []; this.listeners.set(name, values); } values.push(callback); }
  removeEventListener(name, callback) { const values = this.listeners.get(name) ?? []; this.listeners.set(name, values.filter(value => value !== callback)); }
  emit(name) { for (const callback of this.listeners.get(name) ?? []) callback({ type: name }); }
}
globalThis.EventTarget = FakeEventTarget;
class HostileKeys extends Array {
  [Symbol.iterator]() { hostileKeyCalls += 1; throw new Error("iterator override"); }
  some() { hostileKeyCalls += 1; throw new Error("some override"); }
  slice() { hostileKeyCalls += 1; throw new Error("slice override"); }
  sort() { hostileKeyCalls += 1; throw new Error("sort override"); }
}
const outcomes = ["abort", "complete", "complete", "complete"];
const databaseHandle = new FakeEventTarget();
databaseHandle.objectStoreNames = { contains() { return true; } };
databaseHandle.close = () => {};
databaseHandle.transaction = function() {
    if (failNextTransaction) { failNextTransaction = false; throw new Error("connection closed"); }
    transactionCount += 1;
    const outcome = outcomes.shift() || "complete";
    const transaction = new FakeEventTarget();
    transaction.error = new Error("transaction aborted");
    const request = (value, commit = () => {}) => {
      const result = new FakeEventTarget();
      queueMicrotask(() => {
        result.result = value;
        result.emit("success");
        queueMicrotask(() => {
          if (outcome === "abort") transaction.emit("abort");
          else { commit(); transaction.emit("complete"); }
        });
      });
      return result;
    };
    transaction.objectStore = () => ({
      put(value, key) { return request(undefined, () => stored.set(key, value)); },
      get(key) { return request(stored.get(key)); },
      getKey(key) { return request(stored.has(key) ? key : undefined); },
      getAllKeys() { return request(new HostileKeys("z", "a")); },
      delete(key) { return request(undefined, () => stored.delete(key)); },
      clear() { return request(undefined, () => stored.clear()); },
    });
    return transaction;
};
globalThis.indexedDB = {
  open() {
    openAttempts += 1;
    const request = new FakeEventTarget();
    queueMicrotask(() => {
      if (openAttempts === 1) { request.error = new Error("open failed"); request.emit("error"); }
      else { request.result = databaseHandle; request.emit("success"); }
    });
    return request;
  },
};
${storage}
const store = database("app");
try { await store.has("item"); console.log("accepted"); } catch (error) { console.log(error.message); }
try { await store.set("item", { value: 1 }); console.log("accepted"); } catch (error) { console.log(error.message); }
await store.set("item", { value: 2 });
const Item = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
console.log((await store.get("item", Item)).value);
const beforeLarge = transactionCount;
try { await store.set("too-large", { value: "游戏" }, 5); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(!stored.has("too-large"), transactionCount === beforeLarge);
stored.set("budgeted", '{"value":"游戏"}');
console.log(await store.get("budgeted", Item, "fallback", 5));
const beforeBudget = transactionCount;
try { await store.get("item", Item, null, 0); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(transactionCount === beforeBudget);
const keys = await store.keys();
keys.push("m");
console.log(keys.join(","));
console.log(hostileKeyCalls + ":" + Object.isFrozen(keys));
stored.set("foreign", new Map([["value", 4]]));
console.log(await store.get("foreign", Item, "fallback"));
const originalJsonParse = JSON.parse;
let patchedParseCalls = 0;
JSON.parse = () => { patchedParseCalls += 1; return { tampered: true }; };
await store.set("native-json", { value: 3 });
JSON.parse = originalJsonParse;
console.log(originalJsonParse(stored.get("native-json")).value + ":" + patchedParseCalls);
failNextTransaction = true;
try { await store.has("item"); console.log("accepted"); } catch (error) { console.log(error.message); }
console.log(await store.has("item"), openAttempts);
const beforeInvalid = transactionCount;
try { await store.set(42, { value: 3 }); console.log("accepted"); } catch (error) { console.log(error.name, transactionCount === beforeInvalid); }
console.log(openAttempts);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "open failed\ntransaction aborted\n2\nRangeError\ntrue true\nfallback\nRangeError\ntrue\na,z,m\n0:false\nfallback\n3:0\nconnection closed\ntrue 3\nTypeError true\n3\n");
});

test("storage and IndexedDB retain captured WebIDL operations after global, prototype, and instance poisoning", () => {
  const source = standardModuleSource("velar/storage") ?? "";
  const execution = executeModule(`
const calls = [];
let poisoned = 0;
let poisonNewInstances = false;
const eventListeners = new WeakMap();
const requestState = new WeakMap();
const transactionState = new WeakMap();
const listState = new WeakMap();
class FakeEventTarget {
  constructor() {
    eventListeners.set(this, new Map());
    if (poisonNewInstances) {
      this.addEventListener = () => { poisoned += 1; };
      this.removeEventListener = () => { poisoned += 1; };
    }
  }
  addEventListener(name, callback) { let values = eventListeners.get(this).get(name); if (!values) { values = []; eventListeners.get(this).set(name, values); } values.push(callback); }
  removeEventListener(name, callback) { const values = eventListeners.get(this).get(name) ?? []; eventListeners.get(this).set(name, values.filter(value => value !== callback)); }
  emit(name) { for (const callback of eventListeners.get(this).get(name) ?? []) callback({ type: name }); }
}
class FakeStorage {
  constructor() { this.data = new Map(); }
  get length() { calls.push("storage:length"); return this.data.size; }
  key(index) { calls.push("storage:key"); return [...this.data.keys()][index] ?? null; }
  getItem(key) { calls.push("storage:get"); return this.data.get(key) ?? null; }
  setItem(key, value) { calls.push("storage:set"); this.data.set(key, value); }
  removeItem(key) { calls.push("storage:remove"); this.data.delete(key); }
}
class FakeRequest extends FakeEventTarget {
  constructor() {
    super();
    requestState.set(this, { result: undefined, error: null });
    if (poisonNewInstances) {
      Object.defineProperty(this, "result", { get() { poisoned += 1; return "poisoned"; } });
      Object.defineProperty(this, "error", { get() { poisoned += 1; return new Error("poisoned"); } });
    }
  }
  get result() { return requestState.get(this).result; }
  get error() { return requestState.get(this).error; }
}
class FakeDomStringList {
  constructor() { listState.set(this, false); }
  contains() { calls.push("idb:contains"); return listState.get(this); }
}
class FakeObjectStore {
  constructor(transaction) {
    this.transaction = transaction;
    if (poisonNewInstances) this.getKey = () => { poisoned += 1; };
  }
  getKey(key) {
    calls.push("idb:getKey");
    const request = new FakeRequest();
    queueMicrotask(() => {
      requestState.get(request).result = key;
      request.emit("success");
      queueMicrotask(() => this.transaction.emit("complete"));
    });
    return request;
  }
  get() { throw new Error("unused"); }
  put() { throw new Error("unused"); }
  getAllKeys() { throw new Error("unused"); }
  delete() { throw new Error("unused"); }
  clear() { throw new Error("unused"); }
}
class FakeTransaction extends FakeEventTarget {
  constructor() {
    super();
    transactionState.set(this, { error: null, store: new FakeObjectStore(this) });
    if (poisonNewInstances) {
      this.objectStore = () => { poisoned += 1; };
      Object.defineProperty(this, "error", { get() { poisoned += 1; return new Error("poisoned"); } });
    }
  }
  get error() { return transactionState.get(this).error; }
  objectStore() { calls.push("idb:objectStore"); return transactionState.get(this).store; }
  abort() { calls.push("idb:abort"); }
}
class FakeDatabase extends FakeEventTarget {
  constructor() { super(); this.names = new FakeDomStringList(); }
  get objectStoreNames() { calls.push("idb:names"); return this.names; }
  createObjectStore() { calls.push("idb:create"); listState.set(this.names, true); }
  transaction() { calls.push("idb:transaction"); return new FakeTransaction(); }
  close() { calls.push("idb:close"); }
}
const databaseValue = new FakeDatabase();
class FakeFactory {
  open() {
    calls.push("idb:open");
    const request = new FakeRequest();
    queueMicrotask(() => {
      requestState.get(request).result = databaseValue;
      request.emit("upgradeneeded");
      request.emit("success");
    });
    return request;
  }
}
globalThis.EventTarget = FakeEventTarget;
globalThis.Storage = FakeStorage;
globalThis.IDBFactory = FakeFactory;
globalThis.IDBRequest = FakeRequest;
globalThis.IDBDatabase = FakeDatabase;
globalThis.IDBTransaction = FakeTransaction;
globalThis.IDBObjectStore = FakeObjectStore;
globalThis.DOMStringList = FakeDomStringList;
const storageValue = new FakeStorage();
const factoryValue = new FakeFactory();
globalThis.localStorage = storageValue;
globalThis.indexedDB = factoryValue;
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.dispatchEvent = event => { calls.push("dispatch:" + event.type); return true; };
${source}
poisonNewInstances = true;
Number.isSafeInteger = () => { poisoned += 1; return true; };
String.prototype.charCodeAt = () => { poisoned += 1; return 0; };
globalThis.localStorage = {};
globalThis.indexedDB = {};
globalThis.dispatchEvent = () => { poisoned += 1; };
for (const [prototype, names] of [
  [FakeStorage.prototype, ["key", "getItem", "setItem", "removeItem"]],
  [FakeFactory.prototype, ["open"]],
  [FakeDomStringList.prototype, ["contains"]],
  [FakeDatabase.prototype, ["createObjectStore", "transaction", "close"]],
  [FakeTransaction.prototype, ["objectStore", "abort"]],
  [FakeObjectStore.prototype, ["getKey"]],
]) for (const name of names) prototype[name] = () => { poisoned += 1; };
for (const [target, name] of [[storageValue, "length"], [databaseValue, "objectStoreNames"]]) {
  Object.defineProperty(target, name, { configurable: true, get() { poisoned += 1; return null; } });
}
storageValue.getItem = () => { poisoned += 1; };
storageValue.setItem = () => { poisoned += 1; };
factoryValue.open = () => { poisoned += 1; };
databaseValue.transaction = () => { poisoned += 1; };
const Item = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
storage.set("item", { value: 1 });
console.log(storage.get("item", Item).value + ":" + storage.keys().join(","));
console.log(await database("app").has("item"));
console.log(poisoned);
console.log(calls.join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(String(execution.stdout), /^1:item\ntrue\n0\n/u);
  assert.match(String(execution.stdout), /storage:get,storage:set,dispatch:velar-storage-change,storage:get,storage:length,storage:key/u);
  assert.match(String(execution.stdout), /idb:open,idb:names,idb:contains,idb:create,idb:transaction,idb:objectStore,idb:getKey/u);
});
