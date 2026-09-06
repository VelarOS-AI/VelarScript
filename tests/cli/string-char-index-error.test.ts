import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_LOWERING_MODULE, VELAR_PRIMITIVE_METHOD_MODULE, VELAR_REACTIVE_BRIDGE_MODULE } from "@velarscript/compiler/extension";
import { standardModuleClosure, standardModuleDependencies } from "../../packages/cli/src/standard-modules.ts";
import { executeModule } from "../support/execute-module.ts";
import { standardModuleWithDependencies } from "../support/standard-module-inline.ts";

/**
 * D115 P5 — `String.char`'s position failures, one subject of the file that was
 * `shared-runtime-validation.test.ts` before it reached 796 lines.
 *
 * D114 CO-U4b and CO-U4c are two halves of one sentence, so they are one file:
 * an out-of-range position and a non-integer position are both the nameable
 * `IndexError`, on the inline path and the project path alike, and neither
 * wears the `null` that reads like an absence. The bodies below are the bodies
 * that file had.
 */

// D114 CO-U4b: `IndexError` is the language's own out-of-range failure, and
// charter §7 says a `char` position outside `0 <= index < size` is one. The
// guard raised a plain `RangeError`, which carries no name — so
// `catch error: if error is IndexError` did not match it, and `try` turned it
// into the `null` that reads like "not found" and that charter §11 keeps the
// three integrity failures out of. The class the List lowering already owned
// now stands in a chunk of its own, so the String receiver methods reach the
// same declaration: the project path imports it from the module that publishes
// it, and the standalone path emits it beside whichever runtime raises it.

test("[CO-U4b] String.char's position guard raises the nameable IndexError on both paths", async () => {
  const source = `
@main:
    let index = 0 - 1
    try:
        print(str("abc".char(index)))
    catch error:
        if error is IndexError:
            print("named: " + error.code)
        else:
            print("unnamed: " + error.code)
`.trimStart();

  // The standalone path carries the String receiver methods and, with them, the
  // one class they raise. Naming `IndexError` brings the List lowering too, and
  // that lowering raises the same class — so the class is declared exactly once
  // for the two runtimes that share it, not once per runtime.
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /function __velarListGet/u);
  assert.equal((standalone.code ?? "").match(/class __VelarIndexError/gu)?.length, 1);

  // And a program that only reads a character carries the class with no List
  // lowering behind it: the String half is a consumer of it in its own right.
  const charOnly = compileCore("@main:\n    let index = 0 - 1\n    print(str(\"abc\".char(index)))\n");
  assert.deepEqual(charOnly.diagnostics, []);
  assert.equal((charOnly.code ?? "").match(/class __VelarIndexError/gu)?.length, 1);
  assert.doesNotMatch(charOnly.code ?? "", /function __velarListGet/u);

  const inline = executeModule(standalone.code ?? "");
  assert.equal(inline.status, 0, String(inline.stderr));
  assert.equal(inline.stdout, "named: IndexError\n");

  // The project path declares the dependency instead: one class for the whole
  // program, because `is IndexError` is an `instanceof` against it.
  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.ok(shared.runtimeModules.includes(VELAR_PRIMITIVE_METHOD_MODULE));
  assert.doesNotMatch(shared.code ?? "", /class __VelarIndexError/u);
  assert.deepEqual(standardModuleDependencies(VELAR_PRIMITIVE_METHOD_MODULE), [VELAR_COLLECTION_LOWERING_MODULE]);
  assert.deepEqual([...standardModuleClosure([VELAR_PRIMITIVE_METHOD_MODULE])].sort(), [
    VELAR_COLLECTION_HOST_MODULE,
    VELAR_COLLECTION_LOWERING_MODULE,
    VELAR_PRIMITIVE_METHOD_MODULE,
    VELAR_REACTIVE_BRIDGE_MODULE,
  ].sort());

  const project = executeModule(standardModuleWithDependencies(shared.code ?? ""));
  assert.equal(project.status, 0, String(project.stderr));
  assert.equal(project.stdout, "named: IndexError\n");
});

test("[CO-U4b] the out-of-range position is not the `null` that reads like 'not found'", async () => {
  // Charter §11: `AssertionError`, `NarrowingError` and `IndexError` never
  // become `null`. The String half used to, because a `RangeError` is not one
  // of the three by name — so `try "abc".char(-1)` answered `null`, which is
  // exactly what `char(3)` answers, and a bug wore the costume of an absence.
  const source = `
@main:
    let index = 0 - 1
    print(str(try "abc".char(index)))
`.trimStart();
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 1);
  assert.match(String(execution.stderr), /IndexError: String\.char index -1 is out of range for 3 characters/u);
  assert.equal(execution.stdout, "");

  // Past the end is still the absence the `string?` result exists to report.
  const absent = compileCore(`
@main:
    print(str(try "abc".char(3)))
`.trimStart());
  const past = executeModule(absent.code ?? "");
  assert.equal(past.status, 0, String(past.stderr));
  assert.equal(past.stdout, "null\n");
});

// D114 CO-U4c: the other half of the same sentence. Charter §11 files "an
// out-of-range or non-integer position" under `IndexError`; the non-integer half
// was a host `TypeError`, which `try` swallows, so a fractional index computed at
// run time kept the absence costume CO-U4b took off `char(-1)`. The report is
// `List.get`'s own sentence, and TX-U3 still refuses a literal one before it runs.
test("[CO-U4c] a non-integer char index is the IndexError List.get raises, on both paths", async () => {
  const source = `
@main:
    let index = 1.5
    try:
        print(str("abc".char(index)))
    catch error:
        if error is IndexError:
            print("named: " + error.message)
`.trimStart();
  const named = "named: String.char index must be an integer\n";
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  const inline = executeModule(standalone.code ?? "");
  assert.equal(inline.status, 0, String(inline.stderr));
  assert.equal(inline.stdout, named);
  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  const project = executeModule(standardModuleWithDependencies(shared.code ?? ""));
  assert.equal(project.status, 0, String(project.stderr));
  assert.equal(project.stdout, named);
  const swallow = executeModule(compileCore("@main:\n    let index = 1.5\n    print(str(try \"abc\".char(index)))\n").code ?? "");
  assert.equal(swallow.status, 1);
  assert.match(String(swallow.stderr), /IndexError: String\.char index must be an integer/u);
  assert.equal(swallow.stdout, "");
  const literal = compileCore("@main:\n    print(str(\"abc\".char(1.5)))\n");
  assert.equal(literal.code, null);
  assert.ok(literal.diagnostics.some((item) => /String\.char index must be an integer/u.test(item.message)));
});
