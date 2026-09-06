import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { executeModule } from "../support/execute-module.ts";
import { compile } from "../support/compiler-suite.ts";

test("enforces component lifecycle cardinality", () => {
  const duplicate = compile(`
component App:
    @mounted:
        print("first")
    @mounted:
        print("second")
    @cleanup:
        print("first")
    @cleanup:
        print("second")
    return <main></main>
`.trimStart());

  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL5009"));
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL5010"));

  const nested = compile(`
component App:
    @mounted:
        @cleanup:
            print("nested")
    return <main></main>
`.trimStart());
  assert.equal(nested.code, null);
  assert.ok(nested.diagnostics.length > 0);

  const asynchronousMount = compile(`
async def prepare():
    return null

component App:
    @mounted:
        await prepare()
    return <main>ready</main>
`.trimStart());
  assert.deepEqual(asynchronousMount.diagnostics, []);
  assert.match(asynchronousMount.code ?? "", /async \(\) => \{[\s\S]*await __velarNormalizePromiseValue\(prepare\(\)\)/u);

  const asynchronousCleanup = compile(`
async def dispose():
    return null

component App:
    @cleanup:
        await dispose()
    return <main>ready</main>
`.trimStart());
  assert.ok(asynchronousCleanup.diagnostics.some((item) => item.code === "VEL4007"));
});

test("runs mounted and cleanup exactly once", () => {
  const result = compile(`
component App:
    @mounted:
        print("mounted")
    @cleanup:
        print("cleanup")
    return <main></main>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);

  const dom = `
class FakeNode {
  insertBefore(node) { this.child = node; }
  remove() { this.removed = true; }
  setAttribute() {}
}
const target = new FakeNode();
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode() { return new FakeNode(); },
  createComment() { return new FakeNode(); },
  querySelector() { return target; },
};
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}\nconst app = App();\napp.mount("#app");\napp.destroy();\napp.destroy();\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "mounted\ncleanup\n");
});

