import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { formatSource } from "@velarscript/compiler";
import { executeModule } from "../support/execute-module.ts";
import { webFormatOptions, compile, inspectModule, executeWithLookModule } from "../support/compiler-suite.ts";

test("Web lexical extensions share Core line-boundary semantics", () => {
  const source = [
    "const cardLook = look:",
    "    display = \"grid\"",
    "    gap = 12px",
    "",
    "component Card:",
    "    return <article look={cardLook}>Card</article>",
    "",
  ].join("\r");
  const result = compile(source, { path: "standalone-cr.vel" });
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /display:var\(--velar-look-base-display\)/u);
  assert.match(result.code ?? "", /function Card/u);
});

test("Look is flat, typed as a value, responsive, state-aware, and target-aware", () => {
  const result = compile(`
import {border, rgb, spacing} from "velar/look"

const cardLook = look:
    display = "grid"
    gap = 12px
    maxWidth = 680px
    padding = 20px
    background = rgb(251, 250, 247)
    border = border(width=1px, color=rgb(217, 215, 209))
    borderRadius = 16px
    color = rgb(17, 18, 22)

    if @hover and not @disabled:
        translate = spacing(0px, -2px)

    if viewport.width <= 720px:
        padding = 16px

    width = 72 * 1%
    margin = spacing(-8px, 2px, 0px, 2px)

    @before:
        content = ""

component Card:
    return <article class="card" look={cardLook}>Card</article>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /\[data-velar-look~="base:display"\]\{display:var\(--velar-look-base-display\)\}/u);
  assert.match(result.css ?? "", /\[data-velar-look~="hover\+not-disabled:translate"\](?:\[data-velar-look\]){5}:where\(:hover\):where\(:not\(:disabled\):not\(\[aria-disabled="true"\]\)\)/u);
  assert.match(result.css ?? "", /@media \(width <= 720px\)\{\[data-velar-look~="viewport-width-lte-720px:padding"\](?:\[data-velar-look\]){1}/u);
  assert.match(result.css ?? "", /\[data-velar-look~="before:base:content"\]::before/u);
  assert.match(result.code ?? "", /data-velar-look/u);
  assert.match(result.code ?? "", /__velarLookMath\("\*", 72, "1%"\)/u);
  assert.match(result.code ?? "", /"-2px"/u);
  assert.match(result.code ?? "", /"-8px"/u);
  assert.doesNotMatch(result.code ?? "", /-"(?:2|8)px"/u);
  assert.doesNotMatch(result.code ?? "", /[A-Za-z0-9_-]{6,}__[A-Za-z0-9_-]{6,}/u);
});

test("Look accepts the modern text wrapping properties", () => {
  const result = compile(`
const bubbleLook = look:
    overflowWrap = "anywhere"
    wordBreak = "break-word"
    hyphens = "auto"
    textWrap = "balance"

component Bubble:
    return <p look={bubbleLook}>text</p>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /overflow-wrap:var\(--velar-look-base-overflow-wrap\)/u);
  assert.match(result.css ?? "", /hyphens:var\(--velar-look-base-hyphens\)/u);
  assert.match(result.css ?? "", /text-wrap:var\(--velar-look-base-text-wrap\)/u);
});

