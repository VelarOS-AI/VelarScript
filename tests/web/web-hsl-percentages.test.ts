import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces, webModuleSource } from "../../packages/web/src/compiler.ts";

// D114 P6 item 2 (0.29.0 Web ledger LK-I3): `hsl`'s saturation and lightness
// take `Percentage`, which is what they always were.
//
// The two slots were declared `number` and range-checked 0..100 — that is, the
// number *was* the percentage — while `Percentage` is a first-class unit of
// this language and CSS's own spelling for those slots is `50%`. So the
// language refused `hsl(200, 50%, 50%)`, which is what a CSS author writes, and
// accepted `hsl(200, 50, 50)`, which is one meaning in two spellings with the
// wrong one legal. The slots now take the unit, the domain is stated in it, and
// a bare number earns the remedy plus a mechanical rewrite.
//
// `hsla` does not exist in `velar/look`: `rgba` is the only builder with an
// alpha parameter, and alpha over a colour is `alpha(...)`. There is nothing to
// keep in step here.

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

const written = `import {hsl} from "velar/look"

export const panel = look:
    color = hsl(200, 50%, 50%)
`;

test("[LK-I3] the percentage spelling is the one that compiles", () => {
  assert.deepEqual(diagnostics(written), []);
});

test("[LK-I3] a bare number is refused once per slot, and the message names the percentage to write", () => {
  assert.deepEqual(diagnostics(`import {hsl} from "velar/look"

export const panel = look:
    color = hsl(200, 50, 50)
`), [
    "VEL4001 HSL saturation is a percentage, and 50 is a number; write 50%",
    "VEL4001 HSL lightness is a percentage, and 50 is a number; write 50%",
  ]);
});

test("[LK-I3] 'velar fix' writes the percentage where the argument is a literal", () => {
  const result = compileWithLook(`import {hsl} from "velar/look"

export const panel = look:
    color = hsl(200, 50, 45)
`);
  assert.deepEqual(result.diagnostics.map((item) => item.fix?.title ?? null), ["Write 50%", "Write 45%"]);
  const edits = result.diagnostics.flatMap((item) => item.fix?.edits ?? []);
  assert.deepEqual(edits.map((edit) => edit.text), ["50%", "45%"]);
});

test("[LK-I3] a folded binding earns the sentence and no rewrite, because the declaration is the place to change", () => {
  // D114 F9-web (WB-I7): and the caret is *at* that declaration. It used to sit
  // under `strength` while the sentence said "write 50%", so an author who
  // edited where the report pointed replaced the binding's use with a literal —
  // the one edit that is certainly not the answer. The number is written in the
  // initializer, so the report is drawn there and names the binding, and there
  // is still no mechanical fix: retyping a binding is every other use of it.
  const source = `import {hsl} from "velar/look"

const strength = 50

export const panel = look:
    color = hsl(200, strength, 50%)
`;
  const result = compileWithLook(source);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4001 HSL saturation is a percentage, and 'strength' holds 50, a number; write 50%",
  ]);
  const span = result.diagnostics[0]!.span;
  assert.equal(source.slice(span.start, span.end), "50");
  assert.equal(source.slice(0, span.start).endsWith("const strength = "), true, source.slice(0, span.start));
  assert.equal(result.diagnostics[0]?.fix, undefined);
});

test("[LK-I3] the domain is checked on the percentage, in the wording the number had", () => {
  assert.deepEqual(diagnostics(`import {hsl} from "velar/look"

export const panel = look:
    color = hsl(200, 140%, 50%)
`), ["VEL5042 HSL saturation must be from 0% through 100%; hsl received 140%"]);
  assert.deepEqual(diagnostics(`import {hsl} from "velar/look"

export const panel = look:
    color = hsl(200, 50%, -3%)
`), ["VEL5042 HSL lightness must be from 0% through 100%; hsl received -3%"]);
});

