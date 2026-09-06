function __velarNodeProcessReapOwners() {
  __velarNodeProcessReaper = null;
  __velarNodeProcessReaperAttempts += 1;
  // Every owner is signalled on every attempt, so a second attempt means this
  // reaper has already delivered SIGKILL to each group it still holds.
  const signalled = __velarNodeProcessReaperAttempts > 1;
  const keys = __velarProcessKeys(__velarNodeProcessOwners);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessOwners, key);
    if (!descriptor || !("value" in descriptor)) continue;
    const pid = descriptor.value;
    if (!__velarNodeProcessOwnerAlive(pid, signalled)) {
      delete __velarNodeProcessOwners[key];
      continue;
    }
    __velarNodeProcessSignal(pid, "SIGKILL");
    if (!__velarNodeProcessOwnerAlive(pid, true)) delete __velarNodeProcessOwners[key];
  }
  if (__velarProcessKeys(__velarNodeProcessOwners).length > 0 && __velarNodeProcessReaperAttempts < 100) {
    __velarNodeProcessReaper = __velarProcessCall(__velarProcessSetTimeout, globalThis, [__velarNodeProcessReapOwners, 50]);
  } else if (__velarNodeProcessReaperAttempts >= 100) {
    const abandonedKeys = __velarProcessKeys(__velarNodeProcessOwners);
    for (let index = 0; index < abandonedKeys.length; index += 1) delete __velarNodeProcessOwners[abandonedKeys[index]];
  }
}
function __velarNodeProcessBeginReaping() {
  if (__velarNodeProcessReaper === null && __velarProcessKeys(__velarNodeProcessOwners).length > 0) {
    __velarNodeProcessReaperAttempts = 0;
    __velarNodeProcessReapOwners();
  }
}
function __velarNodeProcessFail(error) {
  if (__velarNodeProcessFailure) return;
  const failure = error instanceof __velarProcessNativeError ? error : new __velarProcessNativeError("Node process worker failed");
  __velarNodeProcessFailure = failure;
  if (!__velarNodeProcessReady) __velarNodeProcessReadyReject(failure);
  const keys = __velarProcessKeys(__velarNodeProcessPending);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessPending, key);
    if (descriptor && "value" in descriptor) descriptor.value.reject(failure);
    delete __velarNodeProcessPending[key];
  }
  __velarNodeProcessPendingCount = 0;
  __velarNodeProcessRunningCount = 0;
  const settledKeys = __velarProcessKeys(__velarNodeProcessSettledOwners);
  for (let index = 0; index < settledKeys.length; index += 1) delete __velarNodeProcessSettledOwners[settledKeys[index]];
  const unconfirmedKeys = __velarProcessKeys(__velarNodeProcessUnconfirmedOwners);
  for (let index = 0; index < unconfirmedKeys.length; index += 1) delete __velarNodeProcessUnconfirmedOwners[unconfirmedKeys[index]];
  __velarNodeProcessUpdateReference();
  __velarNodeProcessBeginReaping();
  __velarProcessCall(__velarNodeProcessMessagePortClose, __velarNodeProcessPort, []);
}
function __velarNodeProcessMessage(value) {
  const message = __velarProcessRecord(value, "Node process host message", processHostMessageFields);
  if (message.kind === "ready") {
    if (__velarNodeProcessReady) throw new __velarProcessNativeError("Node process worker sent duplicate readiness");
    __velarNodeProcessReady = true;
    __velarNodeProcessReadyResolve(null);
    return;
  }
  if (message.kind === "owned") {
    if (!__velarProcessIsSafeInteger(message.handle) || message.handle < 1
      || !__velarProcessIsSafeInteger(message.pid) || message.pid < 1
      || __velarProcessOwnDescriptor(__velarNodeProcessOwners, __velarProcessNativeString(message.handle))
      || __velarProcessOwnDescriptor(__velarNodeProcessSettledOwners, __velarProcessNativeString(message.handle))) {
      throw new __velarProcessNativeTypeError("Node process worker returned an invalid owned handle");
    }
    __velarNodeProcessOwners[message.handle] = message.pid;
    __velarNodeProcessUnconfirmedOwners[message.handle] = true;
    __velarNodeProcessRunningCount += 1;
    __velarNodeProcessUpdateReference();
    return;
  }
  if (message.kind === "settled") {
    const owner = __velarProcessIsSafeInteger(message.handle) && message.handle > 0
      ? __velarProcessOwnDescriptor(__velarNodeProcessOwners, __velarProcessNativeString(message.handle))
      : null;
    if (!owner || !("value" in owner) || __velarNodeProcessRunningCount < 1) {
      throw new __velarProcessNativeTypeError("Node process worker returned an invalid settled handle");
    }
    delete __velarNodeProcessOwners[message.handle];
    if (__velarProcessOwnDescriptor(__velarNodeProcessUnconfirmedOwners, __velarProcessNativeString(message.handle))) {
      __velarNodeProcessSettledOwners[message.handle] = owner.value;
    }
    __velarNodeProcessRunningCount -= 1;
    __velarNodeProcessUpdateReference();
    return;
  }
  if (message.kind !== "response" || !__velarProcessIsSafeInteger(message.id) || message.id < 1 || typeof message.ok !== "boolean") {
    throw new __velarProcessNativeTypeError("Node process worker returned an invalid response");
  }
  const descriptor = __velarProcessOwnDescriptor(__velarNodeProcessPending, __velarProcessNativeString(message.id));
  if (!descriptor || !("value" in descriptor)) throw new __velarProcessNativeError("Node process worker returned an unknown response");
  const pending = descriptor.value;
  let responseValue = message.value;
  let responseError = null;
  if (message.ok) {
    if (pending.operation === "start") {
      const started = startValueOf(message.value);
      const owner = __velarProcessOwnDescriptor(__velarNodeProcessOwners, __velarProcessNativeString(started.handle))
        ?? __velarProcessOwnDescriptor(__velarNodeProcessSettledOwners, __velarProcessNativeString(started.handle));
      if (!owner || !("value" in owner) || owner.value !== started.pid) {
        throw new __velarProcessNativeError("Node process worker resolved start without transferring cleanup ownership");
      }
      delete __velarNodeProcessUnconfirmedOwners[started.handle];
      delete __velarNodeProcessSettledOwners[started.handle];
      responseValue = started;
    }
  } else responseError = processErrorOf(message.error);
  delete __velarNodeProcessPending[message.id];
  __velarNodeProcessPendingCount -= 1;
  __velarNodeProcessUpdateReference();
  if (responseError) pending.reject(responseError);
  else pending.resolve(responseValue);
}

__velarNodeProcessPort.onmessage = event => {
  try {
    __velarNodeProcessMessage(__velarProcessCall(__velarNodeProcessMessageData, event, []));
  } catch (error) { __velarNodeProcessFail(error); }
};
__velarNodeProcessPort.onmessageerror = () => __velarNodeProcessFail(new __velarProcessNativeError("Node process worker returned an unreadable message"));
__velarProcessCall(__velarNodeProcessMessagePortStart, __velarNodeProcessPort, []);
const __velarNodeProcessWorker = new Worker(