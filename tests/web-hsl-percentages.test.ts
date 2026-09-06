import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces, webModuleSource } from "../packages/web/src/compiler.ts";

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
  const result = compileWithLook(`import {hsl} from "velar/look"

const strength = 50

export const panel = look:
    color = hsl(200, strength, 50%)
`);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [
    "VEL4001 HSL saturation is a percentage, and 50 is a number; write 50%",
  ]);
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
