import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";

// Wave N-2c: the Web surface items of completeness audits nine, ten, and eleven
// (docs/decisions/archive/COMPLETENESS-AUDITS.md) plus D47 rule 84. Each probe sits at the
// level the ledger's evidence was taken at: the diagnostics are checked where
// they are produced, and the four items whose evidence was a live page -- the
// two Look forms that stay reactive, real computed layout from Look lengths,
// bind member paths, and bind:group -- run in Chromium.

const root = resolve(new URL("..", import.meta.url).pathname);

function compile(text: string) {
  const imports = new Map<string, unknown>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      const type = imported ? lookExports?.get(imported) : undefined;
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text.trimStart(), {
    analysis: { imports: imports as never },
    extensions: [velarCompilerExtension],
  });
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function only(source: string): string {
  const reported = messages(source);
  assert.equal(reported.length, 1, JSON.stringify(reported));
  return reported[0]!;
}

function clean(source: string): ReturnType<typeof compile> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  return result;
}

// ---------------------------------------------------------------------------
// LOK-D1: a Look literal is a snapshot, so a reactive read inside one is loud.
// ---------------------------------------------------------------------------

test("[LOK-D1] a reactive read inside a Look literal is rejected and teaches the two live forms", () => {
  for (const [label, source] of [
    ["state condition", `
component App:
    state active = false
    const box = look:
        if active:
            color = "red"
    return <div look={box}>x</div>
`],
    ["state value", `
component App:
    state tone = "red"
    const box = look:
        color = tone
    return <div look={box}>x</div>
`],
    ["prop condition", `
component App(active: bool):
    const box = look:
        if active:
            color = "red"
    return <div look={box}>x</div>
`],
    ["computed accessor", `
component App:
    state count = 0
    const hot = cached(() => count > 3)
    const box = look:
        if hot():
            color = "red"
    return <div look={box}>x</div>
`],
    ["module state", `
state active = false
const box = look:
    if active:
        color = "red"
mount(<div look={box}>x</div>, "#app")
`],
    ["composition spread", `
const base = look:
    color = "red"
component App:
    state extra = base
    const box = look:
        ...extra
        padding = 2px
    return <div look={box}>x</div>
`],
  ] as const) {
    const reported = messages(source);
    assert.ok(reported.some((item) => item.startsWith("VEL5058") && /read as a snapshot/u.test(item)
      && /look=\{/u.test(item) && /look:property=/u.test(item)), `${label}: ${JSON.stringify(reported)}`);
  }
});

test("[LOK-D1] CSS-level conditions and non-reactive values stay legal inside a Look literal", () => {
  clean(`
import {rgb} from "velar/look"

const breakpoint = 720px
const accent = rgb(20, 40, 80)

component App(tone: string = "cool"):
    const box = look:
        color = accent
        if @hover:
            color = rgb(90, 20, 20)
        if viewport.width <= breakpoint:
            padding = 4px
        if scheme.dark:
            color = rgb(240, 240, 240)
        if motion.reduced:
            transitionDuration = 0ms
    return <div look={box}>x</div>
`);
});

test("[LOK-D1] an ordinary binding that shares a computed's name is not a reactive read", () => {
  clean(`
import {rgb} from "velar/look"

const warm = rgb(200, 60, 40)
const cool = rgb(40, 60, 200)

def toneLook(improving: bool) -> Look:
    return look:
        color = improving ? warm : cool

component Card(value: number):
    const improving = cached(() => value >= 0)
    return <p look={toneLook(improving())}>x</p>
`);
});

// ---------------------------------------------------------------------------
// LOK-D2 / LOK-D5: the two silently discarded Look declarations.
// ---------------------------------------------------------------------------

test("[LOK-D2] a component-scoped CSS import is rejected and moved to the module", () => {
  const reported = only(`
component App:
    import css unsafe "./card.css" before look
    return <div>x</div>
`);
  assert.match(reported, /^VEL5037 Unsafe CSS is module-level; move the declaration to the top of the module/u);

  const nested = only(`
def install():
    import css unsafe "./card.css" before look

mount(<div>x</div>, "#app")
`);
  assert.match(nested, /^VEL5037 Unsafe CSS is module-level/u);
});

test("[LOK-D5] animation text teaches checked keyframes and longhands name their boundary", () => {
  const shorthand = only(`
const box = look:
    animation = "spin 1s linear infinite"

mount(<div look={box}>x</div>, "#app")
`);
  assert.match(shorthand, /^VEL5038 Look animation does not accept CSS shorthand text/u);
  assert.match(shorthand, /keyframes:/u);
  assert.match(shorthand, /animate/u);
  const longhand = only(`
const box = look:
    animationName = "spin"

mount(<div look={box}>x</div>, "#app")
`);
  assert.match(longhand, /outside checked Look/u);
  assert.match(longhand, /keyframes plus animate/u);
  assert.match(longhand, /import css unsafe/u);
  assert.match(only(`
mount(<div look:animation="spin 1s">x</div>, "#app")
`), /^VEL5038 Look animation does not accept CSS shorthand text/u);
});

// ---------------------------------------------------------------------------
// LOK-D3: bare numbers on length properties produced dead CSS.
// ---------------------------------------------------------------------------

test("[LOK-D3] a bare number on a length property is rejected with the unit it needs", () => {
  for (const entry of ["width = 100", "padding = 16", "gap = 8", "borderRadius = 4", "fontSize = 14", "translate = 2"]) {
    const reported = only(`
const box = look:
    ${entry}

mount(<div look={box}>x</div>, "#app")
`);
    assert.match(reported, /^VEL5038 Look property '[a-zA-Z]+' is a CSS length and requires a unit; write a unit value such as 16px, 1rem, or 50%$/u);
  }
  assert.match(only(`
mount(<div look:padding={16}>x</div>, "#app")
`), /is a CSS length and requires a unit/u);
  assert.match(only(`
mount(<div style:width={100}>x</div>, "#app")
`), /is a CSS length and requires a unit/u);
});

test("[LOK-D3] zero and the unitless property set stay legal", () => {
  const result = clean(`
const box = look:
    padding = 0
    margin = 0
    lineHeight = 1.5
    opacity = 0.5
    zIndex = 3
    fontWeight = 600
    flexGrow = 1
    flexShrink = 0
    order = 2
    aspectRatio = 1.5
    width = 100px

mount(<div look={box}>x</div>, "#app")
`);
  assert.match(result.css ?? "", /line-height:var\(--velar-look-base-line-height\)/u);
  assert.match(result.css ?? "", /flex-grow:var\(--velar-look-base-flex-grow\)/u);
  assert.match(result.code ?? "", /"base:padding": 0/u);
});

test("[LOK-D3] the layout builders reject a unitless non-zero length", () => {
  for (const [call, builder] of [
    ['padding = spacing(16, 8px)', "spacing"],
    ['gridTemplateColumns = tracks(120, 1fr)', "tracks"],
    ['gridTemplateColumns = minmax(100, 1fr)', "minmax"],
    ['width = clamp(100, 50%, 400px)', "clamp"],
  ] as const) {
    const source = `
import {clamp, minmax, spacing, tracks} from "velar/look"

const box = look:
    ${call}

mount(<div look={box}>x</div>, "#app")
`;
    assert.ok(messages(source).some((item) => item.startsWith("VEL5042") && item.includes(`${builder} composes CSS lengths`)
      && /only 0 is unitless/u.test(item)), JSON.stringify(messages(source)));
  }
  clean(`
import {spacing} from "velar/look"

const box = look:
    padding = spacing(0, 8px)

mount(<div look={box}>x</div>, "#app")
`);
});

// ---------------------------------------------------------------------------
// LOK-D4: the media subjects can no longer be reverse-shadowed.
// ---------------------------------------------------------------------------

test("[LOK-D4] the Look media subjects are reserved bindings in a Web module", () => {
  for (const name of ["viewport", "scheme", "motion"]) {
    assert.match(only(`
const ${name} = {width: 10}

mount(<div>x</div>, "#app")
`), new RegExp(`^VEL3007 '${name}' is a reserved extension binding$`, "u"));
    assert.ok(messages(`
def read(${name}: number) -> number:
    return ${name}

mount(<div>x</div>, "#app")
`).some((item) => item.startsWith("VEL3007")));
  }
});

// ---------------------------------------------------------------------------
// LOK-I1 .. LOK-I6: the diagnostic-layer inconsistencies.
// ---------------------------------------------------------------------------

test("[LOK-I1] an unrecognized Look property and a rejected unit calculation each report once", () => {
  assert.match(only(`
const box = look:
    columnCount = 3

mount(<div look={box}>x</div>, "#app")
`), /^VEL5038 CSS property 'columnCount' is outside checked Look/u);

  assert.deepEqual(messages(`
import {shadow, color} from "velar/look"

const box = look:
    textShadow = shadow(0px, 0px, 2px, color("red"))

mount(<div look={box}>x</div>, "#app")
`), []);

  assert.equal(only(`
const box = look:
    width = 10px * 2px

mount(<div look={box}>x</div>, "#app")
`), "VEL5042 Look unit arithmetic cannot apply '*' to Length and Length");
});

test("[LOK-I2] targets, flipped breakpoints, and unknown properties all redirect symmetrically", () => {
  assert.equal(only(`
const box = look:
    if @before:
        color = "red"

mount(<div look={box}>x</div>, "#app")
`), "VEL5038 Use '@before:' as a target block; '@before' is a pseudo-element target, not an element state condition");

  assert.equal(only(`
const box = look:
    @hover:
        color = "red"

mount(<div look={box}>x</div>, "#app")
`), "VEL5038 Use 'if @hover:'; '@hover' is an element state condition, not a pseudo-element target");

  assert.equal(only(`
const box = look:
    if 720px >= viewport.width:
        color = "red"

mount(<div look={box}>x</div>, "#app")
`), "VEL5052 Write the viewport on the left of a breakpoint: 'viewport.width <= 720px'");

  assert.equal(only(`
const box = look:
    colr = "red"

mount(<div look={box}>x</div>, "#app")
`), "VEL5038 Unknown Look property 'colr'; did you mean 'color'?");
  assert.equal(only(`
mount(<div look:colr="red">x</div>, "#app")
`), "VEL5038 Unknown inline Look property 'colr'; did you mean 'color'?");
  assert.equal(only(`
mount(<div style:colr="red">x</div>, "#app")
`), "VEL5038 Unknown inline Style property 'colr'; did you mean 'color'?");
});

test("[LOK-I3] the plausible Look mistakes each report one directed message", () => {
  assert.equal(only(`
component Card(look: Look):
    return <div>x</div>

mount(<Card />, "#app")
`), "VEL2016 Every component already accepts 'look'; remove it from the prop list and pass it at the call site with look={...}");

  assert.equal(only(`
const box = look:

mount(<div>x</div>, "#app")
`), "VEL5038 A Look block requires at least one indented 'property = value' entry");

  assert.equal(only(`
mount(<div look={look:
    color = "red"}>x</div>, "#app")
`), "VEL5053 An inline Look block is not supported; use look:property directives for simple overrides or extract a const Look for conditions and targets");
});

test("[LOK-I3] a comment or a blank line before the first Look entry keeps the block tokenized", () => {
  for (const opening of ["    // the resting state\n", "\n"]) {
    const result = clean(`
const box = look:
${opening}    color = "red"
    padding = 8px

mount(<div look={box}>x</div>, "#app")
`);
    assert.match(result.css ?? "", /\[data-velar-look~="base:color"\]/u);
    assert.match(result.css ?? "", /\[data-velar-look~="base:padding"\]/u);
  }
});

test("[LOK-I4] two sibling blocks with the same condition report their duplicate property", () => {
  assert.equal(only(`
const box = look:
    if @hover:
        color = "red"
    if @hover:
        color = "blue"

mount(<div look={box}>x</div>, "#app")
`), "VEL5039 Look property 'color' is defined more than once in the same scope");

  assert.equal(only(`
const box = look:
    @before:
        content = ""
    @before:
        content = "x"

mount(<div look={box}>x</div>, "#app")
`), "VEL5039 Look target '@before' is defined more than once in the same scope");

  // Different conditions are different scopes and stay legal.
  clean(`
const box = look:
    if @hover:
        color = "red"
    if @focus:
        color = "blue"

mount(<div look={box}>x</div>, "#app")
`);
});

test("[LOK-I6] an empty JSX look list names the accepted family", () => {
  assert.equal(only(`
mount(<div look={[]}>x</div>, "#app")
`), "VEL5040 JSX look accepts a Look, a Look?, or a list of Look values; an empty list composes nothing — remove the attribute");
});

// ---------------------------------------------------------------------------
// LOK-U3 / LOK-U8: the two vocabulary rulings.
// ---------------------------------------------------------------------------

test("[LOK-U3] motion.reduced is a media subject and unknown subjects name the closed set", () => {
  const result = clean(`
const box = look:
    transitionDuration = 200ms

    if motion.reduced:
        transitionDuration = 0ms

    if not motion.reduced:
        transitionDelay = 50ms

mount(<div look={box}>x</div>, "#app")
`);
  assert.match(result.css ?? "", /@media \(prefers-reduced-motion: reduce\)\{\[data-velar-look~="motion-reduce:transition-duration"\]/u);
  assert.match(result.css ?? "", /@media \(prefers-reduced-motion: no-preference\)\{\[data-velar-look~="motion-no-preference:transition-delay"\]/u);

  for (const condition of ["container.width < 700px", "orientation.portrait", "print.active"]) {
    assert.equal(only(`
const box = look:
    if ${condition}:
        color = "red"

mount(<div look={box}>x</div>, "#app")
`), `VEL5038 Look media conditions are viewport.width, viewport.height, scheme.dark, scheme.light, motion.reduced; '${condition.split(/[ <]/u)[0]}' is not one of them`);
  }

  assert.equal(only(`
const box = look:
    if @hovered:
        color = "red"

mount(<div look={box}>x</div>, "#app")
`), "VEL5038 Unknown Look hook '@hovered'; did you mean '@hover'?");
  assert.equal(only(`
const box = look:
    @afta:
        content = ""

mount(<div look={box}>x</div>, "#app")
`), "VEL5038 Unknown Look target '@afta'; did you mean '@after'?");
  assert.match(only(`
const box = look:
    if @completely:
        color = "red"

mount(<div look={box}>x</div>, "#app")
`), /^VEL5038 Unknown Look hook '@completely'; Look hooks are @hover, @focus, /u);
});

test("[LOK-U8] literal builder arguments are range-checked while the module compiles", () => {
  for (const [call, expected] of [
    ["rgb(300, 0, 0)", "RGB channel 1 must be from 0 through 255; rgb received 300"],
    ["rgba(0, 0, 0, 2)", "RGB alpha must be from 0 through 1; rgba received 2"],
    ["hsl(180, 140, 50)", "HSL saturation must be from 0 through 100; hsl received 140"],
    ["lighten(color(\"red\"), 200)", "Color amount must be from 0 through 1; lighten received 200"],
    ["darken(color(\"red\"), -1)", "Color amount must be from 0 through 1; darken received -1"],
  ] as const) {
    const source = `
import {color, darken, hsl, lighten, rgb, rgba} from "velar/look"

const box = look:
    color = ${call}

mount(<div look={box}>x</div>, "#app")
`;
    assert.ok(messages(source).some((item) => item === `VEL5042 ${expected}`), JSON.stringify(messages(source)));
  }

  assert.match(only(`
import {alpha, color} from "velar/look"

const tint = alpha(color("red"), 2)

mount(<div look:color={tint}>x</div>, "#app")
`), /^VEL5042 Color opacity must be from 0 through 1; alpha received 2$/u);

  assert.equal(only(`
const box = look:
    width = 10px / 0

mount(<div look={box}>x</div>, "#app")
`), "VEL5042 Look unit arithmetic cannot divide by zero");

  assert.ok(messages(`
import {border, color} from "velar/look"

const box = look:
    border = border(1px, color("red"), "wavy")

mount(<div look={box}>x</div>, "#app")
`).some((item) => item.startsWith("VEL5042") && /Border style 'wavy' is not a CSS border style/u.test(item)));

  // A computed argument keeps the runtime guard, unchanged.
  clean(`
import {rgb} from "velar/look"

def channel() -> number:
    return 300

const box = look:
    color = rgb(channel(), 0, 0)

mount(<div look={box}>x</div>, "#app")
`);
});

// ---------------------------------------------------------------------------
// D47 rule 84: bind member paths, bind groups, and the event-object boundary.
// ---------------------------------------------------------------------------

test("[D47-84] a writable reactive path is a bind target and lowers to a get/set pair", () => {
  const result = clean(`
type Theme:
    mode: string

type Form:
    name: string
    theme: Theme

component App:
    state form: Form = {name: "", theme: {mode: "dark"}}
    state items: List<string> = [""]

    return <form>
        <input bind:value={form.name} aria-label="Name" />
        <input bind:value={form.theme.mode} aria-label="Mode" />
        <input bind:value={items[0]} aria-label="First" />
    </form>
`);
  assert.match(result.code ?? "", /__velarBindValue\(__velarElement\d+, \{ get: \(\) => \(form\.get\(\)\.name\), set: \(__velarBindNext\) => \{ form\.get\(\)\.name = __velarBindNext; \} \}/u);
  assert.match(result.code ?? "", /get: \(\) => \(form\.get\(\)\.theme\.mode\)/u);
  assert.match(result.code ?? "", /get: \(\) => \(__velarIndex\(items\.get\(\), 0\)\), set: \(__velarBindNext\) => \{ __velarSetIndex\(items\.get\(\), 0, __velarBindNext\); \}/u);
});

test("[D47-84] computed, const, and non-reactive bind targets keep their rejection", () => {
  for (const target of ["doubled", "label", "items.size", "form.missing", "read()"]) {
    const reported = messages(`
type Form:
    name: string

component App:
    state count = 0
    state items: List<string> = []
    state form: Form = {name: ""}
    const doubled = cached(() => count * 2)
    const label = "fixed"

    def read() -> string:
        return label

    return <input bind:value={${target}} />
`);
    assert.ok(reported.some((item) => item.startsWith("VEL5019")
      && /bind:value requires a writable reactive location/u.test(item)), `${target}: ${JSON.stringify(reported)}`);
  }
});

test("[D47-84] bind:group binds radio and checkbox groups and rejects every other shape", () => {
  const result = clean(`
component App:
    state plan = "team"
    state extras: List<string> = []

    return <form>
        <input type="radio" value="solo" bind:group={plan} />
        <input type="radio" value="team" bind:group={plan} />
        <input type="checkbox" value="digest" bind:group={extras} />
    </form>
`);
  assert.match(result.code ?? "", /__velarBindGroup\(__velarElement\d+, plan, __velarComponentScope, false\)/u);
  assert.match(result.code ?? "", /__velarBindGroup\(__velarElement\d+, extras, __velarComponentScope, true\)/u);

  assert.match(only(`
component App:
    state plan = "team"
    return <input type="text" value="solo" bind:group={plan} />
`), /^VEL5019 bind:group binds a group of choices and requires <input type="radio"> or <input type="checkbox">/u);

  assert.match(only(`
component App:
    state plan = "team"
    return <input type="radio" bind:group={plan} />
`), /^VEL5019 bind:group identifies each choice by its value attribute/u);

  assert.ok(messages(`
component App:
    state plan = 3
    return <input type="radio" value="solo" bind:group={plan} />
`).some((item) => item.startsWith("VEL4001") && /Cannot assign number to string/u.test(item)));

  assert.ok(messages(`
component App:
    state extras = ""
    return <input type="checkbox" value="digest" bind:group={extras} />
`).some((item) => item.startsWith("VEL4001") && /Cannot assign string to List<string>/u.test(item)));
});

test("[D47-84] reading target or value off an event teaches the bind spelling once", () => {
  for (const body of ["event.target.value", "event.currentTarget.value", "event.value"]) {
    assert.match(only(`
component App:
    def onInput(event: InputEvent):
        print(${body})
        return null

    return <input on:input={onInput} />
`), /^VEL5019 A VelarScript event object carries typed event fields only and has no '(?:target|currentTarget|value)': read the element's value through a two-way binding instead/u);
  }

  // The hand-rolled assignment form keeps its own bind guidance.
  assert.ok(messages(`
component App:
    state draft = ""
    return <input on:input={event => draft = event.data} />
`).some((item) => item.startsWith("VEL5019") && item.includes("Use 'bind:value={draft}'")));
});

// ---------------------------------------------------------------------------
// WEB-N4 / WEB-C1 / WEB-U13 / WEB-U15 / GRM-A3 / GRM-A4.
// ---------------------------------------------------------------------------

test("[WEB-N4] a keyword prop name and a declaration-position '?' each report one message", () => {
  assert.equal(only(`
component Chip(class: string):
    return <div>x</div>

mount(<Chip class="a" />, "#app")
`), "VEL2016 Every component already accepts 'class'; remove it from the prop list and pass it at the call site with class={...}");

  assert.equal(only(`
component Chip(enum: string):
    return <div>label</div>

mount(<Chip enum="a" />, "#app")
`), "VEL2016 'enum' is a VelarScript keyword and cannot name a component prop; choose another name");

  // D30 item 16: the softened statement-head words are ordinary prop names.
  clean(`
component Chip(match: string, type: string):
    return <div>{match}{type}</div>

mount(<Chip match="a" type="b" />, "#app")
`);

  assert.equal(only(`
component Chip(compact?: bool):
    return <div>{str(compact)}</div>

mount(<Chip />, "#app")
`), "VEL2016 A component prop becomes omittable through its default value, not through '?': write 'compact: Type = default' for a real default, or 'compact: Type? = null' when absence is the value");

  assert.equal(only(`
component Chip(children: WebNode?):
    return <div>{children}</div>

mount(<Chip />, "#app")
`), "VEL5012 Component 'Chip' requires prop 'children'; a prop becomes omittable through its default value — declare 'children: WebNode? = null' on the component");

  clean(`
component Chip(children: WebNode? = null):
    return <div>{children}</div>

mount(<Chip />, "#app")
`);
});

test("[WEB-C1] a key in a fixed position is diagnosed instead of silently ignored", () => {
  assert.match(only(`
mount(<div key="static">x</div>, "#app")
`), /^VEL5050 This JSX key has no effect: '<div>' is rendered in a fixed position/u);

  assert.match(only(`
component Row(label: string):
    return <li>{label}</li>

component App:
    return <ul><Row key="a" label="a" /></ul>

mount(<App />, "#app")
`), /^VEL5050 This JSX key has no effect: '<Row>' is rendered in a fixed position/u);

  // A keyed .map() root keeps its key, and the interpolation diagnostic is unchanged.
  clean(`
component App(labels: List<string> = []):
    return <ul>{labels.map(label => <li key={label}>{label}</li>)}</ul>

mount(<App />, "#app")
`);
  assert.ok(messages(`
component App(ready: bool = false):
    return <ul>{ready ? <li key="one">a</li> : null}</ul>

mount(<App />, "#app")
`).some((item) => item.startsWith("VEL5050") && /keys reuse children by identity only when the interpolation is/u.test(item)));
});

test("[WEB-U13] both JSX comment attempts get one targeted message", () => {
  assert.equal(only(`
mount(<div>
    <!-- a note -->
    <span>x</span>
</div>, "#app")
`), "VEL5002 JSX has no comment form; write a '//' comment on its own line outside the markup");

  assert.equal(only(`
mount(<div>
    {/* a note */}
    <span>x</span>
</div>, "#app")
`), "VEL5002 JSX has no comment form; write a '//' comment on its own line outside the markup");
});

test("[WEB-U15] 'and' rendering and a null component root teach the conditional spellings", () => {
  assert.equal(only(`
component App:
    state ready = true
    return <div>{ready and <span>x</span>}</div>

mount(<App />, "#app")
`), "VEL5029 'and' combines bool values and cannot yield an element; render conditionally with '{ready ? <span ... : null}'");

  assert.equal(only(`
component App:
    return null

mount(<App />, "#app")
`), "VEL4001 A component always returns one JSX root; decide at the call site with '{show ? <Card /> : null}', or return an empty element such as <span />");
});

test("[GRM-A3] '??' starts JSX so a nullish fallback element parses", () => {
  clean(`
component Fallback:
    return <i>none</i>

component App(name: string? = null):
    return <div>{name ?? <Fallback />}</div>

mount(<App />, "#app")
`);
  // '<' after an ordinary value is still the comparison operator.
  clean(`
def smaller(left: number, right: number) -> bool:
    return left < right

mount(<p>{smaller(1, 2)}</p>, "#app")
`);
});

test("[GRM-A4] an empty-record arrow body is rejected in a handler position", () => {
  assert.equal(only(`
mount(<button on:click={() => {}}>x</button>, "#app")
`), "VEL5021 Event 'click' handlers return null, and '{}' after '=>' builds an empty record rather than an empty block; write '() => null' for a handler that does nothing, or name a 'def' that performs the work");

  assert.match(only(`
component App:
    def measure() -> number:
        return 1
    return <button on:click={measure}>x</button>

mount(<App />, "#app")
`), /^VEL5021 Event 'click' handlers return null; this handler returns number/u);

  // A no-op handler and an asynchronous handler stay legal.
  clean(`
component App:
    action save() -> string:
        return "ok"

    return <div>
        <button on:click={() => null}>a</button>
        <button on:click={save}>b</button>
        <button on:click={() => save()}>c</button>
    </div>

mount(<App />, "#app")
`);
});

// ---------------------------------------------------------------------------
// Browser evidence: the ledger measured these four items on a live page.
// ---------------------------------------------------------------------------

function runCommand(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(output || `Command exited with ${String(code)}`));
    });
  });
}

