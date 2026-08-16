import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import {
  LOOK_ANIMATION_EASINGS,
  LOOK_KEYWORD_LISTING_LIMIT,
  LOOK_LARGE_KEYWORD_SETS,
  LOOK_PARTIAL_KEYWORD_PROPERTIES,
  LOOK_PROPERTY_KEYWORDS,
  LOOK_PROPERTY_VALUE_KINDS,
  lookOwnKeywords,
} from "../packages/web/src/look.ts";

// ---------------------------------------------------------------------------
// D67 rules 172, 173 and 174 — the Look keyword invariant made complete.
//
// Rule 174 is first because the other two are verified through it. VEL5038 used
// to say "use one of the closed `name` keywords" and stop, so the answer to
// "which ones?" lived only in the table's source. The evidence that this is not
// a hypothetical reader problem is D65's: the usage tour, written by someone
// who knew the design intent, shipped twelve values no property had, and this
// diagnostic could not have told him what to write instead.
//
// Rule 172 makes `objectPosition` a `metric` property, so the three properties
// whose CSS grammar is `<position>` are one kind reading one table, and its
// recorded partial exclusion is revoked because the lengths it named are now
// the unit half of that kind.
//
// Rule 173 takes the invariant across all of the keyword properties. Its
// deliverable is the exclusion record, not the value count: a property may
// publish a subset of its CSS grammar, provided the subset's edge is written
// down and the diagnostic reads it out.
// ---------------------------------------------------------------------------

const root = repositoryRoot;
const cli = join(root, "packages", "cli", "src", "cli.ts");

after(removeTemporaryDirectories);

function run(arguments_: readonly string[]): Promise<{ readonly output: string; readonly code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli, ...arguments_], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("close", (code) => resolvePromise({ output, code }));
  });
}

async function webProject(prefix: string, main: string): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D67 look completion", base: "/" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), main, "utf8");
  return directory;
}

/** A Look block whose entries are `property = "value"`, one per line. */
function lookOf(name: string, entries: readonly (readonly [string, string])[]): string {
  return `export const ${name} = look:\n${entries.map(([property, value]) => `    ${property} = "${value}"`).join("\n")}\n`;
}

/** One Look per probe: a rejected entry stops that block, so they cannot share one. */
function rejectionProject(prefix: string, probes: readonly (readonly [string, string])[]): Promise<string> {
  return webProject(prefix, `${probes
    .map(([property, value], index) => lookOf(`probe${index}`, [[property, value]]))
    .join("\n")}
mount(<div />, "#app")
`);
}

// ---------------------------------------------------------------------------
// Rule 174 — the diagnostic names the values.
// ---------------------------------------------------------------------------

// Each row is a value the property does not take, and the words the diagnostic
// must produce for it. The three shapes are the whole rule: a near miss gets
// the one spelling meant, a set small enough to read is written out, and a
// larger one says what it holds.
const guidanceProbes: readonly (readonly [property: string, written: string, expected: string])[] = [
  // A near miss, including a misspelling of a CSS-wide keyword.
  ["display", "inhert", "did you mean 'inherit'?"],
  ["borderStyle", "gorove", "did you mean 'groove'?"],
  ["objectPosition", "topp left", "did you mean 'top left'?"],
  ["backgroundSize", "cvoer", "did you mean 'cover'?"],
  // Not a near miss of anything, and small enough to write out whole.
  ["borderStyle", "smooth", "write one of none, hidden, dotted, dashed, solid, double, groove, ridge, inset, outset, inherit, initial, revert, revert-layer, unset"],
  ["strokeLinecap", "none", "write one of butt, round, square, inherit, initial, revert, revert-layer, unset"],
  ["scrollbarWidth", "slim", "write one of auto, thin, none, inherit, initial, revert, revert-layer, unset"],
  // Not a near miss, and too long to write out.
  ["listStyleType", "greek-letters", "write one of the predefined counter styles of CSS Counter Styles 3"],
  ["cursor", "hand", "write one of the CSS Basic UI cursor keywords"],
];

test("[D67-174] a rejected Look keyword names the values the property really takes", { timeout: 300_000 }, async () => {
  const directory = await rejectionProject("velar-d67-174-guidance-", guidanceProbes.map(([property, written]) => [property, written]));
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  for (const [property, written, expected] of guidanceProbes) {
    assert.ok(
      checked.output.includes(`VEL5038: Look property '${property}' does not accept '${written}'; ${expected}`),
      `${property} = "${written}" wanted ${expected}\n${checked.output}`,
    );
  }
  // The sentence this ruling removed. It named a set and then declined to say
  // what was in it, on all of the keyword properties at once.
  assert.doesNotMatch(checked.output, /use one of the closed \w+ keywords/u);
  // When the one spelling is named, that is the whole answer: `display` and
  // `transitionProperty` both record an excluded value space, and neither
  // record follows a misspelling of `inherit` or `color`. The reader asked
  // "what did I mean?", not "where is the edge of the set?".
  assert.ok(checked.output.includes("does not accept 'inhert'; did you mean 'inherit'?\n"), checked.output);
  assert.doesNotMatch(checked.output, /\?\./u);
});

