import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

test("the bundled LSP publishes source-package project findings for secondary entries", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "velar-source-package-lsp-"));
  const worker = join(root, "src", "worker.vel");
  const workerSource = "export const value = 2\n\n@main: pass\n";
  const write = async (path: string, source: string): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
  };
  await write(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: 2,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
  })}\n`);
  await write(join(root, "package.json"), `${JSON.stringify({
    name: "lsp-source-package",
    exports: { ".": "./dist/index.js", "./worker": "./dist/worker.js" },
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  })}\n`);
  await write(join(root, "src", "index.vel"), "export const value = 1\n");
  await write(worker, workerSource);

  const child = spawn(process.execPath, [cli, "lsp"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  context.after(async () => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  });
  let buffered = Buffer.alloc(0);
  let stderr = "";
  const messages: Array<Record<string, unknown>> = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const boundary = buffered.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const header = buffered.subarray(0, boundary).toString("ascii");
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match) throw new Error("Language server emitted an invalid frame");
      const end = boundary + 4 + Number(match[1]);
      if (buffered.length < end) return;
      messages.push(JSON.parse(buffered.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      buffered = buffered.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      if (child.exitCode !== null) throw new Error(`Language server exited ${child.exitCode}: ${stderr}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Timed out waiting for source-package diagnostics: ${stderr}`);
  };

  const workerUri = pathToFileURL(worker).href;
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { rootUri: pathToFileURL(root).href, capabilities: {} },
  });
  await waitFor((message) => message.id === 1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: workerUri, languageId: "velar", version: 1, text: workerSource } },
  });
  const publication = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { readonly uri?: unknown } | undefined)?.uri === workerUri);
  const diagnostics = (publication.params as { readonly diagnostics: Array<{ readonly code?: unknown; readonly message?: unknown }> }).diagnostics;
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "VEL9001"
    && typeof diagnostic.message === "string"
    && diagnostic.message.includes("A library entry cannot declare '@main'")));
});