async function runBrowserFixture(application: string, tests: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-web-surface-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "Web surface hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), application, "utf8");
    await writeFile(join(directory, "src", "surface.browser.test.vel"), tests, "utf8");
    return await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const surfaceApplication = String.raw`
import {measure} from "velar/browser"

type Profile:
    name: string

const wideLook = look:
    width = 120px
    height = 20px

const narrowLook = look:
    width = 40px
    height = 20px

const textLook = look:
    width = 30px
    fontSize = 10px
    lineHeight = 3

component App:
    state wide = false
    state profile: Profile = {name: "start"}
    state plan = "team"
    state extras: List<string> = []
    state reading = "pending"

    let composed: Element? = null
    let directive: Element? = null
    let text: Element? = null
    let field: InputElement? = null

    def flip():
        wide = not wide

    def rename():
        profile.name = "written"

    // One reading covers every layout question: the composed Look, the
    // look: directive, an unitless lineHeight, and the bound input's DOM value.
    def sample():
        const first = composed
        const second = directive
        const third = text
        const input = field
        if first == null or second == null or third == null or input == null:
            return null
        reading = f"{str(measure(first).width)}|{str(measure(second).width)}|{str(measure(third).height)}|{input.value}"
        return null

    return <main>
        <div data-composed ref={composed} look={wide ? wideLook : narrowLook}></div>
        <div data-directive ref={directive} look:width={wide ? 120px : 40px} look:height={20px}></div>
        <div data-text ref={text} look={textLook}>ab</div>
        <input data-name ref={field} bind:value={profile.name} aria-label="Name" />
        <p data-name-echo>{profile.name}</p>
        <input data-solo type="radio" value="solo" bind:group={plan} aria-label="Solo" />
        <input data-team type="radio" value="team" bind:group={plan} aria-label="Team" />
        <input data-scale type="radio" value="scale" bind:group={plan} aria-label="Scale" />
        <p data-plan>{plan}</p>
        <input data-digest type="checkbox" value="digest" bind:group={extras} aria-label="Digest" />
        <input data-weekly type="checkbox" value="weekly" bind:group={extras} aria-label="Weekly" />
        <p data-extras>{f"{str(extras.size)}:{extras.join(",")}"}</p>
        <button data-flip type="button" on:click={flip}>flip</button>
        <button data-rename type="button" on:click={rename}>rename</button>
        <button data-sample type="button" on:click={sample}>sample</button>
        <p data-reading>{reading}</p>
    </main>

mount(<App />, "#app")
`;

const surfaceTests = String.raw`
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "reactive look forms stay live and lengths reach layout":
    await browser.open("/")
    await browser.click("[data-sample]")
    // 40px wide from the composed Look and the look: directive; the unitless
    // lineHeight of 3 over a 10px font measures 30px tall.
    await browser.waitForText("[data-reading]", "40|40|30|start")
    await browser.click("[data-flip]")
    await browser.click("[data-sample]")
    await browser.waitForText("[data-reading]", "120|120|30|start")

test "bind member path binds both directions":
    await browser.open("/")
    expect(await browser.text("[data-name-echo]")).toBe("start")
    await browser.fill("[data-name]", "typed")
    await browser.waitForText("[data-name-echo]", "typed")
    await browser.click("[data-rename]")
    await browser.waitForText("[data-name-echo]", "written")
    await browser.click("[data-sample]")
    await browser.waitForText("[data-reading]", "40|40|30|written")

test "radio group switches three ways":
    await browser.open("/")
    expect(await browser.text("[data-plan]")).toBe("team")
    await browser.click("[data-solo]")
    await browser.waitForText("[data-plan]", "solo")
    await browser.click("[data-scale]")
    await browser.waitForText("[data-plan]", "scale")
    await browser.click("[data-team]")
    await browser.waitForText("[data-plan]", "team")

test "checkbox group adds and removes members":
    await browser.open("/")
    expect(await browser.text("[data-extras]")).toBe("0:")
    await browser.click("[data-digest]")
    await browser.waitForText("[data-extras]", "1:digest")
    await browser.click("[data-weekly]")
    await browser.waitForText("[data-extras]", "2:digest,weekly")
    await browser.click("[data-digest]")
    await browser.waitForText("[data-extras]", "1:weekly")
    await browser.click("[data-weekly]")
    await browser.waitForText("[data-extras]", "0:")
`;

test("[N-2c] the reactive Look forms, Look lengths, bind paths, and bind groups hold in Chromium", { timeout: 180_000 }, async () => {
  const output = await runBrowserFixture(surfaceApplication, surfaceTests);
  assert.match(output, /4 passed, 0 failed/u);
});
