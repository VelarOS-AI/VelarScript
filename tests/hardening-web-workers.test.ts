import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { VELAR_WEB_WEBSOCKET_RUNTIME } from "../packages/web/src/websocket-runtime.ts";
import { VELAR_WEB_WORKER_RUNTIME } from "../packages/web/src/worker-runtime.ts";
import { webModuleSource, webModuleSources } from "../packages/web/src/runtime.ts";

// The Web worker and WebSocket runtimes ship as emitted module source, so a
// regression drives the real string: only the two `velar/*` imports become
// stubs, and the module runs against a fake native Worker or WebSocket that
// records what the runtime asked the platform to do.

const WORKER_STUBS = `
const __velarWorkerEntries = { probe: "probe.js" };
class CancellationError extends Error { constructor(message = "Worker call cancelled") { super(message); this.name = "CancellationError"; } }
class TaskTimeoutError extends Error { constructor(message = "Task timed out") { super(message); this.name = "TaskTimeoutError"; } }
const __velarTestCancellations = new WeakSet();
const Cancellation = {
  is(value) { return __velarTestCancellations.has(value); },
  __velarCreate() { const value = { listeners: new Set(), reason: null }; __velarTestCancellations.add(value); return value; },
  __velarCancel(value, reason) { value.reason = reason; for (const listener of value.listeners) listener(reason); },
  __velarOn(value, listener) { value.listeners.add(listener); return () => value.listeners.delete(listener); },
};
`;

const BINARY_STUB = `
const __velarWorkerBinaryRuntime = { __velarAdoptTransferredBuffer(value) { return value; } };
`;

const WEBSOCKET_TIMER_PRELUDE = `
const __velarTestTimers = globalThis.__velarWebSocketTestTimers;
const setTimeout = (handler, delay) => __velarTestTimers.set(handler, delay);
const clearTimeout = timer => __velarTestTimers.clear(timer);
`;

const anyType = Object.freeze({ is: () => true, parse: (value: unknown) => value });

interface WorkerHandle {
  call(request: unknown, cancellation: unknown, timeout: string | null): Promise<unknown>;
  close(): Promise<null>;
}

interface WorkerPoolHandle extends WorkerHandle {
  broadcast(request: unknown, cancellation: unknown, timeout: string | null): Promise<unknown[]>;
}

interface WorkerRuntime {
  worker(name: string, request: unknown, response: unknown, capacity?: number): WorkerHandle;
  workerPool(name: string, request: unknown, response: unknown, size: number, capacity?: number): WorkerPoolHandle;
  serveWorker(request: unknown, response: unknown, handler: (value: unknown, cancellation: unknown) => Promise<unknown>, capacity?: number): null;
}

interface WebSocketConnection {
  send(message: string | Uint8Array): Promise<null>;
  close(code?: number, reason?: string): Promise<null>;
  state(): string;
}

interface WebSocketRuntime {
  connect(url: string, options?: Record<string, unknown>): Promise<WebSocketConnection>;
}

interface WorkerMessage {
  readonly kind?: string;
  readonly id?: number;
  readonly value?: unknown;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  readonly messages: WorkerMessage[] = [];
  readonly transferLists: unknown[][] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  terminated = false;
  readonly url: URL;
  readonly options: unknown;
  constructor(url: URL, options: unknown) { this.url = url; this.options = options; FakeWorker.instances.push(this); }
  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  postMessage(message: WorkerMessage, transfers: unknown[] = []): void { this.messages.push(message); this.transferLists.push(transfers); }
  terminate(): void { this.terminated = true; }
  emit(type: string, event: unknown): void { for (const handler of this.listeners.get(type) ?? []) handler(event); }
  kinds(): (string | undefined)[] { return this.messages.map(message => message.kind); }
}

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readyState = FakeSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = "";
  readonly url: string;
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  send(payload: string | Uint8Array): void { this.bufferedAmount += typeof payload === "string" ? payload.length : payload.byteLength; }
  close(): void { this.readyState = FakeSocket.CLOSED; this.emit("close", {}); }
  emit(type: string, event: unknown): void { for (const handler of this.listeners.get(type) ?? []) handler(event); }
}

