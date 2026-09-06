import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { VELAR_RUNTIME_SCHEMA_VERSION } from "@velarscript/compiler/extension";
import { webModuleSource } from "../../packages/web/src/compiler.ts";
import { executeModule } from "../support/execute-module.ts";
import { standaloneRealtimeSource, standardModuleSource } from "../support/compiler-suite.ts";

test("velar/web creates bounded application-local DOM IDs without requiring cryptographic UUIDs", async () => {
  const source = webModuleSource("velar/web") ?? "";
  const url = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
  const runtime = await import(url) as { domId(prefix?: string): string };
  assert.equal(runtime.domId(), "velar-1");
  assert.equal(runtime.domId("dialog-title"), "dialog-title-2");
  assert.throws(() => runtime.domId("bad prefix"), /DOM ID prefixes/u);
  assert.throws(() => runtime.domId("x".repeat(65)), /cannot exceed 64/u);
});

test("browser timers are cancellable, non-overlapping, and report failures", async () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`${source}
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
let afterCount = 0;
let cancelledCount = 0;
let everyCount = 0;
const cancelAfter = after("20ms", () => { cancelledCount += 1; });
cancelAfter();
cancelAfter();
after("5ms", () => { afterCount += 1; });
let activeWorkers = 0;
let maxWorkers = 0;
const stopEvery = every("5ms", async () => {
  activeWorkers += 1;
  maxWorkers = Math.max(maxWorkers, activeWorkers);
  await new Promise((resolve) => setTimeout(resolve, 12));
  everyCount += 1;
  activeWorkers -= 1;
});
after("1ms", () => { throw new Error("sync failure"); });
after("1ms", async () => { throw new Error("async failure"); });
await new Promise((resolve) => setTimeout(resolve, 48));
stopEvery();
await new Promise((resolve) => setTimeout(resolve, 20));
const stoppedCount = everyCount;
await new Promise((resolve) => setTimeout(resolve, 24));
console.log([afterCount, cancelledCount, everyCount >= 2, everyCount === stoppedCount, maxWorkers].join(":"));
console.log(reports.sort().join("|"));
try { every("0ms", () => null); } catch (error) { console.log(error.name); }
try { after("-1ms", () => null); } catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1:0:true:true:1\ntimer:after:async failure|timer:after:sync failure\nRangeError\nRangeError\n");
});

test("owned browser, storage, and realtime callbacks report sync and async failures", () => {
  const browserSource = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
const windowListeners = new Map();
globalThis.addEventListener = (name, callback) => windowListeners.set(name, callback);
globalThis.removeEventListener = (name, callback) => { if (windowListeners.get(name) === callback) windowListeners.delete(name); };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
const documentListeners = new Map();
globalThis.document = { visibilityState: "visible", addEventListener(name, callback) { documentListeners.set(name, callback); }, removeEventListener(name, callback) { if (documentListeners.get(name) === callback) documentListeners.delete(name); } };
const mediaListeners = new Map();
globalThis.matchMedia = () => ({ matches: true, addEventListener(name, callback) { mediaListeners.set(name, callback); }, removeEventListener(name, callback) { if (mediaListeners.get(name) === callback) mediaListeners.delete(name); } });
${browserSource}
const stopMedia = watchMedia("screen", () => { throw new Error("media failed"); });
const stopOnline = watchOnline(async () => { throw new Error("online failed"); });
const stopVisibility = watchVisibility(() => { throw "visibility failed"; });
mediaListeners.get("change")({ matches: true });
windowListeners.get("online")();
documentListeners.get("visibilitychange")();
await new Promise((resolve) => setTimeout(resolve, 0));
stopMedia(); stopOnline(); stopVisibility();
console.log(reports.sort().join("|"));
console.log([mediaListeners.size, windowListeners.size, documentListeners.size].join(":"));
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "observer:media:media failed|observer:online:online failed|observer:visibility:visibility failed\n0:0:0\n");

  const storageSource = standardModuleSource("velar/storage") ?? "";
  const storageExecution = executeModule(`
const reports = [];
// D90 fr-5: storage writes serialize through the JSON bridge, which now
// refuses a registry from another generation instead of quietly reading past
// it. The reporting stub therefore has to answer for this generation, as the
// Router stub below does for the List guard; the remaining registry stubs in
// this file never reach a version-checked site.
globalThis[Symbol.for("velar.runtime.v1")] = { version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)}, toRaw: (value) => value, report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
const data = new Map(), listeners = new Map();
globalThis.localStorage = { get length() { return data.size; }, key(index) { return [...data.keys()][index] ?? null; }, getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); }, removeItem(key) { data.delete(key); } };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
globalThis.addEventListener = (name, callback) => { const values = listeners.get(name) ?? []; values.push(callback); listeners.set(name, values); };
globalThis.removeEventListener = (name, callback) => { const values = (listeners.get(name) ?? []).filter(value => value !== callback); if (values.length === 0) listeners.delete(name); else listeners.set(name, values); };
globalThis.dispatchEvent = (event) => { for (const callback of listeners.get(event.type) ?? []) callback(event); return true; };
${storageSource}
const Item = __velarRegisterRuntimeType(Object.freeze({ is() { return true; }, parse(value) { return value; } }));
const beforeInvalidWatch = listeners.size;
try { storage.watch("invalid", Item, () => null, 0); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(listeners.size === beforeInvalidWatch);
const stop = storage.watch("item", Item, async () => { throw new Error("storage failed"); });
const observed = [];
const stopBudget = storage.watch("large", Item, (next, previous) => observed.push([next, previous]), 5);
storage.set("item", { value: 1 });
storage.set("large", { value: "游戏" }, 64);
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(observed.length, observed[0][0] === null, observed[0][1] === null);
let storageEventGetterReads = 0;
const hostileChange = Object.defineProperty({}, "detail", { enumerable: true, get() { storageEventGetterReads += 1; return {}; } });
const hostileDetail = Object.defineProperty({ areaName: "local", newValue: null, oldValue: null }, "key", { enumerable: true, get() { storageEventGetterReads += 1; return "item"; } });
const hostileStored = Object.defineProperties({ newValue: null, oldValue: null }, {
  storageArea: { enumerable: true, get() { storageEventGetterReads += 1; return globalThis.localStorage; } },
  key: { enumerable: true, get() { storageEventGetterReads += 1; return "item"; } },
});
for (const callback of listeners.get("velar-storage-change")) callback(hostileChange);
for (const callback of listeners.get("velar-storage-change")) callback({ detail: hostileDetail });
for (const callback of listeners.get("storage")) callback(hostileStored);
console.log(storageEventGetterReads);
stop(); stopBudget();
storage.set("item", { value: 2 });
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(reports.join("|"));
console.log(listeners.size);
`);
  assert.equal(storageExecution.status, 0, String(storageExecution.stderr));
  assert.equal(storageExecution.stdout, "RangeError\ntrue\n1 true true\n0\nstorage:watch:storage failed\n0\n");

  const realtimeSource = standaloneRealtimeSource();
  const realtimeExecution = executeModule(`
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); } };
class FakeEventSource {
  static last;
  constructor(url) { this.url = url; this.readyState = 1; this.listeners = new Map(); FakeEventSource.last = this; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  close() { this.readyState = 2; }
  emit(name, event = {}) { this.listeners.get(name)?.(event); }
}
globalThis.EventSource = FakeEventSource;
${realtimeSource}
eventStream("https://example.test/events", { message: () => { throw new Error("stream failed"); } });
FakeEventSource.last.emit("message", { data: "hello", lastEventId: "1" });
await new Promise((resolve) => setTimeout(resolve, 0));
try { eventStream("https://example.test/events", { message: "invalid" }); console.log("accepted"); } catch (error) { console.log(error.name); }
console.log(reports.sort().join("|"));
`);
  assert.equal(realtimeExecution.status, 0, String(realtimeExecution.stderr));
  assert.equal(realtimeExecution.stdout, "TypeError\nrealtime:event-stream:message:stream failed\n");
});

test("lazy components recover from post-load construction and fallback failures", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
class FakeNode {
  constructor(tag = "node") { this.tag = tag; this.style = {}; this.children = []; this.textContent = ""; }
  append(value) { this.children.push(value); }
  replaceChildren(...values) { this.children = values; }
  setAttribute(name, value) { this[name] = value; }
  insertBefore(value) { this.children.push(value); }
  remove() { this.removed = true; }
}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(tag); },
  createElementNS(namespace, tag) { const node = new FakeNode(tag); node.namespace = namespace; return node; },
  createComment(text) { return new FakeNode(text); },
  createTextNode(text) { const node = new FakeNode("text"); node.textContent = String(text); return node; },
};
globalThis[Symbol.for("velar.runtime.v1")] = {
  report(error, options) { console.log(options.phase + ":" + options.detail + ":" + error.message); },
};
${source}
const LazyPage = lazy(
  () => Promise.resolve({ Page: () => { throw new Error("Page construction failed"); } }),
  "Page",
  null,
  () => { throw new Error("Fallback construction failed"); },
);
const instance = LazyPage();
await new Promise((resolve) => setTimeout(resolve, 0));
const alert = instance.node.children[0];
console.log(alert.role + ":" + alert.textContent);
const InvalidLoading = lazy(() => new Promise(() => {}), "Page", () => new FakeNode("invalid"));
try { InvalidLoading(); console.log("accepted"); } catch (error) { console.log(error.name); }
let resolvedNamespace = "";
const LazyGraphic = lazy(
  () => Promise.resolve({ Graphic: (props, namespace) => {
    resolvedNamespace = namespace;
    return component(new FakeNode("circle:" + namespace));
  } }),
  "Graphic",
);
const graphic = LazyGraphic({}, "svg");
console.log(graphic.node.tag + ":" + graphic.node.namespace);
await new Promise((resolve) => setTimeout(resolve, 0));
console.log(resolvedNamespace + ":" + graphic.node.children[0].tag);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "resource:lazy:Page:Page construction failed",
    "render:lazy-fallback:Page:Fallback construction failed",
    "alert:Unable to render Page",
    "TypeError",
    "g:http://www.w3.org/2000/svg",
    "svg:circle:svg",
    "",
  ].join("\n"));
});

test("Router renders an accessible default 404 and validates targets before commit", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
class FakeNode {
  constructor(tag = "node") { this.tag = tag; this.children = []; this.attributes = {}; this.textContent = ""; this.removed = false; }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = values; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  insertBefore(value) { this.children.push(value); }
  remove() { this.removed = true; }
}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(tag); },
  createComment(text) { return new FakeNode(text); },
  createTextNode(text) { const node = new FakeNode("text"); node.textContent = String(text); return node; },
};
globalThis.location = { pathname: "/missing", search: "", hash: "" };
const listeners = new Map();
globalThis.addEventListener = (name, listener) => listeners.set(name, listener);
globalThis.removeEventListener = (name) => listeners.delete(name);
const reports = [];
// D90 fr-5: Router reads its routes through the List guard, which now refuses a
// registry from another generation instead of quietly reading past it. The
// installer that writes this slot in a real build always writes version, toRaw,
// collectionRead and report together, so a reporting stub has to answer for
// this generation the same way — a report-only registry is a shape production
// never produces, and loosening the runtime to accept one would give Web a
// tolerance rule no other reader of this slot has.
// D90 R4-a: a Router reads its routes inside the observer that renders from
// them, the way Head has always read its metadata, so the stub answers for the
// observer half of the slot too. These routes are not reactive, so a tracked
// run is an ordinary call that records nothing.
globalThis[Symbol.for("velar.runtime.v1")] = {
  version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)},
  toRaw: (value) => value,
  collectionRead: (target, key, value) => value,
  runTracked: (observer, run) => run(),
  schedule: (observer) => observer.run(),
  cleanupObserver: () => {},
  report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.message); },
};
${source}
for (const path of ["/items?view=all", "/items/", "/items//detail", "/items/file*", "/:wildcard/*"]) {
  try { route(path, () => component(new FakeNode("main"))); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
const missing = Router({ routes: [] });
const page = missing.node.children[0];
console.log(page.attributes["data-velar-not-found"] + ":" + page.children[0].textContent + ":" + page.children[1].textContent);

location.pathname = "/items/%E0%A4%A";
const malformed = Router({ routes: [route("/items/:id", () => component(new FakeNode("main")))] });
console.log(malformed.node.children[0].children[0].textContent);

const home = new FakeNode("main");
home.textContent = "Home";
location.pathname = "/";
const routed = Router({
  routes: [
    route("/", () => component(home)),
    route("/invalid", () => new FakeNode("invalid")),
  ],
});
routed.__mount();
location.pathname = "/invalid";
listeners.get("popstate")();
console.log(String(routed.node.children[0] === home) + ":" + String(home.removed));
console.log(reports.join("|"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "TypeError", "TypeError", "TypeError", "TypeError", "TypeError",
    ":Page not found:No route matches /missing",
    "Page not found",
    "true:false",
    "render:router:A VelarScript Router target must render a component",
    "",
  ].join("\n"));
});

test("Router caps route tables before creating browser nodes", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
let domCalls = 0;
globalThis.document = { createElement() { domCalls += 1; return {}; } };
// D90 R4-a: a Router reads its routes inside an observer, so the probe stands
// in for the runtime an application installs. The cap is still read before the
// host element exists.
globalThis[Symbol.for("velar.runtime.v1")] = {
  version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)},
  toRaw: (value) => value,
  collectionRead: (target, key, value) => value,
  runTracked: (observer, run) => run(),
  schedule: (observer) => observer.run(),
  cleanupObserver: () => {},
};
${source}
const item = route("/", () => null);
try { Router({ routes: new Array(10001).fill(item) }); console.log("accepted"); }
catch (error) { console.log(error.name); }
console.log(domCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\n0\n");
});
