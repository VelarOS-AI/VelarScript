// D114 W/A1, as narrowed by W2: the identity a flush stamps its run counts
// with, and the budget those runs spend. They belong to one host *task* -- but
// the window follows work an observer started, and nothing else.
//
// A cycle that crosses a microtask boundary -- 'watch x: detach step()', where
// 'step' awaits an already-resolved Promise and then writes 'x' -- is a fresh
// flush every round, so a budget that reset per flush never saw it: two
// observer runs, well inside 100,000, forever. Flushes chained through
// microtasks therefore share one token, one budget and one leaders list, and
// the macrotask sentinel below closes the window. Work that resumes after a
// timer, an event or network I/O is a new task and opens a fresh window, which
// is what keeps an animation that writes state every frame from being stopped.
//
// W2: a flush continues the open window only once an observer run inside it has
// started asynchronous work -- a 'detach' statement, or an 'action' call, made
// while an observer was running. Those are the two ways a synchronous observer
// body reaches a later microtask, so they are the only ways the ring above can
// be closed; a chain of flushes with none of them in it has no cycle to find. A
// bulk import loop that writes a progress counter and awaits promise-only work
// per row runs millions of observers in one uninterrupted task and is not a
// runaway, so each of its flushes gets the fresh budget it had before W. The
// sentinel still closes every window at the task boundary, so the animation
// case is protected either way.
//
// The overrun's carried token is the same rule seen from one flush earlier: an
// overrun schedules its continuation as a microtask, so that continuation is
// this same task and continues these same counts by construction. It carries
// them whether or not an observer started anything, because the continuation is
// the overrun's own unfinished work rather than a new write.
const __velarFlushBudgetPerTask = 100000;
let __velarFlushToken = null;
let __velarFlushBudget = 0;
// One-shot, consumed by the next settle: the flush an overrun scheduled
// continues the window it was scheduled from, whatever that window recorded.
let __velarFlushCarried = false;
// One sentinel is enough for a window: the first one to fire closes it, and
// arming a second on every flush would leave a timer per flush behind.
let __velarTaskSentinelArmed = false;

