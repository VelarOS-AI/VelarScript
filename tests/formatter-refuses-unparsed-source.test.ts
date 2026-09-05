import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatSource, formatSourceResult } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 0.28.0 I-D1: `velar format` must not write back source `velar check`
// refuses to parse.
//
// The formatter is token-level by design -- that is what lets it lay out
// comments, strings, and extension-owned embeddings without a program -- and
// the price is that it has an answer for source that is not a program. JSX the
// active extensions cannot see is the shape that makes the price visible: `<`
// and `>` lex as comparison operators, so `<p title="t">{userId}</p>` is
// rewritten as arithmetic and saved. The file the author wrote is gone, and
// nothing in the command said so.
//
// The refusal is one rule stated once, in `formatSource` itself, because every
// writer passes through it: the CLI, the language server's formatting request,
// and the repository's own `check:format` gate. A source whose lexer or parser
// reports a diagnostic it did not recover from is answered unchanged, and the
// caller reports the diagnostic. Recovered guidance -- a `!` the parser
// rewrote to `not` -- left the parse holding a program and still formats.
//
// The one refinement the rule needs is the formatter's own contract: it owns
// whitespace, and tab indentation is a refusal (VEL1002) that formatting
// itself repairs. So the question is asked twice -- the source, then the
// formatter's result -- and the file is left alone only when the second answer
// is a refusal too. That needs no roster of which diagnostics the formatter is
// able to fix, which is what keeps this one rule rather than two.

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

/** The ledger's own probe: a Web module formatted with no project around it. */
const jsxProbe = 'export component Panel(userId: string):\n    return <p title="t">{userId}</p>\n';

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

