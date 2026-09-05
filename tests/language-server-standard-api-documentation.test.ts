import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { CompilerExtension, SemanticImport } from "@velarscript/compiler";
import { completionItemsFor } from "../packages/cli/src/language-server.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardImportDocumentation } from "../packages/cli/src/standard-api-documentation.ts";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension as velarDesktopCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarServerCompilerExtension } from "../packages/server/src/compiler.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";
import {
  projectCompletionsAt,
  projectMemberDocumentationAt,
  projectSymbolAt,
} from "../packages/cli/src/project-semantic.ts";

const source = `
import {chunk as split} from "velar/collections"
import * as urls from "velar/url"
import {random} from "velar/random"

const groups = split([1, 2, 3], 2)
const encoded = urls.encode("a b")
const words = Text.words("one two")
const pause = Promise.sleep(1ms)
const label = str(42)
const indexes = range(3)
const parsed = number("42")
const typedNumber: number = 1
const typedPromise: Promise<null> = pause
const values: List<number> = [1, 2, 3]
const page = values.slice(0, 2)
const entries: Map<string, number> = Map()
const found = entries.get("answer")
const stream = random("seed")
const sample = stream.number()

type Getter:
    get: () -> string
    str: () -> string

const ordinary: Getter = {get: () => "plain", str: () => "local"}
const plain = ordinary.get()
const localLabel = ordinary.str()

type RuntimePromise:
    sleep: () -> null

type Runtime:
    Promise: RuntimePromise

const runtime: Runtime = {Promise: {sleep: () => null}}
runtime.Promise.sleep()
`.trimStart();

async function projectFixture(prefix: string): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const path = join(directory, "main.vel");
  await writeFile(path, source, "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  return { directory, path };
}

function memberOffset(needle: string): number {
  return source.indexOf(needle) + needle.lastIndexOf(".") + 2;
}

function positionAt(text: string, offset: number): { readonly line: number; readonly character: number } {
  const prefix = text.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}

