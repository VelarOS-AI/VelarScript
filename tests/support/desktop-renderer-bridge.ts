import { join } from "node:path";

/**
 * D115 §一.6 / §二 — the Desktop renderer bridge double, and the reason it is
 * a module rather than a literal inside a test.
 *
 * `velar/process`, `velar/fs`, `velar/http`, `velar/path`, `velar/env` and
 * `velar/desktop` are all published to the renderer as proxies over one
 * `invoke(capability, operation, args, timeout)` call, so a test of any of them
 * is a test of what that call answers. The answers below are that answer table:
 * every handle, chunk, poisoned accessor and retriable failure the renderer
 * proxy tests drive their assertions from.
 *
 * It stood inside `tests/desktop/desktop-runtime.test.ts` as one 197-line
 * `invoke` method — the last function on D115's allowlist and the reason that
 * file could not come under the 800-line cap. The table is unchanged; what is
 * new is that it answers per capability, in four functions a reader can hold,
 * and that the counters the tests assert on are named in one place.
 */

/** One recorded call through the bridge, in arrival order. */
export type DesktopBridgeCall = { capability: string; operation: string; args: readonly unknown[]; timeout: number };

/**
 * What the double counts. Every field is something a test asserts on: a
 * `hostile*Reads` that must stay 0 proves the proxy never read an accessor the
 * application planted, and a retry counter proves it did read one it owns.
 */
export type DesktopBridgeState = {
  pendingProcessReadDelivered: boolean;
  hostileResponseReads: number;
  hostileProcessReads: number;
  hostileFilesystemReads: number;
  retriableProcessStops: number;
  retriableProcessWaits: number;
  transportProcessWaits: number;
  retainedRunStops: number;
  invalidProcessWaits: number;
  malformedWatcherCloses: number;
  currentProjectDirectory: string;
  selectedProjectDirectory: string | null;
};

/** Everything the four answer tables share, handed to each one explicitly. */
type DesktopBridgeInternals = {
  readonly directory: string;
  readonly calls: DesktopBridgeCall[];
  readonly processChunks: Map<number, unknown[]>;
  readonly httpChunks: Map<number, unknown[]>;
  readonly httpResponseFailures: Set<number>;
  readonly pendingRequests: Map<number, { reject(error: Error): void }>;
  readonly pendingProcessRead: { resolve: ((value: unknown) => void) | null };
  readonly stopWaitRace: { reject: ((error: Error) => void) | null };
  readonly state: DesktopBridgeState;
};

/** The shape a Desktop renderer finds on `globalThis` and calls everything through. */
export type DesktopBridge = {
  readonly platform: string;
  readonly packaged: boolean;
  readonly projectDirectory: string;
  projectDirectoryValue(): string;
  readonly environment: Readonly<Record<string, string>>;
  invoke(capability: string, operation: string, args: readonly unknown[], timeout?: number): Promise<unknown>;
};

/** The bridge, and the three things a test reads back out of it. */
export type DesktopBridgeDouble = {
  readonly bridge: DesktopBridge;
  readonly calls: DesktopBridgeCall[];
  readonly pendingProcessRead: { resolve: ((value: unknown) => void) | null };
  readonly state: DesktopBridgeState;
};

/**
 * "This capability has no answer here" — distinct from every value the tables
 * return, so the dispatcher can fall through to the next one and, past the
 * last, to the same rejection the single `invoke` always raised.
 */
const UNHANDLED = Symbol("velar.desktop.bridge.unhandled");

function transportFailure(phase: "request" | "response"): Error {
  const error = new Error(phase === "request" ? "HTTP request transport failed" : "HTTP response transport failed");
  Object.defineProperty(error, "name", { value: "VelarDesktopHttpTransportError" });
  Object.defineProperty(error, "phase", { value: phase, enumerable: true });
  return error;
}

