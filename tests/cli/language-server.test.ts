import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { linkWorkspaceWebExtension, linkWorkspaceNodeExtension } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("language server publishes diagnostics, hover, and completion", async (context) => {
  const directory = await makeTemporaryDirectory("velar-lsp-project-");
  const modelsPath = join(directory, "models.vel");
  const mainPath = join(directory, "main.vel");
  const mainText = [
    "import {greet} from \"./models.vel\"",
    "const label = greet(\"Ada\")",
    "const explicit: string = \"ready\"",
    "async def loadLabel() -> string:",
    "    return \"remote\"",
    "component Summary:",
    "    state count = 1",
    "    computed doubled = count * 2",
    "    resource remote = loadLabel()",
    "    return <><p host>{remote.loading ? \"Loading\" : doubled}</p><button type=\"button\" on:click={() => remote.reload()}>Reload</button></>",
    "",
  ].join("\n");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(modelsPath, "/// Greets one visible user.\nexport def greet(name: string) -> string:\n    return name\n", "utf8");
  await writeFile(mainPath, mainText, "utf8");
  const mainUri = pathToFileURL(mainPath).href;
  const scratchUri = pathToFileURL(join(directory, "scratch.vel")).href;
  const operatorUri = pathToFileURL(join(directory, "operators.vel")).href;
  const operatorText = [
    'const names = ["Ada"]',
    'const missing = "Lin" not in names',
    'const value: unknown = "Ada"',
    'const acceptable = value is not number',
    '',
  ].join("\n");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
  });
  let output = Buffer.alloc(0);
  const messages: Array<Record<string, unknown>> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    output = Buffer.concat([output, chunk]);
    while (true) {
      const boundary = output.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const header = output.subarray(0, boundary).toString("ascii");
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match) break;
      const size = Number(match[1]);
      const end = boundary + 4 + size;
      if (output.length < end) break;
      messages.push(JSON.parse(output.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      output = output.subarray(end);
    }
  });
  const frame = (message: unknown): string => {
    const body = JSON.stringify(message);
    return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
  };
  const send = (message: unknown): void => { child.stdin.write(frame(message)); };
  const sendTogether = (batch: readonly unknown[]): void => { child.stdin.write(batch.map(frame).join("")); };
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for LSP message. stderr: ${String(child.stderr.read() ?? "")}`);
  };

  child.stdin.write("Content-Length: 1\r\n\r\n{");
  const parseFailure = await waitFor((message) => message.id === null
    && (message.error as { code?: number } | undefined)?.code === -32700);
  assert.match(JSON.stringify(parseFailure), /Invalid JSON/u);

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(directory).href, capabilities: { general: { positionEncodings: ["utf-32", "utf-16"] } } } });
  const initialized = await waitFor((message) => message.id === 1);
  const initializeResult = initialized.result as {
    capabilities: {
      definitionProvider: boolean;
      positionEncoding: string;
      completionProvider: { triggerCharacters: string[] };
      documentHighlightProvider: boolean;
      inlayHintProvider: boolean;
      renameProvider: { prepareProvider: boolean };
      semanticTokensProvider: { legend: { tokenTypes: string[]; tokenModifiers: string[] }; full: boolean };
      codeActionProvider: { codeActionKinds: string[] };
      workspaceSymbolProvider: boolean;
      experimental: { velar: { protocolVersion: number; incrementalSessions: boolean; watchedFiles: boolean; workspaceRescan: boolean; cancellation: boolean; workspaceSearch: boolean; workspaceTextExtensions: string[]; workspaceTextFileLimit: number; workspaceSearchResultLimit: number; workspaceWatchPathLimit: number; workspaceWatchPathCodeUnitLimit: number; workspaceWatchTextCodeUnitLimit: number; ownershipGraph: boolean; ownershipGraphPatches: boolean; ownershipGraphAffectedModules: boolean; ownershipGraphNodeLimit: number; ownershipGraphEdgeLimit: number; emittedJavaScript: boolean; emittedJavaScriptCodeUnitLimit: number } };
    };
    serverInfo: { name: string };
  };
  assert.equal(initializeResult.serverInfo.name, "VelarScript Language Server");
  assert.equal(initializeResult.capabilities.positionEncoding, "utf-32");
  assert.equal(initializeResult.capabilities.experimental.velar.protocolVersion, 5);
  assert.equal(initializeResult.capabilities.experimental.velar.incrementalSessions, true);
  assert.equal(initializeResult.capabilities.experimental.velar.watchedFiles, true);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceRescan, true);
  assert.equal(initializeResult.capabilities.experimental.velar.cancellation, true);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceSearch, true);
  assert.deepEqual(initializeResult.capabilities.experimental.velar.workspaceTextExtensions,
    [".vel", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx", ".json", ".md", ".css"]);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceTextFileLimit, 50_000);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceSearchResultLimit, 10_000);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceWatchPathLimit, 4_096);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceWatchPathCodeUnitLimit, 4_096);
  assert.equal(initializeResult.capabilities.experimental.velar.workspaceWatchTextCodeUnitLimit, 2 * 1024 * 1024);
  assert.equal(initializeResult.capabilities.experimental.velar.ownershipGraph, true);
  assert.equal(initializeResult.capabilities.experimental.velar.ownershipGraphPatches, true);
  assert.equal(initializeResult.capabilities.experimental.velar.ownershipGraphAffectedModules, true);
  assert.equal(initializeResult.capabilities.experimental.velar.ownershipGraphNodeLimit, 20_000);
  assert.equal(initializeResult.capabilities.experimental.velar.ownershipGraphEdgeLimit, 40_000);
  assert.equal(initializeResult.capabilities.experimental.velar.emittedJavaScript, true);
  assert.equal(initializeResult.capabilities.experimental.velar.emittedJavaScriptCodeUnitLimit, 4 * 1024 * 1024);
  assert.equal(initializeResult.capabilities.workspaceSymbolProvider, true);
  assert.equal(initializeResult.capabilities.definitionProvider, true);
  assert.deepEqual(initializeResult.capabilities.completionProvider.triggerCharacters, [".", "<", " ", "{", ",", ":"]);
  assert.equal(initializeResult.capabilities.documentHighlightProvider, true);
  assert.equal(initializeResult.capabilities.inlayHintProvider, true);
  assert.equal(initializeResult.capabilities.renameProvider.prepareProvider, true);
  assert.deepEqual(initializeResult.capabilities.semanticTokensProvider.legend.tokenTypes,
    ["type", "class", "enum", "enumMember", "function", "method", "property", "variable", "parameter", "interface", "comment", "string", "keyword", "number", "regexp", "operator", "decorator"]);
  assert.deepEqual(initializeResult.capabilities.semanticTokensProvider.legend.tokenModifiers,
    ["declaration", "readonly", "static", "frameworkDefinition"]);
  assert.equal(initializeResult.capabilities.semanticTokensProvider.full, true);
  assert.deepEqual(initializeResult.capabilities.codeActionProvider.codeActionKinds, ["quickfix"]);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({ jsonrpc: "2.0", id: 303, method: "workspace/symbol", params: { query: "greet" } });
  const unopenedWorkspaceSymbols = await waitFor((message) => message.id === 303);
  assert.ok((unopenedWorkspaceSymbols.result as Array<{ name: string; location: { uri: string } }>).some((symbol) =>
    symbol.name === "greet" && symbol.location.uri === pathToFileURL(modelsPath).href));
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: scratchUri, languageId: "velar", version: 1, text: "component App:\n    let dialog: DialogElement? = null\n    return <img />\n" } },
  });
  const published = await waitFor((message) => message.method === "textDocument/publishDiagnostics");
  const diagnostics = (published.params as { diagnostics: Array<{ code: string }> }).diagnostics;
  assert.ok(diagnostics.some((item) => item.code === "VEL5016"));
  const unicodeUri = pathToFileURL(join(directory, "unicode.vel")).href;
  const unicodePrefix = 'print("😀" + ';
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: unicodeUri, languageId: "velar", version: 1, text: `${unicodePrefix}missing)\n` } },
  });
  const unicodePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === unicodeUri);
  const unicodeDiagnostics = (unicodePublished.params as { diagnostics: Array<{ range: { start: { character: number } } }> }).diagnostics;
  assert.ok(unicodeDiagnostics.some((item) => item.range.start.character === [...unicodePrefix].length));
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: operatorUri, languageId: "velar", version: 1, text: operatorText } },
  });
  const operatorPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === operatorUri);
  assert.deepEqual((operatorPublished.params as { diagnostics: unknown[] }).diagnostics, []);
  send({ jsonrpc: "2.0", id: 141, method: "textDocument/hover", params: { textDocument: { uri: operatorUri }, position: { line: 1, character: 23 } } });
  const membershipHover = await waitFor((message) => message.id === 141);
  assert.match(JSON.stringify(membershipHover.result), /negative membership/u);
  send({ jsonrpc: "2.0", id: 142, method: "textDocument/hover", params: { textDocument: { uri: operatorUri }, position: { line: 3, character: 25 } } });
  const typeTestHover = await waitFor((message) => message.id === 142);
  assert.match(JSON.stringify(typeTestHover.result), /runtime type/u);
  sendTogether([
    { jsonrpc: "2.0", id: 140, method: "textDocument/hover", params: { textDocument: { uri: scratchUri }, position: { line: 0, character: 2 } } },
    { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 140 } },
  ]);
  const cancelled = await waitFor((message) => message.id === 140);
  assert.equal((cancelled.error as { code: number }).code, -32800);

  const fixUri = pathToFileURL(join(directory, "fix.vel")).href;
  const fixText = "const same = 1 === 1\n\tprint(same)\nconst enabled = True && !False\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: fixUri, languageId: "velar", version: 1, text: fixText } },
  });
  const fixPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === fixUri);
  const fixDiagnostics = (fixPublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  assert.ok(fixDiagnostics.some((item) => item.code === "VEL1005"));
  assert.ok(fixDiagnostics.some((item) => item.code === "VEL1002"));
  send({
    jsonrpc: "2.0",
    id: 30,
    method: "textDocument/codeAction",
    params: {
      textDocument: { uri: fixUri },
      range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } },
      context: { diagnostics: fixDiagnostics, only: ["quickfix"] },
    },
  });
  const fixed = await waitFor((message) => message.id === 30);
  const fixes = fixed.result as Array<{ title: string; kind: string; isPreferred: boolean; edit: { changes: Record<string, Array<{ newText: string }>> } }>;
  // A word operator takes the space it needs from the rewrite itself, so
  // applying the '!' fix to '!False' produces 'not False' and never 'notFalse'.
  assert.deepEqual(fixes.map((item) => item.edit.changes[fixUri]![0]!.newText).sort(), ["    ", "and", "false", "not ", "true", "=="].sort());
  assert.ok(fixes.every((item) => item.kind === "quickfix" && item.isPreferred));

  const namedFixUri = pathToFileURL(join(directory, "named-fix.vel")).href;
  const namedFixText = "def greet(name: string):\n    pass\n\ngreet(name: \"Ada\")\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: namedFixUri, languageId: "velar", version: 1, text: namedFixText } },
  });
  const namedPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === namedFixUri);
  const namedDiagnostics = (namedPublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  send({
    jsonrpc: "2.0",
    id: 130,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: namedFixUri }, context: { diagnostics: namedDiagnostics, only: ["quickfix"] } },
  });
  const namedFixed = await waitFor((message) => message.id === 130);
  assert.deepEqual((namedFixed.result as Array<{ edit: { changes: Record<string, Array<{ newText: string }>> } }>).map((item) => item.edit.changes[namedFixUri]![0]!.newText), ["="]);

  const memberFixUri = pathToFileURL(join(directory, "member-fix.vel")).href;
  const memberFixText = "const values: List<number> = []\nvalues.push(1)\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: memberFixUri, languageId: "velar", version: 1, text: memberFixText } },
  });
  const memberPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === memberFixUri);
  const memberDiagnostics = (memberPublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  send({
    jsonrpc: "2.0",
    id: 131,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: memberFixUri }, context: { diagnostics: memberDiagnostics, only: ["quickfix"] } },
  });
  const memberFixed = await waitFor((message) => message.id === 131);
  assert.deepEqual((memberFixed.result as Array<{ edit: { changes: Record<string, Array<{ newText: string }>> } }>).map((item) => item.edit.changes[memberFixUri]![0]!.newText), ["append"]);

  const flipUri = pathToFileURL(join(directory, "self-negation.vel")).href;
  const flipText = [
    "type Box:",
    "    active: bool",
    "let active = false",
    "let box: Box = {active: false}",
    "def current() -> Box:",
    "    return box",
    "active = not active",
    "box.active = not box.active",
    "current().active = not current().active",
    "",
  ].join("\n");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: flipUri, languageId: "velar", version: 1, text: flipText } },
  });
  const flipPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === flipUri);
  // D28 item 7: self-negating assignment is ordinary code — no diagnostic
  // and therefore no quick fix; 'invert' is no longer a spelling to teach.
  assert.deepEqual((flipPublished.params as { diagnostics: unknown[] }).diagnostics, []);

  const privateFixUri = pathToFileURL(join(directory, "private-fix.vel")).href;
  const privateFixText = [
    "class Box:",
    "    private let value: number = 1",
    "    def read() -> number:",
    "        return self.#value",
    "",
  ].join("\n");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: privateFixUri, languageId: "velar", version: 1, text: privateFixText } },
  });
  const privatePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === privateFixUri);
  const privateDiagnostics = (privatePublished.params as { diagnostics: Array<{ code: string; message: string; range: Range }> }).diagnostics;
  assert.equal(privateDiagnostics.length, 1);
  assert.match(privateDiagnostics[0]!.message, /JavaScript private identifiers/u);
  send({
    jsonrpc: "2.0",
    id: 135,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: privateFixUri }, context: { diagnostics: privateDiagnostics, only: ["quickfix"] } },
  });
  const privateFixed = await waitFor((message) => message.id === 135);
  const privateFixes = privateFixed.result as Array<{ title: string; isPreferred: boolean; edit: { changes: Record<string, Array<{ newText: string }>> } }>;
  assert.deepEqual(privateFixes.map((item) => item.edit.changes[privateFixUri]![0]!.newText), [""]);
  assert.equal(privateFixes[0]?.title, "Remove the JavaScript private marker");
  assert.ok(privateFixes[0]?.isPreferred);

  const typeFixUri = pathToFileURL(join(directory, "type-fix.vel")).href;
  const typeFixText = "const values: Array<number> = []\nconst tags: Set[string] = Set()\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: typeFixUri, languageId: "velar", version: 1, text: typeFixText } },
  });
  const typePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === typeFixUri);
  const typeDiagnostics = (typePublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  assert.equal(typeDiagnostics.filter((item) => item.code === "VEL2012").length, 2);
  send({
    jsonrpc: "2.0",
    id: 132,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: typeFixUri }, context: { diagnostics: typeDiagnostics, only: ["quickfix"] } },
  });
  const typeFixed = await waitFor((message) => message.id === 132);
  // The '[T]' rewrite replaces the two brackets and leaves the type argument
  // text between them exactly as written.
  assert.deepEqual((typeFixed.result as Array<{ edit: { changes: Record<string, Array<{ newText: string }>> } }>)
    .map((item) => item.edit.changes[typeFixUri]!.map((edit) => edit.newText)), [["List"], ["<", ">"]]);

  const unsafeFixUri = pathToFileURL(join(directory, "unsafe-fix.vel")).href;
  const unsafeFixText = "const values: List<number> = [1]\nvalues.findIndex(value => value > 0)\nvalues.sort()\n";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: unsafeFixUri, languageId: "velar", version: 1, text: unsafeFixText } },
  });
  const unsafePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === unsafeFixUri);
  const unsafeDiagnostics = (unsafePublished.params as { diagnostics: Array<{ code: string; range: Range }> }).diagnostics;
  assert.equal(unsafeDiagnostics.length, 2);
  send({
    jsonrpc: "2.0",
    id: 133,
    method: "textDocument/codeAction",
    params: { textDocument: { uri: unsafeFixUri }, context: { diagnostics: unsafeDiagnostics, only: ["quickfix"] } },
  });
  const unsafeFixed = await waitFor((message) => message.id === 133);
  assert.deepEqual(unsafeFixed.result, []);

  send({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: { textDocument: { uri: scratchUri }, position: { line: 0, character: 2 } } });
  const hovered = await waitFor((message) => message.id === 2);
  assert.match(JSON.stringify(hovered.result), /compiler-managed Web component/);
  const webMagicPath = join(directory, "web-magic.vel");
  const webMagicUri = pathToFileURL(webMagicPath).href;
  const webMagicText = [
    "const cardLook = look:",
    "    if @hover:",
    "        color = \"blue\"",
    "component Magic:",
    "    @mounted:",
    "        print(\"ready\")",
    "    return <button look={cardLook} on:click={() => print(\"clicked\")}>Magic</button>",
    "",
  ].join("\n");
  await writeFile(webMagicPath, webMagicText, "utf8");
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: webMagicUri, languageId: "velar", version: 1, text: webMagicText } } });
  const webMagicPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === webMagicUri);
  assert.deepEqual((webMagicPublished.params as { diagnostics: unknown[] }).diagnostics, []);
  send({ jsonrpc: "2.0", id: 201, method: "textDocument/hover", params: { textDocument: { uri: webMagicUri }, position: { line: 1, character: 8 } } });
  const lookHookHover = await waitFor((message) => message.id === 201);
  assert.match(JSON.stringify(lookHookHover.result), /live CSS state/u);
  assert.match(JSON.stringify(lookHookHover.result), /if @hover/u);
  send({ jsonrpc: "2.0", id: 202, method: "textDocument/hover", params: { textDocument: { uri: webMagicUri }, position: { line: 4, character: 7 } } });
  const mountedHover = await waitFor((message) => message.id === 202);
  assert.match(JSON.stringify(mountedHover.result), /compiler-owned component lifecycle role/u);
  assert.match(JSON.stringify(mountedHover.result), /@mounted:/u);
  send({ jsonrpc: "2.0", id: 203, method: "textDocument/hover", params: { textDocument: { uri: webMagicUri }, position: { line: 6, character: 40 } } });
  const eventHover = await waitFor((message) => message.id === 203);
  assert.match(JSON.stringify(eventHover.result), /checked DOM event handler/u);

  const nodeDirectory = join(directory, "node-service");
  const nodePath = join(nodeDirectory, "main.vel");
  const nodeUri = pathToFileURL(nodePath).href;
  const nodeText = "export server routes:\n    @post(p\"/articles\") => {ok: true}\n\n@main: pass\n";
  await mkdir(nodeDirectory, { recursive: true });
  await linkWorkspaceNodeExtension(nodeDirectory);
  await writeFile(join(nodeDirectory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/node"] }), "utf8");
  await writeFile(nodePath, nodeText, "utf8");
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: nodeUri, languageId: "velar", version: 1, text: nodeText } } });
  const nodePublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === nodeUri);
  assert.deepEqual((nodePublished.params as { diagnostics: unknown[] }).diagnostics, []);
  send({ jsonrpc: "2.0", id: 204, method: "textDocument/hover", params: { textDocument: { uri: nodeUri }, position: { line: 1, character: 7 } } });
  const postHover = await waitFor((message) => message.id === 204);
  assert.match(JSON.stringify(postHover.result), /compiler-owned role/u);
  assert.match(JSON.stringify(postHover.result), /@post createArticle\(p/u);
  send({ jsonrpc: "2.0", id: 205, method: "textDocument/hover", params: { textDocument: { uri: nodeUri }, position: { line: 1, character: 10 } } });
  const pathPatternHover = await waitFor((message) => message.id === 205);
  assert.match(JSON.stringify(pathPatternHover.result), /first-class Node RoutePattern/u);
  send({ jsonrpc: "2.0", id: 3, method: "textDocument/completion", params: { textDocument: { uri: scratchUri }, position: { line: 0, character: 0 } } });
  const completed = await waitFor((message) => message.id === 3);
  assert.match(JSON.stringify(completed.result), /bind:value/);
  assert.match(JSON.stringify(completed.result), /abstract/);
  assert.match(JSON.stringify(completed.result), /override/);
  assert.match(JSON.stringify(completed.result), /"label":"get"/);
  assert.match(JSON.stringify(completed.result), /constructor/);
  assert.doesNotMatch(JSON.stringify(completed.result), /"label":"init"/u);
  assert.match(JSON.stringify(completed.result), /super/);
  assert.match(JSON.stringify(completed.result), /throw/);
  assert.match(JSON.stringify(completed.result), /assert/);
  assert.doesNotMatch(JSON.stringify(completed.result), /"label":"invert"/u);
  assert.match(JSON.stringify(completed.result), /velar\/url/);
  // D114 S3: velar/collections retired into checked List members, so it is no
  // longer an importable module the editor may offer.
  assert.doesNotMatch(JSON.stringify(completed.result), /velar\/collections/u);
  // D57 rule 136: velar/async retired into the Promise namespace, so completing
  // it as an import would offer a spelling VEL3008 refuses. The namespace is
  // what the editor offers now.
  assert.doesNotMatch(JSON.stringify(completed.result), /"label":"velar\/async"/u);
  assert.match(JSON.stringify(completed.result), /"label":"Promise","kind":6/u);
  assert.match(JSON.stringify(completed.result), /velar\/time/);
  assert.match(JSON.stringify(completed.result), /velar\/log/);
  assert.match(JSON.stringify(completed.result), /velar\/app/);
  assert.match(JSON.stringify(completed.result), /velar\/config/);
  assert.match(JSON.stringify(completed.result), /velar\/browser/);
  assert.match(JSON.stringify(completed.result), /velar\/realtime/);
  assert.match(JSON.stringify(completed.result), /DialogElement/);
  assert.match(JSON.stringify(completed.result), /resource/);
  assert.match(JSON.stringify(completed.result), /action/);
  send({ jsonrpc: "2.0", id: 20, method: "textDocument/hover", params: { textDocument: { uri: scratchUri }, position: { line: 1, character: 18 } } });
  const dialogTypeHover = await waitFor((message) => message.id === 20);
  assert.match(JSON.stringify(dialogTypeHover.result), /native dialog reference/);

  const coreDirectory = join(directory, "core");
  const corePath = join(coreDirectory, "main.vel");
  const coreUri = pathToFileURL(corePath).href;
  const coreText = "const value = 1\n";
  await mkdir(coreDirectory, { recursive: true });
  await writeFile(join(coreDirectory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(corePath, coreText, "utf8");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: coreUri, languageId: "velar", version: 1, text: coreText } },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === coreUri);
  send({ jsonrpc: "2.0", id: 33, method: "textDocument/completion", params: { textDocument: { uri: coreUri }, position: { line: 0, character: 0 } } });
  const coreCompletion = await waitFor((message) => message.id === 33);
  const coreCompletionText = JSON.stringify(coreCompletion.result);
  assert.doesNotMatch(coreCompletionText, /bind:value|DialogElement|velar\/web|velar\/app|"label":"component"|"label":"resource"|"label":"mounted"/u);
  assert.match(coreCompletionText, /velar\/test/);
  assert.match(coreCompletionText, /"label":"const"/);

  const invalidDirectory = join(directory, "invalid-config");
  const invalidPath = join(invalidDirectory, "main.vel");
  const invalidUri = pathToFileURL(invalidPath).href;
  await mkdir(invalidDirectory, { recursive: true });
  await writeFile(invalidPath, "const value = 1\n", "utf8");
  await writeFile(join(invalidDirectory, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel", extensions: [] }), "utf8");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: invalidUri, languageId: "velar", version: 1, text: "const value = 1\n" } },
  });
  const invalidPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === invalidUri);
  const invalidDiagnostics = (invalidPublished.params as { diagnostics: Array<{ code: string; message: string }> }).diagnostics;
  assert.ok(invalidDiagnostics.some((item) => item.code === "VEL9001" && /unsupported formatVersion 1/u.test(item.message)));

  const carriageReturnText = "const first = 1\rconst second = first\r";
  send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: { textDocument: { uri: coreUri, version: 2 }, contentChanges: [{ text: carriageReturnText }] },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === coreUri
    && (message.params as { version?: number }).version === 2);
  send({
    jsonrpc: "2.0",
    id: 34,
    method: "textDocument/definition",
    params: { textDocument: { uri: coreUri }, position: { line: 1, character: "const second = ".length + 1 } },
  });
  const carriageReturnDefinition = await waitFor((message) => message.id === 34);
  assert.equal((carriageReturnDefinition.result as { uri: string; range: { start: { line: number; character: number } } }).uri, coreUri);
  assert.deepEqual((carriageReturnDefinition.result as { range: { start: { line: number; character: number } } }).range.start, { line: 0, character: 6 });

  const beforeRapidChanges = messages.length;
  sendTogether([3, 4, 5].map((version) => ({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: { textDocument: { uri: coreUri, version }, contentChanges: [{ text: carriageReturnText }] },
  })));
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === coreUri
    && (message.params as { version?: number }).version === 5);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const rapidVersions = messages.slice(beforeRapidChanges)
    .filter((message) => message.method === "textDocument/publishDiagnostics"
      && (message.params as { uri?: string }).uri === coreUri)
    .map((message) => (message.params as { version?: number }).version);
  assert.deepEqual(rapidVersions, [5]);

  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: mainUri, languageId: "velar", version: 1, text: mainText } },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === mainUri);
  const greetColumn = mainText.split("\n")[1]!.indexOf("greet") + 1;
  const callColumn = mainText.split("\n")[1]!.indexOf("greet(") + "greet(".length;
  await writeFile(modelsPath, "/// Greets one visible user after a watched-file refresh.\nexport def greet(name: string) -> string:\n    return name\n", "utf8");
  send({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: pathToFileURL(modelsPath).href, type: 2 }] },
  });
  send({ jsonrpc: "2.0", id: 136, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const watchedHover = await waitFor((message) => message.id === 136);
  assert.match(JSON.stringify(watchedHover.result), /watched-file refresh/u);
  send({ jsonrpc: "2.0", id: 300, method: "velar/workspaceSearch", params: { query: "watched-file refresh", maximumResults: 10 } });
  const workspaceSearch = await waitFor((message) => message.id === 300);
  const workspaceSearchResult = workspaceSearch.result as {
    items: Array<{ uri: string; preview: string; range: { start: { line: number; character: number } } }>;
    limitReached: boolean;
    indexedFiles: number;
    indexedBytes: number;
    revision: number;
    coverageComplete: boolean;
  };
  assert.equal(workspaceSearchResult.items.length, 1);
  assert.equal(workspaceSearchResult.items[0]?.uri, pathToFileURL(modelsPath).href);
  assert.match(workspaceSearchResult.items[0]?.preview ?? "", /watched-file refresh/u);
  assert.deepEqual(workspaceSearchResult.items[0]?.range.start, {
    line: 0,
    character: "/// Greets one visible user after a watched-file refresh.".indexOf("watched-file refresh"),
  });
  assert.equal(workspaceSearchResult.limitReached, false);
  assert.ok(workspaceSearchResult.indexedFiles >= 2);
  assert.ok(workspaceSearchResult.indexedBytes > 0);
  assert.ok(workspaceSearchResult.revision > 0);
  assert.equal(workspaceSearchResult.coverageComplete, true);
  send({
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: Array.from({ length: 4_097 }, () => ({ uri: pathToFileURL(modelsPath).href, type: 2 })) },
  });
  const boundedWatcherLog = await waitFor((message) => message.method === "window/logMessage"
    && /Watcher batch exceeded the official bounds/u.test(String((message.params as { message?: unknown }).message)));
  assert.match(String((boundedWatcherLog.params as { message: string }).message), /rebuilt the initialized workspace index/u);
  send({ jsonrpc: "2.0", id: 304, method: "velar/workspaceSearch", params: { query: "watched-file refresh", maximumResults: 10 } });
  const rebuiltWorkspaceSearch = await waitFor((message) => message.id === 304);
  assert.equal((rebuiltWorkspaceSearch.result as { items: unknown[] }).items.length, 1);
  send({ jsonrpc: "2.0", id: 301, method: "workspace/symbol", params: { query: "greet" } });
  const workspaceSymbols = await waitFor((message) => message.id === 301);
  assert.ok(Array.isArray(workspaceSymbols.result), JSON.stringify(workspaceSymbols));
  assert.ok((workspaceSymbols.result as Array<{ name: string; location: { uri: string } }>).some((symbol) =>
    symbol.name === "greet" && symbol.location.uri === pathToFileURL(modelsPath).href));
  send({ jsonrpc: "2.0", id: 302, method: "velar/workspaceSearch", params: { query: "", maximumResults: 10 } });
  const invalidWorkspaceSearch = await waitFor((message) => message.id === 302);
  assert.equal((invalidWorkspaceSearch.error as { code: number }).code, -32602);
  send({ jsonrpc: "2.0", id: 32, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const documentedHover = await waitFor((message) => message.id === 32);
  assert.match(JSON.stringify(documentedHover.result), /Greets one visible user/u);
  send({ jsonrpc: "2.0", id: 4, method: "textDocument/definition", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const definition = await waitFor((message) => message.id === 4);
  assert.equal((definition.result as { uri: string }).uri, pathToFileURL(modelsPath).href);
  send({ jsonrpc: "2.0", id: 5, method: "textDocument/references", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn }, context: { includeDeclaration: true } } });
  const references = await waitFor((message) => message.id === 5);
  assert.equal((references.result as unknown[]).length, 3);
  send({ jsonrpc: "2.0", id: 22, method: "textDocument/documentHighlight", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn } } });
  const documentHighlights = await waitFor((message) => message.id === 22);
  const highlightedRanges = documentHighlights.result as Array<{ range: Range; kind: number }>;
  assert.equal(highlightedRanges.length, 2, "document highlights must not include the declaration in another module");
  assert.ok(highlightedRanges.every((highlight) => highlight.kind === 1));
  send({ jsonrpc: "2.0", id: 6, method: "textDocument/rename", params: { textDocument: { uri: mainUri }, position: { line: 1, character: greetColumn }, newName: "welcome" } });
  const renamed = await waitFor((message) => message.id === 6);
  const changes = (renamed.result as { changes: Record<string, unknown[]> }).changes;
  assert.equal(changes[mainUri]?.length, 2);
  assert.equal(changes[pathToFileURL(modelsPath).href]?.length, 1);
  send({ jsonrpc: "2.0", id: 7, method: "textDocument/documentSymbol", params: { textDocument: { uri: mainUri } } });
  const symbols = await waitFor((message) => message.id === 7);
  assert.match(JSON.stringify(symbols.result), /label/);
  send({ jsonrpc: "2.0", id: 8, method: "textDocument/signatureHelp", params: { textDocument: { uri: mainUri }, position: { line: 1, character: callColumn } } });
  const signature = await waitFor((message) => message.id === 8);
  assert.match(JSON.stringify(signature.result), /greet\(name: string\) -&gt; string|greet\(name: string\) -> string/u);
  send({ jsonrpc: "2.0", id: 21, method: "textDocument/inlayHint", params: { textDocument: { uri: mainUri }, range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } } } });
  const inlayHints = await waitFor((message) => message.id === 21);
  const typeHints = inlayHints.result as Array<{ position: { line: number; character: number }; label: string; kind: number; paddingRight: boolean }>;
  assert.ok(typeHints.some((hint) => hint.position.line === 1 && hint.label === ": string"));
  assert.ok(typeHints.some((hint) => hint.position.line === 6 && hint.label === ": number"));
  assert.ok(typeHints.some((hint) => hint.position.line === 7 && hint.label === ": number"));
  assert.ok(!typeHints.some((hint) => hint.position.line === 2), "explicit annotations must not receive duplicate hints");
  assert.ok(!typeHints.some((hint) => hint.position.line === 8), "resource handle types must not masquerade as source annotations");
  send({ jsonrpc: "2.0", id: 31, method: "textDocument/semanticTokens/full", params: { textDocument: { uri: mainUri } } });
  const semanticTokens = await waitFor((message) => message.id === 31);
  const semanticData = (semanticTokens.result as { data: number[] }).data;
  assert.equal(semanticData.length % 5, 0);
  const decodedTokens: Array<{ text: string; type: number; modifiers: number }> = [];
  let semanticLine = 0;
  let semanticCharacter = 0;
  for (let index = 0; index < semanticData.length; index += 5) {
    const deltaLine = semanticData[index]!;
    semanticLine += deltaLine;
    semanticCharacter = deltaLine === 0 ? semanticCharacter + semanticData[index + 1]! : semanticData[index + 1]!;
    decodedTokens.push({
      text: mainText.split("\n")[semanticLine]!.slice(semanticCharacter, semanticCharacter + semanticData[index + 2]!),
      type: semanticData[index + 3]!,
      modifiers: semanticData[index + 4]!,
    });
  }
  assert.ok(decodedTokens.some((token) => token.text === "Summary" && token.type === 4 && token.modifiers === 0b1001));
  assert.ok(decodedTokens.some((token) => token.text === "count" && token.type === 7 && token.modifiers === 0b1001));
  assert.ok(decodedTokens.some((token) => token.text === "doubled" && token.type === 7 && token.modifiers === 0b1011));
  assert.ok(decodedTokens.some((token) => token.text === "remote" && token.type === 7 && token.modifiers === 0b1011));
  assert.ok(decodedTokens.some((token) => token.text === "label" && token.type === 7 && (token.modifiers & 3) === 3));
  assert.ok(decodedTokens.some((token) => token.text === "loading" && token.type === 6));
  assert.ok(decodedTokens.some((token) => token.text === "reload" && token.type === 5));
  send({ jsonrpc: "2.0", id: 25, method: "textDocument/completion", params: { textDocument: { uri: mainUri }, position: { line: 9, character: mainText.split("\n")[9]!.indexOf("doubled") } } });
  const semanticCompletion = await waitFor((message) => message.id === 25);
  const semanticItems = (semanticCompletion.result as { items: Array<{ label: string; kind: number; detail?: string; documentation?: { value?: string } }> }).items;
  assert.ok(semanticItems.some((item) => item.label === "count" && item.kind === 6 && item.detail === "number"));
  assert.ok(semanticItems.some((item) => item.label === "doubled" && item.kind === 6 && item.detail === "number"));
  assert.ok(semanticItems.some((item) => item.label === "Summary" && item.kind === 7));
  assert.ok(semanticItems.some((item) => item.label === "greet" && item.kind === 6
    && /Greets one visible user/u.test(item.documentation?.value ?? "")));
  const remoteMemberColumn = mainText.split("\n")[9]!.indexOf("remote.loading") + "remote.".length;
  send({ jsonrpc: "2.0", id: 26, method: "textDocument/completion", params: { textDocument: { uri: mainUri }, position: { line: 9, character: remoteMemberColumn } } });
  const memberCompletion = await waitFor((message) => message.id === 26);
  const memberItems = (memberCompletion.result as { items: Array<{ label: string; kind: number; detail?: string }> }).items;
  assert.ok(memberItems.some((item) => item.label === "value" && item.kind === 5 && item.detail === "string?"));
  assert.ok(memberItems.some((item) => item.label === "loading" && item.kind === 5 && item.detail === "bool"));
  assert.ok(memberItems.some((item) => item.label === "reload" && item.kind === 2 && item.detail === "() -> Promise<null>"));
  const reloadCallColumn = mainText.split("\n")[9]!.indexOf("remote.reload(") + "remote.reload(".length;
  send({ jsonrpc: "2.0", id: 27, method: "textDocument/signatureHelp", params: { textDocument: { uri: mainUri }, position: { line: 9, character: reloadCallColumn } } });
  const memberSignature = await waitFor((message) => message.id === 27);
  assert.deepEqual(memberSignature.result, {
    signatures: [{ label: "reload() -> Promise<null>" }],
    activeSignature: 0,
    activeParameter: 0,
  });
  send({ jsonrpc: "2.0", id: 28, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 9, character: remoteMemberColumn } } });
  const memberHover = await waitFor((message) => message.id === 28);
  assert.match(JSON.stringify(memberHover.result), /field remote\.loading|field loading: bool/u);

  const recordRenameText = [
    "type User:",
    "    name: string",
    "def make(name: string) -> User:",
    "    return {name}",
    "const user = make(\"Ada\")",
    "print(user.name)",
    "",
  ].join("\n");
  send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: mainUri, version: 2 },
      contentChanges: [{ text: recordRenameText }],
    },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === mainUri
    && (message.params as { version?: number }).version === 2);
  send({ jsonrpc: "2.0", id: 29, method: "textDocument/rename", params: { textDocument: { uri: mainUri }, position: { line: 1, character: 5 }, newName: "fullName" } });
  const recordRename = await waitFor((message) => message.id === 29);
  const recordChanges = (recordRename.result as { changes: Record<string, Array<{ newText: string }>> }).changes[mainUri] ?? [];
  assert.equal(recordChanges.length, 3);
  assert.equal(recordChanges.filter((edit) => edit.newText === "fullName").length, 2);
  assert.equal(recordChanges.filter((edit) => edit.newText === "fullName: name").length, 1);

  const referenceHeavyText = `const value = 1\n${"print(value)\n".repeat(10_050)}`;
  send({
    jsonrpc: "2.0",
    method: "textDocument/didChange",
    params: {
      textDocument: { uri: mainUri, version: 3 },
      contentChanges: [{ text: referenceHeavyText }],
    },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string; version?: number }).uri === mainUri
    && (message.params as { version?: number }).version === 3);
  send({ jsonrpc: "2.0", id: 23, method: "textDocument/references", params: { textDocument: { uri: mainUri }, position: { line: 0, character: 7 }, context: { includeDeclaration: true } } });
  const boundedReferences = await waitFor((message) => message.id === 23);
  assert.equal((boundedReferences.result as unknown[]).length, 10_000);
  send({ jsonrpc: "2.0", id: 24, method: "textDocument/rename", params: { textDocument: { uri: mainUri }, position: { line: 0, character: 7 }, newName: "nextValue" } });
  const boundedRename = await waitFor((message) => message.id === 24);
  assert.match(String((boundedRename.error as { message?: string }).message), /more than 10000 locations/u);

  const foreignUri = pathToFileURL(join(directory, "feature.ts")).href;
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: foreignUri, languageId: "typescript", version: 1, text: "const value: number = 1\n" } },
  });
  const foreignPublished = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === foreignUri);
  assert.deepEqual((foreignPublished.params as { diagnostics: unknown[] }).diagnostics, []);
  send({ jsonrpc: "2.0", id: 1200, method: "textDocument/hover", params: { textDocument: { uri: foreignUri }, position: { line: 0, character: 6 } } });
  assert.equal((await waitFor((message) => message.id === 1200)).result, null);
  send({ jsonrpc: "2.0", id: 1201, method: "textDocument/completion", params: { textDocument: { uri: foreignUri }, position: { line: 0, character: 6 } } });
  assert.deepEqual((await waitFor((message) => message.id === 1201)).result, { isIncomplete: false, items: [] });
  send({ jsonrpc: "2.0", id: 1202, method: "textDocument/formatting", params: { textDocument: { uri: foreignUri }, options: { tabSize: 2, insertSpaces: true } } });
  assert.deepEqual((await waitFor((message) => message.id === 1202)).result, []);

  send({ jsonrpc: "2.0", id: 9, method: "shutdown", params: null });
  await waitFor((message) => message.id === 9);
  send({ jsonrpc: "2.0", id: 10, method: "textDocument/hover", params: { textDocument: { uri: mainUri }, position: { line: 0, character: 0 } } });
  const shuttingDown = await waitFor((message) => message.id === 10);
  assert.equal((shuttingDown.error as { code: number }).code, -32600);
  send({ jsonrpc: "2.0", method: "exit", params: null });
  child.stdin.end();
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0);
});
