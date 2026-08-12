import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

const MIXING = "VEL2034";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

function runClean(source: string): ReturnType<typeof spawnSync> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution;
}

test("'or' followed by '??' in one bare chain is diagnosed", () => {
  const result = compile("const r = false or null ?? true\n");
  const mixing = result.diagnostics.filter((item) => item.code === MIXING);
  assert.equal(mixing.length, 1, result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
  assert.equal(mixing[0]?.message, "Parenthesize the mix of '??' and 'or'; the two groupings read differently");
  // The diagnostic recovers with the current grouping, so later stages still
  // report their own findings in the same compile.
  assert.equal(mixing[0]?.recovered, true);
  assert.ok(result.diagnostics.some((item) => item.code !== MIXING));
});

test("'??' followed by 'and' in one bare chain is diagnosed", () => {
  const result = compile("const maybe: bool? = null\nconst r = maybe ?? false and true\n");
  const mixing = result.diagnostics.filter((item) => item.code === MIXING);
  assert.equal(mixing.length, 1);
  assert.equal(mixing[0]?.message, "Parenthesize the mix of '??' and 'and'; the two groupings read differently");
});

test("one mixed chain reports one diagnostic, not a cascade", () => {
  const result = compile("const maybe: bool? = null\nconst r = maybe ?? false or true or false\n");
  assert.equal(result.diagnostics.filter((item) => item.code === MIXING).length, 1);
});

test("pure '??' chains and pure 'and'/'or' chains are unaffected", () => {
  const pureNullish = compile("const a: number? = null\nconst b: number? = null\nconst r = a ?? b ?? 3\n");
  assert.deepEqual(pureNullish.diagnostics, []);

  const pureBoolean = compile("const r = true or false and true\n");
  assert.deepEqual(pureBoolean.diagnostics, []);
});

test("explicit parentheses state the grouping and both groupings are legal", () => {
  const left = compile("const maybe: bool? = false\nconst r = (maybe ?? false) or true\n");
  assert.deepEqual(left.diagnostics, []);

  const right = compile("const maybe: bool? = false\nconst r = maybe ?? (false or true)\n");
  assert.deepEqual(right.diagnostics, []);

  const booleanFirst = compile("const maybe: bool? = null\nconst r = false or (maybe ?? true)\n");
  assert.deepEqual(booleanFirst.diagnostics, []);
});

test("the two groupings really read differently: execution truth table", () => {
  const execution = runClean(`
def leftGrouping(maybe: bool?, flag: bool) -> bool:
    return (maybe ?? false) or flag

def rightGrouping(maybe: bool?, flag: bool) -> bool:
    return maybe ?? (false or flag)

print(leftGrouping(false, true))
print(rightGrouping(false, true))
print(leftGrouping(null, true))
print(rightGrouping(null, true))
`.trimStart());
  // maybe=false, flag=true: (false ?? false) or true -> true, while
  // false ?? (false or true) -> false. maybe=null: both fall through to true.
  assert.equal(execution.stdout, "true\nfalse\ntrue\ntrue\n");
});

test("the mixing guidance never blocks the parenthesized rewrite of the original defect shape", () => {
  // The bare spelling from the audit: 'false or null ?? true'. Both explicit
  // groupings parse without the mixing diagnostic; remaining findings are the
  // ordinary condition/optional type rules.
  const grouped = compile("const r = (false or null) ?? true\n");
  assert.equal(grouped.diagnostics.filter((item) => item.code === MIXING).length, 0);

  const nested = compile("const r = false or (null ?? true)\n");
  assert.equal(nested.diagnostics.filter((item) => item.code === MIXING).length, 0);
});
