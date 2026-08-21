import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compile } from "../packages/compiler/src/index.ts";
import { VELAR_TEXT_METHOD_RUNTIME } from "../packages/compiler/src/text-runtime.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// D90 R6 (the ordering half) and D90 R7 live in one file because they live in
// one runtime. R6: a NaN may be held and tested with `.isNaN()`, but any
// operation that orders it raises — the generic ordering primitive used to
// answer `<=` and `>=` both true and produce genuinely mis-sorted output.
// R7: every String operation counts code points, and no operation may emit an
// unpaired surrogate — `size`/`char`/`slice` already counted code points while
// `has`/`count`/`startsWith`/`endsWith`/`split`/`replaceAll` counted UTF-16
// code units, so the two halves disagreed and `split` could cut a pair in half.
// Grapheme clusters are deliberately outside Core, so nothing here asserts
// them: a test that only passed under grapheme semantics would be the wrong
// test, not a missing feature.

after(async () => {
  await removeTemporaryDirectories();
});

interface Execution {
  readonly code: string;
  readonly stdout: string;
}

/**
 * Compiles one module and runs its emitted output. The text runtime is inlined
 * into the module that uses it, so nothing here needs a standard-module link
 * step — what runs is exactly what the emitter wrote.
 */
async function run(source: string, prefix = "velar-text-code-points-"): Promise<Execution> {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const directory = await makeTemporaryDirectory(prefix);
  for (const embedded of result.embeddedModules) {
    await writeFile(join(directory, embedded.specifier.replace(/^\.\//u, "")), embedded.code, "utf8");
  }
  const entry = join(directory, "main.mjs");
  await writeFile(entry, result.code ?? "", "utf8");
  const execution = spawnSync(process.execPath, [entry], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  return { code: result.code ?? "", stdout: String(execution.stdout) };
}

interface TextRuntime {
  size(value: string): number;
  char(value: string, index: number): string | null;
  slice(value: string, start: number, end: number | null): string;
  has(value: string, text: string): boolean;
  index(value: string, text: string): number | null;
  count(value: string, text: string): number;
  startsWith(value: string, text: string): boolean;
  endsWith(value: string, text: string): boolean;
  split(value: string, separator: string): string[];
  replace(value: string, from: string, to: string): string;
  replaceAll(value: string, from: string, to: string): string;
  padStart(value: string, size: number, fill?: string): string;
  padEnd(value: string, size: number, fill?: string): string;
  repeat(value: string, count: number): string;
  upper(value: string): string;
  lower(value: string): string;
  trim(value: string): string;
}

/**
 * Loads the emitted text runtime the way a compiled module sees it, so a
 * property sweep can call every member without writing one Vel program per
 * member. The end-to-end tests above and below pin that these are the same
 * functions the emitter installs.
 */
function loadTextRuntime(): TextRuntime {
  return new Function(`${VELAR_TEXT_METHOD_RUNTIME}
return {
  size: __velarStringSize, char: __velarStringChar, slice: __velarStringSlice,
  has: __velarStringHas, index: __velarStringIndex, count: __velarStringCount,
  startsWith: __velarStringStartsWith, endsWith: __velarStringEndsWith,
  split: __velarStringSplit, replace: __velarStringReplace, replaceAll: __velarStringReplaceAll,
  padStart: __velarStringPadStart, padEnd: __velarStringPadEnd, repeat: __velarStringRepeat,
  upper: __velarStringUpper, lower: __velarStringLower, trim: __velarStringTrim,
};`)() as TextRuntime;
}

/** True when `value` carries a surrogate code unit that is not part of a pair. */
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

/**
 * Splits on code-point boundaries the slow, obvious way: the code-point
 * offsets come from iterating the string, which yields code points, and a
 * match counts only when both of its ends sit on one of those offsets.
 * Nothing here shares a line with the runtime, so it checks the answer rather
 * than re-running the implementation.
 */
function referenceSplit(value: string, needle: string): string[] {
  if (needle === "") return [...value];
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const point of value) {
    offset += point.length;
    boundaries.add(offset);
  }
  const parts: string[] = [];
  let cursor = 0;
  let scan = 0;
  while (scan <= value.length - needle.length) {
    if (value.startsWith(needle, scan) && boundaries.has(scan) && boundaries.has(scan + needle.length)) {
      parts.push(value.slice(cursor, scan));
      scan += needle.length;
      cursor = scan;
      continue;
    }
    scan += 1;
  }
  parts.push(value.slice(cursor));
  return parts;
}

test("[D90 R6] a Comparable generic raises on NaN instead of ordering it both ways", async () => {
  const { code, stdout } = await run(`
def atMost<T: Comparable>(left: T, right: T) -> bool:
    return left <= right

def atLeast<T: Comparable>(left: T, right: T) -> bool:
    return left >= right

def between<T: Comparable>(low: T, middle: T, high: T) -> bool:
    return low < middle < high

def main():
    const nan = 0.0 / 0.0
    try:
        print(f"atMost {atMost(nan, 5.0)}")
    catch error:
        print(f"atMost {error.message}")
    try:
        print(f"atLeast {atLeast(nan, 5.0)}")
    catch error:
        print(f"atLeast {error.message}")
    try:
        print(f"between {between(1.0, nan, 5.0)}")
    catch error:
        print(f"between {error.message}")

main()
`);
  // Both lowerings route through the one helper: the dynamic-ordering form and
  // the comparison-chain form. Fencing NaN in the helper therefore needs no
  // emitter change, and this pins that the helper is still the only site.
  assert.match(code, /\(__velarOrderCompare\(left, right\) <= 0\)/u);
  assert.match(code, /\(__velarOrderCompare\(left, right\) >= 0\)/u);
  assert.match(code, /__velarOrderCompare\(__velarCompare\d+_0, __velarCompare\d+_1\) < 0/u);

  const lines = stdout.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  // The filed failure was `atMost true` / `atLeast true` — NaN comparing both
  // ways — while the identical source on a plain number answered false.
  for (const [label, line] of [["atMost", lines[0]!], ["atLeast", lines[1]!], ["between", lines[2]!]] as const) {
    assert.ok(line.startsWith(`${label} ordered comparison found NaN, which has no ordering;`), line);
    // The same voice as the Math and List fences the Core wave aligned.
    assert.ok(line.includes("filter(x => not x.isNaN())"), line);
  }
});

test("[D90 R6] plain relational operators keep IEEE false and ordinary ordering is unchanged", async () => {
  const plain = await run(`
def main():
    const nan = 0.0 / 0.0
    print(f"{nan < 5.0} {nan <= 5.0} {nan > 5.0} {nan >= 5.0}")
    print(f"{nan < nan} {nan <= nan}")

main()
`);
  // R6 fences the generic ordering primitive only. A monomorphic number
  // comparison is a bare relational operator and keeps IEEE semantics, which
  // is what tests/hardening-nan-semantics.test.ts pins; nothing here changes
  // that file, and this control proves the fence did not leak into it.
  assert.doesNotMatch(plain.code, /__velarOrderCompare/u);
  assert.equal(plain.stdout, "false false false false\nfalse false\n");

  const generic = await run(`
def atMost<T: Comparable>(left: T, right: T) -> bool:
    return left <= right

def atLeast<T: Comparable>(left: T, right: T) -> bool:
    return left >= right

def between<T: Comparable>(low: T, middle: T, high: T) -> bool:
    return low < middle < high

def main():
    print(f"{atMost(1.0, 5.0)} {atLeast(1.0, 5.0)} {between(1.0, 3.0, 5.0)} {between(1.0, 9.0, 5.0)}")
    // TXT-D1 still holds through the fence: an astral character sorts after a
    // BMP one by code point, the opposite of JavaScript's UTF-16 order.
    print(f"{atMost("\u{FFFD}", "\u{1F600}")} {atMost("\u{1F600}", "\u{FFFD}")} {atMost("apple", "banana")}")

main()
`);
  assert.equal(generic.stdout, "true false true false\ntrue false true\n");
});

test("[D90 R7] the size/char/slice family and the search family agree on code points", async () => {
  const { stdout } = await run(`
def main():
    const text = "\u{1F600}a\u{E9}\u{4E2D}b\u{1F600}"
    print(f"size {text.size}")
    print(f"chars {text.char(0)} {text.char(4)} {text.char(5)}")
    print(f"slice {text.slice(1, 4)}")
    // The search half answers in the units the position half reads, so its
    // answer feeds straight back into 'char' and 'slice'. This case is not the
    // one R7 repaired — 'index' already counted code points — it is the
    // agreement R7 promises, pinned so a later refactor cannot hand back a
    // UTF-16 offset here and stay green.
    const found = text.index("b")
    if found != null:
        print(f"index {found} {text.char(found)} [{text.slice(0, found)}]")
    print(f"count {text.count("\u{1F600}")} {text.count("a")}")
    print(f"has {text.has("\u{E9}")} {text.has("z")}")
    print(f"ends {text.startsWith("\u{1F600}a")} {text.endsWith("b\u{1F600}")}")
    const parts = text.split("\u{E9}")
    print(f"split {parts.size} [{parts[0]}] [{parts[1]}]")
    print(f"replaceAll [{text.replaceAll("\u{1F600}", "X")}]")
    print(f"pad [{"\u{1F600}".padStart(3, "\u{1F600}")}] {"\u{1F600}".padStart(3, "\u{1F600}").size}")

main()
`);
  assert.equal(stdout, [
    "size 6",
    "chars \u{1F600} b \u{1F600}",
    "slice a\u{E9}\u{4E2D}",
    "index 4 b [\u{1F600}a\u{E9}\u{4E2D}]",
    "count 2 1",
    "has true false",
    "ends true true",
    "split 2 [\u{1F600}a] [\u{4E2D}b\u{1F600}]",
    "replaceAll [Xa\u{E9}\u{4E2D}bX]",
    "pad [\u{1F600}\u{1F600}\u{1F600}] 3",
    "",
  ].join("\n"));
});

test("[D90 R7] a lone-surrogate needle never cuts a surrogate pair", async () => {
  // Vel source cannot spell a lone surrogate — VEL1008 refuses
  // `\u{DE00}` — so the needle arrives the only way it can: across the
  // JavaScript boundary, which is also where real ill-formed text comes from.
  const { stdout } = await run([
    "extern js()`",
    '    export const lead = "\\uD83D"',
    '    export const trail = "\\uDE00"',
    "`:",
    "    export const lead: string",
    "    export const trail: string",
    "",
    "def main():",
    '    const smile = "\\u{1F600}"',
    // The filed case: this returned ["\ud83d", ""] — two pieces, the first a
    // lone lead surrogate the program never had.
    "    const parts = smile.split(trail)",
    '    print(f"split {parts.size} [{parts[0]}] {parts[0].size}")',
    '    print(f"has {smile.has(lead)} {smile.has(trail)}")',
    '    print(f"count {smile.count(lead)} {smile.count(trail)}")',
    '    print(f"index {smile.index(lead) ?? -1} {smile.index(trail) ?? -1}")',
    '    print(f"ends {smile.startsWith(lead)} {smile.endsWith(trail)}")',
    '    print(f"replaceAll [{smile.replaceAll(trail, "Z")}] [{smile.replace(lead, "Z")}]")',
    // A well-formed needle still matches, so the boundary gate rejects only
    // the matches that would have split a pair.
    '    print(f"whole {smile.has(smile)} {smile.count(smile)} [{smile.replaceAll(smile, "Z")}]")',
    "",
    "main()",
    "",
  ].join("\n"), "velar-text-lone-surrogate-");
  assert.equal(stdout, [
    "split 1 [\u{1F600}] 1",
    "has false false",
    "count 0 0",
    "index -1 -1",
    "ends false false",
    "replaceAll [\u{1F600}] [\u{1F600}]",
    "whole true 1 [Z]",
    "",
  ].join("\n"));
});

test("[D90 R7] the native scan and the boundary-checked scan answer the same thing", () => {
  // A match can only start inside a surrogate pair when the needle starts with
  // a trail surrogate, and can only end inside one when the needle ends with a
  // lead surrogate: the unit the gate reads at each end of a match is the
  // needle's own edge. That makes the gate a property of the needle alone, so
  // an ordinary needle can take the native scan on any haystack, pairs and
  // all. The two scans are two pieces of code, so they are pinned to one
  // answer here; without that the fast path would be a second semantics.
  assert.match(
    VELAR_TEXT_METHOD_RUNTIME,
    /if \(!__velarTextNeedsBoundaryCheck\(separator\)\) \{\n\s+return __velarTextList\(__velarTextCall\(__velarNativeStringSplit/u,
  );
  assert.match(VELAR_TEXT_METHOD_RUNTIME, /if \(!__velarTextNeedsBoundaryCheck\(from\)\) return __velarTextCall\(__velarNativeStringReplaceAll/u);

  const runtime = loadTextRuntime();
  const values = ["", "a", "abcabc", "\u{1F600}a\u{1F600}", "a\u{1F600}b\u{4E2D}c\u{1F1E6}", `${"a\u{1F600}".repeat(60)}b`, "a\uD83Db\uDE00c"];
  // Ordinary needles take the native scan; the last four carry a surrogate
  // edge and take the boundary-checked one.
  const needles = ["a", "b", "\u{1F600}", "a\u{1F600}", "\u{1F600}a", "\u{4E2D}", "zz", "", "\uD83D", "\uDE00", "\uDE00a", "a\uD83D"];
  for (const value of values) {
    for (const needle of needles) {
      const where = `${JSON.stringify(value)} / ${JSON.stringify(needle)}`;
      const parts = referenceSplit(value, needle);
      assert.deepEqual(runtime.split(value, needle), parts, where);
      // replaceAll is the same cut list rejoined, and count is the number of
      // cuts, so one reference pins all three against each other. An empty
      // needle cuts before and after every code point, which is a join with an
      // extra separator at each end.
      const rejoined = needle === "" ? `${parts.map((point) => `|${point}`).join("")}|` : parts.join("|");
      assert.equal(runtime.replaceAll(value, needle, "|"), rejoined, where);
      assert.equal(runtime.count(value, needle), needle === "" ? parts.length + 1 : parts.length - 1, where);
      assert.equal(runtime.has(value, needle), needle === "" || parts.length > 1, where);
      assert.equal(runtime.index(value, needle), needle === "" ? 0 : parts.length > 1 ? [...parts[0]!].length : null, where);
      assert.equal(runtime.replace(value, needle, "|"), needle === "" ? `|${value}` : parts.length > 1 ? `${parts[0]!}|${parts.slice(1).join(needle)}` : value, where);
    }
  }
});

test("[D90 R7] a '$' in a replacement stays literal on both scans", () => {
  // The native rewrite reads '$' in a replacement as a capture reference, so
  // it is handed the replacement as a function instead of a string. A test is
  // the only thing that keeps the faster call from quietly rewriting text the
  // program never asked to rewrite.
  const runtime = loadTextRuntime();
  for (const replacement of ["$&", "$$", "$`", "$'", "$1", "a$&b"]) {
    assert.equal(runtime.replaceAll("x-y-z", "-", replacement), `x${replacement}y${replacement}z`, replacement);
    assert.equal(runtime.replace("x-y-z", "-", replacement), `x${replacement}y-z`, replacement);
    // The same replacement through the boundary-checked scan, which a needle
    // with a surrogate edge takes.
    assert.equal(runtime.replaceAll("a\uD83Db", "\uD83D", replacement), `a${replacement}b`, replacement);
  }
});

test("[D90 R7] both split scans refuse an oversize result in the same words", () => {
  const runtime = loadTextRuntime();
  const refused = { name: "RangeError", message: "String.split cannot produce more than 1000000 items" };
  assert.throws(() => runtime.split("a,".repeat(1000001), ","), refused);
  assert.equal(runtime.split(`${"a,".repeat(999999)}a`, ",").length, 1000000);
  // The boundary-checked scan is a separate loop with its own bail-out, and it
  // has to refuse at the same count in the same words. A lone lead surrogate
  // is a needle with a surrogate edge, so this string takes that loop.
  assert.throws(() => runtime.split("\uD800".repeat(1000002), "\uD800"), refused);
  assert.equal(runtime.split("\uD800".repeat(999999), "\uD800").length, 1000000);
});

test("[D90 R7] no operation manufactures an unpaired surrogate from well-formed input", () => {
  const runtime = loadTextRuntime();
  // ASCII, BMP, astral, a regional-indicator pair and a combining mark: every
  // shape a code-point rule has to survive. None of them is a lone surrogate,
  // so no output may contain one either.
  const alphabet = ["a", "\u{E9}", "\u{4E2D}", "\u{1F600}", "\u{1F1E6}", "e\u{301}", " "];
  const needles = ["a", "\u{1F600}", "e\u{301}", "", "\uD83D", "\uDE00", "\uD800", "\uDFFF"];
  let sampled = 0;
  for (let seed = 0; seed < 2400; seed += 1) {
    let value = "";
    for (let step = seed; step > 0; step = Math.floor(step / alphabet.length)) value += alphabet[step % alphabet.length]!;
    assert.equal(hasUnpairedSurrogate(value), false, value);
    const outputs: string[] = [
      runtime.slice(value, 0, null),
      runtime.slice(value, 1, 3),
      runtime.slice(value, -2, null),
      runtime.slice(value, 2, -1),
      runtime.upper(value),
      runtime.lower(value),
      runtime.trim(value),
      runtime.repeat(value, 3),
      runtime.padStart(value, 12, "\u{1F600}"),
      runtime.padEnd(value, 12, "\u{1F600}"),
      runtime.padStart(value, 12),
      runtime.padEnd(value, 12),
    ];
    for (let position = -2; position < 5; position += 1) {
      const character = runtime.char(value, position);
      if (character !== null) outputs.push(character);
    }
    for (const needle of needles) {
      outputs.push(...runtime.split(value, needle));
      outputs.push(runtime.replace(value, needle, "\u{1F600}"), runtime.replaceAll(value, needle, "\u{1F600}"));
      // The predicates cannot emit text, but a match that straddles a pair is
      // the same defect one layer up, so they are swept for it as well.
      const found = runtime.index(value, needle);
      if (found !== null) assert.equal(runtime.size(runtime.slice(value, 0, found)), found, `${value} / ${needle}`);
    }
    for (const output of outputs) {
      assert.equal(hasUnpairedSurrogate(output), false, `${JSON.stringify(value)} -> ${JSON.stringify(output)}`);
      sampled += 1;
    }
  }
  assert.ok(sampled > 100000, String(sampled));
});

test("[D90 R7] the measurement memo changes only the cost of an answer, never the answer", () => {
  const runtime = loadTextRuntime();
  // The memo only engages at 64 code units and above, so each case runs at a
  // length below the threshold and at a length above it; a difference between
  // the two would be the memo answering a question rather than remembering it.
  for (const filler of [8, 200]) {
    const value = `${"a".repeat(filler)}\u{1F600}${"b".repeat(filler)}\u{1F1E6}`;
    const expected = [...value];
    for (let pass = 0; pass < 3; pass += 1) {
      assert.equal(runtime.size(value), expected.length, String(filler));
      assert.equal(runtime.char(value, filler), "\u{1F600}");
      assert.equal(runtime.char(value, expected.length - 1), "\u{1F1E6}");
      assert.equal(runtime.slice(value, filler, filler + 2), "\u{1F600}b");
      assert.equal(runtime.index(value, "\u{1F1E6}"), expected.length - 1);
      assert.equal(runtime.count(value, "b"), filler);
      assert.deepEqual(runtime.split(value, "\u{1F600}"), ["a".repeat(filler), `${"b".repeat(filler)}\u{1F1E6}`]);
      assert.equal(runtime.replaceAll(value, "\u{1F600}", "Z"), `${"a".repeat(filler)}Z${"b".repeat(filler)}\u{1F1E6}`);
    }
  }

  // Overflow the bounded cache many times over, in both directions, so the
  // wholesale clear happens repeatedly and against a different fill order than
  // the read order. A stale entry surviving a clear would show up as a wrong
  // answer for a string whose measurement belongs to another string. The
  // corpus is larger than the cache's entry bound by design: the bound was
  // raised to 512 so that a walk over a few hundred strings stops falling off
  // a cliff, and a corpus that no longer overflowed would stop testing the
  // clear at all.
  const corpus: string[] = [];
  for (let index = 0; index < 700; index += 1) {
    corpus.push(`${"a".repeat(70)}${"\u{1F600}".repeat((index % 7) + 1)}${"b".repeat(index)}\u{1F1E6}`);
  }
  const expected = corpus.map((value) => [...value]);
  for (let pass = 0; pass < 3; pass += 1) {
    for (let index = 0; index < corpus.length; index += 1) {
      const value = corpus[index]!;
      const points = expected[index]!;
      assert.equal(runtime.size(value), points.length, String(index));
      assert.equal(runtime.char(value, 70), "\u{1F600}");
      assert.equal(runtime.char(value, points.length - 1), "\u{1F1E6}");
      assert.equal(runtime.slice(value, 70, 72), points.slice(70, 72).join(""));
      assert.equal(runtime.index(value, "\u{1F1E6}"), points.length - 1);
    }
    corpus.reverse();
    expected.reverse();
  }
});

test("[D90 R7] one astral character no longer makes every char and slice call O(n)", async () => {
  // The filed regression: measuring a string was a whole-string job on every
  // call, so one astral character anywhere forced every offset conversion to
  // walk the whole string. Running this exact emitted module with the pre-R7
  // text runtime substituted in took 17.1 s; with the memoised one it takes
  // 34 ms — a measured ~500x. The ceiling sits two orders of magnitude above
  // the measured time, which catches the cliff returning without flapping on
  // a loaded machine.
  const started = Date.now();
  const { stdout } = await run(`
def main():
    const corpus = "\u{1F600}" + "a".repeat(200000)
    let total = 0
    let step = 0
    while step < 20000:
        const character = corpus.char(step % 1000 + 1)
        if character != null:
            total = total + character.size
        total = total + corpus.slice(step % 1000, step % 1000 + 4).size
        step = step + 1
    print(f"total {total}")

main()
`, "velar-text-astral-cliff-");
  const elapsed = Date.now() - started;
  assert.equal(stdout, "total 100000\n");
  assert.ok(elapsed < 4000, `20000 char/slice calls over a 200 KB string took ${elapsed} ms`);
});
