import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("language server owns versioned ownership graph and emitted JavaScript views", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-language-owner-"));
  const mainPath = join(root, "main.vel");
  const utilityPath = join(root, "utility.vel");
  const mainUri = pathToFileURL(mainPath).href;
  const diskText = [
    'import {monotonic} from "velar/time"',
    'import {double} from "./utility.vel"',
    'const values: readonly List<number> = [1]',
    'const sampledAt = monotonic()',
    '/// Returns the current visible value.',
    'def current() -> number:',
    '    return (values.get(0) ?? 0) + 1',
    'print(current())',
    '',
  ].join("\n");
  const openText = diskText.replace("+ 1", "+ 2");
  await writeFile(join(root, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(mainPath, diskText, "utf8");
  await writeFile(utilityPath, "export def double(value: number) -> number:\n    return value * 2\n", "utf8");

  const packagedEntry = process.env.VELAR_TEST_LANGUAGE_SERVER_ENTRY;
  const child = spawn(process.execPath, packagedEntry ? [packagedEntry] : ["packages/cli/src/cli.ts", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = Buffer.alloc(0);
  let stderr = "";
  const messages: Array<Record<string, unknown>> = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.on("data", (chunk: Buffer) => {
    output = Buffer.concat([output, chunk]);
    while (true) {
      const boundary = output.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const match = /Content-Length:\s*(\d+)/iu.exec(output.subarray(0, boundary).toString("ascii"));
      if (!match) throw new Error("Language server emitted an invalid frame");
      const end = boundary + 4 + Number(match[1]);
      if (output.length < end) return;
      messages.push(JSON.parse(output.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      output = output.subarray(end);
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
    throw new Error(`Timed out waiting for language server: ${stderr}`);
  };

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href, capabilities: {} } });
    const initialize = await waitFor((message) => message.id === 1);
    const velar = ((initialize.result as { capabilities: { experimental: { velar: Record<string, unknown> } } }).capabilities.experimental.velar);
    assert.equal(velar.protocolVersion, 5);
    assert.equal(velar.ownershipGraph, true);
    assert.equal(velar.ownershipGraphPatches, true);
    assert.equal(velar.ownershipGraphAffectedModules, true);
    assert.equal(velar.emittedJavaScript, true);
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    send({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: mainUri, languageId: "velar", version: 2, text: openText } },
    });
    await waitFor((message) => message.method === "textDocument/publishDiagnostics"
      && (message.params as { uri?: string } | undefined)?.uri === mainUri);

    send({
      jsonrpc: "2.0",
      id: 2,
      method: "velar/emittedJavaScript",
      params: { textDocument: { uri: mainUri }, version: 2 },
    });
    const emitted = (await waitFor((message) => message.id === 2)).result as {
      version: number;
      revision: string;
      javascript: string;
      sourceMap: string;
      limitReached: boolean;
      diagnostics: unknown[];
    };
    assert.equal(emitted.version, 2);
    assert.match(emitted.revision, /^[a-f0-9]{64}$/u);
    assert.notEqual(emitted.javascript, null, JSON.stringify(emitted.diagnostics));
    assert.match(emitted.javascript, /\+ 2/u);
    assert.doesNotMatch(emitted.javascript, /\+ 1/u);
    assert.equal(JSON.parse(emitted.sourceMap).version, 3);
    assert.equal(emitted.limitReached, false);
    assert.deepEqual(emitted.diagnostics, []);

    send({
      jsonrpc: "2.0",
      id: 3,
      method: "velar/ownershipGraph",
      params: { textDocument: { uri: mainUri }, version: 2 },
    });
    const graph = (await waitFor((message) => message.id === 3)).result as {
      document: { version: number };
      mode: string;
      revision: string;
      nodes: Array<{ id: string; kind: string; name: string; path?: string; documentation?: string }>;
      edges: Array<{ kind: string; from: string; to: string }>;
      coverage: { modulesIncluded: number; complete: boolean };
      limitReached: boolean;
    };
    assert.equal(graph.document.version, 2);
    assert.equal(graph.mode, "snapshot");
    assert.equal(graph.revision, emitted.revision);
    assert.ok(graph.nodes.some((node) => node.kind === "module"));
    assert.ok(graph.nodes.some((node) => node.kind === "module" && node.path === "main.vel"));
    assert.ok(graph.nodes.some((node) => node.kind === "function" && node.name === "current"));
    assert.equal(
      graph.nodes.find((node) => node.kind === "function" && node.name === "current")?.documentation,
      "Returns the current visible value.",
    );
    assert.ok(graph.nodes.some((node) => node.kind === "readonlyProjection"));
    assert.ok(graph.nodes.some((node) => node.kind === "capability" && node.name === "velar/time"));
    assert.ok(graph.edges.some((edge) => edge.kind === "calls"));
    assert.ok(graph.edges.some((edge) => edge.kind === "crossesCapability"));
    assert.equal(graph.coverage.modulesIncluded, 2);
    assert.equal(graph.coverage.complete, true);
    assert.equal(graph.limitReached, false);

    send({
      jsonrpc: "2.0",
      id: 4,
      method: "velar/ownershipGraph",
      params: { textDocument: { uri: mainUri }, version: 1 },
    });
    const stale = await waitFor((message) => message.id === 4);
    assert.equal((stale.error as { code: number }).code, -32801);

    send({
      jsonrpc: "2.0",
      id: 5,
      method: "velar/ownershipGraph",
      params: { textDocument: { uri: mainUri }, version: 2, maximumNodes: 1, maximumEdges: 1 },
    });
    const bounded = (await waitFor((message) => message.id === 5)).result as { nodes: unknown[]; limitReached: boolean };
    assert.equal(bounded.nodes.length, 1);
    assert.equal(bounded.limitReached, true);

    send({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: { uri: mainUri, version: 3 },
        contentChanges: [{ text: openText.replaceAll("current", "visible") }],
      },
    });
    await waitFor((message) => message.method === "textDocument/publishDiagnostics"
      && (message.params as { uri?: string; version?: number } | undefined)?.uri === mainUri
      && (message.params as { version?: number } | undefined)?.version === 3);
    send({
      jsonrpc: "2.0",
      id: 7,
      method: "velar/ownershipGraph",
      params: { textDocument: { uri: mainUri }, version: 3, previousRevision: graph.revision },
    });
    const patch = (await waitFor((message) => message.id === 7)).result as {
      document: { version: number };
      mode: string;
      baseRevision: string;
      revision: string;
      nodes: Array<{ kind: string; name: string }>;
      removedNodeIds: string[];
      removedEdgeIds: string[];
      activity: { strategy: string; modulesVisited: number };
    };
    assert.equal(patch.document.version, 3);
    assert.equal(patch.mode, "patch");
    assert.equal(patch.baseRevision, graph.revision);
    assert.notEqual(patch.revision, graph.revision);
    assert.ok(patch.nodes.some((node) => node.kind === "function" && node.name === "visible"));
    assert.ok(patch.nodes.length < graph.nodes.length);
    assert.ok(patch.removedNodeIds.length > 0);
    assert.ok(patch.removedEdgeIds.length > 0);
    assert.equal(patch.activity.strategy, "affected-modules");
    assert.equal(patch.activity.modulesVisited, 1);

    send({ jsonrpc: "2.0", id: 6, method: "shutdown", params: null });
    await waitFor((message) => message.id === 6);
    send({ jsonrpc: "2.0", method: "exit", params: null });
    child.stdin.end();
    const exitCode = await new Promise<number | null>((resolveExit) => child.once("exit", resolveExit));
    assert.equal(exitCode, 0, stderr);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
