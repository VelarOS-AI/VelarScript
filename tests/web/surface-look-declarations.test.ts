import assert from "node:assert/strict";
import test from "node:test";
import { clean, messages, only } from "../support/web-surface-diagnostics.ts";

/**
 * D115 P5 — the Look declarations a `look:` block used to accept and then drop
 * on the floor, one subject of the file that was `tests/web/surface.test.ts`
 * before it reached 1,464 lines.
 *
 * Completeness audits nine, ten and eleven
 * (docs/decisions/archive/COMPLETENESS-AUDITS.md) found five ways to write a
 * declaration the compiler accepted and the page never showed: a reactive read
 * frozen into a snapshot, a component-scoped CSS import, animation text nobody
 * checked, a bare number where CSS needs a unit, and a media subject an
 * ordinary binding could shadow. Each is refused here at the level the ledger's
 * evidence was taken at — where the diagnostic is produced. The bodies below
 * are the bodies that file had.
 */

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
    ["computed value", `
component App:
    state count = 0
    computed hot = count > 3
    const box = look:
        if hot:
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
    computed improving = value >= 0
    return <p look={toneLook(improving)}>x</p>
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
  ] as const) {
    const source = `
import {minmax, spacing, tracks} from "velar/look"

const box = look:
    ${call}

mount(<div look={box}>x</div>, "#app")
`;
    // WB-I2: the slot names what it takes, and the "or 0" clause is here because these three unions do accept a bare zero.
    assert.ok(messages(source).some((item) => item.startsWith("VEL5042") && item.includes("is a Length, a Percentage, or 0, and")
      && item.includes(`${builder}${builder.endsWith("s") ? "'" : "'s"} `)), JSON.stringify(messages(source)));
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
