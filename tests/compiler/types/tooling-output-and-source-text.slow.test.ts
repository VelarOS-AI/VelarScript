import assert from "node:assert/strict";
import { chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "@velarscript/compiler";
import { quoteReportedText } from "../../../packages/cli/src/test-output.ts";
import { clean, cliProject, messages } from "../../support/compiler-audit-suite.ts";

/**
 * D115 P5 — what the tools write, and what they will read, one subject of the
 * file that was `bounded-generics-and-dispose.slow.test.ts` before it reached
 * 916 lines.
 *
 * What is held here is the text on both sides of the tooling: `velar fix`
 * names the write it could not make and still reports the rewrites that landed
 * (NEW-D8), the formatter keeps the space before a list literal and takes none
 * before an index (NEW-D9), all twelve Bidi_Control code points are refused in
 * source (rule 104), and the reporter escapes the author text it quotes so a
 * test name cannot reorder the verdict line (rule 105). The harness is in
 * `tests/support/compiler-audit-suite.ts`; the bodies below are the bodies
 * that file had.
 */

// ---------------------------------------------------------------------------
// NEW-D8 — `velar fix` reports what it changed
// ---------------------------------------------------------------------------

test("[NEW-D8] a failed write is named and the rewrites that already landed are still reported", {
  // chmod does not make a file unwritable on Windows; the contract is covered
  // on both POSIX CI hosts while the rest of `velar fix` remains cross-platform.
  skip: process.platform === "win32",
}, async () => {
  const project = await cliProject({
    "src/other.vel": "export const c: Array<number> = [3]\n",
    "src/main.vel": `
import {c} from "./other.vel"
const a: Array<number> = [1]
print(str(a.size + c.size))
`.trimStart(),
  });
  try {
    await chmod(join(project.root, "src", "other.vel"), 0o444);
    const fixed = project.cli("fix", ".");
    assert.equal(fixed.status, 1, fixed.stdout);
    assert.match(fixed.stdout, /src\/main\.vel:2:10 fixed VEL2012/u);
    assert.match(fixed.stdout, /applied 1 mechanical fix in 1 file; 1 file could not be written/u);
    assert.match(fixed.stderr, /velar fix: could not write src\/other\.vel/u);
  } finally {
    await chmod(join(project.root, "src", "other.vel"), 0o644).catch(() => undefined);
    await rm(project.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// NEW-D9 — the formatter keeps the space before a list literal
// ---------------------------------------------------------------------------

test("[NEW-D9] a list literal after a keyword keeps its space, and an index access still has none", () => {
  const source = `
def main():
    const values: List<number> = [1, 2, 3]
    for i in [1, 2]: print(str(i))
    if 1 in [1, 2]: print(str(values[0]))
    if not [1, 2].has(3): print("no")
    return null

main()
`.trimStart();
  assert.equal(formatSource(source), source);
  const squeezed = source.replace("in [1, 2]:", "in[1, 2]:");
  assert.equal(formatSource(squeezed), source);
  clean(source);
});

// ---------------------------------------------------------------------------
// Rule 104 — all twelve Bidi_Control code points
// ---------------------------------------------------------------------------

test("[rule 104] LRM, RLM, and ALM are rejected in source beside the nine already banned", () => {
  for (const [point, label] of [["‎", "200E"], ["‏", "200F"], ["؜", "061C"]] as const) {
    for (const source of [`const value = "a${point}b"\n`, `// comment ${point}\n`, `const ${point}name = 1\n`]) {
      const reported = messages(source);
      assert.ok(
        reported.some((message) => message.startsWith(`Bidirectional control U+${label} cannot appear directly`)),
        `${label}: ${reported.join(" | ")}`,
      );
    }
  }
});

test("[rule 104] the escape spelling and the emoji-composing characters stay legal", () => {
  clean('const value = "a\\u{202E}b"\nconst family = "\\u{1F468}\\u{200D}\\u{1F469}"\nprint(value + family)\n');
});

// ---------------------------------------------------------------------------
// Rule 105 — the reporter escapes the author text it quotes
// ---------------------------------------------------------------------------

test("[rule 105] reported author text is a JSON string with every bidi control escaped", () => {
  assert.equal(quoteReportedText("plain name"), '"plain name"');
  assert.equal(quoteReportedText("pass ‮ fail"), '"pass \\u202E fail"');
  assert.equal(quoteReportedText("‎‏؜⁦⁩"), '"\\u200E\\u200F\\u061C\\u2066\\u2069"');
  assert.equal(quoteReportedText('quote " and \\'), '"quote \\" and \\\\"');
});

test("[rule 105] a bidi-named test cannot reorder the verdict line", async () => {
  const project = await cliProject({
    "src/main.vel": "print(\"app\")\n",
    "src/app.test.vel": `
import {expect} from "velar/test"

test "pass \\u{202E} fail":
    expect(1).toBe(1)
`.trimStart(),
  });
  try {
    const tested = project.cli("test", ".");
    assert.equal(tested.status, 0, tested.stderr);
    assert.match(tested.stdout, /✓ "src\/app\.test\.vel" :: "pass \\u202E fail"/u);
    assert.ok(!tested.stdout.includes("‮"), "the raw control reached the verdict line");
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});