test("component roots update transactionally, own their current nodes, and mount only once", () => {
  const result = compile(`
state projectOpen = false
let childUpdate: (() -> null)? = null
let childInstances = 0

component Workspace:
    childInstances += 1
    state viewportStart = 0
    def scroll():
        viewportStart += 1
    childUpdate = scroll
    @mounted:
        const initialViewport = viewportStart
    return <main><div look:top={f"{viewportStart}px"}>{[viewportStart].map(row => <span key={row}>{row}</span>)}</div></main>

component App:
    @cleanup:
        print("cleanup")
    return projectOpen ? <Workspace /> : <section>welcome</section>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarDynamicComponent\(\(__velarDynamicScope\) => \(projectOpen\.get\(\) \?/u);

  const dom = `
class FakeNode {
  constructor(nodeType, tagName = "", textContent = "") {
    this.nodeType = nodeType;
    this.tagName = tagName;
    this.textContent = textContent;
    this.childNodes = [];
    this.parentNode = null;
    this.style = {
      getPropertyValue() { return ""; },
      getPropertyPriority() { return ""; },
      setProperty() {},
      removeProperty() {},
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
  querySelectorAll() { return []; }
  setAttribute() {}
  removeAttribute() {}
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
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const tags = () => target.childNodes.filter((node) => node.nodeType === 1).map((node) => node.tagName).join(",");
const app = App();
app.mount("#app");
console.log("initial:" + tags());
projectOpen.set(true);
await flush();
console.log("updated:" + tags());
childUpdate();
await flush();
console.log("child-update:" + tags() + ":" + childInstances);
try { app.mount("#app"); } catch (error) { console.log("remount:" + error.message); }
app.destroy();
console.log("destroyed:" + target.childNodes.length);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "initial:section",
    "updated:main",
    "child-update:main:1",
    "remount:Cannot mount a VelarScript component more than once",
    "cleanup",
    "destroyed:0",
    "",
  ].join("\n"));
});

test("Web runtime reports mount failures with a fatal fallback and continues cleanup steps", () => {
  const failedMount = compile(`
let activeHandles = 0

def acquireHandle() -> () -> null:
    activeHandles += 1
    def stop():
        activeHandles -= 1
    return stop

component Broken:
    const stopHandle = acquireHandle()
    @cleanup:
        print("construction-cleanup")
        throw Error("Construction cleanup failed")
        stopHandle()
    throw Error("Boot failed")
    return <main>unreachable</main>

mount(<Broken />, "#app")
print(activeHandles)
`.trimStart());
  assert.deepEqual(failedMount.diagnostics, []);

  const cleanup = compile(`
component Recovering:
    @cleanup:
        print("cleanup-before")
        throw Error("Cleanup failed")
        print("cleanup-after")
    return <main>ready</main>
`.trimStart());
  assert.deepEqual(cleanup.diagnostics, []);

  const dom = `
class FakeNode {
  constructor() { this.textContent = ""; }
  insertBefore(node) { this.child = node; }
  replaceChildren(node) { this.replaced = node; }
  remove() { this.removed = true; }
  setAttribute(name, value) { this[name] = value; }
  append() {}
}
const target = new FakeNode();
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode() { return new FakeNode(); },
  createComment() { return new FakeNode(); },
  querySelector() { return target; },
};
`;
  const failedCode = (failedMount.code ?? "").replace(
    "let activeHandles = 0;",
    '__velarRuntime.errorHandlers.add(report => console.log(report.phase + ":" + report.error.message));\nlet activeHandles = 0;',
  );
  const execution = executeModule(`${dom}\n${failedCode}\nconsole.log(target.replaced.role + ":" + target.replaced.textContent);\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "construction-cleanup\ncleanup:Construction cleanup failed\nmount:Boot failed\n0\nalert:The application could not start: Boot failed\n");

  const cleanupCode = (cleanup.code ?? "").replace(
    "function Recovering",
    '__velarRuntime.errorHandlers.add(report => console.log(report.phase + ":" + report.error.message));\nfunction Recovering',
  );
  const cleanupExecution = executeModule(`${dom}\n${cleanupCode}\nconst app = Recovering();\napp.mount("#app");\napp.destroy();\n`);
  assert.equal(cleanupExecution.status, 0, String(cleanupExecution.stderr));
  assert.equal(cleanupExecution.stdout, "cleanup-before\ncleanup:Cleanup failed\ncleanup-after\n");
});

test("checks component props and Web directive targets", () => {
  const reactiveProps = compile(`
component Badge(label: string):
    return <span>{label}</span>

component App:
    state label = "ready"
    return <main><Badge label={label} /></main>
`.trimStart());
  assert.deepEqual(reactiveProps.diagnostics, []);
  assert.match(reactiveProps.code ?? "", /__velarAppend\(__velarElement\d+, __velarChild\(Badge, \{ label: \(\) => \(label\.get\(\)\) \}, undefined, __velarComponentScope, __velarNamespace\)\)/u);

  const props = compile(`
component Badge(label: string):
    return <span>{label}</span>

component App:
    return <main><Badge missing="value" /></main>
`.trimStart());
  assert.ok(props.diagnostics.some((item) => item.code === "VEL5012" && /label/.test(item.message)));
  assert.ok(props.diagnostics.some((item) => item.code === "VEL5013" && /missing/.test(item.message)));

  const directives = compile(`
component Form:
    const name = "Ada"
    return <div>
        <input bind:value={name} />
        <span on:click={name}>Wrong</span>
        <img src="avatar.png" />
    </div>
`.trimStart());
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5019"));
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5021"));
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5023"));
  assert.ok(directives.diagnostics.some((item) => item.code === "VEL5016"));

  const correctRef = compile(`
component CanvasView:
    let canvas: CanvasElement? = null
    return <canvas ref={canvas}></canvas>

component DialogView:
    let dialog: DialogElement? = null
    return <dialog ref={dialog}>Confirm</dialog>
`.trimStart());
  assert.deepEqual(correctRef.diagnostics, []);
  assert.match(correctRef.code ?? "", /__velarAppendOwned\(__velarComponentScope\.cleanups, \(\) => \{ if \(canvas === __velarElement\d+\) canvas = null; \}\)/u);

  const wrongRef = compile(`
component CanvasView:
    let canvas: InputElement? = null
    return <canvas ref={canvas}></canvas>
`.trimStart());
  assert.ok(wrongRef.diagnostics.some((item) => item.code === "VEL5024"));

  const nonOptionalRef = compile(`
component CanvasView:
    let canvas: CanvasElement = null
    return <canvas ref={canvas}></canvas>
`.trimStart());
  assert.ok(nonOptionalRef.diagnostics.some((item) => item.code === "VEL5024" && /cleanup can restore null/u.test(item.message)));
});

test("ordinary control flow keeps JSX branches readable, narrowed, and ownership-safe", () => {
  const result = compile(`
type User:
    name: string

component Badge(label: string):
    return <strong>{label}</strong>

component Profile(user: User?, failed: Error?, loading: bool):
    def content() -> WebNode:
        if loading:
            return <p aria-busy="true">Loading…</p>
        else if failed != null:
            return <p role="alert">{failed.message}</p>
        else if user != null:
            return <Badge label={user.name} />
        else:
            return <p>Guest</p>

    return <main>{content()}</main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  // Prop reads route through the live prop handle, so narrowed branch reads
  // lower through .get() like state reads.
  assert.match(result.code ?? "", /if \(loading\.get\(\)\)/u);
  assert.match(result.code ?? "", /\(\(failed\.get\(\) \?\? null\) !== null\)/u);
  assert.match(result.code ?? "", /\(\(user\.get\(\) \?\? null\) !== null\)/u);
  assert.doesNotMatch(result.code ?? "", /__velarStaticAttr\([^\n]+"(?:if|else-if|else)"/u);

  const invalid = compile(`
component Broken:
    return <main>
        <p else>Orphan</p>
        <p if="yes">Missing expression</p>
        <p if={true} else>Two controls</p>
        <p if={true}>First</p>
        <p else={true}>Bad else</p>
        <span>Break adjacency</span>
        <p else-if={true}>Late branch</p>
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.filter((item) => item.code === "VEL5029").length >= 5);

  const badCondition = compile("component Broken:\n    def content() -> WebNode:\n        if \"yes\":\n            return <p>Wrong</p>\n        return <p>Fallback</p>\n\n    return <main>{content()}</main>\n");
  assert.ok(badCondition.diagnostics.some((item) => /Condition must be bool, received string/u.test(item.message)));
});

test("native JSX events provide checked browser payloads without wrappers", () => {
  const result = compile(`
type KeyPayload = KeyboardEvent

def isKeyPayload(value: unknown) -> bool:
    return value is KeyPayload

def isCompositionPayload(value: unknown) -> bool:
    return value is CompositionEvent

def isClipboardPayload(value: unknown) -> bool:
    return value is ClipboardEvent

component Controls:
    def handleAny(event: Event):
        print(event.type)

    def handleKey(event: KeyboardEvent):
        print(event.key)

    def handleComposition(event: CompositionEvent):
        print(event.data)

    def handleClipboard(event: ClipboardEvent):
        event.preventDefault()

    return <main>
        <input on:keydown={handleKey} on:keyup={event => print(event.code)} on:input={event => print(event.inputType)} on:compositionend={handleComposition} on:paste={handleClipboard} />
        <button type="button" on:click={event => print(event.clientX)}>Point</button>
        <button type="button" on:click={handleAny}>Any event</button>
    </main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const contextual = result.semanticIndex.symbols.filter((item) => item.kind === "parameter" && item.name === "event");
  assert.ok(contextual.some((item) => item.type === "KeyboardEvent"));
  assert.ok(contextual.some((item) => item.type === "InputEvent"));
  assert.ok(contextual.some((item) => item.type === "PointerEvent"));
  assert.match(result.code ?? "", /typeof CompositionEvent !== "undefined"/u);
  assert.match(result.code ?? "", /typeof ClipboardEvent !== "undefined"/u);
  assert.match(result.code ?? "", /__velarOn\(__velarElement\d+, "keydown"/u);
  assert.match(result.code ?? "", /typeof KeyboardEvent !== "undefined"/u);
  assert.doesNotMatch(result.code ?? "", /new (?:Keyboard|Pointer|Input)Event/u);

  const primitiveChecks = compile(`
def isComposition(value: unknown) -> bool:
    return value is CompositionEvent

def isClipboard(value: unknown) -> bool:
    return value is ClipboardEvent
`.trimStart());
  assert.deepEqual(primitiveChecks.diagnostics, []);
  assert.doesNotMatch(primitiveChecks.code ?? "", /(?:CompositionEvent|ClipboardEvent)\.is/u);
  const primitiveExecution = executeModule(`
class NativeComposition {}
class NativeClipboard {}
globalThis.CompositionEvent = NativeComposition;
globalThis.ClipboardEvent = NativeClipboard;
${primitiveChecks.code ?? ""}
console.log(isComposition(new NativeComposition()), isComposition({}));
console.log(isClipboard(new NativeClipboard()), isClipboard({}));
`);
  assert.equal(primitiveExecution.status, 0, String(primitiveExecution.stderr));
  assert.equal(primitiveExecution.stdout, "true false\ntrue false\n");

  const structural = compile(`
type Summary:
    label: string

type Detailed:
    label: string
    count: number

def show(value: Summary):
    print(value.label)

const detail: Detailed = {label: "ready", count: 1}
show(detail)
`.trimStart());
  assert.deepEqual(structural.diagnostics, []);

  const invalid = compile(`
component Broken:
    def pointerOnly(event: PointerEvent):
        print(event.clientX)

    def tooMany(first: Event, second: Event):
        print(first.type)

    return <main>
        <input on:keydown={pointerOnly} />
        <button type="button" on:click={tooMany}>Wrong</button>
        <input on:keydown={event => print(event.missing)} />
        <input on:compositionend={event => print(event.inputType)} />
        <input on:paste={event => print(event.data)} />
    </main>
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5021" && /provides KeyboardEvent, not PointerEvent/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5021" && /zero parameters or one PointerEvent/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /KeyboardEvent.*no field 'missing'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /CompositionEvent.*no field 'inputType'/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /ClipboardEvent.*no field 'data'/u.test(item.message)));
});

test("event modifiers use native Event operations without invoking synthetic overrides", () => {
  const result = compile(`
component App:
    return <button type="button" on:click.self.prevent.stop={() => null}>Ready</button>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(`${result.code ?? ""}
const target = new EventTarget();
const scope = __velarScope("EventBoundary");
let getterReads = 0;
let handlerCalls = 0;
__velarOn(target, "probe", () => () => { handlerCalls += 1; }, scope, ["self", "prevent", "stop"]);
const event = new Event("probe", { cancelable: true });
Object.defineProperties(event, {
  target: { configurable: true, get() { getterReads += 1; return null; } },
  preventDefault: { configurable: true, get() { getterReads += 1; return () => null; } },
  stopPropagation: { configurable: true, get() { getterReads += 1; return () => null; } },
});
target.dispatchEvent(event);
console.log(getterReads + ":" + handlerCalls + ":" + event.defaultPrevented);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0:1:true\n");
});

test("requires and lowers stable keys for dynamic JSX lists", () => {
  const missing = compile(`
component ListView:
    state names = ["Ada"]
    return <ul>{names.map(name => <li>{name}</li>)}</ul>
`.trimStart());
  assert.ok(missing.diagnostics.some((item) => item.code === "VEL5017"));

  const keyed = compile(`
component ListView:
    state names = ["Ada"]
    return <ul>{names.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(keyed.diagnostics, []);
  assert.match(keyed.code ?? "", /__velarKeyed/);
  assert.match(keyed.code ?? "", /Duplicate JSX key/);
  assert.match(keyed.code ?? "", /const source = __velarToRaw\(read\(\) \?\? \[\]\);\s+const values = __velarListSnapshot\(source, "Keyed JSX"\)/u);

  const execution = executeModule(`${keyed.code ?? ""}
let iteratorReads = 0;
let getterReads = 0;
class HostileList extends Array {
  [Symbol.iterator]() { iteratorReads += 1; throw new Error("iterator override"); }
}
const source = new HostileList("Ada", "Lin");
const snapshot = __velarListSnapshot(source, "Keyed JSX");
source[0] = "Changed";
console.log(snapshot[0] + ":" + snapshot[1] + ":" + iteratorReads);
const sparse = []; sparse.length = 1;
const extended = ["Ada"]; extended.label = "hidden";
const accessor = [];
Object.defineProperty(accessor, 0, { enumerable: true, configurable: true, get() { getterReads += 1; return "Ada"; } });
accessor.length = 1;
for (const value of [sparse, extended, accessor, Object.freeze([])]) {
  try { __velarListSnapshot(value, "Keyed JSX"); console.log("accepted"); }
  catch (error) { console.log(error.name); }
}
console.log(getterReads);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada:Lin:0\nTypeError\nTypeError\nTypeError\nTypeError\n0\n");
});

test("widens the keyed fast path across conditional branches", () => {
  // The idiomatic empty-state ternary (ledger W-19): the empty branch becomes
  // a gated dynamic region and the list keeps the identity-cached keyed path,
  // both gated on the shared branch condition.
  const ternary = compile(`
type Message:
    id: string
    text: string

component Flow(messages: List<Message>):
    return <section>{messages.size == 0 ? <p>empty</p> : messages.map(message => <article key={message.id}>{message.text}</article>)}</section>
`.trimStart());
  assert.deepEqual(ternary.diagnostics, []);
  assert.match(ternary.code ?? "", /__velarDynamic\(__velarElement\d+, \(__velarChildScope\) => \(\(__velarListSize\(messages\.get\(\)\) === 0\)\) \? \(/u);
  assert.match(ternary.code ?? "", /__velarKeyed\(__velarElement\d+, \(\) => \(\(__velarListSize\(messages\.get\(\)\) === 0\)\) \? \[\] : \(messages\.get\(\)\)/u);

  const bothKeyed = compile(`
component Flow(on: bool, alpha: List<string>, beta: List<string>):
    return <ul>{on ? alpha.map(name => <li key={name}>{name}</li>) : beta.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(bothKeyed.diagnostics, []);
  assert.equal(((bothKeyed.code ?? "").match(/__velarKeyed\(__velarElement1,/gu) ?? []).length, 2);

  const chain = compile(`
component Flow(on: bool, alpha: List<string>, beta: List<string>):
    return <ul>{on ? alpha.map(name => <li key={name}>{name}</li>) : beta.size == 0 ? <li>none</li> : beta.map(name => <li key={name}>{name}</li>)}</ul>
`.trimStart());
  assert.deepEqual(chain.diagnostics, []);
  assert.equal(((chain.code ?? "").match(/__velarKeyed\(__velarElement1,/gu) ?? []).length, 2);
  assert.equal(((chain.code ?? "").match(/__velarDynamic\(__velarElement1,/gu) ?? []).length, 1);

  // A conditional without a keyed list stays one dynamic region.
  const plain = compile(`
component Flow(on: bool):
    return <div>{on ? <p>a</p> : <p>b</p>}</div>
`.trimStart());
  assert.deepEqual(plain.diagnostics, []);
  assert.doesNotMatch(plain.code ?? "", /__velarKeyed\(__velarElement/u);
  assert.equal(((plain.code ?? "").match(/__velarDynamic\(__velarElement1,/gu) ?? []).length, 1);
});
