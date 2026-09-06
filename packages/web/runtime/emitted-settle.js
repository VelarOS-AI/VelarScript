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

// The failure the flush parked for its claimants, read rather than taken, and
// this caller's wait ended.
//
// D114 F9-web (WB-C1): the park was drained by whoever looked first, so a
// second `tick()` awaiting the same broken flush found nothing and resolved --
// it stepped over the broken update the charter says awaiting `tick()` cannot
// step over. Every `tick()` pending at that flush is a claimant and rejects
// with the same failure, so the park is released only when the last of them has
// left. That is also what makes a `tick()` awaited *after* the flush resolve:
// by then nobody is waiting, so nothing was parked and nothing is left.
function __velarClaimUnhandledFailure() {
  let claimed = null;
  for (const failure of __velarGraphSetItems(__velarRuntime.unhandledFailures)) { claimed = failure; break; }
  __velarLeaveTickWait();
  if (!__velarTickWaiting()) __velarGraphSetEmpty(__velarRuntime.unhandledFailures);
  return claimed;
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
    const failure = __velarClaimUnhandledFailure();
    if (failure !== null) throw failure;
    return null;
  }, (error) => {
    __velarClaimUnhandledFailure();
    throw error;
  });
}