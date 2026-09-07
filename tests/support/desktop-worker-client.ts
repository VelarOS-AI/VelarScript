import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

/**
 * D115 §一.6 — the harness the Desktop capability worker's tests drive it
 * through: one bounded client over its stdio protocol, the local HTTP server
 * its network cases talk to, and the stale-state reclamation a killed run
 * leaves work for.
 *
 * It stood at the top and bottom of the 1,124-line `desktop-worker.test.ts`
 * until D115 §三 split that file by subject; the three files it became all
 * drive the same worker, so the one copy lives here. Every declaration below
 * is the one that was there.
 */

export const workerPath = resolve("packages/desktop/native/node/worker.js");
const temporaryPrefix = join(tmpdir(), "velar-desktop-");
export const desktopWorkerTest = process.platform === "win32" ? test.skip : test;

// Every wait in this suite is bounded. The worker speaks over stdio pipes and drives
// real child processes, HTTP streams, and OS file watchers, so one reply that never
// arrives used to freeze the whole `npm test` run at 0% CPU: node:test runs with
// --test-timeout=0, so nothing above these promises intervenes. Each bound is far
// above the worker's own worst case — its longest internal confirmation deadline for
// filesystem, process and HTTP work is 5000ms, and the widest payload the suite pushes
// through the pipe is about 1.2 MiB — so a healthy-but-loaded run never trips one, and
// each failure names what timed out and the states that explain it.
const WORKER_CALL_TIMEOUT_MS = 30_000;
// macOS arms a recursive watch asynchronously, so a change written before the FSEvents
// stream starts is never reported at all. Re-trigger while the pull is outstanding.
const WATCHED_CHANGE_TIMEOUT_MS = 30_000;
const WATCHED_CHANGE_RETRIGGER_MS = 250;
const LOCAL_SERVER_TIMEOUT_MS = 10_000;
const STALE_STATE_TIMEOUT_MS = 30_000;
// The bound for a helper the test only needs to *finish* — `node --version`, an echo of
// `process.cwd()`, a request to the server beside it — which assert what the host answered,
// never how fast. At 5s, 1s and once 10ms a loaded host compared a `realpath` against "".
export const HELPER_DEADLINE_MS = 30_000;
// The process tests let descendants escape on purpose, and those descendants are
// reparented to pid 1 for the few seconds before the test reaps them. Only an escapee
// that has outlived that window is a leftover, so a suite running concurrently in
// another checkout keeps its own in-flight processes.
const STALE_ESCAPEE_MINIMUM_AGE_SECONDS = 120;

/**
 * A run that is killed mid-suite orphans its worker, the worker's bundled
 * children and the descendants the process tests deliberately let escape, and
 * leaves their temporary roots behind. Reclaim that state before the first
 * test so leftovers cannot collide with, or be mistaken for, this run's own
 * processes. Only orphans (reparented to pid 1) and temporary roots no live
 * process still names are reclaimed, so a concurrent suite is left alone: its
 * worker and bundled children always still have their live parent, and its
 * escaped descendants are younger than the age floor below.
 */
