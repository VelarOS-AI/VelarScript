import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { compile, inspectModule } from "../packages/compiler/src/index.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectSemanticTokens } from "../packages/cli/src/project-semantic.ts";

const source = [
  "const captured = 1",
  "extern js(captured: number)`",
  "    export function create(input) {",
  "        const surfaces = new WeakSet()",
  "        return surfaces.has(input) ? new TypeError(String(captured)) : null",
  "    }",
  "`:",
  "    export def create(input: unknown) -> unknown",
  "",
  "unsafe js`",
  "    export class Registry {",
  "        static total = 0",
  "        static add(value) {",
  "            let changed = value",
  "            return Registry.total + (Number.isFinite(changed) ? 1 : 0)",
  "        }",
  "        get size() { return this.items.length }",
  "    }",
  "`",
  "",
].join("\n");

test("embedded JavaScript editor tokens retain Acorn roles and absolute .vel spans", async () => {
  const path = join(tmpdir(), `velar-embedded-js-semantic-${process.pid}.vel`);
  const compiled = compile(source, { path });
  assert.deepEqual(compiled.diagnostics, []);

  const tokens = compiled.embeddedJavaScriptTokens;
  const presented = tokens.map((token) => [
    source.slice(token.span.start, token.span.end),
    token.type,
    token.modifiers,
  ]);
  assert.deepEqual(presented, [
    ["create", "function", ["declaration"]],
    ["input", "parameter", ["declaration"]],
    ["surfaces", "variable", ["declaration", "readonly"]],
    ["WeakSet", "class", []],
    ["surfaces", "variable", ["readonly"]],
    ["has", "method", []],
    ["input", "parameter", []],
    ["TypeError", "class", []],
    ["captured", "parameter", []],
    ["Registry", "class", ["declaration"]],
    ["total", "property", ["declaration", "static"]],
    ["add", "method", ["declaration", "static"]],
    ["value", "parameter", ["declaration"]],
    ["changed", "variable", ["declaration"]],
    ["value", "parameter", []],
    ["Registry", "class", []],
    ["total", "property", ["static"]],
    ["isFinite", "method", []],
    ["changed", "variable", []],
    ["size", "property", ["declaration"]],
    ["items", "property", []],
    ["length", "property", []],
  ]);
  assert.ok(tokens.every((token) => token.span.start >= source.indexOf("export function")
    && token.span.end <= source.lastIndexOf("\n`")), "every embedded token uses an absolute span inside a raw JS body");
  assert.ok(!tokens.some((token) => source.slice(token.span.start, token.span.end) === "Number"),
    "an unresolved ordinary global must retain the editor's lexical classification");
  assert.ok(!compiled.semanticIndex.symbols.some((symbol) => symbol.name === "surfaces" || symbol.name === "changed"));
  assert.ok(!compiled.semanticIndex.references.some((reference) => reference.name === "surfaces" || reference.name === "changed"));
  assert.deepEqual(inspectModule(source, { path }).embeddedJavaScriptTokens, tokens,
    "compile and inspection must expose the same token channel from the same parser contract");

  const project = await compileProject(path, new Map([[path, source]]));
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const projectTokens = projectSemanticTokens(project, path);
  for (const token of tokens) {
    assert.deepEqual(
      projectTokens.find((candidate) => candidate.span.start === token.span.start && candidate.span.end === token.span.end),
      token,
    );
  }
  for (let index = 1; index < projectTokens.length; index += 1) {
    assert.ok(projectTokens[index - 1]!.span.end <= projectTokens[index]!.span.start, "semantic tokens must not overlap");
  }
});

