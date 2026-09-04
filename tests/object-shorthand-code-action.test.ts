import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyMechanicalFixes, compile, formatSource } from "@velarscript/compiler";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

const source = [
  "const id = 7",
  'const channel = "events"',
  "const payload = {",
  "    id: id,",
  "    channel:",
  "        channel,",
  "}",
  "print(payload.id)",
  "",
].join("\n");

test("A15 shortens same-name identifier fields and the shared fix engine applies all entries", () => {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.code, null, "a canonical-form advisory must not block emission");
  assert.deepEqual(result.advisories.map((item) => item.code), ["A15", "A15"]);
  assert.deepEqual(
    result.advisories.map((item) => source.slice(item.span.start, item.span.end)),
    ["id: id", "channel:\n        channel"],
  );
  assert.deepEqual(result.advisories.map((item) => item.fix?.title), [
    "Use object shorthand 'id'",
    "Use object shorthand 'channel'",
  ]);

  const fixed = applyMechanicalFixes(source, result.advisories);
  const expected = [
    "const id = 7",
    'const channel = "events"',
    "const payload = {",
    "    id,",
    "    channel,",
    "}",
    "print(payload.id)",
    "",
  ].join("\n");
  assert.equal(fixed.text, expected);
  assert.equal(formatSource(fixed.text), expected);
  assert.deepEqual(compile(fixed.text).advisories, []);
  assert.equal(applyMechanicalFixes(fixed.text, compile(fixed.text).advisories).applied.length, 0);
});

test("A15 keeps comments and surrounding object layout byte-for-byte", () => {
  const commented = [
    "const id = 7",
    'const channel = "events"',
    "const values = [",
    "    {id /* key stays explicit */: id},",
    "    {channel: /* value stays explicit */ channel},",
    "    {id: // explanation stays with the mapping",
    "        id},",
    "    {id: id}, // trailing comment survives the entry rewrite",
    "]",
    "print(values.size)",
    "",
  ].join("\n");
  const result = compile(commented);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A15", "A15", "A15", "A15"]);
  assert.deepEqual(result.advisories.map((item) => item.fix !== undefined), [false, false, false, true]);
  const fixed = applyMechanicalFixes(commented, result.advisories);
  assert.equal(fixed.text, commented.replace("    {id: id}, // trailing", "    {id}, // trailing"));
  assert.match(fixed.text, /id \/\* key stays explicit \*\/: id/u);
  assert.match(fixed.text, /channel: \/\* value stays explicit \*\/ channel/u);
  assert.match(fixed.text, /id: \/\/ explanation stays with the mapping\n        id/u);
});

test("A15 excludes every mapping that is not an ordinary same-name identifier pair", () => {
  const result = compile([
    "const id = 7",
    "const other = 8",
    "const row = {id}",
    "def identity(value: number) -> number: return value",
    'const quoted = {"id": id}',
    "const alias = {id: other}",
    "const member = {id: row.id}",
    "const call = {id: identity(id)}",
    "const grouped = {id: (id)}",
    "const alreadyShort = {id}",
    "print(quoted.id + alias.id + member.id + call.id + grouped.id + alreadyShort.id)",
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories, []);
});

test("A15 is suppressible only where the explicit spelling is intentional", () => {
  const intentional = compile([
    "const id = 7",
    "const payload = {id: id} // velar-allow A15: protocol documentation shows both names",
    "print(payload.id)",
    "",
  ].join("\n"));
  assert.deepEqual(intentional.diagnostics, []);
  assert.deepEqual(intentional.advisories, []);

  const stale = compile([
    "const id = 7",
    "const payload = {id} // velar-allow A15: protocol documentation shows both names",
    "print(payload.id)",
    "",
  ].join("\n"));
  assert.ok(stale.diagnostics.some((item) => item.code === "VEL1012" && /A15/u.test(item.message)));
});

test("the language server publishes A15 and offers its single-entry quick fix", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "velar-a15-lsp-"));
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "main.vel"), source, "utf8");
  const uri = pathToFileURL(join(directory, "main.vel")).href;
  const child = spawn(process.execPath, [cliPath, "lsp"], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
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
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for LSP message. stderr: ${String(child.stderr.read() ?? "")}`);
  };

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: pathToFileURL(directory).href, capabilities: {} } });
  await waitFor((message) => message.id === 1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "velar", version: 1, text: source } } });
  const published = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === uri);
  const reported = (published.params as { diagnostics: Array<{ code: string; severity: number; range: unknown }> }).diagnostics;
  const idAdvisory = reported.find((item) => item.code === "A15");
  assert.ok(idAdvisory);
  assert.equal(idAdvisory.severity, 2);

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/codeAction",
    params: { textDocument: { uri }, range: idAdvisory.range, context: { diagnostics: [idAdvisory], only: ["quickfix"] } },
  });
  const actions = (await waitFor((message) => message.id === 2)).result as Array<{
    title: string;
    kind: string;
    isPreferred: boolean;
    edit: { changes: Record<string, Array<{ newText: string }>> };
  }>;
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.title, "Use object shorthand 'id'");
  assert.equal(actions[0]?.kind, "quickfix");
  assert.equal(actions[0]?.isPreferred, true);
  assert.deepEqual(actions[0]?.edit.changes[uri]?.map((edit) => edit.newText), ["id"]);
});
