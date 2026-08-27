import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile as compileCore } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension, webModuleInterfaces, webModuleSources } from "../packages/web/src/compiler.ts";
import { LOOK_EXCLUDED_PROPERTIES, LOOK_PROPERTIES, LOOK_PROPERTY_VALUE_KINDS } from "../packages/web/src/look.ts";
import { CSS_STRING_RUNTIME, cssString } from "../packages/web/src/css-string.ts";
import { isCssDeclarationValue } from "../packages/web/src/css-tokens.ts";
import { keyframesName } from "../packages/web/src/keyframes.ts";

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
  const rules = result.css?.match(/@keyframes\s+velar-kf-[0-9a-f]{32}/gu) ?? [];
  assert.equal(rules.length, 1, result.css ?? "");
  assert.match(result.css ?? "", /from\{rotate:0deg\}to\{rotate:1turn\}/u);
  assert.match(result.css ?? "", /animation:var\(--velar-look-base-animation\)/u);
  assert.match(result.code ?? "", /__velarKeyframesValue\("velar-kf-[0-9a-f]{32}"\)/u);
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

test("builder weights fold before they lower, so an arithmetic opacity is a real percentage", () => {
  const result = compile(`
import {alpha, darken, lighten, rgb} from "velar/look"

const ink = rgb(10, 20, 30)

const fade = keyframes:
    from:
        color = alpha(ink, 1 - 0.4)
    50%:
        color = lighten(ink, 7 / 20)
    to:
        color = darken(ink, 1 / 4)

component Fade():
    return <div>x</div>
`);
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.css ?? "", /NaN/u, result.css ?? "");
  assert.match(result.css ?? "", /rgb\(10 20 30\) 60%, transparent/u, result.css ?? "");
  assert.match(result.css ?? "", /rgb\(10 20 30\), white 35%/u, result.css ?? "");
  assert.match(result.css ?? "", /rgb\(10 20 30\), black 25%/u, result.css ?? "");
  // An opacity that does not fold is a compile error, never a dead `NaN%`
  // declaration that silently drops the colour.
  const unfoldable = compile(`
import {alpha, rgb} from "velar/look"

const ink = rgb(10, 20, 30)

const fade = keyframes:
    from:
        color = alpha(ink, 1 / 0)
    to:
        color = ink

component Fade():
    return <div>x</div>
`);
  assert.ok(unfoldable.diagnostics.length > 0);
  assert.doesNotMatch(unfoldable.css ?? "", /NaN/u, unfoldable.css ?? "");
});

