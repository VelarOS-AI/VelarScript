import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before } from "node:test";
import { desktopWorkerTest, releaseStaleWorkerState, workerPath, WorkerClient } from "../support/desktop-worker-client.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,124-line
 * `desktop-worker.test.ts`. Every test here is the one that was there, moved
 * verbatim, and the harness they share now lives in
 * `tests/support/desktop-worker-client.ts`. `desktopWorkerTest` carries the
 * platform guard the suite has always had.
 *
 * The subject is the generation: one window may have exactly one live one, and
 * the host has to retire the previous generation's work rather than answer for
 * two at once.
 */

before(async () => { await releaseStaleWorkerState(); }, { timeout: 120_000 });

desktopWorkerTest("Desktop capability host keeps one live generation per window", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-generations-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: { files: ["project"], processes: [], network: [] },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], { stdio: ["pipe", "pipe", "pipe"] });
  const client = new WorkerClient(worker);
  const firstWindow = "0000000000000000000000000000000a";
  const secondWindow = "0000000000000000000000000000000b";
  try {
    // Two windows are two live generations. Opening the second must not retire
    // the first: before multi-window, activation retired whatever came before,
    // and a second window would have killed the first window's watchers,
    // processes and in-flight requests.
    client.addOwner(firstWindow);
    await client.call("fs", "writeText", ["first.txt", "from the first window"]);
    const firstWatcher = await client.call("fs", "watchStart", [project, false]) as number;
    client.addOwner(secondWindow);
    await client.call("fs", "writeText", ["second.txt", "from the second window"]);

    client.useOwner(firstWindow);
    assert.equal(await client.call("fs", "readText", ["second.txt", 4096]), "from the second window");
    assert.equal(await client.call("fs", "watchClose", [firstWatcher]), true);

    // A generation still leaves the set exactly where it always did, and takes
    // only its own work with it.
    client.useOwner(secondWindow);
    const secondWatcher = await client.call("fs", "watchStart", [project, false]) as number;
    client.retireOwnerNamed(firstWindow);
    assert.equal(await client.call("fs", "readText", ["first.txt", 4096]), "from the first window");
    assert.equal(await client.call("fs", "watchClose", [secondWatcher]), true);

    client.useOwner(firstWindow);
    await assert.rejects(client.call("fs", "exists", ["first.txt"]), /Invalid Desktop worker request/u);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