class TestTimers {
  live = 0;
  peak = 0;
  fired = 0;
  private nextId = 1;
  private readonly timers = new Map<number, NodeJS.Timeout>();
  set(handler: () => void, delay: number): number {
    const id = this.nextId++;
    this.live += 1;
    this.peak = Math.max(this.peak, this.live);
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      this.live -= 1;
      this.fired += 1;
      handler();
    }, delay));
    return id;
  }
  clear(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    this.timers.delete(id);
    this.live -= 1;
    clearTimeout(timer);
  }
  reset(): void { this.peak = 0; this.fired = 0; }
}

let scratch: string | null = null;
let loaded = 0;

test("the Web worker runtime is enumerable for development import maps", () => {
  assert.equal(webModuleSources.get("velar/worker"), VELAR_WEB_WORKER_RUNTIME);
  assert.equal(webModuleSource("velar/worker"), VELAR_WEB_WORKER_RUNTIME);
});

test("worker messages transfer the one validated buffer snapshot and adopt valid replies without reparsing", async () => {
  const runtime = await loadWorkerRuntime();
  let parsedRequest: { data: Uint8Array } | null = null;
  let responseParses = 0;
  const RequestType = {
    is: () => true,
    parse(value: { data: Uint8Array }) {
      parsedRequest = { data: new Uint8Array(value.data) };
      return parsedRequest;
    },
  };
  const ResponseType = {
    is: (value: unknown) => typeof value === "object" && value !== null && "data" in value,
    parse(value: unknown) { responseParses += 1; return value; },
  };
  const handle = runtime.worker("probe", RequestType, ResponseType, 2);
  const instance = FakeWorker.instances[0];
  assert.ok(instance);
  const source = { data: new Uint8Array([1, 2, 3]) };
  const pending = handle.call(source, null, null);
  const sent = instance.messages[0];
  const validatedRequest = parsedRequest as { data: Uint8Array } | null;
  assert.ok(validatedRequest);
  assert.equal(sent?.value, validatedRequest, "the validated snapshot is the transferred payload, not a second clone");
  assert.equal(instance.transferLists[0]?.[0], validatedRequest.data.buffer);
  assert.equal(source.data.byteLength, 3, "caller-owned input is never selected for transfer");

  const reply = { data: new Uint8Array([4, 5]) };
  instance.emit("message", { data: { id: sent?.id, ok: true, value: reply } });
  assert.equal(await pending, reply, "a valid received graph is already worker-owned");
  assert.equal(responseParses, 0, "valid replies are not copied again through Type.parse");
  await handle.close();
});

async function moduleUrl(source: string): Promise<string> {
  scratch ??= await mkdtemp(join(tmpdir(), "velar-web-workers-"));
  const file = join(scratch, "runtime-" + String(loaded++) + ".mjs");
  await writeFile(file, source);
  return pathToFileURL(file).href;
}

async function loadWorkerRuntime(): Promise<WorkerRuntime> {
  const source = VELAR_WEB_WORKER_RUNTIME
    .replace('import { workerEntries as __velarWorkerEntries } from "velar/worker-manifest";', "")
    .replace('import { Cancellation, CancellationError, TaskTimeoutError } from "velar/task";', WORKER_STUBS)
    .replace('import { Bytes as __velarWorkerBinaryRuntime } from "velar/binary";', BINARY_STUB);
  const url = await moduleUrl(source);
  FakeWorker.instances = [];
  const previous = Reflect.get(globalThis, "Worker") as unknown;
  Reflect.set(globalThis, "Worker", FakeWorker);
  try {
    return await import(url) as WorkerRuntime;
  } finally {
    Reflect.set(globalThis, "Worker", previous);
  }
}