// wr-4: the opacity fix stopped at three builders, and every other slot CSS
// reads as one token rather than as a value kept concatenating `calc(...)` into
// a position that cannot hold one, so the browser dropped the declaration.
test("a builder slot CSS reads as one token folds, so no keyframe declaration lowers to dead CSS", () => {
  const result = compile(`
import {hsl, repeat} from "velar/look"

const fade = keyframes:
    from:
        color = hsl(200, 40 + 10, 50)
        gridTemplateColumns = repeat(1 + 1, 10px)
    to:
        color = hsl(180 + 20, 50, 25 * 2)
        gridTemplateColumns = repeat(2, 10px + 5px)

component Fade():
    return <div>x</div>
`);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.css ?? "", /color:hsl\(200 50% 50%\)/u, result.css ?? "");
  assert.match(result.css ?? "", /grid-template-columns:repeat\(2, 10px\)/u, result.css ?? "");
  // The hue is a bare `<number>` and a track size is a value, so `calc()` stays
  // legal in both of those positions.
  assert.match(result.css ?? "", /color:hsl\(calc\(180 \+ 20\) 50% 50%\)/u, result.css ?? "");
  assert.match(result.css ?? "", /grid-template-columns:repeat\(2, calc\(10px \+ 5px\)\)/u, result.css ?? "");
  assert.doesNotMatch(result.css ?? "", /calc\([^)]*\)%/u, result.css ?? "");
  assert.doesNotMatch(result.css ?? "", /NaN/u, result.css ?? "");
  // A slot that does not fold is a compile error, exactly as an unfoldable
  // opacity is, rather than a declaration the browser silently drops.
  const dead = `
import {asset, border, hsl, repeat, rgb, shadow} from "velar/look"

const inset = true

const fade = keyframes:
    from:
        VALUE
    to:
        opacity = 1

component Fade():
    return <div>x</div>
`;
  for (const value of [
    "color = hsl(200, 1 / 0, 50)",
    "gridTemplateColumns = repeat(1 / 0, 10px)",
    "border = border(1px, rgb(0, 0, 0), \"da\" + \"shed\")",
    "boxShadow = shadow(1px, 0px, 2px, rgb(0, 0, 0), 0px, inset)",
    "backgroundImage = asset(\"a\" + \".png\")",
  ]) {
    const broken = compile(dead.replace("VALUE", value));
    assert.ok(broken.diagnostics.some((item) => item.code === "VEL5060"), value + " -> " + JSON.stringify(broken.diagnostics.map((item) => item.code)));
    assert.doesNotMatch(broken.css ?? "", /calc\(|NaN|url\("calc/u, value + " -> " + (broken.css ?? ""));
  }
});

test("a statically known builder argument keeps its range check inside a keyframes stop", () => {
  const source = `
import {alpha, rgb} from "velar/look"

const hot = 200 + 200
const over = 0.5 + 0.9

const bad = keyframes:
    from:
        color = rgb(hot, 0, 0)
    to:
        color = alpha(rgb(0, 0, 0), over)

component Bad():
    return <div>x</div>
`;
  const result = compile(source);
  assert.ok(result.diagnostics.length > 0, JSON.stringify(messages(source)));
  assert.doesNotMatch(result.css ?? "", /rgb\(400 0 0\)/u, result.css ?? "");
  assert.doesNotMatch(result.css ?? "", /140%/u, result.css ?? "");
  // The named spelling places the same argument at the same position, so the
  // lowering reads the same range table there too.
  const named = compile(`
import {rgb} from "velar/look"

const hot = 200 + 200

const bad = keyframes:
    from:
        color = rgb(red=hot, green=0, blue=0)
    to:
        color = rgb(red=0, green=0, blue=0)

component Bad():
    return <div>x</div>
`);
  assert.ok(named.diagnostics.length > 0);
  assert.doesNotMatch(named.css ?? "", /rgb\(400 0 0\)/u, named.css ?? "");
});

test("a keyframe stop value is one declaration and cannot reach raw stylesheet text", () => {
  const result = compile(`
const evil = keyframes:
    from:
        transform = "rotate(0deg)"
    to:
        transform = "rotate(360deg)} } .victim { display: none "

component Evil():
    return <div>x</div>
`);
  assert.ok(result.diagnostics.length > 0);
  assert.doesNotMatch(result.css ?? "", /victim/u, result.css ?? "");
  // The gate itself: a value that ends its declaration, its rule, or its
  // string is not a value.
  for (const rejected of ["a}b", "a{b", "a;b", "@import url(x)", "translate(4px", "a) b", "a \"unterminated", "a /* unterminated"]) {
    assert.equal(isCssDeclarationValue(rejected), false, rejected);
  }
  for (const accepted of ["rotate(360deg)", "url(\"a}b\")", "min(10px, calc(2px * 3))", "\"quoted ) text\"", ""]) {
    assert.equal(isCssDeclarationValue(accepted), true, accepted);
  }
});

test("keyframes identity is injective and the generated name is a wide digest", () => {
  const result = compile(`
export const a = keyframes:
    from:
        transform = "translateX(0px)"
    to:
        transform = "translateX(8px)"

export const b = keyframes:
    from:
        transform = "translateX(0px)"
    to:
        transform = "translateX(9px)"

component Pair():
    return <div>x</div>
`);
  assert.deepEqual(result.diagnostics, []);
  const names = [...(result.code ?? "").matchAll(/__velarKeyframesValue\("(velar-kf-[0-9a-f]+)"\)/gu)].map((match) => match[1]!);
  assert.equal(names.length, 2, JSON.stringify(names));
  assert.notEqual(names[0], names[1]);
  for (const name of names) assert.match(name, /^velar-kf-[0-9a-f]{32}$/u);
  // The forged spelling that used to canonicalize as a two-stop animation and
  // steal the first one's name is refused outright.
  const forged = compile(`
export const a = keyframes:
    from:
        transform = "a"
    to:
        transform = "b"

export const b = keyframes:
    from:
        transform = "a}|100{transform:b"

component Pair():
    return <div>x</div>
`);
  assert.ok(forged.diagnostics.length > 0);
  assert.equal((forged.code ?? "").match(/__velarKeyframesValue\("/gu)?.length ?? 0, 0);
  assert.notEqual(keyframesName("0{transform:a}|100{transform:b}"), keyframesName("0{transform:a}"));
  assert.match(keyframesName(""), /^velar-kf-[0-9a-f]{32}$/u);
});

test("a CSS string is escaped for CSS, and the runtime spelling agrees with the compiler", () => {
  assert.equal(cssString("line1\nline2"), "\"line1\\A line2\"");
  assert.equal(cssString("a\tb"), "\"a\\9 b\"");
  assert.equal(cssString("a\u007Fb"), "\"a\\7F b\"");
  assert.equal(cssString("•"), "\"•\"");
  assert.equal(cssString("a\"b\\c"), "\"a\\\"b\\\\c\"");
  const runtime = new Function(`${CSS_STRING_RUNTIME}\nreturn __velarCssString;`)() as (value: string) => string;
  for (const sample of ["line1\nline2", "a\tb", "•", "a\"b\\c", "", " x", "\u{1F642}", "a\u007Fb"]) {
    assert.equal(runtime(sample), cssString(sample), JSON.stringify(sample));
  }
  const result = compile(`
import {asset} from "velar/look"

const art = keyframes:
    from:
        backgroundImage = asset("a\\nb")
    to:
        backgroundImage = asset("c.png")

component Art():
    return <div>x</div>
`);
  assert.deepEqual(result.diagnostics, []);
  // JSON's `\n` reads in CSS as the letter `n`, so the address used to resolve
  // to `anb`; the CSS spelling is `\A ` and keeps the break.
  assert.match(result.css ?? "", /url\("a\\A b"\)/u, result.css ?? "");
  assert.doesNotMatch(result.css ?? "", /url\("a\\n/u, result.css ?? "");
});

// wr-7: three `velar/web` error paths called `__velarEnqueue`, which only the
// `velar/app` module declares, so the fallback that runs when no app runtime is
// registered was itself a ReferenceError. A name is in scope in an emitted
// module only when that module's own source declares it.
test("every emitted Web module declares the runtime helpers its own source calls", () => {
  const freeNames = (source: string): readonly string[] => {
    const declared = new Set<string>();
    for (const match of source.matchAll(/\b(?:function|const|let|var|class)\s+(__velar\w*)/gu)) declared.add(match[1]!);
    // 运行时模块现在也可以通过依赖图导入另一个标准模块的私有绑定。具名
    // import 的本地别名和函数、常量一样属于当前模块声明，不能被误判为
    // 泄漏的自由变量。
    for (const statement of source.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/gu)) {
      for (const binding of statement[1]!.split(",")) {
        const local = /(?:^|\s+as\s+)(__velar\w*)\s*$/u.exec(binding.trim());
        if (local) declared.add(local[1]!);
      }
    }
    // A name behind a dot, inside a string, or in front of a colon is a
    // property rather than a binding this module has to declare.
    const used = [...source.matchAll(/(?<![.\w"'`$])(__velar\w*)\b(?!\s*:)/gu)].map((match) => match[1]!);
    return [...new Set(used.filter((name) => !declared.has(name)))];
  };
  assert.deepEqual(freeNames("function __velarOwn(value) { return __velarOwn(value); }"), []);
  assert.deepEqual(freeNames('const held = { __velarEnqueue: 1 }; held.__velarEnqueue; "__velarEnqueue";'), []);
  assert.deepEqual(freeNames("__velarEnqueue(() => { throw error; });"), ["__velarEnqueue"], "the walker sees a free helper call");
  const escaped: string[] = [];
  for (const [name, source] of webModuleSources) for (const free of freeNames(source)) escaped.push(`${name}: ${free}`);
  assert.deepEqual(escaped, []);
});

// wr-7: the walker above proves the name is declared; this drives the branch
// that reads it. With no app runtime registered there is nothing to report to,
// and the fallback has to reach the author with the original failure rather
// than with a ReferenceError raised while trying to report it.
test("a Web error path with no app runtime registered rethrows the original failure", async () => {
  const source = webModuleSources.get("velar/web") ?? "";
  const directory = await mkdtemp(join(tmpdir(), "velar-web-fallback-"));
  const file = join(directory, "web.mjs");
  await writeFile(file, source + "\nexport function reportLinkFailure(failure) { reportLinkEventFailure(failure); }\n");
  const queued: (() => void)[] = [];
  const previous = globalThis.queueMicrotask;
  // The module captures the native queueMicrotask as it loads, so the recorder
  // has to stand in from before the import until after the call.
  globalThis.queueMicrotask = (callback: () => void) => { queued.push(callback); };
  const failure = new Error("link handler failed");
  try {
    const loaded = await import(pathToFileURL(file).href) as { reportLinkFailure(failure: unknown): void };
    loaded.reportLinkFailure(failure);
  } finally {
    globalThis.queueMicrotask = previous;
  }
  assert.equal(queued.length, 1, "the fallback queues the rethrow instead of raising while reporting");
  assert.throws(() => { queued[0]!(); }, (error: unknown) => error === failure);
});
