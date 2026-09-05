import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSemanticTokens } from "../packages/cli/src/project-semantic.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

test("callable standard-module imports publish function semantic tokens", async () => {
  const path = join(tmpdir(), `velar-imported-function-semantic-tokens-${process.pid}.vel`);
  const source = `
import {alpha, rgb} from "velar/look"
import {parse} from "velar/url"

const remaining = parse("/items", "https://example.com/")
const translucent = alpha(rgb(12, 34, 56), 0.5)
`.trimStart();
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarWebCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const tokens = projectSemanticTokens(project, path)
    .filter((token) => {
      const text = source.slice(token.span.start, token.span.end);
      return text === "parse" || text === "alpha";
    })
    .map((token) => [
      source.slice(token.span.start, token.span.end),
      token.type,
      token.modifiers,
    ]);
  assert.deepEqual(tokens, [
    ["alpha", "function", ["declaration"]],
    ["parse", "function", ["declaration"]],
    ["parse", "function", []],
    ["alpha", "function", []],
  ]);
});