// The two facts W2 needs live on one global slot, for the same reason the
// observer sequence above does: every emitted module carries its own copy of
// this runtime, and the two ends of the question are in different copies. The
// settle that asks it belongs to whichever copy created the registry -- in an
// application that imports velar/app, that is velar/app's -- while the places
// that answer it, a 'detach' statement's detached-task helper and an action's
// run, are emitted into the application module. Two module-scope variables
// would never meet.
//
// Slot 0 is how deep the settle currently is inside 'observer.run()'. It is a
// depth rather than a flag because an observer created by a running one runs
// nested. '__velarRuntime.activeObserver' cannot stand in for it: a watch body
// runs untracked, precisely so its own reads do not become dependencies of the
// watched expression, so the active observer is null exactly where the 'detach'
// that closes a cycle is written.
//
// Slot 1 is the fact recorded on the open window: an observer run in it started
// asynchronous work.
const __velarAsyncWorkKey = Symbol.for("velar.web.observer.asyncwork.v1");
const __velarAsyncWorkCell = (() => {
  const descriptor = __velarGraphOwnDescriptor(globalThis, __velarAsyncWorkKey);
  if (descriptor) {
    if (!("value" in descriptor) || descriptor.enumerable || descriptor.configurable || descriptor.writable
      || !__velarGraphIsList(descriptor.value)) {
      throw new TypeError("VelarScript Web observer async-work ownership is invalid");
    }
    return descriptor.value;
  }
  const cell = [0, false];
  __velarGraphDefine(globalThis, __velarAsyncWorkKey, {
    value: cell,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return cell;
})();

// What the two compiler-owned lowering points call: the detached-task helper a
// 'detach' statement lowers to, where a detached Promise enters the runtime,
// and an action's run, where an action call does. Outside an observer run there
// is nothing to record -- an action a handler or '@main' starts is the host
// task's own work, not a ring an observer closed -- so the same unconditional
// call is correct at both sites.
function __velarNoteAsyncWork() {
  if (__velarAsyncWorkCell[0] > 0) __velarAsyncWorkCell[1] = true;
  return null;
}

function __velarCloseTaskWindow() {
  __velarTaskSentinelArmed = false;
  __velarFlushToken = null;
  __velarAsyncWorkCell[1] = false;
  return null;
}

// The macrotask boundary the run-count window ends at. 'setTimeout' is the one
// scheduling operation every host this runtime supports publishes -- page,
// worker, and the Node process a 'velar test' run drives the emitted runtime
// in -- and it is captured at module initialization like every other ambient
// operation here. A host that publishes none is not left without a gate: the
// window then closes as soon as the flush chain comes to rest, which is the
// per-flush budget this runtime had before, so the synchronous cycles stay
// covered and only the asynchronous one goes back to being invisible.
function __velarArmTaskSentinel() {
  if (__velarTaskSentinelArmed) return true;
  if (typeof __velarFoundationSetTimeout !== "function" || typeof __velarFoundationReflectApply !== "function") return false;
  __velarTaskSentinelArmed = true;
  try { __velarFoundationReflectApply(__velarFoundationSetTimeout, globalThis, [__velarCloseTaskWindow, 0]); }
  catch { __velarTaskSentinelArmed = false; return false; }
  return true;
}

// The three observers that have run most in the task window running now, kept
// as the run counts are stamped rather than reconstructed afterwards: the queue at
// the moment the budget runs out holds only whichever half of a cycle has not
// just run, so it cannot name the ring on its own. An observer that has run
// once is not a candidate, which is every observer of an ordinary flush.
const __velarFlushLeaders = [];

function __velarFlushLead(observer) {
  let kept = 0;
  for (let index = 0; index < __velarFlushLeaders.length; index += 1) {
    if (__velarFlushLeaders[index] === observer) continue;
    __velarFlushLeaders[kept] = __velarFlushLeaders[index];
    kept += 1;
  }
  __velarFlushLeaders.length = kept;
  let position = kept;
  while (position > 0 && __velarFlushLeaders[position - 1].flushRuns < observer.flushRuns) {
    __velarFlushLeaders[position] = __velarFlushLeaders[position - 1];
    position -= 1;
  }
  __velarFlushLeaders[position] = observer;
  if (__velarFlushLeaders.length > 3) __velarFlushLeaders.length = 3;
}

// D90 R21: compile time no longer refuses two watches that write one state, so
// this budget is the only gate left against a mutual-write cycle -- and a
// report that names nobody hands the author a number with no line to go to.
// The observers that ran most in this flush chain are the cycle; flushRuns
// already counts exactly that, so the highest few are named. A watch's label is
// its subject as the author spelled it, which in a write cycle is also the
// state each watch is reacting to, and the scope it was registered in supplies
// the component the report has always had a field for.
//
// Nothing here asks who wrote what. That question is gone from the language,
// and answering it would need the write frames R21 deleted.
function __velarFlushRunaway(stalled, token) {
  const ranked = [];
  const seen = __velarGraphCreateSet();
  const consider = (observer) => {
    if (observer.flushToken !== token || __velarGraphSetContains(seen, observer)) return;
    __velarGraphSetInsert(seen, observer);
    ranked[ranked.length] = observer;
  };
  // A cycle alternates, so the queue at the instant the budget ran out holds
  // only the half of the ring that has not just run. The leaders carry the
  // other half.
  for (let index = 0; index < __velarFlushLeaders.length; index += 1) consider(__velarFlushLeaders[index]);
  for (let index = 0; index < stalled.length; index += 1) consider(stalled[index]);
  __velarGraphOrder(ranked, (left, right) => right.flushRuns - left.flushRuns);
  const limit = ranked.length < 3 ? ranked.length : 3;
  let detail = "";
  let component = "";
  for (let index = 0; index < limit; index += 1) {
    const observer = ranked[index];
    const named = observer.mode === "watch" && typeof observer.label === "string" && observer.label !== ""
      ? "the watch on '" + observer.label + "'"
      : "a " + observer.mode + " observer";
    detail += (detail === "" ? "Ran most in this task: " : ", ") + named
      + " (" + observer.flushRuns + (observer.flushRuns === 1 ? " run)" : " runs)");
    if (component === "" && typeof observer.component === "string") component = observer.component;
  }
  return { detail, component };
}

function __velarScheduleFlush() {
  if (__velarRuntime.flushPending) return;
  __velarRuntime.flushPending = true;
  __velarEnqueue(__velarFlush);
}

// Only the observers that actually re-entered the queue during the overrun
// belong to the runaway cycle. An observer queued once by an unrelated write
// in the same turn is innocent, and stopping it is irreversible, so it is
// put back for the next microtask instead.
//
// Every overrun must still remove something, or the requeue turns the
// microtask chain into the freeze the budget exists to end: a cycle spread
// across more observers than the budget can run four times over re-enters
// none of them four times, so a fixed threshold of four stops nobody and the
// next flush repeats it forever. Two rules make the progress unconditional.
// The threshold falls to the highest run count actually present, so any
// queued observer this flush chain has already run is stopped; and the token
// is carried into the flush the overrun schedules, so run counts accumulate
// across the chain and the observers the chain has not reached yet are a
// pool that only shrinks.
function __velarFlushOverflow(token) {
  const stalled = [];
  for (const observer of __velarGraphSetItems(__velarRuntime.domQueue)) stalled[stalled.length] = observer;
  for (const observer of __velarGraphSetItems(__velarRuntime.watchQueue)) stalled[stalled.length] = observer;
  __velarGraphSetEmpty(__velarRuntime.domQueue);
  __velarGraphSetEmpty(__velarRuntime.watchQueue);
  let threshold = 0;
  for (let index = 0; index < stalled.length; index += 1) {
    const observer = stalled[index];
    if (observer.flushToken === token && observer.flushRuns > threshold) threshold = observer.flushRuns;
  }
  if (threshold > 4) threshold = 4;
  let requeued = false;
  for (let index = 0; index < stalled.length; index += 1) {
    const observer = stalled[index];
    if (threshold > 0 && observer.flushToken === token && observer.flushRuns >= threshold) {
      if (typeof observer.stop === "function") observer.stop();
      else observer.stopped = true;
      continue;
    }
    if (observer.stopped) continue;
    __velarGraphSetInsert(observer.mode === "watch" ? __velarRuntime.watchQueue : __velarRuntime.domQueue, observer);
    requeued = true;
  }
  const runaway = __velarFlushRunaway(stalled, token);
  // The window keeps its token and its run counts -- the requeued flush is one
  // more flush of the same task, and the pool of observers it has not reached
  // yet only shrinks -- but the budget is granted again. Without that, the
  // exhausted count would trip the very next flush of the same task, and the
  // observers stopped for it would be whatever was queued at that moment: the
  // innocent ones this overrun just put back, or an unrelated later write.
  __velarFlushBudget = __velarFlushBudgetPerTask;
  __velarFlushCarried = requeued;
  __velarRuntime.report(new RangeError("Reactive updates cannot run more than " + __velarFlushBudgetPerTask + " observers in one task"),
    { phase: "update", detail: runaway.detail, component: runaway.component, unhandled: true });
  if (requeued) __velarScheduleFlush();
}

// The one entry point: the microtask __velarScheduleFlush enqueues, and the
// synchronous drain the emitted tick() performs. It used to open and close D90
// R1-a-scope's flush-scoped writer registry around the settle; R21 deleted the
// registry with the referee that read it, so the name is all that remains and
// it remains because __velarEnqueue and tick() both hold it.
//
// D114 W/A1: it is also where the task window is closed or handed on. Both
// entries pass through here, including tick()'s drain, so the sentinel is armed
// once per window however the flush was reached, and a host without a timer
// falls back to closing the window here, one flush at a time.
function __velarFlush() {
  try { __velarFlushSettle(); }
  // Without a timer the window closes as soon as the chain comes to rest,
  // which is the per-flush budget this runtime had before -- except that a
  // flush already scheduled keeps it open, so an overrun's carried counts and
  // the queues a settle could not finish reach the flush that continues them.
  finally { if (!__velarArmTaskSentinel() && !__velarRuntime.flushPending) __velarCloseTaskWindow(); }
}

// Glitch-free order: every derived value and every watch settles to a fixed
// point before a single DOM node is written, so no watch and no rendered
// position can read a half-updated world and no corrective watch can push an
// invalid value through the DOM first. That is D90 R1 and it is unchanged.
//
// D90 R21 changed the other axis. Within the settle the watches run in
// registration order -- source order in a module, mount order across instances
// of one component, module-initialization order across modules -- and a watch
// that writes state is not promoted ahead of one that only observes. Whoever is
// written first runs first, two watches writing one state both take effect in
// that order, and a later write that clobbers an earlier one is the author's.
//
// Queue insertion order is not registration order and cannot stand in for it:
// two watches on two different states, both dirtied by one action, enter the
// queue in the order the action wrote the states. So each pass takes the queue
// as it stands and runs it by sequence number. Watches queued by this pass are
// picked up by the next one, in their own order.
//
// D114 W/A1, narrowed by W2: a flush that starts while the task window is still
// open continues it -- the same token, so flushRuns keeps accumulating on every
// observer, the same leaders, and the same remaining budget -- but only when an
// observer run in that window started asynchronous work, or when the overrun
// itself scheduled this flush. Every other flush opens a new window, which is
// the per-flush budget this runtime had before W.
function __velarFlushSettle() {
  __velarRuntime.flushPending = false;
  const carried = __velarFlushCarried;
  __velarFlushCarried = false;
  if (__velarFlushToken === null || !(carried || __velarAsyncWorkCell[1])) {
    __velarFlushToken = {};
    __velarFlushBudget = __velarFlushBudgetPerTask;
    __velarFlushLeaders.length = 0;
    __velarAsyncWorkCell[1] = false;
  }
  const token = __velarFlushToken;
  const step = (observer) => {
    __velarGraphSetRemove(observer.mode === "watch" ? __velarRuntime.watchQueue : __velarRuntime.domQueue, observer);
    if (observer.flushToken === token) observer.flushRuns += 1;
    else { observer.flushToken = token; observer.flushRuns = 1; }
    if (observer.flushRuns > 1) __velarFlushLead(observer);
    // The span the two lowering points ask about. It is the run itself rather
    // than the whole settle: work started by the flush's own bookkeeping is
    // not an observer's, and a nested observer created by a running one is.
    __velarAsyncWorkCell[0] += 1;
    try { observer.run(); }
    finally { __velarAsyncWorkCell[0] -= 1; }
  };
  while (__velarGraphSetCount(__velarRuntime.domQueue) || __velarGraphSetCount(__velarRuntime.watchQueue)) {
    while (true) {
      let ran = false;
      for (const observer of __velarGraphSetItems(__velarRuntime.domQueue)) {
        if (observer.mode !== "computed") continue;
        if ((__velarFlushBudget -= 1) < 0) { __velarFlushOverflow(token); return; }
        step(observer);
        ran = true;
      }
      if (ran) continue;
      const pending = [];
      for (const observer of __velarGraphSetItems(__velarRuntime.watchQueue)) pending[pending.length] = observer;
      __velarGraphOrder(pending, (left, right) => left.sequence - right.sequence);
      for (let index = 0; index < pending.length; index += 1) {
        const observer = pending[index];
        // A watch this pass already re-ran or stopped is no longer queued; the
        // snapshot is a plan, and the queue is what says whether it still owes
        // a run.
        if (observer.stopped || !__velarGraphSetContains(__velarRuntime.watchQueue, observer)) continue;
        if ((__velarFlushBudget -= 1) < 0) { __velarFlushOverflow(token); return; }
        step(observer);
        ran = true;
      }
      if (!ran) break;
    }
    for (const observer of __velarGraphSetItems(__velarRuntime.domQueue)) {
      if (observer.mode === "computed") break;
      if ((__velarFlushBudget -= 1) < 0) { __velarFlushOverflow(token); return; }
      step(observer);
    }
  }
  if (__velarGraphSetCount(__velarRuntime.domQueue) || __velarGraphSetCount(__velarRuntime.watchQueue)) __velarScheduleFlush();
}

