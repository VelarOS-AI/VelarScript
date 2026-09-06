import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../../packages/web/src/compiler.ts";

// D114 0.29.0 JX-I1, JX-I2, LK-I2 and LC-I2: one mistake, one report — and one
// diagnostic that told two different mistakes apart.
//
// JX-I1: `Card(title="a")` drew two VEL4001s on the same span, "Render component
// 'Card' with JSX" and "Components use JSX props rather than named call
// arguments". A named argument is *how* the call is spelled, not a second
// mistake, so the one sentence now carries the element the author meant.
//
// JX-I2: a `match` with `return` in its arms inside a component body drew
// VEL5008 ("must have exactly one top-level return") *and* a VEL3003 per arm
// ("'return' can only be used inside a function") — two rules its reader can
// only take as contradicting each other. A component body has no function
// frame, and that is a fact the extension owns; VEL5008 is the whole answer,
// and it now names the two ways out.
//
// LK-I2: a builder call in a `keyframes:` stop that fails its own range check
// (VEL5042) also drew VEL5060, whose "must resolve to static CSS" sentence
// points at a rule against named arguments in a stop that does not exist —
// `lk19` below proves an in-range named argument compiles.
//
// LC-I2: VEL5057 said "Component 'V' does not expose a Handle" both for a
// component that really exposes none and for a one-argument `Component<Props>`
// contract standing in front of a component that exposes one. §14 withholds the
// ref from the *contract*, so the contract is what the refusal now names.

/**
 * `velar/look` builders reach a single-module compile through the analysis
 * context, the way the project driver supplies them; this is compiler.test.ts's
 * own reader, kept to one place so a probe reads like the source an author
 * writes.
 */
function compileWithLook(text: string) {
  const imports = new Map<string, ValueType>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      const type = imported ? lookExports?.get(imported) : undefined;
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text, { analysis: { imports }, extensions: [velarCompilerExtension] });
}

