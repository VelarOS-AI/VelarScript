import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { compile as compileCore } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension, webModuleInterfaces } from "../packages/web/src/compiler.ts";
import { LOOK_EXCLUDED_PROPERTIES, LOOK_PROPERTIES, LOOK_PROPERTY_VALUE_KINDS } from "../packages/web/src/look.ts";

function compile(source: string) {
  const imports = new Map<string, unknown>();
  const exports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const item of match[1]!.split(",")) {
      const [imported, local = imported] = item.trim().split(/\s+as\s+/u);
      const type = imported ? exports?.get(imported) : undefined;
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(source.trimStart(), { analysis: { imports: imports as never }, extensions: [velarCompilerExtension] });
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("Core guides keyframes authors to the Web extension without a syntax cascade", () => {
  const result = compileCore("const spin = keyframes:\n    from:\n        opacity = 0\n");
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["VEL2035"]);
  assert.match(result.diagnostics[0]!.message, /add "@velarscript\/web" to velar\.json extensions/u);
});

test("keyframes generate one stable rule and animate produces a checked Look value", () => {
  const result = compile(`
import {animate} from "velar/look"

const spin = keyframes:
    from:
        rotate = 0deg
    to:
        rotate = 1turn

const sameSpin = keyframes:
    from:
        rotate = 0deg
    to:
        rotate = 1turn

const spinning = look:
    animation = animate(spin, 1s, easing="linear", loop=true, direction="reverse", fill="both")

component Spinner():
    return <div look={spinning}>spin</div>
`);
  assert.deepEqual(result.diagnostics, []);
  const rules = result.css?.match(/@keyframes\s+velar-kf-[0-9a-f]{8}/gu) ?? [];
  assert.equal(rules.length, 1, result.css ?? "");
  assert.match(result.css ?? "", /from\{rotate:0deg\}to\{rotate:1turn\}/u);
  assert.match(result.css ?? "", /animation:var\(--velar-look-base-animation\)/u);
  assert.match(result.code ?? "", /__velarKeyframesValue\("velar-kf-[0-9a-f]{8}"\)/u);
});

