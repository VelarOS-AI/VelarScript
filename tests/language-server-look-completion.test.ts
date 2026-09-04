import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import {
  projectCompletionContextAt,
  projectCompletionsAt,
  type ProjectCompletion,
} from "../packages/cli/src/project-semantic.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";
import {
  LOOK_PROPERTIES,
  LOOK_PROPERTY_CSS_FUNCTIONS,
  LOOK_PROPERTY_KEYWORDS,
} from "../packages/web/src/look.ts";

const CARET = "\u00a7";
let probeSequence = 0;

interface CompletionProbeItem extends ProjectCompletion {
  readonly filterText?: string;
  readonly insertText?: string;
}

async function completionsAt(markedSource: string): Promise<{
  readonly context: string;
  readonly items: readonly CompletionProbeItem[];
}> {
  const offset = markedSource.indexOf(CARET);
  assert.notEqual(offset, -1, "the completion probe has no caret");
  assert.equal(markedSource.indexOf(CARET, offset + CARET.length), -1, "the completion probe has more than one caret");
  const source = markedSource.slice(0, offset) + markedSource.slice(offset + CARET.length);
  const path = join(tmpdir(), `velar-look-completion-${process.pid}-${probeSequence++}.vel`);
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarWebCompilerExtension],
  });
  assert.ok(project.modules.some((module) => module.inputPath === path));
  return {
    context: projectCompletionContextAt(project, path, offset),
    items: projectCompletionsAt(project, path, offset) as readonly CompletionProbeItem[],
  };
}

function labels(items: readonly CompletionProbeItem[]): readonly string[] {
  return items.map((item) => item.label);
}

function unquoted(text: string): string {
  return text.length >= 2 && text.startsWith('"') && text.endsWith('"')
    ? text.slice(1, -1)
    : text;
}

function filterText(item: CompletionProbeItem): string {
  return item.filterText ?? unquoted(item.label);
}

function insertedText(item: CompletionProbeItem): string {
  return item.insertText ?? item.label;
}

function itemFor(items: readonly CompletionProbeItem[], wanted: string): CompletionProbeItem | undefined {
  return items.find((item) => filterText(item) === wanted || unquoted(item.label) === wanted);
}

function assertNoOrdinaryItems(items: readonly CompletionProbeItem[]): void {
  const actual = new Set(labels(items));
  for (const unwanted of ["const", "if", "return", "component", "drop", "localHelper"])
    assert.ok(!actual.has(unwanted), `${unwanted} leaked into Look completion`);
}

const completionPrelude = `
import {drop} from "velar/collections"
import {
    animate as makeAnimation,
    border,
    linearGradient,
    minmax,
    rgb as makeColor,
    shadow as makeShadow,
    spacing as makeSpacing,
    token,
    tracks as makeTracks,
    transition as makeTransition,
} from "velar/look"

def localHelper() -> string:
    return "local"

def rgb() -> string:
    return "local rgb"

def shadow() -> string:
    return "local shadow"

def tracks() -> string:
    return "local tracks"

def transition() -> string:
    return "local transition"

def spacing() -> string:
    return "local spacing"

def animate() -> string:
    return "local animate"

const frames = keyframes:
    from:
        opacity = 0
    to:
        opacity = 1
`.trimStart();

function lookValueSource(property: string, value: string): string {
  return `${completionPrelude}\nconst probe = look:\n    ${property} = ${value}\n`;
}

