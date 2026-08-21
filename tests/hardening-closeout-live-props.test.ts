import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleSource } from "../packages/web/src/compiler.ts";

/**
 * D90's R4-b revision (closeout co-1): `charter:3140` says a component element
 * evaluates its props from left to right, then its children, then the component
 * function. The implementation evaluated nothing at the call site — every prop
 * went out as a thunk and the component body forced them one at a time, in the
 * order the *callee* declared its parameters. Written order is what a person
 * writing an object literal expects, so the implementation moves to the rule.
 *
 * D90's R4-a revision (co-4) and co-8: `Head`, `Router`, `Link` and `NavLink`
 * are four framework components that sat on two behaviours — one live, three
 * snapshotting through a `__velarSnapshotProps` branch whose own comment named
 * a component that could not reach it. All four take live props, and the branch
 * is gone rather than left unreachable.
 */
function compile(source: string): ReturnType<typeof compileCore> {
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

function emitted(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return result.code ?? "";
}

/**
 * Enough of a document to run emitted Web output under `node --test`: the
 * reactive graph and the prop store are what these tests read, and they only
 * need nodes that can be appended, moved and removed.
 */
const dom = `
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
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return new FakeNode(3, String(value)); },
  createComment(value) { return new FakeNode(8, String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
};
const readText = (node) => node.nodeType === 3 ? node.value : node.childNodes.map(readText).join("");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
`;

function execute(code: string, probe: string): string {
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${dom}\n${code}\n${probe}`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

// `trace` is an ordinary `let`, not state, so recording a prop expression's run
// does not make that expression depend on the record and re-run itself.
const orderedApplication = `
let trace = ""
state pulse: number = 0
state seed: number = 1

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Child(first: string, second: string, spare: string, shown: string):
    trace = trace + "|body|"
    return <p>{first}{second}{shown}</p>

component App:
    return <div><Child second={note("b")} first={note("a")} spare={note("u")} shown={note("s") + str(seed)} /></div>
`.trimStart();

test("[closeout co-1] a component element evaluates its props at the call site in written order", () => {
  const code = emitted(orderedApplication);
  // The call site still hands the runtime one thunk per prop, in written order,
  // and the component body still declares its parameters in its own order. What
  // changed is who runs the thunks: the instantiation site, before the call.
  assert.match(code, /__velarChild\(Child, \{ second: \(\) => \(note\("b"\)\), first: \(\) => \(note\("a"\)\), spare: \(\) => \(note\("u"\)\), shown: /u);
  assert.match(code, /const first = __velarRequiredProp\(__velarProps, "first", "Child"\);\n\s*const second = __velarRequiredProp/u);
  assert.match(code, /for \(let index = 0; index < accesses\.length; index \+= 1\) accesses\[index\]\.get\(\);/u);

  const stdout = execute(code, `
const app = App();
console.log("construct:" + trace + ":" + readText(app.node));
await flush();
console.log("mounted:" + trace);
pulse.set(pulse.get() + 1);
await flush();
console.log("unrelated:" + trace);
seed.set(2);
await flush();
console.log("seed:" + trace + ":" + readText(app.node));
`);
  assert.equal(stdout, [
    // 'b' before 'a' because the caller wrote 'second' before 'first', every
    // prop exactly once, and all of them before the component body ran. The
    // unread 'spare' is evaluated with the rest: the charter promises the
    // expression runs, not that someone reads it.
    "construct:baus|body|:abs1",
    // Nothing re-runs on mount, and nothing re-runs for a state the props do
    // not read -- that is R4-b's other half, which this change keeps.
    "mounted:baus|body|",
    "unrelated:baus|body|",
    // Only the prop built from 'seed' recomputes, and the position that shows
    // it takes the new value.
    "seed:baus|body|s:abs2",
    "",
  ].join("\n"));
});

test("[closeout co-1] the module-level instantiation site forces its props the same way", () => {
  // A component element outside any component scope emits a bare
  // __velarInstantiate rather than __velarChild; both reach the same store, so
  // both owe the caller the same evaluation order.
  const application = `
let trace = ""

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Child(first: string, second: string):
    trace = trace + "|body|"
    return <p>{first}{second}</p>

const root = <Child second={note("b")} first={note("a")} />
`.trimStart();
  const code = emitted(application);
  assert.match(code, /const root = __velarInstantiate\(Child, \{ second: \(\) => \(note\("b"\)\), first: \(\) => \(note\("a"\)\) \}/u);
  assert.equal(execute(code, `
console.log("root:" + trace + ":" + readText(root.node));
`), "root:ba|body|:ab\n");
});

test("[closeout co-1] a 'style:' directive decorates the instance root and is not a prop", () => {
  // The slot the compiler inserts for `style:` is not a field any component
  // declares, so it is bound at the instantiation site for every component
  // alike rather than forced with the props and handed inward -- which is also
  // what lets a component the runtime implements, validating its props against
  // the fields it declares, be a style host at all.
  const application = `
let trace = ""
state tone: string? = "purple"

def note(mark: string) -> string:
    trace = trace + mark
    return mark

component Child(first: string):
    return <p>{first}</p>

component App:
    return <div><Child style:color={tone} first={note("a")} /></div>
`.trimStart();
  const code = emitted(application);
  assert.match(code, /__velarStyle: \(\) => \(/u);
  // The slot never reaches the props store, and no component body binds it any
  // more: one site owns it, for every component.
  assert.match(code, /if \(name === "__velarStyle"\) continue;/u);
  assert.match(code, /if \(styleRead !== undefined\) __velarStyleBindRoot\(instance\.node, styleRead, scope\);/u);
  assert.doesNotMatch(code, /__velarProps\.__velarStyle/u);
  assert.equal(execute(code, `
const app = App();
const child = app.node.childNodes[0];
const read = () => child.style.properties.get("color") ?? "missing";
console.log("construct:" + trace + ":" + read());
tone.set("orange");
await flush();
console.log("updated:" + trace + ":" + read());
app.destroy();
console.log("cleanup:" + read());
`), [
    // Only the prop ran at the call site; the style is bound to the root the
    // component returned, and it follows the state it was built from.
    "construct:a:purple",
    "updated:a:orange",
    "cleanup:missing",
    "",
  ].join("\n"));
});

test("[closeout co-4, co-8] the snapshot-props branch and its flag are gone", () => {
  // Leaving a branch nothing can reach is what this audit kept finding, so the
  // mechanism goes with its last user rather than staying behind a dead flag.
  const runtime = webModuleSource("velar/web") ?? "";
  assert.ok(runtime.length > 0);
  assert.doesNotMatch(runtime, /__velarSnapshotProps/u);
  assert.doesNotMatch(emitted("component App:\n    return <p>ok</p>\n"), /__velarSnapshotProps/u);
});

test("[closeout co-4] all four framework components validate live props and read them where they are used", () => {
  const runtime = webModuleSource("velar/web") ?? "";
  // One rule for four siblings: reactive state changed, the component updates.
  for (const name of ["Head props", "Router props", "Link props", "NavLink props"]) {
    assert.match(runtime, new RegExp(`__velarLiveOptions\\(props, "${name}"`, "u"));
  }
  for (const detail of ["\"head\", \"Head\"", "\"router\", \"Router\"", "\"link\", \"Link\"", "\"navlink\", \"NavLink\""]) {
    assert.ok(runtime.includes(`}, ${detail});`), `missing observer for ${detail}`);
  }
  // A NavLink hands its Link the live fields rather than a copy of their
  // values, so the wrapped href moves with the state the target is built from.
  assert.match(runtime, /get to\(\) \{ return props\.to; \}/u);
  // Reading props inside an observer is what makes a component live; building a
  // subtree there is not, so a Router's route target keeps its own reads.
  assert.match(runtime, /const next = webUntracked\(\(\) => \(match \? match\.item\.component/u);
});
