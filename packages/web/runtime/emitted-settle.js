function __velarSettledStep() {
  return __velarManagedAsyncCreate((resolve) => __velarEnqueue(resolve));
}

function __velarSettled(rounds = 10000) {
  return __velarManagedAsyncThen(__velarSettledStep(), () => {
    if (__velarRuntime.flushPending) __velarFlush();
    if (rounds > 1 && (__velarGraphSetCount(__velarRuntime.domQueue)
      || __velarGraphSetCount(__velarRuntime.watchQueue) || __velarRuntime.flushPending)) {
      return __velarSettled(rounds - 1);
    }
    return null;
  });
}

function __velarTakeUnhandledFailure() {
  for (const failure of __velarGraphSetItems(__velarRuntime.unhandledFailures)) {
    __velarGraphSetRemove(__velarRuntime.unhandledFailures, failure);
    return failure;
  }
  return null;
}

// In a non-browser host an unhandled report cannot throw from a microtask
// without ending the whole process, so the runtime parks it. tick() is where
// an awaiting caller meets the reactive queue, which makes it the owned place
// for that parked failure to surface: the test that awaited the flush fails
// with the real error and the process -- the test runner -- continues.
function __velarTick() {
  return __velarManagedAsyncThen(__velarSettled(), () => {
    const failure = __velarTakeUnhandledFailure();
    if (failure !== null) throw failure;
    return null;
  });
}