import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSemanticTokens, type ProjectSemanticToken } from "../packages/cli/src/project-semantic.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

function tokenAt(tokens: readonly ProjectSemanticToken[], offset: number): ProjectSemanticToken | undefined {
  return tokens.find((token) => token.span.start === offset);
}

function assertKeyword(
  source: string,
  tokens: readonly ProjectSemanticToken[],
  fragment: string,
  keyword: string,
  occurrence: "first" | "last" = "first",
): void {
  const fragmentStart = source.indexOf(fragment);
  assert.notEqual(fragmentStart, -1, `missing fixture fragment ${fragment}`);
  const offset = fragmentStart + (occurrence === "last" ? fragment.lastIndexOf(keyword) : fragment.indexOf(keyword));
  assert.equal(tokenAt(tokens, offset)?.type, "keyword", `${keyword} must be semantic syntax in ${fragment}`);
}

test("external unsafe CSS marks the complete parsed import vocabulary as keywords", async () => {
  const directory = join(tmpdir(), `velar-css-import-semantic-tokens-${process.pid}`);
  const path = join(directory, "main.vel");
  const source = [
    'import css unsafe "./before-look.css" before look',
    'import css unsafe "./after-look.css" after look',
    "const css = 1",
    "const before = 2",
    "const after = 3",
    "const look = 4",
    "",
  ].join("\n");
  const project = await compileProject(path, new Map([
    [path, source],
    [join(directory, "before-look.css"), ".before {}"],
    [join(directory, "after-look.css"), ".after {}"],
  ]), { extensions: [velarWebCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const tokens = projectSemanticTokens(project, path);
  const beforeImport = 'import css unsafe "./before-look.css" before look';
  const afterImport = 'import css unsafe "./after-look.css" after look';
  for (const keyword of ["import", "css", "unsafe"] as const) {
    assertKeyword(source, tokens, beforeImport, keyword);
  }
  assertKeyword(source, tokens, beforeImport, "before", "last");
  assertKeyword(source, tokens, beforeImport, "look", "last");
  for (const keyword of ["import", "css", "unsafe"] as const) {
    assertKeyword(source, tokens, afterImport, keyword);
  }
  assertKeyword(source, tokens, afterImport, "after", "last");
  assertKeyword(source, tokens, afterImport, "look", "last");

  for (const name of ["css", "before", "after", "look"] as const) {
    const offset = source.indexOf(`const ${name} =`) + "const ".length;
    assert.equal(tokenAt(tokens, offset)?.type, "variable", `${name} remains an ordinary binding outside CSS syntax`);
  }
});

test("inline unsafe CSS uses the same before and after keyword semantics", async () => {
  const path = join(tmpdir(), `velar-inline-css-semantic-tokens-${process.pid}.vel`);
  const source = [
    "unsafe css`",
    "    .before {}",
    "` before look",
    "unsafe css`",
    "    .after {}",
    "` after look",
    "",
  ].join("\n");
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarWebCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const tokens = projectSemanticTokens(project, path);
  for (const [fragment, keywords] of [
    ["unsafe css`", ["unsafe", "css"]],
    ["` before look", ["before", "look"]],
    ["` after look", ["after", "look"]],
  ] as const) {
    for (const keyword of keywords) assertKeyword(source, tokens, fragment, keyword);
  }
});