/** `velar/desktop`'s own operations: the three roots and the picker. */
function invokeDesktop(internals: DesktopBridgeInternals, capability: string, operation: string, _args: readonly unknown[]): unknown {
  const { directory, state } = internals;
  if (capability === "desktop") {
    if (operation === "homeDirectory") return "/home/test";
    if (operation === "appDataDirectory") return "/app-data/test";
    if (operation === "projectDirectory") return state.currentProjectDirectory;
    if (operation === "selectedProjectDirectory") return state.selectedProjectDirectory;
    if (operation === "selectProjectDirectory") {
      state.selectedProjectDirectory = join(directory, "selected");
      state.currentProjectDirectory = state.selectedProjectDirectory;
      return state.selectedProjectDirectory;
    }
  }
  return UNHANDLED;
}

/** `velar/process`: start, read, wait and stop, including every retriable and hostile shape. */
function invokeProcess(internals: DesktopBridgeInternals, capability: string, operation: string, args: readonly unknown[]): unknown {
  const { pendingProcessRead, processChunks, state, stopWaitRace } = internals;
  if (capability === "process" && operation === "start") {
    if (args[0] === "hostile-start") {
      return Object.defineProperty({ pid: 700 }, "handle", {
        enumerable: true,
        get() { state.hostileProcessReads += 1; return 8; },
      });
    }
    if (args[0] === "hostile-wait") return { handle: 8, pid: 700 };
    if (args[0] === "stream") {
      processChunks.set(9, [{ channel: "stdout", text: "one" }, { channel: "stderr", text: "two" }, null]);
      return { handle: 9, pid: 701 };
    }
    if (args[0] === "hostile-read") return { handle: 10, pid: 702 };
    if (args[0] === "pending-read") return { handle: 11, pid: 703 };
    if (args[0] === "retry-stop") return { handle: 12, pid: 704 };
    if (args[0] === "failed-stop") return { handle: 13, pid: 705 };
    if (args[0] === "retry-wait") return { handle: 14, pid: 706 };
    if (args[0] === "retry-run") return { handle: 15, pid: 707 };
    if (args[0] === "transport-wait") return { handle: 16, pid: 708 };
    if (args[0] === "invalid-wait") return { handle: 18, pid: 710 };
    if (args[0] === "stop-wait-race") return { handle: 19, pid: 711 };
    return { handle: 7, pid: 700 };
  }
  if (capability === "process" && operation === "read") {
    if (args[0] === 10) {
      return Object.defineProperty({ channel: "stdout" }, "text", {
        enumerable: true,
        get() { state.hostileProcessReads += 1; return "unsafe"; },
      });
    }
    if (args[0] === 11) {
      if (state.pendingProcessReadDelivered) return null;
      state.pendingProcessReadDelivered = true;
      return new Promise((resolve) => { pendingProcessRead.resolve = resolve; });
    }
    const chunks = processChunks.get(args[0] as number);
    if (!chunks?.length) return null;
    return chunks.shift();
  }
  if (capability === "process" && operation === "wait") {
    if (args[0] === 8) {
      return {
        result: Object.defineProperty({ code: 0, signal: null, stderr: "" }, "stdout", {
          enumerable: true,
          get() { state.hostileProcessReads += 1; return "unsafe"; },
        }),
        error: null,
        retained: false,
      };
    }
    if (args[0] === 9) return { result: { code: 0, signal: null, stdout: "one", stderr: "two" }, error: null, retained: false };
    if (args[0] === 14 && state.retriableProcessWaits++ === 0) {
      return { result: null, error: { name: "Error", message: "termination unconfirmed" }, retained: true };
    }
    if (args[0] === 15) return { result: null, error: { name: "Error", message: "run cleanup unconfirmed" }, retained: true };
    if (args[0] === 16 && state.transportProcessWaits++ === 0) throw new Error("process wait transport failed");
    if (args[0] === 18 && state.invalidProcessWaits++ === 0) {
      return { result: { code: 0, signal: null, stdout: "invalid", stderr: "" }, error: null, retained: true };
    }
    if (args[0] === 19) return new Promise((_resolve, reject) => { stopWaitRace.reject = reject; });
    return { result: { code: 0, signal: null, stdout: "ready", stderr: "" }, error: null, retained: false };
  }
  if (capability === "process" && operation === "stop") {
    if (args[0] === 12 && state.retriableProcessStops++ === 0) throw new Error("termination unconfirmed");
    if (args[0] === 13) return { result: null, error: { name: "Error", message: "Process timed out before termination" } };
    if (args[0] === 15) state.retainedRunStops += 1;
    if (args[0] === 19) setImmediate(() => stopWaitRace.reject?.(new Error("process handle is unknown or already released")));
    return { result: { code: null, signal: "SIGTERM", stdout: "", stderr: "" }, error: null };
  }
  return UNHANDLED;
}

