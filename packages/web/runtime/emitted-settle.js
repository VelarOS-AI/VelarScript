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

// tick() is where an awaiting caller meets the reactive queue, which makes it
// the owned place for a failure no handler claimed to surface: the test that
// awaited the flush fails with the real error, and the process -- the test
// runner, or the page -- continues.
//
// D114 P6 item 4 (LC-C1): the wait is counted, because the flush has to know
// whether anyone is there. While this promise is pending the escalation path
// parks an unowned failure instead of handing it to the host, in every host;
// with nobody waiting it goes to the host error event (browser) or the report
// channel (elsewhere) exactly as before.
function __velarTick() {
  __velarEnterTickWait();
  return __velarManagedAsyncThen(__velarSettled(), () => {
    __velarLeaveTickWait();
    const failure = __velarTakeUnhandledFailure();
    if (failure !== null) throw failure;
    return null;
  }, (error) => {
    __velarLeaveTickWait();
    throw error;
  });
}