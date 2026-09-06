import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compile as compileCore, describeType, formatSource } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { webFormatOptions, compile, compileProject } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("validates annotations and refuses 'any' as a written type", () => {
  const missing = compile("const value: Missing = null\n");
  assert.ok(missing.diagnostics.some((item) => /Unknown type 'Missing'/.test(item.message)));

  const any = compile("def escape(value: any) -> any:\n    return value\n");
  assert.ok(any.diagnostics.some((item) => /'any' is not a VelarScript type/.test(item.message)));

  const arity = compile("const values: Map<string> = Map()\n");
  assert.ok(arity.diagnostics.some((item) => item.code === "VEL2012"));

  const recursive = compile("type Node:\n    next: Node?\n");
  assert.deepEqual(recursive.diagnostics, []);
});

test("compiles Web components to owned DOM and extracted Look rules", () => {
  const result = compile(`
import {rgb} from "velar/look"

const counterLook = look:
    color = rgb(36, 92, 168)

    if @hover:
        color = rgb(20, 52, 112)

component Counter(start: number = 0):
    state count = start
    computed doubled = count * 2

    def increment():
        count += 1

    watch count as current, previous:
        print(f"{previous} -> {current}")

    @mounted:
        print("mounted")

    @cleanup:
        print("cleanup")

    return <button class="counter" look={counterLook} class:active={count > 0} on:click={increment}>{count} / {doubled}</button>

mount(<Counter start={1} />, "#app")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.extensions, ["@velarscript/web"]);
  assert.match(result.code ?? "", /const count = __velarState\(start\.get\(\), "count"\)/);
  assert.match(result.code ?? "", /const doubled = __velarComputed/);
  assert.match(result.code ?? "", /__velarWatch/);
  assert.match(result.code ?? "", /count\.set\(count\.get\(\) \+ 1\)/);
  assert.match(result.code ?? "", /__velarCreateElement\("button", __velarNamespace\)/);
  assert.match(result.css ?? "", /\[data-velar-look~="hover:color"\](?:\[data-velar-look\]){4}:where\(:hover\)\{color:var\(--velar-look-hover-color\)\}/);
  assert.match(result.code ?? "", /__velarLookBind/);
  assert.match(result.code ?? "", /proxy = new __velarGraphNativeProxy\(value/u);
  assert.match(result.code ?? "", /nextVersion !== currentVersion/u);
  assert.match(result.code ?? "", /if \(destroyed\) return null;[\s\S]*__velarCleanupStep/);
  const domCommit = (result.code ?? "").indexOf("for (const observer of __velarGraphSetItems(__velarRuntime.domQueue))");
  const watchCommit = (result.code ?? "").indexOf("for (const observer of __velarGraphSetItems(__velarRuntime.watchQueue))");
  assert.ok(domCommit >= 0 && watchCommit > domCommit);
});

test("Web-generated component and JSX names cannot capture user bindings", () => {
  const result = compile(`
component Hygiene:
    const __root = "root"
    const __handle = "handle"
    const __scope = "scope"
    const __props = "props"
    const __namespace = "namespace"
    const __childScope = "child"
    const __dynamicScope = "dynamic"
    const __el1 = "element"
    const __maybe: string? = null
    return <div>{__el1 + __childScope + __scope + __namespace}{__maybe}</div>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function Hygiene\(__velarProps = \{\}, __velarNamespace = "html"\)/u);
  assert.match(result.code ?? "", /const __velarRoot = \(\(\) => \{ const __velarElement1/u);
  // The scalar child lowers to a text node and needs no child scope at all; the
  // optional one still opens a dynamic region, and its generated parameter must
  // still not capture the user's own `__childScope`.
  assert.match(result.code ?? "", /__velarText\(__velarElement1, \(\) => .*__el1.*__childScope.*__scope.*__namespace/u);
  assert.match(result.code ?? "", /\(__velarChildScope\) => \(__maybe \?\? null\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
});

test("Component contracts check passed component values by named JSX props", () => {
  const source = `
type Row:
    label: string

type RowView = Component<(row: Row, compact?: bool) -> WebNode>

component Detailed(row: Row, compact: bool = false, tracking: string = "none"):
    return <article data-compact={compact}>{row.label}:{tracking}</article>

component Decoration(tone: string = "quiet"):
    return <aside>{tone}</aside>

component Host(View: RowView, row: Row):
    return <View row={row} compact />

component App:
    const empty: Component = Decoration
    return <Host View={Detailed} row={{label: "Ada"}} />
`.trimStart();
  const result = compile(source, { path: "/tmp/component-contract.vel" });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.kind === "parameter" && symbol.name === "View")?.type,
    "Component<(row: Row, compact?: bool) -> WebNode>");
  const tagStart = source.indexOf("<View") + 1;
  const tagReference = result.semanticIndex.references.find((reference) => reference.name === "View"
    && reference.span.start === tagStart && reference.span.end === tagStart + "View".length);
  assert.equal(tagReference?.call, true);
  assert.match(result.code ?? "", /__velarDynamicComponent\(\(__velarDynamicScope\) => __velarChild\(View\.get\(\)/u);
  assert.match(formatSource("type View = Component<(label: string, compact?: bool) -> WebNode>\n"), /compact\?: bool/u);

  const incompatible = compile(`
type Row:
    label: string

type RowView = Component<(row: Row, compact?: bool) -> WebNode>

component WrongType(row: string, compact: bool = false):
    return <p>{row}</p>

component ExtraRequired(row: Row, mode: string, compact: bool = false):
    return <p>{row.label}:{mode}</p>

component MissingAcceptedProp(row: Row):
    return <p>{row.label}</p>

component RequiredDecoration(tone: string):
    return <p>{tone}</p>

const wrongType: RowView = WrongType
const extraRequired: RowView = ExtraRequired
const missingAccepted: RowView = MissingAcceptedProp
const zeroProp: Component = RequiredDecoration
`.trimStart());
  assert.equal(incompatible.diagnostics.filter((item) => /Cannot assign component/u.test(item.message)).length, 4,
    JSON.stringify(incompatible.diagnostics));

  const invalidSignatures = compile(`
component Plain(label: string):
    return <p>{label}</p>

const unnamed: Component<(string) -> WebNode> = Plain
const wrongResult: Component<(label: string) -> string> = Plain
const restProps: Component<(...labels: string) -> WebNode> = Plain
const duplicate: Component<(label: string, label?: string) -> WebNode> = Plain
`.trimStart());
  assert.ok(invalidSignatures.diagnostics.some((item) => /Every Component signature prop requires a name/u.test(item.message)));
  assert.ok(invalidSignatures.diagnostics.some((item) => /must return WebNode/u.test(item.message)));
  assert.ok(invalidSignatures.diagnostics.some((item) => /cannot declare a rest parameter/u.test(item.message)));
  assert.ok(invalidSignatures.diagnostics.some((item) => /declared more than once/u.test(item.message)));

  const coreOnly = compileCore("const View: Component = null\n");
  assert.ok(coreOnly.diagnostics.some((item) => /Unknown type 'Component'/u.test(item.message)));

  const directCall = compile("component Host(View: Component):\n    return View()\n");
  assert.ok(directCall.diagnostics.some((item) => /Render a Component value with JSX/u.test(item.message)));

  const invalidJsx = compile(`
type Row:
    label: string
type RowView = Component<(row: Row, compact?: bool) -> WebNode>
component Host(View: RowView):
    return <View compact surprise="no">children</View>
`.trimStart());
  assert.ok(invalidJsx.diagnostics.some((item) => item.code === "VEL5012" && /requires prop 'row'/u.test(item.message)));
  assert.ok(invalidJsx.diagnostics.some((item) => item.code === "VEL5013" && /has no prop 'surprise'/u.test(item.message)));
  assert.ok(invalidJsx.diagnostics.some((item) => item.code === "VEL5018" && /does not declare JSX children/u.test(item.message)));
});

test("Component contracts retain their props across project module interfaces", async () => {
  const directory = await makeTemporaryDirectory("velar-component-contract-");
  const libraryPath = join(directory, "views.vel");
  const appPath = join(directory, "app.vel");
  await writeFile(libraryPath, `
export type RowView = Component<(label: string, compact?: bool) -> WebNode>

export component Label(label: string, compact: bool = false):
    return <p data-compact={compact}>{label}</p>

export component Host(View: RowView, label: string):
    return <View label={label} />
`.trimStart(), "utf8");
  await writeFile(appPath, `
import {Host, Label} from "./views.vel"

component App:
    return <Host View={Label} label="Ada" />
`.trimStart(), "utf8");
  const valid = await compileProject(appPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  const library = valid.modules.find((module) => module.inputPath === libraryPath)?.result;
  assert.equal(library?.semanticIndex.symbols.find((symbol) => symbol.name === "RowView")?.type,
    "Component<(label: string, compact?: bool) -> WebNode>");
  const exportedHost = library?.moduleInterface.exports.get("Host");
  assert.equal(exportedHost?.kind, "extension");
  assert.equal(exportedHost?.kind === "extension" ? exportedHost.extensionId : null, "@velarscript/web");
  assert.equal(exportedHost?.kind === "extension" ? exportedHost.family : null, "component");
  const viewType = exportedHost?.kind === "extension" ? exportedHost.properties.get("View") : null;
  assert.equal(viewType?.kind === "extension" ? viewType.role : null, "contract");

  await writeFile(appPath, `
import {Host} from "./views.vel"

component Incompatible(label: string, mode: string):
    return <p>{label}:{mode}</p>

component App:
    return <Host View={Incompatible} label="Ada" />
`.trimStart(), "utf8");
  const invalid = await compileProject(appPath);
  const diagnostics = invalid.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(diagnostics.some((diagnostic) => /Cannot assign component Incompatible/u.test(diagnostic.message)),
    JSON.stringify(diagnostics));
});

test("component refs expose typed Handles without weakening props or style hosts", () => {
  const source = `
type EditorHandle:
    focus: () -> null
    reset: () -> null
    value: () -> string

type EditorView = Component<(initial?: string) -> WebNode, EditorHandle>

const editorLook = look:
    borderColor = "red"

component Editor(initial: string = "draft") exposes EditorHandle:
    state text = initial

    def focusEditor():
        pass

    def reset():
        text = initial

    def value() -> string:
        return text

    expose {focus: focusEditor, reset, value}
    return <input host bind:value={text} />

component App(View: EditorView = Editor):
    let editor: EditorHandle? = null
    return <View ref={editor} class="compact" look={editorLook} look:borderWidth={2px} />
`.trimStart();
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semanticIndex.symbols.find((symbol) => symbol.name === "EditorView")?.type,
    "Component<(initial?: string) -> WebNode, EditorHandle>");
  assert.match(result.code ?? "", /const __velarHandle = __velarComponentHandle\(\{ focus: focusEditor, reset: reset, value: value \}, "Editor"\)/u);
  assert.match(result.code ?? "", /__velarChild\(View\.get\(\), \{ class: \(\) => \("compact"\), look: \(\) => \(__velarLook/u);
  assert.match(result.code ?? "", /\(next, previous\) => \{ if \(previous === undefined \|\| editor === previous\) editor = next; \}/u);
  assert.doesNotMatch(result.code ?? "", /\{ ref: \(\) =>/u);
  const formattedHandle = formatSource("component Control exposes Handle:\n  expose {run:run}\n  return <div />\n", webFormatOptions);
  assert.match(formattedHandle, /component Control exposes Handle:\n\s+expose \{run: run\}/u);
  assert.equal(formatSource(formattedHandle, webFormatOptions), formattedHandle);

  const afterReturn = compile(`
type Handle:
    run: () -> null

component AfterReturn exposes Handle:
    def run():
        pass
    return <div>Ready</div>
    expose {run}
`.trimStart());
  assert.deepEqual(afterReturn.diagnostics, []);
  const afterReturnCode = afterReturn.code ?? "";
  const afterReturnStart = afterReturnCode.indexOf("function AfterReturn");
  const rootIndex = afterReturnCode.indexOf("const __velarRoot =", afterReturnStart);
  const handleIndex = afterReturnCode.indexOf("const __velarHandle =", afterReturnStart);
  assert.ok(afterReturnStart >= 0 && rootIndex > afterReturnStart && handleIndex > rootIndex,
    afterReturnCode.slice(Math.max(0, afterReturnStart), handleIndex + 80));

  const invalid = compile(`
type Handle:
    run: () -> null

type OtherHandle:
    close: () -> null

type HandledView = Component<() -> WebNode, Handle>
type InvalidView = Component<() -> WebNode, string>

component Controlled exposes Handle:
    def run():
        pass
    expose {run}
    return <button>Run</button>

component Plain:
    return <div>Plain</div>

component Missing exposes Handle:
    return <div>Missing</div>

component Undeclared:
    def run():
        pass
    expose {run}
    return <div>Undeclared</div>

component Duplicate exposes Handle:
    def run():
        pass
    expose {run}
    expose {run}
    return <div>Duplicate</div>

component InvalidHandle exposes string:
    expose "wrong"
    return <div>Wrong</div>

component Mismatched exposes Handle:
    expose {}
    return <div>Mismatch</div>

component Reserved(ref: Handle? = null):
    return <div>Reserved</div>

component App:
    let fixed: Handle = {run: () => null}
    let wrong: OtherHandle? = null
    let plain: Handle? = null
    state reactive: Handle? = null
    return <main>
        <Controlled ref={fixed} />
        <Controlled ref={wrong} />
        <Controlled ref={reactive} />
        <Plain ref={plain} />
    </main>

const missingHandle: HandledView = Plain
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /does not provide an expose value/u);
  assert.match(messages, /uses 'expose' without declaring/u);
  assert.match(messages, /more than one expose declaration/u);
  assert.match(messages, /Handle must be a concrete record type/u);
  assert.match(messages, /Object is missing required field 'run'/u);
  assert.match(messages, /'ref' is a compiler-owned JSX directive/u);
  assert.match(messages, /ref requires Handle\? so cleanup can restore null/u);
  assert.match(messages, /stores OtherHandle/u);
  assert.match(messages, /component ref requires a mutable let binding/u);
  assert.match(messages, /does not expose a Handle/u);
  assert.match(messages, /Cannot assign component Plain to Component<\(\) -> WebNode, Handle>/u);
  assert.match(messages, /Component Handle must be a concrete record type, received string/u);

  const misplaced = compile(`
type Handle:
    run: () -> null

expose {run: () => null}

component Nested exposes Handle:
    if true:
        expose {run: () => null}
    return <div>Nested</div>
`.trimStart());
  assert.ok(misplaced.diagnostics.filter((item) => /'expose' is only valid as a top-level component item/u.test(item.message)).length >= 2,
    JSON.stringify(misplaced.diagnostics));
});

test("component Handle contracts survive project module interfaces", async () => {
  const directory = await makeTemporaryDirectory("velar-component-handle-contract-");
  const libraryPath = join(directory, "dialog.vel");
  const appPath = join(directory, "app.vel");
  await writeFile(libraryPath, `
export type DialogHandle:
    open: () -> null
    close: () -> null

export type DialogView = Component<(title: string) -> WebNode, DialogHandle>

export component Dialog(title: string) exposes DialogHandle:
    def open():
        print("open:" + title)

    def close():
        print("close:" + title)

    expose {open, close}
    return <dialog>{title}</dialog>
`.trimStart(), "utf8");
  await writeFile(appPath, `
import {Dialog, DialogHandle, DialogView} from "./dialog.vel"

const View: DialogView = Dialog

component App:
    let dialog: DialogHandle? = null
    return <View ref={dialog} title="Confirm" />
`.trimStart(), "utf8");
  const valid = await compileProject(appPath);
  assert.deepEqual(valid.failures, []);
  assert.deepEqual(valid.modules.flatMap((module) => module.result.diagnostics), []);
  const library = valid.modules.find((module) => module.inputPath === libraryPath)?.result;
  const exported = library?.moduleInterface.exports.get("Dialog");
  assert.equal(exported?.kind, "extension");
  assert.equal(exported?.kind === "extension" ? exported.role : null, "constructor");
  assert.equal(exported?.kind === "extension" ? describeType(exported.arguments[0] ?? { kind: "null" }) : null, "DialogHandle");

  await writeFile(appPath, `
import {Dialog} from "./dialog.vel"

type WrongHandle:
    toggle: () -> null

component App:
    let dialog: WrongHandle? = null
    return <Dialog ref={dialog} title="Confirm" />
`.trimStart(), "utf8");
  const invalid = await compileProject(appPath);
  assert.ok(invalid.modules.flatMap((module) => module.result.diagnostics)
    .some((item) => /this ref stores WrongHandle/u.test(item.message)));
});

test("component Handle refs follow instance identity, clear on cleanup, and revoke stale aliases", () => {
  const result = compile(`
type CounterHandle:
    increment: () -> null
    value: () -> number

type CounterView = Component<() -> WebNode, CounterHandle>

state visible = true
state currentView: CounterView = Counter
let conditionalCounter: CounterHandle? = null
let selectedCounter: CounterHandle? = null

component Counter exposes CounterHandle:
    state count = 0

    def increment():
        count += 1

    def value() -> number:
        return count

    expose {increment, value}

    @cleanup:
        print("counter-cleanup")

    return <button>{count}</button>

component Alternate exposes CounterHandle:
    state count = 10

    def increment():
        count += 1

    def value() -> number:
        return count

    expose {increment, value}

    @cleanup:
        print("alternate-cleanup")

    return <button>{count}</button>

component Host(View: CounterView):
    return <View ref={selectedCounter} />

component App:
    @mounted:
        if conditionalCounter != null:
            print("parent-mounted")
            conditionalCounter.increment()

    return <main>
        {visible ? <Counter ref={conditionalCounter} /> : null}
        <Host View={currentView} />
    </main>

mount(<App />, "#app")
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
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
await flush();
const first = conditionalCounter;
const selectedFirst = selectedCounter;
console.log("initial:" + first.value() + ":" + selectedFirst.value() + ":" + Object.isFrozen(first));
first.increment();
await flush();
console.log("incremented:" + first.value());
try { first.increment = () => null; } catch (error) { console.log("frozen:" + error.name); }
currentView.set(Alternate);
await flush();
const selectedSecond = selectedCounter;
console.log("switched:" + (selectedSecond !== null && selectedSecond !== selectedFirst) + ":" + selectedSecond.value());
try { selectedFirst.increment(); } catch (error) { console.log("stale-dynamic:" + error.message); }
visible.set(false);
await flush();
console.log("cleared:" + (conditionalCounter === null) + ":" + (selectedCounter === selectedSecond) + ":" + selectedSecond.value());
try { first.increment(); } catch (error) { console.log("stale-static:" + error.message); }
visible.set(true);
await flush();
console.log("replaced:" + (conditionalCounter !== null && conditionalCounter !== first) + ":" + conditionalCounter.value());
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "parent-mounted",
    "initial:1:0:true",
    "incremented:2",
    "frozen:TypeError",
    "counter-cleanup",
    "switched:true:10",
    "stale-dynamic:Component Counter Handle is no longer active",
    "counter-cleanup",
    "cleared:true:true:10",
    "stale-static:Component Counter Handle is no longer active",
    "replaced:true:0",
    "",
  ].join("\n"));
});
