export const VELAR_WEB_WORKER_RUNTIME = String.raw`
import { workerEntries as __velarWorkerEntries } from "velar/worker-manifest";
import { Cancellation, CancellationError, TaskTimeoutError } from "velar/task";
import { Bytes as __velarWorkerBinaryRuntime } from "velar/binary";

const __velarNativeWorker = globalThis.Worker;
const __velarWorkerStates = new WeakMap();
const __velarWorkerPoolStates = new WeakMap();
let __velarWorkerServerInstalled = false;
const __velarWorkerStructuredClone = globalThis.structuredClone;
const __velarWorkerCancelGrace = 1000;
function __velarWorkerInteger(value, minimum, maximum, name) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(name + " must be an integer from " + minimum + " through " + maximum); return value; }
function __velarWorkerRuntimeType(value, name) { if ((typeof value !== "object" && typeof value !== "function") || value === null || typeof value.parse !== "function" || typeof value.is !== "function") throw new TypeError(name + " must be a runtime Type"); return value; }
function __velarWorkerDuration(value) { if (value === null) return 0; if (typeof value !== "string") throw new TypeError("Worker timeout must be Duration or null"); const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(value); if (!match) throw new TypeError("Worker timeout must be Duration such as 200ms or 2s"); const milliseconds = Number(match[1]) * (match[2] === "s" ? 1000 : 1); if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2147483647) throw new RangeError("Worker timeout is outside the supported range"); return milliseconds; }
function __velarWorkerTransfer(value, adopt = false) {
  const transfers = []; const buffers = new Set(); const objects = new Set(); const pending = [{ value, depth: 0 }]; let visited = 0; let transferBytes = 0;
  while (pending.length > 0 && visited < 10000 && transfers.length < 1024) {
    const current = pending.pop(); const item = current.value; visited += 1;
    if (item === null || (typeof item !== "object" && typeof item !== "function") || objects.has(item)) continue; objects.add(item);
    if (ArrayBuffer.isView(item)) { const supported = item instanceof Uint8Array || item instanceof Uint16Array || item instanceof Uint32Array || item instanceof Float32Array; const buffer = item.buffer; if (supported && buffer instanceof ArrayBuffer && item.byteOffset === 0 && item.byteLength === buffer.byteLength && transferBytes + buffer.byteLength <= 64 * 1024 * 1024) { if (adopt) __velarWorkerBinaryRuntime.__velarAdoptTransferredBuffer(item); if (buffer.byteLength > 0 && !buffers.has(buffer)) { buffers.add(buffer); transfers.push(buffer); transferBytes += buffer.byteLength; } } continue; }
    if (current.depth >= 32) continue; const depth = current.depth + 1;
    if (item instanceof Map) { for (const [key, nested] of item) pending.push({ value: key, depth }, { value: nested, depth }); continue; }
    if (item instanceof Set) { for (const nested of item) pending.push({ value: nested, depth }); continue; }
    for (const key of Object.keys(item)) pending.push({ value: item[key], depth });
  }
  return transfers;
}
function __velarWorkerOutbound(value, source) {
  const transfers = __velarWorkerTransfer(value);
  if (transfers.length === 0) return { value, transfers };
  const sourceTransfers = new Set(__velarWorkerTransfer(source));
  if (!transfers.some(buffer => sourceTransfers.has(buffer))) return { value, transfers };
  if (typeof __velarWorkerStructuredClone !== "function") throw new Error("The structured clone API is unavailable");
  const snapshot = __velarWorkerStructuredClone(value);
  return { value: snapshot, transfers: __velarWorkerTransfer(snapshot) };
}
function __velarWorkerInbound(Type, value) {
  if (!Type.is(value)) return Type.parse(value);
  __velarWorkerTransfer(value, true);
  return value;
}
function __velarWorkerFailure(error) { return { name: typeof error?.name === "string" ? error.name : "Error", message: typeof error?.message === "string" ? error.message : String(error), stack: typeof error?.stack === "string" ? error.stack : "" }; }
export class WorkerBackpressureError extends Error { constructor(message = "Worker queue is full") { super(message); this.name = "WorkerBackpressureError"; } }
export class WorkerCallError extends Error { constructor(message = "Worker call failed") { super(message); this.name = "WorkerCallError"; } }
export class WorkerCrashedError extends Error { constructor(message = "Worker crashed") { super(message); this.name = "WorkerCrashedError"; } }
export class WorkerClosedError extends Error { constructor(message = "Worker is closed") { super(message); this.name = "WorkerClosedError"; } }
function __velarWorkerRejectAll(state, failure) { if (state.closed) return; state.closed = true; for (const pending of state.pending.values()) { if (pending.timer) clearTimeout(pending.timer); pending.unsubscribe(); pending.reject(failure); } state.pending.clear(); for (const timer of state.abandoned.values()) clearTimeout(timer); state.abandoned.clear(); }
function __velarWorkerCrash(state, failure) { __velarWorkerRejectAll(state, failure); state.instance.terminate(); }
const __velarWorkerPrototype = Object.freeze({
  call(request, cancellation = null, timeout = null) {
    const state = __velarWorkerStates.get(this); if (!state) throw new TypeError("Worker.call requires a Worker receiver"); if (state.closed) return Promise.reject(new WorkerClosedError());
    if (state.pending.size >= state.capacity) return Promise.reject(new WorkerBackpressureError("Worker queue capacity " + state.capacity + " is full"));
    if (cancellation !== null && !Cancellation.is(cancellation)) return Promise.reject(new TypeError("Worker cancellation must be Cancellation or null"));
    let validated; try { validated = state.RequestType.parse(request); } catch (error) { return Promise.reject(error); }
    let outbound; try { outbound = __velarWorkerOutbound(validated, request); } catch (error) { return Promise.reject(error); }
    const milliseconds = __velarWorkerDuration(timeout); const id = state.nextId++;
    return new Promise((resolve, reject) => { const pending = { resolve, reject, cancel: null, reason: "Worker call cancelled", timeout, timer: null, unsubscribe: () => null }; state.pending.set(id, pending); state.instance.postMessage({ kind: "call", id, value: outbound.value }, outbound.transfers); if (cancellation !== null) pending.unsubscribe = Cancellation.__velarOn(cancellation, reason => { if (!state.pending.has(id) || pending.cancel) return; pending.cancel = "cancel"; pending.reason = reason ?? pending.reason; state.instance.postMessage({ kind: "cancel", id, reason: pending.reason }); }); if (milliseconds > 0) pending.timer = setTimeout(() => { if (!state.pending.has(id) || pending.cancel) return; state.pending.delete(id); pending.unsubscribe(); state.instance.postMessage({ kind: "cancel", id, reason: "Worker call timed out" }); state.abandoned.set(id, setTimeout(() => __velarWorkerCrash(state, new WorkerCrashedError("Worker did not acknowledge a cancelled call within " + __velarWorkerCancelGrace + "ms")), __velarWorkerCancelGrace)); reject(new TaskTimeoutError("Worker call timed out after " + timeout)); }, milliseconds); });
  },
  async close() { const state = __velarWorkerStates.get(this); if (!state) throw new TypeError("Worker.close requires a Worker receiver"); if (state.closed) return null; __velarWorkerRejectAll(state, new WorkerClosedError()); state.instance.terminate(); return null; },
});
function __velarWorkerClient(name, RequestType, ResponseType, capacity) {
  if (typeof __velarNativeWorker !== "function") throw new Error("The browser Worker API is unavailable"); if (typeof name !== "string" || !Object.hasOwn(__velarWorkerEntries, name)) throw new RangeError("Unknown worker entry '" + String(name) + "'"); RequestType = __velarWorkerRuntimeType(RequestType, "Worker request Type"); ResponseType = __velarWorkerRuntimeType(ResponseType, "Worker response Type"); capacity = __velarWorkerInteger(capacity, 1, 10000, "Worker capacity");
  const instance = new __velarNativeWorker(new URL("../" + __velarWorkerEntries[name], import.meta.url), { type: "module", name: "velar:" + name }); const value = Object.create(__velarWorkerPrototype); const state = { instance, RequestType, ResponseType, capacity, nextId: 1, pending: new Map(), abandoned: new Map(), closed: false }; __velarWorkerStates.set(value, state);
  instance.addEventListener("message", event => { const message = event.data; if (!message || !Number.isSafeInteger(message.id)) { __velarWorkerCrash(state, new WorkerCrashedError("Worker returned an invalid message")); return; } const grace = state.abandoned.get(message.id); if (grace !== undefined) { clearTimeout(grace); state.abandoned.delete(message.id); } if (message.kind === "cancel-ack") return; const pending = state.pending.get(message.id); if (!pending) return; state.pending.delete(message.id); if (pending.timer) clearTimeout(pending.timer); pending.unsubscribe(); if (pending.cancel === "cancel") { pending.reject(new CancellationError(pending.reason)); return; } if (!message.ok) { const remote = message.error ?? {}; const failure = new WorkerCallError((remote.name ? remote.name + ": " : "") + (remote.message ?? "Worker call failed")); if (typeof remote.stack === "string" && remote.stack) failure.stack += "\nRemote worker:\n" + remote.stack; pending.reject(failure); return; } try { pending.resolve(__velarWorkerInbound(state.ResponseType, message.value)); } catch (error) { pending.reject(error); } });
  instance.addEventListener("error", event => __velarWorkerCrash(state, new WorkerCrashedError(event.message || "Worker crashed"))); instance.addEventListener("messageerror", () => __velarWorkerCrash(state, new WorkerCrashedError("Worker returned an unreadable message"))); return Object.freeze(value);
}
const __velarWorkerPoolPrototype = Object.freeze({
  call(request, cancellation = null, timeout = null) { const state = __velarWorkerPoolStates.get(this); if (!state) throw new TypeError("WorkerPool.call requires a WorkerPool receiver"); if (state.closed) return Promise.reject(new WorkerClosedError("Worker pool is closed")); let total = 0; let selected = null; let load = 0; for (const item of state.workers) { const member = __velarWorkerStates.get(item); if (member.closed) continue; total += member.pending.size; if (selected === null || member.pending.size < load) { selected = item; load = member.pending.size; } } if (selected === null) return Promise.reject(new WorkerCrashedError("Worker pool has no live workers")); if (total >= state.capacity) return Promise.reject(new WorkerBackpressureError("Worker pool queue capacity " + state.capacity + " is full")); return selected.call(request, cancellation, timeout); },
  broadcast(request, cancellation = null, timeout = null) { const state = __velarWorkerPoolStates.get(this); if (!state) throw new TypeError("WorkerPool.broadcast requires a WorkerPool receiver"); if (state.closed) return Promise.reject(new WorkerClosedError("Worker pool is closed")); const live = []; let total = 0; for (const item of state.workers) { const member = __velarWorkerStates.get(item); if (member.closed) continue; live.push(item); total += member.pending.size; if (member.pending.size >= member.capacity) return Promise.reject(new WorkerBackpressureError("Worker pool member queue capacity " + member.capacity + " is full")); } if (live.length === 0) return Promise.reject(new WorkerCrashedError("Worker pool has no live workers")); if (total + live.length > state.capacity) return Promise.reject(new WorkerBackpressureError("Worker pool queue capacity " + state.capacity + " cannot accept a broadcast to " + live.length + " workers")); return Promise.all(live.map(item => item.call(request, cancellation, timeout))); },
  async close() { const state = __velarWorkerPoolStates.get(this); if (!state) throw new TypeError("WorkerPool.close requires a WorkerPool receiver"); if (state.closed) return null; state.closed = true; await Promise.all(state.workers.map(item => item.close())); return null; },
});
const __velarWorkerType = Object.freeze({ is(value) { return __velarWorkerStates.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match Worker"); return value; } });
const __velarWorkerPoolType = Object.freeze({ is(value) { return __velarWorkerPoolStates.has(value); }, parse(value) { if (!this.is(value)) throw new TypeError("Value does not match WorkerPool"); return value; } });
export const Worker = Object.freeze({ ...__velarWorkerType, of() { return __velarWorkerType; } }); export const WorkerPool = Object.freeze({ ...__velarWorkerPoolType, of() { return __velarWorkerPoolType; } });
export function worker(name, RequestType, ResponseType, capacity = 64) { return __velarWorkerClient(name, RequestType, ResponseType, capacity); }
export function workerPool(name, RequestType, ResponseType, size, capacity = 256) { size = __velarWorkerInteger(size, 1, 32, "Worker pool size"); capacity = __velarWorkerInteger(capacity, size, 10000, "Worker pool capacity"); const workers = Array.from({ length: size }, () => __velarWorkerClient(name, RequestType, ResponseType, Math.ceil(capacity / size))); const value = Object.create(__velarWorkerPoolPrototype); __velarWorkerPoolStates.set(value, { workers, capacity, closed: false }); return Object.freeze(value); }
export function serveWorker(RequestType, ResponseType, handler, capacity = 64) {
  if (__velarWorkerServerInstalled) throw new Error("A worker entry may call serveWorker() only once"); RequestType = __velarWorkerRuntimeType(RequestType, "Worker request Type"); ResponseType = __velarWorkerRuntimeType(ResponseType, "Worker response Type"); if (typeof handler !== "function") throw new TypeError("serveWorker handler must be an async function"); capacity = __velarWorkerInteger(capacity, 1, 10000, "Worker capacity"); __velarWorkerServerInstalled = true;
  const queue = []; const active = new Map(); let running = false; const drain = async () => { if (running) return; running = true; while (queue.length) { const message = queue.shift(); const cancellation = Cancellation.__velarCreate(); active.set(message.id, cancellation); try { const request = __velarWorkerInbound(RequestType, message.value); const handled = await handler(request, cancellation); const result = ResponseType.parse(handled); const outbound = __velarWorkerOutbound(result, handled); globalThis.postMessage({ id: message.id, ok: true, value: outbound.value }, { transfer: outbound.transfers }); } catch (error) { globalThis.postMessage({ id: message.id, ok: false, error: __velarWorkerFailure(error) }); } finally { active.delete(message.id); } } running = false; };
  globalThis.addEventListener("message", event => { const message = event.data; if (!message || !Number.isSafeInteger(message.id)) return; if (message.kind === "cancel") { globalThis.postMessage({ id: message.id, kind: "cancel-ack" }); const cancellation = active.get(message.id); if (cancellation) Cancellation.__velarCancel(cancellation, typeof message.reason === "string" ? message.reason : "Worker call cancelled"); else { const index = queue.findIndex(item => item.id === message.id); if (index >= 0) { queue.splice(index, 1); globalThis.postMessage({ id: message.id, ok: false, error: __velarWorkerFailure(new CancellationError(typeof message.reason === "string" ? message.reason : "Worker call cancelled")) }); } } return; } if (message.kind !== "call") return; if (queue.length + active.size >= capacity) { globalThis.postMessage({ id: message.id, ok: false, error: __velarWorkerFailure(new WorkerBackpressureError()) }); return; } queue.push(message); drain(); }); return null;
}
`.trimStart();