test("Look property completion owns blank, partial, and nested property positions without leaking outside", async () => {
  const blank = await completionsAt(`${completionPrelude}
const card = look:
    ${CARET}
    color = makeColor(1, 2, 3)
`);
  assert.equal(blank.context, "extension:@velarscript/web:look-property");
  assert.deepEqual([...labels(blank.items)].sort(), [...LOOK_PROPERTIES].sort());
  assertNoOrdinaryItems(blank.items);
  assert.ok(!labels(blank.items).includes("rgb"));

  const partial = await completionsAt(`${completionPrelude}
const card = look:
    col${CARET}
`);
  assert.equal(partial.context, "extension:@velarscript/web:look-property");
  assert.ok(itemFor(partial.items, "color"));
  assert.ok(partial.items.every((item) => LOOK_PROPERTIES.has(item.label)), labels(partial.items).join(", "));
  assertNoOrdinaryItems(partial.items);
  assert.ok(!labels(partial.items).includes("rgb"));

  for (const nested of [
    `${completionPrelude}\nconst card = look:\n    if @hover:\n        ${CARET}color = "red"\n`,
    `${completionPrelude}\nconst card = look:\n    @before:\n        ${CARET}content = ""\n`,
  ]) {
    const result = await completionsAt(nested);
    assert.equal(result.context, "extension:@velarscript/web:look-property");
    assert.ok(itemFor(result.items, "display"));
    assert.ok(result.items.every((item) => LOOK_PROPERTIES.has(item.label)), labels(result.items).join(", "));
    assertNoOrdinaryItems(result.items);
  }

  const target = await completionsAt(`${completionPrelude}\nconst card = look:\n    @b${CARET}\n`);
  assert.equal(target.context, "extension:@velarscript/web:look-target");
  assert.equal(itemFor(target.items, "@before")?.insertText, "@before:");
  assertNoOrdinaryItems(target.items);

  const hook = await completionsAt(`${completionPrelude}\nconst card = look:\n    if @h${CARET}\n`);
  assert.equal(hook.context, "extension:@velarscript/web:look-hook");
  assert.equal(itemFor(hook.items, "@hover")?.insertText, "@hover:");
  assertNoOrdinaryItems(hook.items);

  const media = await completionsAt(`${completionPrelude}\nconst card = look:\n    if viewport.${CARET}\n`);
  assert.equal(media.context, "extension:@velarscript/web:look-media");
  assert.equal(itemFor(media.items, "viewport.width")?.insertText, "viewport.width <= ");
  assertNoOrdinaryItems(media.items);

  const outside = await completionsAt(`${completionPrelude}
const card = look:
    color = makeColor(1, 2, 3)

const ordinary = ${CARET}localHelper()
`);
  assert.equal(outside.context, "ordinary");
  assert.ok(itemFor(outside.items, "localHelper"));
  assert.ok(itemFor(outside.items, "drop"));
});

test("Look keyword and CSS-function completion inserts valid quoted or in-string values", async () => {
  const display = await completionsAt(lookValueSource("display", `${CARET}"flex"`));
  assert.equal(display.context, "extension:@velarscript/web:look-value");
  assertNoOrdinaryItems(display.items);
  for (const keyword of LOOK_PROPERTY_KEYWORDS.get("display") ?? []) {
    const item = itemFor(display.items, keyword);
    assert.ok(item, `display does not offer ${keyword}`);
    assert.equal(item.label, JSON.stringify(keyword));
    assert.equal(insertedText(item), JSON.stringify(keyword));
  }
  for (const incompatible of ["makeColor", "makeShadow", "makeTracks", "makeTransition", "makeSpacing", "makeAnimation", "border", "linearGradient", "minmax"])
    assert.ok(!itemFor(display.items, incompatible), `${incompatible} is not a display value`);

  const cursor = await completionsAt(lookValueSource("cursor", `"no-d${CARET}"`));
  assert.equal(cursor.context, "extension:@velarscript/web:look-value");
  assertNoOrdinaryItems(cursor.items);
  const noDrop = itemFor(cursor.items, "no-drop");
  assert.ok(noDrop, "cursor does not complete no-d to no-drop");
  assert.equal(insertedText(noDrop), "no-drop");

  const filter = await completionsAt(lookValueSource("filter", `"drop${CARET}"`));
  assert.equal(filter.context, "extension:@velarscript/web:look-value");
  assertNoOrdinaryItems(filter.items);
  const dropShadow = itemFor(filter.items, "drop-shadow()");
  assert.ok(dropShadow, "filter does not complete drop to drop-shadow()");
  assert.equal(insertedText(dropShadow), "drop-shadow(0px 2px 4px rgba(0, 0, 0, 0.25))");
  for (const incompatible of ["makeColor", "makeShadow", "makeTracks", "makeTransition", "makeSpacing", "makeAnimation", "border", "linearGradient", "minmax"])
    assert.ok(!itemFor(filter.items, incompatible), `${incompatible} is not a filter value`);

  assert.deepEqual(LOOK_PROPERTY_CSS_FUNCTIONS.get("filter")?.map((item) => item.name), [
    "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia", "url",
  ]);
  const everyFilterFunction = await completionsAt(lookValueSource("backdropFilter", `"${CARET}"`));
  for (const available of LOOK_PROPERTY_CSS_FUNCTIONS.get("backdropFilter") ?? [])
    assert.ok(itemFor(everyFilterFunction.items, `${available.name}()`), `backdropFilter does not offer ${available.name}()`);

  const clipPath = await completionsAt(lookValueSource("clipPath", `"ins${CARET}"`));
  const inset = itemFor(clipPath.items, "inset()");
  assert.ok(inset, "clipPath does not offer inset()");
  assert.equal(insertedText(inset), "inset(0px)");
});

