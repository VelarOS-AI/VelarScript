import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { executeModule } from "../support/execute-module.ts";
import { compile } from "../support/compiler-suite.ts";

test("an empty-state ternary keeps keyed identity across branch flips", () => {
  const result = compile(`
type Row:
    id: string
    text: string

state rows: List<Row> = []
let stamps = 0

component Entry(row: Row):
    stamps += 1
    const stamp = stamps
    return <article data-id={row.id} data-stamp={stamp}>{row.text}</article>

component Flow:
    return <section>{rows.size == 0 ? <p>empty</p> : rows.map(row => <Entry key={row.id} row={row} />)}</section>

mount(<Flow />, "#flow")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", value = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.value = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
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
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
}
const flowTarget = new FakeNode(1, "root");
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createTextNode(value) { return new FakeNode(3, "", String(value)); },
  createComment(value) { return new FakeNode(8, "", String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#flow" ? flowTarget : null; },
};
function dumpNode(node) {
  if (node.nodeType === 3) return node.value;
  if (node.nodeType === 8) return "";
  const attributes = [...node.attributes.entries()].map(([name, value]) => " " + name + "=" + JSON.stringify(String(value))).join("");
  return "<" + node.tagName + attributes + ">" + node.childNodes.map(dumpNode).join("") + "</" + node.tagName + ">";
}
function dump() { return flowTarget.childNodes.map(dumpNode).join(""); }
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
await flush();
console.log(dump());
rows.set([{ id: "a", text: "a0" }, { id: "b", text: "b0" }]);
await flush();
console.log(dump());
const current = rows.get();
rows.set([current[0], { ...current[1], text: "b1" }]);
await flush();
console.log(dump());
rows.set([]);
await flush();
console.log(dump());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // Empty state renders while the keyed region holds zero entries.
    "<section><p>empty</p></section>",
    // The flip destroys the empty state and populates the keyed region.
    '<section><article data-id="a" data-stamp="1">a0</article><article data-id="b" data-stamp="2">b0</article></section>',
    // A streamed-style update replaces only the changed record's instance;
    // the untouched entry keeps its component instance (same stamp).
    '<section><article data-id="a" data-stamp="1">a0</article><article data-id="b" data-stamp="3">b1</article></section>',
    // Flipping back to empty drops every entry and restores the empty state.
    "<section><p>empty</p></section>",
    "",
  ].join("\n"));
});

test("diagnoses keys the keyed fast path will ignore", () => {
  // A branch map without a key is held to the same standard as a bare map.
  const missingBranchKey = compile(`
component Flow(names: List<string>):
    return <ul>{names.size == 0 ? <li>empty</li> : names.map(name => <li>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(missingBranchKey.diagnostics.map((item) => item.code), ["VEL5017"]);

  // A keyed map that is not an interpolation leaf compiles to the rebuild-all
  // dynamic path, so the key would be silently meaningless without VEL5050.
  const wrapped = compile(`
def pick(rows: List<WebNode>) -> List<WebNode>:
    return rows

component Flow(names: List<string>):
    return <ul>{pick(names.map(name => <li key={name}>{name}</li>))}</ul>
`.trimStart());
  assert.deepEqual(wrapped.diagnostics.map((item) => item.code), ["VEL5050"]);
  assert.match(wrapped.diagnostics[0]?.message ?? "", /items\.map\(item => <Row key=\{item\.id\} \/>\)/u);
  assert.match(wrapped.diagnostics[0]?.message ?? "", /'\?:' branch/u);

  const lonelyBranchKey = compile(`
component Flow(names: List<string>):
    return <ul>{names.size == 0 ? <li key="empty">empty</li> : names.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(lonelyBranchKey.diagnostics.map((item) => item.code), ["VEL5050"]);

  // Honored shapes stay silent: a keyed leaf, a keyed branch, and a keyed
  // list nested inside another keyed body's interpolation.
  const honored = compile(`
type Row:
    id: string
    tags: List<string>

component Flow(rows: List<Row>):
    return <ul>{rows.map(row => <li key={row.id}><span>{row.tags.map(tag => <em key={tag}>{tag}</em>)}</span></li>)}</ul>
`.trimStart());
  assert.deepEqual(honored.diagnostics, []);
});

test("reactive props update child components in place without destroying their state", () => {
  const result = compile(`
type Row:
    id: string

state busy = false
state banner = "b0"
state showFirst = true
state rows: List<Row> = [{id: "a"}, {id: "b"}, {id: "c"}]
let stamps = 0

component Field(label: string, busy: bool = false):
    state draft = "d0"
    watch busy:
        draft = draft + "|" + label + ":" + (busy ? "on" : "off")
    watch draft:
        print("draft:" + draft)
    @mounted:
        print("mounted:" + label)
    @cleanup:
        print("cleanup:" + label)
    return <section data-busy={busy ? "yes" : "no"}>{draft}</section>

component RowView(row: Row):
    stamps += 1
    const stamp = stamps
    @mounted:
        print("row-mounted:" + row.id)
    @cleanup:
        print("row-cleanup:" + row.id)
    return <article data-id={row.id} data-stamp={stamp}></article>

component PropsApp:
    return <main><p>{banner}</p><Field label="alpha" busy={busy} /></main>

component BranchApp:
    return <div>{showFirst ? <Field label="one" /> : <Field label="two" />}</div>

component ListApp:
    return <ul>{rows.map(row => <RowView key={row.id} row={row} />)}</ul>

mount(<PropsApp />, "#props")
mount(<BranchApp />, "#branch")
mount(<ListApp />, "#list")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  // A component element becomes a stable child instance fed by per-prop
  // observers; the child function itself must not run inside a tracked read.
  assert.match(result.code ?? "", /__velarChild\(Field, \{ label: \(\) => \("alpha"\), busy: \(\) => \(busy\.get\(\)\) \}, undefined, __velarComponentScope, __velarNamespace\)/u);
  assert.match(result.code ?? "", /const busy = __velarProp\(__velarProps, "busy", \(\) => \(false\)\);/u);
  assert.match(result.code ?? "", /const label = __velarRequiredProp\(__velarProps, "label", "Field"\);/u);
  assert.doesNotMatch(result.code ?? "", /__velarDynamic\(__velarElement\d+, \(__velarChildScope\) => __velarChild/u);

  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", value = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.value = value;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
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
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
}
const targets = new Map([
  ["#props", new FakeNode(1, "root")],
  ["#branch", new FakeNode(1, "root")],
  ["#list", new FakeNode(1, "root")],
]);
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createTextNode(value) { return new FakeNode(3, "", String(value)); },
  createComment(value) { return new FakeNode(8, "", String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return targets.get(selector) ?? null; },
};
function dumpNode(node) {
  if (node.nodeType === 3) return node.value;
  if (node.nodeType === 8) return "";
  const attributes = [...node.attributes.entries()].map(([name, value]) => " " + name + "=" + JSON.stringify(String(value))).join("");
  return "<" + node.tagName + attributes + ">" + node.childNodes.map(dumpNode).join("") + "</" + node.tagName + ">";
}
function dump(selector) { return targets.get(selector).childNodes.map(dumpNode).join(""); }
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
await flush();
console.log("props:" + dump("#props"));
console.log("branch:" + dump("#branch"));
console.log("list:" + dump("#list"));
console.log("phase:busy-on");
busy.set(true);
await flush();
console.log("props:" + dump("#props"));
console.log("phase:busy-off");
busy.set(false);
await flush();
console.log("props:" + dump("#props"));
console.log("phase:banner");
banner.set("b1");
await flush();
console.log("props:" + dump("#props"));
console.log("phase:branch-swap");
showFirst.set(false);
await flush();
console.log("branch:" + dump("#branch"));
console.log("phase:reorder");
rows.set([...rows.get()].reverse());
await flush();
console.log("list:" + dump("#list"));
console.log("phase:removal");
rows.set([rows.get()[2]]);
await flush();
console.log("list:" + dump("#list"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // Mount order: lifecycle runs once per instance.
    "mounted:alpha",
    "mounted:one",
    "row-mounted:a",
    "row-mounted:b",
    "row-mounted:c",
    'props:<main><p>b0</p><section data-busy="no">d0</section></main>',
    'branch:<div><section data-busy="no">d0</section></div>',
    'list:<ul><article data-id="a" data-stamp="1"></article><article data-id="b" data-stamp="2"></article><article data-id="c" data-stamp="3"></article></ul>',
    // (a)+(e): a reactive prop update reaches the child in place; local state
    // survives and no cleanup/mounted runs.
    "phase:busy-on",
    "draft:d0|alpha:on",
    'props:<main><p>b0</p><section data-busy="yes">d0|alpha:on</section></main>',
    "phase:busy-off",
    "draft:d0|alpha:on|alpha:off",
    'props:<main><p>b0</p><section data-busy="no">d0|alpha:on|alpha:off</section></main>',
    // (b): a parent re-render around the child leaves the instance alone.
    "phase:banner",
    'props:<main><p>b1</p><section data-busy="no">d0|alpha:on|alpha:off</section></main>',
    // (c): switching a conditional branch destroys and recreates.
    "phase:branch-swap",
    "cleanup:one",
    "mounted:two",
    'branch:<div><section data-busy="no">d0</section></div>',
    // (d): a keyed reorder moves instances without lifecycle churn.
    "phase:reorder",
    'list:<ul><article data-id="c" data-stamp="3"></article><article data-id="b" data-stamp="2"></article><article data-id="a" data-stamp="1"></article></ul>',
    "phase:removal",
    "row-cleanup:c",
    "row-cleanup:b",
    'list:<ul><article data-id="a" data-stamp="1"></article></ul>',
    "",
  ].join("\n"));
});

test("reactive Component identity remounts the selected child and forwards the host contract", () => {
  const result = compile(`
type SwitchView = Component<(label: string) -> WebNode>

state currentView: SwitchView = Alpha
state label = "one"
let alphaBuilds = 0
let betaBuilds = 0

const outerLook = look:
    color = "red"

component Alpha(label: string):
    alphaBuilds += 1
    const stamp = alphaBuilds
    @mounted:
        print("mounted:alpha")
    @cleanup:
        print("cleanup:alpha")
    return <article class="alpha" data-stamp={stamp}>{label}</article>

component Beta(label: string):
    betaBuilds += 1
    const stamp = betaBuilds
    @mounted:
        print("mounted:beta")
    @cleanup:
        print("cleanup:beta")
    return <section class="beta" data-stamp={stamp}>{label}</section>

component Host(View: SwitchView, label: string):
    return <View label={label} />

component App:
    return <Host View={currentView} label={label} class="outer" look={outerLook} />

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarDynamicComponent\(\(__velarDynamicScope\) => __velarChild\(View\.get\(\)/u);

  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", textContent = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.textContent = textContent;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.classNames = new Set();
    this.classList = {
      add: (...names) => { for (const name of names) this.classNames.add(name); },
      remove: (...names) => { for (const name of names) this.classNames.delete(name); },
      [Symbol.iterator]: () => this.classNames[Symbol.iterator](),
    };
    const properties = new Map();
    this.style = {
      properties,
      setProperty: (name, value) => properties.set(name, String(value)),
      removeProperty: (name) => properties.delete(name),
    };
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
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.classNames = new Set(String(value).split(/\\s+/).filter(Boolean));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.classNames.clear();
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelectorAll() {
    const output = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) output.push(child);
        visit(child);
      }
    };
    visit(this);
    return output;
  }
}
const target = new FakeNode(1, "root");
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement(tag) { return new FakeNode(1, tag); },
  createTextNode(value) { return new FakeNode(3, "", String(value)); },
  createComment(value) { return new FakeNode(8, "", String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#app" ? target : null; },
};
function host() { return target.childNodes.find((node) => node.nodeType === 1); }
function text(node) { return node.nodeType === 3 ? node.textContent : node.childNodes.map(text).join(""); }
function snapshot() {
  const node = host();
  return [node.tagName, [...node.classNames].sort().join("."), node.style.properties.get("--velar-look-base-color"), node.getAttribute("data-stamp"), text(node)].join(":");
}
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
await flush();
console.log("initial:" + snapshot());
console.log("phase:label");
label.set("two");
await flush();
console.log("label:" + snapshot());
console.log("phase:beta");
currentView.set(Beta);
await flush();
console.log("beta:" + snapshot());
console.log("phase:alpha");
currentView.set(Alpha);
await flush();
console.log("alpha:" + snapshot());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "mounted:alpha",
    "initial:article:alpha.outer:red:1:one",
    "phase:label",
    "label:article:alpha.outer:red:1:two",
    "phase:beta",
    "cleanup:alpha",
    "mounted:beta",
    "beta:section:beta.outer:red:1:two",
    "phase:alpha",
    "cleanup:beta",
    "mounted:alpha",
    "alpha:article:alpha.outer:red:2:two",
    "",
  ].join("\n"));
});

test("checks accessible button names and safe native links", () => {
  const invalid = compile(`
component App:
    return <main>
        <button></button>
        <a>Missing href</a>
        <a href="https://example.com" target="_blank">Unsafe target</a>
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5026"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5027"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5028"));

  const valid = compile(`
component App:
    return <main>
        <button aria-label="Save"></button>
        <a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>
    </main>
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
});
