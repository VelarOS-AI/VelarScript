import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

// D114 P6 item 5 (0.29.0 Web ledger LC-C2): a dynamic region that throws while
// it is first constructed leaves an accessible marker.
//
// web-api's §`velar/app` promised the compiler-owned accessible fatal state
// covers "every initial-render path in every build", and named "a dynamic or
// keyed region that throws while it is first constructed" among them. The root
// kept the promise; the region left `<!--velar:component-error-->` — invisible
// to the reader and to assistive technology alike. So the sentence was true of
// one node and false one node in.
//
// The region now renders the same element the root does — `role="alert"`,
// `data-velar-fatal`, one sentence naming what failed — scoped to the position
// it could not build. Everything else about the design is unchanged and is
// asserted here: the isolation (siblings mount and keep running) and the
// `render` phase of the report.

const dom = `
class FakeNode {
  constructor(nodeType = 1, value = "") { this.nodeType = nodeType; this.value = value; this.childNodes = []; this.attributes = new Map(); this.parentNode = null; }
  adopt(child, index) {
    if (child.nodeType === 11) { const moved = child.childNodes.splice(0); for (const node of moved) { node.parentNode = null; this.adopt(node, index); index += 1; } return; }
    if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
  }
  append(...values) { for (const child of values) this.adopt(child, this.childNodes.length); }
  insertBefore(child, before) { this.adopt(child, before === null ? this.childNodes.length : this.childNodes.indexOf(before)); return child; }
  before(...values) { const parent = this.parentNode; if (parent) for (const child of values) parent.adopt(child, parent.childNodes.indexOf(this)); }
  replaceChildren(...values) { for (const child of this.childNodes.splice(0)) child.parentNode = null; for (const child of values) this.adopt(child, this.childNodes.length); }
  remove() { const parent = this.parentNode; if (!parent) return; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  get textContent() { return this.nodeType === 3 ? this.value : this.childNodes.map((child) => child.textContent).join(""); }
  set textContent(next) { this.childNodes.splice(0); this.append(globalThis.document.createTextNode(String(next))); }
}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.value; }, set(next) { this.value = String(next); } });
const target = new FakeNode();
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return new FakeNode(3, String(value)); },
  createComment(value) { return new FakeNode(8, String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#app" ? target : null; },
};
const alerts = (node, found = []) => {
  if (node.nodeType === 1 && node.attributes.get("role") === "alert" && node.attributes.has("data-velar-fatal")) found.push(node);
  for (const child of node.childNodes) alerts(child, found);
  return found;
};
const comments = (node, found = []) => {
  if (node.nodeType === 8) found.push(node.value);
  for (const child of node.childNodes) comments(child, found);
  return found;
};
const readText = (node) => node.nodeType === 3 ? node.value : node.childNodes.map(readText).join("");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
// A failure no handler claimed reaches the browser as the host 'error' event
// and the page survives it; under \`node --test\` the same microtask throw is an
// uncaught exception, so this stands in for the host and keeps the process
// alive to be measured.
process.on("uncaughtException", (error) => { console.log("host " + error.message); });
`;

/** The ledger's LC-B7 region beside its LC-B5 sibling: one position fails, the other must not. */
const application = `
state ready = true
state pulse = 0

def boom() -> string:
    throw Error("region failed")

component Bad():
    return <p>{boom()}</p>

component Empty():
    return <i>empty</i>

component Good():
    @mounted:
        print("good mounted")
    watch pulse:
        print(f"good watch {pulse}")
    return <p>good</p>

component App():
    return <div>{ready ? <Bad /> : <Empty />}<Good /></div>
`;

function run(source: string, probe: string): string {
  const result = compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    // The failure is reported into the error chain; a handler claims it so the
    // run measures the marker rather than the escalation path LC-C1 owns.
    input: `${dom}\n${result.code ?? ""}
const runtime = globalThis[Symbol.for("velar.runtime.v1")];
runtime.errorHandlers.add((report) => { console.log("report " + report.phase + "|" + report.error.message); });
${probe}`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

test("[LC-C2] a region that throws while first constructed renders the accessible fatal state", () => {
  const output = run(application, `
const app = App();
app.mount("#app");
await settle();
const found = alerts(target);
console.log("alerts " + found.length);
console.log("text " + readText(found[0]));
console.log("comments " + JSON.stringify(comments(target)));
`);
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), [
    "report render|region failed",
    "good mounted",
    "alerts 1",
    "text This part of the page could not start: region failed",
    // The marker replaces the comment that used to stand there; the region's
    // own start/end markers are untouched, because they are how the region
    // finds its own content on the next update.
    'comments ["velar:start","velar:end"]',
  ]);
});

test("[LC-C2] the isolation is unchanged: the sibling mounts and keeps updating", () => {
  const output = run(application, `
const app = App();
app.mount("#app");
await settle();
pulse.set(1);
await settle();
console.log("text " + readText(target));
`);
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), [
    "report render|region failed",
    "good mounted",
    "good watch 1",
    "text This part of the page could not start: region failedgood",
  ]);
});

test("[LC-C2] the root's own fatal state is the same element, with the root's wording", () => {
  const output = run(`
def boom() -> string:
    throw Error("root failed")

component App():
    return <p>{boom()}</p>

@main:
    mount(<App />, "#app")
`, `
await settle();
const found = alerts(target);
console.log("alerts " + found.length);
console.log("text " + readText(found[0]));
`);
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), [
    "host root failed",
    "alerts 1",
    "text The application could not start: root failed",
  ]);
});