test("Look color-scheme conditions lower to prefers-color-scheme media queries", () => {
  const result = compile(`
import {rgb} from "velar/look"

const panelLook = look:
    background = rgb(255, 255, 255)

    if scheme.dark:
        background = rgb(29, 32, 41)

    if @hover:
        if scheme.dark:
            opacity = 0.7

    if scheme.dark and viewport.width <= 600px:
        padding = 4px

    if not scheme.dark:
        color = rgb(20, 20, 20)

component Panel:
    return <div look={panelLook}>panel</div>
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: dark\)\{\[data-velar-look~="scheme-dark:background"\](?:\[data-velar-look\]){1}\{background:var\(--velar-look-scheme-dark-background\)\}/u);
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: dark\)\{\[data-velar-look~="hover\+scheme-dark:opacity"\](?:\[data-velar-look\]){8}:where\(:hover\)/u);
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: dark\) and \(width <= 600px\)\{\[data-velar-look~="scheme-dark\+viewport-width-lte-600px:padding"\]/u);
  // The schemes are complementary: 'not scheme.dark' is the light scheme.
  assert.match(result.css ?? "", /@media \(prefers-color-scheme: light\)\{\[data-velar-look~="scheme-light:color"\]/u);
});

test("JSX interpolation braces continue expressions across physical lines", () => {
  const result = compile(`
const messages: List<string> = []

component App:
    return <div>
        {messages.size == 0
            ? <p>Empty</p>
            : messages.map(message => <span key={message}>{message}</span>)}
        <p data-note={messages.size == 0
            ? "empty"
            : "full"}>note</p>
    </div>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCreateElement\("div", __velarNamespace\)/u);

  // One-off base properties use JSX Look directives instead of nesting the
  // indentation-owned Look language inside an attribute expression.
  const inline = compile(`
import {rgb} from "velar/look"

component Card:
    return <p look:color={rgb(1, 2, 3)} look:padding={12px}>Note</p>

mount(<Card />, "#app")
`.trimStart());
  assert.deepEqual(inline.diagnostics, []);
  assert.match(inline.css ?? "", /base:color/u);
  assert.match(inline.css ?? "", /base:padding/u);
  assert.match(inline.code ?? "", /__velarLook\(\[\{ rules: \{ "base:color": rgb\(1, 2, 3\), "base:padding": "12px" \} \}\]\)/u);
});

test("JSX look directives override composed Look values on native and component hosts", () => {
  const result = compile(`
import {rgb, spacing} from "velar/look"

const paper = rgb(251, 250, 247)
const primary = rgb(45, 79, 190)
const controlLook = look:
    display = "inline-flex"
    color = paper
    background = primary

component Control:
    return <button host>Control</button>

component App:
    state active = true
    return <main>
        <div
            look:display="grid"
            look:gap={12px}
            look:padding={spacing(16px, 20px)}
            look:borderRadius={14px}
        >Content</div>
        <button look={controlLook} look:color={primary} look:background={active ? paper : null}>Save</button>
        <Control look={controlLook} look:color={primary} />
    </main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /base:display/u);
  assert.match(result.css ?? "", /base:border-radius/u);
  assert.match(result.code ?? "", /__velarLook\(\[controlLook, \{ rules: \{ "base:color": primary, "base:background": \(\(active\.get\(\) \? paper : null\) \?\? null\) \} \}\]\)/u);
  assert.match(result.code ?? "", /look: \(\) => \(__velarLook\(\[controlLook, \{ rules: \{ "base:color": primary \} \}\]\)\)/u);

  const invalid = compile(`
const base = look:
    color = "black"

component Broken:
    return <div
        look={look:
            color = "red"
        }
        look:missing={12px}
        look:gap={true}
        look:color="red"
        look:color="blue"
    >Broken</div>
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /inline Look block is not supported/u);
  assert.match(messages, /Unknown inline Look property 'missing'/u);
  assert.match(messages, /Cannot assign bool/u);
  assert.match(messages, /duplicate attributes/u);
});

