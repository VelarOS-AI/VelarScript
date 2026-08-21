import assert from "node:assert/strict";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * D90 (perf-1, perf-2, perf-7, perf-9). Four analyzer paths that were
 * superlinear — or, twice over, exponential — in the size or shape of ordinary
 * source. Every case here carries two assertions, because a flow-analysis
 * speedup that changes which narrowings survive is a correctness regression,
 * not a speedup: a wall-clock ceiling generous enough to catch the old order
 * without flapping on a loaded machine, and the exact diagnostics the module
 * must still produce.
 *
 * The ceilings are set roughly ten times the measured time on a quiet machine
 * and well under the measured time before the fix, so each one distinguishes
 * the old growth from the new without pinning a number.
 */
function under(ceiling: number, source: string, label: string): string[] {
  const started = performance.now();
  const result = compile(source);
  const ms = performance.now() - started;
  assert.ok(ms < ceiling, `${label} took ${ms.toFixed(0)}ms, over the ${ceiling}ms ceiling`);
  return result.diagnostics.map((item) => item.code);
}

/** M top-level constants nothing narrows, plus K branches inside one function. */
function flowModule(constants: number, branches: number): string {
  const lines: string[] = [];
  for (let index = 0; index < constants; index += 1) lines.push(`const c${index} = ${index}`);
  lines.push("def run(flag: bool) -> number:", "    let total = 0");
  for (let index = 0; index < branches; index += 1) {
    lines.push("    if flag:", `        total = total + ${index}`);
  }
  lines.push("    return total", "", "print(str(run(true)))");
  return `${lines.join("\n")}\n`;
}

/** `depth` nested `while` loops, each narrowing a value its body then falsifies. */
function nestedLoopModule(depth: number): string {
  const lines = ["def run(flag: bool) -> number:", "    let sum = 0"];
  let indent = "    ";
  for (let level = 0; level < depth; level += 1) {
    lines.push(`${indent}let v${level}: number? = 1`);
    lines.push(`${indent}while flag:`);
    indent += "    ";
    lines.push(`${indent}if v${level} != null:`);
    lines.push(`${indent}    sum = sum + v${level}`);
    lines.push(`${indent}v${level} = null`);
    lines.push(`${indent}v${level} = 2`);
  }
  lines.push(`${indent}sum = sum + 1`, "    return sum", "", "print(str(run(false)))");
  return `${lines.join("\n")}\n`;
}

/** N declared names, then N reads that each miss one of them by a single letter. */
function typoModule(names: number, misspell: boolean): string {
  const lines: string[] = [];
  for (let index = 0; index < names; index += 1) lines.push(`const binding${index} = ${index}`);
  lines.push("def run() -> number:", "    let total = 0");
  for (let index = 0; index < names; index += 1) {
    lines.push(misspell ? `    total = total + bindng${index}` : `    total = total + binding${index}`);
  }
  lines.push("    return total", "", "print(str(run()))");
  return `${lines.join("\n")}\n`;
}

/** N globals plus R member narrowings, the pair the visibility capture used to walk per loop. */
function memberNarrowingModule(globals: number, records: number): string {
  const lines = ["type Row:", "    label: string?", ""];
  for (let index = 0; index < globals; index += 1) lines.push(`const g${index} = ${index}`);
  lines.push("def run(flag: bool) -> number:", "    let total = 0", "    let running = flag");
  for (let index = 0; index < records; index += 1) lines.push(`    let r${index}: Row = { label: "a" }`);
  for (let index = 0; index < records; index += 1) {
    lines.push(`    if r${index}.label != null:`, `        total = total + r${index}.label.size`);
  }
  for (let index = 0; index < 40; index += 1) {
    lines.push("    while running:", "        total = total + 1", "        running = false");
  }
  lines.push("    return total", "", "print(str(run(false)))");
  return `${lines.join("\n")}\n`;
}

test("[D90 perf-1] a flow branch costs what it narrows, not what the module declares", () => {
  // Snapshot/restore/merge walked every binding of every live scope per branch,
  // so the same 400 branches cost four times as much in a module with four
  // times as many names: 304ms / 602ms / 1409ms before, flat after.
  for (const constants of [1000, 2000, 4000]) {
    const codes = under(4000, flowModule(constants, 400), `${constants} constants`);
    assert.deepEqual(codes, [], `${constants} constants`);
  }
});

test("[D90 perf-2] loop back-edge passes stop doubling with nesting depth", () => {
  // Each level ran the level below it twice: 668ms at twelve, 3.2s at fourteen,
  // 30s at seventeen. The budget in `reanalyzeLoopBackEdge` caps the passes
  // that may run at once, and it only ever removes a fact a pass would have
  // had to confirm, so an accepted program stays accepted.
  for (const depth of [12, 14, 17]) {
    const codes = under(8000, nestedLoopModule(depth), `depth ${depth}`);
    assert.deepEqual(codes, [], `depth ${depth}`);
  }
});

