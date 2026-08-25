import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSemanticTokens, projectSyntaxDocumentationAt } from "../packages/cli/src/project-semantic.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

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
    .filter((token) => token.type === "keyword" || token.type === "decorator")
    .map((token) => [token.type, source.slice(token.span.start, token.span.end)]);
  assert.deepEqual(extensionTokens, [
    ["keyword", "server"],
    ["decorator", "@get"],
    ["decorator", "@post"],
    ["decorator", "@notFound"],
  ]);
  assert.ok(!tokens.some((token) => source.slice(token.span.start, token.span.end) === "p"));

  const documented = project.modules[0]!.result.semanticIndex.syntaxDocumentation
    .map((item) => [item.key, source.slice(item.span.start, item.span.end)]);
  assert.deepEqual(documented, [
    ["server", "server"],
    ["@get", "@get"],
    ["p", "p"],
    ["@post", "@post"],
    ["p", "p"],
    ["@notFound", "@notFound"],
  ]);
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("@post") + 2)?.key, "@post");
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf('p"/articles"'))?.key, "p");

  for (let index = 1; index < tokens.length; index += 1) {
    assert.ok(tokens[index - 1]!.span.end <= tokens[index]!.span.start, "semantic tokens must not overlap");
  }
});

test("Core class roles publish exact compiler-owned hover documentation spans", async () => {
  const path = join(tmpdir(), `velar-core-role-documentation-${process.pid}.vel`);
  const source = `
class Bag:
    let items: List<number> = []

    @iterate:
        return self.items

    @dispose:
        pass
`.trimStart();
  const project = await compileProject(path, new Map([[path, source]]));
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);
  assert.deepEqual(
    project.modules[0]!.result.semanticIndex.syntaxDocumentation.map((item) => [item.key, source.slice(item.span.start, item.span.end)]),
    [["@iterate", "@iterate"], ["@dispose", "@dispose"]],
  );
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("@iterate") + 1)?.key, "@iterate");
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("@dispose") + 1)?.key, "@dispose");
});

test("Web Look roles share annotation coloring and exact hover documentation", async () => {
  const path = join(tmpdir(), `velar-web-role-documentation-${process.pid}.vel`);
  const source = `
const buttonLook = look:
    if @hover:
        color = "blue"
    @before:
        content = ""
`.trimStart();
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarWebCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const decorators = projectSemanticTokens(project, path)
    .filter((token) => token.type === "decorator")
    .map((token) => source.slice(token.span.start, token.span.end));
  assert.deepEqual(decorators, ["@hover", "@before"]);
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("@hover") + 1)?.key, "@hover");
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("@before") + 1)?.key, "@before");
});

test("an invalid ordinary route string does not masquerade as the Node path-pattern prefix", async () => {
  const path = join(tmpdir(), `velar-server-semantic-invalid-${process.pid}.vel`);
  const source = `server routes:\n    @get("/health") => {ok: true}\n`;
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarNodeCompilerExtension],
  });
  const tokens = projectSemanticTokens(project, path)
    .filter((token) => token.type === "keyword" || token.type === "decorator")
    .map((token) => [token.type, source.slice(token.span.start, token.span.end)]);

  assert.deepEqual(tokens, [["keyword", "server"], ["decorator", "@get"]]);
  assert.ok(project.modules[0]!.result.diagnostics.some((item) => item.code === "VEL6005"));
});
