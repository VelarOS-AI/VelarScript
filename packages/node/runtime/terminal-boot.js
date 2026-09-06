, {
  eval: true,
  workerData: {port: __velarTerminalChannel.port2},
  transferList: [__velarTerminalChannel.port2],
});
// Node's Worker.prototype.terminate() re-reads `this.ref`, and its
// Worker.prototype.ref re-reads MessagePort.prototype.ref off the worker's
// public port, so being able to stop the thread this module started would
// otherwise be at the mercy of two prototype methods a program can replace.
// This proxy owns this Worker, so the operation Node re-enters is pinned on the
// instance to the reference the module captured.
__velarTerminalCall(__velarTerminalDefineProperty, __velarTerminalNativeObject, [__velarTerminalWorker, "ref", {
  value: () => { __velarTerminalRetainWorker(); return null; },
  writable: true, enumerable: false, configurable: true,
}]);
__velarTerminalCall(__velarTerminalEventOn, __velarTerminalWorker, ["error", error => __velarTerminalFail(error)]);
__velarTerminalCall(__velarTerminalEventOn, __velarTerminalWorker, ["exit", code => {
  if (!__velarTerminalExpectedWorkerExit) {
    __velarTerminalFail(new __velarTerminalNativeError("Node terminal worker exited unexpectedly with code " + code));
  }
}]);
// The handshake is an outstanding call like any other: the Worker holds the
// loop for it until it settles, and it settles one of two ways — the worker
// reports ready, or this deadline names the failure. It cannot end in a silent
// exit.
const __velarTerminalReadyTimer = __velarTerminalSetTimeout(
  () => __velarTerminalFail(new __velarTerminalNativeError(
    "Node terminal worker did not become ready within " + __velarTerminalReadyDeadlineMs + " ms",
  )),
  __velarTerminalReadyDeadlineMs,
);
try { await __velarTerminalReadyPromise; }
finally { __velarTerminalClearTimeout(__velarTerminalReadyTimer); }
// From here the port is the handle that holds the loop for this proxy, so the
// Worker is released once and never ref'd again.
__velarTerminalReleaseWorker();
__velarTerminalUpdateReference();

function __velarTerminalInvoke(operation, value) {
  if (__velarTerminalClosed) {
    if (__velarTerminalFailure) return new __velarTerminalNativePromise((_resolve, reject) => reject(__velarTerminalFailure));
    if (operation === "readLine") return new __velarTerminalNativePromise(resolve => resolve(null));
    return new __velarTerminalNativePromise((_resolve, reject) => reject(new __velarTerminalNativeError("Terminal is closed")));
  }
  if (__velarTerminalPendingCount >= __velarTerminalMaxPending) {
    return new __velarTerminalNativePromise((_resolve, reject) => reject(new __velarTerminalNativeRangeError("Terminal cannot have more than 256 pending operations")));
  }
  const id = __velarTerminalNextRequest;
  __velarTerminalNextRequest += 1;
  const result = new __velarTerminalNativePromise((resolve, reject) => {
    __velarTerminalPending[id] = {operation, resolve, reject};
  });
  __velarTerminalPendingCount += 1;
  __velarTerminalUpdateReference();
  // The accounting named a failure rather than throwing, and that failure
  // already rejected this call along with every other pending one. Posting into
  // a closed port from here would only report the wrong error.
  if (__velarTerminalFailure) return result;
  try {
    __velarTerminalCall(__velarTerminalMessagePortPost, __velarTerminalPort, [{kind: "request", id, operation, value}]);
  } catch (error) {
    delete __velarTerminalPending[id];
    __velarTerminalPendingCount -= 1;
    __velarTerminalUpdateReference();
    return new __velarTerminalNativePromise((_resolve, reject) => reject(error));
  }
  return result;
}

export const terminal = __velarTerminalCall(__velarTerminalObjectFreeze, __velarTerminalNativeObject, [{
  args() { return __velarTerminalCall(__velarTerminalArraySlice, __velarTerminalArguments, []); },
  isInteractive() { return __velarTerminalInteractive; },
  readLine(prompt = "") { return __velarTerminalInvoke("readLine", __velarTerminalBoundedText(prompt, "Terminal prompt")); },
  write(text) { return __velarTerminalInvoke("write", __velarTerminalBoundedText(text, "Terminal write")); },
  writeError(text) { return __velarTerminalInvoke("writeError", __velarTerminalBoundedText(text, "Terminal error write")); },
  close() {
    if (__velarTerminalClosed) return null;
    __velarTerminalClosed = true;
    const keys = __velarTerminalCall(__velarTerminalOwnKeys, __velarTerminalNativeReflect, [__velarTerminalPending]);
    for (let index = 0; index < keys.length; index += 1) {
      const descriptor = __velarTerminalOwnDescriptor(__velarTerminalPending, keys[index]);
      if (descriptor && "value" in descriptor) {
        if (descriptor.value.operation === "readLine") descriptor.value.resolve(null);
        else descriptor.value.reject(new __velarTerminalNativeError("Terminal closed before the write completed"));
      }
      delete __velarTerminalPending[keys[index]];
    }
    __velarTerminalPendingCount = 0;
    __velarTerminalClosing = true;
    __velarTerminalUpdateReference();
    // The accounting named a failure rather than throwing, and that failure
    // already closed the port and stopped the worker; this close has nowhere
    // left to be sent and nothing left to wait for.
    if (__velarTerminalFailure) return null;
    __velarTerminalCall(__velarTerminalMessagePortPost, __velarTerminalPort, [{kind: "close"}]);
    return null;
  },
}]);
