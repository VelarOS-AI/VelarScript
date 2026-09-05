import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSemanticTokens, type ProjectSemanticToken } from "../packages/cli/src/project-semantic.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

function tokenAt(tokens: readonly ProjectSemanticToken[], offset: number): ProjectSemanticToken | undefined {
  return tokens.find((token) => token.span.start === offset);
}

test("Core hard keywords, including detach, come from the compiler semantic index", async () => {
  const path = join(tmpdir(), `velar-core-keyword-semantic-tokens-${process.pid}.vel`);
  const source = [
    "const ready = true",
    "async def work(): return null",
    "detach work()",
    "",
  ].join("\n");
  const project = await compileProject(path, new Map([[path, source]]));
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const keywords = projectSemanticTokens(project, path)
    .filter((token) => token.type === "keyword")
    .map((token) => source.slice(token.span.start, token.span.end));
  assert.deepEqual(keywords, ["const", "true", "async", "def", "return", "null", "detach"]);
});

test("Web contextual syntax and framework definitions retain separate semantic roles", async () => {
  const path = join(tmpdir(), `velar-web-framework-semantic-tokens-${process.pid}.vel`);
  const source = [
    "unsafe css`",
    "    .probe { color: red; }",
    "` before look",
    "",
    "const card = look:",
    '    color = "red"',
    "",
    "const spin = keyframes:",
    "    from:",
    "        opacity = 0",
    "    to:",
    "        opacity = 1",
    "",
    "type Handle:",
    "    reset: () -> null",
    "",
    "component Panel(label: string) exposes Handle:",
    "    const component = 0",
    '    const state = "ready"',
    "    const computed = 0",
    "    const resource = 0",
    "    const action = 0",
    "    const watch = 1",
    "    const exposes = 0",
    "    const expose = 0",
    '    const look = "plain"',
    "    const keyframes = 0",
    "    const css = 0",
    "    state count = 0",
    "    computed doubled = count * 2",
    "    resource title: string = loadTitle()",
    "    action bump():",
    "        count = count + 1",
    "",
    "    watch count:",
    "        print(state + look + str(watch))",
    "",
    "    def reset():",
    "        count = 0",
    "",
    "    expose {reset}",
    '    return <section look={card}>{label}{title.value ?? ""}<button on:click={bump}>Run</button></section>',
    "",
    "component App:",
    '    return <main><Panel label="Test" /></main>',
    "",
    "async def loadTitle() -> string:",
    '    return "title"',
    "",
  ].join("\n");
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarWebCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const tokens = projectSemanticTokens(project, path);
  for (const [fragment, keyword] of [
    ["unsafe css`", "css"],
    ["` before look", "look"],
    ["const card = look:", "look"],
    ["const spin = keyframes:", "keyframes"],
    ["component Panel", "component"],
    ["Panel(label: string) exposes", "exposes"],
    ["    state count", "state"],
    ["    computed doubled", "computed"],
    ["    resource title", "resource"],
    ["    action bump", "action"],
    ["    watch count", "watch"],
    ["    expose {reset}", "expose"],
  ] as const) {
    const fragmentStart = source.indexOf(fragment);
    const offset = fragmentStart + fragment.indexOf(keyword);
    assert.equal(tokenAt(tokens, offset)?.type, "keyword", `${keyword} must be a keyword only at its parsed syntax position`);
  }

  for (const name of [
    "component", "state", "computed", "resource", "action", "watch",
    "exposes", "expose", "look", "keyframes", "css",
  ] as const) {
    const fragment = `const ${name} =`;
    const offset = source.indexOf(fragment) + "const ".length;
    const token = tokenAt(tokens, offset);
    assert.equal(token?.type, "variable", `${name} remains an ordinary binding`);
    assert.ok(!token?.modifiers.includes("frameworkDefinition"));
  }

  const definitions = [
    ["component Panel", "Panel", "function", ["declaration", "frameworkDefinition"]],
    ["state count", "count", "variable", ["declaration", "frameworkDefinition"]],
    ["computed doubled", "doubled", "variable", ["declaration", "readonly", "frameworkDefinition"]],
    ["resource title", "title", "variable", ["declaration", "readonly", "frameworkDefinition"]],
    ["action bump", "bump", "function", ["declaration", "frameworkDefinition"]],
    ["component App", "App", "function", ["declaration", "frameworkDefinition"]],
  ] as const;
  for (const [fragment, name, type, modifiers] of definitions) {
    const offset = source.indexOf(fragment) + fragment.indexOf(name);
    const token = tokenAt(tokens, offset);
    assert.equal(token?.type, type, `${name} keeps its base symbol type`);
    assert.deepEqual(token?.modifiers, modifiers, `${name} carries only definition-time framework metadata`);
  }

  const componentReference = tokenAt(tokens, source.indexOf("<Panel") + 1);
  assert.equal(componentReference?.type, "function");
  assert.deepEqual(componentReference?.modifiers, []);
  const actionReference = tokenAt(tokens, source.indexOf("{bump}") + 1);
  assert.equal(actionReference?.type, "function");
  assert.deepEqual(actionReference?.modifiers, []);
  const nativeReference = tokenAt(tokens, source.indexOf("<main") + 1);
  assert.equal(nativeReference?.type, "type");
  assert.deepEqual(nativeReference?.modifiers, []);
});

test("imported components keep function semantics without masquerading as framework definitions", async () => {
  const directory = join(tmpdir(), `velar-imported-framework-semantic-tokens-${process.pid}`);
  const path = join(directory, "main.vel");
  const libraryPath = join(directory, "panel.vel");
  const source = [
    'import {Panel} from "./panel.vel"',
    "component App:",
    "    return <Panel />",
    "",
  ].join("\n");
  const project = await compileProject(path, new Map([
    [path, source],
    [libraryPath, "export component Panel:\n    return <p>Panel</p>\n"],
  ]), { extensions: [velarWebCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const tokens = projectSemanticTokens(project, path);
  const imported = tokenAt(tokens, source.indexOf("Panel"));
  assert.equal(imported?.type, "function");
  assert.deepEqual(imported?.modifiers, ["declaration"]);
  const reference = tokenAt(tokens, source.indexOf("<Panel") + 1);
  assert.equal(reference?.type, "function");
  assert.deepEqual(reference?.modifiers, []);
});

test("Node server definitions are immutable framework variables", async () => {
  const path = join(tmpdir(), `velar-node-framework-semantic-tokens-${process.pid}.vel`);
  const source = 'server routes:\n    @get(p"/health") => {ok: true}\n';
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarNodeCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const tokens = projectSemanticTokens(project, path);
  const routes = tokenAt(tokens, source.indexOf("routes"));
  assert.equal(routes?.type, "variable");
  assert.deepEqual(routes?.modifiers, ["declaration", "readonly", "frameworkDefinition"]);
});
