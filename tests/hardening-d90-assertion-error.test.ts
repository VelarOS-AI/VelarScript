import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

/**
 * D90 (compiler-back-22). The charter already promises this at the paragraph
 * on the three failures `try` never converts to `null`: "A `catch` block still
 * receives all three, because a `catch` is explicit: the author wrote code to
 * handle it, and `is` names which one it was." `AssertionError` was the one of
 * the three that no roster carried, so `is AssertionError` answered
 * `VEL4001 Unknown type 'AssertionError'` and the promise had nothing behind
 * it. It is now registered exactly the way NarrowingError and IndexError are.
 */
test.after(async () => {
  await removeTemporaryDirectories();
});

async function run(prefix: string, source: string): Promise<string> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], source);
  const directory = await makeTemporaryDirectory(prefix);
  for (const embedded of result.embeddedModules) {
    await writeFile(join(directory, embedded.specifier.replace(/^\.\//u, "")), embedded.code, "utf8");
  }
  const entry = join(directory, "main.mjs");
  await writeFile(entry, result.code ?? "", "utf8");
  const execution = spawnSync(process.execPath, [entry], { encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  return execution.stdout;
}

test("[D90] a broken assertion and an absent unwrap both name AssertionError in a catch", async () => {
  const output = await run("velar-assertion-error-", `
def take(value: number?) -> number:
    return value!

def main():
    try:
        assert 1 == 2 else "boom"
    catch error:
        print("assert code=" + error.code + " is=" + str(error is AssertionError))
    try:
        print(str(take(null)))
    catch error:
        print("unwrap code=" + error.code + " is=" + str(error is AssertionError))

main()
`.trimStart());
  assert.equal(output, "assert code=AssertionError is=true\nunwrap code=AssertionError is=true\n");
});

test("[D90] a relabelled host Error wears the name and is still not an AssertionError", async () => {
  // D51 rule 107: the class a value was constructed from is what decides, both
  // for `code` and for `is`. A host error with `.name = "AssertionError"` was
  // not raised by the language, so neither answer may believe the label.
  // D90 R17: an undeclared export cannot be called, so the hostile thrower is
  // declared through the contracted block form.
  const output = await run("velar-assertion-costume-", `
extern js()\`
export function relabelled() {
    const error = new Error("costume");
    error.name = "AssertionError";
    throw error;
}
\`:
    export def relabelled() -> null

def main():
    try:
        relabelled()
    catch error:
        print("code=" + error.code + " is=" + str(error is AssertionError))

main()
`.trimStart());
  assert.equal(output, "code=Error is=false\n");
});

test("[D90] AssertionError is a nameable leaf contract, not a base to extend", () => {
  // Same treatment as the rest of the trio: constructible and catchable, and
  // refused as a base class so nothing dilutes what a caught one proves.
  assert.deepEqual(compile("def main():\n    throw AssertionError(\"raised by hand\")\n\nmain()\n").diagnostics, []);

  const extended = compile("class Mine extends AssertionError:\n    constructor(message: string):\n        super(message)\n");
  assert.deepEqual(
    extended.diagnostics.map((item) => item.message),
    ["The builtin error type 'AssertionError' cannot be extended; extend Error and declare your own fields"],
  );

  // A near miss reaches the nearest-name roster the other three are in.
  assert.ok(
    compile("def main():\n    throw AsertionError(\"x\")\n\nmain()\n").diagnostics
      .some((item) => item.message.includes("did you mean 'AssertionError'?")),
  );
});

test("[D90] a local binding cannot steal the type position from the builtin", () => {
  // `AssertionError` is not yet on the reserved-binding roster the other three
  // are on (`bindingNameRestriction` in packages/compiler/src/source-names.ts),
  // so a module may still declare the name. What matters here is that the
  // shadow never reaches the `is`: the type position resolves to the builtin
  // and the emitted check is still the compiler's own class.
  const result = compile(
    "const AssertionError = 1\n\ndef main():\n    try:\n        assert false else \"x\"\n    catch error:\n        if error is AssertionError:\n            print(\"caught\")\n\nmain()\n",
  );
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /if \(error instanceof __VelarAssertionError\)/u);
});
