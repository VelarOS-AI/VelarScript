import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { compileProject } from "../../../packages/cli/src/project.ts";
import { projectSymbolAt } from "../../../packages/cli/src/project-semantic.ts";

/**
 * D114 item 10 / TX-U2: the structural record `zip` produces had no source
 * spelling. Diagnostics printed `List<{ first: number, second: U }>` while
 * `const a: {x: number}` answered "Expected a type name", so the compiler
 * printed a type its own parser refuses — and a `zip` result could not be
 * annotated at all. `Pair<A, B>` is that spelling: a Core record type, no
 * import, and structural, so the record literal is still its constructor.
 */

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[TX-U2] a zip result can be annotated, and its parts read back", () => {
  assert.deepEqual(messages(`
@main:
    const pairs: List<Pair<number, string>> = [1, 2].zip(["a", "b"])
    for pair in pairs:
        print(f"{pair.first}:{pair.second}")
`), []);
});

test("[TX-U2] a record literal is the constructor; there is no Pair(...) call form", () => {
  assert.deepEqual(messages(`
@main:
    const one: Pair<number, string> = {first: 1, second: "a"}
    print(str(one.first))
`), []);
  assert.deepEqual(messages(`
@main:
    const one = Pair(1, "a")
    print(str(one.first))
`), ["VEL3001 Unknown name 'Pair'"]);
});

test("[TX-U2] a misspelt field on a Pair is told which one it meant", () => {
  assert.deepEqual(messages(`
@main:
    const one: Pair<number, string> = {first: 1, secnod: "a"}
    print(str(one.first))
`), [
    "VEL4001 Object is missing required field 'second'",
    "VEL4001 Object has no field 'secnod'; did you mean 'second'?",
  ]);
});

test("[TX-U2] diagnostics print the name for a shape that is a Pair, and the structure for one that is not", () => {
  assert.deepEqual(messages(`
@main:
    const pairs = [1, 2].zip(["a", "b"])
    const wrong: number = pairs
`), ["VEL4001 Cannot assign List<Pair<number, string>> to number"]);
  assert.deepEqual(messages(`
@main:
    const named = {first: 1, second: "a"}
    const wrong: number = named
`), ["VEL4001 Cannot assign Pair<number, string> to number"]);
  assert.deepEqual(messages(`
@main:
    const anonymous = {alpha: 1, beta: "a"}
    const wrong: number = anonymous
`), ["VEL4001 Cannot assign { alpha: number, beta: string } to number"]);
});

test("[TX-U2] 'Pair' joins the built-in type-name roster", () => {
  assert.deepEqual(messages(`
type Pair:
    a: string
`), ["VEL3007 'Pair' is a Core type name, so it cannot also name a type; every use of it resolves to the built-in. Rename this declaration"]);
  assert.deepEqual(messages(`
@main:
    const value: Pair = {first: 1, second: "a"}
    print(str(value.first))
`), ["VEL4001 Generic type 'Pair' needs 2 type arguments; write 'Pair<A, B>' with concrete types"]);
});

test("[TX-U2] the hover on a zip result shows the name", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-pair-hover-"));
  try {
    const path = join(directory, "main.vel");
    const source = `const pairs = [1, 2].zip(["a", "b"])

print(str(pairs.size))
`;
    await writeFile(path, source, "utf8");
    const project = await compileProject(path, new Map(), {});
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics.map((item) => `${item.code} ${item.message}`)), []);
    const symbol = projectSymbolAt(project, path, source.indexOf("const pairs") + 7);
    assert.ok(symbol);
    assert.equal(symbol.type, "List<Pair<number, string>>");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