test("standard API documentation follows compiler contracts through aliases, namespaces, and containers", async (context) => {
  const fixture = await projectFixture("velar-standard-api-docs-");
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const project = await compileProject(fixture.path, new Map(), { extensions: [] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

  const splitOffset = source.indexOf("split([") + 1;
  const splitDocumentation = projectSymbolAt(project, fixture.path, splitOffset)?.documentation ?? "";
  assert.match(splitDocumentation, /`velar\/collections` standard contract/u);
  assert.match(splitDocumentation, /import \{chunk as split\} from "velar\/collections"/u);
  assert.match(splitDocumentation, /const result = split\(values, size\)/u);
  assert.match(splitDocumentation, /Checked contract:/u);

  const ordinaryCompletions = projectCompletionsAt(project, fixture.path, source.length);
  assert.match(ordinaryCompletions.find((item) => item.label === "split")?.documentation ?? "", /chunk as split/u);

  const urlDocumentation = projectMemberDocumentationAt(project, fixture.path, memberOffset("urls.encode")) ?? "";
  assert.match(urlDocumentation, /import \* as urls from "velar\/url"/u);
  assert.match(urlDocumentation, /urls\.encode\(value\)/u);
  const urlCompletions = projectCompletionsAt(project, fixture.path, source.indexOf("urls.encode") + "urls.".length);
  assert.match(urlCompletions.find((item) => item.label === "encode")?.documentation ?? "", /import \* as urls/u);

  const wordsDocumentation = projectMemberDocumentationAt(project, fixture.path, memberOffset("Text.words")) ?? "";
  assert.match(wordsDocumentation, /`Text\.words`/u);
  assert.match(wordsDocumentation, /`velar\/text` standard contract/u);
  assert.match(wordsDocumentation, /Text\.words\(value\)/u);
  const textCompletions = projectCompletionsAt(project, fixture.path, source.indexOf("Text.words") + "Text.".length);
  assert.match(textCompletions.find((item) => item.label === "words")?.documentation ?? "", /Text\.words/u);

  const sleepDocumentation = projectMemberDocumentationAt(project, fixture.path, memberOffset("Promise.sleep")) ?? "";
  assert.match(sleepDocumentation, /`Promise\.sleep`/u);
  assert.match(sleepDocumentation, /await Promise\.sleep\(duration\)/u);
  const promiseCompletions = projectCompletionsAt(project, fixture.path, source.indexOf("Promise.sleep") + "Promise.".length);
  assert.match(promiseCompletions.find((item) => item.label === "sleep")?.documentation ?? "", /Promise\.sleep/u);

  const sliceDocumentation = projectMemberDocumentationAt(project, fixture.path, memberOffset("values.slice")) ?? "";
  assert.match(sliceDocumentation, /`List\.slice` is a compiler-checked List member/u);
  assert.match(sliceDocumentation, /values\.slice\(start, end\)/u);

  const getDocumentation = projectMemberDocumentationAt(project, fixture.path, memberOffset("entries.get")) ?? "";
  assert.match(getDocumentation, /`Map\.get` is a compiler-checked Map member/u);
  assert.match(getDocumentation, /values\.get\(key\)/u);

  const sliceCompletions = projectCompletionsAt(project, fixture.path, source.indexOf("values.slice") + "values.".length);
  assert.match(sliceCompletions.find((item) => item.label === "slice")?.documentation ?? "", /List\.slice/u);
  const mapCompletions = projectCompletionsAt(project, fixture.path, source.indexOf("entries.get") + "entries.".length);
  assert.match(mapCompletions.find((item) => item.label === "get")?.documentation ?? "", /Map\.get/u);

  const randomDocumentation = projectMemberDocumentationAt(project, fixture.path, memberOffset("stream.number")) ?? "";
  assert.match(randomDocumentation, /`Random\.number`/u);
  assert.match(randomDocumentation, /def use\(value: Random\):/u);
  assert.match(randomDocumentation, /value\.number\(\)/u);
  assert.doesNotMatch(randomDocumentation, /random\.number/u);
  const randomCompletions = projectCompletionsAt(project, fixture.path, source.indexOf("stream.number") + "stream.".length);
  const randomCompletionDocumentation = randomCompletions.find((item) => item.label === "number")?.documentation ?? "";
  assert.match(randomCompletionDocumentation, /`Random\.number`/u);
  assert.match(randomCompletionDocumentation, /value\.number\(\)/u);

  assert.equal(projectMemberDocumentationAt(project, fixture.path, memberOffset("ordinary.get")), null);
  assert.equal(projectMemberDocumentationAt(project, fixture.path, memberOffset("runtime.Promise.sleep")), null);
  const customPromiseCompletions = projectCompletionsAt(
    project,
    fixture.path,
    source.indexOf("runtime.Promise.sleep") + "runtime.Promise.".length,
  );
  assert.equal(customPromiseCompletions.find((item) => item.label === "sleep")?.documentation, undefined);

  for (const name of ["str", "print", "equals", "range"] as const) {
    const documentation = completionItemsFor(project).find((item) => item.label === name)?.documentation ?? "";
    assert.match(documentation, new RegExp(`\\b${name}\\(`, "u"));
    assert.match(documentation, /needs no import/u);
  }
});

test("target-owned standard modules use the active extension contract for documentation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-api-docs-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "main.vel");
  const nodeSource = [
    'import {readText as read} from "velar/fs"',
    'const pending = read("notes.txt")',
    "",
  ].join("\n");
  await writeFile(path, nodeSource, "utf8");
  const project = await compileProject(path, new Map(), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const documentation = projectSymbolAt(project, path, nodeSource.indexOf("read(\"") + 1)?.documentation ?? "";
  assert.match(documentation, /`velar\/fs` standard contract/u);
  assert.match(documentation, /import \{readText as read\} from "velar\/fs"/u);
  assert.match(documentation, /read\(path, maxBytes\)/u);
  assert.match(projectCompletionsAt(project, path, nodeSource.length).find((item) => item.label === "read")?.documentation ?? "", /readText as read/u);
});

test("every current standard-module export receives derived documentation", () => {
  const targets: readonly (readonly [string, readonly CompilerExtension[]])[] = [
    ["core+node", [velarNodeCompilerExtension]],
    ["web", [velarWebCompilerExtension]],
    ["server", [velarServerCompilerExtension]],
    ["desktop", [velarDesktopCompilerExtension]],
  ];
  for (const [target, extensions] of targets) {
    for (const [module, interface_] of standardModuleInterfaces(extensions)) {
      for (const name of interface_.exports.keys()) {
        const imported = {
          source: module,
          imported: name,
          importedSpan: { start: 0, end: name.length },
          local: name,
          localSpan: { start: 0, end: name.length },
          localSymbolId: `test:${target}:${module}:${name}`,
          namespace: false,
        } satisfies SemanticImport;
        assert.ok(
          standardImportDocumentation(imported, extensions),
          `missing ${target} editor documentation for ${module}.${name}`,
        );
      }
    }
  }
});

test("the language server transports standard API usage as Markdown", { timeout: 30_000 }, async (context) => {
  const fixture = await projectFixture("velar-standard-api-lsp-");
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(() => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
  });

  let buffered = Buffer.alloc(0);
  const messages: Array<Record<string, unknown>> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const size = Number(/Content-Length:\s*(\d+)/iu.exec(buffered.subarray(0, boundary).toString("ascii"))?.[1]);
      const end = boundary + 4 + size;
      if (!Number.isSafeInteger(size) || buffered.length < end) return;
      messages.push(JSON.parse(buffered.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      buffered = buffered.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = async (id: number): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const result = messages.find((message) => message.id === id);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for LSP response ${id}: ${String(child.stderr.read() ?? "")}`);
  };

  const uri = pathToFileURL(fixture.path).href;
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(fixture.directory).href, capabilities: {} } });
  await waitFor(1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "velar", version: 1, text: source } },
  });

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: positionAt(source, source.indexOf("Promise.sleep") + "Promise.s".length) },
  });
  const hover = await waitFor(2);
  const hoverContents = (hover.result as { contents: { kind: string; value: string } }).contents;
  assert.equal(hoverContents.kind, "markdown");
  assert.match(hoverContents.value, /`Promise\.sleep`/u);
  assert.match(hoverContents.value, /```velar/u);
  assert.match(hoverContents.value, /await Promise\.sleep\(duration\)/u);

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "textDocument/completion",
    params: { textDocument: { uri }, position: positionAt(source, source.indexOf("const values")) },
  });
  const completion = await waitFor(3);
  const completionItems = (completion.result as { items: Array<{ label: string; documentation?: { kind: string; value: string } }> }).items;
  const strItem = completionItems.find((item) => item.label === "str");
  assert.equal(strItem?.documentation?.kind, "markdown");
  assert.match(strItem?.documentation?.value ?? "", /const result = str\(value\)/u);
  const splitItem = completionItems.find((item) => item.label === "split");
  assert.equal(splitItem?.documentation?.kind, "markdown");
  assert.match(splitItem?.documentation?.value ?? "", /chunk as split/u);

  for (const [id, name] of [[4, "str"], [5, "range"]] as const) {
    send({
      jsonrpc: "2.0",
      id,
      method: "textDocument/hover",
      params: { textDocument: { uri }, position: positionAt(source, source.indexOf(`${name}(`) + 1) },
    });
    const response = await waitFor(id);
    const contents = (response.result as { contents: { kind: string; value: string } }).contents;
    assert.equal(contents.kind, "markdown");
    assert.match(contents.value, /compiler-owned VelarScript prelude API/u);
    assert.match(contents.value, new RegExp(`const result = ${name}\\(`, "u"));
  }

  send({
    jsonrpc: "2.0",
    id: 6,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: positionAt(source, memberOffset("ordinary.str")) },
  });
  const localStrHover = await waitFor(6);
  const localStrText = (localStrHover.result as { contents: { value: string } }).contents.value;
  assert.match(localStrText, /str: \(\) -> string/u);
  assert.doesNotMatch(localStrText, /compiler-owned VelarScript prelude API/u);

  send({
    jsonrpc: "2.0",
    id: 7,
    method: "textDocument/completion",
    params: { textDocument: { uri }, position: positionAt(source, source.indexOf("Promise.sleep") + "Promise.".length) },
  });
  const promiseCompletion = await waitFor(7);
  const sleepItem = (promiseCompletion.result as { items: Array<{ label: string; documentation?: { kind: string; value: string } }> }).items
    .find((item) => item.label === "sleep");
  assert.equal(sleepItem?.documentation?.kind, "markdown");
  assert.match(sleepItem?.documentation?.value ?? "", /await Promise\.sleep\(duration\)/u);

  send({
    jsonrpc: "2.0",
    id: 8,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: positionAt(source, source.indexOf("split([") + 1) },
  });
  const aliasHover = await waitFor(8);
  const aliasContents = (aliasHover.result as { contents: { kind: string; value: string } }).contents;
  assert.equal(aliasContents.kind, "markdown");
  assert.match(aliasContents.value, /import \{chunk as split\}/u);

  send({
    jsonrpc: "2.0",
    id: 9,
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: positionAt(source, source.indexOf('number("42")') + 1) },
  });
  const numberCallHover = await waitFor(9);
  const numberCallText = (numberCallHover.result as { contents: { value: string } }).contents.value;
  assert.match(numberCallText, /compiler-owned VelarScript prelude API/u);
  assert.match(numberCallText, /const result = number\(text\)/u);

  for (const [id, needle, builtin] of [
    [10, "typedNumber: number", "A JavaScript number type"],
    [11, "typedPromise: Promise", "A JavaScript Promise"],
  ] as const) {
    const word = needle.slice(needle.lastIndexOf(" ") + 1);
    send({
      jsonrpc: "2.0",
      id,
      method: "textDocument/hover",
      params: { textDocument: { uri }, position: positionAt(source, source.indexOf(needle) + needle.lastIndexOf(word) + 1) },
    });
    const response = await waitFor(id);
    const value = (response.result as { contents: { value: string } }).contents.value;
    assert.match(value, new RegExp(builtin, "u"));
    assert.doesNotMatch(value, /prelude API|permanent namespace/u);
  }
});