test("[LK-I3] a look block hands the written percentages to the builder", () => {
  const result = compileWithLook(`import {hsl} from "velar/look"

const panel = look:
    color = hsl(200, 50%, 50%)

component App():
    return <p look={panel}>x</p>
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /hsl\(200, "50%", "50%"\)/u, result.code ?? "");
});

test("[LK-I3] a keyframes stop folds the percentage, and an unfoldable one is still refused", () => {
  const folded = compileWithLook(`import {hsl} from "velar/look"

const fade = keyframes:
    from:
        color = hsl(200, 40% + 10%, 50%)
    to:
        color = hsl(200, 80%, 50%)

component App():
    return <div>x</div>
`);
  assert.deepEqual(folded.diagnostics, []);
  assert.match(folded.css ?? "", /color:hsl\(200 50% 50%\)/u, folded.css ?? "");
  const broken = compileWithLook(`import {hsl} from "velar/look"

const fade = keyframes:
    from:
        color = hsl(200, 1% / 0, 50%)
    to:
        color = hsl(200, 80%, 50%)

component App():
    return <div>x</div>
`);
  assert.ok(broken.diagnostics.some((item) => item.code === "VEL5060"), JSON.stringify(broken.diagnostics.map((item) => item.code)));
});

test("[LK-I3] the shipped builder takes the same percentages and states the same domain", () => {
  // A `look:` block folds `hsl` away at compile time; a call written anywhere
  // else reaches the browser as this function, so the two have to agree about
  // what the slot takes and about the bound it states.
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${webModuleSource("velar/look", { base: "/" }) ?? ""}
console.log(hsl(200, "50%", "50%"));
const refuse = (call) => { try { call(); return "accepted"; } catch (error) { return error.constructor.name + ": " + error.message; } };
console.log(refuse(() => hsl(200, 50, 50)));
console.log(refuse(() => hsl(200, "140%", "50%")));
console.log(refuse(() => hsl(200, "50%", "-3%")));
`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(execution.stdout.split("\n").slice(0, 4), [
    "hsl(200 50% 50%)",
    "TypeError: HSL saturation must be a percentage such as 50%",
    "RangeError: HSL saturation must be from 0% through 100%",
    "RangeError: HSL lightness must be from 0% through 100%",
  ]);
});

// The neighbour F7-web left open: `min`, `max` and `clamp` had the same defect
// LK-I3 found on `hsl`, and it was still standing. Their slots take a `Length`
// or a `Percentage` — that is what the three builders exist for — so a bare
// number drew core's assignability refusal *and* this analyzer's unit advice:
// two reports, one mistake, and neither of them naming the slot. The refusal is
// where the lesson goes, by the path LK-I3 opened.
//
// There is no `velar fix` edit here, and that is the difference from `hsl`:
// `100px` and `100%` are different pictures, and the compiler does not know
// which one the author meant.

test("[LK-I3] a bare number in a length-or-percentage slot is one report that names the slot", () => {
  assert.deepEqual(diagnostics(`import {min} from "velar/look"

export const panel = look:
    width = min(100, 600px)
`), ["VEL4001 min's first argument is a Length or a Percentage, and 100 is a number; write 100px or 100%"]);
  assert.deepEqual(diagnostics(`import {clamp} from "velar/look"

export const panel = look:
    fontSize = clamp(16px, 50, 24px)
`), ["VEL4001 clamp's preferred argument is a Length or a Percentage, and 50 is a number; write 50px or 50%"]);
  // One report per bad slot, so two bad slots earn two — each naming its own.
  assert.deepEqual(diagnostics(`import {max} from "velar/look"

export const panel = look:
    width = max(50, 60)
`), [
    "VEL4001 max's first argument is a Length or a Percentage, and 50 is a number; write 50px or 50%",
    "VEL4001 max's second argument is a Length or a Percentage, and 60 is a number; write 60px or 60%",
  ]);
  // Zero is the one unitless length on a CSS property and is not one here:
  // `min(0, 600px)` is not CSS, so the slot says what to write.
  assert.deepEqual(diagnostics(`import {min} from "velar/look"

export const panel = look:
    width = min(0, 600px)
`), ["VEL4001 min's first argument is a Length or a Percentage, and 0 is a number; write 0px or 0%"]);
});

test("[LK-I3] the slot is the one the argument fills, however it is spelled, and a folded binding earns the same sentence", () => {
  assert.deepEqual(diagnostics(`import {min} from "velar/look"

export const panel = look:
    width = min(first=100, second=600px)
`), ["VEL4001 min's first argument is a Length or a Percentage, and 100 is a number; write 100px or 100%"]);
  assert.deepEqual(diagnostics(`import {min} from "velar/look"

const wide = 100

export const panel = look:
    width = min(wide, 600px)
`), ["VEL4001 min's first argument is a Length or a Percentage, and 'wide' holds 100, a number; write 100px or 100%"]);
});

test("[LK-I3] no fix is offered, because the remedy is two spellings and only the author knows which", () => {
  const result = compileWithLook(`import {min} from "velar/look"

export const panel = look:
    width = min(100, 600px)
`);
  assert.deepEqual(result.diagnostics.map((item) => item.fix ?? null), [null]);
});

test("[LK-I3] the slot lesson replaces the LOK-D3 unit advice these three used to draw", () => {
  // The case tests/hardening-web-surface.test.ts's LOK-D3 loop carried until
  // now: `clamp` sat beside `spacing`, `tracks` and `minmax` there and reported
  // twice, because its slots — unlike theirs — refuse a number outright.
  assert.deepEqual(diagnostics(`import {clamp} from "velar/look"

const box = look:
    width = clamp(100, 50%, 400px)

mount(<div look={box}>x</div>, "#app")
`), ["VEL4001 clamp's minimum argument is a Length or a Percentage, and 100 is a number; write 100px or 100%"]);
});

test("[LK-I3] the mixed forms these three builders exist for still compile", () => {
  assert.deepEqual(diagnostics(`import {min, max, clamp} from "velar/look"

export const panel = look:
    width = min(100%, 600px)
    minWidth = max(50%, 2rem)
    fontSize = clamp(16px, 3vw, 24px)
`), []);
  // And a stop keeps folding them, with the refusal's consequence still dropped
  // (LK-I2): a slot lesson written into core's report is a refusal all the same.
  const stop = compileWithLook(`import {min} from "velar/look"

const fade = keyframes:
    from:
        width = min(100, 600px)
    to:
        width = 600px

component App():
    return <div>x</div>
`);
  assert.deepEqual(stop.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4001 min's first argument is a Length or a Percentage, and 100 is a number; write 100px or 100%",
  ]);
});

