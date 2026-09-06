import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * D90 (coherence): the charter rules a membership probe as "the `==` question
 * one element at a time", and separately rejects a freshly built collection or
 * record literal as an `==` operand because identity makes the answer provably
 * constant. Only `==` enforced the second half, so every probe accepted the
 * same always-false expression in silence — the exact spelling a model brings
 * from Python, where `{'x': 1} in list_of_dicts` really does work.
 *
 * Every assertion here is about which side of the probe is closed. The probe
 * is; the container is not, and neither is a container that keys on identity
 * on purpose.
 */
function reported(source: string): string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

const POINT = "type Point:\n    x: number\n\n";

test("[D90] every List probe rejects a record literal it can never match", () => {
  for (const [probe, operation] of [
    ["print(str(points.has({x: 1})))", "List.has"],
    ["print(str(points.count({x: 1})))", "List.count"],
    ["print(str(points.index({x: 1})))", "List.index"],
    ["points.remove({x: 1})", "List.remove"],
  ] as const) {
    const messages = reported(`${POINT}const points: List<Point> = [{x: 1}, {x: 2}]\n${probe}\n`);
    assert.equal(messages.length, 1, messages.join(" | "));
    assert.ok(messages[0]!.includes(`'${operation}' compares element identity`), messages[0]!);
    assert.ok(messages[0]!.includes("equals(a, b)"), messages[0]!);
    assert.ok(messages[0]!.includes("values.some(item => equals(item, probe))"), messages[0]!);
  }
});

test("[D90] the Set and Map probes read the same rejection, keyed the way each container matches", () => {
  for (const [probe, operation] of [
    ["print(str(seen.has({x: 1})))", "Set.has"],
    ["seen.remove({x: 1})", "Set.remove"],
  ] as const) {
    const messages = reported(`${POINT}const seen: Set<Point> = Set()\n${probe}\n`);
    assert.equal(messages.length, 1, messages.join(" | "));
    assert.ok(messages[0]!.includes(`'${operation}' compares element identity`), messages[0]!);
  }
  for (const [probe, operation] of [
    ["print(str(byPoint.get({x: 1})))", "Map.get"],
    ["print(str(byPoint.has({x: 1})))", "Map.has"],
    ["byPoint.remove({x: 1})", "Map.remove"],
  ] as const) {
    const messages = reported(`${POINT}const byPoint: Map<Point, number> = Map()\n${probe}\n`);
    assert.equal(messages.length, 1, messages.join(" | "));
    assert.ok(messages[0]!.includes(`'${operation}' compares key identity`), messages[0]!);
    assert.ok(messages[0]!.includes("equals(a, b)"), messages[0]!);
  }
});

test("[D90] 'in' and 'not in' are probes too, and read the same sentence", () => {
  for (const operator of ["in", "not in"]) {
    const messages = reported(`${POINT}const points: List<Point> = [{x: 1}]\nprint(str({x: 1} ${operator} points))\n`);
    assert.equal(messages.length, 1, messages.join(" | "));
    assert.ok(messages[0]!.includes(`'${operator}' compares element identity`), messages[0]!);
  }
  const keyed = reported(`${POINT}const byPoint: Map<Point, number> = Map()\nprint(str({x: 1} in byPoint))\n`);
  assert.equal(keyed.length, 1, keyed.join(" | "));
  assert.ok(keyed[0]!.includes("'in' compares key identity"), keyed[0]!);
});

test("[D90] a List literal and a Map()/Set() construction are fresh in a probe just as a record literal is", () => {
  const nested = reported("const rows: List<List<number>> = [[1], [2]]\nprint(str(rows.has([1])))\nprint(str([1] in rows))\n");
  assert.equal(nested.length, 2, nested.join(" | "));
  for (const message of nested) assert.ok(message.includes("A List literal built inside the probe"), message);

  const built = reported("const groups: List<Map<string, number>> = []\nprint(str(groups.has(Map())))\n");
  assert.equal(built.length, 1, built.join(" | "));
  assert.ok(built[0]!.includes("A Map(...) construction built inside the probe"), built[0]!);
});

test("[D90] the container side is untouched — a fresh collection there is the domain, not the question", () => {
  // These three are ordinary VelarScript. A diagnostic on any of them would
  // refuse a correct program, which is worse than the silence this change
  // closes on the other side.
  for (const source of [
    "const x = 2\nprint(str(x in [1, 2, 3]))\n",
    "const x = 2\nprint(str(x in Set([1, 2])))\n",
    "print(str(\"a\" in \"abc\"))\n",
    "const x = 2\nprint(str(x not in [1, 2, 3]))\n",
  ]) assert.deepEqual(compile(source).diagnostics, [], source);
});

test("[D90] an identity-keyed container of records stays legal, because it is a legitimate program", () => {
  // Deliberately out of scope: `add` writes rather than asks, and a
  // `Set<Record>` / `Map<Record, V>` declaration is how a record is held as an
  // identity token. Only the position where the always-false answer is
  // provable from the literal alone is closed.
  assert.deepEqual(compile(`${POINT}const seen: Set<Point> = Set()\nseen.add({x: 1})\nprint(str(seen.size))\n`).diagnostics, []);
  assert.deepEqual(compile(`${POINT}const seen: Set<Point> = Set()\nconst byPoint: Map<Point, number> = Map()\nbyPoint.set({x: 1}, 2)\nprint(str(seen.size + byPoint.size))\n`).diagnostics, []);
});

test("[D90] a Record probe keeps the domain answer, which is the more precise one", () => {
  // Record keys are strings, so a record literal there is a type mismatch
  // before it is an identity question, and the intersection report is what the
  // author needs to read.
  const messages = reported("const scores: Record<number> = {}\nprint(str(scores.has({x: 1})))\n");
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(messages[0]!.includes("have no values in common"), messages[0]!);
  assert.ok(!messages[0]!.includes("built inside the probe"), messages[0]!);
});

test("[D90] a probe that is not freshly built is still an ordinary membership test", () => {
  assert.deepEqual(compile(`${POINT}const points: List<Point> = [{x: 1}]\nconst probe: Point = {x: 1}\nprint(str(points.has(probe)))\nprint(str(probe in points))\n`).diagnostics, []);
  assert.deepEqual(compile("const names: List<string> = [\"a\"]\nprint(str(names.has(\"a\")))\nprint(str(names.index(\"a\")))\nprint(str(names.count(\"a\")))\n").diagnostics, []);
});

test("[D90] the equality half the membership half was derived from is unchanged", () => {
  const messages = reported(`${POINT}const p: Point = {x: 1}\nprint(str(p == {x: 1}))\n`);
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(messages[0]!.includes("built inside the comparison"), messages[0]!);
  assert.ok(messages[0]!.includes("the result is always false"), messages[0]!);
});