/** `velar/fs`: the watcher, the readers, and the results that are the wrong shape on purpose. */
function invokeFilesystem(internals: DesktopBridgeInternals, capability: string, operation: string, args: readonly unknown[]): unknown {
  const { state } = internals;
  if (capability === "fs") {
    const path = args[0];
    if (operation === "watchStart") return path === "malformed-watch" ? 42 : 41;
    if (operation === "watchNext") return args[0] === 42
      ? { paths: ["/project/z.vel", "/project/a.vel"], rescan: false }
      : { paths: ["/project/note.txt"], rescan: false };
    if (operation === "watchClose") {
      if (args[0] === 42) state.malformedWatcherCloses += 1;
      return true;
    }
    if (operation === "readText") return path === "oversized.txt" ? "too large" : "value";
    if (operation === "replaceTextIfMatches") return path === "invalid-replace" ? "yes" : true;
    if (operation === "exists") return path === "invalid-exists" ? "yes" : true;
    if (operation === "list") {
      if (path === "hostile-list") {
        const value: string[] = [];
        Object.defineProperty(value, "0", { enumerable: true, get() { state.hostileFilesystemReads += 1; return "unsafe"; } });
        value.length = 1;
        return value;
      }
      return ["zeta", "alpha"];
    }
    if (operation === "info") {
      if (path === "hostile-info") {
        return Object.defineProperty({ kind: "file", size: 1, modifiedAt: 0 }, "name", {
          enumerable: true,
          get() { state.hostileFilesystemReads += 1; return "unsafe"; },
        });
      }
      return { name: "note.txt", kind: "file", size: 5, modifiedAt: 0 };
    }
    if (operation === "canonical") return "/project/note.txt";
    if (operation === "writeText" && path === "bad-result") return {};
    return null;
  }
  return UNHANDLED;
}