async function loadWebSocketRuntime(timers: TestTimers): Promise<WebSocketRuntime> {
  const url = await moduleUrl(WEBSOCKET_TIMER_PRELUDE + VELAR_WEB_WEBSOCKET_RUNTIME);
  FakeSocket.instances = [];
  const previous = Reflect.get(globalThis, "WebSocket") as unknown;
  Reflect.set(globalThis, "WebSocket", FakeSocket);
  Reflect.set(globalThis, "__velarWebSocketTestTimers", timers);
  try {
    return await import(url) as WebSocketRuntime;
  } finally {
    Reflect.set(globalThis, "WebSocket", previous);
  }
}

async function openSocket(runtime: WebSocketRuntime): Promise<{ connection: WebSocketConnection; socket: FakeSocket }> {
  const opening = runtime.connect("wss://example.test/socket");
  const socket = FakeSocket.instances[0];
  assert.ok(socket, "the runtime constructs the native socket");
  socket.readyState = FakeSocket.OPEN;
  socket.emit("open", {});
  return { connection: await opening, socket };
}

function settle<Value>(promise: Promise<Value>): { outcome(): string } {
  let outcome = "pending";
  promise.then(() => { outcome = "resolved"; }, (error: Error) => { outcome = error.name; });
  return { outcome: () => outcome };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, milliseconds); });
}

// web-6: a crashed pool member kept an empty pending map, so the least-loaded
// selection picked the dead worker for every later call.
test("a crashed pool member is terminated and later pool calls reach live members", async () => {
  const runtime = await loadWorkerRuntime();
  const pool = runtime.workerPool("probe", anyType, anyType, 4);
  const members = FakeWorker.instances.slice();
  assert.equal(members.length, 4);
  const crashed = members[1];
  assert.ok(crashed);
  crashed.emit("error", { message: "boom" });
  assert.equal(crashed.terminated, true);
  const calls = Array.from({ length: 5 }, () => settle(pool.call({}, null, null)));
  await delay(10);
  assert.deepEqual(calls.map(call => call.outcome()), ["pending", "pending", "pending", "pending", "pending"]);
  assert.equal(crashed.messages.length, 0);
  const delivered = members.reduce((sum, member) => sum + member.messages.length, 0);
  assert.equal(delivered, 5);
  await pool.close();
  await delay(0);
});

// web-6: with every member crashed the pool reports that, rather than routing
// to a dead member and reporting it as closed.
test("a pool whose members have all crashed rejects with a distinct error", async () => {
  const runtime = await loadWorkerRuntime();
  const pool = runtime.workerPool("probe", anyType, anyType, 2);
  for (const member of FakeWorker.instances) member.emit("error", { message: "boom" });
  await assert.rejects(pool.call({}, null, null), (error: Error) => {
    assert.equal(error.name, "WorkerCrashedError");
    assert.equal(error.message, "Worker pool has no live workers");
    return true;
  });
  await pool.close();
});

test("a pool broadcast reaches each live member once and preserves member order", async () => {
  const runtime = await loadWorkerRuntime();
  const pool = runtime.workerPool("probe", anyType, anyType, 3, 6);
  const members = FakeWorker.instances.slice();
  const pending = pool.broadcast({ operation: "initialize" }, null, null);
  assert.deepEqual(members.map(member => member.messages.length), [1, 1, 1]);
  for (let index = members.length - 1; index >= 0; index -= 1) {
    const member = members[index];
    assert.ok(member);
    const request = member.messages[0];
    member.emit("message", { data: { id: request?.id, ok: true, value: { member: index } } });
  }
  assert.deepEqual(await pending, [{ member: 0 }, { member: 1 }, { member: 2 }]);
  await pool.close();
});

test("a pool broadcast checks aggregate capacity before dispatching any member", async () => {
  const runtime = await loadWorkerRuntime();
  const pool = runtime.workerPool("probe", anyType, anyType, 2, 3);
  const occupied = [
    settle(pool.call({ operation: "work" }, null, null)),
    settle(pool.call({ operation: "work" }, null, null)),
  ];
  await assert.rejects(pool.broadcast({ operation: "initialize" }, null, null), (error: Error) => {
    assert.equal(error.name, "WorkerBackpressureError");
    assert.match(error.message, /cannot accept a broadcast to 2 workers/u);
    return true;
  });
  assert.equal(FakeWorker.instances.reduce((total, member) => total + member.messages.length, 0), 2);
  await pool.close();
  await delay(0);
  assert.deepEqual(occupied.map(call => call.outcome()), ["WorkerClosedError", "WorkerClosedError"]);
});

