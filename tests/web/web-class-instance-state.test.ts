import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

// D114 P6 item 7 (0.29.0 Web ledger ST-U4): class instances in `state` are not
// wrapped, and the development host detects the stale read.
//
// The mechanism is web-api's and is not changing: "Classes ... are never
// wrapped", because a proxy over an instance would change what `self` is and
// what identity means. The consequence had no name and no detector.
// `state box = Counter()` with `computed shown = box.value` compiles clean,
// renders once, and never moves again — `box.bump()` writes a field nothing is
// watching — so the page shows a number that is quietly wrong, with no
// diagnostic anywhere. Only replacing the whole cell publishes.
//
// So the development host now says it, once, naming the state cell, the class
// and the field, through the same channel the frozen-read detector uses. A
// production build publishes no hooks and pays nothing.

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
const readText = (node) => node.nodeType === 3 ? node.value : node.childNodes.map(readText).join("");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
`;

// The development host publishes its hooks before the entry module loads, which
// is what makes their absence the whole of a production build's cost. The
// stand-in does the same and records the reports rather than mapping them back
// to a source line.
const developmentHooks = `
globalThis.__velarDevelopmentHooks = { frozenRead: (report) => { console.log("dev: " + report.message); } };
`;

/** The ledger's ST-U4 program. */
const application = `
class Counter:
    let value: number = 0
    def bump():
        self.value = self.value + 1

state box = Counter()
computed shown = box.value

watch shown:
    print(f"watch {shown}")

component App():
    return <p>{str(shown)}</p>
`;

function run(source: string, probe: string, host: "development" | "production"): string {
  const result = compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${dom}\n${host === "development" ? developmentHooks : ""}\n${result.code ?? ""}\n${probe}`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

const probe = `
const app = App();
app.mount("#app");
await settle();
console.log("start " + readText(target));
box.get().bump();
await settle();
console.log("after bump shown=" + shown.get() + " value=" + box.get().value);
const replacement = new Counter();
replacement.bump();
replacement.bump();
box.set(replacement);
await settle();
console.log("after replace " + readText(target));
`;

test("[ST-U4] the development host reports once, naming the state cell, the class and the field", () => {
  assert.deepEqual(run(application, probe, "development").split("\n").filter((line) => line !== ""), [
    "dev: This reactive value reads 'value' on the Counter held in state 'box'."
    + " A class instance is never wrapped, so changing 'value' publishes nothing and this value stays as it is:"
    + " only replacing the cell -- 'box = Counter(...)' -- publishes."
    + " Hold the field in its own 'state' if it is meant to be followed.",
    "start 0",
    // The defect the report is about: the field moved and the derived value did not.
    "after bump shown=0 value=1",
    // Replacing the cell publishes, which is what the report says to do.
    "watch 2",
    "after replace 2",
  ]);
});

test("[ST-U4] a production build is silent and behaves identically", () => {
  assert.deepEqual(run(application, probe, "production").split("\n").filter((line) => line !== ""), [
    "start 0",
    "after bump shown=0 value=1",
    "watch 2",
    "after replace 2",
  ]);
});

test("[ST-U4] a watch whose subject is the field earns the same one report", () => {
  // A watch tracks its subject and runs its body untracked, so the subject is
  // where a watch can be stale: `watch box.value:` registers no dependency on
  // anything (the instance is not wrapped) and therefore never fires.
  const output = run(`
class Counter:
    let value: number = 0
    def bump():
        self.value = self.value + 1

state box = Counter()

watch box.value:
    print("watch ran")

component App():
    return <p>{str(box.value)}</p>
`, `
const app = App();
app.mount("#app");
await settle();
box.get().bump();
await settle();
console.log("value " + box.get().value + " text " + readText(target));
`, "development");
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), [
    "dev: This reactive value reads 'value' on the Counter held in state 'box'."
    + " A class instance is never wrapped, so changing 'value' publishes nothing and this value stays as it is:"
    + " only replacing the cell -- 'box = Counter(...)' -- publishes."
    + " Hold the field in its own 'state' if it is meant to be followed.",
    // The watch never ran, and the rendered text never moved: the report is
    // about a fact the page can be measured for.
    "value 1 text 0",
  ]);
});