test("[LK-I3] a builder whose slot takes the number keeps the unit advice, which is its only report", () => {
  // `spacing`, `tracks` and `minmax` publish unions that include `number`, so
  // core does not refuse there and the unit advice is the whole diagnosis.
  assert.deepEqual(diagnostics(`import {spacing} from "velar/look"

export const panel = look:
    padding = spacing(10)
`), ["VEL5042 spacing's first argument is a Length, a Percentage, or 0, and 10 is none of those; write 10px or 10%"]);
});

// D114 F9-web (WB-I2): the unit advice used to end "(only 0 is unitless)" for
// every builder that composes lengths, which is true of the three slots above —
// their union really does take a bare `0` — and a falsehood on `blur` and
// `shadow`, where `blur(0)` is refused and the author was being promised a
// spelling the compiler would reject. The three lessons are now one sentence
// built from the slot's own published type, so the "or 0" clause exists exactly
// where a bare number is accepted and nowhere else.

test("[WB-I2] the unit advice offers zero only in the slots that take it", () => {
  for (const [call, expected] of [
    ["padding = spacing(10)", "VEL5042 spacing's first argument is a Length, a Percentage, or 0, and 10 is none of those; write 10px or 10%"],
    ["gridTemplateColumns = tracks(120)", "VEL5042 tracks' first argument is a Length, a Percentage, or 0, and 120 is none of those; write 120px or 120%"],
    ["gridTemplateColumns = tracks(minmax(100, 1fr))", "VEL5042 minmax's minimum argument is a Length, a Percentage, or 0, and 100 is none of those; write 100px or 100%"],
  ] as const) {
    assert.deepEqual(diagnostics(`import {minmax, spacing, tracks} from "velar/look"

export const panel = look:
    ${call}
`), [expected]);
  }
  // And zero passes there, which is the half of the sentence that has to stay
  // true: it is the one length CSS writes without a unit.
  assert.deepEqual(diagnostics(`import {spacing} from "velar/look"

export const panel = look:
    padding = spacing(0, 8px)
`), []);
});

