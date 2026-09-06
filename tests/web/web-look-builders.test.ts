import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../../packages/web/src/compiler.ts";

// D114 0.29.0 LK-C3: `min`, `max` and `clamp` took `Length` in every slot, so
// the reason those three functions exist in CSS — mixing `%` with `px` — had no
// spelling in Look at all, while the charter's builder section and web-api both
// listed them among the layout builders that "accept … percentages".
//
//   /…/probes/lk70.vel:3:20 error VEL4001: Cannot assign Percentage to Length
//       maxWidth = min(100%, 600px)
//
// Each slot now takes `Length` or `Percentage`, and the declared result is the
// widest of the three. A call whose slots are all one kind still reads as that
// kind — the fold `+` already makes — which is what keeps the tour's own
// `clamp(1rem, 4vw, 3rem)` a `Length` and legal on `lineHeight`, the one
// property that takes a length and refuses a percentage.

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

function messages(source: string): readonly string[] {
  return compileWithLook(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[LK-C3] a percentage beside a length is accepted in every slot", () => {
  assert.deepEqual(messages(`import {min, max, clamp} from "velar/look"
export const a = look:
    maxWidth = min(100%, 600px)
    minHeight = max(10px, 5%)
    width = clamp(16px, 50%, 24px)
    gap = clamp(4px, 1%, 8px)
    inset = min(2%, 8px)
`), []);
});

test("[LK-C3] an all-percentage call is a percentage, and lands where one is accepted", () => {
  assert.deepEqual(messages(`import {min} from "velar/look"
export const a = look:
    maxWidth = min(100%, 60%)
`), []);
});

test("[LK-C3] an all-length call still answers Length", () => {
  // The tour's own three lines, annotated `Length` — the fold is what keeps them
  // compiling, and `lineHeight` is the property that proves the answer is not
  // the widened type.
  assert.deepEqual(messages(`import {min, max, clamp} from "velar/look"
const narrow: Length = min(16px, 2rem)
const wide: Length = max(16px, 2rem)
const fluid: Length = clamp(1rem, 4vw, 3rem)
export const a = look:
    width = clamp(16px, 3vw, 24px)
    lineHeight = clamp(16px, 3vw, 24px)
    paddingLeft = narrow
    paddingRight = wide
    marginTop = fluid
`), []);
});

test("[LK-C3] a property that refuses a percentage still refuses the widened result", () => {
  // `lineHeight` takes a number, a Length, or a keyword — never a percentage —
  // and that is the answer the report has to keep giving.
  assert.deepEqual(messages(`import {min} from "velar/look"
export const a = look:
    lineHeight = min(100%, 2rem)
`), ["VEL4001 Cannot assign LengthPercentage to number | Length | string"]);
});

test("[LK-C3] a slot given something that is neither is refused by the slot", () => {
  assert.deepEqual(messages(`import {min} from "velar/look"
export const a = look:
    maxWidth = min(100%, 2s)
`), ["VEL4001 Cannot assign Duration to Length | Percentage | LengthPercentage"]);
});

test("[LK-C3] the emitted CSS is the natural call", () => {
  const compiled = compileWithLook(`import {min, max, clamp} from "velar/look"
const panel = look:
    maxWidth = min(100%, 600px)
    minHeight = max(10px, 5%)
    width = clamp(16px, 50%, 24px)

export component App():
    return <p look={panel}>hi</p>
`);
  assert.deepEqual(compiled.diagnostics, []);
  const code = compiled.code ?? "";
  assert.match(code, /min\("100%", "600px"\)/u);
  assert.match(code, /max\("10px", "5%"\)/u);
  assert.match(code, /clamp\("16px", "50%", "24px"\)/u);
});

test("[LK-C3] a length-only builder keeps its length-only slots", () => {
  // `blur` is not one of the three; nothing about its slot moved.
  assert.deepEqual(messages(`import {blur} from "velar/look"
export const a = look:
    filter = blur(50%)
`), ["VEL4001 Cannot assign Percentage to Length"]);
});
