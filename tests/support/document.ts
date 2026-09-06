/**
 * D115 §一.6 — the document stand-in emitted Web output runs against under
 * `node --test`.
 *
 * Data, not behaviour: a string of JavaScript the test prepends to the
 * program it executes. The reactive graph and the prop store are what the
 * tests read, and those only need nodes that can be appended, moved and
 * removed.
 */
export const documentStandIn = `
class FakeNode {
  constructor(nodeType = 1, value = "") {
    this.nodeType = nodeType;
    this.value = value;
    this.childNodes = [];
    this.attributes = new Map();
    this.parentNode = null;
    const properties = new Map();
    const priorities = new Map();
    this.style = {
      properties,
      getPropertyValue: (name) => properties.get(name) ?? "",
      getPropertyPriority: (name) => priorities.get(name) ?? "",
      setProperty: (name, next, priority = "") => {
        properties.set(name, String(next));
        if (priority) priorities.set(name, priority); else priorities.delete(name);
      },
      removeProperty: (name) => { properties.delete(name); priorities.delete(name); },
    };
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
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return new FakeNode(3, String(value)); },
  createComment(value) { return new FakeNode(8, String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
};
const readText = (node) => node.nodeType === 3 ? node.value : node.childNodes.map(readText).join("");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
`;
