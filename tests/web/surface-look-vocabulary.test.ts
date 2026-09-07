import assert from "node:assert/strict";
import test from "node:test";
import { clean, messages, only } from "../support/web-surface-diagnostics.ts";

/**
 * D115 P5 — what a Look value is allowed to say, and what the message says when
 * it is not: one subject of the file that was `tests/web/surface.test.ts`
 * before it reached 1,464 lines.
 *
 * LOK-U3 and LOK-U8 are the two vocabulary rulings — the media subjects are a
 * closed set, and a literal builder argument is range-checked while the module
 * compiles — and web-27, web-28 and wr-5 ask the same question everywhere else
 * it comes up: in a keyframes stop that folds its builder calls at compile
 * time, in the transition longhand that takes its builder's vocabulary, and in
 * the two VEL5060 sentences that had been stating a rule the code does not
 * enforce. The bodies below are the bodies that file had.
 */

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
    ["hsl(180, 140%, 50%)", "HSL saturation must be from 0% through 100%; hsl received 140%"],
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

// web-27: a `keyframes:` stop lowers its builder calls at compile time, so the
// runtime range guard the charter points at never runs there.
test("[web-27] a const-folded builder argument is range-checked wherever it is written", () => {
  const stop = messages(`
import {rgb, alpha} from "velar/look"

const hot = 200 + 200
const over = 0.5 + 0.9

export const kf = keyframes:
    from:
        color = rgb(hot, 0, 0)
    to:
        color = alpha(rgb(0, 0, 0), over)

mount(<div />, "#app")
`);
  assert.ok(stop.includes("VEL5042 RGB channel 1 must be from 0 through 255; rgb received 400"), JSON.stringify(stop));
  assert.ok(stop.includes("VEL5042 Color opacity must be from 0 through 1; alpha received 1.4"), JSON.stringify(stop));

  // The same folded argument inside an ordinary Look block reports too, and an
  // in-range token still compiles.
  assert.ok(messages(`
import {rgb} from "velar/look"

const hot = 200 + 200

export const l = look:
    color = rgb(hot, 0, 0)

mount(<div look={l} />, "#app")
`).includes("VEL5042 RGB channel 1 must be from 0 through 255; rgb received 400"));

  clean(`
import {rgb, alpha} from "velar/look"

const warm = 100 + 20
const soft = 0.2 + 0.3

export const kf = keyframes:
    from:
        color = rgb(warm, 0, 0)
    to:
        color = alpha(rgb(0, 0, 0), soft)

mount(<div />, "#app")
`);
});

// web-28: the charter says the two transition longhands take the vocabularies
// the matching builders take, which presumes the builder has one.
test("[web-28] the transition builder's property argument takes the longhand's vocabulary", () => {
  assert.equal(only(`
import {transition} from "velar/look"

export const l = look:
    transition = transition("backgroundColor", 200ms)

mount(<div look={l} />, "#app")
`), "VEL5038 The transition builder's property argument does not accept 'backgroundColor'; did you mean 'background-color'?");

  assert.match(only(`
import {transition} from "velar/look"

export const l = look:
    transition = transition("bakcground", 200ms)

mount(<div look={l} />, "#app")
`), /^VEL5038 The transition builder's property argument does not accept 'bakcground';/u);

  clean(`
import {transition} from "velar/look"

export const l = look:
    transition = transition("background-color", 200ms)

mount(<div look={l} />, "#app")
`);
  // A design token in the same position is checked the same way.
  assert.match(only(`
import {transition} from "velar/look"

const animated = "backgroundColor"

export const l = look:
    transition = transition(animated, 200ms)

mount(<div look={l} />, "#app")
`), /^VEL5038 The transition builder's property argument does not accept 'backgroundColor';/u);
});

// wr-5: two VEL5060 messages stated a rule the code does not enforce. The
// keyframe message left const bindings out of the list of things that resolve
// and then named only the sources, never the shape the same checker also
// demands, while D60 rule 151 is precisely the ruling that made a design token
// usable in a stop; the count/loop message prescribed `loop=true` to an author
// who wrote `loop=false`, and then described `loop` as the infinite one, which
// is false of exactly the value that motivated the finding.
const KEYFRAME_STATIC_MESSAGE = "VEL5060 A keyframe value must resolve to static CSS from literals, unit values,"
  + " arithmetic, velar/look builders, or const bindings — local or imported — that hold any of those, and the text"
  + " it resolves to must read as one declaration value: no ';', '{', '}', or '@' outside a string, with"
  + " parentheses, strings, and comments all closed";

test("[wr-5] the keyframe static-CSS message names every spelling that resolves", () => {
  assert.equal(only(`
def pick() -> number:
    return 1

const computed = pick()

export const kf = keyframes:
    from:
        opacity = computed
    to:
        opacity = 1

mount(<div />, "#app")
`), KEYFRAME_STATIC_MESSAGE);

  // The checker is `staticCssValue` AND `isCssDeclarationValue`, so a plain
  // string literal — a spelling the first half of the message says resolves —
  // is still refused when its text is not one declaration value. The message
  // states that half too, or it denies a spelling while telling the author it
  // is accepted.
  for (const value of [`"a}|100{transform:b"`, `"none; color: red"`, `"translate(1px"`, `"a @media b"`]) {
    assert.equal(only(`
export const kf = keyframes:
    from:
        transform = ${value}
    to:
        transform = "none"

mount(<div />, "#app")
`), KEYFRAME_STATIC_MESSAGE);
  }

  // The const spelling the message now names really is accepted, so the message
  // and the behaviour are pinned together.
  clean(`
import {rgb} from "velar/look"

const ink = rgb(10, 20, 30)
const lift = 12px

export const kf = keyframes:
    from:
        color = ink
        translate = lift
    to:
        color = ink
        translate = 0px

mount(<div />, "#app")
`);
});

test("[wr-5] the count/loop message states the rule instead of prescribing loop=true", () => {
  const both = `
import {animate} from "velar/look"

export const kf = keyframes:
    from:
        opacity = 0
    to:
        opacity = 1

component App:
    return <div look:animation={animate(kf, 1s, count=3, loop=REPETITION)}>hi</div>

mount(<App />, "#app")
`;
  // Writing both arguments is ambiguous authoring whatever the value, so the
  // guard fires for `loop=false` as well; only the message changed. `loop` is a
  // bool and the runtime lowers it as `loop ? "infinite" : String(count)`, so
  // `loop=false` names a finite run and the message must not describe `loop`
  // itself as the infinite one — it is `loop=true` that replaces the count.
  for (const repetition of ["true", "false"]) {
    const reported = only(both.replace("REPETITION", repetition));
    assert.equal(reported,
      "VEL5060 animate accepts either count or loop, not both: count names the number of runs, and loop=true replaces that count with an unbounded one");
    assert.doesNotMatch(reported, /loop an infinite one|use loop=true/u);
  }

  // Each argument on its own still compiles, `loop=false` included.
  for (const repetition of ["count=3", "loop=true", "loop=false"]) {
    clean(both.replace("count=3, loop=REPETITION", repetition));
  }
});
