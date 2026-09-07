import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";
import { cliProject, messages, run } from "../../support/compiler-audit-suite.ts";

/**
 * D115 P5 — what a name in a program is, one subject of the file that was
 * `bounded-generics-and-dispose.slow.test.ts` before it reached 916 lines.
 *
 * What is held here is the three rulings about identity: a permanent namespace
 * is not a value, only the head of a member access (NEW-D6, rule 106); an
 * Error subclass cannot redeclare the contract's own members (NEW-D7); and
 * `is` is the only discrimination authority, so a relabelled host error
 * reports code 'Error' while the program's own classes keep their names
 * (rule 107). The harness is in `tests/support/compiler-audit-suite.ts`; the
 * bodies below are the bodies that file had.
 */

// ---------------------------------------------------------------------------
// NEW-D6 + rule 106 — a permanent namespace is not a value
// ---------------------------------------------------------------------------

test("[rule 106] a permanent namespace is rejected everywhere but the head of a member access", () => {
  for (const [source, namespace] of [
    ["const copy = {...Json}\n", "Json"],
    ["print(Json)\n", "Json"],
    ["const {stringify} = Json\n", "Json"],
    ["export const alias = Text\n", "Text"],
    ["const values = [Promise]\n", "Promise"],
  ] as const) {
    const reported = messages(source);
    assert.equal(reported.length, 1, `${source}: ${reported.join(" | ")}`);
    assert.match(reported[0]!, new RegExp(`^'${namespace}' is a namespace, not a value;`, "u"));
    assert.match(reported[0]!, /a namespace cannot be called, passed, stored, spread, or destructured$/u);
  }
});

test("[rule 106] member access on a namespace stays legal, and its members are ordinary values", () => {
  const output = run(`
const encode = Json.stringify
print(encode({a: 1}))
print(Text.slug("Hello World"))
`.trimStart());
  assert.equal(output, '{"a":1}\nhello-world\n');
});

// ---------------------------------------------------------------------------
// NEW-D7 — the Error contract's own members
// ---------------------------------------------------------------------------

test("[NEW-D7] an Error subclass cannot redeclare the contract's members in any binding form", () => {
  for (const [field, expected] of [
    ["const name: string = \"Forged\"", "'name' is the Error contract's own member"],
    ["const code: string = \"Forged\"", "'code' is the Error contract's own member"],
    ["const message: string = \"replaced\"", "'message' is the Error contract's own member"],
    ["let name: string = \"Forged\"", "'name' is the Error contract's own member"],
    ["const stack: string? = null", "'stack' is the Error contract's own member"],
    ["const cause: unknown = null", "'cause' is the Error contract's own member"],
  ] as const) {
    const reported = messages(`
class BudgetError extends Error:
    ${field}

    constructor(message: string):
        super(message)
`.trimStart());
    assert.equal(reported.length, 1, `${field}: ${reported.join(" | ")}`);
    assert.ok(reported[0]!.startsWith(expected), reported[0] ?? "");
  }
});

test("[NEW-D7] a constructor parameter binding cannot redeclare a contract member either", () => {
  const reported = messages(`
class BudgetError extends Error:
    constructor(const name: string):
        super(name)
`.trimStart());
  assert.equal(reported.length, 1);
  assert.ok(reported[0]!.startsWith("'name' is the Error contract's own member"), reported[0] ?? "");
});

// ---------------------------------------------------------------------------
// Rule 107 — `is` is the only discrimination authority
// ---------------------------------------------------------------------------

test("[rule 107] a relabelled host error reports code 'Error' while its own classes keep their names", async () => {
  const project = await cliProject({
    "node_modules/spoof-sdk/package.json": JSON.stringify({ name: "spoof-sdk", type: "module", exports: "./index.js" }),
    "node_modules/spoof-sdk/index.js": `
export function boom() {
  const error = new TypeError("host failure");
  error.name = "FileNotFoundError";
  error.code = "SPOOFED";
  throw error;
}
`.trimStart(),
    "src/main.vel": `
extern module "spoof-sdk":
    export def boom() -> null

import js {boom} from "spoof-sdk"

class BudgetError extends Error:
    constructor(message: string):
        super(message)

def main():
    try:
        boom()
    catch error:
        print("host code=" + error.code + " name=" + error.name + " is=" + str(error is FileNotFoundError))
    try:
        throw BudgetError("slow")
    catch error:
        print("own code=" + error.code + " is=" + str(error is BudgetError))
    const values: List<number> = [1]
    try:
        print(str(values[9]))
    catch error:
        print("builtin code=" + error.code)
    return null

main()
`.trimStart(),
  });
  try {
    const ran = project.cli("run", ".");
    assert.equal(ran.status, 0, ran.stderr);
    assert.equal(ran.stdout, [
      "host code=Error name=FileNotFoundError is=false",
      "own code=BudgetError is=true",
      "builtin code=IndexError",
      "",
    ].join("\n"));
  } finally {
    await rm(project.root, { recursive: true, force: true });
  }
});
