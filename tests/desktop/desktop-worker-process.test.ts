import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { before } from "node:test";
import { desktopWorkerTest, HELPER_DEADLINE_MS, releaseStaleWorkerState, terminateProcessGroup, workerPath, WorkerClient } from "../support/desktop-worker-client.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,124-line
 * `desktop-worker.test.ts`. Every test here is the one that was there, moved
 * verbatim, and the harness they share now lives in
 * `tests/support/desktop-worker-client.ts`. `desktopWorkerTest` carries the
 * platform guard the suite has always had.
 *
 * The subject is the process capability on its own: that a process grant does
 * not ride in on a filesystem one, that the wire bounds hold either way, and
 * that a transferred child is drained before the host dies.
 */

before(async () => { await releaseStaleWorkerState(); }, { timeout: 120_000 });

desktopWorkerTest("Desktop process grants work independently from filesystem grants and keep wire bounds", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-process-only-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: {
      files: [],
      processes: [basename(process.execPath)],
      network: [],
    },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(worker);
  let escapedPid: number | null = null;
  try {
    const execution = await client.call("process", "run", [
      basename(process.execPath),
      ["-e", "process.stdout.write(process.cwd())"],
      { timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 },
    ]) as { code: number; stdout: string };
    assert.equal(execution.code, 0);
    assert.equal(execution.stdout, await realpath(project));
    assert.deepEqual(client.lifecycle().map((event) => event.hostEvent), ["process-owned", "process-settled"]);
    assert.equal(client.lifecycle()[0]?.handle, client.lifecycle()[1]?.handle);
    await assert.rejects(client.call("fs", "exists", ["."]), /no granted filesystem scope/u);
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["--version"], { cwd: project }]),
      /no granted filesystem scope/u,
    );
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["--version"], { unexpected: true }]),
      /unknown field 'unexpected'/u,
    );
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["x".repeat(600_000), "y".repeat(600_000)], {}]),
      /arguments cannot exceed 1 MiB/u,
    );
    await assert.rejects(
      client.call("process", "run", [basename(process.execPath), ["--version"], { env: [["FIRST", "x".repeat(600_000)], ["SECOND", "y".repeat(600_000)]] }]),
      /env cannot exceed 1 MiB/u,
    );
    if (process.platform !== "win32") {
      const timeoutDirectory = await mkdtemp(join(tmpdir(), "velar-desktop-timeout-"));
      try {
        const pidFile = join(timeoutDirectory, "descendant.pid");
        const timeoutStartedAt = Date.now();
        await assert.rejects(client.call("process", "run", [
          basename(process.execPath),
          ["-e", `
const {spawn} = require("node:child_process");
const {writeFileSync} = require("node:fs");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
writeFileSync(process.env.PID_FILE, String(descendant.pid));
setInterval(() => {}, 1000);
          `],
          { env: [["PID_FILE", pidFile]], timeout: 200, maxOutputBytes: 65536 },
        ]), /timed out after 200 milliseconds/u);
        assert.ok(Date.now() - timeoutStartedAt < 8_000, "Desktop process.run timeout must converge through post-exit pipes");
        escapedPid = Number(await readFile(pidFile, "utf8"));
        assert.equal(Number.isSafeInteger(escapedPid), true);
        assert.doesNotThrow(() => process.kill(escapedPid as number, 0));
        terminateProcessGroup(escapedPid);
        escapedPid = null;
      } finally {
        await rm(timeoutDirectory, { recursive: true, force: true });
      }

      const abandonedOutput = await client.call("process", "start", [
        basename(process.execPath),
        ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
descendant.unref();
process.stdout.write(String(descendant.pid) + "\\n");
        `],
        { timeout: 0, maxOutputBytes: 65536 },
      ]) as { handle: number };
      let abandonedPidText = "";
      while (!abandonedPidText.includes("\n")) {
        const output = await client.call("process", "read", [abandonedOutput.handle]) as { text: string } | null;
        assert.ok(output);
        abandonedPidText += output.text;
      }
      const abandonedPid = Number(abandonedPidText.trim());
      assert.equal(Number.isSafeInteger(abandonedPid), true);
      escapedPid = abandonedPid;
      const outputDeadlineStartedAt = Date.now();
      await assert.rejects(
        client.call("process", "read", [abandonedOutput.handle]),
        /output streams did not close within 5000 milliseconds after process exit/u,
      );
      assert.ok(Date.now() - outputDeadlineStartedAt < 8_000, "Desktop process output must reject within its post-exit pipe deadline");
      assert.deepEqual(await client.call("process", "wait", [abandonedOutput.handle]), {
        result: null,
        error: { name: "Error", message: "Process output streams did not close within 5000 milliseconds after process exit" },
        retained: false,
      });
      assert.doesNotThrow(() => process.kill(abandonedPid, 0));
      terminateProcessGroup(abandonedPid);
      escapedPid = null;

      const escaped = await client.call("process", "start", [
        basename(process.execPath),
        ["-e", `
const {spawn} = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
});
process.stdout.write(String(descendant.pid) + "\\n");
setInterval(() => {}, 1000);
        `],
        { timeout: 0, maxOutputBytes: 65536 },
      ]) as { handle: number };
      let escapedPidText = "";
      while (!escapedPidText.includes("\n")) {
        const output = await client.call("process", "read", [escaped.handle]) as { text: string } | null;
        assert.ok(output);
        escapedPidText += output.text;
      }
      escapedPid = Number(escapedPidText.trim());
      assert.equal(Number.isSafeInteger(escapedPid), true);
      const escapedWait = client.call("process", "wait", [escaped.handle]) as Promise<{
        result: { signal: string | null } | null;
        error: { name: string; message: string } | null;
        retained: boolean;
      }>;
      const stopStartedAt = Date.now();
      await assert.rejects(
        client.call("process", "stop", [escaped.handle]),
        /termination could not be confirmed within 5000 milliseconds/u,
      );
      assert.deepEqual(await escapedWait, {
        result: null,
        error: { name: "Error", message: "Process termination could not be confirmed within 5000 milliseconds" },
        retained: true,
      });
      assert.ok(Date.now() - stopStartedAt < 8_000, "Desktop Process.stop must reject within its owned confirmation deadline");
      assert.doesNotThrow(() => process.kill(escapedPid as number, 0));
      terminateProcessGroup(escapedPid);
      const waited = await client.call("process", "wait", [escaped.handle]) as { result: { signal: string | null } | null };
      assert.notEqual(waited.result?.signal ?? null, null);
      escapedPid = null;
    }
  } finally {
    if (escapedPid !== null) terminateProcessGroup(escapedPid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

desktopWorkerTest("Desktop capability host drains transferred process ownership before a fatal exit", { timeout: 90_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-worker-crash-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: [], processes: [basename(process.execPath)], network: [] },
  }), "utf8");
  const source = await readFile(workerPath, "utf8");
  const crashingSource = source.replace(
    'task.kind = "process";\n  processHandles.set(handle, task);\n  // The native shell becomes the crash-recovery owner before the renderer\n  // receives the public start/run result.\n  respond({ protocolVersion: 1, hostEvent: "process-owned", owner, handle, pid: task.pid });',
    'task.kind = "process";\n  processHandles.set(handle, task);\n  // The native shell becomes the crash-recovery owner before the renderer\n  // receives the public start/run result.\n  respond({ protocolVersion: 1, hostEvent: "process-owned", owner, handle, pid: task.pid }); setTimeout(() => { throw new Error("injected Desktop worker crash"); }, 100); await new Promise(() => {});',
  );
  assert.notEqual(crashingSource, source);
  const crashingWorker = join(directory, "worker.mjs");
  await writeFile(crashingWorker, crashingSource, "utf8");
  const child = spawn(process.execPath, [crashingWorker, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(child);
  let ownedPid: number | null = null;
  try {
    await assert.rejects(
      client.call("process", "start", [basename(process.execPath), ["-e", "setInterval(() => {}, 1000)"], {timeout: 0, maxOutputBytes: 65536}]),
      /Desktop worker exited/u,
    );
    const ownership = client.lifecycle().find((event) => event.hostEvent === "process-owned");
    assert.ok(ownership && Number.isSafeInteger(ownership.pid));
    ownedPid = ownership.pid as number;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(ownedPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { ownedPid = null; break; }
    }
    assert.equal(ownedPid, null, "the Desktop worker must reap its child before fatal exit");
  } finally {
    if (ownedPid !== null) terminateProcessGroup(ownedPid);
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