test("comma stops, middle percentages, dynamic presence, and Animation lists are accepted", () => {
  const result = compile(`
import {animate} from "velar/look"

const pulse = keyframes:
    from, to:
        opacity = 1
    50%:
        opacity = 0.4

component Pulse():
    state active = true
    const one = animate(pulse, 300ms)
    const two = animate(pulse, 600ms, delay=100ms)
    return <div look:animation={active ? [one, two] : null}>pulse</div>
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /from,to\{opacity:1\}50%\{opacity:0.4\}/u);
});

test("keyframes reject malformed stops, interpolation gaps, state reads, and nested Look forms", () => {
  const cases: readonly [string, RegExp][] = [
    ["const bad = keyframes:\n    0%:\n        opacity = 0\n", /Use 'from:'/u],
    ["const bad = keyframes:\n    to:\n        opacity = 1\n    50%:\n        opacity = 0\n", /ascending order/u],
    ["const bad = keyframes:\n    from:\n        opacity = 0\n    from:\n        opacity = 1\n", /duplicates from/u],
    ["const bad = keyframes:\n    middle:\n        opacity = 1\n", /Unknown keyframe stop 'middle'/u],
    ["const bad = keyframes:\n    from:\n        display = \"none\"\n", /does not participate in animation interpolation/u],
    ["const bad = keyframes:\n    from:\n        if true:\n            opacity = 0\n", /contain only direct Look properties/u],
    ["component Bad():\n    state phase = 0\n    const bad = keyframes:\n        from:\n            opacity = phase\n    return <div>x</div>\n", /reactive 'phase' cannot be read inside a stop/u],
  ];
  for (const [source, expected] of cases) {
    assert.ok(messages(source).some((message) => expected.test(message)), `${expected}: ${JSON.stringify(messages(source))}`);
  }
});

test("animate validates literal options and animation text teaches keyframes", () => {
  const prefix = `
import {animate} from "velar/look"
const frames = keyframes:
    from:
        opacity = 0
    to:
        opacity = 1
`;
  const cases: readonly [string, RegExp][] = [
    [`${prefix}const value = animate(frames, 0ms)\n`, /duration must be greater than zero/u],
    [`${prefix}const value = animate(frames, 1s, delay=-1ms)\n`, /delay cannot be negative/u],
    [`${prefix}const value = animate(frames, 1s, count=1.5)\n`, /count must be a positive integer/u],
    [`${prefix}const value = animate(frames, 1s, count=2, loop=true)\n`, /either count or loop/u],
    [`${prefix}const value = animate(frames, 1s, easing="spring")\n`, /easing 'spring' is not supported/u],
    ["const broken = look:\n    animation = \"spin 1s linear\"\n", /declare a checked 'keyframes:' value/u],
  ];
  for (const [source, expected] of cases) {
    assert.ok(messages(source).some((message) => expected.test(message)), `${expected}: ${JSON.stringify(messages(source))}`);
  }
});

test("exported keyframes keep their checked type across a module interface", async () => {
  const root = join(tmpdir(), "velar-batch-i-cross-module");
  const frames = join(root, "frames.vel");
  const main = join(root, "main.vel");
  const project = await compileProject(main, new Map([
    [frames, "export const pulse = keyframes:\n    from:\n        opacity = 0\n    to:\n        opacity = 1\n"],
    [main, "import {animate} from \"velar/look\"\nimport {pulse} from \"./frames.vel\"\nconst page = look:\n    animation = animate(pulse, 1s)\ncomponent App():\n    return <main look={page}>ok</main>\n"],
  ]), { extensions: [velarCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.ok(project.modules.some((module) => /@keyframes velar-kf-/u.test(module.result.css ?? "")));
});

test("the Look property table has an explicit type kind and exercises new property families", () => {
  assert.equal(LOOK_PROPERTIES.size, LOOK_PROPERTY_VALUE_KINDS.size);
  for (const property of LOOK_PROPERTIES) assert.ok(LOOK_PROPERTY_VALUE_KINDS.has(property), property);
  const result = compile(`
import {color, shadow, tracks} from "velar/look"
const expanded = look:
    textShadow = shadow(0px, 1px, 2px, color("black"))
    gridAutoColumns = tracks(1fr)
    paddingInlineStart = 12px
    borderTopColor = color("red")
    scrollPaddingTop = 20px
    scrollSnapType = "y mandatory"
    accentColor = color("blue")
    writingMode = "vertical-rl"
`);
  assert.deepEqual(result.diagnostics, []);
});

test("Look string values reject garbage and teach typed builders", () => {
  const cases: readonly [string, RegExp][] = [
    ["display = \"flexx\"", /does not accept 'flexx'/u],
    ["padding = \"big\"", /does not accept 'big'/u],
    ["padding = \"12px\"", /Use the unit literal 12px/u],
    ["color = \"reddish\"", /does not accept 'reddish'/u],
    ["gridTemplateColumns = \"240px minmax(0, 1fr)\"", /tracks\(\.\.\.\) builder/u],
    ["backgroundImage = \"linear-gradient(red, blue)\"", /Use linearGradient/u],
  ];
  for (const [entry, expected] of cases) {
    const reported = messages(`const bad = look:\n    ${entry}\n`);
    assert.ok(reported.some((message) => expected.test(message)), `${entry}: ${JSON.stringify(reported)}`);
  }
  assert.deepEqual(compile("const good = look:\n    display = \"grid\"\n    marginInline = \"auto\"\n    color = \"red\"\n").diagnostics, []);
});

test("excluded real CSS properties state the boundary and unsafe CSS escape", () => {
  for (const name of ["float", "tableLayout", "columnCount", "animationName"]) {
    assert.ok(LOOK_EXCLUDED_PROPERTIES.has(name));
    const reported = messages(`const bad = look:\n    ${name} = \"none\"\n`);
    assert.ok(reported.some((message) => message.includes("outside checked Look") && message.includes("import css unsafe")), JSON.stringify(reported));
  }
});

test("native element names suggest typos while hyphenated custom elements remain legal", () => {
  const typo = messages("component App():\n    return <dvi>bad</dvi>\n");
  assert.ok(typo.some((message) => /Unknown native element '<dvi>'; did you mean '<div>'/u.test(message)), JSON.stringify(typo));
  assert.deepEqual(compile("component App():\n    return <user-card data-id=\"1\">ok</user-card>\n").diagnostics, []);
  assert.ok(messages("component App():\n    return <font-face>old SVG spelling</font-face>\n").some((message) => /Unknown native element '<font-face>'/u.test(message)));
  assert.deepEqual(compile("component App():\n    return <svg aria-hidden=\"true\"><linearGradient id=\"paint\"></linearGradient></svg>\n").diagnostics, []);
});
