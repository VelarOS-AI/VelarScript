import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { VELAR_RUNTIME_SCHEMA_VERSION } from "@velarscript/compiler/extension";
import { executeModule } from "../support/execute-module.ts";
import { compile, standardModuleSource } from "../support/compiler-suite.ts";

test("JSX fragments, declared children, form bindings, and event modifiers compose", () => {
  const result = compile(`
component Panel(children: WebNode):
    return <section>{children}</section>

component App:
    state name = "Velar"
    state age = 1
    state enabled = true

    def submit():
        print(name)

    return <>
        <Panel><strong>{name}</strong></Panel>
        <form host on:submit.prevent.stop={submit}>
            <input bind:value={name} />
            <input type="number" bind:value={age} />
            <input type="checkbox" bind:checked={enabled} />
        </form>
    </>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarDomCreateFragment\(\)/);
  assert.match(result.code ?? "", /__velarChild\(Panel, \{ {2}\}, \(/);
  assert.match(result.code ?? "", /__velarOn\([^\n]+"submit"[^\n]+\["prevent","stop"\]/);
  assert.match(result.code ?? "", /__velarBindValue\([^\n]+age[^\n]+true\)/);
  assert.match(result.code ?? "", /__velarBindChecked/);

  const invalid = compile(`
component App:
    state name = "Velar"
    return <form on:submit.magic={print}><input bind:checked={name} /></form>
`.trimStart());
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === "VEL5025"));
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === "VEL4001"));
});

test("JSX has one explicit renderable-value boundary without object coercion", () => {
  const valid = compile(`
import {color} from "velar/look"

enum Status:
    ready

component App:
    const labels: List<string> = ["Velar", "Script"]
    const accent = color("#7c5cff")
    return <main data-accent={accent}>
        {"Ready"}{42}{true}{Status.ready}{labels}{accent}{null}
        <section unsafe:html="<strong>trusted</strong>"></section>
    </main>
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /__velarHtml\([^;]+\(\) => "<strong>trusted<\/strong>"/u);
  assert.doesNotMatch(valid.code ?? "", /__velarStaticAttr\([^;]+"unsafe:html"/u);

  const invalid = compile(`
type User:
    name: string

const user: User = {name: "Ada"}

def callback():
    return null

component Broken:
    return <main data-user={user} class={user}>
        {user}
        {callback}
        <section unsafe:html={42}></section>
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5047" && /Native JSX attributes/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5040" && /JSX class/u.test(item.message)));
  assert.ok(invalid.diagnostics.filter((item) => item.code === "VEL5047" && /JSX can render/u.test(item.message)).length >= 2);
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5047" && /unsafe:html requires string/u.test(item.message)));

  const runtime = compile(`
component Shell:
    return <main>Ready</main>
`.trimStart());
  assert.deepEqual(runtime.diagnostics, []);
  const execution = executeModule(`class FakeNode {}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = { createTextNode(value) { return { value }; } };
const parent = { append() {}, setAttribute() {}, setAttributeNS() {} };
${runtime.code ?? ""}
let coercions = 0;
let getterReads = 0;
const hostile = { toString() { coercions += 1; return "coerced"; }, valueOf() { coercions += 1; return 1; } };
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, configurable: true, get() { getterReads += 1; return "read"; } });
accessor.length = 1;
const cyclic = [];
cyclic.push(cyclic);
for (const operation of [
  () => __velarAppend(parent, hostile),
  () => __velarStaticAttr(parent, "data-value", hostile),
  () => __velarKey(hostile),
  () => __velarAppend(parent, accessor),
  () => __velarAppend(parent, cyclic),
  () => __velarAppend(parent, Infinity),
]) {
  try { operation(); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(coercions + ":" + getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "TypeError\nTypeError\nTypeError\nTypeError\nTypeError\nTypeError\n0:0\n");

  const webRuntime = standardModuleSource("velar/web") ?? "";
  const webExecution = executeModule(`
class FakeNode {
  constructor() {
    this.classList = { add() {}, remove() {} };
  }
  append() {}
  addEventListener() {}
  removeEventListener() {}
  insertBefore() {}
  remove() {}
}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return { value }; },
};
${webRuntime}
let coercions = 0;
const hostile = { toString() { coercions += 1; return "coerced"; } };
const cyclic = [];
cyclic.push(cyclic);
for (const children of [hostile, cyclic]) {
  try { Link({ to: "/", children }); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(coercions);
`);
  assert.equal(webExecution.status, 0, String(webExecution.stderr));
  assert.equal(webExecution.stdout, "TypeError\nTypeError\n0\n");
});

test("JSX DOM creation, mount, destroy, and List expansion retain their initialization-time host ABI", () => {
  const result = compile(`
component Card:
    return <><main host data-kind="card">ready</main></>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", value = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.value = value;
    this.textContent = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
  }
  static detach(node) {
    if (!node.parentNode) return;
    const siblings = node.parentNode.childNodes;
    const index = siblings.indexOf(node);
    if (index !== -1) siblings.splice(index, 1);
    node.parentNode = null;
  }
  static insert(parent, node, before) {
    if (node.nodeType === 11) {
      for (const child of [...node.childNodes]) FakeNode.insert(parent, child, before);
      return;
    }
    FakeNode.detach(node);
    node.parentNode = parent;
    const index = before === null ? -1 : parent.childNodes.indexOf(before);
    if (index === -1) parent.childNodes.push(node);
    else parent.childNodes.splice(index, 0, node);
  }
  append(...values) { for (const value of values) FakeNode.insert(this, value, null); }
  insertBefore(node, before = null) { FakeNode.insert(this, node, before); return node; }
  before(...values) { for (const value of values) FakeNode.insert(this.parentNode, value, this); }
  remove() { FakeNode.detach(this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  setAttributeNS(namespace, name, value) { this.attributes[namespace + ":" + name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  removeAttributeNS(namespace, name) { delete this.attributes[namespace + ":" + name]; }
  replaceChildren(...values) {
    for (const child of [...this.childNodes]) FakeNode.detach(child);
    this.childNodes = [];
    for (const value of values) FakeNode.insert(this, value, null);
  }
}
const target = new FakeNode(1, "target");
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createElementNS(namespace, tag) { return new FakeNode(1, namespace + ":" + tag); },
  createTextNode(value) { return new FakeNode(3, "", value + ""); },
  createComment(value) { return new FakeNode(8, "", value + ""); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#target" ? target : null; },
};
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
globalThis.document = new Proxy({}, { get() { throw new Error("ambient document read"); } });
globalThis.Node = class PoisonedNode {};
for (const name of ["append", "insertBefore", "before", "remove", "setAttribute", "setAttributeNS", "removeAttribute", "removeAttributeNS", "replaceChildren"]) {
  FakeNode.prototype[name] = () => { throw new Error("live DOM method " + name); };
}
Array.isArray = () => { throw new Error("live Array.isArray"); };
Number.isFinite = () => { throw new Error("live Number.isFinite"); };
globalThis.String = () => { throw new Error("live String"); };
Set.prototype.has = () => { throw new Error("live Set.has"); };
Set.prototype.add = () => { throw new Error("live Set.add"); };
Set.prototype.delete = () => { throw new Error("live Set.delete"); };
const instance = Card();
instance.mount("#target");
const root = target.childNodes[0];
__velarAppend(root, ["a", "b"]);
console.log(root.tagName + ":" + root.attributes["data-kind"] + ":" + root.childNodes.map((node) => node.textContent).join(""));
let getterReads = 0;
const accessorParent = Object.defineProperty({}, "append", { enumerable: true, get() { getterReads += 1; return () => {}; } });
try { __velarAppend(accessorParent, "blocked"); console.log("accepted"); }
catch (error) { console.log(error.name + ":" + getterReads); }
instance.destroy();
console.log(target.childNodes.length);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "main:card:readyab\nTypeError:0\n0\n");
});

test("velar/web Router and lazy components retain the shared DOM host ABI after initialization", () => {
  const source = standardModuleSource("velar/web", { base: "/" }) ?? "";
  const execution = executeModule(`
class FakeNode {
  constructor(nodeType = 1, tagName = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.textContent = "";
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
  }
  static detach(node) {
    if (!node.parentNode) return;
    const siblings = node.parentNode.childNodes;
    const index = siblings.indexOf(node);
    if (index !== -1) siblings.splice(index, 1);
    node.parentNode = null;
  }
  static insert(parent, node, before) {
    FakeNode.detach(node);
    node.parentNode = parent;
    const index = before === null ? -1 : parent.childNodes.indexOf(before);
    if (index === -1) parent.childNodes.push(node);
    else parent.childNodes.splice(index, 0, node);
  }
  append(...values) { for (const value of values) FakeNode.insert(this, value, null); }
  insertBefore(node, before = null) { FakeNode.insert(this, node, before); return node; }
  remove() { FakeNode.detach(this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  replaceChildren(...values) {
    for (const child of [...this.childNodes]) FakeNode.detach(child);
    this.childNodes = [];
    for (const value of values) FakeNode.insert(this, value, null);
  }
}
const target = new FakeNode(1, "target");
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createElementNS(namespace, tag) { return new FakeNode(1, namespace + ":" + tag); },
  createTextNode(value) { const node = new FakeNode(3); node.textContent = String(value); return node; },
  createComment(value) { const node = new FakeNode(8); node.textContent = String(value); return node; },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#app" ? target : null; },
};
globalThis.location = { pathname: "/missing", search: "", hash: "", href: "https://example.test/missing", origin: "https://example.test" };
globalThis.history = { pushState() {}, replaceState() {}, back() {}, forward() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = () => true;
globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
globalThis.scrollTo = () => {};
globalThis.PopStateEvent = class { constructor(type) { this.type = type; } };
// D90 R4-a: a Router renders from routes it reads inside an observer, so the
// probe installs the runtime an application installs before importing the
// module whose captured ABI it is about to test.
globalThis[Symbol.for("velar.runtime.v1")] = {
  version: ${JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION)},
  toRaw: (value) => value,
  collectionRead: (target, key, value) => value,
  runTracked: (observer, run) => run(),
  schedule: (observer) => observer.run(),
  cleanupObserver: () => {},
};
${source}
globalThis.document = new Proxy({}, { get() { throw new Error("ambient document read"); } });
globalThis.Node = class PoisonedNode {};
for (const name of ["append", "insertBefore", "remove", "setAttribute", "removeAttribute", "replaceChildren"]) {
  FakeNode.prototype[name] = () => { throw new Error("live DOM method " + name); };
}
Array.isArray = () => { throw new Error("live Array.isArray"); };
Number.isFinite = () => { throw new Error("live Number.isFinite"); };
Set.prototype.has = () => { throw new Error("live Set.has"); };
Set.prototype.add = () => { throw new Error("live Set.add"); };
Set.prototype.delete = () => { throw new Error("live Set.delete"); };
const router = Router({ routes: [] });
router.mount("#app");
console.log(target.childNodes[0].tagName + ":" + target.childNodes[0].childNodes[0].attributes["data-velar-not-found"]);
router.destroy();
const Pending = lazy(() => new Promise(() => {}), "Page");
const pending = Pending();
pending.mount("#app");
console.log(target.childNodes[0].tagName + ":" + target.childNodes[0].childNodes[0].nodeType);
pending.destroy();
console.log(target.childNodes.length);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "velar-router:\nvelar-lazy:8\n0\n");
});

test("native SVG JSX preserves namespaces across components, dynamics, and foreignObject", () => {
  const result = compile(`
component Point(x: number, y: number):
    return <circle cx={x} cy={y} r="4" />

component Annotation:
    return <foreignObject x="0" y="0" width="80" height="24">
        <div class="label">HTML label</div>
        <svg aria-hidden="true"><path d="M0 0 L8 8" /></svg>
    </foreignObject>

component Chart:
    state values = [12, 24]
    return <svg aria-label="Traffic trend" viewBox="0 0 100 60">
        <defs><circle id="marker" cx="0" cy="0" r="2" /></defs>
        <g>
            <Point x={12} y={20} />
            {values.map(value => <rect key={value} x={value} y="30" width="8" height="12" />)}
            {values.size > 0 ? <path d="M0 50 L100 10" /> : null}
            <use xlink:href="#marker" />
            <Annotation />
        </g>
    </svg>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateElement\("svg", "svg"\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("g", "svg"\)/u);
  assert.match(result.code ?? "", /__velarChild\(Point, \{ x: \(\) => \(12\), y: \(\) => \(20\) \}, undefined, __velarComponentScope, "svg"\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("circle", __velarNamespace\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("foreignObject", __velarNamespace\)/u);
  assert.match(result.code ?? "", /__velarCreateElement\("div", "html"\)/u);
  assert.match(result.code ?? "", /__velarStaticAttr\([^;]+, "xlink:href", "#marker"\)/u);
  assert.match(result.code ?? "", /__velarDomSetAttributeNS\(element, __velarXlinkNamespace, name, value\)/u);
  assert.doesNotMatch(result.code ?? "", /document\.createElement\("(?:svg|g|path|circle|rect|use|foreignObject)"\)/u);

  const inaccessible = compile(`
component Icon:
    return <svg><path d="M0 0 L8 8" /></svg>
`.trimStart());
  assert.ok(inaccessible.diagnostics.some((item) => item.code === "VEL5030" && /svg element requires/u.test(item.message)));

  const titled = compile(`
component Icon:
    return <svg><title>Save changes</title><path d="M0 0 L8 8" /></svg>
`.trimStart());
  assert.deepEqual(titled.diagnostics, []);
});