test("[ST-U4] a watch body reads the field live on every run, so there is nothing to report", () => {
  // The boundary of the detector, stated as a test rather than a caveat: a
  // watch body runs untracked and reads whatever the field holds at that
  // moment, so it is not stale and is not reported about.
  const output = run(`
class Counter:
    let value: number = 0
    def bump():
        self.value = self.value + 1

state box = Counter()
state pulse = 0

watch pulse:
    print(f"pulse {pulse} value {box.value}")

component App():
    return <p>{str(pulse)}</p>
`, `
const app = App();
app.mount("#app");
await settle();
box.get().bump();
pulse.set(1);
await settle();
box.get().bump();
pulse.set(2);
await settle();
`, "development");
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), ["pulse 1 value 1", "pulse 2 value 2"]);
});

test("[ST-U4] a record in state is wrapped, so nothing is reported about it", () => {
  const output = run(`
type Box:
    value: number

state box: Box = {value: 0}
computed shown = box.value

component App():
    return <p>{str(shown)}</p>
`, `
const app = App();
app.mount("#app");
await settle();
console.log("start " + readText(target));
box.get().value = 3;
await settle();
console.log("after write " + readText(target));
`, "development");
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), ["start 0", "after write 3"]);
});

test("[ST-U4] a class instance a reactive value never reads a field of is not reported", () => {
  const output = run(`
class Counter:
    let value: number = 0
    def bump():
        self.value = self.value + 1

state box = Counter()
state pulse = 0

component App():
    return <p>{str(pulse)}</p>
`, `
const app = App();
app.mount("#app");
await settle();
box.get().bump();
pulse.set(1);
await settle();
console.log("value " + box.get().value);
console.log("text " + readText(target));
`, "development");
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), ["value 1", "text 1"]);
});

// The neighbour F7-web left open. A DOM interpolation reading a field of an
// unwrapped instance is the same permanent staleness one step closer to the
// page: the text node is written once, `box.bump()` publishes nothing, and the
// number on screen is wrong for as long as the page lives. So the rendering
// tier reports through the same channel, in the same sentence, with the reader
// it actually is.

const interpolated = `
class Counter:
    let value: number = 0
    def bump():
        self.value = self.value + 1

state box = Counter()

component App():
    return <p>{str(box.value)}</p>
`;

const interpolationProbe = `
const app = App();
app.mount("#app");
await settle();
console.log("start " + readText(target));
box.get().bump();
await settle();
console.log("after bump text=" + readText(target) + " value=" + box.get().value);
const replacement = new Counter();
replacement.bump();
replacement.bump();
box.set(replacement);
await settle();
console.log("after replace " + readText(target));
`;

const interpolationReport = "dev: This interpolation reads 'value' on the Counter held in state 'box'."
  + " A class instance is never wrapped, so changing 'value' publishes nothing and this interpolation stays as it is:"
  + " only replacing the cell -- 'box = Counter(...)' -- publishes."
  + " Hold the field in its own 'state' if it is meant to be followed.";

test("[ST-U4] an interpolation earns the same report, naming the cell, the class and the field", () => {
  assert.deepEqual(run(interpolated, interpolationProbe, "development").split("\n").filter((line) => line !== ""), [
    interpolationReport,
    "start 0",
    // The defect the report is about: the field moved and the text did not.
    "after bump text=0 value=1",
    // And the remedy it names works: replacing the cell publishes, and the
    // interpolation renders the new instance's field.
    "after replace 2",
  ]);
});

test("[ST-U4] the interpolation's report is a development build's, and is made once", () => {
  // Once per state cell, class and field, however many positions read it: two
  // interpolations of one field are one mistake with one remedy.
  const output = run(`
class Counter:
    let value: number = 0
    def bump():
        self.value = self.value + 1

state box = Counter()

component App():
    return <p><span>{str(box.value)}</span><span>{str(box.value)}</span></p>
`, `
const app = App();
app.mount("#app");
await settle();
console.log("text " + readText(target));
`, "development");
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), [interpolationReport, "text 00"]);
  assert.deepEqual(run(interpolated, interpolationProbe, "production").split("\n").filter((line) => line !== ""), [
    "start 0",
    "after bump text=0 value=1",
    "after replace 2",
  ]);
});

test("[ST-U4] an interpolation over a record in state is tracked, so nothing is reported about it", () => {
  const output = run(`
type Box:
    value: number

state box: Box = {value: 0}

component App():
    return <p>{str(box.value)}</p>
`, `
const app = App();
app.mount("#app");
await settle();
console.log("start " + readText(target));
box.get().value = 3;
await settle();
console.log("after write " + readText(target));
`, "development");
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), ["start 0", "after write 3"]);
});