/** `velar/http`: one URL suffix per response shape, plus the chunk stream and the cancellation. */
function invokeHttp(internals: DesktopBridgeInternals, capability: string, operation: string, args: readonly unknown[]): unknown {
  const { httpChunks, httpResponseFailures, pendingRequests, state } = internals;
  if (capability === "http" && operation === "request") {
    const handle = args[0] as number;
    const url = args[2] as string;
    if (url.endsWith("/transport-request")) throw transportFailure("request");
    if (url.endsWith("/transport-response")) {
      httpResponseFailures.add(handle);
      return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
    }
    if (url.endsWith("/pending")) {
      return new Promise((_resolve, reject) => pendingRequests.set(handle, { reject }));
    }
    if (url.endsWith("/hostile-response")) {
      return Object.defineProperty({ ok: true, statusText: "OK", url, headers: [], body: false }, "status", {
        enumerable: true,
        get() { state.hostileResponseReads += 1; return 200; },
      });
    }
    if (url.endsWith("/invalid-response")) {
      return { ok: true, status: 200, statusText: "OK", url, headers: [], body: "yes" };
    }
    if (url.endsWith("/status-zero")) {
      return { ok: false, status: 0, statusText: "", url, headers: [], body: false };
    }
    if (url.endsWith("/inconsistent-status")) {
      return { ok: true, status: 500, statusText: "Internal Server Error", url, headers: [], body: false };
    }
    if (url.endsWith("/redirect-error")) {
      httpChunks.set(handle, [
        { done: false, text: '{"failed":true}' },
        { done: true, text: "" },
      ]);
      return {
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        url: "https://final.example.test/failure",
        headers: [["content-type", "application/json"]],
        body: true,
      };
    }
    if (url.endsWith("/empty")) {
      return { ok: true, status: 204, statusText: "No Content", url, headers: [], body: false };
    }
    if (url.endsWith("/too-many-chunks")) {
      httpChunks.set(handle, [
        { done: false, text: "" }, { done: false, text: "" },
        { done: false, text: "" }, { done: false, text: "" },
        { done: true, text: "" },
      ]);
      return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
    }
    if (url.endsWith("/invalid-chunk")) {
      httpChunks.set(handle, [{ done: false, text: "", extra: true }]);
      return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
    }
    if (url.endsWith("/cancel-final")) {
      httpChunks.set(handle, [{ done: true, text: "final" }]);
      return { ok: true, status: 200, statusText: "OK", url, headers: [], body: true };
    }
    const typed = url.endsWith("/typed");
    const lossy = typed || url.endsWith("/lossy-json") || url.endsWith("/lossy-error");
    httpChunks.set(handle, lossy
      ? [{ done: false, text: typed ? '{"name":"Ada"}' : url.endsWith("/lossy-json") ? '{"value":1e400}' : "1e400" }, { done: true, text: "" }]
      : [{ done: false, text: "first " }, { done: false, text: "chunk" }, { done: true, text: "" }]);
    const failed = url.endsWith("/lossy-error");
    return { ok: !failed, status: failed ? 500 : 200, statusText: failed ? "Internal Server Error" : "OK", url, headers: [["content-type", lossy ? "application/json" : "text/plain"]], body: true };
  }
  if (capability === "http" && operation === "read") {
    if (httpResponseFailures.delete(args[0] as number)) throw transportFailure("response");
    const chunks = httpChunks.get(args[0] as number);
    if (!chunks?.length) throw new Error("missing HTTP chunk");
    return chunks.shift();
  }
  if (capability === "http" && operation === "cancel") {
    pendingRequests.get(args[0] as number)?.reject(new Error("HTTP request cancelled"));
    pendingRequests.delete(args[0] as number);
    return null;
  }
  return UNHANDLED;
}

export function desktopBridgeDouble(directory: string): DesktopBridgeDouble {
  const internals: DesktopBridgeInternals = {
    directory,
    calls: [],
    processChunks: new Map<number, unknown[]>(),
    httpChunks: new Map<number, unknown[]>(),
    httpResponseFailures: new Set<number>(),
    pendingRequests: new Map<number, { reject(error: Error): void }>(),
    pendingProcessRead: { resolve: null as ((value: unknown) => void) | null },
    stopWaitRace: { reject: null as ((error: Error) => void) | null },
    state: {
      pendingProcessReadDelivered: false,
      hostileResponseReads: 0,
      hostileProcessReads: 0,
      hostileFilesystemReads: 0,
      retriableProcessStops: 0,
      retriableProcessWaits: 0,
      transportProcessWaits: 0,
      retainedRunStops: 0,
      invalidProcessWaits: 0,
      malformedWatcherCloses: 0,
      currentProjectDirectory: directory,
      selectedProjectDirectory: null,
    },
  };
  const bridge: DesktopBridge = Object.freeze({
    platform: "test",
    packaged: false,
    projectDirectory: directory,
    projectDirectoryValue() { return internals.state.currentProjectDirectory; },
    environment: Object.freeze({ LANG: "en_US.UTF-8" }),
    async invoke(capability: string, operation: string, args: readonly unknown[], timeout = 30000): Promise<unknown> {
      internals.calls.push({ capability, operation, args, timeout });
      for (const answer of [invokeDesktop, invokeProcess, invokeFilesystem, invokeHttp]) {
        const value = answer(internals, capability, operation, args);
        if (value !== UNHANDLED) return value;
      }
      throw new Error(`Unexpected Desktop bridge call ${capability}.${operation}`);
    },
  });
  return { bridge, calls: internals.calls, pendingProcessRead: internals.pendingProcessRead, state: internals.state };
}