test("[WB-I2] a slot that refuses zero never says zero is unitless", () => {
  // `blur(0)` and `min(0, 600px)` are refused, so the advice on those builders
  // may not carry the clause at all — the two shapes name what their own slot
  // takes and stop there.
  for (const source of [
    `import {blur, filters} from "velar/look"

export const panel = look:
    filter = filters(blur(0))
`,
    `import {min} from "velar/look"

export const panel = look:
    maxWidth = min(0, 600px)
`,
  ]) {
    const reported = diagnostics(source);
    assert.equal(reported.length, 1, JSON.stringify(reported));
    assert.equal(/unitless|, or 0,/u.test(reported[0]!), false, reported[0] ?? "");
  }
});

// F7-web-b, the neighbour LK-I3 left in the queue: the builders whose slots take
// a `Length` and nothing else — `blur`, `border`, `shadow`, `dropShadow` — were
// still reporting a bare number twice, core's assignability refusal beside this
// analyzer's unit advice. Same in-place rewrite, and this time with a `velar
// fix`: a length has one natural unit, so `4px` is not a guess the way `100px`
// or `100%` would be.
//
// Which slots those are is read from the builder's published type — the very
// declaration core refused against — so `border`'s colour and style, `shadow`'s
// `inset` and `dropShadow`'s colour are outside the rule by their own types
// rather than by a hand-kept list of positions.

test("[LK-I3] a bare number in a Length-only slot is one report that names the slot and its unit", () => {
  assert.deepEqual(diagnostics(`import {blur, filters} from "velar/look"

export const panel = look:
    filter = filters(blur(4))
`), ["VEL4001 blur's radius argument is a Length, and 4 is a number; write 4px"]);
  assert.deepEqual(diagnostics(`import {border, color} from "velar/look"

export const panel = look:
    border = border(2, color("red"))
`), ["VEL4001 border's width argument is a Length, and 2 is a number; write 2px"]);
  assert.deepEqual(diagnostics(`import {dropShadow, filters, color} from "velar/look"

export const panel = look:
    filter = filters(dropShadow(1, 2px, 3px, color("red")))
`), ["VEL4001 dropShadow's x argument is a Length, and 1 is a number; write 1px"]);
  // One report per bad slot, so two bad slots earn two — each naming its own,
  // and `spread` is a Length like the offsets are.
  assert.deepEqual(diagnostics(`import {shadow, color} from "velar/look"

export const panel = look:
    boxShadow = shadow(0, 2, 4px, color("red"), 6)
`), [
    "VEL4001 shadow's x argument is a Length, and 0 is a number; write 0px",
    "VEL4001 shadow's y argument is a Length, and 2 is a number; write 2px",
    "VEL4001 shadow's spread argument is a Length, and 6 is a number; write 6px",
  ]);
});

test("[LK-I3] zero is included, because a unitless zero is not what these slots take", () => {
  // The property rule lets `0` through — CSS does — and the slot rule does not,
  // for the same reason `min(0, 600px)` is refused: the slot's type is the
  // language's `Length`, and `blur(0)` is not one.
  assert.deepEqual(diagnostics(`import {blur, filters} from "velar/look"

export const panel = look:
    filter = filters(blur(0))
`), ["VEL4001 blur's radius argument is a Length, and 0 is a number; write 0px"]);
});