export async function releaseStaleWorkerState(): Promise<void> {
  const orphans = (await processSnapshot()).filter((entry) => entry.ppid === 1 && entry.pid !== process.pid
    && (entry.command.includes(workerPath)
      || entry.command.includes(temporaryPrefix)
      || (entry.command.startsWith(`${process.execPath} -e `)
        && entry.command.includes("setInterval(() => {}, 1000)")
        && entry.elapsedSeconds >= STALE_ESCAPEE_MINIMUM_AGE_SECONDS)));
  for (const orphan of orphans) terminateProcessGroup(orphan.pid);
  const deadline = Date.now() + STALE_STATE_TIMEOUT_MS;
  const remaining = new Set(orphans.map((orphan) => orphan.pid));
  while (remaining.size > 0 && Date.now() < deadline) {
    for (const pid of remaining) {
      try { process.kill(pid, 0); }
      catch { remaining.delete(pid); }
    }
    if (remaining.size > 0) await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const live = await processSnapshot();
  const released: string[] = [];
  const idleBefore = Date.now() - STALE_ESCAPEE_MINIMUM_AGE_SECONDS * 1000;
  for (const name of await readdir(tmpdir())) {
    const path = join(tmpdir(), name);
    if (!path.startsWith(temporaryPrefix)) continue;
    if (live.some((entry) => entry.command.includes(path))) continue;
    // Some roots are only ever named through a child's environment, so age is
    // the reliable second signal that nothing is still using this one.
    const metadata = await stat(path).catch(() => null);
    if (metadata === null || metadata.mtimeMs > idleBefore) continue;
    await rm(path, { recursive: true, force: true });
    released.push(name);
  }
  if (orphans.length > 0 || released.length > 0) {
    console.log(`[desktop-worker] released stale state: ${orphans.length} orphaned process(es)${
      remaining.size > 0 ? ` (${[...remaining].join(", ")} survived SIGKILL)` : ""
    }, ${released.length} temporary root(s)`);
  }
  assert.deepEqual([...remaining], [], "stale Desktop worker processes survived SIGKILL, so this run cannot start clean");
}

type ProcessEntry = { pid: number; ppid: number; elapsedSeconds: number; command: string };

async function processSnapshot(): Promise<readonly ProcessEntry[]> {
  if (process.platform === "win32") return [];
  // Reclaiming leftovers is hygiene, not a contract: the bounded waits below
  // are what keep a hang loud. An unreadable process table reports itself and
  // leaves the tests to run.
  let table: string;
  try { table = await runBoundedCommand("/bin/ps", ["-Aww", "-o", "pid=,ppid=,etime=,command="], STALE_STATE_TIMEOUT_MS); }
  catch (error) {
    console.log(`[desktop-worker] could not read the process table, skipping stale-process cleanup: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const entries: ProcessEntry[] = [];
  for (const line of table.split("\n")) {
    const fields = /^\s*(\d+)\s+(\d+)\s+((?:\d+-)?(?:\d+:)?\d+:\d+)\s+(.*)$/u.exec(line);
    if (!fields) continue;
    entries.push({
      pid: Number(fields[1]),
      ppid: Number(fields[2]),
      elapsedSeconds: elapsedSeconds(fields[3] ?? ""),
      command: fields[4] ?? "",
    });
  }
  return entries;
}

/** Reads `ps` elapsed time, formatted `[[dd-]hh:]mm:ss`, as whole seconds. */
function elapsedSeconds(value: string): number {
  const [days, clock] = value.includes("-") ? value.split("-") : ["0", value];
  let seconds = 0;
  for (const part of (clock ?? "").split(":")) seconds = seconds * 60 + Number(part);
  return Number(days) * 86_400 + seconds;
}

async function runBoundedCommand(executable: string, args: readonly string[], timeout: number): Promise<string> {
  const child = spawn(executable, [...args], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", () => {});
  const completion = new Promise<void>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", () => resolveExit());
  });
  try { await withDeadline(completion, `${basename(executable)} ${args.join(" ")}`, timeout); }
  catch (error) { child.kill("SIGKILL"); throw error; }
  return output;
}

export function terminateProcessGroup(pid: number): void {
  try { process.kill(-pid, "SIGKILL"); }
  catch { try { process.kill(pid, "SIGKILL"); } catch {} }
}

/**
 * Awaits one reported filesystem change, re-triggering it while the pull is
 * outstanding. `fs.watch` with `recursive: true` arms its macOS FSEvents
 * stream asynchronously on another thread, so a write that lands before the
 * stream starts is never reported — under concurrent load that happens for
 * roughly one pull in ten, and the pull then never settles.
 */
export async function reportedChange<T>(pull: Promise<T>, path: string, label: string): Promise<T> {
  let settled = false;
  const outcome = pull.finally(() => { settled = true; });
  const deadline = Date.now() + WATCHED_CHANGE_TIMEOUT_MS;
  while (!settled) {
    await writeFile(path, "const external = true\n", "utf8");
    if (Date.now() >= deadline) {
      throw new Error(`${label} never reported ${path} within ${WATCHED_CHANGE_TIMEOUT_MS} milliseconds of repeated changes; the operating-system watch is not delivering notifications for this root.`);
    }
    await Promise.race([outcome.catch(() => {}), new Promise((resolveWait) => setTimeout(resolveWait, WATCHED_CHANGE_RETRIGGER_MS))]);
  }
  return outcome;
}

function withDeadline<T>(value: Promise<T>, label: string, timeout = 5_000): Promise<T> {
  return new Promise<T>((resolveValue, rejectValue) => {
    const timer = setTimeout(() => rejectValue(new Error(`${label} did not settle within ${timeout} milliseconds`)), timeout);
    void value.then(
      result => { clearTimeout(timer); resolveValue(result); },
      error => { clearTimeout(timer); rejectValue(error); },
    );
  });
}

export class WorkerClient {
  private nextId = 1;
  private nextProjectRootCommandID = 1;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly projectRootUpdates = new Map<number, { resolve(): void; reject(error: Error): void }>();
  private readonly lifecycleEvents: Array<{ hostEvent: string; owner: string; handle: number; pid?: number; pids?: number[] }> = [];
  private readonly child: ChildProcessWithoutNullStreams;
  private owner = "00000000000000000000000000000001";

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    // A worker that never spawns (EAGAIN under concurrent load) emits 'error'
    // and never 'exit', and a broken pipe reports on the stream, so both have
    // to fail the outstanding calls instead of leaving them outstanding.
    child.once("error", (error) => this.failOutstanding(new Error(`Desktop worker could not be spawned or signalled: ${error.message}`)));
    child.stdin.on("error", (error) => this.failOutstanding(new Error(`Desktop worker request pipe failed: ${error.message}`)));
    child.stdout.on("error", (error) => this.failOutstanding(new Error(`Desktop worker response pipe failed: ${error.message}`)));
    this.writeHostCommand("owner-activate", this.owner);
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const message = JSON.parse(line) as { id: number; ok: boolean; value?: unknown; error?: string | { kind?: unknown; message?: unknown; phase?: unknown }; hostEvent?: string; owner?: string; handle?: number; pid?: number; pids?: number[]; commandID?: number };
      if (message.hostEvent === "project-root-settled" && Number.isSafeInteger(message.commandID)) {
        const update = this.projectRootUpdates.get(message.commandID as number);
        if (!update) return;
        this.projectRootUpdates.delete(message.commandID as number);
        if (message.ok) update.resolve();
        else update.reject(new Error(typeof message.error === "string" ? message.error : "Desktop project-root update failed"));
        return;
      }
      if ((message.hostEvent === "process-owned" || message.hostEvent === "process-settled")
        && Number.isSafeInteger(message.handle) && typeof message.owner === "string") {
        this.lifecycleEvents.push({ hostEvent: message.hostEvent, owner: message.owner, handle: message.handle as number,
          ...(Number.isSafeInteger(message.pid) ? {pid: message.pid} : {}),
          ...(Array.isArray(message.pids) && message.pids.every(Number.isSafeInteger) ? {pids: message.pids} : {}) });
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.ok) request.resolve(message.value);
      else if (message.error && typeof message.error === "object"
        && message.error.kind === "http-transport"
        && typeof message.error.message === "string"
        && (message.error.phase === "request" || message.error.phase === "response")) {
        const error = new Error(message.error.message) as Error & { kind?: string; phase?: string };
        error.kind = message.error.kind;
        error.phase = message.error.phase;
        request.reject(error);
      } else request.reject(new Error(typeof message.error === "string" ? message.error : "Desktop worker failed"));
    });
    child.once("exit", () => this.failOutstanding(new Error("Desktop worker exited")));
  }

  private failOutstanding(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    for (const update of this.projectRootUpdates.values()) update.reject(error);
    this.projectRootUpdates.clear();
  }

  /**
   * Every reply is bounded. Without this a reply the worker never sends — a
   * lost handshake, a wedged child, an OS notification that never armed —
   * parks the suite forever at 0% CPU with no output at all.
   */
  private deadline<T>(value: Promise<T>, label: string, timeout: number): Promise<T> {
    return withDeadline(value, label, timeout).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("did not settle within")) throw error;
      const state = this.child.exitCode !== null ? `exited with code ${this.child.exitCode}`
        : this.child.signalCode !== null ? `was killed by ${this.child.signalCode}`
        : "is still running and idle";
      throw new Error(`${error.message}; the Desktop worker (pid ${this.child.pid ?? 0}) ${state}. Likely causes: a stale worker or descendant orphaned by a killed run, a wedged bundled child holding the reply, or an operating-system notification that never arrived.`);
    });
  }

  call(capability: string, operation: string, args: readonly unknown[]): Promise<unknown> {
    return this.beginCall(capability, operation, args).result;
  }

  beginCall(capability: string, operation: string, args: readonly unknown[]): { id: number; result: Promise<unknown> } {
    const id = this.nextId++;
    const reply = new Promise<unknown>((resolveCall, rejectCall) => this.pending.set(id, { resolve: resolveCall, reject: rejectCall }));
    const result = this.deadline(reply, `Desktop worker call #${id} ${capability}.${operation}`, WORKER_CALL_TIMEOUT_MS)
      .finally(() => this.pending.delete(id));
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, id, owner: this.owner, capability, operation, args })}\n`);
    return { id, result };
  }

  cancelRequest(requestID: number): void {
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, hostCommand: "request-cancel", owner: this.owner, requestID })}\n`);
  }

  setProjectRoot(path: string): Promise<void> {
    const commandID = this.nextProjectRootCommandID++;
    const settled = new Promise<void>((resolveUpdate, rejectUpdate) => this.projectRootUpdates.set(commandID, { resolve: resolveUpdate, reject: rejectUpdate }));
    const result = this.deadline(settled, `Desktop project-root command #${commandID}`, WORKER_CALL_TIMEOUT_MS)
      .finally(() => this.projectRootUpdates.delete(commandID));
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, hostCommand: "project-root-set", owner: this.owner, commandID, path })}\n`);
    return result;
  }

  /**
   * What the native host does when a document is replaced: the outgoing
   * generation is retired and the incoming one activated. Activation alone no
   * longer retires anything, because a Desktop application may hold several
   * windows — several live generations — open at once.
   */
  replaceOwner(owner: string): void {
    this.writeHostCommand("owner-retire", this.owner);
    this.writeHostCommand("owner-activate", owner);
    this.owner = owner;
  }

  /** Adds a second live generation, the way opening a second window does. */
  addOwner(owner: string): void {
    this.writeHostCommand("owner-activate", owner);
    this.owner = owner;
  }

  /** Speaks as an already-live generation, without activating anything. */
  useOwner(owner: string): void {
    this.owner = owner;
  }

  /** Retires one generation, the way closing one window does. */
  retireOwnerNamed(owner: string): void {
    this.writeHostCommand("owner-retire", owner);
  }

  retireOwner(): void {
    this.writeHostCommand("owner-retire", this.owner);
  }

  lifecycle(): readonly { hostEvent: string; owner: string; handle: number; pid?: number; pids?: number[] }[] {
    return this.lifecycleEvents;
  }

  private writeHostCommand(hostCommand: string, owner: string): void {
    this.child.stdin.write(`${JSON.stringify({ protocolVersion: 1, hostCommand, owner })}\n`);
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    if (await this.waitForExit(2_000)) return;
    this.child.kill("SIGKILL");
    if (!await this.waitForExit(2_000)) throw new Error("Desktop worker did not exit after SIGKILL");
  }

  private waitForExit(timeout: number): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return Promise.resolve(true);
    return new Promise((resolveExit) => {
      const onExit = (): void => {
        clearTimeout(timer);
        resolveExit(true);
      };
      const timer = setTimeout(() => {
        this.child.off("exit", onExit);
        resolveExit(false);
      }, timeout);
      this.child.once("exit", onExit);
    });
  }
}

export function localServer(
  redirects?: { redirectOrigin: string; ungrantedOrigin: string },
  capture?: { providerKey?: string },
): Promise<Server> {
  const server = createServer((request, response) => {
    if (typeof request.headers["x-provider-key"] === "string" && capture) capture.providerKey = request.headers["x-provider-key"];
    if (request.url === "/secret-authorized") {
      const authorized = request.headers.authorization === "Bearer worker-only-token";
      response.writeHead(authorized ? 200 : 401, { "content-type": "text/plain" });
      response.end(authorized ? "authorized" : "denied");
      return;
    }
    if (request.url === "/echo-size") {
      let bytes = 0;
      request.on("data", (chunk) => { bytes += chunk.byteLength; });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(String(bytes));
      });
      return;
    }
    if (redirects && request.url === "/redirect-allowed") {
      response.writeHead(302, { location: `${redirects.redirectOrigin}/destination` });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-ungranted") {
      response.writeHead(302, { location: `${redirects.ungrantedOrigin}/destination` });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-loop") {
      response.writeHead(302, { location: "/redirect-loop" });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-secret") {
      response.writeHead(302, { location: `${redirects.redirectOrigin}/secret-target` });
      response.end();
      return;
    }
    if (redirects && request.url === "/redirect-error") {
      response.writeHead(302, { location: `${redirects.redirectOrigin}/error-target` });
      response.end();
      return;
    }
    if (request.url === "/error-target") {
      response.writeHead(502, { "content-type": "application/json" });
      response.end('{"failed":true}');
      return;
    }
    if (request.url === "/empty") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/declared-large") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.end("x");
      return;
    }
    if (request.url === "/transport-response") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 10);
      return;
    }
    if (request.url === "/slow-headers") {
      setTimeout(() => { response.writeHead(200, { "content-type": "text/plain" }); response.end("late"); }, 10000).unref();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    if (request.url === "/stream") {
      response.write("desktop-");
      setTimeout(() => response.end("ready"), 25);
    } else if (request.url === "/slow") {
      response.write("pending");
      setTimeout(() => response.end("late"), 10000).unref();
    } else {
      response.end("desktop-ready");
    }
  });
  return withDeadline(new Promise<Server>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(server));
  }), "the local Desktop worker test server listen", LOCAL_SERVER_TIMEOUT_MS);
}

export function closeServer(server: Server): Promise<void> {
  // close() alone waits for every open connection, and these handlers keep
  // deliberately slow responses in flight, so drop the sockets first.
  server.closeAllConnections();
  return withDeadline(
    new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
    "the local Desktop worker test server close",
    LOCAL_SERVER_TIMEOUT_MS,
  );
}

export function addressPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Desktop worker test server has no TCP port");
  return address.port;
}