function diagnostics(source: string): readonly string[] {
  return compileWithLook(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function codes(source: string): readonly string[] {
  return compileWithLook(source).diagnostics.map((item) => item.code);
}

test("[JX-I1] a named-argument component call reports once and writes the element", () => {
  assert.deepEqual(diagnostics(`component Card(title: string):
    return <p>{title}</p>

export component Page():
    return <div>{Card(title="a")}</div>
`), [
    `VEL4001 Render component 'Card' with JSX — write '<Card title="a" />'; components take JSX props rather than named call arguments`,
  ]);
});

test("[JX-I1] a positional component call keeps the sentence it had", () => {
  assert.deepEqual(diagnostics(`component Card(title: string):
    return <p>{title}</p>

export component Page():
    return <div>{Card("a")}</div>
`), ["VEL4001 Render component 'Card' with JSX"]);
});

test("[JX-I1] a non-literal prop value takes JSX's braces", () => {
  assert.deepEqual(diagnostics(`component Card(title: string, count: number):
    return <p>{title}{count}</p>

export component Page():
    const n = 2
    return <div>{Card(title="a", count=n)}</div>
`), [
    `VEL4001 Render component 'Card' with JSX — write '<Card title="a" count={n} />'; components take JSX props rather than named call arguments`,
  ]);
});

test("[JX-I1] a mixed positional and named call has no element to write, and still reports once", () => {
  // A positional argument carries no prop name, so the element is withheld
  // rather than guessed; the sentence still says what to do.
  assert.deepEqual(diagnostics(`component Card(title: string, count: number):
    return <p>{title}{count}</p>

export component Page():
    return <div>{Card("a", count=2)}</div>
`), ["VEL4001 Render component 'Card' with JSX; components take JSX props rather than named call arguments"]);
});

const MODE = `enum Mode:
    One
    Two
`;

test("[JX-I2] a match with returns in its arms earns VEL5008 and nothing else", () => {
  assert.deepEqual(diagnostics(`${MODE}
export component Page(mode: Mode):
    match mode:
        case Mode.One:
            return <p>one</p>
        case Mode.Two:
            return <p>two</p>
`), [
    "VEL5008 Component 'Page' must have exactly one top-level return: assign the branches to a binding —"
    + " 'let node: WebNode = <span />' written in each arm — and return it once, or move the branching into a 'def'"
    + " that returns WebNode and return its call",
  ]);
});

test("[JX-I2] both ways out of the count compile clean", () => {
  // The binding the message names.
  assert.deepEqual(codes(`${MODE}
export component Page(mode: Mode):
    let node: WebNode = <span />
    match mode:
        case Mode.One:
            node = <p>one</p>
        case Mode.Two:
            node = <p>two</p>
    return node
`), []);
  // The 'def' the message names.
  assert.deepEqual(codes(`${MODE}
def render(mode: Mode) -> WebNode:
    match mode:
        case Mode.One:
            return <p>one</p>
        case Mode.Two:
            return <p>two</p>

export component Page(mode: Mode):
    return render(mode)
`), []);
});

test("[JX-I2] a lifecycle hook and a watch body are not the component body", () => {
  // Neither returns anything, so a `return` there is the mistake VEL3003 names.
  assert.deepEqual(codes(`export component Page():
    @mounted:
        return
    return <p>a</p>
`), ["VEL3003"]);
  assert.deepEqual(codes(`state n = 0

export component Page():
    watch n:
        return
    return <p>a</p>
`), ["VEL3003"]);
});

test("[JX-I2] a return outside any body keeps VEL3003", () => {
  assert.deepEqual(codes("return 1\n"), ["VEL3003"]);
});

test("[LK-I2] an out-of-range builder in a stop reports its range check alone", () => {
  assert.deepEqual(diagnostics(`import {rgba} from "velar/look"
export const emerge = keyframes:
    from:
        color = rgba(0, 0, 0, alpha=2)
    to:
        color = rgba(0, 0, 0, 1)
`), ["VEL5042 RGB alpha must be from 0 through 1; rgba received 2"]);
});

test("[LK-I2] an in-range named argument in a stop compiles clean", () => {
  assert.deepEqual(codes(`import {shadow, rgb} from "velar/look"
export const emerge = keyframes:
    from:
        boxShadow = shadow(0px, 0px, 18px, rgb(120, 150, 255), spread=2px)
    to:
        boxShadow = shadow(0px, 0px, 2px, rgb(120, 150, 255), spread=0px)
`), []);
});

test("[LK-I2] a stop value that is genuinely not static CSS keeps VEL5060", () => {
  const reports = codes(`state n = 0

export component P():
    const emerge = keyframes:
        from:
            width = 10px * n
        to:
            width = 20px
    return <p>{n}</p>
`);
  assert.ok(reports.includes("VEL5060"), reports.join(","));
});

const DIALOG = `type Handle:
    open: () -> null
component Dialog(title: string) exposes Handle:
    def open():
        print("o")
    expose {open}
    return <dialog>{title}</dialog>
`;

test("[LC-I2] a one-argument contract is refused as a contract, with the contract to write", () => {
  assert.deepEqual(diagnostics(`${DIALOG}type View = Component<(title: string) -> WebNode>
export component Page():
    let h: Handle? = null
    const V: View = Dialog
    return <V ref={h} title="t" />
`), [
    "VEL5057 The contract on 'V' names no Handle, so it does not authorise a component ref — the authority is the"
    + " contract's second type argument, not the component behind it; declare the contract as"
    + " 'Component<(title: string) -> WebNode, Handle>'",
  ]);
});

test("[LC-I2] a component with no exposes keeps the component sentence", () => {
  assert.deepEqual(diagnostics(`type Handle:
    open: () -> null
component Plain(title: string):
    return <p>{title}</p>
export component Page():
    let h: Handle? = null
    return <Plain ref={h} title="t" />
`), ["VEL5057 Component 'Plain' does not expose a Handle"]);
});

test("[LC-I2] the two-argument contract the message names compiles clean", () => {
  assert.deepEqual(codes(`${DIALOG}type View = Component<(title: string) -> WebNode, Handle>
export component Page():
    let h: Handle? = null
    const V: View = Dialog
    return <V ref={h} title="t" />
`), []);
});
