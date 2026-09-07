import assert from "node:assert/strict";
import test from "node:test";
import { scanStringLiteral } from "../../../packages/compiler/src/interpolated-string.ts";
import { SourceText } from "../../../packages/compiler/src/source.ts";

// D116: these two guards compare wall-clock ratios (the D90 front-end fixes for
// per-call line search and per-literal line rescans). A ratio is not a witness
// on a loaded machine — the quick tier runs beside other gates — so they live
// in the heavy tier, which runs alone before a release.

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
