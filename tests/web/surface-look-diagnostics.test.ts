import assert from "node:assert/strict";
import test from "node:test";
import { clean, messages, only } from "../support/web-surface-diagnostics.ts";

/**
 * D115 P5 — one Look mistake, one message, one time: the diagnostic-layer
 * subject of the file that was `tests/web/surface.test.ts` before it reached
 * 1,464 lines.
 *
 * LOK-I1 through LOK-I6 are the inconsistencies the audit found in the
 * reporting itself — a mistake counted twice, a redirect that worked in one
 * direction only, a block a leading comment stopped tokenizing — and web-35 and
 * ruling R3(c) are the same subject where a duplicate is decided: on the
 * lowered condition the emitted rule carries, and between two Looks placed side
 * by side that state no order between them. The bodies below are the bodies
 * that file had.
 */

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

// web-35 and ruling R3(b): the duplicate scope keys on the lowered condition,
// which is the one the emitted rule carries.
test("[web-35] a duplicate property under an equivalent condition is reported, not hidden", () => {
  assert.equal(only(`
export const a = look:
    if scheme.dark:
        color = "red"
    if not scheme.light:
        color = "blue"

mount(<div look={a}>x</div>, "#app")
`), "VEL5039 Look property 'color' is defined more than once in the same scope");

  // The same holds for reduced motion, for a negated hook, and for a breakpoint
  // written as the negation of its complement.
  assert.equal(only(`
export const a = look:
    if motion.reduced:
        color = "red"
    if not motion.reduced:
        color = "blue"
    if motion.reduced:
        color = "green"

mount(<div look={a}>x</div>, "#app")
`), "VEL5039 Look property 'color' is defined more than once in the same scope");

  assert.equal(only(`
export const a = look:
    if @hover:
        color = "red"
    else:
        color = "blue"
    if not @hover:
        color = "green"

mount(<div look={a}>x</div>, "#app")
`), "VEL5039 Look property 'color' is defined more than once in the same scope");

  // Genuinely different conditions keep their own scopes.
  clean(`
export const a = look:
    if scheme.dark:
        color = "red"
    if scheme.light:
        color = "blue"

mount(<div look={a}>x</div>, "#app")
`);
});

// Ruling R3(c): two looks placed side by side state no order, so a property both
// of them set has no answer the source gives.
function lookCollisions(source: string): readonly string[] {
  return messages(source).filter((message) => message.startsWith("VEL5068"));
}

test("[R3c] two independent looks that set one property are refused and taught the composing spelling", () => {
  const reported = lookCollisions(`
export const themeLook = look:
    if scheme.dark:
        color = "blue"

export const badgeLook = look:
    if @hover:
        color = "red"

mount(<div look={[themeLook, badgeLook]}>x</div>, "#app")
`);
  assert.equal(reported.length, 1, JSON.stringify(reported));
  assert.match(reported[0]!, /Look 'themeLook' and Look 'badgeLook' both set 'color'/u);
  assert.match(reported[0]!, /write one Look that starts with '\.\.\.themeLook' and overrides 'color' from there/u);

  // Composition is the explicit override spelling and stays legal.
  assert.deepEqual(lookCollisions(`
export const themeLook = look:
    if scheme.dark:
        color = "blue"

export const badgeLook = look:
    ...themeLook
    if @hover:
        color = "red"

mount(<div look={[themeLook, badgeLook]}>x</div>, "#app")
`), []);

  // Two looks that set different properties are independent and stay legal, and
  // one property on two different targets is two different decisions.
  assert.deepEqual(lookCollisions(`
export const themeLook = look:
    color = "blue"

export const badgeLook = look:
    padding = 4px

mount(<div look={[themeLook, badgeLook]}>x</div>, "#app")
`), []);
  assert.deepEqual(lookCollisions(`
export const themeLook = look:
    color = "blue"

export const badgeLook = look:
    @before:
        color = "red"

mount(<div look={[themeLook, badgeLook]}>x</div>, "#app")
`), []);
});