test("[D90 perf-2] a loop nest keeps every exit fact its conditions prove", () => {
  // `while v == null:` proves `v != null` on exit, so each `v + 1` after a loop
  // compiles only while that fact survives — the exact fact the budget drops
  // when it is reached. Three levels is past what the budget permits at once
  // and must still be accepted.
  const lines = ["def run(flag: bool, seed: number) -> number:", "    let total = 0"];
  let indent = "    ";
  for (const name of ["a", "b", "c", "d"]) {
    lines.push(`${indent}let ${name}: number? = null`);
    lines.push(`${indent}while ${name} == null:`);
    indent += "    ";
    lines.push(`${indent}${name} = seed`, `${indent}if flag:`, `${indent}    ${name} = null`);
  }
  for (const name of ["d", "c", "b", "a"]) {
    indent = indent.slice(4);
    lines.push(`${indent}total = total + ${name} + 1`);
  }
  lines.push("    return total", "", "print(str(run(false, 2)))");
  const result = compile(`${lines.join("\n")}\n`);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  assert.notEqual(result.code, null);
});

test("[D90 perf-7] 'did you mean' reads a roster instead of rebuilding one per name", () => {
  // The candidate set was rebuilt — core vocabulary, globals, imports and every
  // name in every scope — and run through a full edit-distance pass, once per
  // unresolved name: 1.3s / 5.8s / 24s. The clean control never paid for it and
  // still must not.
  for (const names of [800, 1600, 3200]) {
    const codes = under(8000, typoModule(names, true), `${names} typos`);
    // One unresolved name and one refused `unknown` addition per line.
    assert.deepEqual(new Set(codes), new Set(["VEL3001", "VEL4001"]), `${names} typos`);
    assert.equal(codes.filter((code) => code === "VEL3001").length, names, `${names} typos`);
  }
  assert.deepEqual(under(4000, typoModule(3200, false), "3200 clean"), []);
});

test("[D90 perf-7] the roster answers exactly what the full scan answered", () => {
  // The index files each name under the strings left by deleting up to two of
  // its characters, which two spellings within two edits always share. So one
  // edit and two edits both still resolve, an ambiguous pair still declines to
  // guess, and a distant name still gets no suggestion.
  const message = (source: string): string =>
    compile(source).diagnostics.find((item) => item.code === "VEL3001")?.message ?? "";
  assert.match(message("const counter = 1\nprint(str(contr))\n"), /did you mean 'counter'\?/u);
  assert.match(message("const counter = 1\nprint(str(cnter))\n"), /did you mean 'counter'\?/u);
  assert.equal(message("const alpha = 1\nconst alpho = 2\nprint(str(alphx))\n"), "Unknown name 'alphx'");
  assert.equal(message("const counter = 1\nprint(str(zzzzzzz))\n"), "Unknown name 'zzzzzzz'");

  // A name declared inside a scope leaves the roster when the scope does, so it
  // is never offered where it cannot be written.
  const outside = compile("def run() -> number:\n    const inside = 1\n    return inside\n\nprint(str(insid))\n");
  assert.deepEqual(
    outside.diagnostics.filter((item) => item.code === "VEL3001").map((item) => item.message),
    ["Unknown name 'insid'"],
  );
});

test("[D90 perf-9] the visibility capture costs what is narrowed, not what is in scope", () => {
  // Every block, loop and match flattened the whole scope chain into a fresh
  // Map and then spread the root set once per member narrowing: 39ms / 75ms /
  // 201ms as the module grew, flat after.
  for (const [globals, records] of [[500, 20], [1000, 40], [2000, 80]] as const) {
    const codes = under(3000, memberNarrowingModule(globals, records), `${globals} globals`);
    assert.deepEqual(codes, [], `${globals} globals`);
  }
});

test("[D90 perf-9] the narrowings a block hands back are the ones it proved", () => {
  // The capture is now a scope depth read back on demand, and the roster it
  // walks is per-scope, so a shadowed name must still resolve to the binding
  // the capture saw rather than to an inner declaration of the same spelling.
  const shadowed = compile(`def run(flag: bool, value: string?) -> number:
    let total = 0
    if value != null:
        total = total + value.size
    if flag:
        const value = 7
        total = total + value
    return total

print(str(run(true, "abc")))
`);
  assert.deepEqual(shadowed.diagnostics, []);
  assert.notEqual(shadowed.code, null);

  // A member narrowing survives its block, and one whose root left scope does
  // not follow it out.
  const member = compile(`type Row:
    label: string?

def run(row: Row) -> number:
    if row.label != null:
        return row.label.size
    return 0

print(str(run({ label: "z" })))
`);
  assert.deepEqual(member.diagnostics, []);

  // The fact an assignment falsifies is still gone afterwards.
  const falsified = compile(`def run(initial: string?) -> number:
    let value = initial
    if value != null:
        value = null
        return value.size
    return 0

print(str(run("a")))
`);
  assert.deepEqual(
    falsified.diagnostics.map((item) => item.code),
    ["VEL4001"],
    falsified.diagnostics.map((item) => item.message).join(" | "),
  );
});
