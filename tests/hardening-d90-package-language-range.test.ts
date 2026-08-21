import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { compileProject, type ProjectResult } from "../packages/cli/src/project.ts";
import { VELAR_VERSION } from "../packages/cli/src/version.ts";

// ---------------------------------------------------------------------------
// D90 R13: a published Vel source package declares the language generation it
// was written against, and the toolchain checks that declaration BEFORE it
// compiles the package's .vel. Without it a previous-generation package reports
// a string of ordinary syntax errors that read as if the package were simply
// broken — the failure mode "never promise compatibility" cannot afford.
//
// The field is optional: a manifest that declares nothing is checked exactly as
// it was before this ruling landed.
// ---------------------------------------------------------------------------

after(removeTemporaryDirectories);

/** The generation this toolchain implements — VELAR_VERSION without its patch component. */
const generation = VELAR_VERSION.split(".").slice(0, 2).join(".");

/** The source a previous-generation package might carry: valid then, unparseable now. */
const previousGenerationSource = "export def value():\n    with open() as f:\n        return f\n";

interface Fixture {
  readonly entry: string;
  readonly compile: (requires: unknown, source?: string) => Promise<string>;
}

async function makeFixture(prefix: string): Promise<Fixture> {
  const directory = await makeTemporaryDirectory(prefix);
  const packageRoot = join(directory, "node_modules", "generation-fixture");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  const entry = join(directory, "main.vel");
  await writeFile(entry, 'import {value} from "generation-fixture"\n\nprint(value)\n', "utf8");
  const messages = (project: ProjectResult): string => [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
  return {
    entry,
    compile: async (requires, source = "export const value = 1\n") => {
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({
        name: "generation-fixture",
        version: "1.0.0",
        velar: { entry: "src/index.vel", targets: ["core", "node"], requires },
      }), "utf8");
      await writeFile(join(packageRoot, "src", "index.vel"), source, "utf8");
      return messages(await compileProject(entry, new Map(), { projectRoot: directory }));
    },
  };
}

test("fr-13 a source package declares the language generation it needs", async () => {
  const fixture = await makeFixture("velar-package-language-satisfied-");
  assert.equal(await fixture.compile({ capabilities: [], language: generation }), "");
  assert.equal(await fixture.compile({ capabilities: [], language: ">=0.11 <99.0" }), "");
  assert.equal(await fixture.compile({ capabilities: [], language: `<=${generation}` }), "");
  assert.equal(await fixture.compile({ capabilities: [], language: `>=${generation}` }), "");
  // A manifest is hand-edited JSON: the clauses carry the meaning, the
  // whitespace around them does not.
  assert.equal(await fixture.compile({ capabilities: [], language: ` ${generation} ` }), "");
  assert.equal(await fixture.compile({ capabilities: [], language: ">=0.11\t<99.0" }), "");
});

test("fr-13 the mismatch quotes the declared range without its stray whitespace", async () => {
  const fixture = await makeFixture("velar-package-language-normalized-");
  const mismatch = await fixture.compile({ capabilities: [], language: "  >=0.9   <0.11 " });
  assert.match(mismatch, /requires VelarScript language >=0\.9 <0\.11;/u, mismatch);
});

test("fr-13 a wrong-generation package is named instead of blamed for syntax errors", async () => {
  const fixture = await makeFixture("velar-package-language-mismatch-");
  const mismatch = await fixture.compile({ capabilities: [], language: ">=0.9 <0.11" }, previousGenerationSource);
  assert.match(mismatch, /requires VelarScript language >=0\.9 <0\.11/u, "the declared range is quoted back verbatim");
  // The toolchain is 0.12.1 and the generation it implements is 0.12, so the
  // sentence says 'implements' — 'this toolchain is 0.12' would name a release
  // that is not the one running.
  assert.match(mismatch, new RegExp(`this toolchain implements ${generation.replace(".", "\\.")}`, "u"), "the current generation is named");
  assert.match(mismatch, /generation-fixture/u, "the package that made the demand is named");
  // The whole point of the ruling: the package's own .vel never reaches the
  // compiler, so its author is not handed a pile of ordinary syntax errors.
  assert.doesNotMatch(mismatch, /VelarScript does not expose 'with'/u);
  assert.equal(mismatch.split("\n").length, 1, mismatch);

  // The generation is reported before the target and capability lists, which a
  // wrong-generation manifest is in no position to be trusted about.
  const alsoWrongTarget = await fixture.compile({ capabilities: ["node"], language: "0.1" }, previousGenerationSource);
  assert.match(alsoWrongTarget, /requires VelarScript language 0\.1;/u);
  assert.doesNotMatch(alsoWrongTarget, /requires host capability/u);
});

test("fr-13 declaring no language keeps today's behaviour exactly", async () => {
  const fixture = await makeFixture("velar-package-language-absent-");
  assert.equal(await fixture.compile({ capabilities: [] }), "", "a package with 'requires' but no 'language' compiles as before");
  assert.match(
    await fixture.compile({ capabilities: [] }, previousGenerationSource),
    /VelarScript does not expose 'with'/u,
    "an undeclared package still reports its own diagnostics rather than a new gate",
  );
  // 'velar.requires' itself stays mandatory: R13 adds an optional field, it
  // does not relax the section that carries it.
  assert.match(await fixture.compile(undefined), /'velar\.requires' must be an object/u);
});

test("fr-13 a malformed language range is rejected by name", async () => {
  const fixture = await makeFixture("velar-package-language-malformed-");
  const named = /'velar\.requires\.language' must be a language generation such as '0\.12' or a range such as '>=0\.11 <0\.14'/u;
  for (const declared of [
    "0.12.1",       // a patch component promises something the language does not track
    "",             // an empty declaration is not a declaration
    "  ",
    "0.12 <0.14",   // a bare generation is already both bounds
    ">=0.11 <0.14 <0.15",
    ">=0.14 <0.11", // lower bound above the upper bound
    ">=0.12 <0.12", // admits nothing at all
    ">= 0.12",
    "^0.12",
    "0.x",
    "12",
    12,
    null,
    ["0.12"],
  ]) {
    assert.match(await fixture.compile({ capabilities: [], language: declared }), named, `rejected ${JSON.stringify(declared)}`);
  }
});

test("fr-13 the widened requires schema names the fields it supports", async () => {
  const fixture = await makeFixture("velar-package-language-schema-");
  assert.match(
    await fixture.compile({ capabilities: [], lanugage: "0.12" }),
    /'velar\.requires' has unknown field 'lanugage'; the supported fields are 'capabilities' and 'language'/u,
    "an author who misspells the new field is told what the section accepts",
  );
});
