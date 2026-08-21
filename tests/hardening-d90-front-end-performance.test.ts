import assert from "node:assert/strict";
import test from "node:test";
import { compile, type CompileResult } from "../packages/compiler/src/index.ts";
import { scanStringLiteral } from "../packages/compiler/src/interpolated-string.ts";
import { SourceText } from "../packages/compiler/src/source.ts";

function elapsed(work: () => void): number {
  const started = process.hrtime.bigint();
  work();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function scanEveryLiteral(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const literal = scanStringLiteral(text, index);
    if (!literal) continue;
    count += 1;
    index = literal.end - 1;
  }
  return count;
}

function literalAt(text: string, marker: string): ReturnType<typeof scanStringLiteral> {
  return scanStringLiteral(text, text.indexOf(marker));
}

let freshCompilers = 0;

/**
 * `nextLineStart` remembers one line boundary for the whole process, so
 * "compiled alone" is only observable from a module graph that has compiled
 * nothing yet. A distinct import URL loads one, which gives these tests a real
 * baseline to compare an interleaved run against rather than an earlier call in
 * the same already-warm graph.
 */
async function freshCompile(source: string): Promise<CompileResult> {
  freshCompilers += 1;
  const fresh = await import(`../packages/compiler/src/index.ts?front-end-performance=${freshCompilers}`) as {
    readonly compile: typeof compile;
  };
  return fresh.compile(source);
}

function emitted(result: CompileResult): { readonly reports: readonly string[]; readonly code: string | null } {
  return {
    reports: result.diagnostics.map((item) => `${item.code} ${item.span.start}-${item.span.end} ${item.message}`),
    code: result.code,
  };
}

/** The line the terminator spellings agree on, read without any index. */
function naiveLineText(text: string, line: number): string {
  return text.split(/\r\n|\r|\n/u)[line - 1] ?? "";
}

test("[D90 front-end] lineText reads every newline spelling out of the line index", () => {
  const source = new SourceText("newlines.vel", "first\rsecond\r\nthird\nfourth");
  assert.equal(source.lineText(1), "first");
  assert.equal(source.lineText(2), "second");
  assert.equal(source.lineText(3), "third");
  assert.equal(source.lineText(4), "fourth");
  assert.equal(source.lineText(5), "");
  assert.equal(source.lineText(0), "");
  assert.equal(source.lineText(-1), "");
});

test("[D90 front-end] lineText keeps empty, terminated, and unterminated lines apart", () => {
  const trailing = new SourceText("trailing.vel", "one\n");
  assert.equal(trailing.lineText(1), "one");
  assert.equal(trailing.lineText(2), "");

  const blanks = new SourceText("blanks.vel", "\r\n\r\ntail");
  assert.equal(blanks.lineText(1), "");
  assert.equal(blanks.lineText(2), "");
  assert.equal(blanks.lineText(3), "tail");

  const empty = new SourceText("empty.vel", "");
  assert.equal(empty.lineText(1), "");
  assert.equal(empty.lineText(2), "");

  const carriageOnly = new SourceText("cr.vel", "one\rtwo");
  assert.equal(carriageOnly.lineText(1), "one");
  assert.equal(carriageOnly.lineText(2), "two");
});

test("[D90 front-end] an unindexed SourceText still reports its first line", () => {
  const source = new SourceText("unindexed.vel", "one\ntwo\nthree", false);
  assert.deepEqual(source.lineStarts, [0]);
  assert.equal(source.lineText(1), "one");
  assert.equal(source.lineText(2), "");
});

test("[D90 front-end] lineText does not scan the rest of the file", () => {
  const line = `${"const value = 1".padEnd(60, " ")}\n`;
  const small = new SourceText("small.vel", line.repeat(2_000));
  const large = new SourceText("large.vel", line.repeat(128_000));
  assert.equal(small.lineText(1), large.lineText(1));

  const rounds = 2_000;
  const read = (source: SourceText): (() => void) => () => {
    for (let index = 0; index < rounds; index += 1) source.lineText(1);
  };
  read(small)();
  read(large)();
  const smallCost = elapsed(read(small));
  const largeCost = elapsed(read(large));
  // The large text is 64x the small one. Searching it per call made the cost
  // scale with the file; reading the index does not.
  assert.ok(largeCost <= smallCost * 8 + 5, `small=${smallCost}ms large=${largeCost}ms`);
});

