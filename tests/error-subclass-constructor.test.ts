import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";

/**
 * ER-I1: `class BudgetError extends Error: pass` took a zero-argument
 * constructor in silence and refused the first `BudgetError("slow")` with
 * "Expected 0 arguments but received 1" — a report at the use, about a
 * declaration that said nothing. The ordinary-base twin already refused at the
 * declaration and named the remedy; charter §11 sends the author down this
 * exact path ("extend `Error` for custom hierarchies"), so it cannot be the
 * unhelpful one.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("[ER-I1] an Error subclass without a constructor is refused at the declaration", () => {
  assert.deepEqual(messages(`
class BudgetError extends Error:
    pass

@main:
    print("x")
`), [
    "VEL4001 Class 'BudgetError' requires a constructor that calls 'super(...)'; a derived class without one takes no"
    + " construction arguments, so 'Error' would lose its message — write 'constructor(message: string): super(message)'",
  ]);
});

test("[ER-I1] the constructor the report names compiles and runs", () => {
  assert.equal(run(`
class BudgetError extends Error:
    constructor(message: string):
        super(message)

@main:
    try:
        throw BudgetError("slow")
    catch error:
        print(f"name={error.name} code={error.code} is={error is BudgetError}")
`), "name=BudgetError code=BudgetError is=true\n");
});

test("[ER-I1] a zero-argument subclass that declares its own constructor is legal", () => {
  assert.equal(run(`
class ClosedError extends Error:
    constructor():
        super("closed")

@main:
    try:
        throw ClosedError()
    catch error:
        print(f"msg={error.message}")
`), "msg=closed\n");
});

test("[ER-I1] the built-in error classes stay directly constructible", () => {
  assert.equal(run(`
@main:
    try:
        throw ValidationError("bad shape")
    catch error:
        print(f"{error.message}")
`), "bad shape\n");
});

test("[ER-I1] a base with no construction arguments is unaffected", () => {
  assert.deepEqual(messages(`
class Base:
    def label() -> string:
        return "b"

class Derived extends Base:
    pass

@main:
    print(Derived().label())
`), []);
});