// web-7: the timeout only posted a cancel and waited for a reply, so a worker
// that never answered left the caller pending and its capacity slot taken.
test("a worker call timeout rejects the caller and frees its capacity slot", async () => {
  const runtime = await loadWorkerRuntime();
  const worker = runtime.worker("probe", anyType, anyType, 2);
  const instance = FakeWorker.instances[0];
  assert.ok(instance);
  const started = Date.now();
  await assert.rejects(worker.call({}, null, "50ms"), (error: Error) => {
    assert.equal(error.name, "TaskTimeoutError");
    assert.equal(error.message, "Worker call timed out after 50ms");
    return true;
  });
  assert.ok(Date.now() - started < 500, "the timeout is a real bound");
  assert.deepEqual(instance.kinds(), ["call", "cancel"]);
  await assert.rejects(worker.call({}, null, "50ms"), (error: Error) => error.name === "TaskTimeoutError");
  const third = settle(worker.call({}, null, null));
  await delay(10);
  assert.equal(third.outcome(), "pending");
  assert.equal(instance.messages.length, 5);
  await worker.close();
  await delay(0);
});

// web-7: a worker that never acknowledges the cancel is terminated once the
// grace window passes; one that acknowledges keeps serving.
test("an unacknowledged cancel terminates the worker and an acknowledged one does not", async () => {
  const silent = await loadWorkerRuntime();
  const silentWorker = silent.worker("probe", anyType, anyType, 2);
  const silentInstance = FakeWorker.instances[0];
  assert.ok(silentInstance);
  const responsive = await loadWorkerRuntime();
  const responsiveWorker = responsive.worker("probe", anyType, anyType, 2);
  const responsiveInstance = FakeWorker.instances[0];
  assert.ok(responsiveInstance);
  const silentTimeout = settle(silentWorker.call({}, null, "20ms"));
  const responsiveTimeout = settle(responsiveWorker.call({}, null, "20ms"));
  const silentPending = settle(silentWorker.call({}, null, null));
  await delay(60);
  assert.equal(silentTimeout.outcome(), "TaskTimeoutError");
  assert.equal(responsiveTimeout.outcome(), "TaskTimeoutError");
  const cancelled = responsiveInstance.messages.find(message => message.kind === "cancel");
  assert.ok(cancelled);
  responsiveInstance.emit("message", { data: { id: cancelled.id, kind: "cancel-ack" } });
  await delay(1200);
  assert.equal(silentInstance.terminated, true, "a worker that ignores the cancel is terminated");
  assert.equal(silentPending.outcome(), "WorkerCrashedError");
  assert.equal(responsiveInstance.terminated, false, "an acknowledged cancel leaves the worker running");
  await responsiveWorker.close();
  await delay(0);
});