test("[D90 front-end] a line of many string literals costs its own length once", () => {
  const short = `${'"a"'.repeat(2_000)}\n`;
  const long = `${'"a"'.repeat(16_000)}\n`;
  assert.equal(scanEveryLiteral(short), 2_000);
  assert.equal(scanEveryLiteral(long), 16_000);

  const shortCost = elapsed(() => scanEveryLiteral(short));
  const longCost = elapsed(() => scanEveryLiteral(long));
  // Eight times the literals, and each one used to rescan the whole line.
  assert.ok(longCost <= shortCost * 24 + 5, `short=${shortCost}ms long=${longCost}ms`);
});

test("[D90 front-end] the remembered line end never leaks across lines or sources", () => {
  const first = 'const a = "one"\nconst b = "two three"\n';
  const second = 'const c = f"four"\nconst d = "five"\n';

  const later = literalAt(first, '"two three"');
  const earlier = literalAt(first, '"one"');
  const other = literalAt(second, '"five"');
  const otherEarlier = literalAt(second, 'f"four"');
  const repeated = literalAt(first, '"two three"');

  assert.equal(later?.content, "two three");
  assert.equal(later?.closed, true);
  assert.equal(earlier?.content, "one");
  assert.equal(earlier?.closed, true);
  assert.equal(other?.content, "five");
  assert.equal(otherEarlier?.content, "four");
  assert.equal(otherEarlier?.interpolated, true);
  assert.deepEqual(repeated, later);
});

test("[D90 front-end] an inline literal still stops at its own physical line", () => {
  const text = 'const a = "one\nconst b = "two"\n';
  // Prime the remembered boundary with the second line before asking about the
  // unterminated first one.
  assert.equal(literalAt(text, '"two"')?.content, "two");
  const unterminated = scanStringLiteral(text, text.indexOf('"one'));
  assert.equal(unterminated?.closed, false);
  assert.equal(unterminated?.content, "one");
  assert.equal(unterminated?.end, text.indexOf("\n"));
});

test("[D90 front-end] a layout string walking many lines leaves earlier lines readable", () => {
  const text = [
    'const inline = "head"',
    'const block = "',
    "    one",
    "    two",
    '"',
    'const tail = "foot"',
    "",
  ].join("\n");

  const block = scanStringLiteral(text, text.indexOf('"', text.indexOf("block")));
  assert.equal(block?.layout, true);
  assert.equal(block?.closed, true);
  assert.equal(block?.content, "one\ntwo");

  assert.equal(literalAt(text, '"head"')?.content, "head");
  assert.equal(literalAt(text, '"foot"')?.content, "foot");
});

test("[D90 front-end] a long single-line paste of literals compiles the same as a short one", () => {
  const paste = (count: number): string =>
    `const paste = [${Array.from({ length: count }, (_, index) => `"value${index}"`).join(", ")}]\nprint(paste.size)\n`;
  const small = compile(paste(4));
  const large = compile(paste(2_000));
  assert.deepEqual(small.diagnostics.map((item) => item.code), []);
  assert.deepEqual(large.diagnostics.map((item) => item.code), []);
  assert.ok(large.code?.includes('"value1999"'));
});

test("[D90 front-end] interleaved sources sharing a long prefix each compile as if compiled alone", async () => {
  const prefix = `const shared = [${Array.from({ length: 400 }, (_, index) => `"value${index}"`).join(", ")}]\n`;
  const first = `${prefix}const tail = "first"\nprint(tail)\n`;
  const second = `${prefix}const tail = f"second {shared.size}"\nprint(tail)\n`;

  const firstAlone = emitted(await freshCompile(first));
  const secondAlone = emitted(await freshCompile(second));
  assert.deepEqual(firstAlone.reports, []);
  assert.deepEqual(secondAlone.reports, []);
  assert.notEqual(firstAlone.code, secondAlone.code);

  // The remembered line boundary is keyed on the source content, so two texts
  // that agree for their first several thousand characters and then diverge are
  // exactly what a key on identity — or a memo widened by a field the content
  // does not determine — would get wrong. Every answer must be the one the
  // source would have produced with nothing compiled before it.
  assert.deepEqual(emitted(compile(first)), firstAlone);
  assert.deepEqual(emitted(compile(second)), secondAlone);
  assert.deepEqual(emitted(compile(first)), firstAlone);
  assert.deepEqual(emitted(compile(second)), secondAlone);
});

