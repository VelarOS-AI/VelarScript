import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatCheckOutput } from "../packages/cli/src/project-check.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

/**
 * D89 门禁: what a human and a model actually read. The channel and the
 * producers are covered elsewhere; this file covers the surfaces — `velar
 * check`'s exit code and summary line, `velar build` emitting anyway, and the
 * language server's severity and quick fix.
 */
async function reflexProject(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-d89-surfacing-"));
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(directory, "main.vel"), source, "utf8");
  return directory;
}

const advisedSource = [
  "const total = 10",
  "const nums = [1, 2, 3]",
  "const step = total // 2",
  "",
  "for i, v in nums:",
  "    print(f\"{i} {v}\")",
  "",
  "print(str(step))",
  "print(str(-7 % 3))",
  "",
].join("\n");

test("[D89] velar check prints every advisory, names the count, and still passes", async () => {
  const directory = await reflexProject(advisedSource);
  try {
    const checked = spawnSync(process.execPath, [cliPath, "check", directory], { cwd: process.cwd(), encoding: "utf8" });
    // The whole point of the tier: three reports, exit 0. An advisory that
    // reached the exit code would be an error wearing a different label.
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stderr, /advisory A1:/u);
    assert.match(checked.stderr, /advisory A2:/u);
    assert.match(checked.stderr, /advisory A3:/u);
    assert.doesNotMatch(checked.stderr, /error A[0-9]/u);
    // D89 forbids folding the count into a silent pass.
    assert.match(checked.stdout, /Checked 1 module from .* — 3 advisories\n$/u);
    // A failing check would have named the repro command; a passing one must not.
    assert.doesNotMatch(checked.stderr, /velar repro/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D89] a clean project's summary line says nothing about advisories", async () => {
  const directory = await reflexProject("print(\"ready\")\n");
  try {
    const checked = spawnSync(process.execPath, [cliPath, "check", directory], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 1 module from .*\n$/u);
    assert.doesNotMatch(checked.stdout, /advisor/u);
    assert.equal(checked.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D89] velar build reports the advisory and emits anyway", async () => {
  const directory = await reflexProject(advisedSource);
  const output = await mkdtemp(join(tmpdir(), "velar-d89-build-"));
  try {
    const built = spawnSync(process.execPath, [cliPath, "build", directory, "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    assert.match(built.stderr, /advisory A1:/u);
    assert.match(built.stdout, /Built 1 module/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});

test("[D89] a reasoned suppression takes the advisory out of the summary count", async () => {
  const directory = await reflexProject("const total = 10\nconst step = total // 2   // velar-allow A1: 2 is a step number, not a divisor\nprint(str(step))\n");
  try {
    const checked = spawnSync(process.execPath, [cliPath, "check", directory], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(checked.stderr, "");
    assert.doesNotMatch(checked.stdout, /advisor/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D89] a reasonless suppression fails the check, and the advisory it tried to silence still prints", async () => {
  const directory = await reflexProject("const total = 10\nconst step = total // 2   // velar-allow A1\nprint(str(step))\n");
  try {
    const checked = spawnSync(process.execPath, [cliPath, "check", directory], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /error VEL1011:/u);
    assert.match(checked.stderr, /advisory A1:/u);
    // Advisories print above the failures, so a reader sees the advice before
    // the error that stopped the build, and the summary line never ran.
    assert.ok(checked.stderr.indexOf("advisory A1:") < checked.stderr.indexOf("error VEL1011:"));
    assert.equal(checked.stdout, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D89] formatCheckOutput prints notices, then advisories, then errors", () => {
  assert.equal(
    formatCheckOutput({
      project: null as never,
      roots: [],
      compiled: new Set(),
      notices: ["main.vel: notice: a project remark"],
      advisories: ["main.vel:1:1 advisory A1: advice"],
      errors: ["main.vel:2:1 error VEL3001: broken"],
    }),
    "main.vel: notice: a project remark\nmain.vel:1:1 advisory A1: advice\nmain.vel:2:1 error VEL3001: broken\n",
  );
  // A passing check still prints its advisories; only the errors are absent.
  assert.equal(
    formatCheckOutput({
      project: null as never,
      roots: [],
      compiled: new Set(),
      notices: [],
      advisories: ["main.vel:1:1 advisory A1: advice"],
      errors: [],
    }),
    "main.vel:1:1 advisory A1: advice\n",
  );
});

test("[D89] the language server publishes an advisory as a warning and offers its rewrite", async (context) => {
  const directory = await reflexProject(advisedSource);
  context.after(async () => { await rm(directory, { recursive: true, force: true }); });
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
  send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "velar", version: 1, text: advisedSource } } });
  const published = await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === uri);
  const reported = (published.params as { diagnostics: Array<{ code: string; severity: number; range: unknown }> }).diagnostics;
  // Severity 2 is Warning. An advisory shown at severity 1 would claim the
  // file failed, which is the one thing this tier promises never to do.
  assert.deepEqual(reported.map((item) => [item.code, item.severity]).sort(), [["A1", 2], ["A2", 2], ["A3", 2]]);

  const swap = reported.find((item) => item.code === "A2")!;
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/codeAction",
    params: { textDocument: { uri }, range: swap.range, context: { diagnostics: [swap], only: ["quickfix"] } },
  });
  const actions = (await waitFor((message) => message.id === 2)).result as Array<{
    title: string;
    kind: string;
    edit: { changes: Record<string, Array<{ newText: string }>> };
  }>;
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.kind, "quickfix");
  assert.deepEqual(actions[0]?.edit.changes[uri]?.map((edit) => edit.newText), ["v", "i"]);
});
