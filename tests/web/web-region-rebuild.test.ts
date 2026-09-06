import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

// D114 P6 item 3 (0.29.0 Web ledger JX-C1): what actually rebuilds an
// interpolation region.
//
// web-api said a component element inside an interpolation "is rebuilt whenever
// anything that interpolation reads changes, `draft` included", and drew a
// remedy from it — move the element out, or give the position a key, when the
// instance is meant to live across updates. The implementation is narrower and
// better: a read that decides the region's *shape* rebuilds it, and a read
// inside a prop expression keeps the instance alive and updates it in place. So
// the remedy answered a behaviour that does not exist, and the documentation
// moves to the implementation.
//
// This is the ledger's JX-R9 probe as a test, because a promise about which
// instances survive an update is worth exactly as much as the evidence for it.

// Enough of a document to run emitted Web output under `node --test`: the two
// regions here are read through the lifecycle hooks they print from and the
// text their nodes carry.
const dom = `
class FakeNode {
  constructor(nodeType = 1, value = "") {
    this.nodeType = nodeType;
    this.value = value;
    this.childNodes = [];
    this.attributes = new Map();
    this.parentNode = null;
  }
  adopt(child, index) {
    if (child.nodeType === 11) {
      const moved = child.childNodes.splice(0);
      for (const node of moved) { node.parentNode = null; this.adopt(node, index); index += 1; }
      return;
    }
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
const shown = () => readText(target);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
`;

/** The ledger's JX-R9 program: one region whose only read is a prop, one whose read decides its shape. */
const application = `
state draft = "d1"
state tag = "t1"

component Preview(text: string):
    @mounted:
        print(f"mounted {text}")
    @cleanup:
        print(f"cleanup {text}")
    return <b>{text}</b>

component Empty():
    return <i>empty</i>

component App():
    return <div>
        {<Preview text={draft} />}
        {tag == "" ? <Empty /> : <Preview text={f"tagged {tag}"} />}
    </div>
`;

function run(source: string, probe: string): string {
  const result = compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${dom}\n${result.code ?? ""}\n${probe}`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

test("[JX-C1] a prop read keeps the instance and updates it; a read that decides the region's shape rebuilds", () => {
  const output = run(application, `
const app = App();
app.mount("#app");
await settle();
console.log("--- draft ---");
draft.set("d2");
await settle();
console.log("text " + shown());
console.log("--- tag ---");
tag.set("t2");
await settle();
console.log("text " + shown());
`);
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), [
    "mounted d1",
    "mounted tagged t1",
    "--- draft ---",
    // No cleanup/mounted pair: `draft` is read by a prop expression, so the
    // instance lives and the text it renders is updated in place.
    "text d2tagged t1",
    "--- tag ---",
    // `tag` is read by the region's condition, which is what decides the
    // region's shape, so the region is rebuilt and the instance is replaced.
    "cleanup tagged t2",
    "mounted tagged t2",
    "text d2tagged t2",
  ]);
});

test("[JX-C1] a branch that never flips still does not rebuild for a prop read", () => {
  // The stronger half of the same fact, stated on its own: the ternary is not
  // what makes the region rebuild — the condition's dependency is.
  const output = run(`
state draft = "d1"
state shownFlag = true

component Preview(text: string):
    @mounted:
        print(f"mounted {text}")
    @cleanup:
        print(f"cleanup {text}")
    return <b>{text}</b>

component Empty():
    return <i>empty</i>

component App():
    return <div>{shownFlag ? <Preview text={draft} /> : <Empty />}</div>
`, `
const app = App();
app.mount("#app");
await settle();
draft.set("d2");
await settle();
console.log("text " + shown());
`);
  assert.deepEqual(output.split("\n").filter((line) => line !== ""), ["mounted d1", "text d2"]);
});
