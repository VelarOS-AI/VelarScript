import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

/**
 * D90 regression coverage for the two halves of the test-matcher surface that
 * the compiler owned at run time and not at compile time.
 *
 * `expect(...)` with no matcher (cli-17) built an expectation object, asserted
 * nothing, and reported a green test — D29 item 14's own rationale, an
 * expression statement that throws its only product away, reaches it and it
 * merely was not enumerated.
 *
 * `toBe`/`toEqual`/`toContain` (cli-19) inherited only the run-time half of
 * the comparisons D59 rule 141 and rule 141.1 settled them to be, so
 * `expect([1]).toBe([1])` compiled and then failed with both operands
 * rendering byte-identically, while `[1] == [1]` is refused where it is
 * written.
 *
 * The matchers are reached through the project pipeline rather than a bare
 * `compile` call because `velar/test` resolves only there.
 */

test.after(async () => {
  await removeTemporaryDirectories();
});

/** `CODE: message` for every diagnostic and failure a one-module project produces. */
async function reportOf(source: string): Promise<readonly string[]> {
  const directory = await makeTemporaryDirectory("velar-d90-test-matchers-");
  const entry = join(directory, "main.test.vel");
  await writeFile(entry, source, "utf8");
  const project = await compileProject(entry, new Map(), { extensions: [] });
  return [
    ...project.failures.map((failure) => `FAILURE: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code}: ${item.message}`)),
  ];
}

/** A `test` block whose body is the indented lines under it. */
function testModule(body: string, header = ""): string {
  return `import {expect} from "velar/test"\n${header}test "case":\n${body}`;
}

const STATUS_ENUM = "\nenum Status:\n    ready\n    done\n\n";

// ---------------------------------------------------------------------------
// cli-17 — an expectation with no matcher asserts nothing
// ---------------------------------------------------------------------------

test("[D90 cli-17] 'expect(...)' with no matcher is refused and names the missing matcher", async () => {
  // The program filed against the pre-fix analyzer: `==` where `.toBe` was
  // meant. It compiled, ran, asserted nothing, and reported the suite green.
  const report = await reportOf(testModule("    const a = 1\n    const b = 2\n    expect(a == b)\n"));
  assert.deepEqual(report, [
    "VEL4030: 'expect(...)' builds an expectation and asserts nothing on its own; add a matcher such as '.toBe(expected)'",
  ]);
});

test("[D90 cli-17] a bare call is still a legal expression statement", async () => {
  // D30 item 17's general CallExpression exemption must survive: a bare call
  // may perform an effect, and hundreds of programs depend on writing one.
  assert.deepEqual(await reportOf(testModule('    print("hi")\n')), []);
  assert.deepEqual(
    await reportOf(testModule("    log(value=1)\n", "\ndef log(value: number):\n    print(str(value))\n\n")),
    [],
  );
});

test("[D90 cli-17] the discarded pure-method check is unchanged", async () => {
  // The sibling D29 item 14 check shares the function the expect branch was
  // added to; its own diagnostic must still be the one that speaks.
  assert.deepEqual(await reportOf(testModule("    const values = [3, 1]\n    values.sorted()\n")), [
    "VEL4029: 'sorted' does not modify its receiver, so the result is discarded; keep the returned value or remove the call",
  ]);
});

// ---------------------------------------------------------------------------
// cli-19 — the matchers inherit the compile-time half of the comparison
// ---------------------------------------------------------------------------

test("[D90 cli-19] 'toBe' rejects a freshly built collection and teaches 'toEqual'", async () => {
  const literal = await reportOf(testModule("    expect([1]).toBe([1])\n"));
  assert.deepEqual(literal, [
    "VEL4001: A List literal built inside the expectation is a new object, and 'toBe' compares collection identity, so it can never match; compare contents with 'toEqual(expected)'",
  ]);
  // Either position settles it, exactly as `==` treats its two operands.
  assert.equal((await reportOf(testModule("    const list = [1]\n    expect(list).toBe([1])\n"))).length, 1);
  assert.equal((await reportOf(testModule("    const list = [1]\n    expect([1]).toBe(list)\n"))).length, 1);
  const constructed = await reportOf(testModule("    expect(Set([1])).toBe(Set([1]))\n"));
  assert.deepEqual(constructed, [
    "VEL4001: A Set(...) construction built inside the expectation is a new object, and 'toBe' compares collection identity, so it can never match; compare contents with 'toEqual(expected)'",
  ]);
});

test("[D90 cli-19] 'toEqual' keeps the fresh literal, which is its correct spelling", async () => {
  // The asymmetry is deliberate: `toEqual` is the `equals(a, b)` question, so
  // a literal expected value is the repair the `toBe` message teaches, not a
  // second mistake.
  assert.deepEqual(await reportOf(testModule("    expect([1]).toEqual([1])\n")), []);
  assert.deepEqual(await reportOf(testModule('    expect({name: "a"}).toEqual({name: "a"})\n')), []);
});

test("[D90 cli-19] two bindings compared by identity still compile", async () => {
  assert.deepEqual(await reportOf(testModule("    const list = [1]\n    expect(list).toBe(list)\n")), []);
  assert.deepEqual(await reportOf(testModule("    expect(1).toBe(1)\n")), []);
});