test("[LK-I3] 'velar fix' writes the length, and the rewrite compiles and folds", () => {
  const source = `import {blur, filters} from "velar/look"

const panel = look:
    filter = filters(blur(4))
`;
  const result = compileWithLook(source);
  assert.deepEqual(result.diagnostics.map((item) => item.fix?.title ?? null), ["Write 4px"]);
  const fix = result.diagnostics[0]?.fix;
  assert.ok(fix);
  const edit = fix.edits[0]!;
  const fixed = source.slice(0, edit.span.start) + edit.text + source.slice(edit.span.end);
  assert.equal(fixed.includes("blur(4px)"), true, fixed);
  const rewritten = compileWithLook(`${fixed}
component App():
    return <div look={panel}>x</div>
`);
  assert.deepEqual(rewritten.diagnostics, []);
  assert.match(rewritten.code ?? "", /blur\("4px"\)/u, rewritten.code ?? "");
  // And the same rewrite inside a stop, where the builder folds at compile time
  // and the answer is the CSS itself.
  const stop = compileWithLook(`import {blur, filters} from "velar/look"

const fade = keyframes:
    from:
        filter = filters(blur(4px))
    to:
        filter = filters(blur(0px))

component App():
    return <div>x</div>
`);
  assert.deepEqual(stop.diagnostics, []);
  assert.match(stop.css ?? "", /filter:blur\(4px\)/u, stop.css ?? "");
});

test("[LK-I3] a folded binding earns the sentence and no rewrite, and a named argument fills the same slot", () => {
  // D114 F9-web (WB-I7): the caret is on the binding's initializer, where the
  // edit is, and the sentence names the binding so the line it lands on is
  // explained. It still earns no `velar fix`: retyping a binding is not a
  // mechanical edit, because every other use of it is part of the answer.
  const source = `import {blur, filters} from "velar/look"

const radius = 4

export const panel = look:
    filter = filters(blur(radius))
`;
  const folded = compileWithLook(source);
  assert.deepEqual(folded.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4001 blur's radius argument is a Length, and 'radius' holds 4, a number; write 4px",
  ]);
  assert.equal(source.slice(folded.diagnostics[0]!.span.start, folded.diagnostics[0]!.span.end), "4");
  assert.equal(folded.diagnostics[0]?.fix, undefined);
  assert.deepEqual(diagnostics(`import {shadow, color} from "velar/look"

export const panel = look:
    boxShadow = shadow(x=0px, y=2, blur=4px, color=color("red"))
`), ["VEL4001 shadow's y argument is a Length, and 2 is a number; write 2px"]);
});

test("[LK-I3] the slots these builders own that are not lengths are not this rule's business", () => {
  // `shadow`'s colour used to draw "shadow composes CSS lengths, so 5 requires a
  // unit" beside core's refusal — advice about a unit for a slot that takes a
  // colour. The published type answers this now, so the refusal stands alone.
  assert.deepEqual(diagnostics(`import {shadow} from "velar/look"

export const panel = look:
    boxShadow = shadow(0px, 2px, 4px, 5)
`), ["VEL4001 Cannot assign number to Color"]);
  assert.deepEqual(diagnostics(`import {border, color} from "velar/look"

export const panel = look:
    border = border(2px, color("red"), 3)
`), ["VEL4001 Cannot assign number to string"]);
});

test("[LK-I3] the legal forms are untouched, and a stop still drops the refused call's consequence", () => {
  assert.deepEqual(diagnostics(`import {shadow, blur, dropShadow, filters, border, color} from "velar/look"

export const panel = look:
    boxShadow = shadow(0px, 2px, 4px, color("red"), 6px)
    filter = filters(blur(4px), dropShadow(1px, 2px, 3px, color("red")))
    border = border(2px, color("red"), "solid")
`), []);
  const stop = compileWithLook(`import {blur, filters} from "velar/look"

const fade = keyframes:
    from:
        filter = filters(blur(4))
    to:
        filter = filters(blur(0px))

component App():
    return <div>x</div>
`);
  assert.deepEqual(stop.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4001 blur's radius argument is a Length, and 4 is a number; write 4px",
  ]);
});

