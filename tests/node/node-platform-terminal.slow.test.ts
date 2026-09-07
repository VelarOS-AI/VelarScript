import assert from "node:assert/strict";
import { Buffer as NodeBuffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { VELAR_NODE_TERMINAL_INPUT_SOURCE } from "../../packages/node/src/runtime-sources.generated.ts";
import { runProcess } from "../support/node-runtime.ts";

/**
 * D115 §三 — one `velar/*` module per file, split out of the 2,809-line heavy
 * tier `node-platform.slow.test.ts`. Every test here is the one that was
 * there, moved verbatim; the quick-tier core cases D114 GA-U3 lifted out stay
 * in `node-platform.test.ts` and `node-platform-serve.test.ts`.
 *
 * The subject is `velar/terminal`: a close that is final, an oversized queued
 * line that rejects through the Vel promise, the input host's duty to deliver
 * what it queued before it exits, and the worker's cancellation of a pending
 * fd read.
 */

test("terminal close is final and queued oversized input rejects through the Vel promise", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-terminal-lifecycle-"));
  try {
    const closedEntry = join(directory, "closed.vel");
    await writeFile(closedEntry, `
import {terminal} from "velar/terminal"

terminal.close()
const line = await terminal.readLine()
print(line ?? "closed")
`.trimStart(), "utf8");
    const closed = await runProcess(
      process.execPath,
      [resolve("packages/cli/src/cli.ts"), "run", closedEntry],
      directory,
      process.env,
      "must not reopen\n",
    );
    assert.equal(closed.code, 0, closed.stderr);
    assert.equal(closed.stdout, "closed\n");

    const overflowEntry = join(directory, "overflow.vel");
    await writeFile(overflowEntry, `
import {terminal} from "velar/terminal"

print(await terminal.readLine() ?? "missing")
await Promise.sleep(20ms)
try:
    await terminal.readLine()
    print("unexpected")
catch error:
    print("bounded")
terminal.close()
`.trimStart(), "utf8");
    const overflow = await runProcess(
      process.execPath,
      [resolve("packages/cli/src/cli.ts"), "run", overflowEntry],
      directory,
      process.env,
      `first\n${"x".repeat(1024 * 1024 + 1)}\n`,
    );
    assert.equal(overflow.code, 0, overflow.stderr);
    assert.equal(overflow.stdout, "first\nbounded\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// The test above reached this ordering only by timing luck: on a loaded machine
// it went red with "Node terminal input host exited unexpectedly with code 0",
// because the host tore its IPC channel down in the same turn as its last send
// and the records still queued on that channel — the forwarded input and the
// end of it — went down with it. Forcing the ordering here makes the same
// regression observable on an idle one.

test("Node terminal input host delivers its queued input and its end of input before exiting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-terminal-input-host-"));
  try {
    const payload = `${"x".repeat(1024 * 1024)}\n`;
    const inputPath = join(directory, "input.txt");
    await writeFile(inputPath, payload, "utf8");
    const inputFile = await open(inputPath, "r");
    let forwarded = 0;
    let ended = false;
    let unexpected: string | null = null;
    let markReady = (): void => {};
    const ready = new Promise<void>((resolveReady) => { markReady = resolveReady; });
    try {
      const host = spawn(process.execPath, ["--input-type=module", "--eval", VELAR_NODE_TERMINAL_INPUT_SOURCE], {
        cwd: directory,
        // A regular file rather than a pipe, so the host reads the whole
        // payload without a turn of this thread's event loop feeding it.
        stdio: [inputFile.fd, "ignore", "inherit", "ipc"],
        serialization: "advanced",
      });
      const finished = new Promise<readonly [number | null, NodeJS.Signals | null]>((resolveClose) => {
        host.once("close", (code, signal) => resolveClose([code, signal]));
      });
      host.on("message", (message: { kind?: unknown; data?: unknown }) => {
        if (message.kind === "ready") { host.send({kind: "input-state", active: true}); markReady(); }
        else if (message.kind === "input-data" && message.data instanceof Uint8Array) forwarded += message.data.byteLength;
        else if (message.kind === "input-end") ended = true;
        else unexpected = String(message.kind);
      });
      await ready;
      // Stop reading the channel while the host forwards a megabyte and reaches
      // end of file. Its terminating record is then provably queued rather than
      // written when it closes the channel, which is the whole race.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      const [code, signal] = await finished;
      assert.equal(unexpected, null);
      assert.equal(signal, null);
      assert.equal(code, 0, "the terminal input host must end its own process cleanly");
      assert.ok(ended, "the terminal input host exited without delivering the end of its input");
      assert.equal(
        forwarded,
        NodeBuffer.byteLength(payload, "utf8"),
        "the terminal input host dropped forwarded input when it closed its channel",
      );
    } finally {
      await inputFile.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Node terminal worker releases idle imports and close cancels a pending fd read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-node-terminal-worker-lifecycle-"));
  try {
    const source = nodeModuleSources.get("velar/terminal");
    assert.ok(source);
    assert.match(source, /spawn\(process\.execPath/u);
    await writeFile(join(directory, "terminal.mjs"), source, "utf8");
    await writeFile(join(directory, "idle.mjs"), `
import {terminal} from "./terminal.mjs";
process.stdout.write(String(terminal.isInteractive()));
`.trimStart(), "utf8");
    const idle = spawn(process.execPath, [join(directory, "idle.mjs")], {
      cwd: directory,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let idleStdout = "";
    let idleStderr = "";
    idle.stdout.setEncoding("utf8");
    idle.stderr.setEncoding("utf8");
    idle.stdout.on("data", (chunk: string) => { idleStdout += chunk; });
    idle.stderr.on("data", (chunk: string) => { idleStderr += chunk; });
    const idleCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        idle.kill("SIGKILL");
        rejectExit(new Error(`idle terminal import retained an open stdin pipe: ${idleStdout}\n${idleStderr}`));
      }, 2_000);
      idle.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(idleCode, 0, idleStderr);
    assert.equal(idleStdout, "false");
    assert.equal(idleStderr, "");

    await writeFile(join(directory, "pending.mjs"), `
import {terminal} from "./terminal.mjs";
const pending = terminal.readLine();
setTimeout(() => terminal.close(), 25);
process.stdout.write((await pending) === null ? "closed" : "unexpected");
`.trimStart(), "utf8");
    const child = spawn(process.execPath, [join(directory, "pending.mjs")], {
      cwd: directory,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectExit(new Error(`terminal close did not cancel its pending fd read: ${stdout}\n${stderr}`));
      }, 2_000);
      child.once("exit", (exitCode) => { clearTimeout(timer); resolveExit(exitCode); });
    });
    assert.equal(code, 0, stderr);
    assert.equal(stdout, "closed");
    assert.equal(stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