test("[D90 cli-19] a comparand from a disjoint domain is refused", async () => {
  assert.deepEqual(await reportOf(testModule('    expect(1).toBe("one")\n')), [
    "VEL4001: Cannot assign string to number",
  ]);
  // The enum/string boundary is the direction assignability lets through —
  // an enum member converts to string as a one-way wire exit — so it is the
  // case the intersection gate exists for. `==` has refused it since D42
  // item 64; the matcher now refuses it in the same words.
  const header = `${STATUS_ENUM}const status = Status.ready\nconst text = "ready"\n`;
  for (const matcher of ["toBe", "toEqual"]) {
    const report = await reportOf(testModule(`    expect(text).${matcher}(status)\n`, header));
    assert.equal(report.length, 1, report.join("\n"));
    assert.match(report[0]!, new RegExp(`the enum and string domains never meet in '${matcher}'`, "u"));
    assert.match(report[0]!, /Status\.parse\(text\)/u);
  }
});

test("[D90 cli-19] an operand the compiler already refused stays one diagnostic", async () => {
  // `==` leaves through `inferBinary`'s invalid-type exit before its own two
  // gates run, so the matcher that inherits the gates leaves there too. An
  // unresolved *name* is a different case and is deliberately not covered by
  // that exit: it infers as unknown, which intersects everything, so `==` and
  // the matcher both speak — the two must agree, whichever way they answer.
  assert.deepEqual(await reportOf(testModule("    const bad: Nope = 1\n    expect(bad).toBe([1])\n")), [
    "VEL4001: Unknown type 'Nope'",
  ]);
  assert.deepEqual(await reportOf(testModule("    const bad: Nope = 1\n    const ok = bad == [1]\n")), [
    "VEL4001: Unknown type 'Nope'",
  ]);
  const matcher = await reportOf(testModule("    expect(missing).toBe([1])\n"));
  const operator = await reportOf(testModule("    const ok = missing == [1]\n"));
  assert.equal(matcher.length, 2, matcher.join("\n"));
  assert.equal(operator.length, 2, operator.join("\n"));
});

test("[D90 cli-19] a bound expected value is how identity is proved, and stays legal", async () => {
  // The shape D59 rule 141.1's own probe uses to pin `toContain` at reference
  // identity: two structurally equal Lists, each held in a binding. The gate
  // speaks only for a collection built inside the probe, so this compiles and
  // the run-time proof it carries is untouched.
  assert.deepEqual(await reportOf(testModule(
    "    const inner = [1, 2]\n    const twin = [1, 2]\n    expect([inner]).toContain(inner)\n"
    + "    expect(() => expect([inner]).toContain(twin)).toThrow()\n",
  )), []);
  assert.deepEqual(await reportOf(testModule(
    "    const left = [1, 2]\n    const right = [1, 2]\n    expect(() => expect(left).toBe(right)).toThrow()\n",
  )), []);
});

// ---------------------------------------------------------------------------
// Sink sweep — the rest of the matcher roster
// ---------------------------------------------------------------------------

test("[D90 cli-19] 'toContain' carries the membership pair the same way 'in' does", async () => {
  // D59 rule 141.1 settled `toContain` to be `values.has(item)`, so ENM-I3's
  // intersection requirement and COL-I3's probe-side literal rejection travel
  // with it — one element at a time.
  const literal = await reportOf(testModule("    const rows: List<List<number>> = [[1]]\n    expect(rows).toContain([1])\n"));
  assert.deepEqual(literal, [
    "VEL4001: A List literal built inside the probe is a new object, and 'toContain' compares element identity, so it can never match; compare contents with equals(a, b) — 'values.some(item => equals(item, probe))' asks the same question one element at a time",
  ]);
  const enumProbe = await reportOf(testModule(
    "    expect(rows).toContain(status)\n",
    `${STATUS_ENUM}const status = Status.ready\nconst rows = ["ready"]\n`,
  ));
  assert.equal(enumProbe.length, 1, enumProbe.join("\n"));
  assert.match(enumProbe[0]!, /the enum and string domains never meet in 'toContain'/u);
  // Text containment is code-point containment, not element identity, so the
  // string receiver keeps its own reading.
  assert.deepEqual(await reportOf(testModule('    expect("abc").toContain("b")\n')), []);
  assert.deepEqual(await reportOf(testModule("    expect([1, 2]).toContain(1)\n")), []);
});

test("[D90 cli-19] the comparand-free matchers are untouched", async () => {
  // `toHaveLength` takes a count and `toMatch` takes a pattern; neither is a
  // comparand, so neither gate applies to them.
  assert.deepEqual(await reportOf(testModule("    expect([1]).toHaveLength(1)\n")), []);
  assert.deepEqual(await reportOf(testModule('    expect("abc").toMatch("^a")\n')), []);
  assert.deepEqual(await reportOf(testModule("    expect(true).toBeTruthy()\n")), []);
  // The Set receiver's own matcher message (the standing precedent for a
  // matcher-specific static check) still speaks for itself.
  const set = await reportOf(testModule('    expect(Set(["a"])).toHaveLength(1)\n'));
  assert.deepEqual(set, ["VEL4001: Set has no length matcher; write 'expect(set.size).toBe(expected)'"]);
});