// D114 WB-X1: `tracks(4, 8px)` was refused and `tracks(8px, 4)` drew nothing.
// The slot lesson read the builder's published parameter list at the argument's
// own position, and a rest builder declares one parameter — so every argument
// the rest collects had no type to read and no name to say, and the check
// stopped after position 0. A rest parameter's type is the type of every
// position it covers, so the lesson fires at each offending argument.
//
// The look vocabulary has exactly two rest builders: `tracks` and `filters`.
// Only `tracks` collects a length-bearing slot, so it is the only one whose
// reports change; `filters` collects `Filter`, which is not this rule's
// business, and keeps core's refusal as its whole report.

test("[WB-X1] a rest builder teaches its unit lesson at every argument, not only the first", () => {
  const trackList = (call: string): readonly string[] => diagnostics(`import {minmax, tracks} from "velar/look"

export const grid = look:
    gridTemplateColumns = ${call}
`);

  // The two orders now behave the same way; before the fix the second was silent.
  assert.deepEqual(trackList("tracks(4, 8px)"),
    ["VEL5042 tracks' first argument is a Length, a Percentage, or 0, and 4 is none of those; write 4px or 4%"]);
  assert.deepEqual(trackList("tracks(8px, 4)"),
    ["VEL5042 tracks' argument 2 is a Length, a Percentage, or 0, and 4 is none of those; write 4px or 4%"]);

  // Each offending argument earns its own report, and the legal ones stay quiet.
  assert.deepEqual(trackList("tracks(8px, 4, 12, 16px, 20)"), [
    "VEL5042 tracks' argument 2 is a Length, a Percentage, or 0, and 4 is none of those; write 4px or 4%",
    "VEL5042 tracks' argument 3 is a Length, a Percentage, or 0, and 12 is none of those; write 12px or 12%",
    "VEL5042 tracks' argument 5 is a Length, a Percentage, or 0, and 20 is none of those; write 20px or 20%",
  ]);

  // The named position keeps the wording F9-web gave it, and a whole call of
  // legal track sizes still compiles clean.
  assert.deepEqual(trackList("tracks(120)"),
    ["VEL5042 tracks' first argument is a Length, a Percentage, or 0, and 120 is none of those; write 120px or 120%"]);
  assert.deepEqual(trackList("tracks(8px, 1fr, 25%, 0, minmax(100px, 1fr))"), []);
});

// D114 F10-web (0.32.0 ledger WB-I1): the other rest builder teaches its own
// slot too.
//
// `filters` is the look vocabulary's second and last rest builder. X-wave gave
// `tracks` a lesson at every collected position and left this one with core's
// bare `Cannot assign number to Filter` — a sentence that names no slot, offers
// no remedy, and leaves an author with nowhere to find out what a `Filter` is
// made of. It is still core's refusal and still one report; it now says which
// slot and what makes a value for it.
const filterLesson = (slot: string) => `VEL4001 filters' ${slot} is a Filter,`
  + " and a Filter comes from one of the filter builders:"
  + " blur, brightness, contrast, dropShadow, filterOpacity, grayscale, hueRotate, invert, saturate, sepia";

test("[WB-I1] the other rest builder teaches its slot at every argument too", () => {
  assert.deepEqual(diagnostics(`import {filters, blur} from "velar/look"

export const card = look:
    filter = filters(blur(4px), 3)
`), [filterLesson("argument 2")]);
  // The named position and the collected ones differ only in how the slot is
  // spelled, which is the wording `tracks` already uses.
  assert.deepEqual(diagnostics(`import {filters} from "velar/look"

export const card = look:
    filter = filters(3)
`), [filterLesson("first argument")]);
  // Every offending argument earns its own report and the legal ones stay
  // quiet, and the lesson is about the slot rather than about numbers: any
  // value core refuses there gets it.
  assert.deepEqual(diagnostics(`import {filters, blur, sepia} from "velar/look"

export const card = look:
    filter = filters(blur(4px), 3, sepia(0.4), "blur(2px)")
`), [filterLesson("argument 2"), filterLesson("argument 4")]);
  assert.deepEqual(diagnostics(`import {filters, blur, grayscale} from "velar/look"

export const card = look:
    filter = filters(blur(4px), grayscale(0.5))
`), []);
});
