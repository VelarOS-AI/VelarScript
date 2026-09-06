import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { VELAR_RUNTIME_SCHEMA_VERSION } from "@velarscript/compiler/extension";
import { executeModule } from "../support/execute-module.ts";
import { compile, standardModuleSource } from "../support/compiler-suite.ts";

test("browser helpers reject invalid values before invoking browser capabilities", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
let clipboardReads = 0;
let browserCalls = 0;
class FakeElement {
  scrollIntoView() { browserCalls += 1; }
}
class FakeDialog extends FakeElement {
  constructor() { super(); this.open = true; this.isConnected = true; }
  close() { browserCalls += 1; }
}
globalThis.Element = FakeElement;
globalThis.HTMLDialogElement = FakeDialog;
globalThis.isSecureContext = true;
const navigatorValue = {};
Object.defineProperty(navigatorValue, "clipboard", { get() { clipboardReads += 1; return { writeText() { browserCalls += 1; } }; } });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
globalThis.open = () => { browserCalls += 1; };
globalThis.scrollTo = () => { browserCalls += 1; };
globalThis.matchMedia = () => { browserCalls += 1; return { matches: false, addEventListener() { browserCalls += 1; } }; };
${source}
const dialog = new FakeDialog();
const element = new FakeElement();
const operations = [
  async () => writeClipboardText(42),
  () => open(42),
  () => scrollTo(Number.NaN, 0),
  () => scrollTo(0, 0, "fast"),
  () => scrollIntoView(element, "fast"),
  () => media(42),
  () => watchMedia("screen", 42),
  () => closeDialog(dialog, 42),
];
const failures = [];
for (const operation of operations) {
  try { await operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(failures.join(","));
console.log(clipboardReads + ":" + browserCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, `${new Array(8).fill("TypeError").join(",")}\n0:0\n`);
});

test("framework-owned browser events ignore synthetic accessors and instance overrides", () => {
  const browserSource = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`
const reports = [];
const listeners = new Map();
let callbackCalls = 0;
let getterReads = 0;
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.name); } };
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener(name, callback) { listeners.set(name, callback); },
  removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
});
${browserSource}
const stop = watchMedia("screen", () => { callbackCalls += 1; });
listeners.get("change")(Object.defineProperty({}, "matches", { enumerable: true, get() { getterReads += 1; return true; } }));
listeners.get("change")({ matches: true });
stop();
console.log(getterReads + ":" + callbackCalls + ":" + listeners.size);
console.log(reports.join("|"));
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "0:1:0\nobserver:media:TypeError\n");

  const webSource = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const webExecution = executeModule(`
const reports = [];
let getterReads = 0;
let prevented = 0;
let navigations = 0;
class FakeNode {
  constructor() { this.listeners = new Map(); this.classList = { add() {}, remove() {} }; this.href = ""; }
  append() {}
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = { createElement() { return new FakeNode(); }, createTextNode() { return new FakeNode(); } };
globalThis.location = { href: "https://example.test/", origin: "https://example.test", pathname: "/", search: "", hash: "" };
globalThis.history = { pushState() { navigations += 1; }, replaceState() { navigations += 1; } };
globalThis.PopStateEvent = class { constructor(type) { this.type = type; } };
globalThis.dispatchEvent = () => true;
globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
globalThis.scrollTo = () => {};
// D90 R4-a: a Link reads its target inside an observer, so the reporting stub
// answers for the observer half of this slot as well.
globalThis[Symbol.for("velar.runtime.v1")] = {
  version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)},
  toRaw: (value) => value,
  collectionRead: (target, key, value) => value,
  runTracked: (observer, run) => run(),
  schedule: (observer) => observer.run(),
  cleanupObserver: () => {},
  report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.name); },
};
${webSource}
const linked = Link({ to: "/next" });
linked.__mount();
linked.node.listeners.get("click")(Object.defineProperty({}, "defaultPrevented", { enumerable: true, get() { getterReads += 1; return false; } }));
linked.node.listeners.get("click")({
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault() { prevented += 1; },
});
console.log(getterReads + ":" + prevented + ":" + navigations);
console.log(reports.join("|"));
`);
  assert.equal(webExecution.status, 0, String(webExecution.stderr));
  assert.equal(webExecution.stdout, "0:1:1\nevent:link:TypeError\n");
});

test("browser focus helpers use validated HTML elements and native prototype operations", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
const calls = [];
  class FakeElement {
    scrollIntoView(options) { calls.push("prototype-scroll:" + options.behavior); }
    getBoundingClientRect() { calls.push("prototype-measure"); return { x: 0, y: 0, width: 10, height: 20, top: 0, right: 10, bottom: 20, left: 0 }; }
  }
class FakeHTMLElement extends FakeElement {
  focus(options) { calls.push("prototype-focus:" + options.preventScroll); }
  blur() { calls.push("prototype-blur"); }
}
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
${source}
const element = new FakeHTMLElement();
element.focus = () => calls.push("instance-focus");
element.blur = () => calls.push("instance-blur");
element.scrollIntoView = () => calls.push("instance-scroll");
element.getBoundingClientRect = () => { calls.push("instance-measure"); return {}; };
focus(element, true);
blur(element);
scrollIntoView(element, "smooth");
console.log(measure(element).width);
const failures = [];
for (const operation of [
  () => focus(new FakeElement()),
  () => focus(element, "yes"),
  () => blur(new FakeElement()),
]) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
console.log(calls.join(","));
console.log(failures.join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "10\nprototype-focus:true,prototype-blur,prototype-scroll:smooth,prototype-measure\nTypeError,TypeError,TypeError\n");
});

test("textarea selection stays on Core code-point offsets and captured Web operations", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
const state = new WeakMap();
let ambientCalls = 0;
class FakeElement {}
class FakeHTMLElement extends FakeElement {}
class FakeTextArea extends FakeHTMLElement {
  constructor(value, start, end, direction = "none") { super(); state.set(this, { value, start, end, direction }); }
  get value() { return state.get(this).value; }
  get selectionStart() { return state.get(this).start; }
  get selectionEnd() { return state.get(this).end; }
  get selectionDirection() { return state.get(this).direction; }
  setSelectionRange(start, end, direction) { state.set(this, { ...state.get(this), start, end, direction }); }
}
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.HTMLTextAreaElement = FakeTextArea;
${source}
const area = new FakeTextArea("A😀B", 1, 3, "forward");
const initial = textSelection(area);
console.log(initial.start + ":" + initial.end + ":" + initial.direction);
const poison = () => { ambientCalls += 1; throw new Error("ambient textarea operation"); };
for (const name of ["value", "selectionStart", "selectionEnd", "selectionDirection"]) {
  Object.defineProperty(FakeTextArea.prototype, name, { configurable: true, get: poison });
}
Object.defineProperty(FakeTextArea.prototype, "setSelectionRange", { configurable: true, value: poison });
setTextSelection(area, 1, 3, "backward");
const selected = state.get(area);
console.log(selected.start + ":" + selected.end + ":" + selected.direction);
console.log(ambientCalls);
state.set(area, { value: "A😀B", start: 2, end: 3, direction: "none" });
try { textSelection(area); console.log("accepted"); }
catch (error) { console.log(error.name); }
try { setTextSelection(area, 0, 5); console.log("accepted"); }
catch (error) { console.log(error.name); }
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "1:2:forward\n1:4:backward\n0\nTypeError\nRangeError\n");
});

test("element scrolling, pointer capture, and event clipboard text use captured Web hosts", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
const elementState = new WeakMap();
const clipboardState = new WeakMap();
const eventState = new WeakMap();
const calls = [];
let ambientCalls = 0;
class FakeElement {
  constructor() { elementState.set(this, { x: 4, y: 8, viewportWidth: 100, viewportHeight: 50, contentWidth: 500, contentHeight: 1000 }); }
  get scrollLeft() { return elementState.get(this).x; }
  get scrollTop() { return elementState.get(this).y; }
  get clientWidth() { return elementState.get(this).viewportWidth; }
  get clientHeight() { return elementState.get(this).viewportHeight; }
  get scrollWidth() { return elementState.get(this).contentWidth; }
  get scrollHeight() { return elementState.get(this).contentHeight; }
  scrollTo(options) { calls.push("scroll:" + options.left + ":" + options.top + ":" + options.behavior); elementState.get(this).x = options.left; elementState.get(this).y = options.top; }
  setPointerCapture(id) { calls.push("capture:" + id); }
  releasePointerCapture(id) { calls.push("release:" + id); }
}
class FakeDataTransfer {
  constructor(text) { clipboardState.set(this, text); }
  getData(kind) { calls.push("read:" + kind); return clipboardState.get(this); }
  setData(kind, value) { calls.push("write:" + kind + ":" + value); clipboardState.set(this, value); }
}
class FakeClipboardEvent {
  constructor(data) { eventState.set(this, data); }
  get clipboardData() { return eventState.get(this); }
}
globalThis.Element = FakeElement;
globalThis.DataTransfer = FakeDataTransfer;
globalThis.ClipboardEvent = FakeClipboardEvent;
${source}
const element = new FakeElement();
const initial = scrollMetrics(element);
console.log([initial.x, initial.y, initial.viewportWidth, initial.viewportHeight, initial.contentWidth, initial.contentHeight].join(":"));
const data = new FakeDataTransfer("paste");
const event = new FakeClipboardEvent(data);
const poison = () => { ambientCalls += 1; throw new Error("ambient host operation"); };
for (const name of ["scrollLeft", "scrollTop", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]) {
  Object.defineProperty(FakeElement.prototype, name, { configurable: true, get: poison });
}
for (const name of ["scrollTo", "setPointerCapture", "releasePointerCapture"]) Object.defineProperty(FakeElement.prototype, name, { configurable: true, value: poison });
Object.defineProperty(FakeClipboardEvent.prototype, "clipboardData", { configurable: true, get: poison });
for (const name of ["getData", "setData"]) Object.defineProperty(FakeDataTransfer.prototype, name, { configurable: true, value: poison });
scrollElementTo(element, 20, 30, "instant");
capturePointer(element, 7);
releasePointer(element, 7);
console.log(clipboardText(event));
setClipboardText(event, "copied");
console.log(clipboardState.get(data));
console.log(calls.join(","));
console.log(ambientCalls);
const failures = [];
for (const operation of [
  () => scrollElementTo(element, Number.NaN, 0),
  () => capturePointer(element, -1),
  () => clipboardText({}),
  () => setClipboardText(event, 17),
]) {
  try { operation(); failures.push("accepted"); }
  catch (error) { failures.push(error.name); }
}
elementState.get(element).contentHeight = -1;
try { scrollMetrics(element); failures.push("accepted"); }
catch (error) { failures.push(error.name); }
console.log(failures.join(","));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "4:8:100:50:500:1000",
    "paste",
    "copied",
    "scroll:20:30:instant,capture:7,release:7,read:text/plain,write:text/plain:copied",
    "0",
    "TypeError,RangeError,TypeError,TypeError,RangeError",
    "",
  ].join("\n"));
});

test("clipboard and dialog helpers snapshot hosts and bypass instance overrides", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
const calls = [];
const navigatorState = new WeakMap();
const nodeState = new WeakMap();
const dialogState = new WeakMap();
class FakeClipboard {
  async writeText(value) { calls.push("prototype-write:" + value); }
  async readText() { calls.push("prototype-read"); return "ready"; }
}
class FakeNavigator {
  constructor(clipboard) { navigatorState.set(this, clipboard); }
  get clipboard() { nativeClipboardReads += 1; return navigatorState.get(this); }
}
class FakeNode {
  constructor() { nodeState.set(this, true); }
  get isConnected() { return nodeState.get(this); }
}
class FakeDialog extends FakeNode {
  constructor() { super(); dialogState.set(this, { open: false, result: "" }); }
  get open() { return dialogState.get(this).open; }
  get returnValue() { return dialogState.get(this).result; }
  showModal() { calls.push("prototype-show"); dialogState.get(this).open = true; }
  close(value) { calls.push("prototype-close:" + value); dialogState.set(this, { open: false, result: value }); }
}
globalThis.Clipboard = FakeClipboard;
globalThis.Navigator = FakeNavigator;
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.HTMLDialogElement = FakeDialog;
let secureReads = 0;
Object.defineProperty(globalThis, "isSecureContext", { configurable: true, get() { secureReads += 1; return secureReads === 1; } });
const clipboardValue = new FakeClipboard();
let nativeClipboardReads = 0;
let clipboardOverrideReads = 0;
const navigatorValue = new FakeNavigator(clipboardValue);
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
globalThis.document = { visibilityState: "visible" };${source}
Object.defineProperty(navigatorValue, "clipboard", { get() { clipboardOverrideReads += 1; return null; } });
clipboardValue.writeText = () => calls.push("instance-write");
await writeClipboardText("Velar");
let openOverrideReads = 0;
let connectedOverrideReads = 0;
const dialog = new FakeDialog();
Object.defineProperty(dialog, "isConnected", { get() { connectedOverrideReads += 1; return false; } });
Object.defineProperty(dialog, "open", {
  get() { openOverrideReads += 1; return false; },
});
dialog.showModal = () => calls.push("instance-show");
dialog.close = () => calls.push("instance-close");
showDialog(dialog);
closeDialog(dialog, "done");
console.log(calls.join(","));
console.log([secureReads, nativeClipboardReads, clipboardOverrideReads, connectedOverrideReads, openOverrideReads, dialogState.get(dialog).open].join(":"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "prototype-write:Velar,prototype-show,prototype-close:done\n1:1:0:0:0:false\n");
});

test("browser snapshots and asynchronous host results stay inside typed bounds", () => {
  const source = standardModuleSource("velar/browser") ?? "";
  const execution = executeModule(`