function runCli(cwd: string, arguments_: readonly string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

// ---------------------------------------------------------------------------
// The formatter itself
// ---------------------------------------------------------------------------

test("[I-D1] a source the parser refuses comes back unchanged, with the diagnostic that refused it", () => {
  const result = formatSourceResult(jsxProbe);
  assert.equal(result.text, jsxProbe);
  assert.equal(result.blocked?.code, "VEL2026");
  assert.match(result.blocked?.message ?? "", /Unknown declaration keyword 'component'/u);
});

test("[I-D1] the bare token formatter is unchanged, which is why the refusal lives at the writer", () => {
  // `formatSource` is what lays out a fragment, an unfinished line, and source
  // no loaded extension claims -- and this is exactly the layout it produces
  // for markup it cannot see. Guarding inside it would take that away from
  // every caller that only wants a layout; guarding the writer's call takes it
  // away from nobody and still leaves no path to a file on disk.
  assert.equal(formatSource(jsxProbe), 'export component Panel(userId: string):\n    return < p title = "t" > {userId} < / p >\n');
});

test("[I-D1] the same source formats once the extension that owns its syntax is loaded", () => {
  // The defect was never "JSX cannot be formatted"; it was "the formatter
  // answered a question it had no program for". With the Web extension the
  // parse succeeds and the markup is laid out as markup.
  const result = formatSourceResult(jsxProbe, { extensions: [webCompilerExtension] });
  assert.equal(result.blocked, null);
  assert.equal(result.text, jsxProbe);
});

test("[I-D1] a source that parses formats exactly as before", () => {
  const result = formatSourceResult("const  active =  1\nprint(f\"{active}\")\n");
  assert.equal(result.blocked, null);
  assert.equal(result.text, "const active = 1\nprint(f\"{active}\")\n");
});

test("[I-D1] recovered guidance is not a refusal, so the file still formats", () => {
  // `!` is rewritten to `not` and the parse continues with a program in hand.
  // A file whose only diagnostics are guidance is a file the author is already
  // being told about; it is not a file the formatter must leave alone.
  const guided = "let active = false\nactive=! active\nprint(f\"{active}\")\n";
  const result = formatSourceResult(guided);
  assert.equal(result.blocked, null);
  assert.equal(result.text, "let active = false\nactive = ! active\nprint(f\"{active}\")\n");
});

test("[I-D1] whitespace the formatter owns is not a refusal", () => {
  // A tab-indented module is refused by the lexer (VEL1002) and is exactly the
  // file `velar format` exists to correct, so "does not parse" cannot be the
  // whole question. The formatter formats, asks again, and keeps its result
  // because the result parses -- which is how the rule needs no roster of
  // which diagnostics the formatter is able to fix.
  const tabbed = "def greet():\n\tprint(\"hi\")\n";
  const result = formatSourceResult(tabbed);
  assert.equal(result.blocked, null);
  assert.equal(result.text, "def greet(): print(\"hi\")\n");
});

test("[I-D1] a syntax error the formatter cannot fix survives its own rewrite and is refused", () => {
  // The other side of the same question: reformatting changes nothing about a
  // chain the language refuses, so the second answer is the first one again.
  const chained = "const chained = value < Other > limit\n";
  const result = formatSourceResult(chained);
  assert.equal(result.text, chained);
  assert.equal(result.blocked?.code, "VEL2031");
});

// ---------------------------------------------------------------------------
// `velar format`
// ---------------------------------------------------------------------------

test("[I-D1] velar format refuses an unparsed file, leaves its bytes, and exits non-zero", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-format-unparsed-"));
  try {
    // No `velar.json` here or above it, which is the ledger's probe exactly:
    // the difference between the corrupting run and the correct one was only
    // ever whether the Web extension was loaded.
    await writeTree(root, { "j.vel": jsxProbe });
    const executed = runCli(root, ["format", join(root, "j.vel")]);
    assert.equal(executed.status, 1);
    assert.match(executed.stderr, /does not parse, so it was left unchanged; fix the syntax first/u);
    assert.match(executed.stderr, /error VEL2026: Unknown declaration keyword 'component'/u);
    assert.equal(executed.stdout, "");
    assert.equal(await readFile(join(root, "j.vel"), "utf8"), jsxProbe);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[I-D1] velar format --check reports the parse error rather than a formatting difference", async () => {
  // The check gate's answer has to name the cause. "is not formatted" would
  // send the author to reformat a file that cannot be parsed, and the reformat
  // is exactly the write this item forbids.
  const root = await mkdtemp(join(tmpdir(), "velar-format-check-unparsed-"));
  try {
    await writeTree(root, { "j.vel": jsxProbe });
    const executed = runCli(root, ["format", "--check", join(root, "j.vel")]);
    assert.equal(executed.status, 1);
    assert.match(executed.stderr, /does not parse, so it was left unchanged/u);
    assert.match(executed.stderr, /error VEL2026:/u);
    assert.doesNotMatch(executed.stderr, /is not formatted/u);
    assert.equal(await readFile(join(root, "j.vel"), "utf8"), jsxProbe);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[I-D1] a project whose extensions own the syntax still formats every file", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-format-project-"));
  try {
    await writeTree(root, {
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        kind: "application",
        entry: "src/main.vel",
        outDir: "dist",
        extensions: ["@velarscript/web"],
      })}\n`,
      "src/main.vel": 'component Panel(userId: string):\n    return <p title="t">{userId}</p>\n\nmount(<Panel userId="1"/>)\n',
    });
    const executed = runCli(root, ["format", root]);
    assert.equal(executed.status, 0, executed.stderr);
    assert.match(executed.stdout, /VelarScript source file/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[I-D1] a formatted project file keeps its bytes when the file already parses and is canonical", async () => {
  const root = await mkdtemp(join(tmpdir(), "velar-format-stable-"));
  try {
    const source = 'const active = 1\nprint(f"{active}")\n';
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", outDir: "dist" })}\n`,
      "main.vel": source,
    });
    const executed = runCli(root, ["format", "--check", root]);
    assert.equal(executed.status, 0, executed.stderr);
    assert.equal(await readFile(join(root, "main.vel"), "utf8"), source);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The language server
// ---------------------------------------------------------------------------

test("[I-D1] the language server offers no formatting edits for a document that does not parse", async (context: TestContext) => {
  // Format-on-save is the reach that makes this a data-loss shape rather than
  // a command-line annoyance: the editor already shows the parse diagnostic,
  // and the one thing it must not do is rewrite the buffer underneath it.
  const root = await mkdtemp(join(tmpdir(), "velar-lsp-format-unparsed-"));
  await writeTree(root, {
    "main.vel": jsxProbe,
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel" })}\n`,
  });

  const child = spawn(process.execPath, [cliPath, "lsp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  context.after(async () => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
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

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href, capabilities: {} } });
  await waitFor((message) => message.id === 1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  const uri = pathToFileURL(join(root, "main.vel")).href;
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "velar", version: 1, text: jsxProbe } },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === uri);

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/formatting",
    params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
  });
  assert.deepEqual((await waitFor((message) => message.id === 2)).result, []);

  send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null });
  await waitFor((message) => message.id === 3);
  send({ jsonrpc: "2.0", method: "exit", params: null });
});
