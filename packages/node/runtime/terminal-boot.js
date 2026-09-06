, {
  eval: true,
  workerData: {port: __velarTerminalChannel.port2},
  transferList: [__velarTerminalChannel.port2],
});
__velarTerminalCall(__velarTerminalEventOn, __velarTerminalWorker, ["error", error => __velarTerminalFail(error)]);
__velarTerminalCall(__velarTerminalEventOn, __velarTerminalWorker, ["exit", code => {
  if (!__velarTerminalExpectedWorkerExit) {
    __velarTerminalFail(new __velarTerminalNativeError("Node terminal worker exited unexpectedly with code " + code));
  }
}]);
const __velarTerminalReadyTimer = __velarTerminalSetTimeout(
  () => __velarTerminalReadyReject(new __velarTerminalNativeError("Node terminal worker did not become ready")),
  10000,
);
try { await __velarTerminalReadyPromise; }
finally { __velarTerminalClearTimeout(__velarTerminalReadyTimer); }
__velarTerminalCall(__velarTerminalWorkerUnref, __velarTerminalWorker, []);
__velarTerminalCall(__velarTerminalMessagePortUnref, __velarTerminalPort, []);

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
    __velarTerminalCall(__velarTerminalMessagePortPost, __velarTerminalPort, [{kind: "close"}]);
    return null;
  },
}]);
