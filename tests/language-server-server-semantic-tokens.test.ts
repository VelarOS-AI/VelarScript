import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSemanticTokens } from "../packages/cli/src/project-semantic.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";

test("the Node extension publishes its contextual server syntax as semantic tokens", async () => {
  const path = join(tmpdir(), `velar-server-semantic-tokens-${process.pid}.vel`);
  const source = `
export server routes:
    @get(p"/articles/{id:string}") => {id}
    @post(p"/articles") => {ok: true}
    @notFound() => {error: "missing"}
`.trimStart();
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarNodeCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const tokens = projectSemanticTokens(project, path);
  const extensionTokens = tokens
    .filter((token) => token.type === "keyword")
    .map((token) => source.slice(token.span.start, token.span.end));
  assert.deepEqual(extensionTokens, ["server", "@get", "p", "@post", "p", "@notFound"]);

  for (let index = 1; index < tokens.length; index += 1) {
    assert.ok(tokens[index - 1]!.span.end <= tokens[index]!.span.start, "semantic tokens must not overlap");
  }
});

test("an invalid ordinary route string does not masquerade as the Node path-pattern prefix", async () => {
  const path = join(tmpdir(), `velar-server-semantic-invalid-${process.pid}.vel`);
  const source = `server routes:\n    @get("/health") => {ok: true}\n`;
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarNodeCompilerExtension],
  });
  const tokens = projectSemanticTokens(project, path)
    .filter((token) => token.type === "keyword")
    .map((token) => source.slice(token.span.start, token.span.end));

  assert.deepEqual(tokens, ["server", "@get"]);
  assert.ok(project.modules[0]!.result.diagnostics.some((item) => item.code === "VEL6005"));
});