test("[D90 front-end] a wide line compiled first does not widen the next source's literal", async () => {
  // The interleaving above states the invariant; this states the failure it
  // guards. The memo answers "where does the line holding this offset end", so
  // a wide single line leaves a far-away boundary in it. The next source's
  // literal opens inside the range that boundary covers and its own line ends
  // much earlier, so consulting the remembered answer reads an unterminated
  // string straight past its newline. Comparing the source the boundary was
  // taken from is the whole of what prevents it.
  const wide = 'const wide = "one two three four five six"\n';
  const narrow = 'const bbbbbbb = "q\nrest of the module continues here\n';

  assert.equal(scanStringLiteral(wide, wide.indexOf('"'))?.content, "one two three four five six");
  const unterminated = scanStringLiteral(narrow, narrow.indexOf('"'));
  assert.equal(unterminated?.closed, false);
  assert.equal(unterminated?.content, "q");
  assert.equal(unterminated?.end, narrow.indexOf("\n"));

  const narrowAlone = emitted(await freshCompile(narrow));
  assert.ok(
    narrowAlone.reports[0]?.startsWith("VEL1003 16-18 "),
    narrowAlone.reports.join(" | "),
  );

  compile(wide);
  assert.deepEqual(emitted(compile(narrow)), narrowAlone);
  compile(wide);
  assert.deepEqual(emitted(compile(narrow)), narrowAlone);
});

test("[D90 front-end] a nested f-string compiles the same after an unrelated long line", async () => {
  const nested = 'const inner = "z"\nconst outer = f"a {f`b {inner}`} c"\nprint(outer)\n';
  const longLine = `const paste = [${Array.from({ length: 2_000 }, (_, index) => `"value${index}"`).join(", ")}]\nprint(paste.size)\n`;

  const alone = emitted(await freshCompile(nested));
  assert.deepEqual(alone.reports, []);
  assert.ok(alone.code?.includes("`a ${`b ${inner}`} c`"), alone.code ?? "no code");

  // An interpolation is lexed on its own, so the fragment lexer's `source` is
  // the hole's text and not the module's. That is the one path where a boundary
  // remembered for a different string is consulted, and the long single-line
  // module ahead of it is what leaves a far-away boundary in the memo.
  compile(longLine);
  assert.deepEqual(emitted(compile(nested)), alone);
  compile(longLine);
  assert.deepEqual(emitted(compile(nested)), alone);
});

test("[D90 front-end] lineText agrees with a naive split on every terminator spelling", () => {
  // The index-derived branch trims the terminator by stepping back from the
  // next line's start, and the `\r\n` back-step there is the one place a
  // two-character terminator can be mis-trimmed. Every rendered diagnostic
  // takes this path, so it is compared against the obvious reading instead of
  // against hand-written expectations.
  assert.equal(naiveLineText("one\r\ntwo", 1), "one");
  assert.equal(naiveLineText("one\r\ntwo", 2), "two");
  assert.equal(naiveLineText("one\r\ntwo", 3), "");

  const texts = [
    "",
    "only",
    "only\n",
    "one\r\ntwo\r\nthree",
    "one\r\ntwo\r\nthree\r\n",
    "one\rtwo\rthree",
    "one\rtwo\rthree\r",
    "one\ntwo\r\nthree\rfour",
    "\r\n\r\ntail",
    "\n",
    "\r",
    "\r\n",
    "a\n\rb",
    "  spaced  \n\ttabbed\t\r\n",
  ];

  for (const text of texts) {
    const source = new SourceText("differential.vel", text);
    const lines = text.split(/\r\n|\r|\n/u).length;
    for (let line = -1; line <= lines + 2; line += 1) {
      assert.equal(
        source.lineText(line),
        naiveLineText(text, line),
        `${JSON.stringify(text)} line ${line}`,
      );
    }
  }
});
