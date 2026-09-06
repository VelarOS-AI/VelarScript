, {
  eval: true,
  workerData: __velarNodeHostChannel.port2,
  transferList: [__velarNodeHostChannel.port2],
});
// Node's Worker.prototype.terminate() re-reads `this.ref`, and its
// Worker.prototype.ref re-reads MessagePort.prototype.ref off the worker's
// public port, so being able to stop the thread this module started would
// otherwise be at the mercy of two prototype methods a program can replace.
// This proxy owns this Worker, so the operation Node re-enters is pinned on the
// instance to the reference the module captured.
__velarNodeHostCall(__velarNodeHostDefineProperty, __velarNodeHostObject, [__velarNodeHostWorker, "ref", {
  value: () => { __velarNodeHostRetainWorker(); return null; },
  writable: true, enumerable: false, configurable: true,
}]);
__velarNodeHostCall(__velarNodeHostEventOn, __velarNodeHostWorker, ["error", () => __velarNodeHostFail(new __velarNodeHostError("Node host worker failed"))]);
__velarNodeHostCall(__velarNodeHostEventOn, __velarNodeHostWorker, ["exit", code => {
  __velarNodeHostFail(new __velarNodeHostError("Node host worker exited unexpectedly with code " + code));
}]);
// The handshake is an outstanding call like any other: the Worker holds the
// loop for it until it settles, and it settles one of two ways — the worker
// reports ready, or this deadline names the failure. It cannot end in a silent
// exit.
const __velarNodeHostReadyTimer = __velarNodeHostCall(__velarNodeHostSetTimeout, globalThis, [
  () => __velarNodeHostFail(new __velarNodeHostError(
    "Node host worker did not become ready within " + __velarNodeHostReadyDeadlineMs + " ms",
  )),
  __velarNodeHostReadyDeadlineMs,
]);
let __velarNodeHostReadyFailure = null;
try { await __velarNodeHostReadyPromise; }
catch (failure) { __velarNodeHostReadyFailure = failure; }
finally { __velarNodeHostCall(__velarNodeHostClearTimeout, globalThis, [__velarNodeHostReadyTimer]); }
// D114 F9-node-cli, audit NO-U6: a handshake that failed used to reach the
// program as the error object the timer built, so what `node dist/main.js`
// printed above the message was the runtime's own timer line — one compressed
// line in a production build — with `listOnTimeout` and `processTimers`
// underneath it and not one frame of the program. That reads as a toolchain
// crash rather than a program that could not start. The failure is raised
// here instead, from the module body the program's import is waiting on, so it
// travels the path every uncaught error of the program travels and carries the
// module-loader frames those carry — which is also what puts it through `velar
// run`'s launcher, where the runtime frames are hidden and the report is the
// one VelarScript writes.
if (__velarNodeHostReadyFailure !== null) {
  throw new __velarNodeHostError(typeof __velarNodeHostReadyFailure.message === "string" && __velarNodeHostReadyFailure.message !== "" ? __velarNodeHostReadyFailure.message : "Node host worker did not become ready");
}
// From here the port is the handle that holds the loop for this proxy, so the
// Worker is released once and never ref'd again.
// D114 F9-node-cli, audit NO-D2 / NO-I3: the release is the one call that
// decides whether this process can ever exit, and its failure was the one
// failure this module threw away. A preload that replaces
// `Worker.prototype.unref` before this module is evaluated — how an APM or an
// OpenTelemetry probe patches `worker_threads` — is captured along with
// everything else (F7-node-c pins the operation at load, which defeats a
// *later* replacement), and a captured operation that refuses left the Worker
// referenced with nothing outstanding: the program printed its output, ran to
// the end, and the process never exited, silently, forever. The reference
// accounting on the next line names exactly this kind of failure already. So
// this one is named too — a host operation this module cannot perform is a
// dead host, and
// `__velarNodeHostFail` says so, rejects every
// pending call, and stops the thread — which is also what lets the process
// exit.
if (!__velarNodeHostReleaseWorker()) __velarNodeHostFail(new __velarNodeHostError("Node host worker could not be released; Worker.prototype.unref did not answer"));
__velarNodeHostUpdateReference();

export function __velarNodeHostInvoke(operation, args) {
  if (typeof operation !== "string" || operation.length === 0 || !__velarNodeHostCall(__velarNodeHostArrayIsArray, __velarNodeHostArray, [args])) {
    return new __velarNodeHostPromise((_resolve, reject) => reject(new __velarNodeHostTypeError("Node host invocation is invalid")));
  }
  const serveLane = operation === "serve.start" || operation === "serve.stop" || operation === "serve.respond"
    || operation === "serve.respondFile" || operation === "serve.streamStart" || operation === "serve.streamWrite"
    || operation === "serve.streamEnd" || operation === "serve.fail";
  if (serveLane ? __velarNodeHostServePendingCount >= __velarNodeHostMaxServePending : __velarNodeHostDataPendingCount >= __velarNodeHostMaxDataPending) {
    const message = serveLane
      ? "Node serve control plane cannot have more than 4608 pending operations"
      : "Node host data plane cannot have more than 4096 pending operations";
    return new __velarNodeHostPromise((_resolve, reject) => reject(new __velarNodeHostRangeError(message)));
  }
  if (__velarNodeHostFailure) return new __velarNodeHostPromise((_resolve, reject) => reject(__velarNodeHostFailure));
  const id = __velarNodeHostRequestId();
  return new __velarNodeHostPromise((resolve, reject) => {
    const handle = operation === "http.request" || operation === "http.read" || operation === "http.readBytes"
      || operation === "http.cancel" || operation === "http.close"
      || operation === "fs.watchNext" || operation === "fs.watchClose"
      ? args[0]
      : null;
    __velarNodeHostPending[id] = {operation, handle, serveLane, resolve, reject};
    if (serveLane) __velarNodeHostServePendingCount += 1;
    else __velarNodeHostDataPendingCount += 1;
    __velarNodeHostUpdateReference();
    // The accounting named a failure rather than throwing, and that failure
    // already rejected this call along with every other pending one. Posting
    // into a closed port from here would only report the wrong error.
    if (__velarNodeHostFailure) return;
    try { __velarNodeHostCall(__velarNodeHostMessagePortPost, __velarNodeHostPort, [{id, operation, args}]); }
    catch (error) {
      delete __velarNodeHostPending[id];
      if (serveLane) __velarNodeHostServePendingCount -= 1;
      else __velarNodeHostDataPendingCount -= 1;
      __velarNodeHostUpdateReference();
      reject(error);
    }
  });
}

export function __velarNodeHostOn(event, handler) {
  if (event !== "serve.request" && event !== "serve.cancel" && event !== "serve.error" || typeof handler !== "function") throw new __velarNodeHostTypeError("Node host event registration is invalid");
  if (__velarNodeHostFailure) throw __velarNodeHostFailure;
  if (__velarNodeHostOwnDescriptor(__velarNodeHostEventHandlers, event)) throw new __velarNodeHostError("Node host event already has an owner");
  __velarNodeHostEventHandlers[event] = handler;
  return null;
}