test("Look value completion filters imported builders by property and preserves aliases", async () => {
  const cases = [
    {
      property: "color",
      value: `${CARET}makeColor(1, 2, 3)`,
      included: ["makeColor", "token"],
      excluded: ["rgb", "alpha", "makeShadow", "makeTracks", "makeTransition", "makeSpacing", "makeAnimation", "border", "linearGradient", "minmax"],
    },
    {
      property: "boxShadow",
      value: `${CARET}makeShadow(0px, 1px, 2px, makeColor(0, 0, 0))`,
      included: ["makeShadow", "token"],
      excluded: ["shadow", "makeColor", "makeTracks", "makeTransition", "makeSpacing", "makeAnimation", "border", "linearGradient", "minmax"],
    },
    {
      property: "gridTemplateColumns",
      value: `${CARET}makeTracks(1fr)`,
      included: ["makeTracks", "token"],
      excluded: ["tracks", "repeat", "minmax", "makeColor", "makeShadow", "makeTransition", "makeSpacing", "makeAnimation", "border", "linearGradient"],
    },
    {
      property: "transition",
      value: `${CARET}makeTransition("opacity", 100ms)`,
      included: ["makeTransition", "token"],
      excluded: ["transition", "makeColor", "makeShadow", "makeTracks", "makeSpacing", "makeAnimation", "border", "linearGradient", "minmax"],
    },
    {
      property: "padding",
      value: `${CARET}makeSpacing(4px)`,
      included: ["makeSpacing", "token"],
      excluded: ["spacing", "makeColor", "makeShadow", "makeTracks", "makeTransition", "makeAnimation", "border", "linearGradient", "minmax"],
    },
    {
      property: "animation",
      value: `${CARET}makeAnimation(frames, 100ms)`,
      included: ["makeAnimation"],
      excluded: ["animate", "token", "makeColor", "makeShadow", "makeTracks", "makeTransition", "makeSpacing", "border", "linearGradient", "minmax"],
    },
  ] as const;

  for (const probe of cases) {
    const result = await completionsAt(lookValueSource(probe.property, probe.value));
    assert.equal(result.context, "extension:@velarscript/web:look-value", probe.property);
    assertNoOrdinaryItems(result.items);
    for (const expected of probe.included)
      assert.ok(itemFor(result.items, expected), `${probe.property} does not offer ${expected}`);
    for (const incompatible of probe.excluded)
      assert.ok(!itemFor(result.items, incompatible), `${probe.property} incorrectly offers ${incompatible}`);
  }
});