// web-7: the acknowledgement the client waits for is what `serveWorker` sends,
// so a cooperative but slow handler is never mistaken for a wedged worker.
test("serveWorker acknowledges a cancel before the handler finishes", async () => {
  const runtime = await loadWorkerRuntime();
  const posted: WorkerMessage[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const previousAdd = Reflect.get(globalThis, "addEventListener") as unknown;
  const previousPost = Reflect.get(globalThis, "postMessage") as unknown;
  Reflect.set(globalThis, "addEventListener", (type: string, handler: (event: unknown) => void) => { if (type === "message") listeners.push(handler); });
  Reflect.set(globalThis, "postMessage", (message: WorkerMessage) => { posted.push(message); });
  try {
    runtime.serveWorker(anyType, anyType, () => new Promise(() => undefined));
    const listener = listeners[0];
    assert.ok(listener);
    listener({ data: { kind: "call", id: 1, value: {} } });
    await delay(0);
    listener({ data: { kind: "cancel", id: 1, reason: "Worker call timed out" } });
    assert.deepEqual(posted, [{ id: 1, kind: "cancel-ack" }]);
  } finally {
    Reflect.set(globalThis, "addEventListener", previousAdd);
    Reflect.set(globalThis, "postMessage", previousPost);
  }
});

// web-32: every send used to own a 1 ms poller that only resolved when the
// whole socket buffer emptied.
test("concurrent sends share one drain watcher and complete in send order", async () => {
  const timers = new TestTimers();
  const runtime = await loadWebSocketRuntime(timers);
  const { connection, socket } = await openSocket(runtime);
  timers.reset();
  const order: string[] = [];
  const first = connection.send("a").then(() => { order.push("first"); return null; });
  const rest = Array.from({ length: 9 }, (unused, index) => connection.send("bbbbbbbbbb").then(() => { order.push("later" + String(index)); return null; }));
  assert.equal(socket.bufferedAmount, 91);
  assert.equal(timers.peak, 1, "ten in-flight sends share one drain watcher");
  socket.bufferedAmount = 90;
  await first;
  assert.deepEqual(order, ["first"], "a message resolves when its own bytes have left, not when the socket empties");
  assert.equal(timers.peak, 1);
  socket.bufferedAmount = 0;
  await Promise.all(rest);
  assert.equal(order.length, 10);
  assert.equal(timers.peak, 1);
  assert.ok(timers.fired < 40, "the shared watcher backs off instead of polling every millisecond");
  assert.equal(timers.live, 0, "the watcher stops once every send has drained");
});

// web-32: the close and error paths still settle whatever the shared watcher
// is holding.
test("closing or failing a socket rejects the sends still in flight", async () => {
  const timers = new TestTimers();
  const runtime = await loadWebSocketRuntime(timers);
  const closing = await openSocket(runtime);
  const pending = closing.connection.send("hello");
  assert.equal(timers.live, 1);
  closing.socket.close();
  await assert.rejects(pending, (error: Error) => error.name === "WebSocketClosedError");
  assert.equal(timers.live, 0, "closing stops the drain watcher");
  FakeSocket.instances = [];
  const failing = await openSocket(runtime);
  const dropped = failing.connection.send("hello");
  failing.socket.emit("error", {});
  await assert.rejects(dropped, (error: Error) => error.name === "WebSocketClosedError");
  assert.equal(timers.live, 0);
});

// wr-1: the shared watcher backs off to 32 ms, so a send can flush completely
// and the connection can finish before the watcher next looks. Failing every
// waiter without consulting the flush watermark reported a delivered send as
// WebSocketClosedError.
test("finishing a socket resolves the sends whose bytes already left and rejects only the buffered rest", async () => {
  const timers = new TestTimers();
  const runtime = await loadWebSocketRuntime(timers);
  const closing = await openSocket(runtime);
  const closeDelivered = closing.connection.send("hello");
  const closeBuffered = closing.connection.send("world!!");
  assert.equal(closing.socket.bufferedAmount, 12);
  closing.socket.bufferedAmount = 7;
  closing.socket.close();
  assert.equal(await closeDelivered, null, "bytes that left the socket stay sent when the close lands inside the watcher's window");
  await assert.rejects(closeBuffered, (error: Error) => error.name === "WebSocketClosedError");
  assert.equal(timers.live, 0, "closing stops the drain watcher");
  FakeSocket.instances = [];
  const failing = await openSocket(runtime);
  const failDelivered = failing.connection.send("hello");
  const failBuffered = failing.connection.send("world!!");
  failing.socket.bufferedAmount = 7;
  failing.socket.emit("error", {});
  assert.equal(await failDelivered, null, "a socket error does not un-send bytes that already left");
  await assert.rejects(failBuffered, (error: Error) => error.name === "WebSocketClosedError");
  assert.equal(timers.live, 0);
});
