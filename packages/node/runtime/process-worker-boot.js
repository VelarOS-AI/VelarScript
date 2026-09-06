, {
  eval: true,
  workerData: __velarNodeProcessChannel.port2,
  transferList: [__velarNodeProcessChannel.port2],
});
__velarProcessCall(__velarNodeProcessEventOn, __velarNodeProcessWorker, ["error", () => __velarNodeProcessFail(new __velarProcessNativeError("Node process worker failed"))]);
__velarProcessCall(__velarNodeProcessEventOn, __velarNodeProcessWorker, ["exit", code => {
  __velarNodeProcessFail(new __velarProcessNativeError("Node process worker exited unexpectedly with code " + code));
}]);
const __velarNodeProcessReadyTimer = __velarProcessCall(__velarProcessSetTimeout, globalThis, [
  () => __velarNodeProcessReadyReject(new __velarProcessNativeError("Node process worker did not become ready")),
  10000,
]);

try { await __velarNodeProcessReadyPromise; }
finally { __velarProcessCall(__velarProcessClearTimeout, globalThis, [__velarNodeProcessReadyTimer]); }
__velarProcessCall(__velarNodeProcessWorkerUnref, __velarNodeProcessWorker, []);
__velarProcessCall(__velarNodeProcessMessagePortUnref, __velarNodeProcessPort, []);

function invoke(operation, args) {
  if (__velarNodeProcessFailure) return __velarProcessReject(__velarNodeProcessFailure);
  if (__velarNodeProcessPendingCount >= __velarNodeProcessMaxPending) {
    return __velarProcessReject(new __velarProcessNativeRangeError("Node process host cannot have more than 1024 pending operations"));
  }
  let attempts = 0;
  while (__velarProcessOwnDescriptor(__velarNodeProcessPending, __velarProcessNativeString(__velarNodeProcessNextRequest))) {
    __velarNodeProcessNextRequest = __velarNodeProcessNextRequest >= __velarProcessNativeNumber.MAX_SAFE_INTEGER ? 1 : __velarNodeProcessNextRequest + 1;
    attempts += 1;
    if (attempts > __velarNodeProcessMaxPending) return __velarProcessReject(new __velarProcessNativeRangeError("Node process request identity space is unavailable"));
  }
  const id = __velarNodeProcessNextRequest;
  __velarNodeProcessNextRequest = id >= __velarProcessNativeNumber.MAX_SAFE_INTEGER ? 1 : id + 1;
  return new __velarProcessNativePromise((resolve, reject) => {
    __velarNodeProcessPending[id] = {operation, resolve, reject};
    __velarNodeProcessPendingCount += 1;
    __velarNodeProcessUpdateReference();
    try {
      __velarProcessCall(__velarNodeProcessMessagePortPost, __velarNodeProcessPort, [{id, operation, args}]);
    } catch (error) {
      delete __velarNodeProcessPending[id];
      __velarNodeProcessPendingCount -= 1;
      __velarNodeProcessUpdateReference();
      reject(error);
    }
  });
}

class ProcessHandle {
  constructor(token, handle, pid, maxOutputBytes) {
    if (token !== __velarNodeProcessToken || !__velarProcessIsSafeInteger(handle) || handle < 1
      || !__velarProcessIsSafeInteger(pid) || pid < 0) {
      throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start");
    }
    this.handle = handle;
    this.pid = pid;
    this.maxOutputBytes = maxOutputBytes;
    this.outputBytes = 0;
    this.outputReading = false;
    this.waitStarted = false;
    this.result = null;
    this.stopping = null;
    this.stopRequested = false;
    this.cleanup = null;
    this.next = async () => {
      if (this.waitStarted) throw new __velarProcessNativeError("Process output must be consumed before wait()");
      if (this.stopRequested) throw new __velarProcessNativeError("Process output is unavailable after stop()");
      if (this.outputReading) throw new __velarProcessNativeError("Process.next() allows only one active pull");
      this.outputReading = true;
      try {
        const output = outputOf(await invoke("read", [this.handle]), this.maxOutputBytes);
        if (output === null) return null;
        this.outputBytes += output.bytes;
        if (this.outputBytes > this.maxOutputBytes) throw new __velarProcessNativeRangeError("Process output exceeded maxOutputBytes");
        return __velarProcessFreeze({channel: output.channel, text: output.text});
      } finally {
        this.outputReading = false;
      }
    };
    __velarProcessSeal(this);
  }
  wait() {
    if (this.outputReading) return __velarProcessReject(new __velarProcessNativeError("Process wait() cannot run while next() is pending"));
    this.waitStarted = true;
    if (!this.result) {
      let result;
      result = __velarProcessThen(invoke("wait", [this.handle]), value => {
        let outcome;
        try { outcome = waitValueOf(value, this.maxOutputBytes); }
        catch (error) {
          if (this.result === result) this.result = null;
          throw error;
        }
        if (outcome.retained) {
          if (this.result === result) this.result = null;
          throw outcome.error;
        }
        if (outcome.error) throw outcome.error;
        return outcome.result;
      }, error => {
        if (this.result === result) this.result = null;
        throw error;
      });
      this.result = result;
    }
    return this.result;
  }
  async stop() {
    return await __velarProcessRetryableStop(this, () => __velarProcessThen(invoke("stop", [this.handle]), value => {
        const outcome = stopValueOf(value, this.maxOutputBytes);
        if (outcome.error) this.result = __velarProcessObservedReject(outcome.error);
        else if (outcome.result) this.result = __velarProcessResolve(outcome.result);
        return null;
      }));
  }
}

export const Process = __velarProcessFreeze({
  is(value) { return value instanceof ProcessHandle; },
  parse(value) { if (!(value instanceof ProcessHandle)) throw new __velarProcessNativeTypeError("Process values are created only by velar/process.start"); return value; },
});
export async function start(command, args = [], options = {}) {
  const wire = optionsOf(options);
  const value = startValueOf(await invoke("start", [boundedText(command, "Process command"), argumentsOf(args), wire]));
  return new ProcessHandle(__velarNodeProcessToken, value.handle, value.pid, wire.maxOutputBytes);
}
export async function run(command, args = [], options = {}) {
  const owner = await start(command, args, options);
  try { return await owner.wait(); }
  catch (error) {
    if (!owner.result) __velarProcessRetainRun(owner);
    throw error;
  }
}
