import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  const firstPathPatternStart = source.indexOf('p"/articles/{id:string}"');
  const firstPathPatternEnd = firstPathPatternStart + 'p"/articles/{id:string}"'.length;
  assert.deepEqual(
    tokens
      .filter((token) => token.span.start >= firstPathPatternStart && token.span.end <= firstPathPatternEnd)
      .map((token) => [token.type, token.modifiers, source.slice(token.span.start, token.span.end)]),
    [["parameter", ["declaration"], "id"], ["type", [], "string"]],
  );

  const declaration = tokens.find((token) => source.slice(token.span.start, token.span.end) === "id" && token.modifiers.includes("declaration"));
  assert.equal(declaration?.type, "parameter");

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

test("RouteMatch mode colors pattern fields as properties instead of injected parameters", async () => {
  const path = join(tmpdir(), `velar-route-match-semantic-tokens-${process.pid}.vel`);
  const source = `server routes:\n    @get(p"/articles/{id:string}" as route) => {id: route.params.id}\n`;
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarNodeCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const tokens = projectSemanticTokens(project, path);
  const patternStart = source.indexOf('p"/articles/{id:string}"');
  const patternEnd = patternStart + 'p"/articles/{id:string}"'.length;
  assert.deepEqual(
    tokens
      .filter((token) => token.span.start >= patternStart && token.span.end <= patternEnd)
      .map((token) => [token.type, token.modifiers, source.slice(token.span.start, token.span.end)]),
    [["property", [], "id"], ["type", [], "string"]],
  );
  const route = tokens.find((token) => source.slice(token.span.start, token.span.end) === "route" && token.modifiers.includes("declaration"));
  assert.equal(route?.type, "parameter");
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

test("Web Look and JSX syntax publishes extension-owned property and tag colors without coloring text", async () => {
  const path = join(tmpdir(), `velar-web-semantic-syntax-${process.pid}.vel`);
  const source = `
const shellLook = look:
    minHeight = 100vh
    color = "black"

const fade = keyframes:
    from:
        opacity = 0
    to:
        opacity = 1

component App:
    return <main look={shellLook} aria-label="App"><h1>Title</h1></main>
`.trimStart();
  const project = await compileProject(path, new Map([[path, source]]), {
    extensions: [velarWebCompilerExtension],
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules[0]!.result.diagnostics, []);

  const tokens = projectSemanticTokens(project, path)
    .map((token) => [token.type, source.slice(token.span.start, token.span.end)] as const);
  assert.ok(tokens.some(([type, text]) => type === "property" && text === "minHeight"));
  assert.ok(tokens.some(([type, text]) => type === "property" && text === "color"));
  assert.ok(tokens.some(([type, text]) => type === "type" && text === "main"));
  assert.ok(tokens.some(([type, text]) => type === "type" && text === "h1"));
  assert.ok(tokens.some(([type, text]) => type === "property" && text === "look"));
  assert.ok(tokens.some(([type, text]) => type === "property" && text === "aria-label"));
  assert.ok(!tokens.some(([, text]) => text === "Title"));
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("minHeight") + 1)?.key, "look:property:minHeight");
  assert.equal(projectSyntaxDocumentationAt(project, path, source.indexOf("opacity") + 1)?.key, "look:property:opacity");
});

test("Web Look property hover publishes checked types, values, and compatible builders", async (context: TestContext) => {
  const root = await mkdtemp(join(tmpdir(), "velar-look-property-hover-"));
  const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(repositoryRoot, "packages", "web"), join(root, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "application",
    entry: "main.vel",
    extensions: ["@velarscript/web"],
    web: { title: "Look property hover", base: "/" },
  })}\n`, "utf8");
  const source = [
    "const probe = look:",
    '    display = "grid"',
    '    alignItems = "center"',
    "    width = 50%",
    "    opacity = 0.5",
    '    filter = "drop-shadow(0px 2px 4px black)"',
    "",
  ].join("\n");
  const sourcePath = join(root, "main.vel");
  await writeFile(sourcePath, source, "utf8");

  const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
  const child = spawn(process.execPath, [cliPath, "lsp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  context.after(async () => {
    child.stdin.destroy();
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });

  let buffered = Buffer.alloc(0);
  const received: Array<Record<string, unknown>> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const size = Number(/Content-Length:\s*(\d+)/iu.exec(buffered.subarray(0, boundary).toString("ascii"))?.[1]);
      if (!Number.isFinite(size)) break;
      const end = boundary + 4 + size;
      if (buffered.length < end) break;
      received.push(JSON.parse(buffered.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      buffered = buffered.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const reply = async (id: number): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const found = received.find((message) => message.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`No language-server reply for request ${id}: ${stderr}`);
  };
  const uri = pathToFileURL(sourcePath).href;
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href, capabilities: {} } });
  await reply(1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "velar", version: 1, text: source } },
  });

  const hover = async (id: number, line: number): Promise<string> => {
    send({ jsonrpc: "2.0", id, method: "textDocument/hover", params: { textDocument: { uri }, position: { line, character: 7 } } });
    const result = (await reply(id)).result as { readonly contents?: { readonly value?: string } } | null;
    return result?.contents?.value ?? "";
  };
  const display = await hover(2, 1);
  assert.match(display, /Allowed value types: `listed keyword`/u);
  assert.match(display, /`grid`/u);
  assert.match(display, /`inline-flex`/u);
  assert.match(display, /`token\(name\)`/u);

  const alignItems = await hover(3, 2);
  assert.match(alignItems, /Allowed value types: `listed keyword`/u);
  assert.match(alignItems, /`first baseline`/u);
  assert.match(alignItems, /`stretch`/u);

  const width = await hover(4, 3);
  assert.match(width, /Allowed value types: `Length`, `Percentage`, `LengthPercentage`, `Spacing`, `listed keyword`/u);
  assert.match(width, /`spacing\(first, second\?, third\?, fourth\?\)`/u);
  assert.match(width, /`clamp\(minimum, preferred, maximum\)`/u);

  const opacity = await hover(5, 4);
  assert.match(opacity, /Allowed value types: `number`, `listed keyword`/u);

  const filter = await hover(6, 5);
  assert.match(filter, /Allowed value types: `CSS text`/u);
  assert.match(filter, /`drop-shadow\(\)`/u);
  assert.match(filter, /`blur\(\)`/u);
  assert.match(filter, /Free CSS text is accepted here/u);
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