test("[D67-174] a set too long to write out records what it holds", () => {
  const oversized = [...LOOK_PROPERTY_KEYWORDS.keys()]
    .filter((property) => lookOwnKeywords(property).length > LOOK_KEYWORD_LISTING_LIMIT)
    .filter((property) => !LOOK_LARGE_KEYWORD_SETS.has(property));
  assert.deepEqual(oversized, []);
  // And a description is only reachable for a set that is actually oversized,
  // so a description can never sit unread beside a set the diagnostic writes.
  for (const [property] of LOOK_LARGE_KEYWORD_SETS) {
    assert.ok(lookOwnKeywords(property).length > LOOK_KEYWORD_LISTING_LIMIT, property);
  }
  assert.ok(LOOK_LARGE_KEYWORD_SETS.size >= 5, String(LOOK_LARGE_KEYWORD_SETS.size));
});

// ---------------------------------------------------------------------------
// Rule 172 — `<position>` is one grammar, one kind, one table.
// ---------------------------------------------------------------------------

test("[D67-172] the three <position> properties are one kind reading one table", () => {
  const positional = ["backgroundPosition", "transformOrigin", "objectPosition"];
  for (const property of positional) assert.equal(LOOK_PROPERTY_VALUE_KINDS.get(property), "metric", property);
  const [first, ...rest] = positional.map((property) => lookOwnKeywords(property).join("|"));
  for (const other of rest) assert.equal(other, first);
  // The record rule 172 revoked. Its lengths are the unit half of `metric` now.
  assert.equal(LOOK_PARTIAL_KEYWORD_PROPERTIES.get("objectPosition"), undefined);
});

test("[D67-172] a <position> property takes a unit value and a placement alike", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d67-172-accept-", `${lookOf("positioned", [
    ["objectPosition", "top left"],
    ["backgroundPosition", "bottom right"],
    ["transformOrigin", "center top"],
  ])}
export const measured = look:
    objectPosition = 25%
    backgroundPosition = 12px
    transformOrigin = 50%

mount(<div look={positioned} />, "#app")
`);
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
  // Both halves reach the declaration: the ruling's own example, `50%` and
  // `"top left"` on the same property.
  const emitted = compileCore(`export const a = look:\n    objectPosition = 50%\n\nexport const b = look:\n    objectPosition = "top left"\n`, {
    extensions: [velarCompilerExtension],
  });
  assert.deepEqual(emitted.diagnostics, []);
  assert.match(emitted.code ?? "", /"base:object-position": "50%"/u);
  assert.match(emitted.code ?? "", /"base:object-position": "top left"/u);
});

test("[D67-172] a <position> property still refuses the shared sizing words", { timeout: 300_000 }, async () => {
  // The half of D65 rule 168 that a shared list added on top of a real table
  // would have reopened: `object-position: min-content` parses nowhere, and a
  // metric property that owns a table must not inherit the sizing vocabulary.
  const probes: readonly (readonly [string, string])[] = [
    ["objectPosition", "min-content"],
    ["backgroundPosition", "fit-content"],
    ["transformOrigin", "stretch"],
    ["backgroundSize", "max-content"],
  ];
  const directory = await rejectionProject("velar-d67-172-reject-", probes);
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  for (const [property, written] of probes) {
    assert.match(checked.output, new RegExp(`VEL5038: Look property '${property}' does not accept '${written}'`, "u"), checked.output);
  }
  // A metric property with no table of its own keeps the shared words.
  const shared = await webProject("velar-d67-172-shared-", `${lookOf("sized", [["width", "min-content"], ["maxHeight", "fit-content"]])}
mount(<div look={sized} />, "#app")
`);
  assert.equal((await run(["check", shared])).code, 0);
});

// ---------------------------------------------------------------------------
// Rule 173 side A — a published property holds the values it really has.
// ---------------------------------------------------------------------------

// Every value this ruling added, by the hole it closed. Each one compiled to a
// VEL5038 before it, and each is an ordinary value of the property's grammar.
const completedValues: readonly (readonly [property: string, value: string])[] = [
  // The one-way pans and the pinch gesture a scroll container really takes.
  ["touchAction", "pan-left"], ["touchAction", "pan-right"], ["touchAction", "pan-up"],
  ["touchAction", "pan-down"], ["touchAction", "pinch-zoom"],
  // CSS Box Alignment's self-positions and baseline positions, across all nine.
  ["alignItems", "self-start"], ["alignItems", "first baseline"], ["alignItems", "last baseline"],
  ["alignSelf", "self-end"], ["alignSelf", "first baseline"],
  ["alignContent", "baseline"], ["alignContent", "last baseline"],
  ["justifyItems", "self-start"], ["justifyItems", "first baseline"],
  ["justifySelf", "self-end"], ["justifySelf", "baseline"],
  ["placeItems", "self-start"], ["placeItems", "flex-end"], ["placeItems", "baseline"],
  ["placeContent", "flex-start"], ["placeContent", "flex-end"],
  ["placeSelf", "self-end"], ["placeSelf", "first baseline"],
  // A display type with no other spelling.
  ["display", "list-item"],
  // The two-axis repeat, which is how a background repeats on one axis only.
  ["backgroundRepeat", "repeat no-repeat"], ["backgroundRepeat", "space round"],
  // The one CSS Basic UI cursor keyword that was missing.
  ["cursor", "all-scroll"],
  // Rule 172's alignment, seen from side A: two properties that used to hold
  // five of the twenty-two placements.
  ["backgroundPosition", "top left"], ["transformOrigin", "bottom right"],
];

test("[D67-173] every value this ruling added compiles", { timeout: 300_000 }, async () => {
  // One Look per value: two entries for one property in one block would be a
  // duplicate-property error rather than a vocabulary check.
  const directory = await webProject("velar-d67-173-accept-", `${completedValues
    .map(([property, value], index) => lookOf(`added${index}`, [[property, value]]))
    .join("\n")}
