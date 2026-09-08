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

test("[CO-D1] Pair's arity is checked, in the sentence every other Core generic uses", () => {
  // The table `List<…>` and `Map<…>` answer from had no `Pair` row, so a
  // dropped type argument made the second field `unknown` and compiled clean —
  // a static promise withdrawn by a typo — and a surplus one said nothing at
  // all. The zero-argument spelling keeps its own sentence, which names the
  // shape to write rather than counting what was written.
  assert.deepEqual(messages(`
@main:
    const p: Pair<string> = {first: "a", second: 5}
    print(f"{p.second}")
`), ["VEL2012 Type 'Pair' expects 2 type arguments"]);
  assert.deepEqual(messages(`
@main:
    const p: Pair<string, number, bool> = {first: "a", second: 1, third: true}
    print(p.first)
`), ["VEL2012 Type 'Pair' expects 2 type arguments"]);
  assert.deepEqual(messages(`
@main:
    const p: Pair = {first: "a", second: 5}
    print(p.first)
`), ["VEL4001 Generic type 'Pair' needs 2 type arguments; write 'Pair<A, B>' with concrete types"]);
});

test("[CO-I7] a Pair is called a Pair by the member report too, not 'Object'", () => {
  // D114 item 10 already says diagnostics print the structural spelling only
  // for shapes with no name. The assignment message obeyed it and the
  // member-miss message did not, so one value had two spellings across two
  // messages about the same mistake.
  assert.deepEqual(messages(`
@main:
    const p: Pair<string, number> = {first: "a", second: 1}
    print(p.frist)
`), ["VEL4001 Pair<string, number> has no field 'frist'; did you mean 'first'?"]);
});

test("[CO-U6] the name follows the shape, not the spelling that produced it", () => {
  // An author who has never written `Pair` still meets the name: two required,
  // writable fields called `first` and `second` are what makes a shape one.
  assert.deepEqual(messages(`
@main:
    const p = {first: "a", second: 1}
    const q: number = p
    print(f"{q}")
`), ["VEL4001 Cannot assign Pair<string, number> to number"]);
  // A third field is not a Pair, so that shape keeps the structural spelling,
  // which is how a message says "this shape has no name".
  assert.deepEqual(messages(`
@main:
    const p = {first: "a", second: 1, third: true}
    const q: number = p
    print(f"{q}")
`), ["VEL4001 Cannot assign { first: string, second: number, third: bool } to number"]);
});
