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
try { await __velarNodeHostReadyPromise; }
finally { __velarNodeHostCall(__velarNodeHostClearTimeout, globalThis, [__velarNodeHostReadyTimer]); }
// From here the port is the handle that holds the loop for this proxy, so the
// Worker is released once and never ref'd again.
__velarNodeHostReleaseWorker();
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
