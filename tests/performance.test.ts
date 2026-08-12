import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { VelarProjectSessions } from "../packages/cli/src/project-session.ts";

test("application-scale incremental budget recompiles only the reverse dependency closure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-scale-"));
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "main.vel"), "import {value} from \"./chain-0.vel\"\nprint(value)\n", "utf8");

  const chainLength = 40;
  for (let index = 0; index < chainLength; index += 1) {
    const source = index === chainLength - 1
      ? "export const value = 1\n"
      : `import {value as next} from "./chain-${index + 1}.vel"\nexport const value = next\n`;
    await writeFile(join(directory, `chain-${index}.vel`), source, "utf8");
  }
  for (let index = 0; index < 80; index += 1) {
    await writeFile(join(directory, `independent-${index}.vel`), `export const value = ${index}\n`, "utf8");
  }

  const sessions = new VelarProjectSessions();
  const mainPath = join(directory, "main.vel");
  const first = await sessions.snapshot(mainPath);
  assert.equal(first.project.stats.moduleCount, 121);
  assert.equal(first.project.stats.compiledModules, 121);
  assert.equal(first.project.stats.reusedModules, 0);
  assert.ok(first.project.stats.durationMs < 5_000, `initial compile took ${first.project.stats.durationMs}ms`);
  assert.equal(first.activity.workspaceScans, 1);
  assert.equal(first.activity.filesRead, 121);

  const unchanged = await sessions.update(mainPath, new Set());
  assert.equal(unchanged.project, first.project);
  assert.deepEqual(unchanged.activity, {
    strategy: "known-changes",
    workspaceScans: 0,
    filesRead: 0,
    projectReused: true,
  });

  const leaf = join(directory, `chain-${chainLength - 1}.vel`);
  await writeFile(leaf, "export const value = 2\n", "utf8");
  const rebuilt = await sessions.update(mainPath, new Set([leaf]));
  assert.deepEqual([...rebuilt.changedPaths], [leaf]);
  assert.equal(rebuilt.activity.workspaceScans, 0);
  assert.equal(rebuilt.activity.filesRead, 1);
  assert.equal(rebuilt.project.stats.compiledModules, 41);
  assert.equal(rebuilt.project.stats.reusedModules, 80);
  assert.equal(rebuilt.project.stats.affectedModules, 41);
  assert.ok(rebuilt.project.stats.durationMs < 2_000, `incremental compile took ${rebuilt.project.stats.durationMs}ms`);
});

test("pure VelarScript script service bounds 1 MiB initial and tail-update work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-script-scale-"));
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(entry, `
import {ScriptDocument, ScriptLanguage} from "velar/javascript"
import {monotonic} from "velar/time"

const source = "const value = 1;\\n" + "value + 1;\\n".repeat(95324)
const initialStart = monotonic()
const service = ScriptDocument(ScriptLanguage.typescript, source)
const initialElapsed = monotonic() - initialStart
const updateStart = monotonic()
const activity = service.apply([{start: source.size, end: source.size, replacement: "// tail\\n"}])
const updateElapsed = monotonic() - updateStart
print(f"{str(source.size)}|{str(service.analysis().tokens.size)}|{str(initialElapsed)}|{str(updateElapsed)}|{str(activity.restartOffset)}|{str(activity.codePointsRead)}|{str(activity.tokensReused)}")
`.trimStart(), "utf8");

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(build.status, 0, String(build.stderr || build.error));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr || execution.error));
  const metrics = execution.stdout.trim().split("|").map(Number);
  assert.equal(metrics.length, 7, `unexpected script performance output: ${execution.stdout}`);
  const [size, tokens, initialElapsed, updateElapsed, restartOffset, codePointsRead, tokensReused] = metrics as [number, number, number, number, number, number, number];
  assert.ok(size >= 1024 * 1024, `script fixture was only ${size} code points`);
  assert.ok(tokens > 300_000);
  assert.ok(initialElapsed < 5_000, `1 MiB script analysis took ${initialElapsed}ms`);
  assert.ok(updateElapsed < 2_000, `1 MiB tail update took ${updateElapsed}ms`);
  assert.equal(restartOffset, size);
  assert.equal(codePointsRead, "// tail\n".length);
  assert.ok(tokensReused > 300_000);
});

test("language server maps 1 MiB script semantic tokens in one bounded coordinate pass", async () => {
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "lsp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0);
  let stderr = "";
  const messages: Array<Record<string, unknown>> = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const match = /Content-Length:\s*(\d+)/iu.exec(buffer.subarray(0, boundary).toString("ascii"));
      if (!match) throw new Error("Language server emitted an invalid frame");
      const end = boundary + 4 + Number(match[1]);
      if (buffer.length < end) return;
      messages.push(JSON.parse(buffer.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      buffer = buffer.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = messages.find(predicate);
      if (message) return message;
      if (child.exitCode !== null) throw new Error(`Language server exited ${child.exitCode}: ${stderr}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    throw new Error(`Language server response exceeded ${timeoutMs}ms: ${stderr}`);
  };
  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { capabilities: { general: { positionEncodings: ["utf-32"] } } } });
    await waitFor((message) => message.id === 1, 10_000);
    send({ jsonrpc: "2.0", method: "initialized", params: {} });
    const text = "const value = 1;\n" + "value + 1;\n".repeat(95_324);
    const uri = pathToFileURL(join(tmpdir(), "velar-script-semantic-scale.ts")).href;
    const openedAt = performance.now();
    send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text } } });
    const diagnostics = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
      && (message.params as { uri?: string } | undefined)?.uri === uri, 10_000);
    assert.deepEqual((diagnostics.params as { diagnostics: unknown[] }).diagnostics, []);
    assert.ok(performance.now() - openedAt < 8_000, "1 MiB script diagnostics exceeded the language-server budget");
    const semanticAt = performance.now();
    send({ jsonrpc: "2.0", id: 2, method: "textDocument/semanticTokens/full", params: { textDocument: { uri } } });
    const semantic = await waitFor((message) => message.id === 2, 4_000);
    const data = (semantic.result as { data: number[] }).data;
    assert.equal(data.length % 5, 0);
    assert.ok(data.length > 30_000 && data.length <= 50_000);
    assert.ok(performance.now() - semanticAt < 2_000, "1 MiB script semantic-token mapping exceeded the linear coordinate budget");
    send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null });
    await waitFor((message) => message.id === 3, 5_000);
    send({ jsonrpc: "2.0", method: "exit", params: null });
    child.stdin.end();
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => rejectExit(new Error("Language server did not exit within 5 seconds")), 5_000);
      child.once("exit", (value) => { clearTimeout(timer); resolveExit(value); });
    });
    assert.equal(code, 0, stderr);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
