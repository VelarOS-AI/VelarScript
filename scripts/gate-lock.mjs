// Runs one gate command at a time per checkout.
//
// Every gate rebuilds `packages/*/dist` through a clean step, binds fixed test
// ports, and writes `.velar/` sandboxes inside `examples/*`. That state belongs
// to the checkout, not to the run, so two gates started in the same working
// tree corrupt each other: the second run's clean deletes a package dist while
// the first run's tests are importing it, and the first run fails with
// ERR_MODULE_NOT_FOUND on a tree that is perfectly fine. A later gate waits
// here instead, and the failure a gate reports is always about the code.
//
// The lock lives inside the workspace it guards, so separate checkouts, git
// worktrees, CI jobs, and the temporary workspace built by
// isolated-toolchain-build.mjs never wait on each other. It is re-entrant
// within one process tree, so a locked gate can call another locked script.
//
// It is deliberately not in `tmpdir()`. On a shared host that directory is
// world-writable, and a path derived from the checkout is not a secret, so any
// local user could pre-create the lock naming a process that never exits and
// wedge every gate in this checkout for good. `.velar/` is already ignored by
// git and already the CLI's own scratch namespace, so nothing else changes.
//
// Usage: node scripts/gate-lock.mjs <command> [arguments...]

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const lockPath = join(workspaceRoot, ".velar", "gate.lock");
const heldVariable = "VELAR_GATE_LOCK";
// A lock file that never received its holder record was abandoned between
// creation and the first write; only reclaim it once it cannot still be racing.
const unwritableLockGraceMs = 10_000;
const pollIntervalMs = 500;
const waitNoticeIntervalMs = 60_000;

const commandArguments = process.argv.slice(2);
if (commandArguments.length === 0) {
  process.stderr.write("Usage: gate-lock.mjs <command> [arguments...]\n");
  process.exit(2);
}

let child;

// An ancestor in this process tree already holds the lock for this workspace.
if (process.env[heldVariable] === lockPath) {
  process.exit(await runGate());
}

const token = randomUUID();

process.on("exit", release);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (child) child.kill(signal);
    else process.exit(1);
  });
}

await acquire();
try {
  process.exitCode = await runGate();
} finally {
  release();
}

async function acquire() {
  let waitingSince = 0;
  let lastNotice = 0;
  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    let handle;
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const holder = await readHolder();
      if (holder === undefined) continue;
      if (isReclaimable(holder)) {
        process.stderr.write(`Reclaiming a stale VelarScript gate lock left by ${describe(holder)}.\n`);
        try {
          await unlink(lockPath);
        } catch (error) {
          // A reclaim that cannot remove the file would otherwise spin here
          // forever with nothing on screen explaining why.
          if (error?.code !== "ENOENT") {
            throw new Error(`cannot reclaim the stale gate lock at ${lockPath}: ${error?.message ?? String(error)}`);
          }
        }
        continue;
      }
      const now = Date.now();
      if (waitingSince === 0) {
        waitingSince = now;
        lastNotice = now;
        process.stderr.write(
          `Waiting for the VelarScript gate lock held by ${describe(holder)}.\n`
            + "Gates in one checkout run one at a time; this one starts when that one finishes.\n"
            + `Lock file: ${lockPath}\n`,
        );
      } else if (now - lastNotice >= waitNoticeIntervalMs) {
        lastNotice = now;
        process.stderr.write(`Still waiting for the VelarScript gate lock (${formatDuration(now - waitingSince)}).\n`);
      }
      await delay(pollIntervalMs);
      continue;
    }
    try {
      const record = {
        token,
        pid: process.pid,
        host: hostname(),
        label: commandArguments.join(" "),
        workspace: workspaceRoot,
        startedAt: new Date().toISOString(),
      };
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return;
  }
}

/** Reads the current holder, or undefined when the lock is unreadable right now. */
async function readHolder() {
  let contents;
  try {
    contents = await readFile(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const holder = JSON.parse(contents);
    if (holder && typeof holder === "object") return holder;
  } catch {
    // Fall through to the unwritten-lock case below.
  }
  const age = await lockAge();
  if (age === undefined) return undefined;
  return { unwritten: true, reclaimable: age >= unwritableLockGraceMs };
}

/**
 * A gate that died without releasing leaves a lock naming a process that is
 * gone. Only a holder on this machine can be judged this way, and only when its
 * process really is absent, so a running gate is never displaced.
 */
function isReclaimable(holder) {
  if (holder.unwritten === true) return holder.reclaimable === true;
  if (holder.host !== hostname()) return false;
  return !isRunning(holder.pid);
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === "EPERM";
  }
}

async function lockAge() {
  try {
    return Date.now() - (await stat(lockPath)).mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Removes the lock, and only ever the lock this process is holding. */
function release() {
  try {
    if (JSON.parse(readFileSync(lockPath, "utf8")).token !== token) return;
  } catch {
    return;
  }
  try {
    unlinkSync(lockPath);
  } catch {
    // Already reclaimed; nothing left to release.
  }
}

function runGate() {
  const [command, ...rest] = commandArguments;
  // npm is reached through the running npm's own entry point so the gate does
  // not depend on a shell or on PATH resolution rules that differ per platform.
  const npmExecPath = command === "npm" ? process.env.npm_execpath : undefined;
  const executable = npmExecPath
    ? process.execPath
    : command === "npm" && process.platform === "win32"
      ? "npm.cmd"
      : command;
  const executableArguments = npmExecPath ? [npmExecPath, ...rest] : rest;
  return new Promise((resolvePromise, reject) => {
    child = spawn(executable, executableArguments, {
      cwd: workspaceRoot,
      stdio: "inherit",
      env: { ...process.env, [heldVariable]: lockPath },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolvePromise(signal ? 1 : code ?? 1));
  });
}

function describe(holder) {
  if (holder.unwritten === true) return "an unidentified gate";
  const label = terminalSafe(typeof holder.label === "string" && holder.label ? holder.label : "") || "a gate";
  const started = Date.parse(holder.startedAt ?? "");
  const age = Number.isNaN(started) ? "" : `, running for ${formatDuration(Date.now() - started)}`;
  return `\`${label}\` (pid ${holder.pid}${age})`;
}

/**
 * The lock record is written by whoever holds the lock, and this text goes to a
 * terminal. C0 and C1 controls carry escape sequences that retitle a window or
 * rewrite the line above; bidi overrides reorder what is already there. None of
 * them belong in a gate's own command line, so they are dropped rather than
 * escaped — the label exists to be recognized, not to round-trip.
 */
function terminalSafe(text) {
  return text.replaceAll(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").slice(0, 200);
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}