test("embedded JavaScript tokens preserve shorthand, class-name, and optional-chain roles", () => {
  const edgeSource = [
    "unsafe js`",
    "    const value = 1",
    "    const output = { value }",
    "    let assigned = 0",
    "    ;({ assigned } = output)",
    "    function C() {}",
    "    const Derived = class C extends C {}",
    "    ;(output?.method)()",
    "    new (output?.Ctor)()",
    "`",
    "",
  ].join("\n");
  const compiled = compile(edgeSource, { path: "/virtual/embedded-js-edge.vel" });
  assert.deepEqual(compiled.diagnostics, []);

  const tokenAt = (offset: number) => compiled.embeddedJavaScriptTokens.find((token) =>
    token.span.start === offset);
  const shorthand = edgeSource.indexOf("value", edgeSource.indexOf("{ value"));
  const assignmentShorthand = edgeSource.indexOf("assigned", edgeSource.indexOf("{ assigned"));
  const heritage = edgeSource.indexOf("C", edgeSource.indexOf("extends"));
  const optionalMethod = edgeSource.indexOf("method");
  const optionalConstructor = edgeSource.indexOf("Ctor");

  assert.equal(tokenAt(shorthand)?.type, "property");
  assert.equal(tokenAt(assignmentShorthand)?.type, "property");
  assert.equal(tokenAt(heritage)?.type, "class");
  assert.equal(tokenAt(optionalMethod)?.type, "method");
  assert.equal(tokenAt(optionalConstructor)?.type, "class");
});

test("velar lsp publishes embedded JavaScript semantic tokens through the standard full request", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-embedded-js-lsp-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  const path = join(directory, "main.vel");
  const uri = pathToFileURL(path).href;
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(path, source, "utf8");

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
      if (boundary < 0) break;
      const match = /Content-Length:\s*(\d+)/iu.exec(output.subarray(0, boundary).toString("ascii"));
      if (!match) break;
      const end = boundary + 4 + Number(match[1]);
      if (output.length < end) break;
      messages.push(JSON.parse(output.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      output = output.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for LSP response. stderr: ${String(child.stderr.read() ?? "")}`);
  };

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(directory).href, capabilities: {} } });
  const initialized = await waitFor((message) => message.id === 1);
  const legend = (initialized.result as {
    capabilities: { semanticTokensProvider: { legend: { tokenTypes: string[]; tokenModifiers: string[] } } };
  }).capabilities.semanticTokensProvider.legend;
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "velar", version: 1, text: source } },
  });
  const diagnostics = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === uri);
  assert.deepEqual((diagnostics.params as { diagnostics: unknown[] }).diagnostics, []);
  send({ jsonrpc: "2.0", id: 2, method: "textDocument/semanticTokens/full", params: { textDocument: { uri } } });
  const response = await waitFor((message) => message.id === 2);
  const decoded = decodeSemanticTokens(source, (response.result as { data: number[] }).data, legend);

  assert.ok(decoded.some((token) => token.text === "WeakSet" && token.type === "class"));
  assert.ok(decoded.some((token) => token.text === "TypeError" && token.type === "class"));
  assert.ok(decoded.some((token) => token.text === "isFinite" && token.type === "method"));
  assert.ok(decoded.some((token) => token.text === "surfaces" && token.type === "variable"
    && token.modifiers.includes("declaration") && token.modifiers.includes("readonly")));
  assert.ok(decoded.some((token) => token.text === "add" && token.type === "method"
    && token.modifiers.includes("declaration") && token.modifiers.includes("static")));
});

function decodeSemanticTokens(
  text: string,
  data: readonly number[],
  legend: { readonly tokenTypes: readonly string[]; readonly tokenModifiers: readonly string[] },
): Array<{ readonly text: string; readonly type: string; readonly modifiers: readonly string[] }> {
  const lines = text.split("\n");
  const decoded: Array<{ text: string; type: string; modifiers: string[] }> = [];
  let line = 0;
  let character = 0;
  for (let index = 0; index < data.length; index += 5) {
    const deltaLine = data[index]!;
    line += deltaLine;
    character = deltaLine === 0 ? character + data[index + 1]! : data[index + 1]!;
    const bits = data[index + 4]!;
    decoded.push({
      text: lines[line]!.slice(character, character + data[index + 2]!),
      type: legend.tokenTypes[data[index + 3]!]!,
      modifiers: legend.tokenModifiers.filter((_modifier, modifier) => (bits & (1 << modifier)) !== 0),
    });
  }
  return decoded;
}