test("component callers override component-owned Look state properties", () => {
  const result = compile(`
const internalLook = look:
    color = "black"

    if @hover:
        color = "red"

const callerLook = look:
    if @hover:
        color = "blue"

component Control:
    return <button look={internalLook}>Control</button>

component App:
    return <Control look={callerLook} />
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /\[data-velar-look~="hover:color"\](?:\[data-velar-look\]){4}:where\(:hover\)/u);

  const execution = executeModule(`
class FakeNode {
  constructor(nodeType = 1, value = "") {
    this.nodeType = nodeType;
    this.value = value;
    this.childNodes = [];
    this.attributes = new Map();
    const properties = new Map();
    this.style = {
      properties,
      setProperty: (name, next) => properties.set(name, String(next)),
      removeProperty: (name) => properties.delete(name),
    };
  }
  append(...values) { this.childNodes.push(...values); }
  remove() {}
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
${result.code ?? ""}
const app = App();
const node = app.node;
const tokens = new Set((node.attributes.get("data-velar-look") ?? "").split(" "));
console.log((node.style.properties.get("--velar-look-hover-color") ?? "missing") + ":" + tokens.has("hover:color"));
app.destroy();
console.log((node.style.properties.get("--velar-look-hover-color") ?? "missing") + ":" + node.attributes.has("data-velar-look"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "blue:true\nmissing:false\n");
});

test("JSX style directives provide checked high-priority inline overrides on native and component hosts", () => {
  const result = compile(`
state tone: string? = "purple"

component Panel:
    return <div style:color="green">Note</div>

component App:
    return <Panel look:color="blue" style:color={tone} style:padding={12px} />
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarStyle: \(\) => \(\{ "color": \(tone\.get\(\) \?\? null\), "padding": "12px" \}\)/u);
  assert.match(result.code ?? "", /__velarStyleBindRoot/u);
  assert.match(result.code ?? "", /__velarDomStyleWrite\(element, property/u);
  assert.match(result.css ?? "", /base:color/u);
  assert.doesNotMatch(result.css ?? "", /padding:var/u);

  const dom = `
class FakeNode {
  constructor(nodeType = 1, value = "") {
    this.nodeType = nodeType;
    this.value = value;
    this.childNodes = [];
    this.attributes = new Map();
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
  append(...values) { this.childNodes.push(...values); }
  remove() {}
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
`;
  const execution = executeModule(`${dom}\n${result.code ?? ""}
const app = App();
const node = app.node;
const read = (name) => node.style.properties.get(name) ?? "missing";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
console.log("initial:" + read("color") + ":" + read("padding") + ":" + read("--velar-look-base-color"));
tone.set(null);
await flush();
console.log("removed:" + read("color") + ":" + read("padding") + ":" + read("--velar-look-base-color"));
tone.set("orange");
await flush();
console.log("updated:" + read("color") + ":" + read("padding"));
app.destroy();
console.log("cleanup:" + read("color") + ":" + read("padding") + ":" + read("--velar-look-base-color"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    "initial:purple:12px:blue",
    "removed:missing:12px:blue",
    "updated:orange:12px",
    "cleanup:missing:missing:missing",
    "",
  ].join("\n"));
  assert.match(formatSource("component Styled:\n    return <div style:color=\"red\" style:padding={12px}>ok</div>\n", webFormatOptions),
    /style:color="red" style:padding=\{12px\}/u);

  const invalid = compile(`
component Broken:
    return <div
        style="color:red"
        style:missing={12px}
        style:hover:color="red"
        style:gap={true}
        style:color="red"
        style:color="blue"
    >Broken</div>
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL5041").length, 1);
  assert.match(messages, /Unknown inline Style property 'missing'/u);
  assert.match(messages, /Unknown inline Style property 'hover:color'/u);
  assert.match(messages, /Cannot assign bool/u);
  assert.match(messages, /duplicate attributes/u);
  assert.doesNotMatch(invalid.code ?? "", /__velarStaticAttr\([^\n]*"style"/u);
});

test("unsafe CSS imports are explicit resources around the controlled Look segment", () => {
  const source = `
import {rgb} from "velar/look"
import css unsafe "./foundation.css" before look
import css unsafe "./overrides.css" after look

const cardLook = look:
    color = rgb(0, 128, 128)

component Card:
    return <article class="card" look={cardLook}>Card</article>
`.trimStart();
  const inspection = inspectModule(source);
  assert.deepEqual(inspection.resources, [
    { source: "./foundation.css", kind: "unsafe CSS" },
    { source: "./overrides.css", kind: "unsafe CSS" },
  ]);
  const result = compile(source, {
    resourceContents: new Map([
      ["./foundation.css", ".card { color: black; }"],
      ["./overrides.css", ".card { color: purple; }"],
    ]),
  });

  assert.deepEqual(result.diagnostics, []);
  const foundation = (result.css ?? "").indexOf("color: black");
  const look = (result.css ?? "").indexOf("data-velar-look");
  const override = (result.css ?? "").indexOf("color: purple");
  assert.ok(foundation >= 0 && look > foundation && override > look);

  const hiddenDependency = compile('import css unsafe "./legacy.css" before look\n', {
    resourceContents: new Map([["./legacy.css", '@import "./theme.css"; .icon { background: url("./icon.svg"); }']]),
  });
  const messages = hiddenDependency.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /contains @import/u);
  assert.match(messages, /uses relative asset address url/u);
});

test("Look composition uses ordinary functions and named arguments", () => {
  const result = compile(`
import {border, rgb} from "velar/look"

def surface(radius: Length, color: Color) -> Look:
    return look:
        background = color
        borderRadius = radius

const interactive = look:
    cursor = "pointer"
    resize = "none"

    if @focusVisible:
        outline = border(width=2px, color=rgb(63, 115, 150))

const actionLook = look:
    ...surface(color=rgb(255, 255, 255), radius=9999px)
    ...interactive
    display = "inline-flex"
    alignItems = "center"

component ActionButton:
    return <button look={actionLook}>Continue</button>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /surface\(\.\.\.\(\(__velarNamedArguments\) => \[__velarNamedArguments\[1\], __velarNamedArguments\[0\]\]/u);
  assert.match(result.code ?? "", /__velarLook\(\[/u);
  assert.match(result.css ?? "", /focus-visible:outline"\](?:\[data-velar-look\]){4}:where\(:focus-visible\)/u);
  assert.match(result.css ?? "", /base:resize"\]\{resize:var\(--velar-look-base-resize\)\}/u);
});

test("Look rejects ambiguous maintenance hazards", () => {
  const result = compile(`
const broken = look:
    padding = 12px
    paddingInline = 16px
    paddingInline = 18px
    missing = 1px

    if @unknown:
        color = "red"

    @unknownTarget:
        content = "x"

component Card:
    return <article style="color:red" style:color={"red"} look={broken}>Card</article>
`.trimStart());

  const messages = result.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Look property 'paddingInline' is defined more than once/u);
  assert.match(messages, /Unknown Look property 'missing'/u);
  assert.match(messages, /Unknown Look hook '@unknown'/u);
  assert.match(messages, /Unknown Look target '@unknownTarget'/u);
  assert.equal(result.diagnostics.filter((item) => item.code === "VEL5041").length, 1);

  const nestedComposition = compile(`
import {rgb} from "velar/look"

const base = look:
    color = rgb(17, 18, 22)

const broken = look:
    if true:
        ...base
`.trimStart());
  assert.match(nestedComposition.diagnostics.map((item) => item.message).join("\n"), /Look composition is only valid at the outer level/u);

  const condition = Array.from({ length: 33 }, (_, index) => `ready${index}`).join(" or ");
  const state = Array.from({ length: 33 }, (_, index) => `const ready${index} = true`).join("\n");
  const expanded = compile(`import {rgb} from "velar/look"\n\n${state}\n\nconst broken = look:\n    if ${condition}:\n        color = rgb(17, 18, 22)\n`);
  assert.match(expanded.diagnostics.map((item) => item.message).join("\n"), /at most 32 selector\/runtime terms/u);
});

test("Look builders reject JavaScript coercion and invalid visual ranges", () => {
  const invalidTypes = compile(`
import {repeat, spacing, tracks} from "velar/look"

const callback = () => null
const empty = tracks()

const broken = look:
    gridTemplateColumns = tracks(callback)
    padding = spacing(callback)
    gridTemplateRows = repeat(Error("count"), 1px)
`.trimStart());
  const messages = invalidTypes.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /Cannot assign \(\) -> null to .*Track/u);
  assert.match(messages, /Cannot assign \(\) -> null to .*Length/u);
  assert.match(messages, /Cannot assign Error to number \| string/u);
  assert.match(messages, /Expected at least 1 argument but received 0/u);

  // LOK-U8: a literal argument is checked where it is written. The runtime guard
  // is unchanged and still owns every computed argument, pinned below.
  const invalidRange = compile(`
import {rgba} from "velar/look"

const broken = look:
    color = rgba(0, 0, 0, 2)
`.trimStart());
  assert.ok(invalidRange.diagnostics.some((item) => item.code === "VEL5042"
    && /RGB alpha must be from 0 through 1; rgba received 2/u.test(item.message)), JSON.stringify(invalidRange.diagnostics));

  const dynamicRange = compile(`
import {rgba} from "velar/look"

def opacity() -> number:
    return 2

const broken = look:
    color = rgba(0, 0, 0, opacity())
`.trimStart());
  assert.deepEqual(dynamicRange.diagnostics, []);
  const rangeExecution = executeWithLookModule(dynamicRange.code ?? "");
  assert.notEqual(rangeExecution.status, 0);
  assert.match(String(rangeExecution.stderr), /RGB alpha must be from 0 through 1/u);

  const unsafeValueSource = Buffer.from("export const unsafeValue={toString(){console.log('coerced');return '0.5'}}", "utf8").toString("base64");
  // D90 R17: the boundary value needs a declared type to reach the builder;
  // the contract's lie is exactly what the runtime coercion guard catches.
  const dynamic = compile(`
import {color} from "velar/look"

extern module "data:text/javascript;base64,${unsafeValueSource}":
    export const unsafeValue: string

import js {unsafeValue} from "data:text/javascript;base64,${unsafeValueSource}"

const broken = look:
    color = color(unsafeValue)
`.trimStart());
  assert.deepEqual(dynamic.diagnostics, []);
  const coercionExecution = executeWithLookModule(dynamic.code ?? "");
  assert.notEqual(coercionExecution.status, 0);
  assert.equal(coercionExecution.stdout, "");
  assert.match(String(coercionExecution.stderr), /Color must be text/u);
  assert.match(dynamic.code ?? "", /if \(value == null\) __velarDomStyleClear\(element, /u);
});

test("Look builders are named imports and units calculate outside Look", () => {
  const result = compile(`
import {rgb, spacing} from "velar/look"
const danger = rgb(226, 75, 75)
const base: Length = 8px
const wide: Length = base * 2
const viewportWide: Length = 25vw * 2
const ratio: Percentage = 75%
const fluid: LengthPercentage = ratio - 2rem
const duration: Duration = 1s + 200ms
const angle: Angle = 0.5turn + 90deg
const padding = spacing(fluid, wide)

print(danger)
print(viewportWide)
print(duration)
print(angle)
print(padding)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /import \{[^}]*\} from "velar\/look"/u);
  assert.doesNotMatch(result.code ?? "", /__velarLookCall/u);
  assert.match(result.code ?? "", /__velarLookMath/u);
  const execution = executeWithLookModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "rgb(226 75 75)\n50vw\n1200ms\n270deg\ncalc(75% - 2rem) 16px\n");
});

test("Look diagnostics retain exact right-hand expression spans", () => {
  const source = `
const display = 10
const broken = look:
    display = display
`.trimStart();
  const result = compile(source, { path: "look-spans.vel" });
  const diagnostic = result.diagnostics.find((item) => /Cannot assign number to string/u.test(item.message));
  assert.ok(diagnostic);
  assert.equal(diagnostic.span.start, source.lastIndexOf("display"));
  assert.equal(diagnostic.span.end, source.lastIndexOf("display") + "display".length);
});