mount(<div />, "#app")
`);
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
});

// ---------------------------------------------------------------------------
// Rule 173's deliverable — the exclusion record, and the diagnostic that reads
// it out.
// ---------------------------------------------------------------------------

// A value each property really leaves out, paired with nothing but the demand
// that the property's own recorded reason comes back with the rejection.
const recordedExclusions: readonly (readonly [property: string, written: string])[] = [
  ["display", "table-cell"],
  ["overflow", "hidden auto"],
  ["fontStyle", "oblique 14deg"],
  ["textOverflow", "..."],
  ["textAlign", "justify-all"],
  ["textTransform", "uppercase full-width"],
  ["writingMode", "sideways-rl"],
  ["touchAction", "pan-x pinch-zoom"],
  ["appearance", "checkbox"],
  ["colorScheme", "high-contrast"],
  ["cursor", "url(cursor.png), pointer"],
  ["transitionTimingFunction", "cubic-bezier(0.4, 0, 0.2, 1)"],
  ["transitionProperty", "display"],
  ["alignItems", "safe center"],
  ["alignContent", "unsafe end"],
  ["alignSelf", "safe start"],
  ["justifyItems", "safe center"],
  ["justifyContent", "unsafe center"],
  ["justifySelf", "safe end"],
  ["placeItems", "center start"],
  ["placeContent", "start end"],
  ["placeSelf", "center end"],
  ["backgroundRepeat", "repeat, no-repeat"],
  ["backgroundAttachment", "scroll, fixed"],
  ["backgroundClip", "border-box, text"],
  ["backgroundOrigin", "border-box, content-box"],
];

test("[D67-173] a property that publishes a subset says what it left out", { timeout: 300_000 }, async () => {
  const directory = await rejectionProject("velar-d67-173-record-", recordedExclusions);
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  for (const [property, written] of recordedExclusions) {
    const note = LOOK_PARTIAL_KEYWORD_PROPERTIES.get(property);
    assert.ok(note !== undefined, `${property} publishes a subset and records nothing`);
    assert.ok(
      checked.output.includes(`Look property '${property}' does not accept '${written}'`),
      `${property}: ${checked.output}`,
    );
    assert.ok(checked.output.includes(note), `${property}: ${checked.output}`);
  }
  // The boundary is named next to the escape that reaches past it.
  assert.match(checked.output, /import css unsafe/u);
});

test("[D67-173] the easing table stays closed on purpose, and says so", () => {
  // D49 gave `animate(easing=)` and `transitionTimingFunction` one table. The
  // ruling's own warning is that completing this one would overturn D49, so the
  // check is that the set still *is* that table and that its closure is
  // recorded rather than filled.
  assert.deepEqual(lookOwnKeywords("transitionTimingFunction"), [...LOOK_ANIMATION_EASINGS]);
  const note = LOOK_PARTIAL_KEYWORD_PROPERTIES.get("transitionTimingFunction");
  assert.ok(note !== undefined && note.includes("animate(easing=)"), String(note));
});

test("[D67-173] every keyword property either holds its grammar or records the part it does not", () => {
  // The wave's closing contract. A keyword property is complete when its set is
  // the whole of its CSS grammar, and otherwise it carries a record; nothing is
  // allowed to sit between the two, because that is the state rule 173 named —
  // a subset nobody wrote the edge of.
  const keywordProperties = [...LOOK_PROPERTY_VALUE_KINDS]
    .filter(([, kind]) => kind === "keyword")
    .map(([property]) => property);
  assert.equal(keywordProperties.length, 77);
  const recorded = keywordProperties.filter((property) => LOOK_PARTIAL_KEYWORD_PROPERTIES.has(property));
  // Every recorded property publishes a set and a non-empty reason.
  for (const property of recorded) {
    assert.ok(lookOwnKeywords(property).length > 0, property);
    assert.ok((LOOK_PARTIAL_KEYWORD_PROPERTIES.get(property) ?? "").length > 40, property);
  }
  // 36 of the 77 record a boundary; the other 41 publish their whole grammar.
  // Completeness against CSS is not a fact a program can check, so this floor
  // is the mechanical half: the records exist, name a property that publishes a
  // set, and carry a reason long enough to be one.
  assert.ok(recorded.length >= 36, String(recorded.length));
});
