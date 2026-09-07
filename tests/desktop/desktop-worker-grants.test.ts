import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { before } from "node:test";
import { addressPort, closeServer, desktopWorkerTest, HELPER_DEADLINE_MS, localServer, releaseStaleWorkerState, reportedChange, workerPath, WorkerClient } from "../support/desktop-worker-client.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,124-line
 * `desktop-worker.test.ts`. Every test here is the one that was there, moved
 * verbatim, and the harness they share now lives in
 * `tests/support/desktop-worker-client.ts`. `desktopWorkerTest` carries the
 * platform guard the suite has always had.
 *
 * The subject is the grant itself: every filesystem, process and network
 * capability the Node capability host publishes, checked against the manifest
 * that did or did not declare it.
 */

before(async () => { await releaseStaleWorkerState(); }, { timeout: 120_000 });

desktopWorkerTest("Desktop Node capability host enforces filesystem, process, and network grants", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-desktop-worker-"));
  const project = join(directory, "project");
  const appData = join(directory, "app-data");
  await mkdir(project);
  await mkdir(appData);
  const redirectCapture: { providerKey?: string } = {};
  const redirectServer = await localServer(undefined, redirectCapture);
  const ungrantedServer = await localServer();
  const unavailableServer = await localServer();
  const unavailableOrigin = `http://127.0.0.1:${addressPort(unavailableServer)}`;
  await closeServer(unavailableServer);
  const redirectOrigin = `http://127.0.0.1:${addressPort(redirectServer)}`;
  const ungrantedOrigin = `http://127.0.0.1:${addressPort(ungrantedServer)}`;
  const server = await localServer({ redirectOrigin, ungrantedOrigin });
  const origin = `http://127.0.0.1:${addressPort(server)}`;
  const configPath = join(directory, "desktop.json");
  await writeFile(configPath, JSON.stringify({
    protocolVersion: 1,
    permissions: {
      files: ["project", "app-data"],
      processes: [basename(process.execPath)],
      network: [origin, redirectOrigin, unavailableOrigin],
      secrets: ["VELAR_DESKTOP_TEST_SECRET", "VELAR_DESKTOP_MISSING_SECRET"],
    },
  }), "utf8");
  const worker = spawn(process.execPath, [workerPath, configPath, appData, project], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, VELAR_DESKTOP_TEST_SECRET: "worker-only-token" },
  });
  const client = new WorkerClient(worker);
  try {
    const competingCreates = await Promise.allSettled([
      client.call("fs", "createText", ["exclusive.txt", "first"]),
      client.call("fs", "createText", ["exclusive.txt", "second"]),
    ]);
    assert.equal(competingCreates.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(competingCreates.filter((item) => item.status === "rejected").length, 1);
    assert.match(String((competingCreates.find((item) => item.status === "rejected") as PromiseRejectedResult).reason), /createText target already exists/u);
    assert.ok(["first", "second"].includes(await client.call("fs", "readText", ["exclusive.txt", 1024]) as string));
    assert.equal(await client.call("fs", "writeText", ["optimistic.txt", "base"]), null);
    const competingReplacements = await Promise.all([
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "first"]),
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "second"]),
    ]);
    assert.deepEqual([...competingReplacements].sort(), [false, true]);
    assert.ok(["first", "second"].includes(await client.call("fs", "readText", ["optimistic.txt", 1024]) as string));
    assert.equal(await client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "stale", "lost"]), false);
    for (let iteration = 0; iteration < 16; iteration += 1) {
      await client.call("fs", "writeText", ["optimistic.txt", "base"]);
      await Promise.all([
        client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "replacement"]),
        client.call("fs", "writeText", ["optimistic.txt", "writer"]),
      ]);
      assert.equal(await client.call("fs", "readText", ["optimistic.txt", 1024]), "writer");
    }
    await client.call("fs", "writeText", ["optimistic.txt", "base"]);
    const [replaceBeforeAppend] = await Promise.all([
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "replacement"]),
      client.call("fs", "appendText", ["optimistic.txt", "!"]),
    ]);
    assert.equal(await client.call("fs", "readText", ["optimistic.txt", 1024]), replaceBeforeAppend ? "replacement!" : "base!");
    await client.call("fs", "writeText", ["optimistic.txt", "base"]);
    await Promise.allSettled([
      client.call("fs", "replaceTextIfMatches", ["optimistic.txt", "base", "replacement"]),
      client.call("fs", "removeFile", ["optimistic.txt"]),
    ]);
    assert.equal(await client.call("fs", "info", ["optimistic.txt"]), null);
    assert.equal(await client.call("fs", "writeText", ["note.txt", "Velar"]), null);
    assert.equal(await client.call("fs", "readText", ["note.txt", 1024]), "Velar");
    assert.deepEqual(await client.call("fs", "list", [".", 10]), ["exclusive.txt", "note.txt"]);
    assert.equal(await client.call("fs", "makeDirectory", ["nested/one/two"]), null);
    assert.equal(await client.call("fs", "writeText", ["nested/one/two/value.txt", "nested"]), null);
    assert.equal(await client.call("fs", "readText", ["nested/one/two/value.txt", 1024]), "nested");
    await assert.rejects(client.call("fs", "writeText", ["nested", "not-a-file"]), /requires a file path/u);
    await assert.rejects(client.call("fs", "appendText", ["nested", "not-a-file"]), /requires a file path/u);
    await assert.rejects(client.call("fs", "copyFile", ["nested", "nested-copy", false]), /regular file source/u);

    const outsideDirectory = join(directory, "outside");
    await mkdir(outsideDirectory);
    const insideTarget = join(project, "inside-target.txt");
    await writeFile(insideTarget, "inside", "utf8");
    const insideLink = join(project, "inside-link.txt");
    await symlink(insideTarget, insideLink);
    assert.equal((await client.call("fs", "info", [insideLink]) as { kind: string }).kind, "symlink");
    assert.equal(await client.call("fs", "removeFile", [insideLink]), null);
    assert.equal(await readFile(insideTarget, "utf8"), "inside");
    await symlink(insideTarget, insideLink);
    const movedLink = join(project, "moved-link.txt");
    assert.equal(await client.call("fs", "move", [insideLink, movedLink, false]), null);
    assert.equal((await client.call("fs", "info", [movedLink]) as { kind: string }).kind, "symlink");
    assert.equal(await readFile(insideTarget, "utf8"), "inside");

    const outsideMissing = join(outsideDirectory, "created-through-link.txt");
    const danglingLink = join(project, "dangling.txt");
    await symlink(outsideMissing, danglingLink);
    assert.equal((await client.call("fs", "info", [danglingLink]) as { kind: string }).kind, "symlink");
    await assert.rejects(client.call("fs", "writeText", [danglingLink, "escape"]), /dangling symbolic link/u);
    await assert.rejects(client.call("fs", "appendText", [danglingLink, "escape"]), /dangling symbolic link/u);
    await assert.rejects(readFile(outsideMissing, "utf8"), (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT");
    assert.equal(await client.call("fs", "removeFile", [danglingLink]), null);

    const insideDirectoryLink = join(project, "inside-directory-link");
    await symlink(join(project, "nested"), insideDirectoryLink);
    await assert.rejects(client.call("fs", "makeDirectory", [insideDirectoryLink]), /refuses a symbolic-link target/u);
    assert.equal(await client.call("fs", "makeDirectory", [join(insideDirectoryLink, "through-link")]), null);
    assert.equal((await client.call("fs", "info", [join(project, "nested", "through-link")]) as { kind: string }).kind, "directory");
    const outsideDirectoryLink = join(project, "outside-directory-link");
    await symlink(outsideDirectory, outsideDirectoryLink);
    await assert.rejects(client.call("fs", "makeDirectory", [join(outsideDirectoryLink, "escape")]), /outside granted Desktop file roots/u);
    await assert.rejects(client.call("fs", "move", [project, join(appData, "data", "project"), false]), /refuses a granted Desktop file root/u);
    const appDataFile = join(appData, "data", "audit.ndjson");
    assert.equal(await client.call("fs", "writeText", [appDataFile, "{}\n"]), null);
    assert.equal(await client.call("fs", "readText", [appDataFile, 1024]), "{}\n");
    const watcherHandle = await client.call("fs", "watchStart", [project, true]) as number;
    const externalChange = client.call("fs", "watchNext", [watcherHandle]) as Promise<{ paths: string[]; rescan: boolean }>;
    const externalPath = join(project, "external.vel");
    const externalBatch = await reportedChange(externalChange, externalPath, "the recursive Desktop project watch");
    assert.equal(externalBatch.rescan, false);
    assert.ok(externalBatch.paths.includes(await realpath(externalPath)));
    const pendingWatcherPull = client.call("fs", "watchNext", [watcherHandle]);
    const replacementProject = join(directory, "replacement-project");
    await mkdir(replacementProject);
    await writeFile(join(replacementProject, "replacement.txt"), "replacement", "utf8");
    const replacedProjectProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 0, maxOutputBytes: 65536 },
    ]) as { handle: number; pid: number };
    const projectReplacement = client.setProjectRoot(replacementProject);
    await assert.rejects(pendingWatcherPull, /project grant changed|cancelled|no longer active/u);
    await projectReplacement;
    assert.equal(await client.call("fs", "watchClose", [watcherHandle]), false);
    let replacedProjectProcessExists = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(replacedProjectProcess.pid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { replacedProjectProcessExists = false; break; }
    }
    assert.equal(replacedProjectProcessExists, false, "replacing a project grant must release project-owned processes");
    await assert.rejects(client.call("process", "wait", [replacedProjectProcess.handle]), /unknown or already released/u);
    assert.equal(await client.call("fs", "readText", ["replacement.txt", 1024]), "replacement");
    await assert.rejects(client.call("fs", "readText", [join(project, "note.txt"), 1024]), /outside granted Desktop file roots/u);
    assert.equal(await client.call("fs", "readText", [appDataFile, 1024]), "{}\n");
    const replacementCwd = await client.call("process", "run", [
      basename(process.execPath),
      ["-e", "process.stdout.write(process.cwd())"],
      { timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 },
    ]) as { stdout: string };
    assert.equal(replacementCwd.stdout, await realpath(replacementProject));
    const largeText = `large:${"界".repeat(400_000)}`;
    assert.equal(await client.call("fs", "writeText", ["large.txt", largeText]), null);
    assert.equal(await client.call("fs", "readText", ["large.txt", 2 * 1024 * 1024]), largeText);
    // JSON escaping expands a C0 byte sixfold, so a file well inside readText's
    // own 16 MiB bound still encodes to a response line past the worker's
    // transport bound. That has to stay a per-request failure: the native host
    // treats an oversized line as terminal, so a fatal answer here would brick
    // every later capability call in the process.
    await writeFile(join(replacementProject, "nul-padded.txt"), Buffer.alloc(11 * 1024 * 1024, 0));
    await assert.rejects(
      client.call("fs", "readText", ["nul-padded.txt", 16 * 1024 * 1024]),
      /Desktop response exceeds its transport bound/u,
    );
    assert.equal(await client.call("fs", "readText", ["replacement.txt", 1024]), "replacement");
    assert.equal(await client.call("fs", "readText", ["large.txt", 2 * 1024 * 1024]), largeText);
    await assert.rejects(client.call("fs", "readText", [configPath, 1024]), /outside granted Desktop file roots/u);
    await assert.rejects(client.call("fs", "exists", [join(directory, "outside-missing.txt")]), /outside granted Desktop file roots/u);
    await assert.rejects(client.call("fs", "info", [join(directory, "outside-missing.txt")]), /outside granted Desktop file roots/u);

    const execution = await client.call("process", "run", [basename(process.execPath), ["--version"], { timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 }]) as {
      code: number;
      stdout: string;
    };
    assert.equal(execution.code, 0);
    assert.equal(execution.stdout.trim(), process.version);
    const started = await client.call("process", "start", [basename(process.execPath), ["--version"], { timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 }]) as {
      handle: number;
      pid: number;
    };
    assert.ok(started.handle > 0);
    assert.ok(started.pid > 0);
    const waitedOutcome = await client.call("process", "wait", [started.handle]) as {
      result: { code: number; stdout: string };
      error: null;
      retained: false;
    };
    const waited = waitedOutcome.result;
    assert.equal(waited.code, 0);
    assert.equal(waited.stdout.trim(), process.version);

    const streamedProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "const b=Buffer.from('界');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),25);setTimeout(()=>process.stderr.write('two'),50)"],
      { timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 },
    ]) as { handle: number; pid: number };
    const processOutput: Array<{ channel: string; text: string }> = [];
    while (true) {
      const chunk = await client.call("process", "read", [streamedProcess.handle]) as { channel: string; text: string } | null;
      if (chunk === null) break;
      processOutput.push(chunk);
    }
    assert.deepEqual(processOutput, [
      { channel: "stdout", text: "界" },
      { channel: "stderr", text: "two" },
    ]);
    assert.deepEqual(await client.call("process", "wait", [streamedProcess.handle]), {
      result: { code: 0, signal: null, stdout: "界", stderr: "two" },
      error: null,
      retained: false,
    });
    await assert.rejects(client.call("process", "read", [streamedProcess.handle]), /unknown or already released/u);

    const delayedProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "setTimeout(()=>process.stdout.write('ready'),100)"],
      { timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 },
    ]) as { handle: number };
    const firstProcessRead = client.call("process", "read", [delayedProcess.handle]);
    await assert.rejects(client.call("process", "read", [delayedProcess.handle]), /only one active pull/u);
    await assert.rejects(client.call("process", "wait", [delayedProcess.handle]), /while next\(\) is pending/u);
    assert.deepEqual(await firstProcessRead, { channel: "stdout", text: "ready" });
    assert.equal(await client.call("process", "read", [delayedProcess.handle]), null);
    await client.call("process", "wait", [delayedProcess.handle]);

    const longRunning = await client.call("process", "start", [basename(process.execPath), ["-e", "setTimeout(() => {}, 10000)"], { timeout: 0 }]) as {
      handle: number;
      pid: number;
    };
    assert.deepEqual(await client.call("process", "stop", [longRunning.handle]), {
      result: { code: null, signal: "SIGTERM", stdout: "", stderr: "" },
      error: null,
    });
    assert.deepEqual(await client.call("process", "stop", [longRunning.handle]), { result: null, error: null });
    await assert.rejects(client.call("process", "run", ["sh", ["-c", "echo unsafe"], {}]), /not granted/u);
    await assert.rejects(client.call("process", "run", [basename(process.execPath), ["--version"], { env: [["PATH", project]] }]), /cannot replace PATH/u);
    // A granted executable is only as narrow as its own environment surface:
    // each of these names hands the child a command, an interpreter option, a
    // loader path, or the configuration directory the child reads its own
    // command settings from, so the process grant must refuse them by name.
    // The bare spellings are the ones the granted programs actually consult —
    // `git commit` runs EDITOR and `git log` runs PAGER — and HOME redirects
    // the whole .gitconfig surface the GIT_ prefix exists to protect.
    for (const reserved of ["GIT_SSH_COMMAND", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "IFS", "PERL5OPT", "RUBYOPT", "PAGER_OPTS", "VISUAL_EDITOR", "python_startup", "EDITOR", "VISUAL", "PAGER", "MANPAGER", "BROWSER", "LESSOPEN", "SSH_ASKPASS", "XDG_CONFIG_HOME", "HOME", "SHELL", "TMPDIR", "editor"]) {
      await assert.rejects(
        client.call("process", "run", [basename(process.execPath), ["--version"], { env: [[reserved, "/bin/sh -c true"]] }]),
        new RegExp(`transport- or interpreter-controlled variable '${reserved}'`, "u"),
      );
    }
    const benignEnvironment = await client.call("process", "run", [
      basename(process.execPath),
      ["-e", "process.stdout.write(process.env.FIRST + ':' + process.env.SECOND)"],
      { env: [["FIRST", "one"], ["SECOND", "two"]], timeout: HELPER_DEADLINE_MS, maxOutputBytes: 65536 },
    ]) as { stdout: string };
    assert.equal(benignEnvironment.stdout, "one:two");
    const largeStdin = "x".repeat(1200 * 1024);
    const stdinResult = await client.call("process", "run", [basename(process.execPath), ["-e", "let n=0;process.stdin.on('data',c=>n+=c.length);process.stdin.on('end',()=>console.log(n))"], {
      stdin: largeStdin,
      maxOutputBytes: 1024,
    }]) as { stdout: string };
    assert.equal(stdinResult.stdout.trim(), String(largeStdin.length));

    await assert.rejects(client.call("http", "request", [90, "POST", `${origin}/echo-size`, { body: { unsafe: true } }]), /validated text/u);
    await assert.rejects(client.call("http", "request", [91, "GET", `${origin}/stream`, { surprise: true }]), /unknown field 'surprise'/u);
    await assert.rejects(client.call("http", "request", [92, "BAD METHOD", `${origin}/stream`, {}]), /invalid or forbidden/u);
    await assert.rejects(client.call("http", "request", [93, "GET", "file:///tmp/value", {}]), /must use http or https/u);

    const response = await client.call("http", "request", [1, "GET", `${origin}/stream`, { maxBytes: 1024 }]) as {
      ok: boolean;
      status: number;
    };
    assert.deepEqual({ ok: response.ok, status: response.status }, { ok: true, status: 200 });
    const chunks: string[] = [];
    while (true) {
      const chunk = await client.call("http", "read", [1]) as { done: boolean; text: string };
      chunks.push(chunk.text);
      if (chunk.done) break;
    }
    assert.equal(chunks.join(""), "desktop-ready");
    assert.ok(chunks.filter(Boolean).length >= 2, JSON.stringify(chunks));

    await client.call("http", "request", [2, "GET", `${origin}/slow`, { maxBytes: 1024, timeout: 0 }]);
    assert.deepEqual(await client.call("http", "cancel", [2]), null);
    await assert.rejects(client.call("http", "read", [2]), /unknown or already released/u);
    await assert.rejects(client.call("http", "request", [3, "GET", "https://example.com/", {}]), /not granted/u);

    const redirected = await client.call("http", "request", [4, "GET", `${origin}/redirect-allowed`, { maxBytes: 1024 }]) as {
      status: number;
      url: string;
    };
    assert.equal(redirected.status, 200);
    assert.equal(redirected.url, `${redirectOrigin}/destination`);
    assert.deepEqual(await client.call("http", "read", [4]), { done: false, text: "desktop-ready" });
    assert.deepEqual(await client.call("http", "read", [4]), { done: true, text: "" });
    await assert.rejects(
      client.call("http", "request", [5, "GET", `${origin}/redirect-ungranted`, { maxBytes: 1024 }]),
      new RegExp(`Network origin '${ungrantedOrigin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}' is not granted`, "u"),
    );
    await assert.rejects(
      client.call("http", "request", [6, "GET", `${origin}/redirect-loop`, { maxBytes: 1024 }]),
      /redirect limit of 20 was exceeded/u,
    );
    const redirectedError = await client.call("http", "request", [15, "GET", `${origin}/redirect-error`, { maxBytes: 1024 }]) as {
      body: boolean;
      ok: boolean;
      status: number;
      url: string;
    };
    assert.deepEqual({
      body: redirectedError.body,
      ok: redirectedError.ok,
      status: redirectedError.status,
      url: redirectedError.url,
    }, {
      body: true,
      ok: false,
      status: 502,
      url: `${redirectOrigin}/error-target`,
    });
    assert.deepEqual(await client.call("http", "read", [15]), { done: false, text: '{"failed":true}' });
    assert.deepEqual(await client.call("http", "read", [15]), { done: true, text: "" });
    const posted = await client.call("http", "request", [7, "POST", `${origin}/echo-size`, { body: largeStdin, maxBytes: 1024 }]) as { status: number };
    assert.equal(posted.status, 200);
    assert.deepEqual(await client.call("http", "read", [7]), { done: false, text: String(largeStdin.length) });
    assert.deepEqual(await client.call("http", "read", [7]), { done: true, text: "" });
    await client.call("http", "request", [8, "GET", `${origin}/secret-authorized`, {
      secretHeaders: [{ name: "authorization", environment: "VELAR_DESKTOP_TEST_SECRET", prefix: "Bearer " }],
      maxBytes: 1024,
    }]);
    assert.deepEqual(await client.call("http", "read", [8]), { done: false, text: "authorized" });
    assert.deepEqual(await client.call("http", "read", [8]), { done: true, text: "" });
    await client.call("http", "request", [9, "GET", `${origin}/redirect-secret`, {
      secretHeaders: [{ name: "x-provider-key", environment: "VELAR_DESKTOP_TEST_SECRET", prefix: "" }],
      maxBytes: 1024,
    }]);
    assert.deepEqual(await client.call("http", "read", [9]), { done: false, text: "desktop-ready" });
    assert.deepEqual(await client.call("http", "read", [9]), { done: true, text: "" });
    assert.equal(redirectCapture.providerKey, undefined);
    await assert.rejects(client.call("http", "request", [10, "GET", `${origin}/stream`, {
      secretHeaders: [{ name: "authorization", environment: "UNGRANTED_SECRET", prefix: "" }],
    }]), /not granted by desktop\.permissions\.secrets/u);
    await assert.rejects(client.call("http", "request", [11, "GET", `${origin}/stream`, {
      secretHeaders: [{ name: "authorization", environment: "VELAR_DESKTOP_MISSING_SECRET", prefix: "" }],
    }]), /is unavailable/u);
    const empty = await client.call("http", "request", [12, "GET", `${origin}/empty`, { timeout: HELPER_DEADLINE_MS }]) as { body: boolean; status: number };
    assert.deepEqual({ body: empty.body, status: empty.status }, { body: false, status: 204 });
    await assert.rejects(client.call("http", "read", [12]), /unknown or already released/u);
    const declared = await client.call("http", "request", [13, "GET", `${origin}/declared-large`, { maxBytes: 4 }]) as { body: boolean; status: number };
    assert.deepEqual({ body: declared.body, status: declared.status }, { body: true, status: 200 });
    await assert.rejects(client.call("http", "read", [13]), /exceeds maxBytes/u);
    const declaredHead = await client.call("http", "request", [14, "HEAD", `${origin}/declared-large`, { maxBytes: 4 }]) as { body: boolean; status: number };
    assert.deepEqual({ body: declaredHead.body, status: declaredHead.status }, { body: false, status: 200 });
    await assert.rejects(
      client.call("http", "request", [16, "GET", `${unavailableOrigin}/unavailable`, { timeout: 0 }]),
      (error: unknown) => error instanceof Error
        && (error as Error & { kind?: unknown }).kind === "http-transport"
        && (error as Error & { phase?: unknown }).phase === "request",
    );
    await client.call("http", "request", [17, "GET", `${origin}/transport-response`, { timeout: 0 }]);
    assert.deepEqual(await client.call("http", "read", [17]), { done: false, text: "partial" });
    await assert.rejects(
      client.call("http", "read", [17]),
      (error: unknown) => error instanceof Error
        && (error as Error & { kind?: unknown }).kind === "http-transport"
        && (error as Error & { phase?: unknown }).phase === "response",
    );

    const retiredOwner = "00000000000000000000000000000001";
    const replacementOwner = "00000000000000000000000000000002";
    const retiredProcess = await client.call("process", "start", [
      basename(process.execPath),
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 0, maxOutputBytes: 65536 },
    ]) as { handle: number; pid: number };
    await client.call("http", "request", [18, "GET", `${origin}/slow`, { maxBytes: 1024, timeout: 0 }]);
    client.replaceOwner(replacementOwner);
    await client.call("http", "request", [18, "GET", `${origin}/stream`, { maxBytes: 1024, timeout: HELPER_DEADLINE_MS }]);
    let replacementText = "";
    while (true) {
      const chunk = await client.call("http", "read", [18]) as { done: boolean; text: string };
      replacementText += chunk.text;
      if (chunk.done) break;
    }
    assert.equal(replacementText, "desktop-ready");
    await assert.rejects(
      client.call("process", "wait", [retiredProcess.handle]),
      /belongs to another document generation|unknown or already released/u,
    );
    let retiredProcessExists = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(retiredProcess.pid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { retiredProcessExists = false; break; }
    }
    assert.equal(retiredProcessExists, false, "retiring a document generation must reap the processes it owned");
    assert.ok(client.lifecycle().some((event) => event.hostEvent === "process-owned" && event.owner === retiredOwner && event.handle === retiredProcess.handle));

    const cancelledHttp = client.beginCall("http", "request", [19, "GET", `${origin}/slow-headers`, { maxBytes: 1024, timeout: 0 }]);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    client.cancelRequest(cancelledHttp.id);
    await assert.rejects(cancelledHttp.result, /request was cancelled/u);
    await client.call("http", "request", [19, "GET", `${origin}/stream`, { maxBytes: 1024, timeout: HELPER_DEADLINE_MS }]);
    assert.deepEqual(await client.call("http", "cancel", [19]), null);

    const cancellationEvents = client.lifecycle().length;
    const cancelledRun = client.beginCall("process", "run", [
      basename(process.execPath),
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 0, maxOutputBytes: 1024 },
    ]);
    let cancelledRunPid: number | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const event = client.lifecycle().slice(cancellationEvents).find((item) => item.hostEvent === "process-owned");
      if (event?.pid) { cancelledRunPid = event.pid; break; }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(cancelledRunPid !== null);
    client.cancelRequest(cancelledRun.id);
    await assert.rejects(cancelledRun.result, /request was cancelled/u);
    let cancelledRunExists = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { process.kill(cancelledRunPid, 0); await new Promise((resolveWait) => setTimeout(resolveWait, 20)); }
      catch { cancelledRunExists = false; break; }
    }
    assert.equal(cancelledRunExists, false, "cancelling an in-flight process run must reap its hidden process owner");
  } finally {
    await client.close();
    await Promise.all([server, redirectServer, ungrantedServer].map(closeServer));
    await rm(directory, { recursive: true, force: true });
  }
});