class FakeElement { getBoundingClientRect() { return { x: Number.POSITIVE_INFINITY, y: 0, width: 1, height: 1, top: 0, right: 1, bottom: 1, left: 0 }; } }
class FakeDialog extends FakeElement { constructor() { super(); this.returnValue = 42; } }
globalThis.Element = FakeElement;
globalThis.HTMLDialogElement = FakeDialog;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { language: "x".repeat(257), languages: ["en"] } });
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = callback => callback(Number.NaN);
globalThis.document = { visibilityState: "visible" };${source}
for (const operation of [
  () => environment(),
  () => measure(new FakeElement()),
  () => dialogResult(new FakeDialog()),
  () => frame(),
]) {
  try { await operation(); console.log("accepted"); } catch (error) { console.log(error.name); }
}
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "RangeError\nTypeError\nTypeError\nTypeError\n");
});

test("browser and router snapshots reject host coercion and accessor values", () => {
  const browserSource = standardModuleSource("velar/browser") ?? "";
const browserExecution = executeModule(`
let coercions = 0;
let getterReads = 0;
const hostile = { toString() { coercions += 1; return ""; } };
const navigatorState = { language: "en", languages: ["en"], onLine: true, maxTouchPoints: 0 };
const locationState = { href: "https://example.test/", origin: "https://example.test", pathname: "/", search: hostile, hash: "" };
const documentState = { visibilityState: "visible" };
const mediaState = { matches: false };
class FakeNavigator {
  get language() { return navigatorState.language; }
  get languages() { return navigatorState.languages; }
  get onLine() { return navigatorState.onLine; }
  get maxTouchPoints() { return navigatorState.maxTouchPoints; }
}
class FakeLocation {
  get href() { return locationState.href; }
  get origin() { return locationState.origin; }
  get pathname() { return locationState.pathname; }
  get search() { return locationState.search; }
  get hash() { return locationState.hash; }
}
class FakeDocument { get visibilityState() { return documentState.visibilityState; } }
globalThis.Navigator = FakeNavigator;
globalThis.Location = FakeLocation;
globalThis.Document = FakeDocument;
const navigatorValue = new FakeNavigator();
const locationValue = new FakeLocation();
const documentValue = new FakeDocument();
globalThis.document = documentValue;
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
Object.defineProperty(globalThis, "location", { configurable: true, value: locationValue });
globalThis.matchMedia = () => ({ matches: mediaState.matches });
${browserSource}
const failures = [];
try { location(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
locationState.search = "";
const accessorLanguages = [];
Object.defineProperty(accessorLanguages, 0, { enumerable: true, configurable: true, get() { getterReads += 1; return "en"; } });
accessorLanguages.length = 1;
navigatorState.languages = accessorLanguages;
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
navigatorState.languages = ["en"];
navigatorState.onLine = "yes";
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
navigatorState.onLine = true;
mediaState.matches = "yes";
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
mediaState.matches = false;
navigatorState.maxTouchPoints = Number.NaN;
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
navigatorState.maxTouchPoints = 0;
documentState.visibilityState = "unknown";
try { environment(); failures.push("accepted"); } catch (error) { failures.push(error.name); }
documentState.visibilityState = "visible";
navigatorState.languages = ["en"];
let navigatorReads = 0;
let onlineReads = 0;
let visibilityReads = 0;
let touchReads = 0;
Object.defineProperty(navigatorValue, "onLine", { configurable: true, get() { onlineReads += 1; return false; } });
Object.defineProperty(navigatorValue, "maxTouchPoints", { configurable: true, get() { touchReads += 1; return 999; } });
Object.defineProperty(documentValue, "visibilityState", { configurable: true, get() { visibilityReads += 1; return "hidden"; } });
Object.defineProperty(globalThis, "navigator", { configurable: true, get() { navigatorReads += 1; return navigatorValue; } });
const snapshot = environment();
snapshot.languages.push("fr");
console.log(failures.join(","));
console.log(coercions + ":" + getterReads);
console.log(Object.isFrozen(snapshot) + ":" + Object.isFrozen(snapshot.languages) + ":" + snapshot.languages.join(","));
console.log([navigatorReads, onlineReads, visibilityReads, touchReads, snapshot.online, snapshot.visible].join(":"));
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "TypeError,TypeError,TypeError,TypeError,RangeError,TypeError\n0:0\ntrue:false:en,fr\n0:0:0:0:true:true\n");

  const webSource = standardModuleSource("velar/web") ?? "";
  const routerExecution = executeModule(`
let coercions = 0;
const hostile = { toString() { coercions += 1; return ""; } };
class FakeNode { replaceChildren() {} }
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = { createElement() { return new FakeNode(); } };
globalThis.location = { pathname: "/", search: hostile, hash: "" };
${webSource}
for (const field of ["search", "hash"]) {
  location.search = field === "search" ? hostile : "";
  location.hash = field === "hash" ? hostile : "";
  try { Router({ routes: [] }); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(coercions);
`);
  assert.equal(routerExecution.status, 0, String(routerExecution.stderr));
  assert.equal(routerExecution.stdout, "TypeError\nTypeError\n0\n");
});

test("browser services and navigation keep their captured host ABI after ambient and instance poisoning", () => {
  const browserSource = standardModuleSource("velar/browser") ?? "";
  const browserExecution = executeModule(`
const calls = [];
const listeners = new Map();
const mediaState = new WeakMap();
const documentState = new WeakMap();
const navigatorState = new WeakMap();
class FakeEventTarget {
  addEventListener(name, callback) { calls.push("add:" + name); listeners.set(this.constructor.name + ":" + name, callback); }
  removeEventListener(name, callback) { calls.push("remove:" + name); if (listeners.get(this.constructor.name + ":" + name) === callback) listeners.delete(this.constructor.name + ":" + name); }
}
class FakeMediaQueryList extends FakeEventTarget {
  constructor(matches) { super(); mediaState.set(this, matches); }
  get matches() { return mediaState.get(this); }
}
class FakeDocument extends FakeEventTarget {
  constructor() { super(); documentState.set(this, "visible"); }
  get visibilityState() { return documentState.get(this); }
}
class FakeNavigator {
  constructor() { navigatorState.set(this, true); }
  get onLine() { return navigatorState.get(this); }
}
globalThis.EventTarget = FakeEventTarget;
globalThis.MediaQueryList = FakeMediaQueryList;
globalThis.Document = FakeDocument;
globalThis.Navigator = FakeNavigator;
const matcher = new FakeMediaQueryList(true);
const documentValue = new FakeDocument();
const navigatorValue = new FakeNavigator();
Object.defineProperty(globalThis, "document", { configurable: true, value: documentValue });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
globalThis.matchMedia = () => { calls.push("match"); return matcher; };
globalThis.setTimeout = (callback, milliseconds) => { calls.push("timeout:" + milliseconds); return 7; };
globalThis.clearTimeout = value => { calls.push("clear:" + value); };
globalThis.requestAnimationFrame = callback => { calls.push("frame"); callback(12.5); return 9; };
globalThis.open = value => { calls.push("open:" + value); };
globalThis.scrollTo = options => { calls.push("scroll:" + options.left + ":" + options.top); };
globalThis.addEventListener = (name, callback) => { calls.push("global-add:" + name); listeners.set("global:" + name, callback); };
globalThis.removeEventListener = (name, callback) => { calls.push("global-remove:" + name); if (listeners.get("global:" + name) === callback) listeners.delete("global:" + name); };
${browserSource}
let poisoned = 0;
for (const name of ["matchMedia", "setTimeout", "clearTimeout", "requestAnimationFrame", "open", "scrollTo", "addEventListener", "removeEventListener"]) {
  globalThis[name] = () => { poisoned += 1; };
}
matcher.addEventListener = () => { poisoned += 1; };
matcher.removeEventListener = () => { poisoned += 1; };
documentValue.addEventListener = () => { poisoned += 1; };
documentValue.removeEventListener = () => { poisoned += 1; };
const cancel = after("5ms", () => null);
cancel();
console.log(media("screen"));
const stopMedia = watchMedia("screen", () => null);
const stopVisibility = watchVisibility(() => null);
const stopOnline = watchOnline(() => null);
open("https://example.test");
scrollTo(2, 3);
console.log(await frame());
stopMedia(); stopVisibility(); stopOnline();
console.log(poisoned);
console.log(calls.join(","));
`);
  assert.equal(browserExecution.status, 0, String(browserExecution.stderr));
  assert.equal(browserExecution.stdout, "true\n12.5\n0\ntimeout:5,clear:7,match,match,add:change,add:visibilitychange,global-add:online,global-add:offline,open:https://example.test,scroll:2:3,frame,remove:change,remove:visibilitychange,global-remove:online,global-remove:offline\n");

  const webSource = standardModuleSource("velar/web") ?? "";
  const navigationExecution = executeModule(`
const calls = [];
const historyState = new WeakMap();
const locationState = new WeakMap();
class FakeHistory {
  constructor() { historyState.set(this, true); }
  pushState(_state, _title, value) { calls.push("push:" + value); }
  replaceState(_state, _title, value) { calls.push("replace:" + value); }
  back() { calls.push("back"); }
  forward() { calls.push("forward"); }
}
class FakeLocation {
  constructor() { locationState.set(this, { href: "https://example.test/", origin: "https://example.test", pathname: "/", search: "?a=1", hash: "#top" }); }
  get href() { return locationState.get(this).href; }
  get origin() { return locationState.get(this).origin; }
  get pathname() { return locationState.get(this).pathname; }
  get search() { return locationState.get(this).search; }
  get hash() { return locationState.get(this).hash; }
  reload() { calls.push("reload"); }
}
globalThis.History = FakeHistory;
globalThis.Location = FakeLocation;
globalThis.history = new FakeHistory();
globalThis.location = new FakeLocation();
globalThis.PopStateEvent = class { constructor(name) { this.name = name; } };
globalThis.dispatchEvent = event => { calls.push("dispatch:" + event.name); return true; };
globalThis.requestAnimationFrame = callback => { calls.push("frame"); callback(0); return 1; };
globalThis.scrollTo = () => { calls.push("scroll"); };
${webSource}
let poisoned = 0;
for (const name of ["dispatchEvent", "requestAnimationFrame", "scrollTo"]) globalThis[name] = () => { poisoned += 1; };
for (const name of ["pushState", "replaceState", "back", "forward"]) history[name] = () => { poisoned += 1; };
location.reload = () => { poisoned += 1; };
for (const name of ["href", "origin", "pathname", "search", "hash"]) {
  Object.defineProperty(location, name, { configurable: true, get() { poisoned += 1; return "poisoned"; } });
}
navigate("/next");
redirect("/done");
back(); forward(); reload();
const routeSnapshot = currentRoute();
console.log(routeSnapshot.path + ":" + routeSnapshot.query.get("a") + ":" + routeSnapshot.hash);
console.log(poisoned);
console.log(calls.join(","));
`);
  assert.equal(navigationExecution.status, 0, String(navigationExecution.stderr));
  assert.equal(navigationExecution.stdout, "/:1:#top\n0\npush:/next,dispatch:popstate,frame,scroll,replace:/done,dispatch:popstate,frame,scroll,back,forward,reload\n");
});

test("Web scheduling and error timestamps retain their captured host operations", () => {
  const result = compile(`
state count = 0

watch count as current, previous:
    print(f"watch:{current}:{previous}")

export def commit():
    count = count + 1
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`
const nativeQueueMicrotask = globalThis.queueMicrotask;
const NativeDate = globalThis.Date;
${result.code ?? ""}
let poisoned = 0;
globalThis.queueMicrotask = () => { poisoned += 1; };
globalThis.Date = { now() { poisoned += 1; return Number.NaN; } };
commit();
await new Promise(resolve => nativeQueueMicrotask(resolve));
await __velarTick();
const before = NativeDate.now();
const report = __velarRuntime.report(new Error("owned"), { phase: "test", unhandled: false });
const after = NativeDate.now();
console.log(report.timestamp >= before && report.timestamp <= after);
console.log(poisoned);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  const lines = String(execution.stdout).trim().split("\n");
  assert.equal(lines[0], "watch:1:0");
  assert.equal(lines[1], "true");
  assert.equal(lines[2], "0");
});
